import os
import json
import logging
from typing import Any

from models import SpatialResponse
from constants import ACTION_SCAN, ACTION_QUERY, ACTION_DIFF, ACTION_STATUS

logger = logging.getLogger(__name__)
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"


async def dispatch(action: str, payload: dict[str, Any]) -> SpatialResponse:
    handlers = {
        ACTION_SCAN: _scan,
        ACTION_QUERY: _query,
        ACTION_DIFF: _diff,
        ACTION_STATUS: _status,
    }
    try:
        return await handlers[action](payload)
    except Exception as e:
        logger.error("action=%s error=%s", action, str(e))
        return SpatialResponse(success=False, error=str(e))


async def _scan(payload: dict) -> SpatialResponse:
    if DEMO_MODE:
        return SpatialResponse(success=True, data=_demo_scan_result())

    # Phase 1: wire to engines/rce pipeline
    # TODO: import and call rce pipeline
    return SpatialResponse(success=False, error="Scan pipeline not yet implemented. Set DEMO_MODE=true to test.")


async def _query(payload: dict) -> SpatialResponse:
    if DEMO_MODE:
        return SpatialResponse(success=True, data={"answer": "The blue chair is near the window, about 2m from the desk.", "source": "demo_scene_graph"})

    scan_id = payload.get("scan_id")
    question = payload.get("question")
    if not scan_id or not question:
        return SpatialResponse(success=False, error="scan_id and question are required")

    # Phase 1: load scene graph, call LLM
    # TODO: implement LLM Q&A over scene graph
    return SpatialResponse(success=False, error="Query not yet implemented. Set DEMO_MODE=true to test.")


async def _diff(payload: dict) -> SpatialResponse:
    if DEMO_MODE:
        return SpatialResponse(success=True, data=_demo_diff_result())

    # Phase 1: load two scene graphs, call diff engine
    # TODO: implement diff
    return SpatialResponse(success=False, error="Diff not yet implemented. Set DEMO_MODE=true to test.")


async def _status(payload: dict) -> SpatialResponse:
    scan_id = payload.get("scan_id")
    return SpatialResponse(success=True, data={"scan_id": scan_id, "status": "demo" if DEMO_MODE else "unknown"})


def _demo_scan_result() -> dict:
    return {
        "scan_id": "demo_scan_001",
        "status": "done",
        "scene_graph": {
            "scan_id": "demo_scan_001",
            "objects": [
                {"id": "obj_001", "label": "chair", "color_hint": "blue", "confidence": 0.91, "position": {"x": 1.2, "y": 0.0, "z": 2.3}},
                {"id": "obj_002", "label": "desk", "confidence": 0.88, "position": {"x": 2.0, "y": 0.0, "z": 1.5}},
                {"id": "obj_003", "label": "window", "confidence": 0.95, "position": {"x": 4.0, "y": 1.2, "z": 2.0}},
                {"id": "obj_004", "label": "door", "confidence": 0.97, "position": {"x": 0.0, "y": 1.0, "z": 0.5}},
            ],
            "structure": {"walls": 4, "doors": 1, "windows": 1}
        }
    }


def _demo_diff_result() -> dict:
    return {
        "scan_a": "demo_scan_001",
        "scan_b": "demo_scan_002",
        "changes": {
            "moved": [{"label": "chair", "from": {"x": 1.2, "y": 0.0, "z": 2.3}, "to": {"x": 3.5, "y": 0.0, "z": 1.0}}],
            "added": [{"label": "laptop", "position": {"x": 2.0, "y": 0.75, "z": 1.5}}],
            "removed": []
        },
        "summary": "1 object moved (chair), 1 object added (laptop)."
    }
