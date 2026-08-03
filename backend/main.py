import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")   # must run before all other imports

import asyncio
import time
import logging
from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from models import SpatialRequest, SpatialResponse
from constants import VALID_ACTIONS
import spatial_impl
import pipeline_runner

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

_DEFAULT_SCANS = str(Path(__file__).parent.parent / "data" / "scans")
SCANS_DIR = Path(os.getenv("SCANS_DIR", _DEFAULT_SCANS))

app = FastAPI(title="Project Atlas — Spatial Intelligence API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_SCANS_STATIC_DIR = Path(__file__).parent.parent / "data" / "scans"
if _SCANS_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_SCANS_STATIC_DIR)), name="static")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0", "service": "atlas-spatial"}


@app.get("/api/health/keys")
async def key_status():
    """Returns which LLM keys are configured (without revealing the values)."""
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    groq_key      = os.getenv("GROQ_API_KEY", "")
    return {
        "anthropic": bool(anthropic_key and anthropic_key != "your_key_here"),
        "groq":      bool(groq_key and groq_key != "your_key_here"),
    }


@app.get("/api/stream/query")
async def stream_query(scan_id: str, question: str):
    """SSE endpoint — streams Q&A answer token by token from Claude (or Groq fallback)."""
    import json as _json
    from fastapi.responses import StreamingResponse

    async def event_gen():
        try:
            async for chunk in spatial_impl.query_stream(scan_id, question):
                yield f"data: {_json.dumps({'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {_json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/api/spatial/action", response_model=SpatialResponse)
async def spatial_action(req: SpatialRequest):
    if req.action not in VALID_ACTIONS:
        return SpatialResponse(success=False, error=f"Unknown action: {req.action}")
    logger.info("action=%s payload_keys=%s", req.action, list(req.payload.keys()))
    return await spatial_impl.dispatch(req.action, req.payload)


@app.post("/api/spatial/upload")
async def upload_scan(files: list[UploadFile] = File(...), mode: str = "room"):
    if not files:
        raise HTTPException(status_code=400, detail="No files received")

    if mode not in ("room", "object"):
        mode = "room"

    # Detect upload type
    video_types = {"video/mp4", "video/quicktime", "video/x-msvideo", "video/avi", "video/mov"}
    is_video = any(f.content_type in video_types for f in files)
    is_images = not is_video and all(
        f.content_type and f.content_type.startswith("image/") for f in files
    )

    if not is_video and not is_images:
        # Fallback: guess by extension
        video_exts = {".mp4", ".mov", ".avi", ".mkv"}
        is_video = any(Path(f.filename or "").suffix.lower() in video_exts for f in files)
        is_images = not is_video

    # Object mode: 4+ images sufficient; room mode: 6+
    min_images = 4 if mode == "object" else 6
    if is_images and len(files) < min_images:
        raise HTTPException(status_code=400, detail=f"Upload at least {min_images} images")

    scan_id = f"scan_{int(time.time())}"
    scan_dir = SCANS_DIR / scan_id
    upload_dir = scan_dir / "upload"
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded files
    for f in files:
        safe_name = Path(f.filename or f"file_{int(time.time())}").name
        dest = upload_dir / safe_name
        dest.write_bytes(await f.read())
        logger.info("saved upload: %s (%d bytes)", dest, dest.stat().st_size)

    # Kick off background pipeline
    pipeline_runner.start(scan_id, upload_dir, scan_dir, is_video, mode=mode)

    return {
        "scan_id": scan_id,
        "files_received": len(files),
        "type": "video" if is_video else "images",
        "mode": mode,
    }


@app.get("/api/spatial/job/{scan_id}")
async def job_status(scan_id: str):
    job = pipeline_runner.get(scan_id)
    if job is None:
        # Check if scan exists on disk (from a previous server session)
        graph_path = SCANS_DIR / scan_id / "scene_graph.json"
        if graph_path.exists():
            import json
            graph     = json.loads(graph_path.read_text())
            splat_dir = SCANS_DIR / scan_id / "splat"
            pc_path   = SCANS_DIR / scan_id / "pointcloud" / "pointcloud.ply"
            return {
                "scan_id":        scan_id,
                "status":         "complete",
                "step":           "Complete",
                "objects_found":  len(graph.get("objects", [])),
                "frames_count":   0,
                "has_splat":      splat_dir.exists() and any(splat_dir.glob("*.ply")),
                "has_pointcloud": pc_path.exists(),
                "error":          None,
            }
        return {"scan_id": scan_id, "status": "not_found", "step": "", "has_splat": False, "has_pointcloud": False, "error": None}
    return {"scan_id": scan_id, **job}


# ── Point cloud PLY (colored, from DUSt3R or COLMAP sparse) ──────────────────
@app.get("/api/spatial/pointcloud/{scan_id}")
async def serve_pointcloud(scan_id: str):
    """Serve the colored point cloud PLY for a scan (DUSt3R or COLMAP sparse fallback)."""
    from fastapi.responses import FileResponse
    pc_path = SCANS_DIR / scan_id / "pointcloud" / "pointcloud.ply"
    if not pc_path.exists():
        raise HTTPException(status_code=404, detail="Point cloud not available for this scan")
    return FileResponse(
        str(pc_path),
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
    )


# ── Scan list ─────────────────────────────────────────────────────────────────
@app.get("/api/scans")
async def list_scans():
    """Return all scans in SCANS_DIR, newest first."""
    import json as _json
    if not SCANS_DIR.exists():
        return {"scans": []}
    results = []
    for scan_dir in sorted(SCANS_DIR.iterdir(), reverse=True):
        if not scan_dir.is_dir() or not scan_dir.name.startswith("scan_"):
            continue
        graph_path = scan_dir / "scene_graph.json"
        splat_dir  = scan_dir / "splat"
        status = "complete" if graph_path.exists() else "processing"
        objects_found = 0
        if graph_path.exists():
            try:
                g = _json.loads(graph_path.read_text())
                objects_found = len(g.get("objects", []))
            except Exception:
                pass
        has_splat      = splat_dir.exists() and any(splat_dir.glob("*.ply"))
        pc_path        = scan_dir / "pointcloud" / "pointcloud.ply"
        has_pointcloud = pc_path.exists()
        # Use the timestamp embedded in scan_id (scan_<unix>) to avoid mtime drift.
        # Validate > 2020-01-01 so "scan_001" (parses to epoch 1) falls back to ctime.
        try:
            ts = int(scan_dir.name.split("_", 1)[1])
            created_at = ts if ts > 1_577_836_800 else int(scan_dir.stat().st_ctime)
        except (IndexError, ValueError):
            try:
                created_at = int(scan_dir.stat().st_ctime)
            except Exception:
                created_at = 0
        # Also check in-memory pipeline jobs for still-running scans
        job = pipeline_runner.get(scan_dir.name)
        if job and job.get("status") not in ("complete", "error"):
            status = job.get("status", "processing")
        meta: dict = {}
        meta_path = scan_dir / "meta.json"
        if meta_path.exists():
            try:
                meta = _json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        results.append({
            "scan_id":        scan_dir.name,
            "name":           meta.get("name"),
            "status":         status,
            "objects_found":  objects_found,
            "has_splat":      has_splat,
            "has_pointcloud": has_pointcloud,
            "created_at":     created_at,
        })
    return {"scans": results}


# ── Serve .splat binary (PLY → antimatter15 format) ───────────────────────────
def _convert_ply_to_splat(ply_path: Path) -> bytes:
    """Convert 3DGS PLY → antimatter15 .splat (32 bytes/Gaussian). CPU-bound, run in thread."""
    import numpy as np
    data = ply_path.read_bytes()
    end  = data.index(b"end_header\n") + len(b"end_header\n")
    hdr  = data[:end].decode()
    props = [l.split()[-1] for l in hdr.splitlines() if l.startswith("property float")]
    N    = int([l for l in hdr.splitlines() if l.startswith("element vertex")][0].split()[-1])
    body = np.frombuffer(data[end:], dtype=np.float32).reshape(N, len(props))
    idx  = {p: i for i, p in enumerate(props)}

    SH_C0 = 0.28209479177387814
    def sigmoid(x): return 1.0 / (1.0 + np.exp(-np.clip(x, -80, 80)))

    x  = body[:, idx["x"]].astype(np.float32)
    y  = body[:, idx["y"]].astype(np.float32)
    z  = body[:, idx["z"]].astype(np.float32)
    s0 = np.exp(body[:, idx["scale_0"]]).astype(np.float32)
    s1 = np.exp(body[:, idx["scale_1"]]).astype(np.float32)
    s2 = np.exp(body[:, idx["scale_2"]]).astype(np.float32)
    r_f  = np.clip(sigmoid(SH_C0 * body[:, idx["f_dc_0"]] + 0.5), 0, 1)
    g_f  = np.clip(sigmoid(SH_C0 * body[:, idx["f_dc_1"]] + 0.5), 0, 1)
    b_f  = np.clip(sigmoid(SH_C0 * body[:, idx["f_dc_2"]] + 0.5), 0, 1)
    a_f  = np.clip(sigmoid(body[:, idx["opacity"]]), 0, 1)
    q0 = body[:, idx["rot_0"]]; q1 = body[:, idx["rot_1"]]
    q2 = body[:, idx["rot_2"]]; q3 = body[:, idx["rot_3"]]
    qn = np.sqrt(q0**2 + q1**2 + q2**2 + q3**2) + 1e-8

    floats = np.stack([x, y, z, s0, s1, s2], axis=1).astype(np.float32)
    u8rgba = np.clip(np.stack([r_f, g_f, b_f, a_f], axis=1) * 255, 0, 255).astype(np.uint8)
    u8rot  = np.clip(np.stack([q0/qn, q1/qn, q2/qn, q3/qn], axis=1) * 128 + 128, 0, 255).astype(np.uint8)

    out_arr = np.zeros((N, 32), dtype=np.uint8)
    out_arr[:, :24] = floats.view(np.uint8).reshape(N, 24)
    out_arr[:, 24:28] = u8rgba
    out_arr[:, 28:32] = u8rot
    return out_arr.tobytes()


@app.get("/api/spatial/splat/{scan_id}")
async def serve_splat(scan_id: str):
    """Convert splat.ply → .splat on demand, then redirect to the static file URL.
    StaticFiles works reliably in all browsers; direct binary Response hits browser quirks."""
    from fastapi.responses import RedirectResponse

    scan_dir   = SCANS_DIR / scan_id
    ply_path   = scan_dir / "splat" / "splat.ply"
    if not ply_path.exists():
        raise HTTPException(status_code=404, detail="No splat for this scan")

    cache_path = scan_dir / "splat" / "splat.splat"
    if not (cache_path.exists() and cache_path.stat().st_mtime >= ply_path.stat().st_mtime):
        content = await asyncio.to_thread(_convert_ply_to_splat, ply_path)
        try:
            cache_path.write_bytes(content)
        except Exception:
            pass

    # Redirect to the static file server — avoids browser quirks with large binary Responses
    return RedirectResponse(url=f"/static/{scan_id}/splat/splat.splat", status_code=302)


# ── Floor plan SVG ────────────────────────────────────────────────────────────
@app.get("/api/spatial/floor_plan/{scan_id}")
async def floor_plan(scan_id: str):
    """Generate and return an SVG floor plan for the given scan."""
    import sys, json as _json
    from fastapi.responses import Response

    scan_dir   = SCANS_DIR / scan_id
    graph_path = scan_dir / "scene_graph.json"
    if not graph_path.exists():
        raise HTTPException(status_code=404, detail="No scene graph for this scan")

    _engines = str(Path(__file__).parent.parent / "engines")
    if _engines not in sys.path:
        sys.path.insert(0, _engines)
    from rce.floor_plan import generate_svg

    graph = _json.loads(graph_path.read_text(encoding="utf-8"))
    svg   = await asyncio.to_thread(generate_svg, graph)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*"},
    )


# ── Export scan as zip ─────────────────────────────────────────────────────────
@app.get("/api/spatial/export/{scan_id}")
async def export_scan(scan_id: str):
    """Download scene_graph.json + splat.ply + summary.txt as a zip."""
    import io, zipfile, json as _json
    from fastapi.responses import StreamingResponse

    scan_dir = SCANS_DIR / scan_id
    if not scan_dir.exists():
        raise HTTPException(status_code=404, detail=f"Scan {scan_id} not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        graph_path = scan_dir / "scene_graph.json"
        if graph_path.exists():
            zf.write(graph_path, "scene_graph.json")

        splat_dir = scan_dir / "splat"
        if splat_dir.exists():
            for ply in splat_dir.glob("*.ply"):
                zf.write(ply, f"splat/{ply.name}")

        summary = f"SpazIntel Export — {scan_id}\nGenerated by Project Atlas\n\n"
        if graph_path.exists():
            try:
                g = _json.loads(graph_path.read_text())
                objs = g.get("objects", [])
                room = g.get("room_size", {})
                if room:
                    summary += f"Room: ~{room.get('width_m')}m × {room.get('depth_m')}m\n"
                summary += f"Objects detected: {len(objs)}\n\n"
                for obj in objs:
                    z = obj.get("position", {}).get("z_m")
                    depth = f" @ {z}m" if z else ""
                    summary += f"  - {obj['label']}{depth} (conf {round(obj.get('confidence', 0)*100)}%)\n"
                dists = g.get("distances", [])
                if dists:
                    summary += f"\nDistances ({len(dists)} pairs):\n"
                    for d in dists[:10]:
                        summary += f"  {d['from']} ↔ {d['to']}: {d['distance_m']}m\n"
            except Exception:
                pass
        zf.writestr("summary.txt", summary)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={scan_id}.zip"},
    )


# ── Multi-format export (OBJ / GLB) ──────────────────────────────────────────

def _parse_ply_gaussians(ply_path: Path, opacity_threshold: float = 0.05):
    """Return (x,y,z,r,g,b) numpy arrays from a 3DGS PLY, filtered by opacity."""
    import numpy as np
    data = ply_path.read_bytes()
    end  = data.index(b"end_header\n") + len(b"end_header\n")
    hdr  = data[:end].decode()
    props = [l.split()[-1] for l in hdr.splitlines() if l.startswith("property float")]
    N    = int([l for l in hdr.splitlines() if l.startswith("element vertex")][0].split()[-1])
    body = np.frombuffer(data[end:], dtype=np.float32).reshape(N, len(props))
    idx  = {p: i for i, p in enumerate(props)}

    SH_C0 = 0.28209479177387814
    def sigmoid(v): return 1.0 / (1.0 + np.exp(-np.clip(v, -80, 80)))

    a = sigmoid(body[:, idx["opacity"]])
    mask = a > opacity_threshold
    body = body[mask]

    x = body[:, idx["x"]]
    y = body[:, idx["y"]]
    z = body[:, idx["z"]]
    r = np.clip(sigmoid(SH_C0 * body[:, idx["f_dc_0"]] + 0.5), 0, 1)
    g = np.clip(sigmoid(SH_C0 * body[:, idx["f_dc_1"]] + 0.5), 0, 1)
    b = np.clip(sigmoid(SH_C0 * body[:, idx["f_dc_2"]] + 0.5), 0, 1)
    return x, y, z, r, g, b


def _ply_to_obj(ply_path: Path) -> bytes:
    x, y, z, r, g, b = _parse_ply_gaussians(ply_path)
    lines = [
        "# SpazIntel point-cloud export (vertex colors as v x y z r g b)",
        f"# {len(x)} points",
        "",
    ]
    for i in range(len(x)):
        lines.append(f"v {x[i]:.4f} {y[i]:.4f} {z[i]:.4f} {r[i]:.4f} {g[i]:.4f} {b[i]:.4f}")
    return "\n".join(lines).encode()


def _ply_to_glb(ply_path: Path, graph_path: Path | None = None) -> bytes:
    import numpy as np, json as _json, struct
    x, y, z, r, g, b = _parse_ply_gaussians(ply_path)
    n = len(x)

    pos_buf = np.stack([x, y, z], axis=1).astype(np.float32).tobytes()
    col_buf = np.stack([r, g, b], axis=1).astype(np.float32).tobytes()
    bin_data = pos_buf + col_buf
    bin_pad  = (4 - len(bin_data) % 4) % 4
    bin_data += b"\x00" * bin_pad

    nodes = [{"mesh": 0, "name": "point_cloud"}]

    # Optional: add scene-graph objects as named empty nodes
    if graph_path and graph_path.exists():
        try:
            graph = _json.loads(graph_path.read_text(encoding="utf-8"))
            for obj in graph.get("objects", []):
                wx = obj.get("world_x_m")
                wy = obj.get("world_y_m")
                wz = obj["position"].get("z_m")
                if None not in (wx, wy, wz):
                    nodes.append({
                        "name": obj["label"],
                        "translation": [float(wx), float(wy), float(wz)],
                    })
        except Exception:
            pass

    gltf = {
        "asset":  {"version": "2.0", "generator": "SpazIntel Atlas"},
        "scene":  0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes":  nodes,
        "meshes": [{"name": "point_cloud", "primitives": [{"attributes": {"POSITION": 0, "COLOR_0": 1}, "mode": 0}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3",
             "min": [float(x.min()), float(y.min()), float(z.min())],
             "max": [float(x.max()), float(y.max()), float(z.max())]},
            {"bufferView": 1, "componentType": 5126, "count": n, "type": "VEC3"},
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0,    "byteLength": n * 12},
            {"buffer": 0, "byteOffset": n*12, "byteLength": n * 12},
        ],
        "buffers": [{"byteLength": len(bin_data)}],
    }

    json_bytes = _json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_pad   = (4 - len(json_bytes) % 4) % 4
    json_bytes += b" " * json_pad

    json_chunk = struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    bin_chunk  = struct.pack("<II", len(bin_data),  0x004E4942) + bin_data
    total      = 12 + len(json_chunk) + len(bin_chunk)
    header     = struct.pack("<III", 0x46546C67, 2, total)
    return header + json_chunk + bin_chunk


@app.get("/api/spatial/export/{scan_id}/obj")
async def export_obj(scan_id: str):
    scan_dir = SCANS_DIR / scan_id
    ply_path = scan_dir / "splat" / "splat.ply"
    if not ply_path.exists():
        raise HTTPException(status_code=404, detail="No splat for this scan")
    from fastapi.responses import StreamingResponse
    import io
    content = await asyncio.to_thread(_ply_to_obj, ply_path)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename={scan_id}.obj"},
    )


@app.get("/api/spatial/export/{scan_id}/gltf")
async def export_gltf(scan_id: str):
    scan_dir   = SCANS_DIR / scan_id
    ply_path   = scan_dir / "splat" / "splat.ply"
    graph_path = scan_dir / "scene_graph.json"
    if not ply_path.exists():
        raise HTTPException(status_code=404, detail="No splat for this scan")
    from fastapi.responses import StreamingResponse
    import io
    content = await asyncio.to_thread(_ply_to_glb, ply_path, graph_path)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="model/gltf-binary",
        headers={"Content-Disposition": f"attachment; filename={scan_id}.glb"},
    )


# ── Live WebSocket scan ────────────────────────────────────────────────────────
@app.websocket("/ws/live/{session_id}")
async def live_scan_ws(websocket: WebSocket, session_id: str):
    """
    Real-time room scan via WebSocket.
    Client sends raw JPEG frames (binary); server returns JSON detections.
    Protocol:
      C → S: binary JPEG bytes
      S → C: {"detections": [...], "count": N, "session_id": "..."}
    """
    await websocket.accept()
    logger.info("live session=%s connected", session_id)

    import sys
    _engines = str(Path(__file__).parent.parent / "engines")
    if _engines not in sys.path:
        sys.path.insert(0, _engines)

    from rce.live_detect import process_live_frame

    try:
        while True:
            jpeg_bytes = await websocket.receive_bytes()
            detections = await asyncio.to_thread(process_live_frame, jpeg_bytes)
            await websocket.send_json({
                "session_id": session_id,
                "detections": detections,
                "count":      len(detections),
            })
    except WebSocketDisconnect:
        logger.info("live session=%s disconnected", session_id)
    except Exception as e:
        logger.error("live session=%s error: %s", session_id, e)
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
