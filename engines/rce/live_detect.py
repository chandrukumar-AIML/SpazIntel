"""
Live per-frame detection + depth for WebSocket streaming.
Reuses YOLO-World and Depth Anything singletons — no reload between frames.
"""
import io
import logging
import numpy as np

logger = logging.getLogger(__name__)


def process_live_frame(jpeg_bytes: bytes) -> list[dict]:
    """
    Input : raw JPEG bytes from browser camera
    Output: [{label, confidence, x_norm, y_norm, z_m, bbox}]
    """
    from PIL import Image
    from rce.detect import _load_model, DEFAULT_PROMPTS
    from rce.depth import load_depth_model, depth_to_metres

    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    img_w, img_h = img.size

    # ── YOLO-World detection ────────────────────────────────────────────────
    model = _load_model(DEFAULT_PROMPTS)
    results = model.predict(img, conf=0.30, verbose=False)

    detections: list[dict] = []
    for r in results:
        for box in r.boxes:
            label = model.names[int(box.cls)]
            bbox  = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            cx    = (bbox[0] + bbox[2]) / 2
            cy    = (bbox[1] + bbox[3]) / 2
            detections.append({
                "label":      label,
                "confidence": round(float(box.conf), 3),
                "bbox":       bbox,
                "x_norm":     round(cx / img_w, 3),
                "y_norm":     round(cy / img_h, 3),
                "z_m":        None,
            })

    if not detections:
        return detections

    # ── Depth Anything v2 (optional, fails gracefully) ─────────────────────
    try:
        pipe      = load_depth_model()
        result    = pipe(img)
        depth_map = np.array(result["depth"], dtype=np.float32)
        d_min, d_max = depth_map.min(), depth_map.max()
        if d_max > d_min:
            depth_map = (depth_map - d_min) / (d_max - d_min)

        h, w = depth_map.shape
        for det in detections:
            x1 = int(det["bbox"][0] / img_w * w); y1 = int(det["bbox"][1] / img_h * h)
            x2 = int(det["bbox"][2] / img_w * w); y2 = int(det["bbox"][3] / img_h * h)
            x1, x2 = max(0, x1), min(w, x2)
            y1, y2 = max(0, y1), min(h, y2)
            if x2 > x1 and y2 > y1:
                det["z_m"] = depth_to_metres(float(np.median(depth_map[y1:y2, x1:x2])))
    except Exception as e:
        logger.warning("live depth skipped: %s", e)

    return detections
