# ROADMAP.md — Project Atlas

## Current Milestone: Phase 0 — Foundation (Week 1)

### Tasks
- [ ] Repo initialized, folder structure created
- [ ] CLAUDE.md, ARCHITECTURE.md, ROADMAP.md written
- [ ] CUDA Toolkit 12.1 installed
- [ ] PyTorch reinstalled with CUDA support
- [ ] COLMAP installed (Windows binary)
- [ ] gsplat installed and importable
- [ ] Test video downloaded (sample room video)
- [ ] COLMAP sparse reconstruction runs end-to-end on test video
- [ ] `.env` configured with all required paths

---

## Phase 1 — Core MVP (Weeks 2-6)

### Week 2 — Capture + Reconstruct
- [ ] `engines/rce/capture.py` — video → frames (2 FPS)
- [ ] `engines/rce/reconstruct.py` — COLMAP sparse → gsplat training
- [ ] QA: `qa/qa_rce_full.py` capture + reconstruct tests

### Week 3 — Object Detection
- [ ] `engines/rce/detect.py` — Grounding DINO on extracted frames
- [ ] Depth Anything v2 integration for position estimation
- [ ] QA: detection tests (chair detected, door detected, window detected)

### Week 4 — Scene Graph
- [ ] `engines/rce/scene_graph.py` — build JSON scene graph from detections
- [ ] SQLite schema initialized
- [ ] QA: scene graph structure validation

### Week 5 — Backend + LLM Q&A
- [ ] `backend/main.py` — FastAPI dispatcher
- [ ] `backend/spatial_impl.py` — scan / query / diff actions
- [ ] `backend/prompts/spatial_qa_v1.txt` — domain-specific spatial Q&A prompt
- [ ] LLM fallback chain: Claude → Groq → local
- [ ] Demo Mode: DEMO_MODE=true returns canned scene graph
- [ ] QA: Q&A tests ("where is the chair?", "how many doors?")

### Week 6 — Change Detection + Full Pipeline Test
- [ ] `engines/rce/diff.py` — diff two scene graphs
- [ ] End-to-end pipeline test: scan A → scan B → diff report
- [ ] QA: full qa_rce_full.py passes (all features)
- [ ] Commit: `feat(rce): complete Phase 1 pipeline`

---

## Phase 2 — Polish & Demo (Weeks 7-8)

- [ ] `frontend/app.py` — Streamlit: 3D viewer + chat interface
- [ ] GitHub repo public, README.md written
- [ ] 2-minute demo video recorded
- [ ] Railway backend deploy
- [ ] Vercel frontend deploy
- [ ] Smoke test: live URL → video → Q&A works
- [ ] CHANGELOG.md entry for v0.1.0
- [ ] Tag: `git tag v0.1.0`

---

## Phase 3 — Multi-Room (Months 3-4) [FUTURE]

- [ ] Multi-room stitching
- [ ] Persistent spatial memory (PostgreSQL + PostGIS)
- [ ] Cross-room object tracking

## Phase 4 — Enterprise (Months 5-7) [FUTURE]

- [ ] REST API v1 (public endpoints)
- [ ] Role-based access control (JWT multi-tenant)
- [ ] CAD/BIM export (OpenUSD, glTF)
- [ ] Dashboard for facility managers

## Phase 5 — Platform (Months 8-12) [FUTURE]

- [ ] Pluggable capture sources (Matterport/Polycam exports)
- [ ] SDK: Python + REST

## Phase 6 — Vision (Year 2+) [EXPLORATORY]

- [ ] Multi-user shared spatial sessions
- [ ] Avatar-based remote presence
- [ ] Holographic communication (Iron Man-level — not committed)

---

## Feature Tier Tracking

| Tier | Count | Status |
|---|---|---|
| Tier 1 — MVP must-have | 6 features | Phase 0-1 |
| Tier 2 — High priority | 4 features | Phase 2-3 |
| Tier 3 — Enterprise | 5 features | Phase 4-5 |
| Tier 4 — Vision/exploratory | 3 features | Phase 6 |
