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

export function RoomMap({ scanId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const [hovered, setHovered] = useState<SceneObject | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    setStatus("loading");
    api.sceneGraph(scanId)
      .then(data => { setObjects(data.objects ?? []); setStatus("ok"); })
      .catch(() => setStatus("error"));
  }, [scanId]);

  useEffect(() => { draw(); }, [objects, hovered]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const PAD = 36;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += H / 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Room outline
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);

    // Compass
    ctx.font = "10px system-ui";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.textAlign = "center";
    ctx.fillText("N", W / 2, 14);

    objects.forEach(obj => {
      const x = PAD + obj.position.x_norm * (W - PAD * 2);
      const y = PAD + obj.position.y_norm * (H - PAD * 2);
      const color = COLORS[obj.label] ?? FALLBACK;
      const isHov = hovered?.id === obj.id;
      const r = isHov ? 13 : 9;

      ctx.shadowColor = color;
      ctx.shadowBlur = isHov ? 18 : 6;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color + (isHov ? "ff" : "cc");
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = color + "33";
      ctx.lineWidth = 2;
      ctx.stroke();

      const lbl = obj.label.length > 9 ? obj.label.slice(0, 8) + "…" : obj.label;
      ctx.font = isHov ? "bold 10px system-ui" : "9px system-ui";
      const tw = ctx.measureText(lbl).width;

      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillRect(x - tw / 2 - 3, y + r + 3, tw + 6, 13);
      ctx.fillStyle = isHov ? "#fff" : "rgba(255,255,255,0.7)";
      ctx.textAlign = "center";
      ctx.fillText(lbl, x, y + r + 13);
    });
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !objects.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const PAD = 36;
    const W = canvas.width, H = canvas.height;

    let hit: SceneObject | null = null;
    for (const o of objects) {
      const x = PAD + o.position.x_norm * (W - PAD * 2);
      const y = PAD + o.position.y_norm * (H - PAD * 2);
      if (Math.hypot(mx - x, my - y) < 16) { hit = o; break; }
    }
    setHovered(hit);
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.label}>2D Room Map · {objects.length} objects</div>

      <canvas
        ref={canvasRef}
        width={480}
        height={460}
        style={styles.canvas}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHovered(null)}
      />

      {hovered && (
        <div style={styles.tooltip}>
          <span style={{ ...styles.tooltipDot, background: COLORS[hovered.label] ?? FALLBACK }} />
          <strong>{hovered.label}</strong>
          <span style={styles.tooltipMeta}>
            x:{hovered.position.x_norm.toFixed(2)} y:{hovered.position.y_norm.toFixed(2)}
            {" · "}{Math.round(hovered.confidence * 100)}% conf
          </span>
        </div>
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
  wrap:        { width:"100%", height:"100%", display:"flex", flexDirection:"column", gap:6, padding:"10px 12px", overflow:"hidden", position:"relative" },
  label:       { fontSize:11, color:"var(--text-3)", fontWeight:600, flexShrink:0 },
  canvas:      { flex:1, width:"100%", height:"auto", borderRadius:"var(--radius)", cursor:"crosshair", minHeight:0, maxHeight:"calc(100% - 90px)" },
  tooltip:     { display:"flex", alignItems:"center", gap:6, fontSize:12, padding:"6px 10px", background:"var(--surface-2)", borderRadius:"var(--radius)", border:"1px solid var(--border)", flexShrink:0 },
  tooltipDot:  { width:8, height:8, borderRadius:"50%", flexShrink:0 },
  tooltipMeta: { color:"var(--text-3)", marginLeft:"auto" },
  legend:      { display:"flex", flexWrap:"wrap", gap:"3px 8px", flexShrink:0 },
  chip:        { display:"flex", alignItems:"center", gap:4, fontSize:11, cursor:"default", padding:"1px 4px", borderRadius:3 },
  dot:         { width:6, height:6, borderRadius:"50%", flexShrink:0 },
  overlay:     { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, color:"var(--text-3)", pointerEvents:"none" },
};
