# 🏗️ ArchIntel — Autonomous Structural Intelligence System

An AI-powered pipeline that reads architectural floor plans, reconstructs them in 3D, and provides intelligent material recommendations with explainable reasoning.

## Architecture

```
Floor Plan Image (.png)
        │
        ▼
┌─────────────────────────┐
│  Stage 1: CV Parsing    │  OpenCV HoughLinesP → Snap → Merge
│  parser.py              │  → Walls, Rooms, Openings (px)
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  Stage 2: Geometry      │  Pixel → Meter conversion
│  geometry.py            │  4-rule load-bearing classification
│                         │  Shapely polygon, NetworkX graph
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  Stage 4: TOPSIS        │  Multi-criteria material ranking
│  topsis.py              │  Element-specific weight profiles
│  materials.json         │  Structural concern flags
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  Stage 5: LLM           │  Mistral Small / Gemini Flash
│  explainer.py           │  Pydantic structured output
│                         │  Plain-language explanations
└────────┬────────────────┘
         ▼
┌─────────────────────────┐
│  Stage 3: 3D Viewer     │  React + Three.js (R3F)
│  frontend/              │  Interactive wall selection
│                         │  Material panel + AI reports
└─────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Image Processing | Python 3.12, OpenCV, NumPy |
| Geometry | Shapely, NetworkX |
| Backend API | FastAPI, Uvicorn |
| Material Analysis | NumPy (TOPSIS algorithm) |
| LLM Explainability | Mistral AI (primary), Google Gemini (fallback) |
| 3D Rendering | React Three Fiber (@react-three/fiber) |
| Frontend | Vite + React |

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+

### Backend

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# Set LLM API keys (get free keys from console.mistral.ai and aistudio.google.com)
export MISTRAL_API_KEY="your_mistral_key"
export GEMINI_API_KEY="your_gemini_key"

# Start the API server
uvicorn backend.main:app --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/plans` | GET | List available floor plans |
| `/api/parse/{plan_id}` | GET | Run Stages 1-4 (parse, classify, rank) |
| `/api/explain/{plan_id}` | GET | Stage 5: Generate LLM explanations for all walls |
| `/api/explain/{plan_id}/{wall_id}` | GET | On-demand explanation for a single wall |

## Floor Plans

Place floor plan images as `.png` files in `data/floor_plans/`. The system ships with 3 sample plans (A, B, C).

## Wall Classification Rules

1. **Perimeter**: Walls on the building boundary → load-bearing
2. **Spine**: Long walls (≥50% of building span) near the centroid → load-bearing
3. **Thickness**: Walls >1.4× thicker than the median → load-bearing
4. **Default**: All remaining → partition

## TOPSIS Weight Profiles

| Element | Cost | Strength | Durability | Rationale |
|---|---|---|---|---|
| Load-Bearing | 20% | **45%** | 35% | Failure = collapse. Strength dominates. |
| Partition | **45%** | 20% | 35% | No structural load. Optimize for cost. |

## License

MIT
