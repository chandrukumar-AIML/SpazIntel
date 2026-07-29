import React, { useState } from "react";
import { motion } from "framer-motion";
import { SplatViewer } from "./components/SplatViewer";
import { ChatPanel } from "./components/ChatPanel";
import { DiffPanel } from "./components/DiffPanel";

const SCAN_ID = "scan_001";
const SPLAT_URL = "http://localhost:8000/static/splat.ply";

type RightTab = "chat" | "diff";

export default function App() {
  const [rightTab, setRightTab] = useState<RightTab>("chat");

  return (
    <div style={styles.root}>
      {/* Topbar */}
      <header style={styles.topbar}>
        <div style={styles.wordmark}>
          <span style={styles.dot} />
          SpazIntel
          <span style={styles.sub}>Spatial Intelligence Platform</span>
        </div>
        <div style={styles.scanBadge}>
          <span style={styles.scanDot} />
          {SCAN_ID}
        </div>
      </header>

      {/* Main layout */}
      <div style={styles.layout}>
        {/* Left: 3D Viewer */}
        <motion.div
          style={styles.leftPane}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div style={styles.viewerLabel}>3D Gaussian Splat</div>
          <SplatViewer splatUrl={SPLAT_URL} />
        </motion.div>

        {/* Right: Chat + Diff */}
        <motion.div
          style={styles.rightPane}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          {/* Tab switcher */}
          <div style={styles.tabs}>
            {(["chat", "diff"] as RightTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setRightTab(tab)}
                style={{ ...styles.tab, ...(rightTab === tab ? styles.tabActive : {}) }}
              >
                {tab === "chat" ? "Q&A" : "Change Detect"}
                {rightTab === tab && (
                  <motion.span layoutId="tab-indicator" style={styles.tabIndicator} />
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div style={styles.panel}>
            {rightTab === "chat" ? (
              <ChatPanel scanId={SCAN_ID} />
            ) : (
              <DiffPanel />
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)", overflow: "hidden",
  },
  topbar: {
    display: "flex", alignItems: "center", gap: 16,
    padding: "0 20px", height: 48,
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  wordmark: {
    display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
  },
  dot: {
    width: 10, height: 10, borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    flexShrink: 0,
  },
  sub: {
    fontSize: 11, color: "var(--text-3)", fontWeight: 400, letterSpacing: 0,
  },
  scanBadge: {
    marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
    fontSize: 11, color: "var(--text-2)", fontFamily: "monospace",
    padding: "4px 10px", background: "var(--surface-2)",
    border: "1px solid var(--border)", borderRadius: 20,
  },
  scanDot: {
    width: 6, height: 6, borderRadius: "50%", background: "var(--success)", flexShrink: 0,
  },
  layout: {
    flex: 1, display: "grid", gridTemplateColumns: "1fr 380px",
    gap: 12, padding: 12, overflow: "hidden", minHeight: 0,
  },
  leftPane: {
    display: "flex", flexDirection: "column", gap: 8,
    background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)", overflow: "hidden", position: "relative",
  },
  viewerLabel: {
    position: "absolute", top: 12, left: 12, zIndex: 10,
    fontSize: 11, fontWeight: 600, color: "var(--text-3)",
    background: "rgba(8,8,8,0.7)", backdropFilter: "blur(4px)",
    padding: "4px 10px", borderRadius: 20,
    border: "1px solid var(--border)", pointerEvents: "none",
  },
  rightPane: {
    display: "flex", flexDirection: "column", gap: 8, minHeight: 0,
  },
  tabs: {
    display: "flex", gap: 4, background: "var(--surface)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
    padding: 4, flexShrink: 0,
  },
  tab: {
    flex: 1, padding: "6px 12px", border: "none",
    background: "transparent", color: "var(--text-3)", fontSize: 12, fontWeight: 600,
    borderRadius: "var(--radius)", cursor: "pointer", position: "relative",
    transition: "color 0.15s",
  },
  tabActive: {
    color: "var(--text)", background: "var(--surface-2)",
  },
  tabIndicator: {
    position: "absolute", inset: 0,
    background: "var(--surface-2)", borderRadius: "var(--radius)", zIndex: -1,
  },
  panel: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
};
