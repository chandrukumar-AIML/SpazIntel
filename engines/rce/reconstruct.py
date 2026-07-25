"""
Stage 2: Frames → 3D
Hybrid pipeline:
  - COLMAP runs locally (CPU mode — no GPU needed)
  - gsplat trains on Google Colab (free T4) via docs/colab_gsplat_train.ipynb
"""
import os
import zipfile
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

COLMAP_EXE = os.getenv("COLMAP_EXE", "colmap")


def run_colmap(frames_dir: str, output_dir: str) -> dict:
    """
    Run COLMAP feature extraction + matching + sparse reconstruction.
    CPU mode — no GPU required.
    Returns: {sparse_dir, db_path, colmap_zip} where colmap_zip is ready for Colab upload.
    """
    frames_dir = Path(frames_dir)
    output_dir = Path(output_dir)
    db_path = output_dir / "colmap.db"
    sparse_dir = output_dir / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    logger.info("COLMAP: feature extraction on %d frames", len(list(frames_dir.glob("*.jpg"))))
    _colmap("feature_extractor",
            "--database_path", str(db_path),
            "--image_path", str(frames_dir),
            "--ImageReader.single_camera", "1",
            "--SiftExtraction.use_gpu", "0")

    logger.info("COLMAP: exhaustive matching")
    _colmap("exhaustive_matcher",
            "--database_path", str(db_path),
            "--SiftMatching.use_gpu", "0")

    logger.info("COLMAP: sparse reconstruction")
    _colmap("mapper",
            "--database_path", str(db_path),
            "--image_path", str(frames_dir),
            "--output_path", str(sparse_dir))

    # Zip colmap output for Colab upload
    colmap_zip = output_dir / "colmap_output.zip"
    _zip_colmap_output(frames_dir, output_dir, colmap_zip)

    logger.info("COLMAP done → %s | Colab zip → %s", sparse_dir, colmap_zip)
    return {
        "sparse_dir": str(sparse_dir),
        "db_path": str(db_path),
        "colmap_zip": str(colmap_zip),
    }


def register_splat(scan_dir: str, splat_zip_path: str) -> dict:
    """
    Register a gsplat result downloaded from Colab into the local scan folder.
    Call this after downloading splat_result.zip from Colab.
    """
    scan_dir = Path(scan_dir)
    splat_dir = scan_dir / "splat"
    splat_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(splat_zip_path, "r") as z:
        z.extractall(splat_dir)

    splat_files = list(splat_dir.glob("*.splat")) + list(splat_dir.glob("*.ply"))
    if not splat_files:
        raise FileNotFoundError(f"No .splat or .ply file found after extracting {splat_zip_path}")

    logger.info("splat registered → %s", splat_dir)
    return {"splat_dir": str(splat_dir), "splat_file": str(splat_files[0])}


def _zip_colmap_output(frames_dir: Path, colmap_dir: Path, zip_path: Path) -> None:
    """Package frames + colmap output into a single zip for Colab upload."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Include frames
        for f in sorted(frames_dir.glob("*.jpg")):
            zf.write(f, f"images/{f.name}")
        # Include sparse reconstruction
        for f in colmap_dir.rglob("*"):
            if f.is_file() and f.suffix != ".zip":
                zf.write(f, f.relative_to(colmap_dir))
    logger.info("colmap_output.zip created: %.1f MB", zip_path.stat().st_size / 1e6)


def _colmap(*args: str) -> None:
    cmd = [COLMAP_EXE, *args]
    logger.debug("$ %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"COLMAP failed ({args[0]}):\n{result.stderr[-1000:]}")
