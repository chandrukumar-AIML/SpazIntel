"""
Depth Anything v2 — monocular depth estimation per frame.
Adds real z_m (metres) to each detected object using depth maps.

Model auto-downloads on first run (~400MB for Small, ~1.3GB for Large).
Runs on RTX 4050 GPU (CUDA) or CPU fallback.
"""
import logging
import numpy as np
from pathlib import Path

logger = logging.getLogger(__name__)

# Model size: "Small" is fast enough and accurate for single rooms
DEPTH_MODEL_SIZE = "Small"

_depth_pipe = None


def load_depth_model():
    """Load Depth Anything v2 pipeline (singleton — call once at startup)."""
    global _depth_pipe
    if _depth_pipe is not None:
        return _depth_pipe

    from transformers import pipeline
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading Depth Anything v2 (%s) on %s", DEPTH_MODEL_SIZE, device)

    _depth_pipe = pipeline(
        task="depth-estimation",
        model=f"depth-anything/Depth-Anything-V2-{DEPTH_MODEL_SIZE}-hf",
        device=device,
    )
    logger.info("Depth Anything v2 loaded on %s", device)
    return _depth_pipe


def estimate_depth_frame(frame_path: str, pipe=None) -> np.ndarray:
    """
    Run depth estimation on a single frame.
    Returns a (H, W) float32 array with relative depth values (0=far, 1=near).
    """
    from PIL import Image

    if pipe is None:
        pipe = load_depth_model()

    img = Image.open(frame_path).convert("RGB")
    result = pipe(img)
    depth = np.array(result["depth"], dtype=np.float32)

    # Normalise to [0, 1]
    d_min, d_max = depth.min(), depth.max()
    if d_max > d_min:
        depth = (depth - d_min) / (d_max - d_min)

    return depth


def bbox_depth(depth_map: np.ndarray, bbox: list[float]) -> float:
    """
    Get median depth value inside a bounding box.
    bbox = [x1, y1, x2, y2] in pixel coordinates at original image resolution.
    depth_map may be at a different (smaller) resolution — we normalise.
    Returns value in [0, 1] where 1=closest to camera.
    """
    h, w = depth_map.shape
    img_w, img_h = 1920.0, 1080.0  # capture.py target resolution

    x1 = int(bbox[0] / img_w * w)
    y1 = int(bbox[1] / img_h * h)
    x2 = int(bbox[2] / img_w * w)
    y2 = int(bbox[3] / img_h * h)

    x1, x2 = max(0, x1), min(w, x2)
    y1, y2 = max(0, y1), min(h, y2)

    if x2 <= x1 or y2 <= y1:
        return float(np.mean(depth_map))

    region = depth_map[y1:y2, x1:x2]
    return float(np.median(region))


import os
ROOM_DEPTH_METRES = float(os.getenv("ROOM_DEPTH_METRES", "5.0"))


def depth_to_metres(normalised_depth: float) -> float:
    """
    Convert normalised depth [0..1] to approximate metres.
    1 = closest (camera), 0 = farthest.
    Linear mapping: 0 → ROOM_DEPTH_METRES, 1 → 0.3m (minimum)
    """
    near = 0.3
    far = ROOM_DEPTH_METRES
    return round(near + (1.0 - normalised_depth) * (far - near), 2)


def enrich_detections_with_depth(
    detections: list[dict],
    frames_dir: str,
    pipe=None,
) -> list[dict]:
    """
    Add 'z_m' to each detection by running depth estimation on its frame.
    Operates in-place (also returns the list).

    detections: list of dicts from detect.py, each has frame_path and bbox.
    """
    if not detections:
        return detections

    if pipe is None:
        pipe = load_depth_model()

    # Build per-frame depth maps (one per unique frame, not one per detection)
    frames_seen: dict[str, np.ndarray] = {}
    enriched = 0

    for det in detections:
        frame_path = det.get("frame_path", "")
        if not frame_path or not Path(frame_path).exists():
            det["z_m"] = None
            continue

        if frame_path not in frames_seen:
            try:
                frames_seen[frame_path] = estimate_depth_frame(frame_path, pipe)
            except Exception as e:
                logger.warning("depth failed for %s: %s", frame_path, e)
                frames_seen[frame_path] = None

        depth_map = frames_seen[frame_path]
        if depth_map is None:
            det["z_m"] = None
            continue

        norm_depth = bbox_depth(depth_map, det["bbox"])
        det["z_m"] = depth_to_metres(norm_depth)
        enriched += 1

    logger.info("depth enriched %d/%d detections across %d frames",
                enriched, len(detections), len(frames_seen))
    return detections
