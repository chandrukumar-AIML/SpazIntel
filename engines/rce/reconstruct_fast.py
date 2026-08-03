"""
Fast 3D reconstruction engine — Stage 1 of 2.

Primary:  DUSt3R — 6-12 photos → dense colored point cloud in ~30s on RTX 4050.
          Pre-trained transformer; no per-scene training needed.
Fallback: COLMAP sparse point cloud after SfM runs.

DUSt3R is a research repo (no PyPI wheel). Installed at:
    git clone --recursive https://github.com/naver/dust3r C:/Users/kumar/models/dust3r
    pip install roma einops trimesh "huggingface-hub[torch]>=0.22"
Set DUST3R_DIR=C:/Users/kumar/models/dust3r in .env.
"""
import logging
import os
import struct
import sys
import time
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

DUST3R_MODEL = "naver/DUSt3R_ViTLarge_BaseDecoder_512_dpt"
MAX_POINTS = 200_000  # cap for browser rendering

_DUST3R_DIR = os.getenv("DUST3R_DIR", "")


def _inject_dust3r_path() -> bool:
    """Add DUSt3R repo to sys.path if DUST3R_DIR is set and the repo exists."""
    if not _DUST3R_DIR:
        return False
    p = Path(_DUST3R_DIR)
    if not (p / "dust3r").is_dir():
        return False
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
    return True


def dust3r_available() -> bool:
    _inject_dust3r_path()
    try:
        import dust3r  # noqa: F401
        return True
    except ImportError:
        return False


def run_fast_reconstruction(image_paths: list[str], output_dir: str) -> dict:
    """
    Stage 1 of 2: fast dense 3D point cloud from images.
    Returns {ply_path, point_count, method, elapsed_seconds}.
    Returns ply_path=None if DUSt3R is unavailable.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if dust3r_available():
        logger.info("DUSt3R available — running fast 3D reconstruction")
        return _run_dust3r(image_paths, output_dir)

    logger.info(
        "DUSt3R not installed. Install with: pip install dust3r  "
        "(skipping fast_3d — will fall back to COLMAP sparse after SfM)"
    )
    return {"ply_path": None, "point_count": 0, "method": "none", "elapsed_seconds": 0}


def _run_dust3r(image_paths: list[str], output_dir: Path) -> dict:
    _inject_dust3r_path()
    import torch
    from dust3r.inference import inference
    from dust3r.model import AsymmetricCroCo3DStereo
    from dust3r.utils.image import load_images
    from dust3r.cloud_opt import global_aligner, GlobalAlignerMode

    t0 = time.time()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("DUSt3R: loading model on %s", device)

    model = AsymmetricCroCo3DStereo.from_pretrained(DUST3R_MODEL).to(device)
    model.eval()

    images = load_images(image_paths, size=512)
    pairs  = [(images[i], images[j]) for i in range(len(images)) for j in range(i + 1, len(images))]

    logger.info("DUSt3R: inference on %d image pairs", len(pairs))
    with torch.no_grad():
        output = inference(pairs, model, device, batch_size=1)

    scene = global_aligner(output, device=device, mode=GlobalAlignerMode.PointCloudOptimizer)
    scene.compute_global_alignment(init="mst", niter=300, schedule="cosine", lr=0.01)

    import torch
    pts3d  = scene.get_pts3d()   # list of (H, W, 3) tensors
    masks  = scene.get_masks()   # list of (H, W) bool tensors — valid 3D points only
    colors = scene.imgs          # list of (H, W, 3) numpy float32 arrays in [0, 1]

    all_pts, all_rgb = [], []
    for pt, col, mask in zip(pts3d, colors, masks):
        if isinstance(pt,   torch.Tensor): pt   = pt.detach().cpu().numpy()
        if isinstance(mask, torch.Tensor): mask = mask.cpu().numpy().astype(bool)
        all_pts.append(pt[mask])
        all_rgb.append(col[mask])

    all_pts = np.concatenate(all_pts, axis=0).astype(np.float32)
    all_rgb = np.concatenate(all_rgb, axis=0).astype(np.float32)

    if len(all_pts) > MAX_POINTS:
        idx     = np.random.choice(len(all_pts), MAX_POINTS, replace=False)
        all_pts = all_pts[idx]
        all_rgb = all_rgb[idx]

    ply_path = output_dir / "pointcloud.ply"
    write_colored_ply(all_pts, all_rgb, ply_path)

    elapsed = time.time() - t0
    logger.info("DUSt3R: %d points → %s (%.1fs)", len(all_pts), ply_path, elapsed)
    return {
        "ply_path": str(ply_path),
        "point_count": len(all_pts),
        "method": "dust3r",
        "elapsed_seconds": round(elapsed, 1),
    }


def extract_colmap_pointcloud(sparse_dir: str, output_dir: str) -> dict:
    """
    Fallback: export COLMAP sparse point cloud as PLY.
    Called after COLMAP completes when DUSt3R was unavailable.
    Provides immediate 3D preview while gsplat training runs in background.
    """
    sparse_dir = Path(sparse_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        import pycolmap
        recon = pycolmap.Reconstruction(str(sparse_dir))

        if not recon.points3D:
            return {"ply_path": None, "point_count": 0, "method": "none", "elapsed_seconds": 0}

        pts = np.array(
            [[p.xyz[0], p.xyz[1], p.xyz[2]] for p in recon.points3D.values()],
            dtype=np.float32,
        )
        rgb = np.array(
            [[p.color[0] / 255.0, p.color[1] / 255.0, p.color[2] / 255.0] for p in recon.points3D.values()],
            dtype=np.float32,
        )

        ply_path = output_dir / "pointcloud.ply"
        write_colored_ply(pts, rgb, ply_path)
        logger.info("COLMAP sparse → %d pts → %s", len(pts), ply_path)
        return {
            "ply_path": str(ply_path),
            "point_count": len(pts),
            "method": "colmap_sparse",
            "elapsed_seconds": 0,
        }

    except Exception as e:
        logger.warning("COLMAP point cloud extraction failed: %s", e)
        return {"ply_path": None, "point_count": 0, "method": "none", "elapsed_seconds": 0}


def write_colored_ply(pts: np.ndarray, rgb: np.ndarray, path: Path) -> None:
    """Write XYZ + RGB8 point cloud to binary little-endian PLY."""
    rgb8 = (np.clip(rgb, 0.0, 1.0) * 255).astype(np.uint8)
    n    = len(pts)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {n}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        "end_header\n"
    ).encode()
    with open(path, "wb") as f:
        f.write(header)
        for i in range(n):
            x, y, z = pts[i]
            r, g, b = rgb8[i]
            f.write(struct.pack("<3fBBB", float(x), float(y), float(z), int(r), int(g), int(b)))
    logger.info("PLY: %d pts → %s (%.1f MB)", n, path, path.stat().st_size / 1e6)
