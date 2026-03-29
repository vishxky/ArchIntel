# 🏗️ ArchIntel — Autonomous Structural Intelligence System

An AI-powered pipeline that reads architectural floor plans, reconstructs them in 3D, and provides intelligent material recommendations with explainable reasoning.

## Overview

ArchIntel processes floor plan images through a five-stage pipeline:

1. **Floor Plan Parsing** — OpenCV-based detection of walls, rooms, doors, and windows
2. **Geometry Reconstruction** — Graph-based wall classification (load-bearing vs partition)
3. **3D Model Generation** — Interactive Three.js visualization in the browser
4. **Material Analysis** — TOPSIS-based multi-criteria material recommendations
5. **LLM Explainability** — Plain-English justifications for every recommendation

## Tech Stack

| Layer | Technology |
|---|---|
| Image Processing | Python, OpenCV |
| Geometry | Shapely, NetworkX |
| Backend | FastAPI |
| 3D Rendering | Three.js |
| Material Analysis | NumPy (TOPSIS) |
| Explainability | LLM API |

## Setup

```bash
pip install -r backend/requirements.txt
cd backend
uvicorn api:app --reload
```

Then open `http://localhost:8000` in your browser.

## License

MIT
