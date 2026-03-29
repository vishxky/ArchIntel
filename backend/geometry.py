import networkx as nx
from shapely.geometry import LineString, Polygon, MultiPolygon
from shapely.ops import unary_union
import numpy as np

def estimate_scale(rooms: list, walls: list, assumed_building_max_dim_m: float = 12.0) -> float:
    """
    Estimate pixels-per-meter from the overall building bounds.
    We assume the longest side of the house (width or depth) is about 12 meters 
    (a typical size for residential homes).
    """
    if not walls and not rooms:
        return 1.0

    # Find the bounding box of all walls to get the true building extent
    all_pts = []
    for wall in walls:
        all_pts.extend([wall['start'], wall['end']])
    
    if not all_pts:
        return 1.0

    minx = min(p[0] for p in all_pts)
    maxx = max(p[0] for p in all_pts)
    miny = min(p[1] for p in all_pts)
    maxy = max(p[1] for p in all_pts)

    longest_side_px = max(maxx - minx, maxy - miny)
    
    # Avoid div/0
    if longest_side_px == 0:
        return 1.0
        
    px_per_meter = longest_side_px / assumed_building_max_dim_m
    return px_per_meter


def build_building_polygon(rooms: list, walls: list) -> Polygon:
    """
    Create a single Shapely Polygon that represents the outer boundary of the building.
    Uses room polygons and expands them slightly to cover external walls.
    """
    if not rooms:
        # Fallback: Just use a bounding box of all walls
        all_pts = []
        for w in walls:
            all_pts.extend([w['start'], w['end']])
        if not all_pts:
            return Polygon()
        minx, miny = min(p[0] for p in all_pts), min(p[1] for p in all_pts)
        maxx, maxy = max(p[0] for p in all_pts), max(p[1] for p in all_pts)
        return Polygon([(minx, miny), (maxx, miny), (maxx, maxy), (minx, maxy)])

    room_polys = [Polygon(r['polygon']) for r in rooms if len(r['polygon']) >= 3]
    
    # Fix invalid geometries (self-intersections) before union
    valid_polys = []
    for p in room_polys:
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_valid:
            valid_polys.append(p)
            
    if not valid_polys:
        return Polygon()

    # Union all rooms together to form the building footprint
    building_footprint = unary_union(valid_polys)
    
    # Buffer by the thickest wall to ensure perimeter walls fall INSIDE the polygon distance checks
    max_thickness = max([w['thickness_px'] for w in walls] + [10])
    building_polygon = building_footprint.buffer(max_thickness)
    
    # Fill any internal holes (courtyards/unextracted rooms) to make a solid footprint
    if building_polygon.geom_type == 'MultiPolygon':
        # Take the largest piece if disjoint
        building_polygon = max(building_polygon.geoms, key=lambda p: p.area)
        
    solid_polygon = Polygon(building_polygon.exterior)
    return solid_polygon


def classify_walls(walls: list, building_polygon: Polygon, px_per_meter: float):
    """
    Classify each wall as 'load_bearing' or 'partition'.
    Uses 4 real-world structural engineering rules in priority order.
    
    Improved: uses median thickness (robust to outliers), tighter perimeter
    distance, and adds orientation + concern flags for downstream TOPSIS.
    """
    if not walls:
        return

    # ── Pre-compute orientation for every wall ──
    for wall in walls:
        dx = abs(wall['end'][0] - wall['start'][0])
        dy = abs(wall['end'][1] - wall['start'][1])
        wall['orientation'] = 'horizontal' if dx >= dy else 'vertical'

    # Clamp implausibly thin thickness values (snapping artifact)
    # A real wall is at least ~100mm. At typical scales, 6px minimum.
    MIN_THICKNESS_PX = 6
    for wall in walls:
        wall['thickness_px'] = max(wall['thickness_px'], MIN_THICKNESS_PX)

    # Use MEDIAN thickness (robust to outliers from snapping errors)
    thicknesses = sorted([w['thickness_px'] for w in walls])
    median_thickness = thicknesses[len(thicknesses) // 2]
    
    # Building bounds for span detection
    minx, miny, maxx, maxy = building_polygon.bounds
    span_x = (maxx - minx) 
    span_y = (maxy - miny)
    center = building_polygon.centroid
    
    # Build an unbuffered outline from wall endpoints for tighter perimeter checks
    all_pts = []
    for w in walls:
        all_pts.extend([w['start'], w['end']])
    pt_xs = [p[0] for p in all_pts]
    pt_ys = [p[1] for p in all_pts]
    wall_minx, wall_maxx = min(pt_xs), max(pt_xs)
    wall_miny, wall_maxy = min(pt_ys), max(pt_ys)

    for wall in walls:
        wall_line = LineString([wall['start'], wall['end']])
        
        wall['length_m'] = round(wall['length_px'] / px_per_meter, 2)
        wall['thickness_m'] = round(wall['thickness_px'] / px_per_meter, 3)

        # ── RULE 1: Perimeter / Exterior Walls ─────────────────────────────
        # A wall is exterior if it lies along the outermost row/column of
        # wall coordinates (within a small tolerance).
        sx, sy = wall['start']
        ex, ey = wall['end']
        perimeter_tol = 10  # pixels
        
        on_left   = min(sx, ex) <= wall_minx + perimeter_tol
        on_right  = max(sx, ex) >= wall_maxx - perimeter_tol
        on_top    = min(sy, ey) <= wall_miny + perimeter_tol
        on_bottom = max(sy, ey) >= wall_maxy - perimeter_tol
        
        if wall['orientation'] == 'horizontal' and (on_top or on_bottom):
            wall['type'] = 'load_bearing'
            wall['reason'] = 'Perimeter wall (supports roof/external loads)'
            continue
        if wall['orientation'] == 'vertical' and (on_left or on_right):
            wall['type'] = 'load_bearing'
            wall['reason'] = 'Perimeter wall (supports roof/external loads)'
            continue

        # ── RULE 2: Central Spine Walls ─────────────────────────────────────
        # Long walls near the building center that reduce joist spans.
        wall_length_px = wall_line.length
        dist_to_center = wall_line.distance(center)

        building_span = span_x if wall['orientation'] == 'horizontal' else span_y
        half_cross_span = (span_y if wall['orientation'] == 'horizontal' else span_x) / 2
        
        if building_span > 0 and (wall_length_px / building_span) >= 0.5 and dist_to_center <= (0.2 * half_cross_span):
            wall['type'] = 'load_bearing'
            wall['reason'] = 'Central structural spine (reduces joist span)'
            continue

        # ── RULE 3: Thickness Threshold ─────────────────────────────────────
        # Walls significantly thicker than the median are structural.
        if wall['thickness_px'] > 1.4 * median_thickness:
            wall['type'] = 'load_bearing'
            wall['reason'] = 'Substantial thickness (exceeds partition median)'
            continue

        # ── RULE 4: Standard Interior Partitions ───────────────────────────
        wall['type'] = 'partition'
        wall['reason'] = 'Interior non-structural partition'


def build_graph(walls: list) -> nx.Graph:
    """
    Build a Node-Edge graph of the floor plan.
    Nodes = Corner coordinates (x,y)
    Edges = Wall segments connecting the corners
    """
    G = nx.Graph()
    for wall in walls:
        p1 = tuple(wall['start'])
        p2 = tuple(wall['end'])
        
        # Add corners as nodes
        G.add_node(p1, type="corner")
        G.add_node(p2, type="corner")
        
        # Add wall as edge
        G.add_edge(p1, p2, 
                   wall_id=wall['id'], 
                   type=wall.get('type', 'unknown'),
                   length_m=wall.get('length_m', 0.0),
                   thickness_m=wall.get('thickness_m', 0.0))
    return G


def add_dimensions(rooms: list, openings: list, px_per_meter: float):
    """
    Convert area and width pixels into physical meters based on the scale.
    """
    for room in rooms:
        # Area in meters squared = Area in px / (px_per_m * px_per_m)
        room['area_m2'] = round(room['area_px'] / (px_per_meter ** 2), 2)
        
    for op in openings:
        # Width of door/window
        op['width_m'] = round(op['width_px'] / px_per_meter, 2)


def reconstruct_geometry(parsed_data: dict, assumed_width_m: float = 12.0) -> dict:
    """
    Main entry point for Stage 2.
    Takes parsed dict from parser.py, mutates it with physical dimensions/classifications,
    and returns a NetworkX graph structure.
    """
    walls = parsed_data['walls']
    rooms = parsed_data['rooms']
    openings = parsed_data['openings']

    # 1. Scale Conversion
    px_per_meter = estimate_scale(rooms, walls, assumed_width_m)
    parsed_data['scale'] = {
        "px_per_meter": round(px_per_meter, 2),
        "assumed_building_dim_m": assumed_width_m
    }

    # 2. Polygon Footprint
    building_poly = build_building_polygon(rooms, walls)

    # 3. Classify Walls and attach Meter Dimensions
    classify_walls(walls, building_poly, px_per_meter)

    # 4. Attach Meter Dimensions to Rooms/Openings
    add_dimensions(rooms, openings, px_per_meter)

    # 5. Build Final Structural Graph
    graph = build_graph(walls)
    
    # Count stats
    load_bearing = sum(1 for w in walls if w['type'] == 'load_bearing')
    partitions = len(walls) - load_bearing

    parsed_data['geometry_stats'] = {
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "load_bearing_walls": load_bearing,
        "partition_walls": partitions,
        "building_area_m2": round(building_poly.area / (px_per_meter ** 2), 2)
    }

    return parsed_data, graph
