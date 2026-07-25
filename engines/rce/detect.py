"""
Stage 3: Frames → Object Detections
Grounding DINO open-vocabulary detection on extracted frames.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Default prompts — covers common room objects
DEFAULT_PROMPTS = [
    "chair", "table", "desk", "sofa", "bed",
    "door", "window", "wall", "floor", "ceiling",
    "laptop", "monitor", "keyboard", "lamp", "shelf",
    "cabinet", "tv", "refrigerator", "microwave", "person"
]

_model = None
_processor = None


def detect_objects(
    frames_dir: str,
    output_dir: str,
    prompts: list[str] | None = None,
    confidence_threshold: float = 0.35,
) -> list[dict]:
    """
    Run Grounding DINO on all frames.
    Returns list of {label, bbox, confidence, frame_id, frame_path}.
    """
    if prompts is None:
        prompts = DEFAULT_PROMPTS

    frames_dir = Path(frames_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frame_paths = sorted(frames_dir.glob("*.jpg"))
    if not frame_paths:
        raise RuntimeError(f"No frames found in {frames_dir}")

    model, processor = _load_model()
    all_detections = []

    for frame_path in frame_paths:
        dets = _detect_frame(frame_path, model, processor, prompts, confidence_threshold)
        for d in dets:
            d["frame_id"] = frame_path.stem
            d["frame_path"] = str(frame_path)
        all_detections.extend(dets)

    logger.info("detected %d objects across %d frames", len(all_detections), len(frame_paths))
    return all_detections


def _load_model():
    global _model, _processor
    if _model is None:
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model_id = "IDEA-Research/grounding-dino-base"
        _processor = AutoProcessor.from_pretrained(model_id)
        _model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id).to(device)
        logger.info("Grounding DINO loaded on %s", device)
    return _model, _processor


def _detect_frame(frame_path: Path, model, processor, prompts: list[str], threshold: float) -> list[dict]:
    from PIL import Image
    import torch
    device = next(model.parameters()).device

    image = Image.open(frame_path).convert("RGB")
    text_prompt = " . ".join(prompts) + " ."

    inputs = processor(images=image, text=text_prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model(**inputs)

    results = processor.post_process_grounded_object_detection(
        outputs,
        inputs.input_ids,
        box_threshold=threshold,
        text_threshold=threshold,
        target_sizes=[image.size[::-1]],
    )[0]

    detections = []
    for score, label, box in zip(results["scores"], results["labels"], results["boxes"]):
        detections.append({
            "label": label,
            "confidence": round(float(score), 3),
            "bbox": [round(float(v), 1) for v in box.tolist()],  # [x1, y1, x2, y2]
        })
    return detections
