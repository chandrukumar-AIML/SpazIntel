from pydantic import BaseModel
from typing import Any


class SpatialRequest(BaseModel):
    action: str
    payload: dict[str, Any] = {}


class SpatialResponse(BaseModel):
    success: bool
    data: dict[str, Any] = {}
    error: str | None = None


class ScanPayload(BaseModel):
    video_path: str
    location_id: str = "default"


class QueryPayload(BaseModel):
    scan_id: str
    question: str


class DiffPayload(BaseModel):
    scan_id_a: str
    scan_id_b: str
