import React, { useRef, useEffect, useState, useCallback } from "react";

const BACKEND_WS = (import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000")
  .replace(/^http/, "ws");

const FRAME_INTERVAL_MS = 2000; // send a frame every 2s

interface LiveDet {
  label: string;
  confidence: number;
  x_norm: number;
  y_norm: number;
  z_m: number | null;
  bbox: number[];
}

interface Tracked {
  label:      string;
  x_norm:     number;
  y_norm:     number;
  z_m:        number | null;
  confidence: number;
  alpha:      number;   // 0–1 for fade in/out
  missedFrames: number;
}

interface Props {
  onBack: () => void;
}

const ACCENT_COLORS = [
  "#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981",
  "#3b82f6","#ef4444","#14b8a6","#f97316","#a78bfa",
];

export function LiveCapture({ onBack }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const mapRef     = useRef<HTMLCanvasElement>(null);
  const wsRef      = useRef<WebSocket | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackedRef = useRef<Record<string, Tracked>>({});
  const labelColors= useRef<Record<string, string>>({});
  const colorIdx   = useRef(0);

  const [status, setStatus]   = useState<"connecting"|"live"|"error">("connecting");
  const [objCount, setObjCount] = useState(0);
  const [fps, setFps]         = useState(0);
  const fpsFrames = useRef(0);
  const sessionId = useRef(`live_${Date.now()}`);

  // ── colour per label (stable across frames) ───────────────────────────────
  function colorFor(label: string) {
    if (!labelColors.current[label]) {
      labelColors.current[label] = ACCENT_COLORS[colorIdx.current % ACCENT_COLORS.length];
      colorIdx.current++;
    }
    return labelColors.current[label];
  }

  // ── merge incoming detections into tracked objects ─────────────────────────
  const merge = useCallback((dets: LiveDet[]) => {
    const tracked = trackedRef.current;

    // age all by 1 missed frame, fade out quickly
    for (const key of Object.keys(tracked)) {
      tracked[key].missedFrames++;
      if (tracked[key].missedFrames > 2) {
        tracked[key].alpha = Math.max(0, tracked[key].alpha - 0.3);
      }
    }

    // update or add detected objects
    for (const d of dets) {
      const key = d.label;
      if (tracked[key]) {
        // smooth position update
        tracked[key].x_norm      = tracked[key].x_norm * 0.7 + d.x_norm * 0.3;
        tracked[key].y_norm      = tracked[key].y_norm * 0.7 + d.y_norm * 0.3;
        tracked[key].z_m         = d.z_m;
        tracked[key].confidence  = d.confidence;
        tracked[key].alpha       = Math.min(1, tracked[key].alpha + 0.4);
        tracked[key].missedFrames = 0;
      } else {
        tracked[key] = { ...d, alpha: 0.2, missedFrames: 0 };
      }
    }

    // remove fully faded
    for (const key of Object.keys(tracked)) {
      if (tracked[key].alpha <= 0) delete tracked[key];
    }

    setObjCount(Object.keys(tracked).filter(k => tracked[k].alpha > 0.5).length);
    drawMap();
  }, []);

  // ── draw live room map ─────────────────────────────────────────────────────
  function drawMap() {
    const canvas = mapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = "#0c0c0f";
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    const GRID = 40;
    for (let x = 0; x < W; x += GRID) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += GRID) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // scan line (animated)
    const scanY = (Date.now() / 20) % H;
    const grad = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40);
    grad.addColorStop(0,   "rgba(99,102,241,0)");
    grad.addColorStop(0.5, "rgba(99,102,241,0.12)");
    grad.addColorStop(1,   "rgba(99,102,241,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, scanY - 40, W, 80);

    // draw tracked objects
    for (const [, t] of Object.entries(trackedRef.current)) {
      if (t.alpha < 0.05) continue;
      const x = t.x_norm * W;
      const y = t.y_norm * H;
      const color = colorFor(t.label);
      const r = Math.max(6, t.confidence * 14);

      // glow ring
      ctx.save();
      ctx.globalAlpha = t.alpha * 0.25;
      ctx.beginPath();
      ctx.arc(x, y, r + 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      // dot
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();

      // label
      ctx.save();
      ctx.globalAlpha = t.alpha;
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(t.label, x, y - r - 5);
      if (t.z_m !== null) {
        ctx.font = "10px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(`${t.z_m}m`, x, y + r + 12);
      }
      ctx.restore();
    }

    // request next animation frame for scan line
    requestAnimationFrame(() => { if (mapRef.current) drawMap(); });
  }

  // ── capture frame and send via WS ─────────────────────────────────────────
  const sendFrame = useCallback(() => {
    const ws  = wsRef.current;
    const vid = videoRef.current;
    const cap = canvasRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !vid || !cap) return;

    const ctx = cap.getContext("2d");
    if (!ctx) return;
    cap.width  = 640;
    cap.height = 480;
    ctx.drawImage(vid, 0, 0, 640, 480);

    cap.toBlob(blob => {
      if (!blob || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      blob.arrayBuffer().then(buf => wsRef.current!.send(buf));
    }, "image/jpeg", 0.7);
  }, []);

  // ── camera + WebSocket setup ───────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function start() {
      // camera — non-fatal, WS still connects even if camera blocked
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: 640, height: 480 },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
          }
        } catch {
          // camera blocked — still connect WS so map works if frames sent another way
          console.warn("Camera unavailable — WebSocket still connecting");
        }
      }

      // websocket — always connect
      const ws = new WebSocket(`${BACKEND_WS}/ws/live/${sessionId.current}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("live");
        timerRef.current = setInterval(sendFrame, FRAME_INTERVAL_MS);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.detections) {
            fpsFrames.current++;
            merge(msg.detections as LiveDet[]);
          }
        } catch { /* ignore */ }
      };

      ws.onerror = () => setStatus("error");
      ws.onclose = () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }

    start();

    // fps counter
    const fpsInterval = setInterval(() => {
      setFps(fpsFrames.current);
      fpsFrames.current = 0;
    }, 1000);

    return () => {
      if (timerRef.current)  clearInterval(timerRef.current);
      clearInterval(fpsInterval);
      wsRef.current?.close();
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [sendFrame, merge]);

  return (
    <div style={s.root}>
      {/* Top bar */}
      <div style={s.topbar}>
        <button style={s.back} onClick={onBack}>← Back</button>
        <div style={s.wordmark}>
          <span style={s.dot} />
          SpazIntel
          <span style={s.sub}>Live Room Scan</span>
        </div>
        <div style={s.badges}>
          <span style={{ ...s.badge, background: status === "live" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: status === "live" ? "#10b981" : "#ef4444", borderColor: status === "live" ? "#10b981" : "#ef4444" }}>
            {status === "connecting" ? "Connecting…" : status === "live" ? "● LIVE" : "⚠ Error"}
          </span>
          <span style={s.badge}>{objCount} objects</span>
          <span style={s.badge}>{fps} fps</span>
        </div>
      </div>

      {/* Main layout */}
      <div style={s.layout}>
        {/* Left: camera */}
        <div style={s.pane}>
          <div style={s.paneLabel}>Camera Feed</div>
          <video ref={videoRef} style={s.video} playsInline muted autoPlay />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <div style={s.camOverlay}>
            <div style={s.scanLine} />
            {status === "live" && (
              <div style={s.liveChip}>● Sending frame every {FRAME_INTERVAL_MS / 1000}s</div>
            )}
          </div>
        </div>

        {/* Right: live room map */}
        <div style={s.pane}>
          <div style={s.paneLabel}>Live Room Map</div>
          <canvas ref={mapRef} width={640} height={480} style={s.mapCanvas} />

          {/* Legend */}
          <div style={s.legend}>
            {Object.entries(trackedRef.current)
              .filter(([, t]) => t.alpha > 0.5)
              .map(([label, t]) => (
                <div key={label} style={s.legendItem}>
                  <span style={{ ...s.legendDot, background: colorFor(label) }} />
                  <span style={s.legendLabel}>{label}</span>
                  {t.z_m && <span style={s.legendDepth}>{t.z_m}m</span>}
                </div>
              ))}
          </div>
        </div>
      </div>

      {status === "error" && (
        <div style={s.errorBanner}>
          Camera or WebSocket unavailable. Make sure you're on HTTPS or localhost, and the backend is running.
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:        { display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg)", overflow:"hidden" },
  topbar:      { display:"flex", alignItems:"center", gap:12, padding:"0 20px", height:48, borderBottom:"1px solid var(--border)", flexShrink:0 },
  back:        { background:"none", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"4px 12px", fontSize:12, cursor:"pointer" },
  wordmark:    { display:"flex", alignItems:"center", gap:8, fontWeight:700, fontSize:15 },
  dot:         { width:10, height:10, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
  sub:         { fontSize:11, color:"var(--text-3)", fontWeight:400 },
  badges:      { marginLeft:"auto", display:"flex", gap:8 },
  badge:       { fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:20, border:"1px solid var(--border)", background:"var(--surface-2)", color:"var(--text-2)" },
  layout:      { flex:1, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, padding:12, overflow:"hidden", minHeight:0 },
  pane:        { position:"relative", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", display:"flex", flexDirection:"column" },
  paneLabel:   { position:"absolute", top:12, left:12, zIndex:10, fontSize:11, fontWeight:600, color:"var(--text-3)", background:"rgba(8,8,8,0.7)", backdropFilter:"blur(4px)", padding:"4px 10px", borderRadius:20, border:"1px solid var(--border)" },
  video:       { width:"100%", height:"100%", objectFit:"cover" },
  mapCanvas:   { width:"100%", height:"100%", objectFit:"contain" },
  camOverlay:  { position:"absolute", inset:0, pointerEvents:"none" },
  scanLine:    { position:"absolute", left:0, right:0, height:2, background:"rgba(99,102,241,0.6)", animation:"scanDown 3s linear infinite" },
  liveChip:   { position:"absolute", bottom:12, left:"50%", transform:"translateX(-50%)", fontSize:11, color:"#10b981", background:"rgba(16,185,129,0.1)", border:"1px solid #10b981", borderRadius:20, padding:"3px 12px" },
  legend:      { position:"absolute", bottom:12, left:12, display:"flex", flexDirection:"column", gap:4, maxHeight:"40%", overflowY:"auto" },
  legendItem:  { display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--text-2)", background:"rgba(8,8,8,0.7)", borderRadius:20, padding:"3px 10px" },
  legendDot:   { width:8, height:8, borderRadius:"50%", flexShrink:0 },
  legendLabel: { fontWeight:600 },
  legendDepth: { color:"var(--text-3)", marginLeft:2 },
  errorBanner: { background:"rgba(239,68,68,0.1)", border:"1px solid #ef4444", color:"#ef4444", textAlign:"center", padding:"10px 20px", fontSize:13 },
};
