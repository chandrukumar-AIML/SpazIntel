# ARCHITECTURE.md — Project Atlas

## System Overview

Project Atlas is a **pipeline architecture**. Data flows one-way through stages.
Each stage is a self-contained module in `engines/rce/`.

```
                        REALITY CAPTURE ENGINE (engines/rce/)
                        ┌─────────────────────────────────────────────┐
Phone Video (.mp4)      │                                             │
        │               │  capture.py     → frames/ (JPG images)      │
        └──────────────►│  reconstruct.py → sparse/ + splat/ (3D)     │
                        │  detect.py      → detections/ (DINO output) │
                        │  scene_graph.py → scene_graph.json           │
                        │  diff.py        → diff_report.json           │
                        └──────────────────────────────────────────────┘
                                              │
                                              ▼
                        BACKEND (backend/)    FastAPI
                        ┌─────────────────────────────┐
                        │  POST /api/spatial/action   │
                        │  spatial_impl.py            │
                        │  → scan    (run pipeline)   │
                        │  → query   (LLM Q&A)        │
                        │  → diff    (change detect)  │
                        └──────────────┬──────────────┘
                                       │
                                       ▼
                        FRONTEND (frontend/)   Streamlit
                        ┌─────────────────────────────┐
                        │  3D viewer (splat render)   │
                        │  Chat interface (Q&A)       │
                        │  Diff viewer                │
                        └─────────────────────────────┘
```

---

## Data Flow (per scan)

```
1. User uploads video
2. capture.py     → extract frames at 2 FPS → data/scans/{scan_id}/frames/
3. reconstruct.py → COLMAP sparse recon     → data/scans/{scan_id}/sparse/
4. reconstruct.py → gsplat training         → data/scans/{scan_id}/splat/
5. detect.py      → Grounding DINO on frames → data/scans/{scan_id}/detections/
6. scene_graph.py → build JSON graph        → data/scans/{scan_id}/scene_graph.json
7. SQLite DB      → store scan metadata + graph
```

---

## Component Contracts

### engines/rce/capture.py
```python
def extract_frames(video_path: str, output_dir: str, fps: float = 2.0) -> list[str]:
    """Returns list of extracted frame paths."""
```

### engines/rce/reconstruct.py
```python
def run_colmap(frames_dir: str, output_dir: str) -> dict:
    """Runs COLMAP SfM. Returns sparse reconstruction stats."""

def run_gsplat(colmap_dir: str, output_dir: str) -> dict:
    """Trains Gaussian Splat. Returns splat file path."""
```

### engines/rce/detect.py
```python
def detect_objects(frames_dir: str, output_dir: str, prompts: list[str]) -> list[dict]:
    """Runs Grounding DINO. Returns list of {label, bbox, confidence, frame_id}."""
```

### engines/rce/scene_graph.py
```python
def build_scene_graph(detections: list[dict], depth_maps: dict) -> dict:
    """Returns structured scene graph JSON."""
```

### engines/rce/diff.py
```python
def diff_graphs(graph_a: dict, graph_b: dict) -> dict:
    """Returns {added, removed, moved} object lists."""
```

---

## Scene Graph JSON Schema

```json
{
  "scan_id": "scan_20250725_001",
  "timestamp": "2025-07-25T10:00:00Z",
  "room": {
    "estimated_dimensions": {"width_m": 4.5, "depth_m": 6.0, "height_m": 2.8}
  },
  "objects": [
    {
      "id": "obj_001",
      "label": "chair",
      "color_hint": "blue",
      "confidence": 0.91,
      "position": {"x": 1.2, "y": 0.0, "z": 2.3},
      "bbox_3d": {"min": [1.0, 0.0, 2.0], "max": [1.5, 0.9, 2.6]},
      "relationships": ["near obj_002", "facing obj_003"]
    }
  ],
  "structure": {
    "walls": 4,
    "doors": [{"id": "door_001", "position": "north-wall"}],
    "windows": [{"id": "win_001", "position": "east-wall"}]
  }
}
```

---

## Database Schema (SQLite MVP)

```sql
-- Scans table
CREATE TABLE scans (
    id TEXT PRIMARY KEY,          -- scan_{timestamp}_{seq}
    created_at DATETIME,
    location_id TEXT,             -- for multi-room (Phase 3)
    video_path TEXT,
    splat_path TEXT,
    scene_graph_path TEXT,
    status TEXT                   -- pending | processing | done | failed
);

-- Scene graph stored as JSON file (not in DB for MVP)
-- Phase 3: migrate to PostgreSQL + PostGIS for spatial queries
```

---

## LLM Integration

```
Scene Graph JSON
       │
       ▼
System Prompt (spatial_qa_prompt_v1.txt)
+ Scene Graph as structured context
+ User question
       │
       ▼
Claude claude-sonnet-5 (primary)
→ Groq/Gemini (fallback)
       │
       ▼
Structured answer (object, location, confidence)
```

**Key constraint:** LLM receives scene graph JSON, NOT raw images or 3D data.
This keeps token usage low and answers grounded.

---

## Architecture Decisions

### ADR-001: Self-hosted only, no third-party scan APIs
**Decision:** COLMAP + gsplat, not Polycam API or Matterport API.
**Reason:** Core IP must not depend on rented infrastructure.

### ADR-002: Scene graph as the intelligence layer
**Decision:** All LLM reasoning operates on the scene graph JSON, not pixels.
**Reason:** Grounded, efficient, diffable, queryable — raw pixels are none of these.

### ADR-003: Streamlit for Phase 2 UI, React for Phase 3+
**Decision:** Streamlit first (fast to build), React + TypeScript after MVP validated.
**Reason:** 8-week MVP window — ship something demonstrable before building it right.

### ADR-004: SQLite for MVP, PostgreSQL + PostGIS for Phase 3
**Decision:** SQLite locally, migrate when multi-room + spatial queries are needed.
**Reason:** Don't over-engineer the storage layer before the pipeline is proven.
