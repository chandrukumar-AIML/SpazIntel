import os
import time
import logging
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from models import SpatialRequest, SpatialResponse
from constants import VALID_ACTIONS
import spatial_impl
import pipeline_runner

load_dotenv()

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

_SPLAT_DIR = Path(__file__).parent.parent / "data" / "scans" / "scan_001" / "splat"
if _SPLAT_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_SPLAT_DIR)), name="static")


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
            return {
                "scan_id": scan_id,
                "status": "complete",
                "step": "Complete",
                "objects_found": len(graph.get("objects", [])),
                "frames_count": 0,
                "error": None,
            }
        return {"scan_id": scan_id, "status": "not_found", "step": "", "error": None}
    return {"scan_id": scan_id, **job}
