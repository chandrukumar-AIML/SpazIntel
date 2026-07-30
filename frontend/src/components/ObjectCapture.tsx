import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Props {
  onScanStarted: (scanId: string) => void;
  onBack: () => void;
}

const SHOTS = [
  { id: "front",  label: "Front",     icon: "⬆",  hint: "Stand in front of the object. Fill the frame.",     angle: 0   },
  { id: "right",  label: "Right",     icon: "➡",  hint: "Move 90° to the right side. Same distance.",        angle: 90  },
  { id: "back",   label: "Back",      icon: "⬇",  hint: "Move to the back of the object.",                   angle: 180 },
  { id: "left",   label: "Left",      icon: "⬅",  hint: "Move 90° to the left side.",                       angle: 270 },
  { id: "top",    label: "Top",       icon: "⬆⬆", hint: "Hold camera above — point straight down at object.", angle: -1  },
  { id: "corner", label: "Corner",    icon: "↗",  hint: "Diagonal 45° view — any corner, slightly elevated.", angle: 45  },
];

type Captured = { blob: Blob; url: string };

export function ObjectCapture({ onScanStarted, onBack }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [step, setStep]         = useState(0);
  const [captured, setCaptured] = useState<(Captured | null)[]>(Array(SHOTS.length).fill(null));
  const [camErr, setCamErr]     = useState("");
  const [ready, setReady]       = useState(false);
  const [flash, setFlash]       = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setReady(true);
      }
    }).catch(e => setCamErr(e instanceof Error ? e.message : "Camera blocked"));

    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  function capture() {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !ready) return;
    c.width  = v.videoWidth  || 1280;
    c.height = v.videoHeight || 720;
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setCaptured(prev => {
        const next = [...prev];
        next[step] = { blob, url };
        return next;
      });
      setFlash(true);
      setTimeout(() => setFlash(false), 200);
      if (step + 1 < SHOTS.length) setStep(s => s + 1);
    }, "image/jpeg", 0.92);
  }

  async function uploadAll() {
    const all = captured.filter(Boolean) as Captured[];
    if (all.length < SHOTS.length || uploading) return;
    setUploading(true);
    try {
      const files = all.map((c, i) => new File([c.blob], `${SHOTS[i].id}.jpg`, { type: "image/jpeg" }));
      const res = await api.upload(files, "object");
      onScanStarted(res.scan_id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  }

  const done    = captured.every(Boolean);
  const current = SHOTS[Math.min(step, SHOTS.length - 1)];

  if (camErr) return (
    <div style={S.root}>
      <div style={S.errCard}>
        <span style={{ fontSize: 32 }}>📷</span>
        <span style={{ fontWeight: 600 }}>Camera blocked</span>
        <span style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>{camErr}</span>
        <button style={S.backBtn} onClick={onBack}>← Back</button>
      </div>
    </div>
  );

  return (
    <div style={S.root}>
      {flash && <div style={S.flash} />}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div key="capture" style={S.wrap}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

            {/* Camera preview */}
            <div style={S.preview}>
              <video ref={videoRef} autoPlay playsInline muted style={S.video} />

              {/* Angle ring guide overlay */}
              <div style={S.ringWrap}>
                <RingGuide step={step} captured={captured} />
              </div>

              {/* Step badge */}
              <div style={S.stepBadge}>{step + 1} / {SHOTS.length}</div>

              {/* Instruction */}
              <div style={S.instrBar}>
                <span style={{ fontSize: 24 }}>{current.icon}</span>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{current.label}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,.65)", marginTop: 2 }}>{current.hint}</div>
                </div>
              </div>
            </div>

            {/* Thumbnails */}
            <div style={S.thumbRow}>
              {SHOTS.map((s, i) => (
                <div key={s.id} style={{
                  ...S.thumb,
                  ...(captured[i] ? S.thumbDone : {}),
                  ...(i === step ? S.thumbActive : {}),
                }}
                  onClick={() => { if (captured[i]) { setStep(i); } }}
                >
                  {captured[i]
                    ? <img src={captured[i]!.url} style={S.thumbImg} alt={s.label} />
                    : <span style={{ fontSize: 14 }}>{s.icon}</span>}
                  <span style={S.thumbLabel}>{s.label}</span>
                </div>
              ))}
            </div>

            <button
              style={{ ...S.captureBtn, ...(!ready ? S.disabled : {}) }}
              onClick={capture}
              disabled={!ready}
            >
              {ready ? `Capture ${current.label}` : "Starting camera…"}
            </button>
            <button style={S.backBtn} onClick={onBack}>← Back</button>
          </motion.div>
        ) : (
          <motion.div key="review" style={S.reviewWrap}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--success)" }}>All 6 angles captured ✓</div>
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>Review your shots — tap any to retake.</div>

            <div style={S.reviewGrid}>
              {SHOTS.map((s, i) => (
                <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}
                  onClick={() => { setCaptured(prev => { const n = [...prev]; n[i] = null; return n; }); setStep(i); }}>
                  <img src={captured[i]!.url} style={S.reviewImg} alt={s.label} />
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textAlign: "center" as const }}>{s.label}</div>
                  <div style={{ fontSize: 9, color: "var(--text-3)", textAlign: "center" as const }}>tap to retake</div>
                </div>
              ))}
            </div>

            <button
              style={{ ...S.captureBtn, ...(uploading ? S.disabled : {}) }}
              onClick={uploadAll}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Build 3D Model →"}
            </button>
            <button style={S.backBtn} onClick={onBack}>← Back</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** SVG ring showing N/E/S/W/Top/Corner positions with current highlighted */
function RingGuide({ step, captured }: { step: number; captured: (Captured | null)[] }) {
  const r = 44; // ring radius
  const cx = 64, cy = 64;
  // Positions for front/right/back/left (around the ring), top (above), corner (NE)
  const positions = [
    { x: cx,      y: cy - r }, // front (top of ring)
    { x: cx + r,  y: cy     }, // right
    { x: cx,      y: cy + r }, // back
    { x: cx - r,  y: cy     }, // left
    { x: cx,      y: cy - r - 18 }, // top (above ring)
    { x: cx + r * 0.7, y: cy - r * 0.7 }, // corner (NE)
  ];

  return (
    <svg width={128} height={128} style={{ opacity: 0.85 }}>
      {/* Ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} strokeDasharray="4 3" />
      {/* Object in center */}
      <rect x={cx-10} y={cy-10} width={20} height={20} rx={3} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
      {/* Shot dots */}
      {positions.map((pos, i) => {
        const done = !!captured[i];
        const active = i === step;
        return (
          <g key={i}>
            <circle
              cx={pos.x} cy={pos.y} r={active ? 8 : 5}
              fill={done ? "#10b981" : active ? "#6366f1" : "rgba(255,255,255,0.2)"}
              stroke={active ? "rgba(99,102,241,0.5)" : "none"}
              strokeWidth={active ? 3 : 0}
            />
            {done && !active && (
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="7" fill="#fff">✓</text>
            )}
          </g>
        );
      })}
      {/* Camera icon at active position */}
      {step < positions.length && (
        <text x={positions[step].x} y={positions[step].y + 4}
          textAnchor="middle" fontSize="9" fill="#fff" style={{ userSelect: "none" }}>📷</text>
      )}
    </svg>
  );
}

const S: Record<string, React.CSSProperties> = {
  root:       { position: "fixed", inset: 0, background: "#000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 50 },
  flash:      { position: "fixed", inset: 0, background: "#fff", opacity: 0.7, zIndex: 100, pointerEvents: "none" },
  wrap:       { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 12 },
  preview:    { flex: 1, width: "100%", position: "relative", overflow: "hidden", borderRadius: "var(--radius-lg)", background: "#111", minHeight: 0 },
  video:      { width: "100%", height: "100%", objectFit: "cover" },
  ringWrap:   { position: "absolute", top: 12, left: 12, background: "rgba(0,0,0,0.5)", borderRadius: 12, padding: 6, backdropFilter: "blur(4px)" },
  stepBadge:  { position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)", color: "#fff", fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.15)" },
  instrBar:   { position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent,rgba(0,0,0,0.85))", padding: "28px 16px 14px", display: "flex", alignItems: "flex-end", gap: 12 },
  thumbRow:   { display: "flex", gap: 8, width: "100%", justifyContent: "center", flexShrink: 0 },
  thumb:      { width: 52, height: 52, borderRadius: 8, background: "#111", border: "2px solid rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer", overflow: "hidden", flexShrink: 0 },
  thumbDone:  { border: "2px solid var(--success)" },
  thumbActive:{ border: "2px solid var(--accent)" },
  thumbImg:   { width: "100%", height: "80%", objectFit: "cover" },
  thumbLabel: { fontSize: 7, color: "rgba(255,255,255,0.5)", textAlign: "center" as const },
  captureBtn: { width: "100%", maxWidth: 420, padding: "14px 0", background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", fontSize: 16, fontWeight: 700, cursor: "pointer", flexShrink: 0 },
  disabled:   { opacity: 0.4, cursor: "not-allowed" },
  backBtn:    { background: "none", border: "none", color: "var(--text-3)", fontSize: 13, cursor: "pointer", padding: "4px 0" },
  errCard:    { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32, maxWidth: 360, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center" as const },
  reviewWrap: { width: "100%", maxWidth: 500, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: 20 },
  reviewGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, width: "100%" },
  reviewImg:  { width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" },
};
