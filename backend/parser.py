"""
parser.py — Stage 1: Floor Plan Parsing (OpenCV)
=================================================
Autonomous Structural Intelligence System — ArchIntel

What this module does:
    Takes a floor plan PNG image and extracts:
      1. Wall segments  → (x1,y1) to (x2,y2) lines with thickness
      2. Room polygons  → enclosed areas defined by walls
      3. Openings       → doors and windows (gaps in walls)

How it works (7-step pipeline):
    Step 1: Load & Preprocess      — grayscale + blur + OTSU binarize
    Step 2: Remove Noise           — filter out text, icons, door arcs
    Step 3: Morphological Cleanup  — close tiny wall gaps
    Step 4: Line Detection         — Canny edges + HoughLinesP (H/V only)
    Step 5: Coordinate Snapping    — cluster nearby coords so walls connect
    Step 6: Room Extraction        — Shapely polygonize() to find rooms
    Step 7: Opening Detection      — walk walls pixel-by-pixel, find gaps

Why OpenCV (not deep learning)?
    Classical CV needs no training data, runs instantly, and is fully
    explainable to judges — every parameter has a concrete meaning.
"""

import cv2
import numpy as np
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union
import json
import os
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Load and Preprocess
# ─────────────────────────────────────────────────────────────────────────────

def load_and_preprocess(image_path: str):
    """
    Load a floor plan image and convert it to a binary (black/white) image
    where walls are WHITE (255) and background is BLACK (0).

    Why OTSU threshold?
        OTSU automatically finds the optimal cutoff between dark pixels (walls)
        and light pixels (background/rooms). No manual tuning needed — it works
        on any floor plan regardless of contrast or brightness.

    Returns:
        img_gray  — original grayscale image (for later reference)
        img_color — original color image (for debug visualization)
        bw        — binary image: walls=255, background=0
    """
    img_color = cv2.imread(image_path)
    if img_color is None:
        raise FileNotFoundError(f"Cannot load image: {image_path}")

    img_gray = cv2.cvtColor(img_color, cv2.COLOR_BGR2GRAY)

    # Slight blur reduces sensor noise (3x3 kernel = minimal smoothing)
    blurred = cv2.GaussianBlur(img_gray, (3, 3), 0)

    # THRESH_BINARY_INV + OTSU: dark pixels (walls) become WHITE, light becomes BLACK
    _, bw = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    return img_gray, img_color, bw


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Remove Noise (text labels, door arcs, furniture icons)
# ─────────────────────────────────────────────────────────────────────────────

def remove_noise(bw: np.ndarray, min_area: int = 200) -> np.ndarray:
    """
    Remove small connected regions (text, door arcs, scale bars, icons).

    Why connected components?
        Every group of touching white pixels is a "component". Wall segments
        are large (hundreds of pixels). Text/icons are tiny. We keep only
        components larger than min_area pixels.

    Why min_area=200?
        Tuned for these floor plans: wall segments are thousands of pixels,
        door arcs are ~100-500 px but we handle that via a higher threshold.
        Adjust if small rooms are getting filtered.

    Returns:
        clean — binary image with only large wall-like structures
    """
    # Find all connected white regions
    nb_components, output, stats, _ = cv2.connectedComponentsWithStats(
        bw, connectivity=8
    )

    clean = np.zeros_like(bw)
    for i in range(1, nb_components):  # skip index 0 (background)
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= min_area:
            clean[output == i] = 255

    return clean


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Morphological Cleanup — close tiny gaps in wall lines
# ─────────────────────────────────────────────────────────────────────────────

def morphological_cleanup(clean: np.ndarray) -> np.ndarray:
    """
    Dilate then erode (= morphological closing) to bridge 1-2 pixel gaps
    in wall lines caused by image compression or anti-aliasing.

    Why dilate then erode?
        Dilation expands white pixels by 1px → closes gaps.
        Erosion shrinks back → restores original wall thickness.
        Net effect: gaps are filled, walls remain the same size.

    Returns:
        cleaned binary image with continuous wall lines
    """
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    closed = cv2.dilate(clean, kernel, iterations=2)
    closed = cv2.erode(closed, kernel, iterations=2)
    return closed


# ─────────────────────────────────────────────────────────────────────────────
# STEP 4: Line Detection (Canny edges + Probabilistic Hough Transform)
# ─────────────────────────────────────────────────────────────────────────────

def detect_lines(clean: np.ndarray, img_shape: tuple) -> list:
    """
    Detect straight wall segments using Canny edge detection + HoughLinesP.

    Why Canny first?
        HoughLinesP works on edge images, not binary images. Canny converts
        the binary wall regions into just their edge outlines.

    Why HoughLinesP (Probabilistic Hough)?
        It returns actual segment endpoints (x1,y1)→(x2,y2), not infinite
        lines. Much easier to work with for geometry.

    Why filter to horizontal/vertical only (abs < 5px)?
        Orthogonal floor plans only have H/V walls. Diagonal detections are
        artifacts from staircase edges or anti-aliasing — we discard them.

    Returns:
        list of ((x1,y1), (x2,y2)) tuples — all detected H/V wall segments
    """
    # Canny edge detection
    edges = cv2.Canny(clean, threshold1=30, threshold2=100, apertureSize=3)

    h, w = img_shape[:2]
    # Scale minLineLength to image size — larger images need longer min length
    min_line_len = max(30, int(min(h, w) * 0.04))

    # HoughLinesP parameters explained:
    #   rho=1       → 1 pixel distance resolution
    #   theta=π/180 → 1 degree angle resolution
    #   threshold=60 → minimum votes (intersections) to count as a line
    #   minLineLength → segments shorter than this are ignored
    #   maxLineGap=15 → bridge gaps up to 15px (handles tiny wall breaks)
    linesP = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=60,
        minLineLength=min_line_len,
        maxLineGap=15,
    )

    segments = []
    if linesP is not None:
        for line in linesP[:, 0, :]:
            x1, y1, x2, y2 = map(int, line)
            dx = abs(x1 - x2)
            dy = abs(y1 - y2)
            # Keep only nearly horizontal (dy<5) or nearly vertical (dx<5)
            if dx < 5 or dy < 5:
                # Normalize: always store as left→right or top→bottom
                if dx >= dy:  # horizontal
                    if x1 > x2:
                        x1, y1, x2, y2 = x2, y2, x1, y1
                else:  # vertical
                    if y1 > y2:
                        x1, y1, x2, y2 = x2, y2, x1, y1
                segments.append(((x1, y1), (x2, y2)))

    return segments


# ─────────────────────────────────────────────────────────────────────────────
# STEP 5: Coordinate Snapping — make walls connect at shared corners
# ─────────────────────────────────────────────────────────────────────────────

def merge_collinear_segments(segments: list, tol: int = 4) -> list:
    """
    Merge overlapping or adjacent segments that lie on the same horizontal
    or vertical axis into single longer segments.

    Why?
        HoughLinesP often splits one long wall into 2-3 shorter segments.
        Polygonize needs fully continuous lines to form closed rooms.
        Merging collinear fragments creates the continuous boundary needed.
    """
    if not segments:
        return []

    # Separate horizontal and vertical segments
    h_segs = []  # horizontal: same y
    v_segs = []  # vertical: same x
    for (x1, y1), (x2, y2) in segments:
        if abs(y1 - y2) <= tol:  # horizontal
            y_avg = (y1 + y2) // 2
            h_segs.append((y_avg, min(x1, x2), max(x1, x2)))
        elif abs(x1 - x2) <= tol:  # vertical
            x_avg = (x1 + x2) // 2
            v_segs.append((x_avg, min(y1, y2), max(y1, y2)))

    def merge_1d_group(segs_1d):
        """segs_1d: list of (axis_val, start, end) — merge overlapping intervals."""
        if not segs_1d:
            return []
        # Group by axis value (within tol)
        segs_1d.sort(key=lambda s: (s[0], s[1]))
        groups = {}
        for axis, start, end in segs_1d:
            placed = False
            for g_axis in list(groups.keys()):
                if abs(axis - g_axis) <= tol:
                    groups[g_axis].append((start, end))
                    placed = True
                    break
            if not placed:
                groups[axis] = [(start, end)]
        # Merge overlapping intervals per group
        result = []
        for axis, intervals in groups.items():
            intervals.sort()
            merged = [list(intervals[0])]
            for s, e in intervals[1:]:
                if s <= merged[-1][1] + tol * 3:  # allow small gap bridging
                    merged[-1][1] = max(merged[-1][1], e)
                else:
                    merged.append([s, e])
            result.extend([(axis, s, e) for s, e in merged])
        return result

    merged = []
    for axis, start, end in merge_1d_group(h_segs):
        merged.append(((start, axis), (end, axis)))
    for axis, start, end in merge_1d_group(v_segs):
        merged.append(((axis, start), (axis, end)))

    return merged


def close_segment_gaps(segments: list, extend_px: int = 6) -> list:
    """
    Slightly extend each wall segment at both ends so adjacent walls
    actually overlap/touch at corners, allowing polygonize() to close rooms.

    Why?
        Even after snapping, detected endpoints may be 1-5px short of the
        corner. A tiny extension ensures T-junctions and L-corners connect.
    """
    extended = []
    for (x1, y1), (x2, y2) in segments:
        dx = x2 - x1
        dy = y2 - y1
        length = max(1, np.hypot(dx, dy))
        ux, uy = dx / length, dy / length
        # Extend both ends by extend_px
        nx1 = int(round(x1 - ux * extend_px))
        ny1 = int(round(y1 - uy * extend_px))
        nx2 = int(round(x2 + ux * extend_px))
        ny2 = int(round(y2 + uy * extend_px))
        extended.append(((nx1, ny1), (nx2, ny2)))
    return extended


def snap_coordinates(segments: list, tol: int = 8) -> list:
    """
    Cluster nearby X and Y coordinates together so walls share exact endpoints.

    Why do we need this?
        Detected lines are rarely pixel-perfect. Two walls that should meet
        at the same corner might be at x=102 and x=105. Without snapping,
        they don't connect → broken rooms, gaps in 3D model.

    How it works:
        1. Collect all X coordinates from all segment endpoints
        2. Sort them and group any values within `tol` pixels together
        3. Replace each X with the average of its group (the "snapped" value)
        4. Same for Y coordinates
        5. Apply the mapping to all segment endpoints

    tol=8 pixels — tuned so legitimate separate walls (>8px apart) don't merge,
    but near-duplicate detections (<8px apart) do snap together.

    Returns:
        list of snapped ((x1,y1), (x2,y2)) tuples
    """
    if not segments:
        return []

    # Collect all endpoints
    all_pts = [pt for seg in segments for pt in seg]

    def cluster_axis(vals):
        """Group nearby values and return a mapping {original → snapped}."""
        sorted_vals = sorted(set(vals))
        if not sorted_vals:
            return {}
        clusters = [[sorted_vals[0]]]
        for v in sorted_vals[1:]:
            if abs(v - clusters[-1][-1]) <= tol:
                clusters[-1].append(v)
            else:
                clusters.append([v])
        mapping = {}
        for cluster in clusters:
            snapped = int(round(sum(cluster) / len(cluster)))
            for v in cluster:
                mapping[v] = snapped
        return mapping

    map_x = cluster_axis([p[0] for p in all_pts])
    map_y = cluster_axis([p[1] for p in all_pts])

    snapped = []
    for (x1, y1), (x2, y2) in segments:
        sx1 = map_x.get(x1, x1)
        sy1 = map_y.get(y1, y1)
        sx2 = map_x.get(x2, x2)
        sy2 = map_y.get(y2, y2)
        # Skip zero-length segments (both endpoints snapped to same point)
        if (sx1, sy1) != (sx2, sy2):
            snapped.append(((sx1, sy1), (sx2, sy2)))

    return snapped


# ─────────────────────────────────────────────────────────────────────────────
# HELPER: Estimate wall thickness from the binary mask
# ─────────────────────────────────────────────────────────────────────────────

def estimate_wall_thickness(p1: tuple, p2: tuple, wall_mask: np.ndarray,
                             sample_count: int = 10) -> int:
    """
    Estimate the pixel thickness of a wall by sampling perpendicular to it.

    Why do we need thickness?
        Downstream stages use thickness to classify load-bearing (thick) vs
        partition (thin) walls, and to set 3D box depth correctly.

    How:
        1. Find the wall's perpendicular direction (rotate 90°)
        2. At several points along the wall, scan outward in both directions
        3. Count how many pixels are wall pixels → that's the thickness
        4. Return the median across all sample points

    Returns:
        thickness in pixels (integer, minimum 1)
    """
    h, w = wall_mask.shape
    x1, y1 = p1
    x2, y2 = p2

    # Direction along the wall (unit vector)
    dx = x2 - x1
    dy = y2 - y1
    length = max(1, np.hypot(dx, dy))
    ux, uy = dx / length, dy / length

    # Perpendicular direction
    px, py = -uy, ux

    thicknesses = []
    for t in np.linspace(0.2, 0.8, sample_count):
        # Sample point along the wall
        mx = int(x1 + t * dx)
        my = int(y1 + t * dy)

        # Scan perpendicular in both directions
        thickness = 0
        for direction in [1, -1]:
            for dist in range(1, 30):  # max 30px scan
                sx = int(mx + direction * dist * px)
                sy = int(my + direction * dist * py)
                if 0 <= sx < w and 0 <= sy < h:
                    if wall_mask[sy, sx] > 0:
                        thickness += 1
                    else:
                        break
                else:
                    break

        thicknesses.append(thickness + 1)  # +1 for the center pixel

    return max(1, int(np.median(thicknesses)))


# ─────────────────────────────────────────────────────────────────────────────
# STEP 6: Room Extraction using Shapely polygonize()
# ─────────────────────────────────────────────────────────────────────────────

def extract_rooms(snapped_segments: list, img_shape: tuple,
                  min_room_area_px: int = 2000,
                  wall_mask: np.ndarray = None) -> list:
    """
    Find enclosed room polygons by detecting large dark (non-wall) regions
    in the binary mask.

    Why this approach instead of Shapely polygonize()?
        These floor plans have THICK walls (10-15px wide). Hough detects both
        edges of each wall, creating two parallel lines per wall. Polygonize
        then finds tiny slivers between parallel lines, not actual rooms.

        The more reliable approach:
          1. Invert the wall mask (rooms = white, walls = black)
          2. Find connected components — each large connected white = a room
          3. Find the contour of each room component and simplify it
          4. Convert contour to polygon coords

    Returns:
        list of dicts: id, polygon ([x,y] list), area_px, centroid
    """
    if wall_mask is None:
        return []

    h, w = img_shape[:2]
    inverted = cv2.bitwise_not(wall_mask)

    nb_components, output, stats, centroids = cv2.connectedComponentsWithStats(
        inverted, connectivity=8
    )

    rooms = []
    room_id = 1
    img_area = h * w
    margin = 5

    for i in range(1, nb_components):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < min_room_area_px or area > img_area * 0.85:
            continue

        x_bb = stats[i, cv2.CC_STAT_LEFT]
        y_bb = stats[i, cv2.CC_STAT_TOP]
        bw_bb = stats[i, cv2.CC_STAT_WIDTH]
        h_bb = stats[i, cv2.CC_STAT_HEIGHT]

        # Skip regions touching the image border (outer background)
        if x_bb <= margin or y_bb <= margin:
            continue
        if x_bb + bw_bb >= w - margin or y_bb + h_bb >= h - margin:
            continue

        component_mask = np.uint8(output == i) * 255
        contours, _ = cv2.findContours(
            component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        if not contours:
            continue

        contour = max(contours, key=cv2.contourArea)
        perimeter = cv2.arcLength(contour, True)
        epsilon = 0.02 * perimeter
        approx = cv2.approxPolyDP(contour, epsilon, True)
        polygon = [[int(pt[0][0]), int(pt[0][1])] for pt in approx]
        if len(polygon) < 3:
            continue

        cx, cy = centroids[i]
        rooms.append({
            "id": f"R{room_id}",
            "polygon": polygon,
            "area_px": int(area),
            "centroid": [int(cx), int(cy)],
        })
        room_id += 1

    return rooms


# ─────────────────────────────────────────────────────────────────────────────
# STEP 7: Opening Detection — find doors and windows (gaps in walls)
# ─────────────────────────────────────────────────────────────────────────────

def find_openings(snapped_segments: list, wall_mask: np.ndarray,
                  gap_min_px: int = 8, gap_max_px: int = 80) -> list:
    """
    Detect doors and windows by scanning along each wall segment for gaps
    (runs of non-wall pixels) in the binary mask.

    Why gap scanning?
        Doors and windows are simply interruptions in the wall. Walking the
        wall pixel by pixel and counting consecutive empty pixels finds them
        without needing any separate door-detection algorithm.

    gap_min_px=8  → gaps shorter than this are noise (JPEG artifacts)
    gap_max_px=80 → gaps longer than this are probably missing wall detections,
                    not real openings

    Returns:
        list of dicts with keys: id, wall_id (which wall it's on),
        position ([x,y] midpoint), width_px, type ("door" or "window")
    """
    h, w = wall_mask.shape
    openings = []
    opening_id = 1

    for wall_idx, (p1, p2) in enumerate(snapped_segments):
        x1, y1 = p1
        x2, y2 = p2
        length = int(np.hypot(x2 - x1, y2 - y1))
        if length == 0:
            continue

        # Sample points along this wall segment
        xs = np.linspace(x1, x2, length).astype(int)
        ys = np.linspace(y1, y2, length).astype(int)

        gap_start = None
        for i, (x, y) in enumerate(zip(xs, ys)):
            # Clamp to image bounds
            cx, cy = np.clip(x, 0, w - 1), np.clip(y, 0, h - 1)
            is_wall = wall_mask[cy, cx] > 0

            if not is_wall:
                # Start of a gap
                if gap_start is None:
                    gap_start = i
            else:
                # End of a gap — check if it's large enough to be a real opening
                if gap_start is not None:
                    gap_len = i - gap_start
                    if gap_min_px <= gap_len <= gap_max_px:
                        mid_i = (gap_start + i) // 2
                        mid_x = int(xs[mid_i])
                        mid_y = int(ys[mid_i])
                        # Heuristic: wide gaps = doors, narrow = windows
                        opening_type = "door" if gap_len > 25 else "window"
                        openings.append({
                            "id": f"O{opening_id}",
                            "wall_id": f"W{wall_idx + 1}",
                            "position": [mid_x, mid_y],
                            "width_px": gap_len,
                            "type": opening_type,
                        })
                        opening_id += 1
                    gap_start = None

        # Handle gap that reaches the end of the segment
        if gap_start is not None:
            gap_len = length - gap_start
            if gap_min_px <= gap_len <= gap_max_px:
                mid_i = (gap_start + length - 1) // 2
                mid_x = int(xs[min(mid_i, length - 1)])
                mid_y = int(ys[min(mid_i, length - 1)])
                opening_type = "door" if gap_len > 25 else "window"
                openings.append({
                    "id": f"O{opening_id}",
                    "wall_id": f"W{wall_idx + 1}",
                    "position": [mid_x, mid_y],
                    "width_px": gap_len,
                    "type": opening_type,
                })
                opening_id += 1

    return openings


# ─────────────────────────────────────────────────────────────────────────────
# Debug Visualization — draw all detected elements on the original image
# ─────────────────────────────────────────────────────────────────────────────

def generate_debug_image(img_color: np.ndarray, walls: list, rooms: list,
                          openings: list) -> np.ndarray:
    """
    Draw detected walls (green), rooms (semi-transparent fill), and
    openings (red = door, blue = window) on the original color image.

    This is crucial for:
      1. Verifying the parser is working correctly
      2. The demo — judges will see this overlay alongside the 3D model
    """
    debug = img_color.copy()
    overlay = img_color.copy()

    # Draw room fills (transparent colored polygons)
    room_colors = [
        (255, 200, 150), (150, 255, 200), (200, 150, 255),
        (255, 255, 150), (150, 200, 255), (255, 150, 200),
        (200, 255, 150), (180, 180, 255),
    ]
    for i, room in enumerate(rooms):
        pts = np.array(room["polygon"], dtype=np.int32)
        color = room_colors[i % len(room_colors)]
        cv2.fillPoly(overlay, [pts], color)
    # Blend: 30% color overlay on original
    cv2.addWeighted(overlay, 0.25, debug, 0.75, 0, debug)

    # Draw walls (thick green lines)
    for wall in walls:
        p1 = tuple(wall["start"])
        p2 = tuple(wall["end"])
        cv2.line(debug, p1, p2, (0, 200, 0), 3)
        # Draw wall ID label at midpoint
        mid = ((p1[0] + p2[0]) // 2, (p1[1] + p2[1]) // 2)
        cv2.putText(debug, wall["id"], mid, cv2.FONT_HERSHEY_SIMPLEX,
                    0.4, (0, 120, 0), 1, cv2.LINE_AA)

    # Draw room centroids and IDs
    for room in rooms:
        cx, cy = room["centroid"]
        cv2.putText(debug, room["id"], (cx - 15, cy),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 0, 200), 2, cv2.LINE_AA)

    # Draw openings (red circle = door, blue circle = window)
    for opening in openings:
        pos = tuple(opening["position"])
        color = (0, 0, 255) if opening["type"] == "door" else (255, 100, 0)
        cv2.circle(debug, pos, 8, color, -1)
        cv2.putText(debug, opening["type"][0].upper(), pos,
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)

    return debug


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ORCHESTRATOR — parse_floor_plan()
# ─────────────────────────────────────────────────────────────────────────────

def parse_floor_plan(image_path: str) -> dict:
    """
    Main entry point. Runs the full 7-step parsing pipeline on a floor plan image.

    Args:
        image_path: Path to the floor plan PNG file

    Returns:
        A dict with keys:
          walls    — list of wall segment dicts
          rooms    — list of room polygon dicts
          openings — list of opening dicts
          image_size — [width, height] in pixels
          scale_bar_px — estimated pixels per 4m (from the scale bar if present)
          debug    — pipeline stats (num raw lines, snapped segments, etc.)

        Also writes:
          debug image to output/<plan_name>_debug.png
    """
    print(f"\n{'='*60}")
    print(f"  Parsing: {image_path}")
    print(f"{'='*60}")

    # ── Step 1: Load and preprocess ──────────────────────────────────────────
    print("  Step 1: Loading and preprocessing...")
    img_gray, img_color, bw = load_and_preprocess(image_path)
    h, w = bw.shape
    print(f"          Image size: {w}×{h} pixels")

    # ── Step 2: Remove noise ─────────────────────────────────────────────────
    print("  Step 2: Removing noise (text, door arcs, icons)...")
    clean = remove_noise(bw, min_area=200)

    # ── Step 3: Morphological cleanup ────────────────────────────────────────
    print("  Step 3: Morphological cleanup (closing wall gaps)...")
    clean = morphological_cleanup(clean)

    # Keep a copy of the clean mask for opening detection later
    wall_mask = clean.copy()

    # ── Step 4: Line detection ───────────────────────────────────────────────
    print("  Step 4: Detecting wall lines (Canny + HoughLinesP)...")
    raw_segments = detect_lines(clean, (h, w))
    print(f"          Raw segments detected: {len(raw_segments)}")

    # ── Step 5: Coordinate snapping ──────────────────────────────────────────
    print("  Step 5: Snapping coordinates (tol=25px)...")
    snapped = snap_coordinates(raw_segments, tol=25)
    print(f"          After snapping: {len(snapped)} segments")

    # Merge collinear/overlapping segments on the same axis
    snapped = merge_collinear_segments(snapped)
    print(f"          After merging collinear: {len(snapped)} segments")

    # Extend segment endpoints slightly so corners meet cleanly
    snapped = close_segment_gaps(snapped, extend_px=6)

    # ── Build wall list with IDs and thickness ───────────────────────────────
    walls = []
    for i, (p1, p2) in enumerate(snapped):
        thickness = estimate_wall_thickness(p1, p2, wall_mask)
        length_px = int(np.hypot(p2[0] - p1[0], p2[1] - p1[1]))
        walls.append({
            "id": f"W{i + 1}",
            "start": list(p1),
            "end": list(p2),
            "thickness_px": thickness,
            "length_px": length_px,
        })

    # ── Step 6: Room extraction ──────────────────────────────────────────────
    print("  Step 6: Extracting room polygons (Connected Components)...")
    rooms = extract_rooms(snapped, (h, w), min_room_area_px=2000, wall_mask=wall_mask)
    print(f"          Rooms found: {len(rooms)}")

    # ── Step 7: Opening detection ────────────────────────────────────────────
    print("  Step 7: Detecting openings (doors & windows)...")
    openings = find_openings(snapped, wall_mask, gap_min_px=8, gap_max_px=80)
    print(f"          Openings found: {len(openings)}")

    # ── Generate debug visualization ─────────────────────────────────────────
    debug_img = generate_debug_image(img_color, walls, rooms, openings)
    plan_name = Path(image_path).stem
    output_dir = Path(image_path).parent.parent.parent / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    debug_path = str(output_dir / f"{plan_name}_debug.png")
    cv2.imwrite(debug_path, debug_img)
    print(f"  Debug image saved → {debug_path}")

    result = {
        "walls": walls,
        "rooms": rooms,
        "openings": openings,
        "image_size": [w, h],
        "debug": {
            "source_image": image_path,
            "num_raw_segments": len(raw_segments),
            "num_snapped_segments": len(snapped),
            "num_walls": len(walls),
            "num_rooms": len(rooms),
            "num_openings": len(openings),
        },
    }

    print(f"\n  ✓ DONE — {len(walls)} walls, {len(rooms)} rooms, {len(openings)} openings")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry point (run directly: python parser.py <image>)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python parser.py <floor_plan_image.png>")
        sys.exit(1)

    result = parse_floor_plan(sys.argv[1])
    print(json.dumps(result, indent=2))
