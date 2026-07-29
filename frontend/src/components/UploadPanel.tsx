import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Props {
  onScanStarted: (scanId: string) => void;
  onOpenCamera: () => void;
  onOpenLive: () => void;
  onOpenGallery: () => void;
  onDemoMap: () => void;
}

export function UploadPanel({ onScanStarted, onOpenCamera, onOpenLive, onOpenGallery, onDemoMap }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function accept(incoming: FileList | null) {
    if (!incoming) return;
    const arr = Array.from(incoming);
    setError("");
    setFiles(arr);
  }

  const isVideo = files.length === 1 && files[0].type.startsWith("video/");
  const isImages = files.length > 0 && files.every(f => f.type.startsWith("image/"));
  const valid = isVideo || (isImages && files.length >= 6);

  const label = files.length === 0
    ? null
    : isVideo
      ? files[0].name
      : `${files.length} images selected`;

  async function startScan() {
    if (!valid || uploading) return;
    setUploading(true);
    setError("");
    try {
      const res = await api.upload(files);
      onScanStarted(res.scan_id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.dot} />
        <span style={styles.title}>SpazIntel</span>
        <span style={styles.sub}>Spatial Intelligence Platform</span>
      </div>

      {/* Upload card */}
      <motion.div
        style={styles.card}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div style={styles.cardTitle}>Scan a Room</div>
        <div style={styles.cardSub}>Use your camera for guided capture, or upload a video / 6+ photos</div>

        {/* Live Scan — primary CTA */}
        <button style={styles.liveBtn} onClick={onOpenLive}>
          <span style={{ fontSize: 20 }}>🎥</span>
          Live Room Scan — Real-time 3D map
        </button>

        {/* Camera batch capture */}
        <button style={styles.cameraBtn} onClick={onOpenCamera}>
          <span style={{ fontSize: 16 }}>📷</span>
          Guided 6-shot capture
        </button>

        <div style={styles.divider}><span style={styles.dividerText}>or upload files</span></div>

        {/* Drop zone */}
        <div
          style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneDrag : {}) }}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); accept(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,image/*"
            multiple
            style={{ display: "none" }}
            onChange={e => accept(e.target.files)}
          />

          <AnimatePresence mode="wait">
            {files.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.dropContent}>
                <div style={styles.dropIcon}>📷</div>
                <div style={styles.dropText}>Drop video or photos here</div>
                <div style={styles.dropHint}>or click to browse</div>
              </motion.div>
            ) : (
              <motion.div key="files" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.dropContent}>
                <div style={styles.dropIcon}>{isVideo ? "🎥" : "🖼️"}</div>
                <div style={{ ...styles.dropText, color: valid ? "var(--success)" : "var(--warning)" }}>
                  {label}
                </div>
                {!valid && isImages && files.length < 6 && (
                  <div style={styles.dropHint}>Need at least 6 images ({files.length} selected)</div>
                )}
                <div style={styles.dropHint}>Click to change</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Tips */}
        <div style={styles.tips}>
          <TipRow icon="🎥" text="Video: slow 360° walkthrough, 15–60 sec" />
          <TipRow icon="🖼️" text="Photos: 6+ shots from different angles, good overlap" />
          <TipRow icon="💡" text="Good lighting = better detection" />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={{ ...styles.btn, ...(!valid || uploading ? styles.btnDisabled : {}) }}
          onClick={startScan}
          disabled={!valid || uploading}
        >
          {uploading ? "Uploading…" : "Upload & Scan"}
        </button>
      </motion.div>

      {/* Or load existing */}
      <div style={styles.existingRow}>
        <button style={styles.galleryBtn} onClick={onOpenGallery}>
          📂 My Scans
        </button>
        <span style={{ color:"var(--text-3)" }}>·</span>
        <button style={styles.link} onClick={() => onScanStarted("scan_001")}>
          load scan_001
        </button>
        <span style={{ color:"var(--text-3)" }}>·</span>
        <button style={styles.link} onClick={onDemoMap}>
          room map
        </button>
      </div>
    </div>
  );
}

function TipRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--text-3)" }}>
      <span>{icon}</span><span>{text}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root:        { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", minHeight:"100vh", background:"var(--bg)", gap:16, padding:24, overflowY:"auto" },
  header:      { display:"flex", alignItems:"center", gap:8, marginBottom:8 },
  dot:         { width:10, height:10, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)" },
  title:       { fontWeight:700, fontSize:18, letterSpacing:"-0.01em" },
  sub:         { fontSize:12, color:"var(--text-3)" },
  card:        { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:28, width:"100%", maxWidth:480, display:"flex", flexDirection:"column", gap:16 },
  cardTitle:   { fontSize:20, fontWeight:700, letterSpacing:"-0.01em" },
  cardSub:     { fontSize:13, color:"var(--text-2)", lineHeight:1.5 },
  dropzone:    { border:"2px dashed var(--border)", borderRadius:"var(--radius)", padding:"32px 24px", cursor:"pointer", transition:"border-color 0.15s, background 0.15s", textAlign:"center" as const },
  dropzoneDrag:{ borderColor:"var(--accent)", background:"rgba(99,102,241,0.05)" },
  dropContent: { display:"flex", flexDirection:"column", alignItems:"center", gap:8 },
  dropIcon:    { fontSize:32 },
  dropText:    { fontSize:14, fontWeight:600 },
  dropHint:    { fontSize:12, color:"var(--text-3)" },
  tips:        { display:"flex", flexDirection:"column", gap:8, padding:"12px 14px", background:"var(--surface-2)", borderRadius:"var(--radius)" },
  error:       { fontSize:12, color:"var(--danger)", textAlign:"center" as const },
  liveBtn:     { display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:"linear-gradient(135deg,#6366f1,#8b5cf6)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"13px 0", fontSize:15, fontWeight:700, cursor:"pointer", width:"100%" },
  cameraBtn:   { display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:"var(--surface-2)", color:"var(--text-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"10px 0", fontSize:13, fontWeight:600, cursor:"pointer", width:"100%" },
  divider:     { display:"flex", alignItems:"center", gap:0 },
  dividerText: { fontSize:11, color:"var(--text-3)", whiteSpace:"nowrap" as const, width:"100%", textAlign:"center" as const },
  btn:         { background:"var(--surface-2)", color:"var(--text-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"11px 0", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" },
  btnDisabled: { opacity:0.4, cursor:"not-allowed" },
  existingRow: { fontSize:12, color:"var(--text-3)", display:"flex", alignItems:"center", gap:8, justifyContent:"center" },
  galleryBtn:  { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" },
  link:        { background:"none", border:"none", color:"var(--accent)", fontSize:12, cursor:"pointer", padding:0, textDecoration:"underline" },
};
