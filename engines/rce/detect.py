"""
Stage 3: Frames → Object Detections
YOLO-World open-vocabulary detection on extracted frames.
Model auto-downloads on first run (~100MB).
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_PROMPTS = [
    "chair", "table", "desk", "sofa", "bed",
    "door", "window", "lamp", "shelf", "cabinet",
    "laptop", "monitor", "keyboard", "tv", "refrigerator",
    "microwave", "plant", "picture frame", "couch", "pillow"
]

_model = None


def detect_objects(
    frames_dir: str,
    output_dir: str,
    prompts: list[str] | None = None,
    confidence_threshold: float = 0.25,
) -> list[dict]:
    """
    Run YOLO-World on all frames.
    Returns list of {label, bbox, confidence, frame_id, frame_path}.
    """
    if prompts is None:
        prompts = DEFAULT_PROMPTS

    frames_dir = Path(frames_dir)
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    frame_paths = sorted(frames_dir.glob("*.jpg"))
    if not frame_paths:
        raise RuntimeError(f"No frames found in {frames_dir}")

    model = _load_model(prompts)
    all_detections = []

    for frame_path in frame_paths:
        dets = _detect_frame(frame_path, model, confidence_threshold)
        for d in dets:
            d["frame_id"] = frame_path.stem
            d["frame_path"] = str(frame_path)
        all_detections.extend(dets)
        if len(all_detections) % 50 == 0 and all_detections:
            logger.debug("detected %d objects so far...", len(all_detections))

    logger.info("detected %d objects across %d frames", len(all_detections), len(frame_paths))
    return all_detections


def _load_model(prompts: list[str]):
    from ultralytics import YOLOWorld
    model = YOLOWorld("yolov8s-worldv2.pt")  # auto-downloads ~100MB on first run
    model.set_classes(prompts)
    logger.info("YOLO-World loaded, classes: %s", prompts[:5])
    return model


def _detect_frame(frame_path: Path, model, threshold: float) -> list[dict]:
    results = model.predict(str(frame_path), conf=threshold, verbose=False)
    detections = []
    for r in results:
        for box in r.boxes:
            label = model.names[int(box.cls)]
            detections.append({
                "label": label,
                "confidence": round(float(box.conf), 3),
                "bbox": [round(float(v), 1) for v in box.xyxy[0].tolist()],
            })
    return detections
