import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import type { DiffResult, ScanSummary } from "../lib/api";

interface Props { currentScanId?: string }

export function DiffPanel({ currentScanId }: Props) {
  const [scans,   setScans]   = useState<ScanSummary[]>([]);
  const [scanA,   setScanA]   = useState(currentScanId ?? "");
  const [scanB,   setScanB]   = useState("");
  const [result,  setResult]  = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    api.listScans().then(d => {
      const completed = (Array.isArray(d.scans) ? d.scans : []).filter(s => s.status === "complete");
      setScans(completed);
      const baseId = currentScanId ?? completed[0]?.scan_id ?? "";
      if (!scanA) setScanA(baseId);
      // default B to the first scan that differs from A
      const other = completed.find(s => s.scan_id !== baseId);
      if (other) setScanB(other.scan_id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (currentScanId) setScanA(currentScanId);
  }, [currentScanId]);

  async function run() {
    if (!scanA || !scanB || scanA === scanB) return;
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

  const completedScans = scans.filter(s => s.status === "complete");

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <span style={styles.icon}>⇄</span>
        Change Detection
      </div>

      <div style={styles.body}>
        {completedScans.length < 2 ? (
          <div style={styles.empty}>
            You need at least 2 completed scans to compare.<br />
            Scan the same room twice to detect what changed.
          </div>
        ) : (
          <>
            <div style={styles.scanRow}>
              <div style={styles.selectWrap}>
                <div style={styles.selectLabel}>Before</div>
                <select style={styles.select} value={scanA} onChange={e => setScanA(e.target.value)}>
                  {completedScans.map(s => (
                    <option key={s.scan_id} value={s.scan_id}>{s.name ?? s.scan_id} · {s.objects_found} obj</option>
                  ))}
                </select>
              </div>
              <span style={styles.arrow}>→</span>
              <div style={styles.selectWrap}>
                <div style={styles.selectLabel}>After</div>
                <select style={styles.select} value={scanB} onChange={e => setScanB(e.target.value)}>
                  {completedScans.map(s => (
                    <option key={s.scan_id} value={s.scan_id}>{s.name ?? s.scan_id} · {s.objects_found} obj</option>
                  ))}
                </select>
              </div>
            </div>

            {scanA === scanB && (
              <div style={styles.sameWarn}>Pick two different scans to compare</div>
            )}

            <button
              style={{ ...styles.btn, ...(loading || scanA === scanB ? styles.btnDisabled : {}) }}
              onClick={run}
              disabled={loading || !scanA || !scanB || scanA === scanB}
            >
              {loading ? "Running…" : "Detect Changes"}
            </button>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div style={styles.summary}>{result.summary}</div>

              {!hasChanges && (
                <div style={styles.noChange}>
                  ✓ No changes detected between {scans.find(s => s.scan_id === result.scan_a)?.name ?? result.scan_a} and {scans.find(s => s.scan_id === result.scan_b)?.name ?? result.scan_b}
                </div>
              )}

              {result.changes.added.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--success)" }}>+ Added ({result.changes.added.length})</div>
                  {result.changes.added.map((o, i) => (
                    <div key={i} style={styles.changeRow}>
                      <span style={{ ...styles.badge, background:"rgba(16,185,129,0.15)", color:"var(--success)" }}>{o.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.changes.removed.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--danger)" }}>− Removed ({result.changes.removed.length})</div>
                  {result.changes.removed.map((o, i) => (
                    <div key={i} style={styles.changeRow}>
                      <span style={{ ...styles.badge, background:"rgba(239,68,68,0.15)", color:"var(--danger)" }}>{o.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {result.changes.moved.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--warning)" }}>↔ Moved ({result.changes.moved.length})</div>
                  {result.changes.moved.map((o, i) => (
                    <div key={i} style={styles.changeRow}>
                      <span style={{ ...styles.badge, background:"rgba(245,158,11,0.15)", color:"var(--warning)" }}>{o.label}</span>
                      <span style={styles.pos}>Δ {o.distance.toFixed(2)}m</span>
                    </div>
                  ))}
                </div>
              )}

              {result.unchanged_count > 0 && (
                <div style={styles.unchanged}>{result.unchanged_count} unchanged</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap:        { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", height:"100%", display:"flex", flexDirection:"column" },
  header:      { display:"flex", alignItems:"center", gap:8, padding:"12px 16px", borderBottom:"1px solid var(--border)", fontSize:13, fontWeight:600, flexShrink:0 },
  icon:        { fontSize:16 },
  body:        { padding:16, display:"flex", flexDirection:"column", gap:12, overflowY:"auto", flex:1 },
  empty:       { fontSize:13, color:"var(--text-3)", lineHeight:1.6, textAlign:"center" as const, padding:"24px 0" },
  scanRow:     { display:"flex", gap:8, alignItems:"flex-end" },
  selectWrap:  { flex:1, display:"flex", flexDirection:"column", gap:4 },
  selectLabel: { fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase" as const, color:"var(--text-3)" },
  select:      { background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"7px 10px", color:"var(--text)", fontSize:12, outline:"none", fontFamily:"monospace", cursor:"pointer", width:"100%" },
  arrow:       { color:"var(--text-3)", flexShrink:0, paddingBottom:8 },
  sameWarn:    { fontSize:11, color:"var(--warning)", textAlign:"center" as const },
  btn:         { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer", width:"100%" },
  btnDisabled: { opacity:0.5, cursor:"not-allowed" },
  error:       { color:"var(--danger)", fontSize:12 },
  summary:     { fontSize:13, color:"var(--text-2)", padding:"10px 12px", background:"var(--surface-2)", borderRadius:"var(--radius)", marginBottom:8 },
  noChange:    { fontSize:12, color:"var(--success)", textAlign:"center" as const, padding:"12px 0" },
  section:     { marginBottom:10 },
  sectionLabel:{ fontSize:11, fontWeight:700, marginBottom:6, textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  changeRow:   { display:"flex", alignItems:"center", gap:8, marginBottom:4 },
  badge:       { fontSize:12, padding:"2px 8px", borderRadius:4, fontWeight:500 },
  pos:         { fontSize:11, color:"var(--text-3)", fontFamily:"monospace" },
  unchanged:   { fontSize:11, color:"var(--text-3)", textAlign:"right" as const, marginTop:4 },
};
