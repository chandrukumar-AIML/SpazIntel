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


@app.post("/api/spatial/action", response_model=SpatialResponse)
async def spatial_action(req: SpatialRequest):
    if req.action not in VALID_ACTIONS:
        return SpatialResponse(success=False, error=f"Unknown action: {req.action}")
    logger.info("action=%s payload_keys=%s", req.action, list(req.payload.keys()))
    return await spatial_impl.dispatch(req.action, req.payload)


@app.post("/api/spatial/upload")
async def upload_scan(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files received")

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

    if is_images and len(files) < 6:
        raise HTTPException(status_code=400, detail="Upload at least 6 images for a good scan")

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
    pipeline_runner.start(scan_id, upload_dir, scan_dir, is_video)

    return {
        "scan_id": scan_id,
        "files_received": len(files),
        "type": "video" if is_video else "images",
    }


@app.get("/api/spatial/job/{scan_id}")
async def job_status(scan_id: str):
    job = pipeline_runner.get(scan_id)
    if job is None:
        # Check if scan exists on disk (from a previous server session)
        graph_path = SCANS_DIR / scan_id / "scene_graph.json"
        if graph_path.exists():
            import json
            graph = json.loads(graph_path.read_text())
            splat_dir = SCANS_DIR / scan_id / "splat"
            has_splat = splat_dir.exists() and any(splat_dir.glob("*.ply"))
            return {
                "scan_id":      scan_id,
                "status":       "complete",
                "step":         "Complete",
                "objects_found": len(graph.get("objects", [])),
                "frames_count": 0,
                "has_splat":    has_splat,
                "error":        None,
            }
        return {"scan_id": scan_id, "status": "not_found", "step": "", "has_splat": False, "error": None}
    return {"scan_id": scan_id, **job}


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
        has_splat = splat_dir.exists() and any(splat_dir.glob("*.ply"))
        try:
            created_at = int(scan_dir.stat().st_mtime)
        except Exception:
            created_at = 0
        # Also check in-memory pipeline jobs for still-running scans
        job = pipeline_runner.get(scan_dir.name)
        if job and job.get("status") not in ("complete", "error"):
            status = job.get("status", "processing")
        results.append({
            "scan_id":      scan_dir.name,
            "status":       status,
            "objects_found": objects_found,
            "has_splat":    has_splat,
            "created_at":   created_at,
        })
    return {"scans": results}


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
