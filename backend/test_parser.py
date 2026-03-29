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

ROOT = Path(__file__).parent.parent

FLOOR_PLANS = [
    str(ROOT / "data/floor_plans/plan_a.png"),
    str(ROOT / "data/floor_plans/plan_b.png"),
    str(ROOT / "data/floor_plans/plan_c.png"),
]

os.makedirs(str(ROOT / "output"), exist_ok=True)


def run_all():
    print("\n" + "=" * 60)
    print("  ArchIntel — Stage 1: Floor Plan Parser Test")
    print("=" * 60)

    all_results = {}

    for image_path in FLOOR_PLANS:
        if not Path(image_path).exists():
            print(f"\n  ⚠  Skipping {image_path} — file not found")
            continue

        # Run the parser
        result = parse_floor_plan(image_path)

        # Save the JSON result
        plan_name = Path(image_path).stem
        out_path = f"../output/{plan_name}_result.json"
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"  JSON saved  → {out_path}")

        all_results[plan_name] = result

    # Print a comparison summary table
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  {'Plan':<10} {'Walls':>6} {'Rooms':>6} {'Openings':>9}")
    print(f"  {'-'*35}")
    for plan_name, result in all_results.items():
        w = result['debug']['num_walls']
        r = result['debug']['num_rooms']
        o = result['debug']['num_openings']
        print(f"  {plan_name:<10} {w:>6} {r:>6} {o:>9}")
    print("=" * 60)
    print("\n  ✓ All done! Check the output/ folder for debug images.")
    print("  Open output/plan_a_debug.png etc. to visually verify detections.\n")


if __name__ == "__main__":
    run_all()
