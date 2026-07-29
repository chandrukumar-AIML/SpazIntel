"""
Stage 4: Detections → Scene Graph
Build a structured JSON scene graph from detection outputs.
"""
import uuid
import logging
from datetime import datetime, timezone
from collections import defaultdict

logger = logging.getLogger(__name__)

# Objects seen in fewer than this many frames are filtered out (noise)
MIN_FRAME_OCCURRENCES = 2


def build_scene_graph(
    detections: list[dict],
    scan_id: str,
    location_id: str = "default",
) -> dict:
    """
    Aggregate detections across frames into a single scene graph.
    Returns the scene graph dict (also the format stored as JSON).
    """
    # Group detections by label, keep highest-confidence per label
    by_label = defaultdict(list)
    for d in detections:
        by_label[d["label"]].append(d)

    objects = []
    structure = {"walls": 0, "doors": [], "windows": []}
    structural_labels = {"door", "window", "wall", "floor", "ceiling"}

    for label, dets in by_label.items():
        if len(dets) < MIN_FRAME_OCCURRENCES:
            continue

        best = max(dets, key=lambda x: x["confidence"])
        obj_id = f"obj_{uuid.uuid4().hex[:6]}"

        obj = {
            "id": obj_id,
            "label": label,
            "confidence": best["confidence"],
            "bbox_sample": best["bbox"],
            "seen_in_frames": len(dets),
            "position": _estimate_position(dets),
        }

        if label == "door":
            structure["doors"].append({"id": obj_id})
        elif label == "window":
            structure["windows"].append({"id": obj_id})
        elif label == "wall":
            structure["walls"] += 1
        elif label not in structural_labels:
            objects.append(obj)

    graph = {
        "scan_id": scan_id,
        "location_id": location_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "objects": objects,
        "structure": structure,
        "object_count": len(objects),
    }

    logger.info("scene graph built: %d objects, %d doors, %d windows",
                len(objects), len(structure["doors"]), len(structure["windows"]))
    return graph


def _estimate_position(dets: list[dict]) -> dict:
    """
    2D centroid from bbox pixel coords + z_m from Depth Anything v2 if present.
    Falls back to None for z_m when depth enrichment hasn't run.
    Assumes 1920x1080 source frames (capture.py extracts at original resolution).
    """
    IMG_W, IMG_H = 1920.0, 1080.0
    xs = [((d["bbox"][0] + d["bbox"][2]) / 2) / IMG_W for d in dets]
    ys = [((d["bbox"][1] + d["bbox"][3]) / 2) / IMG_H for d in dets]

    z_vals = [d["z_m"] for d in dets if d.get("z_m") is not None]
    z_m = round(sum(z_vals) / len(z_vals), 2) if z_vals else None

    return {
        "x_norm": round(sum(xs) / len(xs), 3),
        "y_norm": round(sum(ys) / len(ys), 3),
        "z_m": z_m,
    }
