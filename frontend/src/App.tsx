import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SplatViewer }    from "./components/SplatViewer";
import { RoomMap }        from "./components/RoomMap";
import { ChatPanel }      from "./components/ChatPanel";
import { DiffPanel }      from "./components/DiffPanel";
import { UploadPanel }    from "./components/UploadPanel";
import { ScanProgress }   from "./components/ScanProgress";
import { CameraCapture }  from "./components/CameraCapture";
import { LiveCapture }    from "./components/LiveCapture";
import { ScansGallery }   from "./components/ScansGallery";
import { ObjectCapture }  from "./components/ObjectCapture";
import { FloorPlanView }  from "./components/FloorPlanView";
import { EmbedViewer }    from "./components/EmbedViewer";
import { api }            from "./lib/api";

type View     = "upload" | "gallery" | "camera" | "live" | "object" | "scanning" | "explore" | "embed";
type RightTab  = "chat" | "diff";
type ScanMode  = "room" | "object";
type LeftMode  = "map" | "splat" | "plan";

export default function App() {
  const [view, setView]         = useState<View>("upload");
  const [scanId, setScanId]     = useState("scan_001");
  const [objCount, setObjCount] = useState(0);
  const [hasSplat, setHasSplat] = useState(true);
  const [leftMode, setLeftMode] = useState<LeftMode>("map");
  const [rightTab, setRightTab] = useState<RightTab>("chat");
  const [scanMode, setScanMode] = useState<ScanMode>("room");

  // ── URL routing: ?scan=scan_id&embed=1 on load ───────────────────────────
  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    const scanParam = params.get("scan");
    const isEmbed   = params.get("embed") === "1";
    if (scanParam) {
      setScanId(scanParam);
      setHasSplat(false);
      setView(isEmbed ? "embed" : "explore");
      api.jobStatus(scanParam)
        .then(job => { if (job.status === "complete") setHasSplat(job.has_splat ?? false); })
        .catch(() => {});
    }
  }, []);

  function pushScanUrl(id: string) {
    window.history.pushState(null, "", `?scan=${id}`);
  }

  function onScanStarted(id: string, mode: ScanMode = "room") {
    setScanId(id); setScanMode(mode);
    if (id === "scan_001") { setHasSplat(true); pushScanUrl(id); setView("explore"); return; }
    setHasSplat(false);
    setView("scanning");
  }

  function onComplete(id: string, count: number, splat: boolean) {
    setScanId(id); setObjCount(count); setHasSplat(splat);
    // Object scans: open straight into 3D viewer
    setLeftMode(scanMode === "object" && splat ? "splat" : "map");
    pushScanUrl(id);
    setView("explore");
  }

  function openScan(id: string, splat: boolean) {
    setScanId(id); setHasSplat(splat); setObjCount(0);
    setLeftMode("map");
    setScanMode("room");
    pushScanUrl(id);
    setView("explore");
  }

  function goUpload() {
    window.history.pushState(null, "", window.location.pathname);
    setView("upload");
  }

  function onError(msg: string) { alert(`Scan failed: ${msg}`); goUpload(); }

  const splatUrl = api.splatUrl(scanId);

  return (
    <AnimatePresence mode="wait">

      {view === "upload" && (
        <motion.div key="upload" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <UploadPanel
            onScanStarted={onScanStarted}
            onOpenCamera={() => setView("camera")}
            onOpenLive={() => setView("live")}
            onOpenGallery={() => setView("gallery")}
            onOpenObject={() => setView("object")}
            onDemoMap={() => { setScanId("scan_001"); setHasSplat(false); pushScanUrl("scan_001"); setView("explore"); }}
          />
        </motion.div>
      )}

      {view === "gallery" && (
        <motion.div key="gallery" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <ScansGallery onOpen={openScan} onNewScan={goUpload} />
        </motion.div>
      )}

      {view === "camera" && (
        <motion.div key="camera" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <CameraCapture
            onScanStarted={id => { setScanId(id); setHasSplat(false); setScanMode("room"); setView("scanning"); }}
            onBack={goUpload}
          />
        </motion.div>
      )}

      {view === "object" && (
        <motion.div key="object" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <ObjectCapture
            onScanStarted={id => onScanStarted(id, "object")}
            onBack={goUpload}
          />
        </motion.div>
      )}

      {view === "live" && (
        <motion.div key="live" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <LiveCapture onBack={goUpload} />
        </motion.div>
      )}

      {view === "scanning" && (
        <motion.div key="scanning" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <ScanProgress scanId={scanId} onComplete={onComplete} onError={onError} />
        </motion.div>
      )}

      {view === "embed" && (
        <motion.div key="embed" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <EmbedViewer scanId={scanId} hasSplat={hasSplat} />
        </motion.div>
      )}

      {view === "explore" && (
        <motion.div key="explore" style={styles.root} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
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
            <div style={styles.topbarActions}>
              <button
                style={styles.iconBtn}
                onClick={e => {
                  const url = `${window.location.origin}${window.location.pathname}?scan=${scanId}`;
                  navigator.clipboard.writeText(url).catch(() => {});
                  const btn = e.currentTarget;
                  btn.textContent = "✓ Copied!";
                  setTimeout(() => { btn.textContent = "🔗 Copy link"; }, 1500);
                }}
              >
                🔗 Copy link
              </button>
              <a href={api.exportUrl(scanId)} download={`${scanId}.zip`} style={styles.iconBtn}>↓ Export</a>
              <button style={styles.newScanBtn} onClick={() => setView("gallery")}>All Scans</button>
              <button style={styles.newScanBtn} onClick={goUpload}>+ New Scan</button>
            </div>
          </header>

          <div style={styles.layout}>
            <motion.div style={styles.leftPane} initial={{ opacity:0, scale:0.98 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.4 }}>
              <div style={styles.viewerLabel}>
                {leftMode === "map" ? "2D Room Map" : leftMode === "splat" ? "3D Gaussian Splat" : "Floor Plan"}
                <div style={styles.modeTabs}>
                  <button style={{ ...styles.modeTab, ...(leftMode === "map"  ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("map")}>Map</button>
                  {hasSplat && <button style={{ ...styles.modeTab, ...(leftMode === "splat" ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("splat")}>3D</button>}
                  <button style={{ ...styles.modeTab, ...(leftMode === "plan" ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("plan")}>Plan</button>
                </div>
              </div>
              {leftMode === "splat" && hasSplat
                ? <SplatViewer splatUrl={splatUrl} />
                : leftMode === "plan"
                ? <FloorPlanView scanId={scanId} />
                : <RoomMap scanId={scanId} />
              }
            </motion.div>

            <motion.div style={styles.rightPane} initial={{ opacity:0, x:16 }} animate={{ opacity:1, x:0 }} transition={{ duration:0.4, delay:0.1 }}>
              <div style={styles.tabs}>
                {(["chat","diff"] as RightTab[]).map(tab => (
                  <button key={tab} onClick={() => setRightTab(tab)}
                    style={{ ...styles.tab, ...(rightTab===tab ? styles.tabActive : {}) }}>
                    {tab === "chat" ? "Q&A" : "Change Detect"}
                  </button>
                ))}
              </div>
              <div style={styles.panel}>
                {rightTab === "chat" ? <ChatPanel scanId={scanId} /> : <DiffPanel currentScanId={scanId} />}
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
  topbarActions:{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 },
  iconBtn:      { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 10px", fontSize:14, cursor:"pointer", fontWeight:600, textDecoration:"none", display:"inline-flex", alignItems:"center", justifyContent:"center", lineHeight:1, minWidth:32 },
  newScanBtn:   { background:"transparent", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, cursor:"pointer", fontWeight:500 },
  layout:       { flex:1, display:"grid", gridTemplateColumns:"1fr 380px", gap:12, padding:12, overflow:"hidden", minHeight:0 },
  leftPane:     { display:"flex", flexDirection:"column", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", position:"relative" },
  viewerLabel:  { position:"absolute", top:12, left:12, zIndex:10, fontSize:11, fontWeight:600, color:"var(--text-3)", background:"rgba(8,8,8,0.7)", backdropFilter:"blur(4px)", padding:"4px 10px", borderRadius:20, border:"1px solid var(--border)", display:"flex", alignItems:"center", gap:8 },
  toggleBtn:    { background:"rgba(99,102,241,.2)", border:"1px solid rgba(99,102,241,.4)", color:"#a5b4fc", borderRadius:12, padding:"2px 8px", fontSize:10, fontWeight:700, cursor:"pointer", letterSpacing:".02em" },
  modeTabs:     { display:"flex", gap:2 },
  modeTab:      { background:"transparent", border:"none", color:"var(--text-3)", borderRadius:8, padding:"2px 8px", fontSize:10, fontWeight:600, cursor:"pointer", letterSpacing:".02em" },
  modeTabActive:{ background:"rgba(99,102,241,.2)", color:"#a5b4fc", border:"1px solid rgba(99,102,241,.35)" },
  rightPane:    { display:"flex", flexDirection:"column", gap:8, minHeight:0 },
  tabs:         { display:"flex", gap:4, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:4, flexShrink:0 },
  tab:          { flex:1, padding:"6px 12px", border:"none", background:"transparent", color:"var(--text-3)", fontSize:12, fontWeight:600, borderRadius:"var(--radius)", cursor:"pointer", transition:"all 0.15s" },
  tabActive:    { color:"var(--text)", background:"var(--surface-2)" },
  panel:        { flex:1, minHeight:0, display:"flex", flexDirection:"column" },
};
