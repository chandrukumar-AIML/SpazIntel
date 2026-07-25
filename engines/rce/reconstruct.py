"""
Stage 2: 3D Reconstruction — Colab Hybrid

Local step: package frames into a zip for upload.
Heavy step (COLMAP + gsplat): runs on Google Colab T4 GPU.
  → Use docs/colab_gsplat_train.ipynb

Local step: register downloaded splat result into scan folder.
"""
import zipfile
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def package_frames_for_colab(frames_dir: str, scan_dir: str) -> str:
    """
    Zip extracted frames so they can be uploaded to Colab.
    Returns path to the zip file.
    """
    frames_dir = Path(frames_dir)
    zip_path = Path(scan_dir) / "frames_for_colab.zip"

    frame_files = sorted(frames_dir.glob("*.jpg"))
    if not frame_files:
        raise RuntimeError(f"No frames found in {frames_dir}")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in frame_files:
            zf.write(f, f"images/{f.name}")

    size_mb = zip_path.stat().st_size / 1e6
    logger.info("packaged %d frames → %s (%.1f MB)", len(frame_files), zip_path, size_mb)
    return str(zip_path)


def register_splat(scan_dir: str, splat_zip_path: str) -> dict:
    """
    Register a gsplat result downloaded from Colab into the local scan folder.
    Call this after downloading splat_result.zip from the Colab notebook.
    """
    splat_dir = Path(scan_dir) / "splat"
    splat_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(splat_zip_path, "r") as z:
        z.extractall(splat_dir)

    splat_files = list(splat_dir.glob("*.splat")) + list(splat_dir.glob("*.ply"))
    if not splat_files:
        raise FileNotFoundError(f"No .splat or .ply file found after extracting {splat_zip_path}")

    logger.info("splat registered → %s", splat_dir)
    return {"splat_dir": str(splat_dir), "splat_file": str(splat_files[0])}
