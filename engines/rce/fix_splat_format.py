"""
One-time converter: re-saves a splat.ply written with activated values
(linear scale, sigmoid opacity, direct RGB) into the standard 3DGS format
(log scale, logit opacity, SH-DC colors) that WebGL viewers expect.

Usage:
    python fix_splat_format.py <path_to_splat.ply>
"""
import struct
import sys
import numpy as np
from pathlib import Path

SH_C0 = 0.28209479177387814


def parse_ply_header(data: bytes):
    """Returns (header_str, body_offset, properties_in_order)."""
    end = data.index(b"end_header\n") + len(b"end_header\n")
    header = data[:end].decode()
    props = []
    for line in header.splitlines():
        if line.startswith("property float "):
            props.append(line.split()[-1])
    count_line = [l for l in header.splitlines() if l.startswith("element vertex")]
    count = int(count_line[0].split()[-1])
    return header, end, props, count


def fix_ply(path: Path):
    data = path.read_bytes()
    header_str, body_offset, props, N = parse_ply_header(data)

    n_floats = len(props)
    body = np.frombuffer(data[body_offset:], dtype=np.float32).reshape(N, n_floats)

    idx = {p: i for i, p in enumerate(props)}

    def col(name):
        return body[:, idx[name]]

    # Detect if already converted: log-scale values should be mostly negative
    s0 = col("scale_0")
    if s0.mean() < 0:
        print(f"[skip] {path} — already in log-scale format (mean scale={s0.mean():.3f})")
        return

    print(f"[converting] {path}  N={N:,}  scale_mean={s0.mean():.4f}")

    out = body.copy()

    # scale: log(linear)
    for k in ("scale_0", "scale_1", "scale_2"):
        out[:, idx[k]] = np.log(np.clip(body[:, idx[k]], 1e-8, None))

    # opacity: logit(sigmoid) → original logit
    p = np.clip(col("opacity"), 1e-6, 1 - 1e-6)
    out[:, idx["opacity"]] = np.log(p / (1 - p))

    # colors: SH DC = (RGB - 0.5) / SH_C0
    for k in ("f_dc_0", "f_dc_1", "f_dc_2"):
        out[:, idx[k]] = (body[:, idx[k]] - 0.5) / SH_C0

    # Write back same header + converted body
    body_bytes = out.astype(np.float32).tobytes()
    path.write_bytes(data[:body_offset] + body_bytes)
    print(f"[done] saved → {path}  ({path.stat().st_size/1e6:.1f} MB)")
    print(f"       new scale mean: {out[:, idx['scale_0']].mean():.3f}  "
          f"opacity mean: {out[:, idx['opacity']].mean():.3f}")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not target or not target.exists():
        print("Usage: python fix_splat_format.py <splat.ply>")
        sys.exit(1)
    fix_ply(target)
