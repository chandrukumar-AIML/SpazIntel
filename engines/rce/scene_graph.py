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
    Rough 2D centroid from bbox detections (normalized 0-1).
    Phase 1 approximation — replaced with Depth Anything v2 in Week 3.
    """
    xs = [(d["bbox"][0] + d["bbox"][2]) / 2 for d in dets]
    ys = [(d["bbox"][1] + d["bbox"][3]) / 2 for d in dets]
    return {
        "x_norm": round(sum(xs) / len(xs), 3),
        "y_norm": round(sum(ys) / len(ys), 3),
        "z_m": None,  # populated by Depth Anything v2 (Week 3)
    }
