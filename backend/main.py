import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import shutil
import uuid

# Add backend directory to sys.path so we can import parser modules
sys.path.insert(0, str(Path(__file__).parent))

from parser import parse_floor_plan
from geometry import reconstruct_geometry
from topsis import analyze_all
from explainer import explain_all, explain_wall
from cost_estimator import estimate_cost

app = FastAPI(title="ArchIntel API", description="AI Floor Plan to 3D Geometry Extractor")

# Allow the Vite frontend to access the API locally
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent.parent / "data" / "floor_plans"
OUTPUT_DIR = Path(__file__).parent.parent / "output"

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
    Run Stages 1-4 on the requested plan.
    Explanations (Stage 5) are generated lazily via /api/explain.
    """
    if plan_id in _cache:
        return _cache[plan_id]

    image_path = DATA_DIR / f"{plan_id}.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Floor plan not found")

    try:
        # Stage 1: CV Parsing
        parsed_data = parse_floor_plan(str(image_path))
        # Stage 2: Geometry Reconstruction
        result, _ = reconstruct_geometry(parsed_data)
        # Stage 4: TOPSIS Material Analysis
        result = analyze_all(result)

        response = {"success": True, "plan_id": plan_id, "data": result}
        _cache[plan_id] = response
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/explain/{plan_id}")
def explain_plan(plan_id: str):
    """
    Stage 5: Generate LLM explanations for all walls in a plan.
    Calls the LLM once per wall (Gemini primary, Mistral fallback).
    Results are cached after first generation.
    """
    cache_key = f"{plan_id}_explained"
    if cache_key in _cache:
        return _cache[cache_key]

    # Ensure the plan has been parsed first
    if plan_id not in _cache:
        parse_plan(plan_id)  # triggers Stages 1-4

    base_data = _cache[plan_id]
    import copy
    result = copy.deepcopy(base_data["data"])

    try:
        result = explain_all(result)
        response = {"success": True, "plan_id": plan_id, "data": result}
        _cache[cache_key] = response
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/explain/{plan_id}/{wall_id}")
def explain_single_wall(plan_id: str, wall_id: str):
    """
    Generate an LLM explanation for a single wall (on-demand).
    Used by the frontend when clicking a wall.
    """
    # Ensure the plan is parsed
    if plan_id not in _cache:
        parse_plan(plan_id)

    walls = _cache[plan_id]["data"]["walls"]
    wall = next((w for w in walls if w["id"] == wall_id), None)
    if not wall:
        raise HTTPException(status_code=404, detail=f"Wall {wall_id} not found")

    try:
        result = explain_wall(wall)
        return {"success": True, "wall_id": wall_id, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
        
@app.post("/api/upload")
async def upload_plan(file: UploadFile = File(...)):
    """Upload a new floor plan image to the data directory."""
    if not file.filename.endswith(('.png', '.jpg', '.jpeg')):
        raise HTTPException(status_code=400, detail="Only PNG and JPEG files are supported")
        
    # Generate unique ID and save file
    plan_id = f"upload_{uuid.uuid4().hex[:8]}"
    file_extension = Path(file.filename).suffix
    
    if not DATA_DIR.exists():
        DATA_DIR.mkdir(parents=True)
        
    # Always save as .png since parser expects that format primarily
    dest_path = DATA_DIR / f"{plan_id}.png"
    
    with dest_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"success": True, "plan_id": plan_id}
    
    
@app.get("/api/image/{plan_id}")
def get_image(plan_id: str):
    """Returns the original source image for the frontend 2D view."""
    image_path = DATA_DIR / f"{plan_id}.png"
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Floor plan image not found")
        
    return FileResponse(image_path, media_type="image/png")
    

@app.get("/api/debug_image/{plan_id}")
def get_debug_image(plan_id: str):
    """Returns the parsed output image with borders, AI markings, and green walls."""
    # Ensure it's parsed first to generate the debug image if missing
    if plan_id not in _cache:
        parse_plan(plan_id)
        
    debug_path = OUTPUT_DIR / f"{plan_id}_debug.png"
    if not debug_path.exists():
        raise HTTPException(status_code=404, detail="Debug image not found")
        
    return FileResponse(debug_path, media_type="image/png")

@app.get("/api/cost/{plan_id}")
def get_cost(plan_id: str):
    """Calculates the estimated cost for building this structural layout."""
    if plan_id not in _cache:
        parse_plan(plan_id)
        
    parsed_data = _cache[plan_id]["data"]
    cost_data = estimate_cost(parsed_data)
    
    return {"success": True, "plan_id": plan_id, "data": cost_data}
