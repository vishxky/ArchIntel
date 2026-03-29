import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os

# Add backend directory to sys.path so we can import parser modules
sys.path.insert(0, str(Path(__file__).parent))

from parser import parse_floor_plan
from geometry import reconstruct_geometry

app = FastAPI(title="ArchIntel API", description="AI Floor Plan to 3D Geometry Extractor")

# Allow the Vite frontend to access the API locally
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Localhost dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent.parent / "data" / "floor_plans"

@app.get("/api/plans")
def list_plans():
    """List available floor plan images in the data directory."""
    if not DATA_DIR.exists():
        return {"plans": []}
    
    plans = []
    for f in DATA_DIR.glob("*.png"):
        plans.append({"id": f.stem, "filename": f.name})
    return {"plans": sorted(plans, key=lambda x: x['id'])}


@app.get("/api/parse/{plan_id}")
def parse_plan(plan_id: str):
    """
    Run Stage 1 (CV Parsing) and Stage 2 (Geometry) on the requested plan.
    Returns the final 3D-ready structure.
    """
    image_path = DATA_DIR / f"{plan_id}.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Floor plan not found")

    try:
        # Run Stage 1 (Extract pixels)
        parsed_data = parse_floor_plan(str(image_path))
        
        # Run Stage 2 (Extract dimensions & structural classification)
        result, _ = reconstruct_geometry(parsed_data)
        
        return {
            "success": True,
            "plan_id": plan_id,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Run locally via `uvicorn backend.main:app --reload`
