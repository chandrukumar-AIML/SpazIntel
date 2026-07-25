"""
Stage 2: Frames → 3D
COLMAP sparse reconstruction → gsplat Gaussian Splatting.
"""
import os
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

COLMAP_EXE = os.getenv("COLMAP_EXE", "colmap")


def run_colmap(frames_dir: str, output_dir: str) -> dict:
    """
    Run COLMAP feature extraction + matching + sparse reconstruction.
    Returns stats dict with num_images, num_points, output_path.
    """
    frames_dir = Path(frames_dir)
    output_dir = Path(output_dir)
    db_path = output_dir / "colmap.db"
    sparse_dir = output_dir / "sparse"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    _colmap_cmd(["feature_extractor",
                 "--database_path", str(db_path),
                 "--image_path", str(frames_dir),
                 "--ImageReader.single_camera", "1"])

    _colmap_cmd(["exhaustive_matcher",
                 "--database_path", str(db_path)])

    _colmap_cmd(["mapper",
                 "--database_path", str(db_path),
                 "--image_path", str(frames_dir),
                 "--output_path", str(sparse_dir)])

    logger.info("COLMAP sparse reconstruction done → %s", sparse_dir)
    return {"sparse_dir": str(sparse_dir), "db_path": str(db_path)}


def run_gsplat(colmap_output_dir: str, output_dir: str, iterations: int = 7000) -> dict:
    """
    Train Gaussian Splat from COLMAP output.
    Returns splat file path.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # gsplat training via nerfstudio / gsplat CLI
    cmd = [
        "python", "-m", "gsplat.train",
        "--data_dir", colmap_output_dir,
        "--output_dir", str(output_dir),
        "--iterations", str(iterations),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    logger.info("gsplat training done → %s", output_dir)
    return {"splat_dir": str(output_dir)}


def _colmap_cmd(args: list[str]) -> None:
    cmd = [COLMAP_EXE] + args
    logger.debug("running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"COLMAP failed:\n{result.stderr}")
