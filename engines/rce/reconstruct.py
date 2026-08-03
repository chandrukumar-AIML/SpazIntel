"""
Stage 2: 3D Reconstruction — local pipeline
Replaces the Colab stub with local pycolmap + gsplat on RTX 4050.

pipeline:
  frames_dir → COLMAP (feature extract + match + sparse SfM) → gsplat train → splat.ply
"""
import logging
import shutil
import zipfile
from pathlib import Path

logger = logging.getLogger(__name__)


# ── COLMAP ────────────────────────────────────────────────────────────────────

def run_colmap(frames_dir: str, colmap_dir: str, sequential: bool = True) -> dict:
    """
    Run COLMAP structure-from-motion on a set of frames.
    Produces a sparse reconstruction in colmap_dir/sparse/0/.

    sequential=True  → sequential matching: O(N), correct for video walkthroughs.
                        Consecutive frames share the most overlap; this is fast and accurate.
    sequential=False → exhaustive matching: O(N²), for unordered photo sets.
                        Only needed when frame ordering doesn't reflect spatial proximity.

    Do NOT subsample frames — SIFT needs consecutive frames close together to match.
    Skipping frames creates motion gaps that break sequential and exhaust matching alike.
    """
    import pycolmap

    frames_dir  = Path(frames_dir)
    colmap_dir  = Path(colmap_dir)
    db_path     = colmap_dir / "database.db"
    sparse_dir  = colmap_dir / "sparse"
    colmap_dir.mkdir(parents=True, exist_ok=True)
    sparse_dir.mkdir(parents=True, exist_ok=True)

    n_frames = len(list(frames_dir.glob("*.jpg")) + list(frames_dir.glob("*.png")))
    logger.info("COLMAP: %d frames in %s", n_frames, frames_dir)

    logger.info("COLMAP: feature extraction")
    pycolmap.extract_features(
        database_path=str(db_path),
        image_path=str(frames_dir),
        camera_mode=pycolmap.CameraMode.SINGLE,
    )

    if sequential:
        logger.info("COLMAP: sequential matching (video walkthrough mode)")
        pycolmap.match_sequential(database_path=str(db_path))
    else:
        logger.info("COLMAP: exhaustive matching (photo set mode)")
        pycolmap.match_exhaustive(database_path=str(db_path))

    logger.info("COLMAP: incremental mapping")
    maps = pycolmap.incremental_mapping(
        database_path=str(db_path),
        image_path=str(frames_dir),
        output_path=str(sparse_dir),
    )

    if not maps:
        raise RuntimeError("COLMAP produced no reconstruction. Need 8+ frames with overlapping texture.")

    recon = maps[0]
    stats = {
        "cameras":  len(recon.cameras),
        "images":   len(recon.images),
        "points3D": len(recon.points3D),
        "sparse_dir": str(sparse_dir / "0"),
    }
    logger.info("COLMAP done: %d cameras, %d images, %d 3D points", stats["cameras"], stats["images"], stats["points3D"])
    return stats


# ── gsplat training ────────────────────────────────────────────────────────────

def train_splat(
    frames_dir: str,
    sparse_dir: str,
    splat_dir: str,
    max_steps: int = 3000,
) -> str:
    """
    Train a 3D Gaussian Splat from COLMAP sparse reconstruction + original frames.
    Uses gsplat (pip package) — runs on CUDA GPU.
    Returns path to output splat.ply.

    max_steps=3000 → ~5-8 min on RTX 4050 for a single room.
    For quick preview: 1000 steps (~2 min).
    """
    import torch
    import numpy as np

    frames_dir = Path(frames_dir)
    sparse_dir = Path(sparse_dir)
    splat_dir  = Path(splat_dir)
    splat_dir.mkdir(parents=True, exist_ok=True)

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA not available — gsplat requires a GPU.")

    # gsplat needs nvcc (CUDA Toolkit) to compile its CUDA extension at install time.
    # PyTorch's bundled CUDA runtime (cudart) is NOT enough.
    # Fix: install CUDA Toolkit 12.1 from developer.nvidia.com, then: pip install gsplat --no-cache-dir
    try:
        from gsplat.cuda._backend import _C as _gsplat_C
    except ImportError:
        _gsplat_C = None
    if _gsplat_C is None:
        raise RuntimeError(
            "gsplat CUDA extension not compiled (_C is None). "
            "You have PyTorch CUDA runtime but NOT the CUDA Toolkit (nvcc). "
            "Install CUDA Toolkit 12.1 from developer.nvidia.com/cuda-12-1-0-download-archive "
            "then run: pip install gsplat --no-cache-dir"
        )

    from gsplat import rasterization

    device = torch.device("cuda")
    logger.info("gsplat training on %s, max_steps=%d", device, max_steps)

    # Load COLMAP reconstruction
    import pycolmap
    recon = pycolmap.Reconstruction(str(sparse_dir))

    # Build initial point cloud from COLMAP sparse points
    if len(recon.points3D) < 10:
        raise RuntimeError(f"Too few COLMAP 3D points ({len(recon.points3D)}). Need more overlapping frames.")

    xyz_init   = np.array([[p.xyz[0], p.xyz[1], p.xyz[2]] for p in recon.points3D.values()], dtype=np.float32)
    rgb_init   = np.array([[p.color[0]/255, p.color[1]/255, p.color[2]/255] for p in recon.points3D.values()], dtype=np.float32)

    # Load images + camera parameters
    images_list, cameras_list = _load_colmap_cameras(recon, frames_dir)

    # Train
    ply_path = _train_gaussians(xyz_init, rgb_init, images_list, cameras_list, splat_dir, device, max_steps)
    logger.info("gsplat training complete → %s", ply_path)
    return str(ply_path)


def _load_colmap_cameras(recon, frames_dir: Path):
    """Extract image tensors and camera intrinsics/extrinsics from COLMAP reconstruction.

    pycolmap ≥ 3.9: img.cam_from_world() returns Rigid3d (world-to-cam).
    We invert to get cam-to-world (c2w) for the gsplat rasterizer.
    """
    import torch
    from PIL import Image
    import numpy as np

    images_list  = []
    cameras_list = []

    for img_id, img in recon.images.items():
        cam = recon.cameras[img.camera_id]
        frame_path = frames_dir / img.name
        if not frame_path.exists():
            continue

        pil = Image.open(frame_path).convert("RGB").resize((256, 144))
        rgb = np.array(pil, dtype=np.float32) / 255.0  # H×W×3

        # pycolmap 4.x API: cam_from_world() → Rigid3d (world-to-cam)
        cfw = img.cam_from_world()
        R_wc = np.array(cfw.rotation.matrix(), dtype=np.float32)   # world→cam rotation
        t_wc = np.array(cfw.translation,       dtype=np.float32)   # world→cam translation
        # Invert to cam-to-world
        c2w = np.eye(4, dtype=np.float32)
        c2w[:3, :3] = R_wc.T
        c2w[:3,  3] = -(R_wc.T @ t_wc)

        images_list.append(torch.from_numpy(rgb))
        cameras_list.append({
            "c2w":    torch.from_numpy(c2w),
            "fx":     cam.focal_length_x,
            "fy":     cam.focal_length_y,
            "cx":     cam.principal_point_x,
            "cy":     cam.principal_point_y,
            "width":  cam.width,
            "height": cam.height,
        })

    return images_list, cameras_list


def _train_gaussians(xyz_init, rgb_init, images_list, cameras_list, splat_dir, device, max_steps):
    """Core Gaussian training loop using gsplat."""
    import torch
    import torch.nn as nn
    from gsplat import rasterization

    N = len(xyz_init)
    means   = nn.Parameter(torch.from_numpy(xyz_init).to(device))
    scales  = nn.Parameter(torch.ones(N, 3, device=device) * -4.0)   # log scale
    quats   = nn.Parameter(torch.zeros(N, 4, device=device))
    quats.data[:, 0] = 1.0  # unit quaternion identity
    opacities = nn.Parameter(torch.zeros(N, 1, device=device))        # logit opacity
    colors    = nn.Parameter(torch.from_numpy(rgb_init).to(device))

    optimizer = torch.optim.Adam([
        {"params": means,     "lr": 1.6e-4},
        {"params": scales,    "lr": 5e-3},
        {"params": quats,     "lr": 1e-3},
        {"params": opacities, "lr": 5e-2},
        {"params": colors,    "lr": 2.5e-3},
    ])

    log_every = max(1, max_steps // 10)

    for step in range(max_steps):
        idx = step % len(images_list)
        gt_rgb = images_list[idx].to(device)
        cam    = cameras_list[idx]

        H, W = gt_rgb.shape[:2]
        viewmat = torch.linalg.inv(cam["c2w"]).to(device).unsqueeze(0)
        K = torch.tensor([[cam["fx"], 0, cam["cx"]],
                          [0, cam["fy"], cam["cy"]],
                          [0, 0, 1]], device=device, dtype=torch.float32).unsqueeze(0)

        render, alpha, _ = rasterization(
            means    = means,
            quats    = quats / (quats.norm(dim=-1, keepdim=True) + 1e-8),
            scales   = torch.exp(scales),
            opacities= torch.sigmoid(opacities).squeeze(-1),
            colors   = torch.sigmoid(colors),
            viewmats = viewmat,
            Ks       = K,
            width    = W,
            height   = H,
        )

        loss = nn.functional.l1_loss(render[0], gt_rgb)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()

        if step % log_every == 0:
            logger.info("gsplat step %d/%d loss=%.4f", step, max_steps, loss.item())

    # Save as PLY — standard 3DGS format:
    #   scale: log-scale (raw param, NOT exp'd)
    #   opacity: logit (raw param, NOT sigmoid'd)
    #   colors: SH DC coefficients = (RGB - 0.5) / SH_C0
    SH_C0 = 0.28209479177387814
    quats_norm = quats / (quats.norm(dim=-1, keepdim=True) + 1e-8)
    f_dc = (torch.sigmoid(colors) - 0.5) / SH_C0

    ply_path = splat_dir / "splat.ply"
    _save_ply(means.detach().cpu().numpy(),
              scales.detach().cpu().numpy(),            # log scale
              quats_norm.detach().cpu().numpy(),        # normalized wxyz
              opacities.detach().cpu().squeeze(-1).numpy(),  # logit
              f_dc.detach().cpu().numpy(),              # SH DC
              ply_path)
    return ply_path


def _save_ply(means, scales, quats, opacities, colors, ply_path: Path):
    """Write Gaussians as PLY for the Three.js splat viewer."""
    import struct

    N = len(means)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {N}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property float scale_0\nproperty float scale_1\nproperty float scale_2\n"
        "property float rot_0\nproperty float rot_1\nproperty float rot_2\nproperty float rot_3\n"
        "property float opacity\n"
        "property float f_dc_0\nproperty float f_dc_1\nproperty float f_dc_2\n"
        "end_header\n"
    )

    with open(ply_path, "wb") as f:
        f.write(header.encode())
        for i in range(N):
            row = (
                list(means[i]) +
                list(scales[i]) +
                list(quats[i]) +
                [opacities[i]] +
                list(colors[i])
            )
            f.write(struct.pack(f"{len(row)}f", *row))

    logger.info("saved %d Gaussians → %s (%.1f MB)", N, ply_path, ply_path.stat().st_size / 1e6)


# ── Colab helpers (kept for backward-compat) ──────────────────────────────────

def package_frames_for_colab(frames_dir: str, scan_dir: str) -> str:
    """Zip frames for Colab upload (legacy path)."""
    frames_dir = Path(frames_dir)
    zip_path = Path(scan_dir) / "frames_for_colab.zip"
    frame_files = sorted(frames_dir.glob("*.jpg"))
    if not frame_files:
        raise RuntimeError(f"No frames found in {frames_dir}")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in frame_files:
            zf.write(f, f"images/{f.name}")
    return str(zip_path)


def register_splat(scan_dir: str, splat_zip_path: str) -> dict:
    """Register a Colab-downloaded splat zip (legacy path)."""
    splat_dir = Path(scan_dir) / "splat"
    splat_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(splat_zip_path, "r") as z:
        z.extractall(splat_dir)
    splat_files = list(splat_dir.glob("*.splat")) + list(splat_dir.glob("*.ply"))
    if not splat_files:
        raise FileNotFoundError(f"No splat/ply after extracting {splat_zip_path}")
    return {"splat_dir": str(splat_dir), "splat_file": str(splat_files[0])}
