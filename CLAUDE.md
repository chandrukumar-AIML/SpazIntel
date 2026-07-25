# CLAUDE.md — Project Atlas (SIOS Phase 0-2)

> Project-specific Claude Code instructions.
> For methodology, roles, and standards: reference chandru-stack at C:/Users/kumar/chandLab/chandru-stack/CLAUDE.md

---

## What We're Building

**Project Atlas** — Spatial Intelligence Platform (P3)

A pipeline that turns a phone video of a room into a queryable, diffable 3D digital twin.

```
Phone video → COLMAP (poses) → gsplat (3D) → Grounding DINO (objects)
           → Scene Graph (JSON) → LLM Q&A → Change Detection
```

**Core IP:** The AI reasoning layer (semantic Q&A + change detection) on top of 3D captures.
Competitors (Polycam, Matterport, Scaniverse) stop at the 3D model. We don't.

---

## Active Roles for This Project

| Role | When active | Focus |
|---|---|---|
| Backend Engineer | Phase 0-2 | FastAPI dispatcher, spatial_impl.py, Pydantic schemas |
| Applied AI Engineer | Phase 1-2 | LLM Q&A grounded on scene graph, fallback chain |
| Prompt Engineer | Phase 1 | Spatial Q&A prompt, change-detection prompt |
| QA Engineer | Ongoing | qa/qa_rce_full.py updated as each engine module ships |
| Frontend Engineer | Phase 2 | Streamlit UI (fast) → React+TypeScript (proper) |
| DevOps Engineer | Phase 2 | Railway + Vercel deploy after demo is ready |

---

## Tech Decisions for This Project

| Layer | Choice | Why |
|---|---|---|
| 3D Reconstruction | COLMAP + gsplat | Open-source, self-hosted, no API dependency |
| Object Detection | Grounding DINO / YOLO-World | Open-vocab — detects any object without retraining |
| Depth | Depth Anything v2 | Monocular depth, no LiDAR needed |
| Scene Graph | SQLite (MVP) → PostgreSQL + PostGIS (Phase 3+) | Start simple, scale later |
| LLM | Claude claude-sonnet-5 via Anthropic SDK (primary) → open LLM fallback | Grounded on scene graph JSON, not raw pixels |
| Backend | FastAPI + Python 3.12 | Chandru standard (3.12 on this machine, matches) |
| Frontend | Streamlit (Phase 2 MVP) → React + TypeScript (Phase 3+) | Fast demo first |
| GPU | RTX 4050 Laptop (4GB VRAM) | Sufficient for single-room Gaussian Splatting |

---

## Project Structure

```
spazintel/
├── engines/rce/        ← Reality Capture Engine (core)
│   ├── capture.py      ← video → frames
│   ├── reconstruct.py  ← COLMAP + gsplat
│   ├── detect.py       ← Grounding DINO object detection
│   ├── scene_graph.py  ← structured JSON scene graph
│   └── diff.py         ← change detection between scans
├── backend/            ← FastAPI dispatcher
│   ├── main.py
│   ├── spatial_impl.py
│   ├── constants.py
│   └── models.py
├── frontend/           ← Streamlit UI (Phase 2)
├── qa/                 ← QA scripts
├── data/scans/         ← test videos + scan outputs
└── docs/               ← architecture + ADRs
```

---

## Non-Negotiables (from chandru-stack, applied here)

1. **No magic strings** — all action names in `backend/constants.py`
2. **No hardcoded secrets** — ANTHROPIC_API_KEY, COLMAP_PATH, MODELS_DIR via `.env`
3. **Demo Mode** — `DEMO_MODE=true` returns canned scene graph without running GPU pipeline
4. **QA script** — `qa/qa_rce_full.py` updated after every engine module
5. **Domain-specific prompts** — spatial Q&A prompt ≠ generic assistant; stored in `backend/prompts/`
6. **Smoke test** — after every deploy, run: video → Q&A end-to-end on live URL

---

## Engine-First Rule

> Never build an application first. Always build a reusable engine first.

Build order:
1. `engines/rce/` — Reality Capture Engine (self-contained, testable, importable)
2. `backend/` — FastAPI wrapper that calls the engine
3. `frontend/` — UI that calls the backend

The engine must work without the backend. The backend must work without the frontend.

---

## Phase 0 Definition of Done

- [ ] Repo initialized, all folders + files in place
- [ ] CUDA toolkit installed, `torch.cuda.is_available()` returns True
- [ ] COLMAP installed and callable from Python subprocess
- [ ] gsplat installed, can import `gsplat`
- [ ] Test video → COLMAP sparse reconstruction completes without error
- [ ] `.env.example` documents all required env vars
