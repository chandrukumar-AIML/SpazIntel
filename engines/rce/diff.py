"""
Stage 5: Scene Graph A vs B → Change Detection
Compare two scene graphs and return a structured diff report.
"""
import logging

logger = logging.getLogger(__name__)

POSITION_MOVE_THRESHOLD = 0.1  # normalized units — below this = not considered moved


def diff_graphs(graph_a: dict, graph_b: dict) -> dict:
    """
    Compare two scene graphs. Returns {added, removed, moved, unchanged}.
    """
    objs_a = {o["label"]: o for o in graph_a.get("objects", [])}
    objs_b = {o["label"]: o for o in graph_b.get("objects", [])}

    labels_a = set(objs_a.keys())
    labels_b = set(objs_b.keys())

    removed = [objs_a[l] for l in labels_a - labels_b]
    added = [objs_b[l] for l in labels_b - labels_a]
    moved = []
    unchanged = []

    for label in labels_a & labels_b:
        oa = objs_a[label]
        ob = objs_b[label]
        dist = _position_distance(oa.get("position", {}), ob.get("position", {}))
        if dist > POSITION_MOVE_THRESHOLD:
            moved.append({
                "label": label,
                "from": oa.get("position"),
                "to": ob.get("position"),
                "distance": round(dist, 3),
            })
        else:
            unchanged.append(label)

    summary = _summarize(added, removed, moved)

    return {
        "scan_a": graph_a.get("scan_id"),
        "scan_b": graph_b.get("scan_id"),
        "changes": {
            "added": [{"label": o["label"], "position": o.get("position")} for o in added],
            "removed": [{"label": o["label"]} for o in removed],
            "moved": moved,
        },
        "unchanged_count": len(unchanged),
        "summary": summary,
    }


def _position_distance(pos_a: dict, pos_b: dict) -> float:
    if not pos_a or not pos_b:
        return 0.0
    dx = (pos_a.get("x_norm", 0) or 0) - (pos_b.get("x_norm", 0) or 0)
    dy = (pos_a.get("y_norm", 0) or 0) - (pos_b.get("y_norm", 0) or 0)
    return (dx**2 + dy**2) ** 0.5


def _summarize(added: list, removed: list, moved: list) -> str:
    parts = []
    if added:
        labels = ", ".join(o["label"] for o in added)
        parts.append(f"{len(added)} added ({labels})")
    if removed:
        labels = ", ".join(o["label"] for o in removed)
        parts.append(f"{len(removed)} removed ({labels})")
    if moved:
        labels = ", ".join(o["label"] for o in moved)
        parts.append(f"{len(moved)} moved ({labels})")
    return ". ".join(parts) + "." if parts else "No significant changes detected."
