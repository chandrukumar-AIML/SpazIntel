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
    ACTION_SCAN, ACTION_QUERY, ACTION_DIFF, ACTION_STATUS, ACTION_SCENE_GRAPH, ACTION_MEASURE, ACTION_REPORT, ACTION_SEARCH,
    ACTION_RENAME, ACTION_DELETE,
    LLM_PRIMARY, LLM_GROQ_MODEL, LLM_GEMINI_MODEL, LLM_OPENAI_MODEL, PROMPT_SPATIAL_QA_VERSION,
)

logger = logging.getLogger(__name__)

DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
_DEFAULT_SCANS = str(Path(__file__).parent.parent / "data" / "scans")
SCANS_DIR = Path(os.getenv("SCANS_DIR", _DEFAULT_SCANS))
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GROQ_API_KEY      = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY    = os.getenv("GEMINI_API_KEY", "")
OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY", "")
OLLAMA_BASE_URL   = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL      = os.getenv("OLLAMA_MODEL", "llama3.2")


async def dispatch(action: str, payload: dict[str, Any]) -> SpatialResponse:
    handlers = {
        ACTION_SCAN:        _scan,
        ACTION_QUERY:       _query,
        ACTION_DIFF:        _diff,
        ACTION_STATUS:      _status,
        ACTION_SCENE_GRAPH: _scene_graph,
        ACTION_MEASURE:     _measure,
        ACTION_REPORT:      _report,
        ACTION_SEARCH:      _search,
        ACTION_RENAME:      _rename,
        ACTION_DELETE:      _delete,
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
            "answer": "The workbench is at the south end of the factory floor, approximately 3.2m from the machine. The fire extinguisher is near the exit door at 1.8m depth. Safety cabinet is 4.1m from the workbench.",
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
    """LLM fallback chain: Claude → Groq → Gemini → OpenAI → Ollama"""
    import asyncio
    system_prompt = _load_prompt("spatial_qa_v2.txt")

    # Build compact context: objects table + distance table + room size
    obj_rows = []
    for o in scene_graph.get("objects", []):
        pos = o.get("position", {})
        z   = f"{pos['z_m']}m" if pos.get("z_m") is not None else "?"
        wx  = o.get("world_x_m")
        wy  = o.get("world_y_m")
        coords = f"({wx},{wy})" if wx is not None else "?"
        obj_rows.append(f"  {o['label']}: depth={z}, world_xy={coords}m, conf={o['confidence']}")

    dist_rows = [
        f"  {d['from']} ↔ {d['to']}: {d['distance_m']}m"
        for d in scene_graph.get("distances", [])[:15]   # top 15 closest pairs
    ]

    room = scene_graph.get("room_size", {})
    room_line = f"{room['width_m']}m wide × {room['depth_m']}m deep" if room else "unknown"

    user_msg = (
        f"Objects ({len(obj_rows)}):\n" + "\n".join(obj_rows) +
        "\n\nDistances (closest first):\n" + ("\n".join(dist_rows) if dist_rows else "  (no depth data)") +
        f"\n\nRoom size: {room_line}" +
        f"\n\nStructure: {json.dumps(scene_graph.get('structure', {}))}" +
        f"\n\nQuestion: {question}"
    )

    return await _call_llm_chain(system_prompt, user_msg, max_tokens=512)


def _call_claude(system_prompt: str, user_msg: str, max_tokens: int = 512) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=LLM_PRIMARY,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_msg}],
    )
    logger.info("llm=claude model=%s", LLM_PRIMARY)
    return msg.content[0].text


def _build_qa_context(scene_graph: dict, question: str) -> tuple[str, str]:
    """Return (system_prompt, user_msg) for Q&A — shared by streaming and non-streaming paths."""
    system_prompt = _load_prompt("spatial_qa_v2.txt")

    obj_rows = []
    for o in scene_graph.get("objects", []):
        pos = o.get("position", {})
        z   = f"{pos['z_m']}m" if pos.get("z_m") is not None else "?"
        wx  = o.get("world_x_m")
        wy  = o.get("world_y_m")
        coords = f"({wx},{wy})" if wx is not None else "?"
        obj_rows.append(f"  {o['label']}: depth={z}, world_xy={coords}m, conf={o['confidence']}")

    dist_rows = [
        f"  {d['from']} ↔ {d['to']}: {d['distance_m']}m"
        for d in scene_graph.get("distances", [])[:15]
    ]

    room = scene_graph.get("room_size", {})
    room_line = f"{room['width_m']}m wide × {room['depth_m']}m deep" if room else "unknown"

    user_msg = (
        f"Objects ({len(obj_rows)}):\n" + "\n".join(obj_rows) +
        "\n\nDistances (closest first):\n" + ("\n".join(dist_rows) if dist_rows else "  (no depth data)") +
        f"\n\nRoom size: {room_line}" +
        f"\n\nStructure: {json.dumps(scene_graph.get('structure', {}))}" +
        f"\n\nQuestion: {question}"
    )
    return system_prompt, user_msg


async def query_stream(scan_id: str, question: str):
    """Async generator yielding text chunks for SSE streaming.
    Falls back to Groq (yields full response at once) or error message."""
    graph_path = SCANS_DIR / scan_id / "scene_graph.json"
    if not graph_path.exists():
        yield f"No scene graph found for {scan_id}. Run a scan first."
        return

    scene_graph = json.loads(graph_path.read_text())
    system_prompt, user_msg = _build_qa_context(scene_graph, question)

    if ANTHROPIC_API_KEY and ANTHROPIC_API_KEY != "your_key_here":
        import anthropic as _anthropic
        client = _anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        try:
            with client.messages.stream(
                model=LLM_PRIMARY,
                max_tokens=512,
                system=system_prompt,
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                logger.info("llm=claude stream model=%s scan=%s", LLM_PRIMARY, scan_id)
                for text in stream.text_stream:
                    yield text
            return
        except _anthropic.APIError as e:
            logger.warning("Claude stream failed (%s) — Groq fallback", e)

    if GROQ_API_KEY and GROQ_API_KEY != "your_key_here":
        try:
            import asyncio
            result = await asyncio.to_thread(_call_groq, system_prompt, user_msg)
            yield result
            return
        except Exception as e:
            logger.warning("Groq stream failed (%s) — Gemini fallback", e)

    if GEMINI_API_KEY and GEMINI_API_KEY != "your_key_here":
        try:
            import asyncio
            result = await asyncio.to_thread(_call_gemini, system_prompt, user_msg)
            yield result
            return
        except Exception as e:
            logger.warning("Gemini stream failed (%s) — OpenAI fallback", e)

    if OPENAI_API_KEY and OPENAI_API_KEY != "your_key_here":
        try:
            import asyncio
            result = await asyncio.to_thread(_call_openai, system_prompt, user_msg)
            yield result
            return
        except Exception as e:
            logger.warning("OpenAI stream failed (%s) — Ollama fallback", e)

    if OLLAMA_BASE_URL:
        try:
            import asyncio
            result = await asyncio.to_thread(_call_ollama, system_prompt, user_msg)
            yield result
            return
        except Exception as e:
            yield f"Error: {e}"
            return

    if DEMO_MODE:
        yield "The workbench is at the south end of the factory floor, approximately 3.2m from the machine. Safety cabinet is near the exit at 1.8m depth."
        return

    yield "No LLM available. Add ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or run Ollama locally."


def _call_groq(system_prompt: str, user_msg: str, max_tokens: int = 512) -> str:
    from groq import Groq
    client = Groq(api_key=GROQ_API_KEY)
    resp = client.chat.completions.create(
        model=LLM_GROQ_MODEL,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
    )
    logger.info("llm=groq model=%s", LLM_GROQ_MODEL)
    return resp.choices[0].message.content


def _call_gemini(system_prompt: str, user_msg: str, max_tokens: int = 512) -> str:
    import google.generativeai as genai
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(
        LLM_GEMINI_MODEL,
        system_instruction=system_prompt,
    )
    resp = model.generate_content(
        user_msg,
        generation_config=genai.GenerationConfig(max_output_tokens=max_tokens),
    )
    logger.info("llm=gemini model=%s", LLM_GEMINI_MODEL)
    return resp.text


def _call_openai(system_prompt: str, user_msg: str, max_tokens: int = 512) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)
    resp = client.chat.completions.create(
        model=LLM_OPENAI_MODEL,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
    )
    logger.info("llm=openai model=%s", LLM_OPENAI_MODEL)
    return resp.choices[0].message.content


def _call_ollama(system_prompt: str, user_msg: str, max_tokens: int = 512) -> str:
    import urllib.request
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_msg},
        ],
        "stream": False,
        "options": {"num_predict": max_tokens},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    logger.info("llm=ollama model=%s", OLLAMA_MODEL)
    return data["message"]["content"]


async def _call_llm_chain(system_prompt: str, user_msg: str, max_tokens: int = 512) -> str:
    """Claude → Groq → Gemini → OpenAI → Ollama → DEMO_MODE canned response."""
    import asyncio
    import anthropic as _anthropic

    if ANTHROPIC_API_KEY and ANTHROPIC_API_KEY != "your_key_here":
        try:
            return await asyncio.to_thread(_call_claude, system_prompt, user_msg, max_tokens)
        except _anthropic.APIError as e:
            logger.warning("Claude failed (%s) — trying Groq", e)

    if GROQ_API_KEY and GROQ_API_KEY != "your_key_here":
        try:
            return await asyncio.to_thread(_call_groq, system_prompt, user_msg, max_tokens)
        except Exception as e:
            logger.warning("Groq failed (%s) — trying Gemini", e)

    if GEMINI_API_KEY and GEMINI_API_KEY != "your_key_here":
        try:
            return await asyncio.to_thread(_call_gemini, system_prompt, user_msg, max_tokens)
        except Exception as e:
            logger.warning("Gemini failed (%s) — trying OpenAI", e)

    if OPENAI_API_KEY and OPENAI_API_KEY != "your_key_here":
        try:
            return await asyncio.to_thread(_call_openai, system_prompt, user_msg, max_tokens)
        except Exception as e:
            logger.warning("OpenAI failed (%s) — trying Ollama", e)

    if OLLAMA_BASE_URL:
        try:
            return await asyncio.to_thread(_call_ollama, system_prompt, user_msg, max_tokens)
        except Exception as e:
            raise RuntimeError(f"All LLM providers failed. Last: {e}") from e

    raise RuntimeError("No LLM available. Set ANTHROPIC_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or run Ollama.")


def _parse_llm_json(raw: str):
    """Parse JSON from LLM output robustly: strips fences, fixes missing commas, handles truncation."""
    import re
    raw = raw.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw
    # Fix missing commas between consecutive string values in arrays (common llama3 output)
    raw = re.sub(r'"(\s+)"', r'",\1"', raw)
    # Try parsing (raw_decode ignores trailing explanation text)
    try:
        val, _ = json.JSONDecoder().raw_decode(raw)
        return val
    except json.JSONDecodeError:
        pass
    # Repair truncated JSON (missing closing brackets/braces)
    repaired = raw.rstrip().rstrip(",")
    # If truncated mid-string (doesn't end with " ] } ), close the string first
    if repaired and repaired[-1] not in ('"', "]", "}", ")"):
        repaired += '"'
    repaired += "]" * max(0, repaired.count("[") - repaired.count("]"))
    repaired += "}" * max(0, repaired.count("{") - repaired.count("}"))
    val, _ = json.JSONDecoder().raw_decode(repaired)
    return val


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

    # Upgrade rule-based summary to Claude/Groq narrative
    try:
        report["summary"] = await _llm_diff_summary(report)
        report["summary_ai"] = True
    except Exception as e:
        logger.warning("diff LLM summary failed (%s) — keeping rule-based", e)
        report["summary_ai"] = False

    return SpatialResponse(success=True, data=report)


async def _llm_diff_summary(report: dict) -> str:
    """Generate a natural language summary of the diff using Claude or Groq."""
    import asyncio
    system_prompt = _load_prompt("spatial_diff_v1.txt")

    changes = report.get("changes", {})
    added   = [o["label"] for o in changes.get("added", [])]
    removed = [o["label"] for o in changes.get("removed", [])]
    moved   = [(o["label"], o.get("distance", 0)) for o in changes.get("moved", [])]
    unchanged = report.get("unchanged_count", 0)

    user_msg = (
        f"Scan A: {report.get('scan_a')}\n"
        f"Scan B: {report.get('scan_b')}\n\n"
        f"Added objects:   {', '.join(added) if added else 'none'}\n"
        f"Removed objects: {', '.join(removed) if removed else 'none'}\n"
        f"Moved objects:   {', '.join(f'{l} (Δ{d:.2f}m)' for l, d in moved) if moved else 'none'}\n"
        f"Unchanged:       {unchanged} objects\n\n"
        "Write the summary."
    )

    try:
        return await _call_llm_chain(system_prompt, user_msg, max_tokens=256)
    except Exception:
        return report.get("summary", "No changes detected.")


async def _scene_graph(payload: dict) -> SpatialResponse:
    scan_id = payload.get("scan_id")
    if not scan_id:
        return SpatialResponse(success=False, error="scan_id required")
    graph_path = SCANS_DIR / scan_id / "scene_graph.json"
    if not graph_path.exists():
        return SpatialResponse(success=False, error=f"No scene graph for scan_id={scan_id}")
    graph = json.loads(graph_path.read_text())
    return SpatialResponse(success=True, data=graph)


async def _measure(payload: dict) -> SpatialResponse:
    """
    Measure distance between two objects by label.
    Returns distance_m, and positions of both objects.
    """
    scan_id = payload.get("scan_id")
    label_a = payload.get("label_a", "").lower().strip()
    label_b = payload.get("label_b", "").lower().strip()
    if not scan_id or not label_a or not label_b:
        return SpatialResponse(success=False, error="scan_id, label_a, and label_b required")

    graph_path = SCANS_DIR / scan_id / "scene_graph.json"
    if not graph_path.exists():
        return SpatialResponse(success=False, error=f"No scene graph for scan_id={scan_id}")

    graph = json.loads(graph_path.read_text())
    objects = graph.get("objects", [])

    def find(lbl: str):
        return next((o for o in objects if o["label"].lower() == lbl), None)

    obj_a = find(label_a)
    obj_b = find(label_b)

    if not obj_a:
        return SpatialResponse(success=False, error=f"'{label_a}' not found in this scan")
    if not obj_b:
        return SpatialResponse(success=False, error=f"'{label_b}' not found in this scan")

    # Look up precomputed distance first
    precomputed = next(
        (d for d in graph.get("distances", [])
         if set([d["from"], d["to"]]) == set([label_a, label_b])),
        None,
    )

    if precomputed:
        dist = precomputed["distance_m"]
    else:
        # Compute on the fly
        import math
        ax, ay = obj_a.get("world_x_m"), obj_a.get("world_y_m")
        bx, by = obj_b.get("world_x_m"), obj_b.get("world_y_m")
        az = obj_a["position"].get("z_m")
        bz = obj_b["position"].get("z_m")
        if None in (ax, ay, bx, by, az, bz):
            return SpatialResponse(success=False, error="Depth data not available for one or both objects. Run scan with SKIP_DEPTH=false.")
        dist = round(math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2), 2)

    return SpatialResponse(success=True, data={
        "label_a":    label_a,
        "label_b":    label_b,
        "distance_m": dist,
        "object_a":   {"position": obj_a["position"], "world_x_m": obj_a.get("world_x_m"), "world_y_m": obj_a.get("world_y_m")},
        "object_b":   {"position": obj_b["position"], "world_x_m": obj_b.get("world_x_m"), "world_y_m": obj_b.get("world_y_m")},
        "note": "Distance is approximate (monocular depth estimation).",
    })


async def _search(payload: dict) -> SpatialResponse:
    """Cross-scan semantic search: finds which scans match a natural-language query."""
    query = payload.get("query", "").strip()
    if not query:
        return SpatialResponse(success=False, error="query required")

    # Load all complete scans
    all_scans: list[tuple[str, dict]] = []
    if SCANS_DIR.exists():
        for scan_dir in sorted(SCANS_DIR.iterdir(), reverse=True):
            if not scan_dir.is_dir() or not scan_dir.name.startswith("scan_"):
                continue
            graph_path = scan_dir / "scene_graph.json"
            if not graph_path.exists():
                continue
            try:
                g = json.loads(graph_path.read_text(encoding="utf-8"))
                all_scans.append((scan_dir.name, g))
            except Exception:
                continue

    if not all_scans:
        return SpatialResponse(success=True, data={
            "query": query, "results": [], "total_scans_searched": 0
        })

    results: list[dict] = []
    try:
        results = await _llm_search_rank(query, all_scans)
    except Exception as e:
        logger.warning("LLM search failed (%s) — keyword fallback", e)
        results = _keyword_search(query, all_scans)

    # Enrich results with human-readable name from meta.json
    for r in results:
        meta_path = SCANS_DIR / r["scan_id"] / "meta.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                r["name"] = meta.get("name")
            except Exception:
                pass

    return SpatialResponse(success=True, data={
        "query":                query,
        "results":              results,
        "total_scans_searched": len(all_scans),
    })


def _scan_summary(scan_id: str, graph: dict) -> str:
    """One-line compact summary of a scan for LLM context."""
    objects  = graph.get("objects", [])
    room     = graph.get("room_size", {})
    top_objs = ", ".join(
        f"{o['label']} {round(o['confidence']*100)}%"
        for o in sorted(objects, key=lambda x: x["confidence"], reverse=True)[:6]
    )
    dims = f"{room['width_m']}m×{room['depth_m']}m" if room else "?"
    return f"{scan_id}: {len(objects)} objects ({top_objs}) | room {dims}"


def _keyword_search(query: str, scans: list[tuple[str, dict]]) -> list[dict]:
    """Fallback keyword matcher — counts overlapping label words."""
    words = set(query.lower().split())
    results = []
    for scan_id, graph in scans:
        labels = {o["label"].lower() for o in graph.get("objects", [])}
        hits   = words & labels
        # also check partial matches (query word is substring of a label)
        partial = {w for w in words if any(w in lbl for lbl in labels)}
        all_hits = hits | partial
        if not all_hits:
            continue
        score = min(100, int(len(all_hits) / max(len(words), 1) * 100))
        if score < 25:
            continue
        results.append({
            "scan_id":        scan_id,
            "score":          score,
            "reason":         f"Contains: {', '.join(sorted(all_hits))}",
            "preview_objects": sorted(all_hits)[:5],
        })
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:10]


async def _llm_search_rank(
    query: str,
    scans: list[tuple[str, dict]],
) -> list[dict]:
    system_prompt = _load_prompt("spatial_search_v1.txt")
    summaries     = "\n".join(_scan_summary(sid, g) for sid, g in scans)
    user_msg      = f'Query: "{query}"\n\nScans:\n{summaries}'

    raw = await _call_llm_chain(system_prompt, user_msg, max_tokens=900)
    ranked = _parse_llm_json(raw)

    # Decorate each result with preview_objects from the scene graph
    graph_map = {sid: g for sid, g in scans}
    out = []
    for item in ranked:
        sid   = item.get("scan_id", "")
        graph = graph_map.get(sid, {})
        objs  = [o["label"] for o in
                 sorted(graph.get("objects", []), key=lambda x: x["confidence"], reverse=True)]
        out.append({
            "scan_id":        sid,
            "score":          int(item.get("score", 0)),
            "reason":         str(item.get("reason", "")),
            "preview_objects": objs[:5],
        })
    return out


async def _report(payload: dict) -> SpatialResponse:
    """Generate an AI Spatial Report grounded on the scene graph. Caches to report.json."""
    scan_id = payload.get("scan_id")
    regen   = payload.get("regen", False)
    if not scan_id:
        return SpatialResponse(success=False, error="scan_id required")

    graph_path = SCANS_DIR / scan_id / "scene_graph.json"
    if not graph_path.exists():
        return SpatialResponse(success=False, error=f"No scene graph for scan_id={scan_id}")

    cache_path = SCANS_DIR / scan_id / "report.json"

    if not regen and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text())
            cached["cached"] = True
            return SpatialResponse(success=True, data=cached)
        except Exception:
            pass

    graph   = json.loads(graph_path.read_text())
    objects = graph.get("objects", [])
    room    = graph.get("room_size", {})
    dists   = graph.get("distances", [])

    llm = {"room_type": "Unknown", "overview": "", "insights": []}
    try:
        llm = await _llm_report(graph)
    except Exception as e:
        logger.warning("report LLM skipped: %s", e)

    report = {
        "scan_id":   scan_id,
        "room_type": llm.get("room_type", "Unknown"),
        "overview":  llm.get("overview", ""),
        "insights":  llm.get("insights", []),
        "metrics": {
            "object_count":  len(objects),
            "room_width_m":  room.get("width_m"),
            "room_depth_m":  room.get("depth_m"),
            "distance_pairs": len(dists),
        },
        "objects": [
            {"label": o["label"], "confidence": round(o["confidence"], 3)}
            for o in sorted(objects, key=lambda x: x["confidence"], reverse=True)
        ],
        "top_distances": dists[:6],
        "cached": False,
    }

    try:
        cache_path.write_text(json.dumps(report, indent=2))
    except Exception:
        pass

    return SpatialResponse(success=True, data=report)


async def _llm_report(scene_graph: dict) -> dict:
    import asyncio
    system_prompt = _load_prompt("spatial_report_v1.txt")

    objects = scene_graph.get("objects", [])
    dists   = scene_graph.get("distances", [])
    room    = scene_graph.get("room_size", {})
    room_line = (
        f"{room['width_m']}m wide × {room['depth_m']}m deep" if room else "unknown dimensions"
    )

    obj_rows = []
    for o in objects:
        pos = o.get("position", {})
        z   = f"{pos['z_m']}m" if pos.get("z_m") is not None else "?"
        obj_rows.append(f"  {o['label']}: depth={z}, conf={o['confidence']:.2f}")

    dist_rows = [
        f"  {d['from']} ↔ {d['to']}: {d['distance_m']}m"
        for d in dists[:10]
    ]

    user_msg = (
        f"Room size: {room_line}\n"
        f"Structure: {json.dumps(scene_graph.get('structure', {}))}\n\n"
        f"Objects ({len(obj_rows)}):\n" + "\n".join(obj_rows) +
        "\n\nKey distances:\n" + ("\n".join(dist_rows) if dist_rows else "  (no depth data)")
    )

    raw = await _call_llm_chain(system_prompt, user_msg, max_tokens=1500)
    return _parse_llm_json(raw)


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
        "scan_id": "scan_001",
        "status": "done",
        "frames_extracted": 36,
        "objects_detected": 8,
        "scene_graph": {
            "scan_id": "scan_001",
            "objects": [
                {"id": "obj_001", "label": "machine",          "confidence": 0.94, "position": {"x_norm": 0.5,  "y_norm": 0.7, "z_m": 6.1}, "world_x_m": 0.0,  "world_y_m": -1.2},
                {"id": "obj_002", "label": "workbench",        "confidence": 0.91, "position": {"x_norm": 0.25, "y_norm": 0.8, "z_m": 3.2}, "world_x_m": -2.1, "world_y_m": -0.9},
                {"id": "obj_003", "label": "safety cabinet",   "confidence": 0.88, "position": {"x_norm": 0.8,  "y_norm": 0.6, "z_m": 4.5}, "world_x_m": 2.4,  "world_y_m": -0.7},
                {"id": "obj_004", "label": "fire extinguisher","confidence": 0.96, "position": {"x_norm": 0.15, "y_norm": 0.5, "z_m": 1.8}, "world_x_m": -3.1, "world_y_m": -0.3},
                {"id": "obj_005", "label": "tool rack",        "confidence": 0.83, "position": {"x_norm": 0.2,  "y_norm": 0.7, "z_m": 5.1}, "world_x_m": -2.8, "world_y_m": -0.9},
                {"id": "obj_006", "label": "conveyor",         "confidence": 0.89, "position": {"x_norm": 0.7,  "y_norm": 0.75,"z_m": 5.5}, "world_x_m": 2.1,  "world_y_m": -1.0},
                {"id": "obj_007", "label": "computer",         "confidence": 0.92, "position": {"x_norm": 0.35, "y_norm": 0.55,"z_m": 2.1}, "world_x_m": -1.0, "world_y_m": -0.2},
                {"id": "obj_008", "label": "shelf",            "confidence": 0.87, "position": {"x_norm": 0.85, "y_norm": 0.65,"z_m": 7.8}, "world_x_m": 3.2,  "world_y_m": -0.8},
            ],
            "structure": {"walls": 4, "doors": [{"id": "door_exit"}], "windows": []},
            "distances": [
                {"from": "fire extinguisher", "to": "workbench",  "distance_m": 1.89},
                {"from": "computer",          "to": "workbench",  "distance_m": 1.37},
                {"from": "machine",           "to": "conveyor",   "distance_m": 2.23},
                {"from": "workbench",         "to": "tool rack",  "distance_m": 2.12},
                {"from": "safety cabinet",    "to": "workbench",  "distance_m": 4.10},
                {"from": "machine",           "to": "workbench",  "distance_m": 3.22},
            ],
            "room_size": {"width_m": 10.5, "depth_m": 8.3},
        },
    }


# ---------------------------------------------------------------------------
# Rename — store human-readable name in meta.json
# ---------------------------------------------------------------------------

async def _rename(payload: dict) -> SpatialResponse:
    scan_id = payload.get("scan_id")
    name    = str(payload.get("name", "")).strip()
    if not scan_id:
        return SpatialResponse(success=False, error="scan_id required")
    if not name:
        return SpatialResponse(success=False, error="name required")

    scan_dir  = SCANS_DIR / scan_id
    if not scan_dir.exists():
        return SpatialResponse(success=False, error=f"Scan not found: {scan_id}")

    meta_path = scan_dir / "meta.json"
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    meta["name"] = name
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    return SpatialResponse(success=True, data={"scan_id": scan_id, "name": name})


# ---------------------------------------------------------------------------
# Delete — permanently remove a scan directory
# ---------------------------------------------------------------------------

async def _delete(payload: dict) -> SpatialResponse:
    import shutil
    scan_id = payload.get("scan_id")
    if not scan_id:
        return SpatialResponse(success=False, error="scan_id required")
    if scan_id == "scan_001":
        return SpatialResponse(success=False, error="Cannot delete the demo scan")

    scan_dir = SCANS_DIR / scan_id
    if not scan_dir.exists():
        return SpatialResponse(success=False, error=f"Scan not found: {scan_id}")

    shutil.rmtree(scan_dir)
    return SpatialResponse(success=True, data={"scan_id": scan_id, "deleted": True})


def _demo_diff_result() -> dict:
    return {
        "scan_a": "scan_001",
        "scan_b": "scan_002",
        "changes": {
            "moved": [{"label": "forklift", "from": {"x_norm": 0.6, "y_norm": 0.8}, "to": {"x_norm": 0.3, "y_norm": 0.5}, "distance": 3.1}],
            "added": [{"label": "pallet", "position": {"x_norm": 0.45, "y_norm": 0.65}}],
            "removed": [],
        },
        "unchanged_count": 7,
        "summary": "1 moved (forklift Δ3.1m). 1 added (pallet). Factory floor otherwise unchanged.",
    }
