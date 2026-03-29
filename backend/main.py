import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Add backend directory to sys.path so we can import parser modules
sys.path.insert(0, str(Path(__file__).parent))

from parser import parse_floor_plan
from geometry import reconstruct_geometry
from topsis import analyze_all

app = FastAPI(title="ArchIntel API", description="AI Floor Plan to 3D Geometry Extractor")

# Allow the Vite frontend to access the API locally
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent.parent / "data" / "floor_plans"

# Simple in-memory cache — avoid re-parsing the same plan on every click
_cache = {}


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
    Run Stage 1 (CV Parsing), Stage 2 (Geometry), and Stage 4 (TOPSIS)
    on the requested plan. Returns the full analysis-ready structure.
    """
    # Check cache first
    if plan_id in _cache:
        return _cache[plan_id]

    image_path = DATA_DIR / f"{plan_id}.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Floor plan not found")

    try:
        # Stage 1: CV Parsing (walls, rooms, openings in pixels)
        parsed_data = parse_floor_plan(str(image_path))
        
        # Stage 2: Geometry (meters, classifications, graph)
        result, _ = reconstruct_geometry(parsed_data)
        
        # Stage 4: Material Analysis (TOPSIS rankings per wall)
        result = analyze_all(result)
        
        response = {
            "success": True,
            "plan_id": plan_id,
            "data": result
        }
        
        # Cache the result
        _cache[plan_id] = response
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
