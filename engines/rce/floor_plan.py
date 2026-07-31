"""
Floor plan SVG generator from scene_graph.json.
Uses world_x_m / world_y_m for accurate metric placement.
Falls back to x_norm / y_norm scaled by room_size when world coords absent.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any

COLORS: dict[str, str] = {
    "chair": "#6366f1", "sofa": "#6366f1", "couch": "#6366f1", "bench": "#6366f1",
    "table": "#f59e0b", "desk": "#f59e0b", "shelf": "#f59e0b", "cabinet": "#f59e0b",
    "tv": "#10b981", "monitor": "#10b981", "laptop": "#10b981", "keyboard": "#10b981",
    "door": "#ef4444", "window": "#3b82f6",
    "lamp": "#fbbf24", "plant": "#22c55e",
    "bed": "#a855f7", "pillow": "#c084fc",
    "refrigerator": "#06b6d4", "microwave": "#0ea5e9",
}
FALLBACK = "#71717a"

# Typical top-down footprint (width_m × depth_m)
FOOTPRINTS: dict[str, tuple[float, float]] = {
    "sofa": (2.0, 0.9), "couch": (2.0, 0.9), "bench": (1.5, 0.5),
    "chair": (0.6, 0.6),
    "table": (1.2, 0.8), "desk": (1.4, 0.7),
    "bed": (1.6, 2.0),
    "tv": (1.2, 0.15), "monitor": (0.5, 0.15),
    "laptop": (0.4, 0.3), "keyboard": (0.5, 0.15),
    "shelf": (0.9, 0.4), "cabinet": (0.8, 0.5),
    "refrigerator": (0.7, 0.7), "microwave": (0.5, 0.4),
    "door": (0.9, 0.1), "window": (1.0, 0.1),
    "plant": (0.4, 0.4), "lamp": (0.3, 0.3), "pillow": (0.5, 0.5),
}
DEFAULT_FP = (0.5, 0.5)

CANVAS  = 600   # SVG canvas px (square)
MARGIN  = 52    # px margin around room rect
WALL_PX = 5     # wall stroke width


def generate_svg(graph: dict[str, Any]) -> str:
    objects   = graph.get("objects", [])
    room_size = graph.get("room_size")
    scan_id   = graph.get("scan_id", "")

    room_w = float(room_size["width_m"]) if room_size else 5.0
    room_d = float(room_size["depth_m"]) if room_size else 5.0

    usable  = CANVAS - 2 * MARGIN
    scale   = usable / max(room_w, room_d)   # px per metre
    room_px_w = room_w * scale
    room_px_d = room_d * scale
    room_x  = MARGIN + (usable - room_px_w) / 2
    room_y  = MARGIN + (usable - room_px_d) / 2

    def world_to_svg(wx: float, wy: float) -> tuple[float, float]:
        # World: x = right, y = forward (away from camera).
        # Floor plan: SVG x right, SVG y down — so flip Y.
        sx = room_x + room_px_w / 2 + wx * scale
        sy = room_y + room_px_d / 2 - wy * scale
        return sx, sy

    L: list[str] = []

    # Background
    L.append(f'<rect width="{CANVAS}" height="{CANVAS}" fill="#0c0c0c"/>')

    # Grid (1 m increments)
    L.append('<g stroke="rgba(255,255,255,0.04)" stroke-width="0.5">')
    x = room_x
    while x <= room_x + room_px_w + 0.5:
        L.append(f'<line x1="{x:.1f}" y1="{room_y:.1f}" x2="{x:.1f}" y2="{room_y+room_px_d:.1f}"/>')
        x += scale
    y = room_y
    while y <= room_y + room_px_d + 0.5:
        L.append(f'<line x1="{room_x:.1f}" y1="{y:.1f}" x2="{room_x+room_px_w:.1f}" y2="{y:.1f}"/>')
        y += scale
    L.append('</g>')

    # Room fill + walls
    L.append(
        f'<rect x="{room_x:.1f}" y="{room_y:.1f}" '
        f'width="{room_px_w:.1f}" height="{room_px_d:.1f}" '
        f'fill="rgba(255,255,255,0.025)" '
        f'stroke="rgba(255,255,255,0.65)" stroke-width="{WALL_PX}"/>'
    )

    # Dimension — bottom (width)
    dim_y = room_y + room_px_d + 22
    cx    = room_x + room_px_w / 2
    L.append(
        f'<line x1="{room_x:.1f}" y1="{dim_y:.0f}" x2="{room_x+room_px_w:.1f}" y2="{dim_y:.0f}" '
        f'stroke="#555" stroke-width="1"/>'
    )
    for px in (room_x, room_x + room_px_w):
        L.append(f'<line x1="{px:.1f}" y1="{dim_y-5:.0f}" x2="{px:.1f}" y2="{dim_y+5:.0f}" stroke="#555" stroke-width="1"/>')
    L.append(
        f'<text x="{cx:.1f}" y="{dim_y+14:.0f}" fill="#888" font-size="11" '
        f'text-anchor="middle" font-family="system-ui,sans-serif">{room_w}m</text>'
    )

    # Dimension — right side (depth)
    dim_x = room_x + room_px_w + 22
    cy    = room_y + room_px_d / 2
    L.append(
        f'<line x1="{dim_x:.0f}" y1="{room_y:.1f}" x2="{dim_x:.0f}" y2="{room_y+room_px_d:.1f}" '
        f'stroke="#555" stroke-width="1"/>'
    )
    for py in (room_y, room_y + room_px_d):
        L.append(f'<line x1="{dim_x-5:.0f}" y1="{py:.1f}" x2="{dim_x+5:.0f}" y2="{py:.1f}" stroke="#555" stroke-width="1"/>')
    L.append(
        f'<text x="{dim_x+14:.0f}" y="{cy:.1f}" fill="#888" font-size="11" '
        f'text-anchor="middle" font-family="system-ui,sans-serif" '
        f'transform="rotate(90,{dim_x+14:.0f},{cy:.1f})">{room_d}m</text>'
    )

    # Objects
    for obj in objects:
        wx = obj.get("world_x_m")
        wy = obj.get("world_y_m")
        if wx is None or wy is None:
            pos = obj.get("position", {})
            wx  = (pos.get("x_norm", 0.5) - 0.5) * room_w
            wy  = (0.5 - pos.get("y_norm", 0.5)) * room_d

        sx, sy = world_to_svg(float(wx), float(wy))
        label  = obj.get("label", "?")
        color  = COLORS.get(label, FALLBACK)
        fw, fd = FOOTPRINTS.get(label, DEFAULT_FP)
        fpx, fpy = fw * scale, fd * scale
        rx, ry   = sx - fpx / 2, sy - fpy / 2

        # Footprint rect
        L.append(
            f'<rect x="{rx:.1f}" y="{ry:.1f}" width="{fpx:.1f}" height="{fpy:.1f}" '
            f'fill="{color}2a" stroke="{color}" stroke-width="1.5" rx="2"/>'
        )
        # Centre dot
        L.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="3" fill="{color}"/>')
        # Label above footprint
        text_y = ry - 5
        L.append(
            f'<text x="{sx:.1f}" y="{text_y:.1f}" fill="{color}" font-size="9" '
            f'font-weight="600" text-anchor="middle" font-family="system-ui,sans-serif">{label}</text>'
        )

    # Compass (top-left corner)
    cn_x, cn_y = MARGIN / 2, MARGIN / 2
    L.append(
        f'<text x="{cn_x:.0f}" y="{cn_y+5:.0f}" fill="rgba(255,255,255,0.35)" '
        f'font-size="11" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">N↑</text>'
    )

    # Scale bar — bottom-left, 1 m
    bar_x, bar_y = float(MARGIN), float(CANVAS - 18)
    L.append(
        f'<line x1="{bar_x:.0f}" y1="{bar_y:.0f}" x2="{bar_x+scale:.0f}" y2="{bar_y:.0f}" '
        f'stroke="rgba(255,255,255,0.45)" stroke-width="2"/>'
    )
    for bx in (bar_x, bar_x + scale):
        L.append(f'<line x1="{bx:.0f}" y1="{bar_y-4:.0f}" x2="{bx:.0f}" y2="{bar_y+4:.0f}" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>')
    L.append(
        f'<text x="{bar_x+scale/2:.0f}" y="{bar_y-7:.0f}" fill="rgba(255,255,255,0.35)" '
        f'font-size="9" text-anchor="middle" font-family="system-ui,sans-serif">1m</text>'
    )

    # Title
    L.append(
        f'<text x="{CANVAS/2:.0f}" y="16" fill="rgba(255,255,255,0.25)" font-size="10" '
        f'text-anchor="middle" font-family="system-ui,sans-serif">SpazIntel · {scan_id} · floor plan</text>'
    )
    # Object count bottom-right
    L.append(
        f'<text x="{CANVAS-10:.0f}" y="{CANVAS-10:.0f}" fill="rgba(255,255,255,0.18)" '
        f'font-size="9" text-anchor="end" font-family="system-ui,sans-serif">{len(objects)} objects</text>'
    )

    body = "\n".join(L)
    return (
        f'<svg viewBox="0 0 {CANVAS} {CANVAS}" '
        f'xmlns="http://www.w3.org/2000/svg" '
        f'width="{CANVAS}" height="{CANVAS}">\n'
        f'{body}\n'
        f'</svg>'
    )


def generate_from_path(scene_graph_path: Path) -> str:
    graph = json.loads(scene_graph_path.read_text(encoding="utf-8"))
    return generate_svg(graph)
