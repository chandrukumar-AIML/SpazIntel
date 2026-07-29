"""
Background scan pipeline: upload → frames → YOLO detect → scene graph
Runs in a daemon thread so FastAPI stays non-blocking.
"""
import json
import logging
import shutil
import sys
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# scan_id → { status, step, frames_count, objects_found, error }
_jobs: dict[str, dict] = {}

# Load engine modules once
_engines_dir = Path(__file__).parent.parent / "engines"
if str(_engines_dir) not in sys.path:
    sys.path.insert(0, str(_engines_dir))


def start(scan_id: str, upload_dir: Path, scan_dir: Path, is_video: bool) -> None:
    _jobs[scan_id] = {
        "status": "queued",
        "step": "Queued",
        "frames_count": 0,
        "objects_found": 0,
        "error": None,
    }
    t = threading.Thread(
        target=_run,
        args=(scan_id, upload_dir, scan_dir, is_video),
        daemon=True,
    )
    t.start()


def get(scan_id: str) -> dict | None:
    return _jobs.get(scan_id)


def _set(scan_id: str, **kwargs) -> None:
    _jobs[scan_id].update(kwargs)


def _run(scan_id: str, upload_dir: Path, scan_dir: Path, is_video: bool) -> None:
    try:
        from rce.capture import extract_frames
        from rce.detect import detect_objects
        from rce.scene_graph import build_scene_graph

        frames_dir = scan_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        # Step 1 — frames
        _set(scan_id, status="extracting", step="Extracting frames…")
        if is_video:
            video_path = next(upload_dir.iterdir())
            frames = extract_frames(str(video_path), str(frames_dir))
        else:
            # Images → copy into frames dir in sorted order
            for img in sorted(upload_dir.iterdir()):
                shutil.copy(img, frames_dir / img.name)
            frames = [str(f) for f in sorted(frames_dir.iterdir())]

        _set(scan_id, frames_count=len(frames))
        logger.info("scan_id=%s frames=%d", scan_id, len(frames))

        # Step 2 — object detection (slowest — YOLO-World on CPU)
        _set(scan_id, status="detecting", step="Detecting objects…")
        detections_dir = scan_dir / "detections"
        detections = detect_objects(str(frames_dir), str(detections_dir))
        logger.info("scan_id=%s detections=%d", scan_id, len(detections))

        # Step 3 — scene graph
        _set(scan_id, status="building_graph", step="Building scene graph…")
        graph = build_scene_graph(detections, scan_id=scan_id, location_id="uploaded")
        (scan_dir / "scene_graph.json").write_text(json.dumps(graph, indent=2))

        obj_count = len(graph.get("objects", []))
        _set(scan_id, status="complete", step="Complete", objects_found=obj_count)
        logger.info("scan_id=%s complete objects=%d", scan_id, obj_count)

    except Exception as e:
        logger.error("scan_id=%s pipeline error: %s", scan_id, e, exc_info=True)
        _set(scan_id, status="error", step="Failed", error=str(e))
