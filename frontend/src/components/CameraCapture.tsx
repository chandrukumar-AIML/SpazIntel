import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Props {
  onScanStarted: (scanId: string) => void;
  onBack: () => void;
}

const STEPS = [
  { id: "wall1",   label: "Wall 1",   icon: "◧", hint: "Stand in centre. Face the first wall straight on." },
  { id: "wall2",   label: "Wall 2",   icon: "◨", hint: "Rotate 90° to your right. Face the next wall." },
  { id: "wall3",   label: "Wall 3",   icon: "◩", hint: "Rotate 90° again. Face the opposite wall." },
  { id: "wall4",   label: "Wall 4",   icon: "◪", hint: "Rotate 90° again. Face the last wall." },
  { id: "ceiling", label: "Ceiling",  icon: "⬆", hint: "Point camera straight up at the ceiling." },
  { id: "floor",   label: "Floor",    icon: "⬇", hint: "Point camera straight down at the floor." },
];

type CapturedImage = { blob: Blob; url: string; step: string };

export function CameraCapture({ onScanStarted, onBack }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  const [step, setStep]         = useState(0);
  const [captured, setCaptured] = useState<CapturedImage[]>([]);
  const [camError, setCamError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash]       = useState(false);
  const [ready, setReady]       = useState(false);  // camera stream ready

  // Start camera
  useEffect(() => {
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setReady(true);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Camera access denied";
        setCamError(msg);
      }
    }
    start();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  function capture() {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !ready) return;

    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img: CapturedImage = { blob, url, step: STEPS[step].label };
      setCaptured(prev => [...prev, img]);
      setFlash(true);
      setTimeout(() => setFlash(false), 200);

      if (step + 1 < STEPS.length) {
        setStep(s => s + 1);
      }
    }, "image/jpeg", 0.92);
  }

  async function uploadAll() {
    if (captured.length < STEPS.length || uploading) return;
    setUploading(true);
    try {
      const files = captured.map((c, i) =>
        new File([c.blob], `${STEPS[i].id}.jpg`, { type: "image/jpeg" })
      );
      const res = await api.upload(files);
      onScanStarted(res.scan_id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  }

  function retake(index: number) {
    // Remove all captures from this index onward and go back to that step
    setCaptured(prev => prev.slice(0, index));
    setStep(index);
  }

  const done = captured.length === STEPS.length;
  const current = STEPS[Math.min(step, STEPS.length - 1)];

  if (camError) {
    return (
      <div style={styles.root}>
        <div style={styles.errorCard}>
          <div style={{ fontSize: 32 }}>📷</div>
          <div style={{ fontWeight: 600 }}>Camera access blocked</div>
          <div style={{ fontSize: 13, color: "var(--text-3)", lineHeight: 1.5 }}>{camError}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            Allow camera in browser settings, then reload.
          </div>
          <button style={styles.backBtn} onClick={onBack}>← Back to upload</button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Flash effect on capture */}
      {flash && <div style={styles.flashOverlay} />}

      {/* Hidden canvas for frame grab */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <AnimatePresence mode="wait">
        {!done ? (
          /* === CAPTURE VIEW === */
          <motion.div key="capture" style={styles.captureWrap}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

            {/* Camera preview */}
            <div style={styles.previewWrap}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={styles.video}
              />

              {/* Step overlay */}
              <div style={styles.stepOverlay}>
                <div style={styles.stepBadge}>
                  {step + 1} / {STEPS.length}
                </div>
              </div>

              {/* Grid guide */}
              <div style={styles.gridGuide}>
                <div style={styles.gridV} />
                <div style={styles.gridH} />
              </div>

              {/* Instruction bar */}
              <div style={styles.instructBar}>
                <span style={styles.instructIcon}>{current.icon}</span>
                <div>
                  <div style={styles.instructLabel}>{current.label}</div>
                  <div style={styles.instructHint}>{current.hint}</div>
                </div>
              </div>
            </div>

            {/* Progress thumbnails */}
            <div style={styles.thumbRow}>
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  style={{
                    ...styles.thumb,
                    ...(i < captured.length ? styles.thumbDone : {}),
                    ...(i === step ? styles.thumbActive : {}),
                  }}
                  onClick={() => i < captured.length && retake(i)}
                  title={i < captured.length ? `Retake ${s.label}` : s.label}
                >
                  {captured[i]
                    ? <img src={captured[i].url} style={styles.thumbImg} alt={s.label} />
                    : <span style={{ fontSize: 14 }}>{s.icon}</span>
                  }
                  <span style={styles.thumbLabel}>{s.label}</span>
                </div>
              ))}
            </div>

            {/* Capture button */}
            <button
              style={{ ...styles.captureBtn, ...(ready ? {} : styles.captureBtnDisabled) }}
              onClick={capture}
              disabled={!ready}
            >
              {ready ? `Capture ${current.label}` : "Starting camera…"}
            </button>

            <button style={styles.backBtn} onClick={onBack}>← Back</button>
          </motion.div>
        ) : (
          /* === REVIEW VIEW === */
          <motion.div key="review" style={styles.reviewWrap}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>

            <div style={styles.reviewTitle}>All 6 captures complete ✓</div>
            <div style={styles.reviewSub}>Review your shots. Tap any to retake.</div>

            <div style={styles.reviewGrid}>
              {STEPS.map((s, i) => (
                <div key={s.id} style={styles.reviewCell} onClick={() => retake(i)}>
                  <img src={captured[i].url} style={styles.reviewImg} alt={s.label} />
                  <div style={styles.reviewLabel}>{s.label}</div>
                  <div style={styles.retakeHint}>tap to retake</div>
                </div>
              ))}
            </div>

            <button
              style={{ ...styles.captureBtn, ...(uploading ? styles.captureBtnDisabled : {}) }}
              onClick={uploadAll}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Start Scan →"}
            </button>
            <button style={styles.backBtn} onClick={onBack}>← Back</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root:            { position:"fixed", inset:0, background:"#000", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:50 },
  flashOverlay:    { position:"fixed", inset:0, background:"#fff", opacity:0.7, zIndex:100, pointerEvents:"none" },
  captureWrap:     { width:"100%", height:"100%", display:"flex", flexDirection:"column", alignItems:"center", gap:10, padding:12 },
  previewWrap:     { flex:1, width:"100%", position:"relative", overflow:"hidden", borderRadius:"var(--radius-lg)", background:"#111", minHeight:0 },
  video:           { width:"100%", height:"100%", objectFit:"cover" },
  stepOverlay:     { position:"absolute", top:12, right:12 },
  stepBadge:       { background:"rgba(0,0,0,0.6)", backdropFilter:"blur(8px)", color:"#fff", fontSize:12, fontWeight:700, padding:"4px 10px", borderRadius:20, border:"1px solid rgba(255,255,255,0.15)" },
  gridGuide:       { position:"absolute", inset:0, pointerEvents:"none" },
  gridV:           { position:"absolute", left:"50%", top:0, bottom:0, width:1, background:"rgba(255,255,255,0.15)", transform:"translateX(-50%)" },
  gridH:           { position:"absolute", top:"50%", left:0, right:0, height:1, background:"rgba(255,255,255,0.15)", transform:"translateY(-50%)" },
  instructBar:     { position:"absolute", bottom:0, left:0, right:0, background:"linear-gradient(transparent, rgba(0,0,0,0.85))", padding:"28px 16px 14px", display:"flex", alignItems:"flex-end", gap:12 },
  instructIcon:    { fontSize:28, lineHeight:1 },
  instructLabel:   { fontSize:16, fontWeight:700, color:"#fff" },
  instructHint:    { fontSize:12, color:"rgba(255,255,255,0.7)", marginTop:2 },
  thumbRow:        { display:"flex", gap:8, width:"100%", justifyContent:"center", flexShrink:0 },
  thumb:           { width:52, height:52, borderRadius:8, background:"#111", border:"2px solid rgba(255,255,255,0.1)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:2, cursor:"pointer", overflow:"hidden", flexShrink:0 },
  thumbDone:       { border:"2px solid var(--success)", cursor:"pointer" },
  thumbActive:     { border:"2px solid var(--accent)" },
  thumbImg:        { width:"100%", height:"80%", objectFit:"cover" },
  thumbLabel:      { fontSize:7, color:"rgba(255,255,255,0.5)", textAlign:"center" as const, lineHeight:1 },
  captureBtn:      { width:"100%", maxWidth:420, padding:"14px 0", background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", fontSize:16, fontWeight:700, cursor:"pointer", flexShrink:0 },
  captureBtnDisabled: { opacity:0.4, cursor:"not-allowed" },
  backBtn:         { background:"none", border:"none", color:"var(--text-3)", fontSize:13, cursor:"pointer", padding:"4px 0" },
  reviewWrap:      { width:"100%", maxWidth:500, display:"flex", flexDirection:"column", alignItems:"center", gap:14, padding:20 },
  reviewTitle:     { fontSize:20, fontWeight:700, color:"var(--success)" },
  reviewSub:       { fontSize:13, color:"var(--text-3)" },
  reviewGrid:      { display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8, width:"100%" },
  reviewCell:      { display:"flex", flexDirection:"column", gap:3, cursor:"pointer" },
  reviewImg:       { width:"100%", aspectRatio:"4/3", objectFit:"cover", borderRadius:6, border:"1px solid var(--border)" },
  reviewLabel:     { fontSize:11, fontWeight:600, color:"var(--text-2)", textAlign:"center" as const },
  retakeHint:      { fontSize:9, color:"var(--text-3)", textAlign:"center" as const },
  errorCard:       { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:32, maxWidth:360, display:"flex", flexDirection:"column", gap:12, alignItems:"center", textAlign:"center" as const },
};
