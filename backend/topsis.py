"""
topsis.py — Stage 4: Material Analysis using TOPSIS
=====================================================
TOPSIS (Technique for Order of Preference by Similarity to Ideal Solution)
is a multi-criteria decision-making method from operations research.

Unlike a simple weighted sum, TOPSIS ranks materials by how CLOSE they are
to the ideal best AND how FAR from the ideal worst. This avoids materials
that are "great at one thing, terrible at everything else" from winning.

Key design decisions:
  - Cost is a NON-BENEFIT criterion (lower = better)
  - Strength and Durability are BENEFIT criteria (higher = better)
  - Weight profiles differ by element type (structural vs non-structural)
  - Concern flags are computed deterministically (never by LLM)
"""

import numpy as np
import json
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# MATERIAL DATABASE
# ─────────────────────────────────────────────────────────────────────────────

def load_materials() -> list:
    """Load the material database from materials.json."""
    db_path = Path(__file__).parent / "materials.json"
    with open(db_path) as f:
        data = json.load(f)
    return data["materials"]


# ─────────────────────────────────────────────────────────────────────────────
# WEIGHT PROFILES — different priorities for different structural roles
# ─────────────────────────────────────────────────────────────────────────────

# Columns: [cost, strength, durability]
# These must sum to ~1.0 (they get normalized anyway, but clarity helps)
WEIGHT_PROFILES = {
    "load_bearing": {
        "weights": [0.20, 0.45, 0.35],
        "label": "Structural (strength-critical)",
        "rationale": "Load-bearing walls support the roof and upper floors. "
                     "Failure = structural collapse. Strength is paramount."
    },
    "partition": {
        "weights": [0.45, 0.20, 0.35],
        "label": "Non-structural (cost-optimized)",
        "rationale": "Partition walls only divide rooms. If they crack, it's "
                     "cosmetic. We optimize for cost while maintaining durability."
    },
    "column": {
        "weights": [0.15, 0.55, 0.30],
        "label": "Column (highest stress concentration)",
        "rationale": "Columns carry concentrated point loads from beams above. "
                     "They have the highest strength requirement of any element."
    },
    "slab": {
        "weights": [0.20, 0.50, 0.30],
        "label": "Slab (flexural resistance)",
        "rationale": "Slabs span large areas and resist bending (flexural) loads. "
                     "Strength dominates, but cost matters for large surface areas."
    },
}

# Benefit flags: [cost=False (lower better), strength=True, durability=True]
BENEFIT_FLAGS = [False, True, True]
CRITERIA_NAMES = ["cost", "strength", "durability"]


# ─────────────────────────────────────────────────────────────────────────────
# CORE TOPSIS ALGORITHM
# ─────────────────────────────────────────────────────────────────────────────

def topsis(A: np.ndarray, w: np.ndarray, benefit: list) -> np.ndarray:
    """
    Standard TOPSIS implementation.
    
    Args:
        A: (m x n) decision matrix — m alternatives, n criteria
        w: (n,) weight vector — importance of each criterion
        benefit: (n,) boolean list — True if higher=better, False if lower=better
    
    Returns:
        C: (m,) closeness scores in [0, 1] — higher = better alternative
    
    The 5 steps of TOPSIS:
        1. Normalize the matrix (remove scale effects between criteria)
        2. Apply weights (multiply each column by its importance)
        3. Find ideal best (highest for benefit, lowest for cost)
        4. Find ideal worst (opposite)
        5. Score = distance_from_worst / (distance_from_best + distance_from_worst)
    """
    A = np.array(A, dtype=float)
    w = np.array(w, dtype=float)
    benefit = np.array(benefit, dtype=bool)

    # Step 1: Vector normalization (each column / its L2 norm)
    norms = np.linalg.norm(A, axis=0)
    norms[norms == 0] = 1  # avoid division by zero
    R = A / norms

    # Step 2: Weighted normalized matrix
    w = w / w.sum()  # ensure weights sum to 1
    V = R * w

    # Step 3: Ideal best and worst
    v_best = np.where(benefit, V.max(axis=0), V.min(axis=0))
    v_worst = np.where(benefit, V.min(axis=0), V.max(axis=0))

    # Step 4: Euclidean distance to best and worst
    D_best = np.linalg.norm(V - v_best, axis=1)
    D_worst = np.linalg.norm(V - v_worst, axis=1)

    # Step 5: Closeness coefficient
    denom = D_best + D_worst
    denom[denom == 0] = 1  # avoid division by zero
    C = D_worst / denom

    return C


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURAL CONCERN FLAGS
# ─────────────────────────────────────────────────────────────────────────────

def check_concerns(wall: dict) -> list:
    """
    Deterministic structural concern checks. These are computed in code
    (not by the LLM) because safety-critical checks must be reliable.
    
    The LLM's job is to EXPLAIN these concerns, not detect them.
    """
    concerns = []
    
    wall_type = wall.get('type', 'partition')
    length_m = wall.get('length_m', 0)
    thickness_m = wall.get('thickness_m', 0)
    
    if wall_type == 'load_bearing' and length_m > 5.0:
        concerns.append({
            "code": "long_span",
            "severity": "warning",
            "message": f"Unsupported span of {length_m}m exceeds 5m — "
                       f"consider adding an intermediate column"
        })
    
    if wall_type == 'load_bearing' and thickness_m < 0.15:
        concerns.append({
            "code": "thin_bearing",
            "severity": "warning",
            "message": f"Load-bearing wall thickness ({thickness_m}m) is below "
                       f"the 150mm structural minimum"
        })
    
    return concerns if concerns else None


# ─────────────────────────────────────────────────────────────────────────────
# RANK MATERIALS FOR A SINGLE ELEMENT
# ─────────────────────────────────────────────────────────────────────────────

def rank_materials(element_type: str, materials: list = None) -> dict:
    """
    Run TOPSIS to rank all materials for a given element type.
    
    Returns a dict with:
      - weight_profile: the weights used (for explainability)
      - rankings: top materials with scores
    """
    if materials is None:
        materials = load_materials()
    
    profile = WEIGHT_PROFILES.get(element_type, WEIGHT_PROFILES["partition"])
    weights = np.array(profile["weights"])
    
    # Build the decision matrix: rows = materials, cols = [cost, strength, durability]
    matrix = np.array([[m["cost"], m["strength"], m["durability"]] for m in materials])
    
    # Run TOPSIS
    scores = topsis(matrix, weights, BENEFIT_FLAGS)
    
    # Build ranked results
    ranked_indices = np.argsort(-scores)  # descending
    rankings = []
    for rank, idx in enumerate(ranked_indices[:3]):  # Top 3
        rankings.append({
            "rank": rank + 1,
            "name": materials[idx]["name"],
            "score": round(float(scores[idx]), 3),
            "best_use": materials[idx]["best_use"],
        })
    
    return {
        "weight_profile": {
            "label": profile["label"],
            "rationale": profile["rationale"],
            "weights": {
                CRITERIA_NAMES[i]: round(profile["weights"][i], 2)
                for i in range(len(CRITERIA_NAMES))
            }
        },
        "rankings": rankings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ORCHESTRATOR — analyze all walls in the parsed data
# ─────────────────────────────────────────────────────────────────────────────

def analyze_all(parsed_data: dict) -> dict:
    """
    Main entry point for Stage 4.
    Attaches TOPSIS material rankings and concern flags to every wall.
    
    Mutates parsed_data in-place and returns it.
    """
    materials = load_materials()
    walls = parsed_data.get("walls", [])
    
    for wall in walls:
        element_type = wall.get("type", "partition")
        
        # Run TOPSIS with appropriate weight profile
        wall["topsis_results"] = rank_materials(element_type, materials)
        
        # Check for structural concerns
        wall["concerns"] = check_concerns(wall)
    
    # Summary stats
    concern_count = sum(1 for w in walls if w.get("concerns"))
    parsed_data["material_analysis"] = {
        "total_elements_analyzed": len(walls),
        "elements_with_concerns": concern_count,
        "materials_database_size": len(materials),
    }
    
    return parsed_data
