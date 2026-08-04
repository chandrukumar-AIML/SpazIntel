import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";

interface Props {
  onScanStarted: (scanId: string) => void;
  onOpenCamera: () => void;
  onOpenLive: () => void;
  onOpenGallery: () => void;
  onOpenObject: () => void;
  onOpenSearch: () => void;
  onDemoMap: () => void;
}

export function UploadPanel({ onScanStarted, onOpenCamera, onOpenLive, onOpenGallery, onOpenObject, onOpenSearch, onDemoMap }: Props) {
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
      <div style={styles.header}>
        <span style={styles.dot} />
        <span style={styles.title}>SpazIntel</span>
      </div>
      <div style={styles.hero}>
        Point your camera at any room.<br />
        <span style={styles.heroAccent}>AI maps it, answers questions, detects what changed.</span>
      </div>

      <motion.div
        style={styles.card}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div style={styles.cardTitle}>Scan a Room</div>
        <div style={styles.cardSub}>Use your camera for guided capture, or upload a video / 6+ photos</div>

        <button style={styles.liveBtn} onClick={onOpenLive}>
          <span style={{ fontSize: 20 }}>&#x1F3A5;</span>
          Live Room Scan {"—"} Real-time 3D map
        </button>

        <button style={styles.objectBtn} onClick={onOpenObject}>
          <span style={{ fontSize: 16 }}>&#x1F4E6;</span>
          Scan an Object {"—"} 6-photo 3D replica
        </button>

        <button style={styles.cameraBtn} onClick={onOpenCamera}>
          <span style={{ fontSize: 16 }}>&#x1F4F7;</span>
          Guided 6-shot room capture
        </button>

        <div style={styles.divider}><span style={styles.dividerText}>or upload files</span></div>

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
                <div style={styles.dropIcon}>&#x1F4F7;</div>
                <div style={styles.dropText}>Drop video or photos here</div>
                <div style={styles.dropHint}>or click to browse</div>
              </motion.div>
            ) : (
              <motion.div key="files" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.dropContent}>
                <div style={styles.dropIcon}>{isVideo ? "\u{1F3A5}" : "\u{1F5BC}"}</div>
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

        <div style={styles.tips}>
          <TipRow icon="&#x1F3A5;" text="Video: slow 360° walkthrough, 15–60 sec" />
          <TipRow icon="&#x1F5BC;" text="Photos: 6+ shots from different angles, good overlap" />
          <TipRow icon="&#x1F4A1;" text="Good lighting = better detection" />
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

      <div style={styles.existingRow}>
        <button style={styles.galleryBtn} onClick={onOpenGallery}>
          &#x1F4C2; My Scans
        </button>
        <button style={styles.galleryBtn} onClick={onOpenSearch}>
          &#x1F50D; Search
        </button>
        <span style={{ color:"var(--text-3)" }}>{"·"}</span>
        <button style={styles.link} onClick={() => onScanStarted("scan_001")}>
          Try demo scan {"→"}
        </button>
        <span style={{ color:"var(--text-3)" }}>{"·"}</span>
        <button style={styles.link} onClick={onDemoMap}>
          room map
        </button>
      </div>

      <div style={styles.indiaSection}>
        <div style={styles.indiaSectionTitle}>India B2B Pricing</div>
        <div style={styles.indiaPlans}>
          <div style={styles.indiaPlan}>
            <div style={styles.indiaPlanName}>Starter</div>
            <div style={styles.indiaPlanPrice}>₹2,999<span style={styles.indiaPlanPer}>/mo</span></div>
            <div style={styles.indiaPlanDesc}>10 scans · Factory &amp; warehouse</div>
          </div>
          <div style={{ ...styles.indiaPlan, ...styles.indiaPlanHighlight }}>
            <div style={styles.indiaPlanName}>Professional</div>
            <div style={styles.indiaPlanPrice}>₹9,999<span style={styles.indiaPlanPer}>/mo</span></div>
            <div style={styles.indiaPlanDesc}>Unlimited scans · API access</div>
          </div>
          <div style={styles.indiaPlan}>
            <div style={styles.indiaPlanName}>Enterprise</div>
            <div style={{ ...styles.indiaPlanPrice, fontSize: 13 }}>Contact us</div>
            <div style={styles.indiaPlanDesc}>On-premise · White-label</div>
          </div>
        </div>
        <div style={styles.indiaUseCases}>
          Factory floors · Warehouses · Real estate · Retail planogram
        </div>
      </div>
    </div>
  );
}

function TipRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--text-3)" }}>
      <span dangerouslySetInnerHTML={{ __html: icon }} /><span>{text}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root:        { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-start", height:"100%", overflowY:"auto", background:"var(--bg)", gap:16, padding:"clamp(24px, calc(50vh - 340px), 80px) 24px 32px" },
  header:      { display:"flex", alignItems:"center", gap:8, marginBottom:4 },
  dot:         { width:10, height:10, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)" },
  title:       { fontWeight:700, fontSize:18, letterSpacing:"-0.01em" },
  sub:         { fontSize:12, color:"var(--text-3)" },
  hero:        { fontSize:15, lineHeight:1.5, color:"var(--text-2)", textAlign:"center" as const, maxWidth:380, marginBottom:4 },
  heroAccent:  { color:"var(--text)", fontWeight:600 },
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
  objectBtn:   { display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:"rgba(99,102,241,0.1)", color:"#a5b4fc", border:"1px solid rgba(99,102,241,0.3)", borderRadius:"var(--radius)", padding:"10px 0", fontSize:13, fontWeight:600, cursor:"pointer", width:"100%" },
  cameraBtn:   { display:"flex", alignItems:"center", justifyContent:"center", gap:10, background:"var(--surface-2)", color:"var(--text-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"10px 0", fontSize:13, fontWeight:600, cursor:"pointer", width:"100%" },
  divider:     { display:"flex", alignItems:"center", gap:0 },
  dividerText: { fontSize:11, color:"var(--text-3)", whiteSpace:"nowrap" as const, width:"100%", textAlign:"center" as const },
  btn:         { background:"var(--surface-2)", color:"var(--text-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"11px 0", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%" },
  btnDisabled: { opacity:0.4, cursor:"not-allowed" },
  existingRow: { fontSize:12, color:"var(--text-3)", display:"flex", alignItems:"center", gap:8, justifyContent:"center" },
  galleryBtn:  { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" },
  link:        { background:"none", border:"none", color:"var(--accent)", fontSize:12, cursor:"pointer", padding:0, textDecoration:"underline" },

  indiaSection:      { width:"100%", maxWidth:480, display:"flex", flexDirection:"column", gap:10, padding:"16px 20px", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)" },
  indiaSectionTitle: { fontSize:11, fontWeight:700, color:"var(--text-3)", letterSpacing:".06em", textTransform:"uppercase" as const },
  indiaPlans:        { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 },
  indiaPlan:         { display:"flex", flexDirection:"column", gap:4, padding:"10px 12px", background:"var(--surface-2)", borderRadius:"var(--radius)", border:"1px solid var(--border)" },
  indiaPlanHighlight:{ border:"1px solid rgba(99,102,241,.4)", background:"rgba(99,102,241,.07)" },
  indiaPlanName:     { fontSize:11, fontWeight:700, color:"var(--text-3)", letterSpacing:".02em" },
  indiaPlanPrice:    { fontSize:18, fontWeight:800, color:"var(--text)", letterSpacing:"-.02em" },
  indiaPlanPer:      { fontSize:11, fontWeight:400, color:"var(--text-3)" },
  indiaPlanDesc:     { fontSize:10, color:"var(--text-3)", lineHeight:1.4 },
  indiaUseCases:     { fontSize:11, color:"var(--text-3)", textAlign:"center" as const },
};
