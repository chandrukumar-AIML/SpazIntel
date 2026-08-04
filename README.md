# SpazIntel — 3D Spatial Intelligence Platform

SpazIntel converts a phone video of any room into a **queryable 3D digital twin**. Point your camera, upload the video, and ask natural-language questions: *"Where is the workbench?"*, *"How far is the forklift from the exit?"*, *"What changed since last week?"* — every answer is grounded in a real scene graph with 3D world coordinates, not LLM hallucination.

The core architecture bet: **scene graph first, LLM second**. YOLO-World detects objects → Depth Anything v2 gives metric depth → the scene graph builds 3D world coordinates and pairwise distances → Claude/Groq/Ollama answers queries grounded on that structured JSON. No raw pixels reach the LLM.

---

## How It Works

```
Phone Video (.mp4 / frames)
        │
        ▼
Frame Extraction (capture.py — 2 FPS)
        │
        ├──► DUSt3R fast path (~30s, NAVER Labs 2024 transformer)
        │         → colored point cloud (PLY)
        │
        ├──► COLMAP full path (SfM photogrammetry)
        │         → sparse reconstruction → gsplat training
        │         → 3D Gaussian Splat (PLY → custom WebGL2 viewer)
        │
        ├──► YOLO-World object detection (open-vocab, 2024, no retraining)
        │         + Depth Anything v2 monocular depth → metric z_m per object
        │
        ▼
Scene Graph (JSON)
  ├── objects: label, confidence, world_x_m, world_y_m, z_m
  ├── distances: pairwise 3D distances between all object pairs
  └── room_size: estimated footprint in metres
        │
        ▼
LLM Chain (grounded on scene graph JSON — not raw pixels)
  Claude claude-sonnet-5 → Groq llama-3.1-8b → Gemini 1.5 Flash → OpenAI GPT-3.5 → Ollama llama3.2
        │
        ▼
Frontend (React 19 + TypeScript + Vite)
  ├── Custom WebGL2 Gaussian Splat viewer (700-line GLSL, instanced rendering, click-to-measure)
  ├── Canvas 2D room map with diff overlay (red=removed, orange=moved, green=added)
  ├── SSE streaming Q&A chat (/api/stream/query)
  ├── Floor plan SVG generator with metric grid
  └── Point cloud viewer (Three.js)
```

---

## What Makes This Different

- **Scene graph first** — LLM is grounded on structured spatial JSON (object labels, 3D world coordinates, pairwise distances). Answers cite real measurements, not guesses.
- **No hallucinated distances** — every distance answer comes from precomputed 3D Euclidean distance in the scene graph.
- **Custom WebGL2 Gaussian Splat renderer** — written from scratch: GLSL 300 es, instanced rendering, CPU depth sorting, click-to-measure, postMessage bridge to React. No library wrapper.
- **Spatial change detection** — compare two scans, get a structured diff: what moved (with Δ metres), what appeared, what disappeared. Canvas overlay colours the 2D room map in red/orange/green.
- **2024 frontier models** — DUSt3R (NAVER, 2024), YOLO-World (open-vocab, 2024), Depth Anything v2 (2024 SOTA monocular depth). No retraining for new object categories.
- **format engineering** — custom GLB/glTF 2.0 binary encoder, custom PLY→antimatter15 `.splat` converter with logit opacity / log-scale / SH-DC coefficient correction.
- **5 versioned prompt files** — `spatial_qa_v2.txt`, `spatial_diff_v1.txt`, `spatial_report_v1.txt`, `spatial_search_v1.txt`. Domain-specific prompts, not generic assistants.

---

## Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Backend | FastAPI + uvicorn | 0.111.1 / 0.29.0 |
| Data validation | Pydantic v2 | 2.10.3 |
| Language | Python | 3.12 |
| LLM (primary) | Claude claude-sonnet-5 | Anthropic SDK 0.40.0 |
| LLM (fallback 1) | Groq llama-3.1-8b-instant | groq 0.13.0 |
| LLM (fallback 2) | Gemini 1.5 Flash | google-generativeai |
| LLM (fallback 3) | OpenAI GPT-3.5 Turbo | openai |
| LLM (fallback 4) | Ollama llama3.2 | self-hosted, no key |
| 3D reconstruction (fast) | DUSt3R | NAVER Labs 2024, ~30s |
| 3D reconstruction (full) | COLMAP + gsplat | pycolmap ≥ 0.6.1, gsplat ≥ 1.5.3 |
| Object detection | YOLO-World | yolov8s-worldv2.pt, open-vocabulary |
| Monocular depth | Depth Anything v2 Small | transformers ≥ 4.40.0 |
| Frontend | React 19 + TypeScript | 19.2.7 / ~6.0.2 |
| Build tool | Vite | ^8.1.1 |
| Animations | Framer Motion | ^12.43.0 |
| Linter | oxlint (Rust) | ^1.71.0 |
| 3D viewer | Custom WebGL2 GLSL | 700-line inline renderer |
| 2D room map | Canvas 2D | custom with zoom/pan/diff overlay |
| Streaming | Server-Sent Events | /api/stream/query |

---

## Quick Start — DEMO_MODE (no GPU, no API keys required)

```bash
git clone https://github.com/chandrukumar-AIML/SpazIntel
cd SpazIntel
cp .env.example .env        # DEMO_MODE=true already set
pip install -r backend/requirements.txt
cd backend && uvicorn main:app --reload
```

In a second terminal:
```bash
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173` — click **Try demo scan** to see the factory floor digital twin with pre-built scene graph, room map, and Q&A.

> DEMO_MODE loads a pre-built factory floor scene graph. No GPU, no API keys, no COLMAP needed. The full 3D Gaussian Splat pipeline requires a CUDA GPU (see GPU Setup).

---

## GPU Setup — Full 3D Pipeline

Requires NVIDIA GPU with CUDA 11.8+.

```bash
# 1. Install PyTorch with CUDA
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# 2. Install gsplat
pip install gsplat

# 3. Set DEMO_MODE=false in .env
```

Recommended GPU options:
- **Local**: RTX 3060+ (4GB+ VRAM). RTX 4050 Laptop is the development machine.
- **Cloud (no local GPU)**: RunPod, Lambda Labs, or Google Colab (see `docs/colab_gsplat_train.ipynb`).
- **Railway**: Free tier has no GPU — runs DEMO_MODE. GPU add-on available separately.

COLMAP must be installed and its path set in `.env`:
```bash
COLMAP_EXE=C:/path/to/colmap.exe    # Windows
# COLMAP_EXE=/usr/local/bin/colmap  # Linux
```

DUSt3R (fast 3D path, optional):
```bash
git clone --recursive https://github.com/naver/dust3r $DUST3R_DIR
cd $DUST3R_DIR && pip install -r requirements.txt
```

---

## LLM Configuration

SpazIntel uses a 5-provider fallback chain. Set whichever keys you have — the chain falls through automatically:

```env
# Primary: Claude (best spatial reasoning)
ANTHROPIC_API_KEY=sk-ant-...          # console.anthropic.com

# Fallback 1: Groq free tier
GROQ_API_KEY=gsk_...                  # console.groq.com

# Fallback 2: Gemini
GEMINI_API_KEY=AIza...                # aistudio.google.com

# Fallback 3: OpenAI
OPENAI_API_KEY=sk-...                 # platform.openai.com

# Fallback 4: Ollama (local, no key, free forever)
OLLAMA_BASE_URL=http://localhost:11434
# ollama pull llama3.2
```

Leave all blank: DEMO_MODE returns a canned spatial response with no external calls.

---

## Use Cases — India B2B

| Industry | Use Case | Value |
|---|---|---|
| **Manufacturing** | Factory floor digital twin — track machine positions, safety equipment, tool locations | Reduce equipment search time, verify safety compliance remotely |
| **Warehousing** | Inventory spatial mapping — where is each SKU stored, has layout changed? | Faster pick-and-pack, detect unauthorised layout changes |
| **Real Estate** | Automated property scanning — room dimensions, object inventory, before/after comparison | Virtual walkthroughs with metric data, handover documentation |
| **Retail** | Planogram compliance — verify shelf layout matches planogram, detect what moved | Remote compliance audit without store visits |
| **Construction** | Progress tracking — compare site scan week-by-week, detect what changed | Automated site inspection reports |

---

## API Reference

All routes are JSON unless noted.

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/health/keys` | Which LLM providers are active |
| GET | `/api/stream/query?scan_id=&question=` | SSE streaming Q&A (token by token) |
| POST | `/api/spatial/upload` | Upload video or images, start background pipeline |
| GET | `/api/spatial/job/{scan_id}` | Pipeline status and progress |
| GET | `/api/scans` | List all scans, newest first |
| POST | `/api/spatial/action` | All spatial actions (see below) |
| GET | `/api/spatial/splat/{scan_id}` | Serve `.splat` binary for WebGL2 viewer |
| GET | `/api/spatial/pointcloud/{scan_id}` | Serve point cloud PLY |
| GET | `/api/spatial/floor_plan/{scan_id}` | Generate SVG floor plan |
| GET | `/api/spatial/export/{scan_id}` | Download scan as ZIP |
| GET | `/api/spatial/export/{scan_id}/obj` | Export as OBJ (point cloud) |
| GET | `/api/spatial/export/{scan_id}/gltf` | Export as GLB (glTF 2.0 binary) |
| WS | `/ws/live/{session_id}` | Real-time WebSocket object detection (JPEG → JSON) |

**POST /api/spatial/action — actions:**

| Action | Payload | Description |
|---|---|---|
| `query` | `{scan_id, question}` | LLM Q&A grounded on scene graph |
| `diff` | `{scan_id_a, scan_id_b}` | Change detection between two scans |
| `measure` | `{scan_id, label_a, label_b}` | Distance between two objects |
| `scene_graph` | `{scan_id}` | Return full scene graph JSON |
| `report` | `{scan_id, regen?}` | Generate AI spatial report |
| `search` | `{query}` | Cross-scan semantic search |
| `rename` | `{scan_id, name}` | Set human-readable scan name |
| `delete` | `{scan_id}` | Remove scan from disk |
| `status` | `{scan_id?}` | Scan status or system mode |

---

## Known Limitations

- **Depth scale**: monocular depth is relative. `ROOM_DEPTH_METRES` (default 5.0m) sets the far-plane scale. Override with your room's actual depth for more accurate distances.
- **Camera FOV**: `VFOV_DEG` (default 75°) should match your camera. iPhone 13/14/15 wide ≈ 77°, Android varies 60–80°, webcams ≈ 55°. A wrong FOV shifts all world X/Y coordinates.
- **Duplicate object deduplication**: change detection deduplicates objects by label. Two chairs in the same room collapse to one in the diff report (known limitation, planned fix: label + position clustering).
- **GPU required for full pipeline**: DUSt3R and gsplat training require CUDA. Railway/Vercel free tiers run DEMO_MODE only.
- **Distance accuracy**: all distances are approximate monocular estimates. COLMAP metric reconstruction (requires calibrated camera) gives true metric accuracy.

---

## Project Structure

```
spazintel/
├── engines/rce/          Reality Capture Engine (self-contained, no backend dependency)
│   ├── capture.py        video → frames
│   ├── reconstruct.py    COLMAP + gsplat training loop (Adam, rasterization, PLY export)
│   ├── reconstruct_fast.py  DUSt3R fast path (~30s)
│   ├── detect.py         YOLO-World open-vocabulary object detection
│   ├── depth.py          Depth Anything v2 monocular depth
│   ├── scene_graph.py    detections + depth → 3D scene graph JSON
│   ├── diff.py           change detection between two scene graphs
│   ├── floor_plan.py     pure Python SVG floor plan generator
│   ├── fix_splat_format.py  logit/log-scale/SH-DC PLY format correction
│   └── live_detect.py    real-time JPEG frame detection (WebSocket)
├── backend/
│   ├── main.py           FastAPI routes
│   ├── spatial_impl.py   action dispatcher + LLM fallback chain
│   ├── pipeline_runner.py  background scan pipeline (threaded)
│   ├── constants.py      no magic strings
│   ├── models.py         Pydantic schemas
│   ├── prompts/          versioned prompt files (v1/v2)
│   └── utils/validators.py  scan_id path traversal validation
├── frontend/src/
│   ├── components/SplatViewer.tsx    custom WebGL2 Gaussian Splat renderer
│   ├── components/RoomMap.tsx        Canvas 2D room map + diff overlay
│   ├── components/ChatPanel.tsx      SSE streaming Q&A
│   ├── components/DiffPanel.tsx      change detection UI
│   └── components/FloorPlanView.tsx  SVG floor plan viewer
├── data/scans/           scan outputs (gitignored)
├── docs/                 architecture + Colab gsplat notebook
└── qa/qa_rce_full.py     integration test suite
```
