"""
Background scan pipeline: upload → frames → depth → detect → COLMAP → gsplat → scene graph
Runs in a daemon thread so FastAPI stays non-blocking.

Steps and status progression:
  queued → extracting → depth → detecting → colmap → splat → building_graph → complete
"""
import json
import logging
import os
import shutil
import sys
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# scan_id → { status, step, frames_count, objects_found, error, has_splat }
_jobs: dict[str, dict] = {}

# Engine path — file-relative so it works regardless of CWD
_engines_dir = Path(__file__).parent.parent / "engines"
if str(_engines_dir) not in sys.path:
    sys.path.insert(0, str(_engines_dir))

# Feature flags via env vars
_SKIP_DEPTH   = os.getenv("SKIP_DEPTH",  "false").lower() == "true"
_SKIP_COLMAP  = os.getenv("SKIP_COLMAP", "false").lower() == "true"
_SKIP_SPLAT   = os.getenv("SKIP_SPLAT",  "false").lower() == "true"
_SPLAT_STEPS  = int(os.getenv("SPLAT_STEPS", "3000"))


def start(scan_id: str, upload_dir: Path, scan_dir: Path, is_video: bool, mode: str = "room") -> None:
    _jobs[scan_id] = {
        "status": "queued",
        "step": "Queued",
        "frames_count": 0,
        "objects_found": 0,
        "has_splat": False,
        "has_pointcloud": False,
        "error": None,
        "mode": mode,
    }
    t = threading.Thread(
        target=_run,
        args=(scan_id, upload_dir, scan_dir, is_video, mode),
        daemon=True,
    )
    t.start()


def get(scan_id: str) -> dict | None:
    return _jobs.get(scan_id)


def _set(scan_id: str, **kwargs) -> None:
    _jobs[scan_id].update(kwargs)


def _run(scan_id: str, upload_dir: Path, scan_dir: Path, is_video: bool, mode: str = "room") -> None:
    # Object mode: faster settings — fewer gsplat steps, lower frame minimum for COLMAP
    splat_steps   = 1500 if mode == "object" else _SPLAT_STEPS
    colmap_min_frames = 4 if mode == "object" else 8
    try:
        from rce.capture import extract_frames
        from rce.detect import detect_objects
        from rce.scene_graph import build_scene_graph

        frames_dir = scan_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        # ── Step 1: extract frames ──────────────────────────────────────────
        _set(scan_id, status="extracting", step="Extracting frames…")
        if is_video:
            video_path = next(upload_dir.iterdir())
            frames = extract_frames(str(video_path), str(frames_dir))
        else:
            for img in sorted(upload_dir.iterdir()):
                shutil.copy(img, frames_dir / img.name)
            frames = [str(f) for f in sorted(frames_dir.iterdir())]

        _set(scan_id, frames_count=len(frames))
        logger.info("scan_id=%s frames=%d", scan_id, len(frames))

        # ── Step 2: Fast 3D preview (DUSt3R, if installed) ────────────────
        try:
            from rce.reconstruct_fast import run_fast_reconstruction, dust3r_available
            if dust3r_available():
                _set(scan_id, status="fast_3d", step="Fast 3D preview (DUSt3R)… ~30s")
                pc_dir = scan_dir / "pointcloud"
                # Use up to 12 representative frames for DUSt3R
                sample = frames[::max(1, len(frames) // 12)][:12]
                pc_result = run_fast_reconstruction(sample, str(pc_dir))
                if pc_result.get("ply_path"):
                    _set(scan_id, has_pointcloud=True)
                    logger.info("scan_id=%s fast_3d done: %d pts (DUSt3R)", scan_id, pc_result["point_count"])
        except Exception as e:
            logger.warning("scan_id=%s fast_3d failed: %s — continuing", scan_id, e)

        # ── Step 3: object detection (runs exactly once) ───────────────────
        detections_dir = scan_dir / "detections"
        detections_dir.mkdir(parents=True, exist_ok=True)

        _set(scan_id, status="detecting", step="Detecting objects…")
        detections = detect_objects(str(frames_dir), str(detections_dir))
        logger.info("scan_id=%s detections=%d", scan_id, len(detections))

        # ── Step 3: depth enrichment (optional, in-place) ──────────────────
        if not _SKIP_DEPTH:
            _set(scan_id, status="depth", step="Estimating depth…")
            try:
                from rce.depth import enrich_detections_with_depth, load_depth_model
                pipe = load_depth_model()
                enrich_detections_with_depth(detections, str(frames_dir), pipe)
                logger.info("scan_id=%s depth enrichment done", scan_id)
            except Exception as e:
                logger.warning("scan_id=%s depth failed (%s) — continuing without depth", scan_id, e)

        logger.info("scan_id=%s detections=%d", scan_id, len(detections))

        # ── Step 4: COLMAP structure from motion ─────────────────────────────
        splat_available = False
        if not _SKIP_COLMAP and len(frames) >= colmap_min_frames:
            _set(scan_id, status="colmap", step="Reconstructing 3D structure (COLMAP)…")
            try:
                from rce.reconstruct import run_colmap
                colmap_dir = scan_dir / "colmap"
                colmap_stats = run_colmap(str(frames_dir), str(colmap_dir))
                logger.info("scan_id=%s colmap=%s", scan_id, colmap_stats)

                # ── Step 5: gsplat training ───────────────────────────────
                # COLMAP sparse point cloud fallback (when DUSt3R not installed)
                if not _jobs[scan_id].get("has_pointcloud", False) and colmap_stats.get("points3D", 0) > 50:
                    try:
                        from rce.reconstruct_fast import extract_colmap_pointcloud
                        pc_dir    = scan_dir / "pointcloud"
                        pc_result = extract_colmap_pointcloud(colmap_stats["sparse_dir"], str(pc_dir))
                        if pc_result.get("ply_path"):
                            _set(scan_id, has_pointcloud=True)
                            logger.info("scan_id=%s COLMAP sparse point cloud: %d pts", scan_id, pc_result["point_count"])
                    except Exception as e:
                        logger.warning("scan_id=%s COLMAP point cloud export failed: %s", scan_id, e)

                if not _SKIP_SPLAT and colmap_stats.get("points3D", 0) >= 100:
                    _set(scan_id, status="splat", step=f"Training 3D Gaussian Splat ({splat_steps} steps)…")
                    try:
                        from rce.reconstruct import train_splat
                        splat_dir = scan_dir / "splat"
                        sparse_dir = colmap_stats["sparse_dir"]
                        ply_path = train_splat(
                            str(frames_dir),
                            sparse_dir,
                            str(splat_dir),
                            max_steps=splat_steps,
                        )
                        splat_available = True
                        logger.info("scan_id=%s splat done → %s", scan_id, ply_path)
                    except Exception as e:
                        logger.warning("scan_id=%s gsplat failed (%s) — scan still usable via 2D map", scan_id, e)
                else:
                    logger.info("scan_id=%s skipping gsplat (points3D=%d < 100)", scan_id, colmap_stats.get("points3D", 0))

            except Exception as e:
                logger.warning("scan_id=%s COLMAP failed (%s) — scan still usable via 2D map", scan_id, e)
        else:
            reason = "skipped by env flag" if _SKIP_COLMAP else f"only {len(frames)} frames (need {colmap_min_frames}+)"
            logger.info("scan_id=%s COLMAP skipped: %s", scan_id, reason)

        # ── Step 6: scene graph ───────────────────────────────────────────────
        _set(scan_id, status="building_graph", step="Building scene graph…")
        graph = build_scene_graph(detections, scan_id=scan_id, location_id="uploaded")
        (scan_dir / "scene_graph.json").write_text(json.dumps(graph, indent=2))

        obj_count = len(graph.get("objects", []))
        _set(scan_id,
             status="complete",
             step="Complete",
             objects_found=obj_count,
             has_splat=splat_available)
        logger.info("scan_id=%s complete objects=%d has_splat=%s", scan_id, obj_count, splat_available)

    except Exception as e:
        logger.error("scan_id=%s pipeline error: %s", scan_id, e, exc_info=True)
        _set(scan_id, status="error", step="Failed", error=str(e))
