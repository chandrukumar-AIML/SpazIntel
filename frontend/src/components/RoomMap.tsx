import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { SceneObject } from "../lib/api";

interface Props { scanId: string }

const COLORS: Record<string, string> = {
  chair: "#6366f1", sofa: "#6366f1", couch: "#6366f1", bench: "#6366f1",
  table: "#f59e0b", desk: "#f59e0b", shelf: "#f59e0b", cabinet: "#f59e0b",
  tv: "#10b981", monitor: "#10b981", laptop: "#10b981", keyboard: "#10b981",
  door: "#ef4444", window: "#3b82f6",
  lamp: "#fbbf24", plant: "#22c55e",
  bed: "#a855f7", pillow: "#c084fc",
  refrigerator: "#06b6d4", microwave: "#0ea5e9",
};
const FALLBACK = "#71717a";
const PAD = 36;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 6;

export function RoomMap({ scanId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [objects, setObjects]   = useState<SceneObject[]>([]);
  const [hovered, setHovered]   = useState<SceneObject | null>(null);
  const [status, setStatus]     = useState<"loading" | "ok" | "error">("loading");

  // Pan/zoom stored in refs so draw() can always read latest without stale closure
  const pan  = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);

  // Drag state
  const dragging   = useRef(false);
  const dragStart  = useRef({ x: 0, y: 0 });
  const panAtDrag  = useRef({ x: 0, y: 0 });

  // Touch pinch state
  const lastPinchDist = useRef<number | null>(null);

  useEffect(() => {
    setStatus("loading");
    api.sceneGraph(scanId)
      .then(data => { setObjects(data.objects ?? []); setStatus("ok"); })
      .catch(() => setStatus("error"));
  }, [scanId]);

  // Redraw whenever objects or hovered changes
  useEffect(() => { draw(); }, [objects, hovered]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const z = zoom.current;
    const { x: px, y: py } = pan.current;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(z, z);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1 / z;
    for (let x = 0; x <= W; x += W / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += H / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Room outline
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Compass N
    ctx.font = `${10 / z}px system-ui`;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.textAlign = "center";
    ctx.fillText("N", W / 2, 14 / z);

    // Objects
    objects.forEach(obj => {
      const ox = PAD + obj.position.x_norm * (W - PAD * 2);
      const oy = PAD + obj.position.y_norm * (H - PAD * 2);
      const color = COLORS[obj.label] ?? FALLBACK;
      const isHov = hovered?.id === obj.id;
      const r = (isHov ? 13 : 9) / z;

      ctx.shadowColor = color;
      ctx.shadowBlur = (isHov ? 18 : 6) / z;

      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fillStyle = color + (isHov ? "ff" : "cc");
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(ox, oy, r + 3 / z, 0, Math.PI * 2);
      ctx.strokeStyle = color + "33";
      ctx.lineWidth = 2 / z;
      ctx.stroke();

      const lbl = obj.label.length > 9 ? obj.label.slice(0, 8) + "…" : obj.label;
      const fs = (isHov ? 10 : 9) / z;
      ctx.font = `${isHov ? "bold " : ""}${fs}px system-ui`;
      const tw = ctx.measureText(lbl).width;
      const ly = oy + r + 3 / z;

      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(ox - tw / 2 - 3 / z, ly, tw + 6 / z, 13 / z);
      ctx.fillStyle = isHov ? "#fff" : "rgba(255,255,255,0.75)";
      ctx.textAlign = "center";
      ctx.fillText(lbl, ox, ly + 10 / z);
    });

    ctx.restore();
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  function clientToWorld(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);
    return {
      x: (cx - pan.current.x) / zoom.current,
      y: (cy - pan.current.y) / zoom.current,
    };
  }

  function findHit(wx: number, wy: number): SceneObject | null {
    const canvas = canvasRef.current!;
    const W = canvas.width, H = canvas.height;
    const hitR = 16 / zoom.current;
    for (const o of objects) {
      const ox = PAD + o.position.x_norm * (W - PAD * 2);
      const oy = PAD + o.position.y_norm * (H - PAD * 2);
      if (Math.hypot(wx - ox, wy - oy) < hitR) return o;
    }
    return null;
  }

  // ── Mouse events ─────────────────────────────────────────────────────────

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    dragging.current  = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    panAtDrag.current = { ...pan.current };
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (dragging.current) {
      pan.current = {
        x: panAtDrag.current.x + (e.clientX - dragStart.current.x),
        y: panAtDrag.current.y + (e.clientY - dragStart.current.y),
      };
      draw();
      return;
    }
    if (!objects.length) return;
    const { x: wx, y: wy } = clientToWorld(e);
    setHovered(findHit(wx, wy));
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const moved = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
    dragging.current = false;
    if (moved < 4) {
      // treat as click — select hovered
      const { x: wx, y: wy } = clientToWorld(e);
      setHovered(findHit(wx, wy));
    }
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const delta  = e.deltaY < 0 ? 1.12 : 0.9;
    const newZ   = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.current * delta));
    const ratio  = newZ / zoom.current;
    pan.current  = { x: cx - ratio * (cx - pan.current.x), y: cy - ratio * (cy - pan.current.y) };
    zoom.current = newZ;
    draw();
  }

  // ── Touch events (pinch + drag) ────────────────────────────────────────

  function pinchDist(t: React.TouchList) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 1) {
      dragging.current  = true;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panAtDrag.current = { ...pan.current };
    } else if (e.touches.length === 2) {
      dragging.current     = false;
      lastPinchDist.current = pinchDist(e.touches);
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (e.touches.length === 1 && dragging.current) {
      pan.current = {
        x: panAtDrag.current.x + (e.touches[0].clientX - dragStart.current.x),
        y: panAtDrag.current.y + (e.touches[0].clientY - dragStart.current.y),
      };
      draw();
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const canvas = canvasRef.current!;
      const rect   = canvas.getBoundingClientRect();
      const dist   = pinchDist(e.touches);
      const ratio  = dist / lastPinchDist.current;
      const newZ   = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.current * ratio));
      const midX   = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) * (canvas.width  / rect.width);
      const midY   = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top)  * (canvas.height / rect.height);
      const r2     = newZ / zoom.current;
      pan.current  = { x: midX - r2 * (midX - pan.current.x), y: midY - r2 * (midY - pan.current.y) };
      zoom.current = newZ;
      lastPinchDist.current = dist;
      draw();
    }
  }

  function onTouchEnd() { dragging.current = false; lastPinchDist.current = null; }

  function resetView() { pan.current = { x: 0, y: 0 }; zoom.current = 1; draw(); }

  return (
    <div style={styles.wrap}>
      <div style={styles.topRow}>
        <div style={styles.label}>2D Room Map · {objects.length} objects</div>
        <div style={styles.controls}>
          <button style={styles.ctrl} onClick={() => { zoom.current = Math.min(MAX_ZOOM, zoom.current * 1.3); draw(); }}>+</button>
          <button style={styles.ctrl} onClick={() => { zoom.current = Math.max(MIN_ZOOM, zoom.current * 0.77); draw(); }}>−</button>
          <button style={styles.ctrl} onClick={resetView}>↺</button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={480}
        height={460}
        style={{ ...styles.canvas, cursor: dragging.current ? "grabbing" : "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { dragging.current = false; setHovered(null); }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {hovered ? (
        <div style={styles.tooltip}>
          <span style={{ ...styles.tooltipDot, background: COLORS[hovered.label] ?? FALLBACK }} />
          <strong>{hovered.label}</strong>
          <span style={styles.tooltipMeta}>
            x:{hovered.position.x_norm.toFixed(2)} y:{hovered.position.y_norm.toFixed(2)}
            {" · "}{Math.round(hovered.confidence * 100)}% conf
          </span>
        </div>
      ) : (
        <div style={styles.hint}>Scroll to zoom · Drag to pan · Pinch on touch</div>
      )}

      <div style={styles.legend}>
        {objects.map(o => (
          <div key={o.id} style={styles.chip}
            onMouseEnter={() => setHovered(o)}
            onMouseLeave={() => setHovered(null)}>
            <span style={{ ...styles.dot, background: COLORS[o.label] ?? FALLBACK }} />
            <span style={{ color: hovered?.id === o.id ? "var(--text)" : "var(--text-3)" }}>{o.label}</span>
          </div>
        ))}
      </div>

      {status === "loading" && <div style={styles.overlay}>Loading room data…</div>}
      {status === "error"   && <div style={styles.overlay}>Could not load scene graph</div>}
      {status === "ok" && !objects.length && <div style={styles.overlay}>No objects detected yet</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap:        { width:"100%", height:"100%", display:"flex", flexDirection:"column", gap:4, padding:"8px 12px", overflow:"hidden", position:"relative" },
  topRow:      { display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 },
  label:       { fontSize:11, color:"var(--text-3)", fontWeight:600 },
  controls:    { display:"flex", gap:4 },
  ctrl:        { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:4, width:24, height:24, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 },
  canvas:      { flex:1, width:"100%", height:"auto", borderRadius:"var(--radius)", minHeight:0, maxHeight:"calc(100% - 88px)", touchAction:"none" },
  tooltip:     { display:"flex", alignItems:"center", gap:6, fontSize:12, padding:"5px 10px", background:"var(--surface-2)", borderRadius:"var(--radius)", border:"1px solid var(--border)", flexShrink:0 },
  tooltipDot:  { width:8, height:8, borderRadius:"50%", flexShrink:0 },
  tooltipMeta: { color:"var(--text-3)", marginLeft:"auto", fontSize:11 },
  hint:        { fontSize:11, color:"var(--text-3)", textAlign:"center" as const, flexShrink:0 },
  legend:      { display:"flex", flexWrap:"wrap", gap:"2px 8px", flexShrink:0 },
  chip:        { display:"flex", alignItems:"center", gap:4, fontSize:10, cursor:"default", padding:"1px 4px", borderRadius:3 },
  dot:         { width:6, height:6, borderRadius:"50%", flexShrink:0 },
  overlay:     { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"var(--text-3)", pointerEvents:"none" },
};
