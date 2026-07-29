import React, { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../lib/api";
import type { SceneObject } from "../lib/api";

interface Props { scanId: string }

interface SceneGraph {
  objects: SceneObject[];
  structure: unknown;
  distances?: { from: string; to: string; distance_m: number }[];
  room_size?: { width_m: number; depth_m: number };
}

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
  const [graph, setGraph]       = useState<SceneGraph | null>(null);
  const [hovered, setHovered]   = useState<SceneObject | null>(null);
  const [status, setStatus]     = useState<"loading" | "ok" | "error">("loading");

  // Measure mode: click two objects → show distance
  const [measureA, setMeasureA] = useState<SceneObject | null>(null);
  const [measureB, setMeasureB] = useState<SceneObject | null>(null);
  const [measured, setMeasured] = useState<{ dist: number; fromLabel: string; toLabel: string } | null>(null);

  const pan  = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);
  const dragging      = useRef(false);
  const dragStart     = useRef({ x: 0, y: 0 });
  const panAtDrag     = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);

  const objects = graph?.objects ?? [];
  const distances = graph?.distances ?? [];
  const roomSize  = graph?.room_size;

  useEffect(() => {
    setStatus("loading");
    setMeasureA(null); setMeasureB(null); setMeasured(null);
    api.sceneGraph(scanId)
      .then(data => { setGraph(data as unknown as SceneGraph); setStatus("ok"); })
      .catch(() => setStatus("error"));
  }, [scanId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const z = zoom.current;
    const { x: px, y: py } = pan.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(z, z);

    // Metric grid — estimate 1m grid spacing in canvas pixels
    const gridPx = roomSize ? (W - PAD * 2) / roomSize.width_m : 60;
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1 / z;
    for (let gx = 0; gx <= W; gx += gridPx) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy <= H; gy += gridPx) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // Room outline
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Compass N
    ctx.font = `${10 / z}px system-ui`;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.textAlign = "center";
    ctx.fillText("N", W / 2, 14 / z);

    // Scale bar bottom-left (1m reference)
    if (gridPx > 10) {
      const barX = PAD, barY = H - 14 / z;
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.moveTo(barX, barY); ctx.lineTo(barX + gridPx, barY); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = `${9 / z}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText("1m", barX + gridPx / 2, barY - 3 / z);
    }

    // Measure line between measureA and measureB
    if (measureA && measureB) {
      const getXY = (o: SceneObject) => ({
        x: PAD + o.position.x_norm * (W - PAD * 2),
        y: PAD + o.position.y_norm * (H - PAD * 2),
      });
      const pa = getXY(measureA);
      const pb = getXY(measureB);
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Objects
    objects.forEach(obj => {
      const ox = PAD + obj.position.x_norm * (W - PAD * 2);
      const oy = PAD + obj.position.y_norm * (H - PAD * 2);
      const color = COLORS[obj.label] ?? FALLBACK;
      const isHov = hovered?.id === obj.id;
      const isMeasA = measureA?.id === obj.id;
      const isMeasB = measureB?.id === obj.id;
      const r = (isHov || isMeasA || isMeasB ? 13 : 9) / z;

      ctx.shadowColor = isMeasA || isMeasB ? "#fbbf24" : color;
      ctx.shadowBlur = (isHov || isMeasA || isMeasB ? 18 : 6) / z;

      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.fillStyle = isMeasA || isMeasB ? "#fbbf24" : color + (isHov ? "ff" : "cc");
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(ox, oy, r + 3 / z, 0, Math.PI * 2);
      ctx.strokeStyle = (isMeasA || isMeasB ? "#fbbf24" : color) + "33";
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
  }, [objects, hovered, measureA, measureB, roomSize]);

  useEffect(() => { draw(); }, [draw]);

  // ── coordinate helpers ────────────────────────────────────────────────────

  function clientToWorld(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width  / rect.width);
    const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);
    return { x: (cx - pan.current.x) / zoom.current, y: (cy - pan.current.y) / zoom.current };
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

  // ── measure distance lookup ────────────────────────────────────────────────

  function lookupDistance(a: SceneObject, b: SceneObject) {
    const pair = distances.find(
      d => (d.from === a.label && d.to === b.label) ||
           (d.from === b.label && d.to === a.label)
    );
    return pair ? pair.distance_m : null;
  }

  function handleMeasureClick(obj: SceneObject) {
    if (!measureA) {
      setMeasureA(obj); setMeasureB(null); setMeasured(null);
    } else if (measureA.id === obj.id) {
      setMeasureA(null); setMeasured(null);
    } else {
      setMeasureB(obj);
      const d = lookupDistance(measureA, obj);
      setMeasured(d !== null ? { dist: d, fromLabel: measureA.label, toLabel: obj.label } : null);
    }
  }

  // ── mouse events ──────────────────────────────────────────────────────────

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
      draw(); return;
    }
    if (!objects.length) return;
    const { x: wx, y: wy } = clientToWorld(e);
    setHovered(findHit(wx, wy));
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const moved = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
    dragging.current = false;
    if (moved < 4) {
      const { x: wx, y: wy } = clientToWorld(e);
      const hit = findHit(wx, wy);
      if (hit) handleMeasureClick(hit);
      else { setMeasureA(null); setMeasureB(null); setMeasured(null); }
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

  // ── touch events ──────────────────────────────────────────────────────────

  function pinchDist(t: React.TouchList) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }

  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    if (e.touches.length === 1) {
      dragging.current  = true;
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panAtDrag.current = { ...pan.current };
    } else if (e.touches.length === 2) {
      dragging.current = false;
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

  const hovDepth = hovered?.position?.z_m != null ? `${hovered.position.z_m}m away` : null;

  return (
    <div style={styles.wrap}>
      <div style={styles.topRow}>
        <div style={styles.label}>
          2D Room Map · {objects.length} objects
          {roomSize && <span style={styles.roomSize}> · ~{roomSize.width_m}m × {roomSize.depth_m}m</span>}
        </div>
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
        style={{ ...styles.canvas, cursor: dragging.current ? "grabbing" : "crosshair" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { dragging.current = false; setHovered(null); }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {/* Status bar */}
      {measured ? (
        <div style={styles.measured}>
          <span style={styles.measureDot} />
          <strong>{measured.fromLabel}</strong>
          <span style={styles.measureArrow}>↔</span>
          <strong>{measured.toLabel}</strong>
          <span style={styles.measureDist}>{measured.dist}m</span>
          <button style={styles.clearBtn} onClick={() => { setMeasureA(null); setMeasureB(null); setMeasured(null); }}>✕</button>
        </div>
      ) : measureA && !measureB ? (
        <div style={styles.hint}>
          <span style={{ color: "#fbbf24", fontWeight: 600 }}>{measureA.label}</span>
          {" selected — click another object to measure distance"}
        </div>
      ) : hovered ? (
        <div style={styles.tooltip}>
          <span style={{ ...styles.tooltipDot, background: COLORS[hovered.label] ?? FALLBACK }} />
          <strong>{hovered.label}</strong>
          {hovDepth && <span style={styles.depthBadge}>{hovDepth}</span>}
          <span style={styles.tooltipMeta}>
            x:{hovered.position.x_norm.toFixed(2)} y:{hovered.position.y_norm.toFixed(2)}
            {" · "}{Math.round(hovered.confidence * 100)}% conf
          </span>
        </div>
      ) : (
        <div style={styles.hint}>Click object to measure · Scroll to zoom · Drag to pan</div>
      )}

      {/* Legend */}
      <div style={styles.legend}>
        {objects.map(o => (
          <div key={o.id} style={{ ...styles.chip, ...(measureA?.id === o.id ? styles.chipActive : {}) }}
            onMouseEnter={() => setHovered(o)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleMeasureClick(o)}>
            <span style={{ ...styles.dot, background: COLORS[o.label] ?? FALLBACK }} />
            <span style={{ color: hovered?.id === o.id ? "var(--text)" : "var(--text-3)" }}>{o.label}</span>
            {o.position.z_m != null && (
              <span style={styles.chipDepth}>{o.position.z_m}m</span>
            )}
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
  roomSize:    { color:"var(--accent)", fontWeight:400 },
  controls:    { display:"flex", gap:4 },
  ctrl:        { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:4, width:24, height:24, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0 },
  canvas:      { flex:1, width:"100%", height:"auto", borderRadius:"var(--radius)", minHeight:0, maxHeight:"calc(100% - 96px)", touchAction:"none" },
  tooltip:     { display:"flex", alignItems:"center", gap:6, fontSize:12, padding:"5px 10px", background:"var(--surface-2)", borderRadius:"var(--radius)", border:"1px solid var(--border)", flexShrink:0 },
  tooltipDot:  { width:8, height:8, borderRadius:"50%", flexShrink:0 },
  depthBadge:  { fontSize:10, padding:"1px 6px", background:"rgba(99,102,241,0.15)", color:"var(--accent)", borderRadius:10, marginLeft:4, fontWeight:600 },
  tooltipMeta: { color:"var(--text-3)", marginLeft:"auto", fontSize:11 },
  measured:    { display:"flex", alignItems:"center", gap:6, fontSize:12, padding:"5px 10px", background:"rgba(251,191,36,0.1)", borderRadius:"var(--radius)", border:"1px solid rgba(251,191,36,0.3)", flexShrink:0 },
  measureDot:  { width:8, height:8, borderRadius:"50%", background:"#fbbf24", flexShrink:0 },
  measureArrow:{ color:"var(--text-3)", fontSize:11 },
  measureDist: { marginLeft:"auto", fontWeight:700, color:"#fbbf24", fontSize:13 },
  clearBtn:    { background:"none", border:"none", color:"var(--text-3)", cursor:"pointer", fontSize:12, padding:"0 2px", marginLeft:4 },
  hint:        { fontSize:11, color:"var(--text-3)", textAlign:"center" as const, flexShrink:0 },
  legend:      { display:"flex", flexWrap:"wrap", gap:"2px 8px", flexShrink:0, overflowY:"auto", maxHeight:48 },
  chip:        { display:"flex", alignItems:"center", gap:4, fontSize:10, cursor:"pointer", padding:"1px 4px", borderRadius:3 },
  chipActive:  { background:"rgba(251,191,36,0.15)", border:"1px solid rgba(251,191,36,0.3)" },
  chipDepth:   { fontSize:9, color:"var(--accent)", marginLeft:2 },
  dot:         { width:6, height:6, borderRadius:"50%", flexShrink:0 },
  overlay:     { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"var(--text-3)", pointerEvents:"none" },
};
