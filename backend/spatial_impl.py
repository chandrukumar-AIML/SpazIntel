"""
Spatial action dispatcher — business logic layer.
Hybrid pipeline: capture + COLMAP + detect + scene_graph + diff = local
                 gsplat training = Colab (upload colmap_output.zip → download splat_result.zip)
"""
import os
import json
import uuid
import logging
from pathlib import Path
from typing import Any

from models import SpatialResponse
from constants import (
    ACTION_SCAN, ACTION_QUERY, ACTION_DIFF, ACTION_STATUS,
    LLM_PRIMARY, PROMPT_SPATIAL_QA_VERSION,
)

logger = logging.getLogger(__name__)

DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
SCANS_DIR = Path(os.getenv("SCANS_DIR", "data/scans"))
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


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


# ---------------------------------------------------------------------------
# scan — video → frames → COLMAP → detect → scene_graph
# gsplat training is manual (Colab) — returns colmap_zip path so user knows what to upload
# ---------------------------------------------------------------------------

async def _scan(payload: dict) -> SpatialResponse:
    if DEMO_MODE:
        return SpatialResponse(success=True, data=_demo_scan_result())

    video_path = payload.get("video_path")
    location_id = payload.get("location_id", "default")
    if not video_path:
        return SpatialResponse(success=False, error="video_path required")

    scan_id = f"scan_{uuid.uuid4().hex[:8]}"
    scan_dir = SCANS_DIR / scan_id
    frames_dir = scan_dir / "frames"
    colmap_dir = scan_dir / "colmap_output"

    # Stage 1 — Extract frames
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "engines"))
    from rce.capture import extract_frames
    from rce.detect import detect_objects
    from rce.scene_graph import build_scene_graph

    logger.info("scan_id=%s stage=capture", scan_id)
    frames = extract_frames(video_path, str(frames_dir))

    # Stage 2 — Package frames for Colab (COLMAP + gsplat run on Colab T4)
    from rce.reconstruct import package_frames_for_colab
    logger.info("scan_id=%s stage=package_for_colab", scan_id)
    frames_zip = package_frames_for_colab(str(frames_dir), str(scan_dir))

    # Stage 3 — Object Detection (CPU, no CUDA needed)
    logger.info("scan_id=%s stage=detect", scan_id)
    detections = detect_objects(str(frames_dir), str(scan_dir / "detections"))

    # Stage 4 — Scene Graph
    logger.info("scan_id=%s stage=scene_graph", scan_id)
    graph = build_scene_graph(detections, scan_id=scan_id, location_id=location_id)

    # Save scene graph
    graph_path = scan_dir / "scene_graph.json"
    graph_path.write_text(json.dumps(graph, indent=2))

    return SpatialResponse(success=True, data={
        "scan_id": scan_id,
        "status": "done_pending_splat",
        "frames_extracted": len(frames),
        "objects_detected": len(graph["objects"]),
        "scene_graph_path": str(graph_path),
        "frames_zip": frames_zip,
        "next_step": "Upload frames_zip to Colab notebook (docs/colab_gsplat_train.ipynb) → COLMAP + gsplat on T4 → download splat_result.zip → call register_splat action",
    })


# ---------------------------------------------------------------------------
# query — LLM Q&A grounded on scene graph JSON
# ---------------------------------------------------------------------------

async def _query(payload: dict) -> SpatialResponse:
    if DEMO_MODE:
        return SpatialResponse(success=True, data={
            "answer": "The blue chair is near the window, about 2m from the desk.",
            "source": "demo_scene_graph",
        })

    scan_id = payload.get("scan_id")
    question = payload.get("question")
    if not scan_id or not question:
        return SpatialResponse(success=False, error="scan_id and question required")

    graph_path = SCANS_DIR / scan_id / "scene_graph.json"
    if not graph_path.exists():
        return SpatialResponse(success=False, error=f"No scene graph for scan_id={scan_id}")

    graph = json.loads(graph_path.read_text())
    answer = await _llm_query(question, graph)

    return SpatialResponse(success=True, data={
        "scan_id": scan_id,
        "question": question,
        "answer": answer,
        "prompt_version": PROMPT_SPATIAL_QA_VERSION,
    })


async def _llm_query(question: str, scene_graph: dict) -> str:
    import asyncio
    import anthropic

    system_prompt = _load_prompt("spatial_qa_v1.txt")
    graph_json = json.dumps(scene_graph, indent=2)

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    def _call():
        msg = client.messages.create(
            model=LLM_PRIMARY,
            max_tokens=512,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Scene graph:\n{graph_json}\n\nQuestion: {question}"
            }]
        )
        return msg.content[0].text

    return await asyncio.to_thread(_call)


def _load_prompt(filename: str) -> str:
    prompt_path = Path(__file__).parent / "prompts" / filename
    if prompt_path.exists():
        return prompt_path.read_text()
    # Fallback inline — replace with prompts/spatial_qa_v1.txt
    return (
        "You are a spatial intelligence assistant. "
        "You answer questions about physical spaces based on a structured scene graph. "
        "Answer concisely and only based on what the scene graph contains. "
        "If the object or location is not in the scene graph, say so clearly."
    )


# ---------------------------------------------------------------------------
# diff — compare two scene graphs
# ---------------------------------------------------------------------------

async def _diff(payload: dict) -> SpatialResponse:
    if DEMO_MODE:
        return SpatialResponse(success=True, data=_demo_diff_result())

    scan_id_a = payload.get("scan_id_a")
    scan_id_b = payload.get("scan_id_b")
    if not scan_id_a or not scan_id_b:
        return SpatialResponse(success=False, error="scan_id_a and scan_id_b required")

    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "engines"))
    from rce.diff import diff_graphs

    def _load(sid):
        p = SCANS_DIR / sid / "scene_graph.json"
        if not p.exists():
            raise FileNotFoundError(f"No scene graph for scan_id={sid}")
        return json.loads(p.read_text())

    graph_a = _load(scan_id_a)
    graph_b = _load(scan_id_b)
    report = diff_graphs(graph_a, graph_b)

    return SpatialResponse(success=True, data=report)


async def _status(payload: dict) -> SpatialResponse:
    scan_id = payload.get("scan_id")
    if not scan_id:
        return SpatialResponse(success=True, data={"mode": "demo" if DEMO_MODE else "live"})

    scan_dir = SCANS_DIR / scan_id
    has_graph = (scan_dir / "scene_graph.json").exists()
    has_splat = any((scan_dir / "splat").glob("*.splat")) if (scan_dir / "splat").exists() else False

    return SpatialResponse(success=True, data={
        "scan_id": scan_id,
        "has_scene_graph": has_graph,
        "has_splat": has_splat,
        "status": "complete" if (has_graph and has_splat) else "pending_splat" if has_graph else "unknown",
    })


# ---------------------------------------------------------------------------
# Demo data
# ---------------------------------------------------------------------------

def _demo_scan_result() -> dict:
    return {
        "scan_id": "demo_scan_001",
        "status": "done",
        "frames_extracted": 24,
        "objects_detected": 4,
        "scene_graph": {
            "scan_id": "demo_scan_001",
            "objects": [
                {"id": "obj_001", "label": "chair", "confidence": 0.91, "position": {"x_norm": 0.3, "y_norm": 0.6}},
                {"id": "obj_002", "label": "desk",  "confidence": 0.88, "position": {"x_norm": 0.5, "y_norm": 0.4}},
                {"id": "obj_003", "label": "window","confidence": 0.95, "position": {"x_norm": 0.9, "y_norm": 0.3}},
                {"id": "obj_004", "label": "door",  "confidence": 0.97, "position": {"x_norm": 0.1, "y_norm": 0.5}},
            ],
            "structure": {"walls": 4, "doors": [{"id": "door_001"}], "windows": [{"id": "win_001"}]},
        },
    }


def _demo_diff_result() -> dict:
    return {
        "scan_a": "demo_scan_001",
        "scan_b": "demo_scan_002",
        "changes": {
            "moved": [{"label": "chair", "from": {"x_norm": 0.3, "y_norm": 0.6}, "to": {"x_norm": 0.7, "y_norm": 0.2}, "distance": 0.5}],
            "added": [{"label": "laptop", "position": {"x_norm": 0.5, "y_norm": 0.4}}],
            "removed": [],
        },
        "unchanged_count": 3,
        "summary": "1 moved (chair). 1 added (laptop).",
    }
