"""
test_parser.py — Run Stage 1 parser on all 3 floor plan images
===============================================================
Usage:
    cd backend
    python test_parser.py

Outputs:
    output/plan_a_debug.png   ← visual overlay showing what was detected
    output/plan_b_debug.png
    output/plan_c_debug.png
    output/plan_a_result.json ← full parsed data
    output/plan_b_result.json
    output/plan_c_result.json
"""

import json
import os
import sys
from pathlib import Path

# Make sure we can import parser from the same directory
sys.path.insert(0, str(Path(__file__).parent))

from parser import parse_floor_plan
from geometry import reconstruct_geometry

ROOT = Path(__file__).parent.parent

FLOOR_PLANS = [
    str(ROOT / "data/floor_plans/plan_a.png"),
    str(ROOT / "data/floor_plans/plan_b.png"),
    str(ROOT / "data/floor_plans/plan_c.png"),
]

os.makedirs(str(ROOT / "output"), exist_ok=True)


def run_all():
    print("\n" + "=" * 60)
    print("  ArchIntel — Stage 1 & 2: Floor Plan Parser & Geometry")
    print("=" * 60)

    all_results = {}

    for image_path in FLOOR_PLANS:
        if not Path(image_path).exists():
            print(f"\n  ⚠  Skipping {image_path} — file not found")
            continue

        # Run the parser (Stage 1)
        result = parse_floor_plan(image_path)

        # Reconstruct physical geometry (Stage 2)
        print("  Stage 2: Reconstructing Geometry (Meters + Load Bearing)...")
        result, graph = reconstruct_geometry(result)
        
        geo_stats = result['geometry_stats']
        print(f"          Scale: {result['scale']['px_per_meter']} px/m")
        print(f"          Building Area: {geo_stats['building_area_m2']} m²")
        print(f"          Load-bearing walls: {geo_stats['load_bearing_walls']}")
        print(f"          Partition walls:    {geo_stats['partition_walls']}")

        # Save the JSON result
        plan_name = Path(image_path).stem
        out_path = f"../output/{plan_name}_result.json"
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"  JSON saved  → {out_path}")

        all_results[plan_name] = result

    # Print a comparison summary table
    print("\n" + "=" * 80)
    print("  STAGE 2 GEOMETRY SUMMARY")
    print("=" * 80)
    print(f"  {'Plan':<10} | {'Walls':>5} {'LoadB':>6} {'Part':>5} | {'Area(m2)':>8} {'px/m':>6} | {'Rooms':>5}")
    print(f"  {'-'*75}")
    for plan_name, result in all_results.items():
        w = result['debug']['num_walls']
        r = result['debug']['num_rooms']
        geo = result['geometry_stats']
        lb = geo['load_bearing_walls']
        pt = geo['partition_walls']
        area = geo['building_area_m2']
        px_m = result['scale']['px_per_meter']
        print(f"  {plan_name:<10} | {w:>5} {lb:>6} {pt:>5} | {area:>8.1f} {px_m:>6.1f} | {r:>5}")
    print("=" * 80)
    print("\n  ✓ Geometry generation complete! Check the output/ folder.")
    print("  Open output/plan_a_debug.png etc. to visually verify detections.\n")


if __name__ == "__main__":
    run_all()
