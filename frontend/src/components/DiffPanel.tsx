import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import type { DiffResult } from "../lib/api";

export function DiffPanel() {
  const [scanA, setScanA] = useState("scan_001");
  const [scanB, setScanB] = useState("");
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!scanA || !scanB) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await api.diff(scanA, scanB);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  const hasChanges = result && (
    result.changes.added.length + result.changes.removed.length + result.changes.moved.length > 0
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.icon}>⇄</span>
        Change Detection
      </div>

      <div style={styles.body}>
        <div style={styles.scanRow}>
          <input style={styles.input} value={scanA} onChange={e=>setScanA(e.target.value)} placeholder="Scan A ID" />
          <span style={styles.arrow}>→</span>
          <input style={styles.input} value={scanB} onChange={e=>setScanB(e.target.value)} placeholder="Scan B ID" />
        </div>
        <button style={{ ...styles.btn, ...(loading ? styles.btnDisabled:{}) }} onClick={run} disabled={loading||!scanA||!scanB}>
          {loading ? "Running…" : "Run Change Detection"}
        </button>

        {error && <div style={styles.error}>{error}</div>}

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div style={styles.summary}>{result.summary}</div>

              {!hasChanges && (
                <div style={styles.noChange}>No changes detected between {result.scan_a} and {result.scan_b}</div>
              )}

              {result.changes.added.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--success)" }}>+ Added ({result.changes.added.length})</div>
                  {result.changes.added.map((o,i) => (
                    <div key={i} style={styles.changeRow}>
                      <span style={{ ...styles.badge, background:"rgba(16,185,129,0.15)", color:"var(--success)" }}>{o.label}</span>
                      <span style={styles.pos}>@ ({o.position.x_norm}, {o.position.y_norm})</span>
                    </div>
                  ))}
                </div>
              )}

              {result.changes.removed.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--danger)" }}>− Removed ({result.changes.removed.length})</div>
                  {result.changes.removed.map((o,i) => (
                    <div key={i} style={styles.changeRow}>
                      <span style={{ ...styles.badge, background:"rgba(239,68,68,0.15)", color:"var(--danger)" }}>{o.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.changes.moved.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--warning)" }}>↔ Moved ({result.changes.moved.length})</div>
                  {result.changes.moved.map((o,i) => (
                    <div key={i} style={styles.changeRow}>
                      <span style={{ ...styles.badge, background:"rgba(245,158,11,0.15)", color:"var(--warning)" }}>{o.label}</span>
                      <span style={styles.pos}>Δ {o.distance.toFixed(2)} units</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={styles.unchanged}>{result.unchanged_count} object(s) unchanged</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap:       { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" },
  header:     { display:"flex", alignItems:"center", gap:8, padding:"12px 16px", borderBottom:"1px solid var(--border)", fontSize:13, fontWeight:600 },
  icon:       { fontSize:16 },
  body:       { padding:"16px", display:"flex", flexDirection:"column", gap:12 },
  scanRow:    { display:"flex", gap:8, alignItems:"center" },
  input:      { flex:1, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"7px 10px", color:"var(--text)", fontSize:12, outline:"none", fontFamily:"monospace" },
  arrow:      { color:"var(--text-3)", flexShrink:0 },
  btn:        { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer", width:"100%" },
  btnDisabled:{ opacity:0.5, cursor:"not-allowed" },
  error:      { color:"var(--danger)", fontSize:12 },
  summary:    { fontSize:13, color:"var(--text-2)", padding:"10px 12px", background:"var(--surface-2)", borderRadius:"var(--radius)", marginBottom:8 },
  noChange:   { fontSize:12, color:"var(--success)", textAlign:"center" as const, padding:"12px 0" },
  section:    { marginBottom:10 },
  sectionLabel:{ fontSize:11, fontWeight:700, marginBottom:6, textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  changeRow:  { display:"flex", alignItems:"center", gap:8, marginBottom:4 },
  badge:      { fontSize:12, padding:"2px 8px", borderRadius:4, fontWeight:500 },
  pos:        { fontSize:11, color:"var(--text-3)", fontFamily:"monospace" },
  unchanged:  { fontSize:11, color:"var(--text-3)", textAlign:"right" as const, marginTop:4 },
};
