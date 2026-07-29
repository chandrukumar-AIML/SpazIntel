import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SplatViewer } from "./components/SplatViewer";
import { RoomMap } from "./components/RoomMap";
import { ChatPanel } from "./components/ChatPanel";
import { DiffPanel } from "./components/DiffPanel";
import { UploadPanel } from "./components/UploadPanel";
import { ScanProgress } from "./components/ScanProgress";
import { CameraCapture } from "./components/CameraCapture";
import { LiveCapture } from "./components/LiveCapture";

const BACKEND = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";
type View = "upload" | "camera" | "live" | "scanning" | "explore";
type RightTab = "chat" | "diff";

export default function App() {
  const [view, setView]       = useState<View>("upload");
  const [scanId, setScanId]   = useState("scan_001");
  const [objCount, setObjCount] = useState(0);
  const [hasSplat, setHasSplat] = useState(true);   // scan_001 has splat by default
  const [rightTab, setRightTab] = useState<RightTab>("chat");

  function onScanStarted(id: string) {
    setScanId(id);
    if (id === "scan_001") {
      setHasSplat(true);
      setView("explore");
      return;
    }
    setHasSplat(false);
    setView("scanning");
  }

  function onComplete(id: string, count: number, splat: boolean) {
    setScanId(id);
    setObjCount(count);
    setHasSplat(splat);
    setView("explore");
  }

  function onError(msg: string) {
    alert(`Scan failed: ${msg}`);
    setView("upload");
  }

  const splatUrl = `${BACKEND}/static/${scanId}/splat/splat.ply`;

  return (
    <AnimatePresence mode="wait">
      {view === "upload" && (
        <motion.div key="upload" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <UploadPanel
            onScanStarted={onScanStarted}
            onOpenCamera={() => setView("camera")}
            onOpenLive={() => setView("live")}
            onDemoMap={() => { setScanId("scan_001"); setHasSplat(false); setView("explore"); }}
          />
        </motion.div>
      )}

      {view === "camera" && (
        <motion.div key="camera" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <CameraCapture
            onScanStarted={id => { setScanId(id); setHasSplat(false); setView("scanning"); }}
            onBack={() => setView("upload")}
          />
        </motion.div>
      )}

      {view === "live" && (
        <motion.div key="live" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <LiveCapture onBack={() => setView("upload")} />
        </motion.div>
      )}

      {view === "scanning" && (
        <motion.div key="scanning" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <ScanProgress scanId={scanId} onComplete={onComplete} onError={onError} />
        </motion.div>
      )}

      {view === "explore" && (
        <motion.div key="explore" style={styles.root} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          {/* Topbar */}
          <header style={styles.topbar}>
            <div style={styles.wordmark}>
              <span style={styles.logoDot} />
              SpazIntel
              <span style={styles.sub}>Spatial Intelligence Platform</span>
            </div>
            <div style={styles.scanBadge}>
              <span style={styles.scanDot} />
              {scanId}
              {objCount > 0 && <span style={styles.countBadge}>{objCount} objects</span>}
            </div>
            <button style={styles.newScanBtn} onClick={() => setView("upload")}>
              + New Scan
            </button>
          </header>

          {/* Main layout */}
          <div style={styles.layout}>
            {/* Left: 3D Viewer */}
            <motion.div style={styles.leftPane} initial={{ opacity:0, scale:0.98 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.4 }}>
              <div style={styles.viewerLabel}>
                {hasSplat ? "3D Gaussian Splat" : "2D Room Map"}
              </div>
              {hasSplat
                ? <SplatViewer splatUrl={splatUrl} />
                : <RoomMap scanId={scanId} />
              }
            </motion.div>

            {/* Right: Chat + Diff */}
            <motion.div style={styles.rightPane} initial={{ opacity:0, x:16 }} animate={{ opacity:1, x:0 }} transition={{ duration:0.4, delay:0.1 }}>
              <div style={styles.tabs}>
                {(["chat","diff"] as RightTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setRightTab(tab)}
                    style={{ ...styles.tab, ...(rightTab===tab ? styles.tabActive : {}) }}
                  >
                    {tab === "chat" ? "Q&A" : "Change Detect"}
                  </button>
                ))}
              </div>
              <div style={styles.panel}>
                {rightTab === "chat" ? <ChatPanel scanId={scanId} /> : <DiffPanel />}
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page:         { position:"fixed", inset:0 },
  root:         { display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg)", overflow:"hidden" },
  topbar:       { display:"flex", alignItems:"center", gap:12, padding:"0 20px", height:48, borderBottom:"1px solid var(--border)", flexShrink:0 },
  wordmark:     { display:"flex", alignItems:"center", gap:8, fontWeight:700, fontSize:15, letterSpacing:"-0.01em" },
  logoDot:      { width:10, height:10, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
  sub:          { fontSize:11, color:"var(--text-3)", fontWeight:400 },
  scanBadge:    { display:"flex", alignItems:"center", gap:6, fontSize:11, color:"var(--text-2)", fontFamily:"monospace", padding:"4px 10px", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:20 },
  scanDot:      { width:6, height:6, borderRadius:"50%", background:"var(--success)", flexShrink:0 },
  countBadge:   { fontSize:10, color:"var(--text-3)", marginLeft:4 },
  newScanBtn:   { marginLeft:"auto", background:"transparent", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, cursor:"pointer", fontWeight:500 },
  layout:       { flex:1, display:"grid", gridTemplateColumns:"1fr 380px", gap:12, padding:12, overflow:"hidden", minHeight:0 },
  leftPane:     { display:"flex", flexDirection:"column", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", position:"relative" },
  viewerLabel:  { position:"absolute", top:12, left:12, zIndex:10, fontSize:11, fontWeight:600, color:"var(--text-3)", background:"rgba(8,8,8,0.7)", backdropFilter:"blur(4px)", padding:"4px 10px", borderRadius:20, border:"1px solid var(--border)", pointerEvents:"none" },
  rightPane:    { display:"flex", flexDirection:"column", gap:8, minHeight:0 },
  tabs:         { display:"flex", gap:4, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:4, flexShrink:0 },
  tab:          { flex:1, padding:"6px 12px", border:"none", background:"transparent", color:"var(--text-3)", fontSize:12, fontWeight:600, borderRadius:"var(--radius)", cursor:"pointer", transition:"all 0.15s" },
  tabActive:    { color:"var(--text)", background:"var(--surface-2)" },
  panel:        { flex:1, minHeight:0, display:"flex", flexDirection:"column" },
};
