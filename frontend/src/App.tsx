import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SplatViewer }       from "./components/SplatViewer";
import { PointCloudViewer }  from "./components/PointCloudViewer";
import { RoomMap }           from "./components/RoomMap";
import { ChatPanel }         from "./components/ChatPanel";
import { DiffPanel }         from "./components/DiffPanel";
import { UploadPanel }       from "./components/UploadPanel";
import { ScanProgress }      from "./components/ScanProgress";
import { CameraCapture }     from "./components/CameraCapture";
import { LiveCapture }       from "./components/LiveCapture";
import { ScansGallery }      from "./components/ScansGallery";
import { ObjectCapture }     from "./components/ObjectCapture";
import { FloorPlanView }     from "./components/FloorPlanView";
import { EmbedViewer }       from "./components/EmbedViewer";
import { ReportPanel }       from "./components/ReportPanel";
import { SearchView }        from "./components/SearchView";
import { TimelineView }      from "./components/TimelineView";
import { api }               from "./lib/api";
import type { DiffResult }  from "./lib/api";

type View     = "upload" | "gallery" | "camera" | "live" | "object" | "scanning" | "explore" | "embed" | "search" | "timeline";
type RightTab  = "chat" | "diff" | "report";
type ScanMode  = "room" | "object";
type LeftMode  = "map" | "splat" | "plan" | "cloud";

export default function App() {
  const [view,          setView]          = useState<View>("upload");
  const [scanId,        setScanId]        = useState("scan_001");
  const [objCount,      setObjCount]      = useState(0);
  const [hasSplat,      setHasSplat]      = useState(true);
  const [hasPointCloud, setHasPointCloud] = useState(false);
  const [leftMode,      setLeftMode]      = useState<LeftMode>("map");
  const [rightTab,      setRightTab]      = useState<RightTab>("chat");
  const [scanMode,      setScanMode]      = useState<ScanMode>("room");
  const [mobilePanel,   setMobilePanel]   = useState<"none" | "chat" | "diff" | "report">("none");
  const [isMobile,      setIsMobile]      = useState(() => window.innerWidth < 768);
  const [diffHighlight, setDiffHighlight] = useState<DiffResult | null>(null);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // ── URL routing: ?scan=scan_id&embed=1 on load ───────────────────────────
  useEffect(() => {
    const params    = new URLSearchParams(window.location.search);
    const scanParam = params.get("scan");
    const isEmbed   = params.get("embed") === "1";
    if (scanParam) {
      setScanId(scanParam);
      setHasSplat(false);
      setHasPointCloud(false);
      setView(isEmbed ? "embed" : "explore");
      api.jobStatus(scanParam)
        .then(job => {
          if (job.status === "complete") {
            setHasSplat(job.has_splat ?? false);
            setHasPointCloud(job.has_pointcloud ?? false);
          }
        })
        .catch(() => {});
    }
  }, []);

  function pushScanUrl(id: string) {
    window.history.pushState(null, "", `?scan=${id}`);
  }

  function onScanStarted(id: string, mode: ScanMode = "room") {
    setScanId(id); setScanMode(mode);
    setHasPointCloud(false);
    if (id === "scan_001") { setHasSplat(true); pushScanUrl(id); setView("explore"); return; }
    setHasSplat(false);
    setView("scanning");
  }

  function onComplete(id: string, count: number, splat: boolean, hasCloud: boolean) {
    setScanId(id); setObjCount(count); setHasSplat(splat); setHasPointCloud(hasCloud);
    // Object scans: open straight into 3D viewer
    setLeftMode(scanMode === "object" && splat ? "splat" : "map");
    pushScanUrl(id);
    setView("explore");
  }

  function openScan(id: string, splat: boolean) {
    setScanId(id); setHasSplat(splat); setObjCount(0);
    setHasPointCloud(false);
    setDiffHighlight(null);
    setLeftMode("map");
    setScanMode("room");
    pushScanUrl(id);
    setView("explore");
    // Async: check for point cloud
    api.jobStatus(id)
      .then(j => { if (j.has_pointcloud) setHasPointCloud(true); })
      .catch(() => {});
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
            onOpenSearch={() => setView("search")}
            onDemoMap={() => { setScanId("scan_001"); setHasSplat(false); pushScanUrl("scan_001"); setView("explore"); }}
          />
        </motion.div>
      )}

      {view === "gallery" && (
        <motion.div key="gallery" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <ScansGallery onOpen={openScan} onNewScan={goUpload} onSearch={() => setView("search")} onTimeline={() => setView("timeline")} />
        </motion.div>
      )}

      {view === "search" && (
        <motion.div key="search" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <SearchView onOpen={openScan} onBack={() => setView("gallery")} />
        </motion.div>
      )}

      {view === "timeline" && (
        <motion.div key="timeline" style={styles.page} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <TimelineView onOpen={openScan} onBack={() => setView("gallery")} />
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

      {view === "explore" && isMobile && (
        <motion.div key="explore-mobile" style={styles.mobileRoot} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          {/* ── compact topbar ──────────────────────────────────────────────── */}
          <div style={styles.mobileTopbar}>
            <span style={styles.logoDot} />
            <span style={styles.mobileBrand}>SpazIntel</span>
            <span style={styles.mobileScanId}>{scanId}</span>
            <button
              style={styles.mobileIconBtn}
              onClick={e => {
                const url = `${window.location.origin}${window.location.pathname}?scan=${scanId}`;
                navigator.clipboard.writeText(url).catch(() => {});
                const btn = e.currentTarget; btn.textContent = "✓";
                setTimeout(() => { btn.textContent = "🔗"; }, 1500);
              }}
            >🔗</button>
            <button style={styles.mobileIconBtn} onClick={() => setView("gallery")}>⊞</button>
          </div>

          {/* ── viewer / panel area ─────────────────────────────────────────── */}
          <div style={styles.mobileContent}>
            {mobilePanel === "none" && leftMode === "map"   && <RoomMap scanId={scanId} />}
            {mobilePanel === "none" && leftMode === "cloud" && <PointCloudViewer scanId={scanId} label="Point Cloud" />}
            {mobilePanel === "none" && leftMode === "splat" && hasSplat && <SplatViewer splatUrl={splatUrl} />}
            {mobilePanel === "none" && leftMode === "plan"  && <FloorPlanView scanId={scanId} />}
            {mobilePanel === "chat"   && <ChatPanel scanId={scanId} />}
            {mobilePanel === "diff"   && <DiffPanel currentScanId={scanId} />}
            {mobilePanel === "report" && <ReportPanel scanId={scanId} />}
          </div>

          {/* ── bottom nav bar ──────────────────────────────────────────────── */}
          <nav style={styles.bottomNav}>
            {([
              { key:"map",   icon:"⊞", label:"Map",    panel:"none" as const, mode:"map"   as LeftMode },
              ...(hasPointCloud ? [{ key:"cloud", icon:"☁", label:"Cloud",  panel:"none" as const, mode:"cloud" as LeftMode }] : []),
              ...(hasSplat      ? [{ key:"splat", icon:"✦", label:"3D",     panel:"none" as const, mode:"splat" as LeftMode }] : []),
              { key:"chat",  icon:"💬", label:"Q&A",   panel:"chat"   as const, mode: null },
              { key:"report",icon:"≡",  label:"Report", panel:"report" as const, mode: null },
            ] as { key:string; icon:string; label:string; panel:"none"|"chat"|"diff"|"report"; mode:LeftMode|null }[]).map(t => {
              const isActive = t.mode
                ? mobilePanel === "none" && leftMode === t.mode
                : mobilePanel === t.panel;
              return (
                <button
                  key={t.key}
                  style={{ ...styles.bottomTab, ...(isActive ? styles.bottomTabActive : {}) }}
                  onClick={() => {
                    setMobilePanel(t.panel);
                    if (t.mode) setLeftMode(t.mode);
                  }}
                >
                  <span style={styles.bottomTabIcon}>{t.icon}</span>
                  <span style={styles.bottomTabLabel}>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </motion.div>
      )}

      {view === "explore" && !isMobile && (
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
              <a href={api.exportUrl(scanId)} download={`${scanId}.zip`} style={styles.iconBtn}>↓ ZIP</a>
              {hasSplat && <>
                <a href={api.exportObjUrl(scanId)} download={`${scanId}.obj`} style={styles.iconBtn}>↓ OBJ</a>
                <a href={api.exportGltfUrl(scanId)} download={`${scanId}.glb`} style={styles.iconBtn}>↓ GLB</a>
              </>}
              <button style={styles.newScanBtn} onClick={() => setView("gallery")}>All Scans</button>
              <button style={styles.newScanBtn} onClick={goUpload}>+ New Scan</button>
            </div>
          </header>

          <div style={styles.layout}>
            <motion.div style={styles.leftPane} initial={{ opacity:0, scale:0.98 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.4 }}>
              <div style={styles.viewerLabel}>
                {leftMode === "map" ? "2D Room Map" : leftMode === "splat" ? "3D Gaussian Splat" : leftMode === "cloud" ? "Point Cloud" : "Floor Plan"}
                <div style={styles.modeTabs}>
                  <button style={{ ...styles.modeTab, ...(leftMode === "map"   ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("map")}>Map</button>
                  {hasSplat       && <button style={{ ...styles.modeTab, ...(leftMode === "splat" ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("splat")}>3D</button>}
                  {hasPointCloud  && <button style={{ ...styles.modeTab, ...(leftMode === "cloud" ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("cloud")}>Cloud</button>}
                  <button style={{ ...styles.modeTab, ...(leftMode === "plan"  ? styles.modeTabActive : {}) }} onClick={() => setLeftMode("plan")}>Plan</button>
                </div>
              </div>
              {leftMode === "splat" && hasSplat
                ? <SplatViewer splatUrl={splatUrl} />
                : leftMode === "cloud"
                ? <PointCloudViewer scanId={scanId} label="Scan Point Cloud" />
                : leftMode === "plan"
                ? <FloorPlanView scanId={scanId} />
                : <RoomMap scanId={scanId} diffHighlight={diffHighlight} />
              }
            </motion.div>

            <motion.div style={styles.rightPane} initial={{ opacity:0, x:16 }} animate={{ opacity:1, x:0 }} transition={{ duration:0.4, delay:0.1 }}>
              <div style={styles.tabs}>
                {(["chat","diff","report"] as RightTab[]).map(tab => (
                  <button key={tab} onClick={() => setRightTab(tab)}
                    style={{ ...styles.tab, ...(rightTab===tab ? styles.tabActive : {}) }}>
                    {tab === "chat" ? "Q&A" : tab === "diff" ? "Changes" : "Report"}
                  </button>
                ))}
              </div>
              <div style={styles.panel}>
                {rightTab === "chat"   ? <ChatPanel scanId={scanId} />       :
                 rightTab === "diff"   ? <DiffPanel currentScanId={scanId} onDiffResult={setDiffHighlight} /> :
                                         <ReportPanel scanId={scanId} />}
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

  // ── mobile layout ────────────────────────────────────────────────────────────
  mobileRoot:       { position:"fixed", inset:0, display:"flex", flexDirection:"column", background:"var(--bg)", overflow:"hidden" },
  mobileTopbar:     { height:44, flexShrink:0, borderBottom:"1px solid var(--border)", background:"var(--surface)", display:"flex", alignItems:"center", gap:8, padding:"0 12px" },
  mobileBrand:      { fontWeight:700, fontSize:14, letterSpacing:"-.01em" },
  mobileScanId:     { flex:1, fontSize:10, color:"var(--text-3)", fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const },
  mobileIconBtn:    { background:"transparent", border:"none", color:"var(--text-2)", fontSize:16, cursor:"pointer", padding:"4px 6px", borderRadius:"var(--radius)", flexShrink:0 },
  mobileContent:    { flex:1, minHeight:0, height:0, overflow:"hidden", position:"relative" },
  bottomNav:        { height:60, flexShrink:0, borderTop:"2px solid rgba(99,102,241,.25)", background:"#141414", display:"flex", alignItems:"stretch", paddingBottom:"env(safe-area-inset-bottom)", zIndex:30 },
  bottomTab:        { flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3, background:"transparent", border:"none", cursor:"pointer", padding:"6px 0 4px", transition:"all .15s" },
  bottomTabActive:  { background:"rgba(99,102,241,.18)", borderTop:"2px solid #6366f1" },
  bottomTabIcon:    { fontSize:22, lineHeight:1 },
  bottomTabLabel:   { fontSize:10, fontWeight:700, color:"rgba(255,255,255,.5)", letterSpacing:".03em" },
};
