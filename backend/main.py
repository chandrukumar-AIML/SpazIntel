import os
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from models import SpatialRequest, SpatialResponse
from constants import VALID_ACTIONS
import spatial_impl

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

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
