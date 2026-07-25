"""
Stage 1: Video → Frames
Extract frames from a room walkthrough video at a target FPS.
"""
import os
import cv2
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_FPS = 2.0
MIN_BLUR_THRESHOLD = 100.0  # Laplacian variance — below this = blurry, skip


def extract_frames(
    video_path: str,
    output_dir: str,
    fps: float = DEFAULT_FPS,
    skip_blurry: bool = True,
) -> list[str]:
    """
    Extract frames from video at target FPS.
    Returns list of saved frame paths (sorted).
    """
    video_path = Path(video_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = max(1, int(video_fps / fps))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    logger.info("video_fps=%.1f target_fps=%.1f interval=%d total_frames=%d", video_fps, fps, frame_interval, total_frames)

    saved = []
    frame_idx = 0
    saved_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            if skip_blurry and _is_blurry(frame):
                logger.debug("frame %d skipped (blurry)", frame_idx)
            else:
                out_path = output_dir / f"frame_{saved_idx:05d}.jpg"
                cv2.imwrite(str(out_path), frame)
                saved.append(str(out_path))
                saved_idx += 1

        frame_idx += 1

    cap.release()
    logger.info("extracted %d frames to %s", len(saved), output_dir)
    return saved


def _is_blurry(frame, threshold: float = MIN_BLUR_THRESHOLD) -> bool:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var() < threshold
