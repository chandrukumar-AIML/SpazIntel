"""
Stage 4: Detections → Scene Graph
Build a structured JSON scene graph from detection outputs.
Sprint 2: adds world_x_m / world_y_m, pairwise distances, room size estimate.
"""
import math
import uuid
import logging
from datetime import datetime, timezone
from collections import defaultdict

import os

logger = logging.getLogger(__name__)

MIN_FRAME_OCCURRENCES = 2

# Camera vertical FOV — override via VFOV_DEG env var
# iPhone 13/14/15 wide: ~77°, Android varies: 60-80°, webcam: ~55°
_VFOV_DEG = float(os.getenv("VFOV_DEG", "75.0"))
_ASPECT    = 1920 / 1080  # 16:9


def build_scene_graph(
    detections: list[dict],
    scan_id: str,
    location_id: str = "default",
) -> dict:
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

        pos = _estimate_position(dets)

        obj = {
            "id":           obj_id,
            "label":        label,
            "confidence":   best["confidence"],
            "bbox_sample":  best["bbox"],
            "seen_in_frames": len(dets),
            "position":     pos,
        }

        if label == "door":
            structure["doors"].append({"id": obj_id})
        elif label == "window":
            structure["windows"].append({"id": obj_id})
        elif label == "wall":
            structure["walls"] += 1
        elif label not in structural_labels:
            objects.append(obj)

    # Sprint 2: metric enrichment
    _enrich_world_positions(objects)
    distances = _compute_distances(objects)
    room_size = _estimate_room_size(objects)

    graph = {
        "scan_id":      scan_id,
        "location_id":  location_id,
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "objects":      objects,
        "structure":    structure,
        "object_count": len(objects),
        "distances":    distances,
        "room_size":    room_size,
    }

    logger.info("scene graph: %d objects, room ~%.1fm×%.1fm, %d distance pairs",
                len(objects), room_size.get("width_m", 0), room_size.get("depth_m", 0), len(distances))
    return graph


# ── position estimation ───────────────────────────────────────────────────────

def _estimate_position(dets: list[dict]) -> dict:
    IMG_W, IMG_H = 1920.0, 1080.0
    xs = [((d["bbox"][0] + d["bbox"][2]) / 2) / IMG_W for d in dets]
    ys = [((d["bbox"][1] + d["bbox"][3]) / 2) / IMG_H for d in dets]

    z_vals = [d["z_m"] for d in dets if d.get("z_m") is not None]
    z_m    = round(sum(z_vals) / len(z_vals), 2) if z_vals else None

    return {
        "x_norm": round(sum(xs) / len(xs), 3),
        "y_norm": round(sum(ys) / len(ys), 3),
        "z_m":    z_m,
    }


# ── world coordinate projection ───────────────────────────────────────────────

def _project_to_world(x_norm: float, y_norm: float, z_m: float) -> tuple[float, float]:
    """
    Project normalised 2D image position + depth to camera-space XY in metres.
    X = horizontal (left < 0 < right), Y = vertical (down < 0 < up).
    """
    fov_v = math.radians(_VFOV_DEG)
    fov_h = 2 * math.atan(math.tan(fov_v / 2) * _ASPECT)
    wx = (x_norm - 0.5) * z_m * 2 * math.tan(fov_h / 2)
    wy = (0.5 - y_norm) * z_m * 2 * math.tan(fov_v / 2)
    return round(wx, 2), round(wy, 2)


def _enrich_world_positions(objects: list[dict]) -> None:
    """Add world_x_m / world_y_m to each object in-place."""
    for obj in objects:
        pos = obj["position"]
        if pos.get("z_m") is not None:
            wx, wy = _project_to_world(pos["x_norm"], pos["y_norm"], pos["z_m"])
            obj["world_x_m"] = wx
            obj["world_y_m"] = wy
        else:
            obj["world_x_m"] = None
            obj["world_y_m"] = None


# ── distances ─────────────────────────────────────────────────────────────────

def _dist_3d(a: dict, b: dict) -> float | None:
    ax, ay = a.get("world_x_m"), a.get("world_y_m")
    bx, by = b.get("world_x_m"), b.get("world_y_m")
    az = a["position"].get("z_m")
    bz = b["position"].get("z_m")
    if None in (ax, ay, bx, by, az, bz):
        return None
    return round(math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2), 2)


def _compute_distances(objects: list[dict]) -> list[dict]:
    """Compute pairwise distances for all object pairs that have world coords."""
    pairs = []
    for i, a in enumerate(objects):
        for b in objects[i + 1:]:
            d = _dist_3d(a, b)
            if d is not None:
                pairs.append({
                    "from":       a["label"],
                    "to":         b["label"],
                    "distance_m": d,
                })
    pairs.sort(key=lambda x: x["distance_m"])
    return pairs


# ── room size ─────────────────────────────────────────────────────────────────

def _estimate_room_size(objects: list[dict]) -> dict:
    """
    Estimate room footprint from the spread of object world positions.
    Returns {width_m, depth_m} or {} if not enough depth data.
    """
    xs = [o["world_x_m"] for o in objects if o.get("world_x_m") is not None]
    zs = [o["position"]["z_m"] for o in objects if o["position"].get("z_m") is not None]

    if len(xs) < 2 or len(zs) < 2:
        return {}

    width = round(max(xs) - min(xs) + 1.0, 1)   # +1m margin
    depth = round(max(zs) + 0.5, 1)              # max depth + 0.5m wall allowance
    return {"width_m": width, "depth_m": depth}
