import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api";
import type { DiffResult, ScanSummary, SceneObject } from "../lib/api";

interface ExtDiffResult extends DiffResult {
  summary_ai?: boolean;
}

interface Props {
  currentScanId?: string;
  onDiffResult?: (result: ExtDiffResult | null) => void;
}

export function DiffPanel({ currentScanId, onDiffResult }: Props) {
  const [scans,   setScans]   = useState<ScanSummary[]>([]);
  const [scanA,   setScanA]   = useState(currentScanId ?? "");
  const [scanB,   setScanB]   = useState("");
  const [result,  setResult]  = useState<ExtDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    api.listScans().then(d => {
      const completed = (Array.isArray(d.scans) ? d.scans : []).filter(s => s.status === "complete");
      setScans(completed);
      const baseId = currentScanId ?? completed[0]?.scan_id ?? "";
      if (!scanA) setScanA(baseId);
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
      const r = await api.diff(scanA, scanB) as ExtDiffResult;
      setResult(r);
      onDiffResult?.(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
      onDiffResult?.(null);
    } finally {
      setLoading(false);
    }
  }

  const hasChanges = result && (
    result.changes.added.length + result.changes.removed.length + result.changes.moved.length > 0
  );
  const completedScans = scans.filter(s => s.status === "complete");
  const scanAName = scans.find(s => s.scan_id === result?.scan_a)?.name ?? result?.scan_a ?? "";
  const scanBName = scans.find(s => s.scan_id === result?.scan_b)?.name ?? result?.scan_b ?? "";

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
              {loading ? "Analyzing…" : "Detect Changes"}
            </button>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {/* AI summary */}
              <div style={styles.summaryBox}>
                {result.summary_ai && (
                  <span style={styles.aiPill}>✦ AI</span>
                )}
                <p style={styles.summaryText}>{result.summary}</p>
              </div>

              {/* Mini diff map */}
              {hasChanges && (
                <DiffMap result={result} />
              )}

              {!hasChanges && (
                <div style={styles.noChange}>
                  ✓ No changes detected between {scanAName} and {scanBName}
                </div>
              )}

              {/* Change lists */}
              {result.changes.added.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--success)" }}>+ Added ({result.changes.added.length})</div>
                  <div style={styles.pills}>
                    {result.changes.added.map((o, i) => (
                      <span key={i} style={{ ...styles.pill, background:"rgba(16,185,129,0.15)", color:"var(--success)", border:"1px solid rgba(16,185,129,0.25)" }}>{o.label}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.changes.removed.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--danger)" }}>− Removed ({result.changes.removed.length})</div>
                  <div style={styles.pills}>
                    {result.changes.removed.map((o, i) => (
                      <span key={i} style={{ ...styles.pill, background:"rgba(239,68,68,0.15)", color:"var(--danger)", border:"1px solid rgba(239,68,68,0.25)" }}>{o.label}</span>
                    ))}
                  </div>
                </div>
              )}

              {result.changes.moved.length > 0 && (
                <div style={styles.section}>
                  <div style={{ ...styles.sectionLabel, color:"var(--warning)" }}>↔ Moved ({result.changes.moved.length})</div>
                  <div style={styles.pills}>
                    {result.changes.moved.map((o, i) => (
                      <span key={i} style={{ ...styles.pill, background:"rgba(245,158,11,0.15)", color:"var(--warning)", border:"1px solid rgba(245,158,11,0.25)" }}>
                        {o.label} <span style={{ opacity:0.7, fontSize:10 }}>Δ{o.distance.toFixed(2)}m</span>
                      </span>
                    ))}
                  </div>
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


// Mini SVG map showing diff positions
function DiffMap({ result }: { result: ExtDiffResult }) {
  const W = 260, H = 160, PAD = 16;
  const iW = W - PAD * 2, iH = H - PAD * 2;

  // Collect all objects with positions for bounds
  const allPos: { x: number; y: number }[] = [];
  const addPos = (pos?: SceneObject["position"] | null) => {
    if (pos && pos.x_norm != null && pos.y_norm != null) {
      allPos.push({ x: pos.x_norm, y: pos.y_norm });
    }
  };
  result.changes.added.forEach(o => addPos(o.position));
  result.changes.moved.forEach(o => { addPos(o.from); addPos(o.to); });

  if (allPos.length === 0) return null;

  const xs = allPos.map(p => p.x);
  const ys = allPos.map(p => p.y);
  const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1);

  function toSvg(x: number, y: number) {
    const nx = ((x - minX) / (maxX - minX || 1));
    const ny = ((y - minY) / (maxY - minY || 1));
    return { cx: PAD + nx * iW, cy: PAD + ny * iH };
  }

  return (
    <div style={{ background:"var(--surface-2)", borderRadius:"var(--radius)", overflow:"hidden", border:"1px solid var(--border)" }}>
      <div style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase" as const, color:"var(--text-3)", padding:"6px 10px 0" }}>Diff Map</div>
      <svg width={W} height={H} style={{ display:"block" }}>
        {/* Background grid */}
        <rect x={PAD} y={PAD} width={iW} height={iH} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

        {/* Removed: red X */}
        {result.changes.removed.map((o, i) => {
          // No position for removed, just show label in corner
          const cx = PAD + (i % 3) * 48 + 24;
          const cy = PAD + 10;
          return (
            <g key={`r${i}`}>
              <circle cx={cx} cy={cy} r={7} fill="rgba(239,68,68,0.25)" stroke="#ef4444" strokeWidth={1.5} />
              <text x={cx} y={cy + 4} textAnchor="middle" fill="#ef4444" fontSize={8}>✕</text>
              <text x={cx} y={cy + 18} textAnchor="middle" fill="rgba(239,68,68,0.8)" fontSize={7}>{o.label}</text>
            </g>
          );
        })}

        {/* Added: green dot */}
        {result.changes.added.map((o, i) => {
          if (!o.position) return null;
          const { cx, cy } = toSvg(o.position.x_norm, o.position.y_norm);
          return (
            <g key={`a${i}`}>
              <circle cx={cx} cy={cy} r={8} fill="rgba(16,185,129,0.2)" stroke="#10b981" strokeWidth={1.5} />
              <text x={cx} y={cy + 4} textAnchor="middle" fill="#10b981" fontSize={8}>+</text>
              <text x={cx} y={cy + 18} textAnchor="middle" fill="rgba(16,185,129,0.8)" fontSize={7}>{o.label}</text>
            </g>
          );
        })}

        {/* Moved: arrow from→to */}
        {result.changes.moved.map((o, i) => {
          if (!o.from || !o.to) return null;
          const from = toSvg((o.from as SceneObject["position"]).x_norm, (o.from as SceneObject["position"]).y_norm);
          const to   = toSvg((o.to as SceneObject["position"]).x_norm, (o.to as SceneObject["position"]).y_norm);
          return (
            <g key={`m${i}`}>
              <line x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 2" markerEnd="url(#arr)" />
              <circle cx={from.cx} cy={from.cy} r={5} fill="rgba(245,158,11,0.2)" stroke="#f59e0b" strokeWidth={1} />
              <circle cx={to.cx}   cy={to.cy}   r={6} fill="rgba(245,158,11,0.3)" stroke="#f59e0b" strokeWidth={1.5} />
              <text x={to.cx} y={to.cy - 10} textAnchor="middle" fill="rgba(245,158,11,0.9)" fontSize={7}>{o.label}</text>
            </g>
          );
        })}

        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
          </marker>
        </defs>
      </svg>
      <div style={{ display:"flex", gap:12, padding:"0 10px 8px", fontSize:9, color:"var(--text-3)" }}>
        <span><span style={{ color:"#10b981" }}>●</span> added</span>
        <span><span style={{ color:"#ef4444" }}>●</span> removed</span>
        <span><span style={{ color:"#f59e0b" }}>●</span> moved</span>
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
  summaryBox:  { background:"rgba(99,102,241,0.06)", border:"1px solid rgba(99,102,241,0.18)", borderRadius:"var(--radius)", padding:"12px 14px", position:"relative" as const },
  aiPill:      { position:"absolute" as const, top:-8, right:10, fontSize:9, fontWeight:700, letterSpacing:".08em", background:"rgba(99,102,241,0.85)", color:"#fff", padding:"1px 6px", borderRadius:10 },
  summaryText: { fontSize:13, color:"var(--text-2)", lineHeight:1.6, margin:0 },
  noChange:    { fontSize:12, color:"var(--success)", textAlign:"center" as const, padding:"12px 0" },
  section:     { display:"flex", flexDirection:"column" as const, gap:6 },
  sectionLabel:{ fontSize:11, fontWeight:700, textTransform:"uppercase" as const, letterSpacing:"0.05em" },
  pills:       { display:"flex", flexWrap:"wrap" as const, gap:5 },
  pill:        { fontSize:12, padding:"3px 9px", borderRadius:14, fontWeight:500 },
  unchanged:   { fontSize:11, color:"var(--text-3)", textAlign:"right" as const },
  danger:      { color:"#ef4444" },
};
