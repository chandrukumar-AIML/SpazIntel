import React, { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import type { ScanSummary, DiffResult } from "../lib/api";

interface Props {
  onOpen: (scanId: string, hasSplat: boolean) => void;
  onBack: () => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TimelineView({ onOpen, onBack }: Props) {
  const [scans,   setScans]   = useState<ScanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<[string, string] | [string] | []>([]);
  const [diff,    setDiff]    = useState<DiffResult | null>(null);
  const [diffing, setDiffing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listScans()
      .then(d => {
        const sorted = (Array.isArray(d.scans) ? d.scans : [])
          .filter(s => s.status === "complete")
          .sort((a, b) => a.created_at - b.created_at);
        setScans(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function runDiff(a: string, b: string) {
    setDiffing(true);
    setDiff(null);
    try {
      setDiff(await api.diff(a, b));
    } catch {}
    setDiffing(false);
  }

  function toggleNode(id: string) {
    if (selected.length === 0) {
      setSelected([id]);
      setDiff(null);
    } else if (selected.length === 1) {
      if (selected[0] === id) { setSelected([]); return; }
      const pair: [string, string] = [selected[0], id];
      setSelected(pair);
      runDiff(pair[0], pair[1]);
    } else {
      // Replace second node
      const pair: [string, string] = [selected[0], id];
      setSelected(pair);
      runDiff(pair[0], pair[1]);
    }
  }

  function clearSelection() { setSelected([]); setDiff(null); }

  // Delta between consecutive scans
  const deltas: number[] = scans.map((s, i) =>
    i === 0 ? 0 : s.objects_found - scans[i - 1].objects_found
  );

  const hint =
    selected.length === 0 ? "Click a scan to open · select two to compare" :
    selected.length === 1 ? `A: ${selected[0]} selected — click another scan to diff` :
    `Comparing A: ${selected[0]} → B: ${selected[1]}`;

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.wordmark}><span style={s.dot} />SpazIntel</div>
        <span style={s.headerSub}>Room History</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {selected.length > 0 && (
            <button style={s.clearBtn} onClick={clearSelection}>✕ Clear</button>
          )}
          <button style={s.backBtn} onClick={onBack}>← Back</button>
        </div>
      </div>

      {/* Title */}
      <div style={s.titleRow}>
        <div style={s.title}>Scan Timeline</div>
        <div style={s.hint}>{hint}</div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={s.centered}>Loading…</div>
      ) : scans.length === 0 ? (
        <div style={s.centered}>No completed scans yet.</div>
      ) : (
        <div style={s.timelineWrap} ref={scrollRef}>
          <div style={s.timeline}>
            {scans.map((scan, i) => {
              const isA = selected[0] === scan.scan_id;
              const isB = selected.length === 2 && selected[1] === scan.scan_id;
              const delta = deltas[i];

              return (
                <React.Fragment key={scan.scan_id}>
                  {/* Connector */}
                  {i > 0 && (
                    <div style={s.connectorWrap}>
                      <div style={{
                        ...s.deltaLabel,
                        color: delta > 0 ? "#22c55e" : delta < 0 ? "#f87171" : "var(--text-3)"
                      }}>
                        {delta > 0 ? `+${delta}` : delta === 0 ? "±0" : delta}
                      </div>
                      <div style={s.connectorLine} />
                    </div>
                  )}

                  {/* Node */}
                  <div
                    style={{
                      ...s.node,
                      ...(isA ? s.nodeA : {}),
                      ...(isB ? s.nodeB : {}),
                    }}
                    onClick={() => toggleNode(scan.scan_id)}
                  >
                    <div style={{
                      ...s.nodeCircle,
                      ...(isA ? s.circleA : isB ? s.circleB : {})
                    }}>
                      {isA ? "A" : isB ? "B" : i + 1}
                    </div>
                    <div style={s.nodeId}>{scan.name ?? scan.scan_id}</div>
                    {scan.name && <div style={{ fontSize:8, color:"var(--text-3)", fontFamily:"monospace", textAlign:"center" as const, lineHeight:1.2 }}>{scan.scan_id}</div>}
                    <div style={s.nodeDate}>{formatDate(scan.created_at)}</div>
                    <div style={s.nodeCount}>{scan.objects_found} obj</div>
                    {scan.has_splat && <div style={s.nodeTag}>3D</div>}
                    <button
                      style={s.openBtn}
                      onClick={e => { e.stopPropagation(); onOpen(scan.scan_id, scan.has_splat); }}
                    >
                      Open →
                    </button>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* Legend */}
          <div style={s.legend}>
            <span style={{ ...s.legendDot, background: "#6366f1" }} /> A (baseline)
            <span style={{ ...s.legendDot, background: "#8b5cf6", marginLeft: 12 }} /> B (compare)
            <span style={{ color: "#22c55e", marginLeft: 12 }}>+N</span> objects added
            <span style={{ color: "#f87171", marginLeft: 8 }}>−N</span> objects removed
          </div>
        </div>
      )}

      {/* Diff panel */}
      {(diffing || diff) && (
        <div style={s.diffPanel}>
          {diffing ? (
            <div style={s.diffLoading}>
              <div style={s.spinner} />
              Computing diff…
            </div>
          ) : diff ? (
            <>
              <div style={s.diffHeader}>
                <div style={s.diffTitle}>
                  <span style={s.badgeA}>A</span>{scans.find(s => s.scan_id === diff.scan_a)?.name ?? diff.scan_a}
                  <span style={s.arrow}>→</span>
                  <span style={s.badgeB}>B</span>{scans.find(s => s.scan_id === diff.scan_b)?.name ?? diff.scan_b}
                </div>
                <div style={s.diffStats}>
                  {diff.changes.added.length > 0   && <span style={s.statA}>+{diff.changes.added.length} added</span>}
                  {diff.changes.removed.length > 0 && <span style={s.statR}>−{diff.changes.removed.length} removed</span>}
                  {diff.changes.moved.length > 0   && <span style={s.statM}>{diff.changes.moved.length} moved</span>}
                  <span style={s.statU}>{diff.unchanged_count} unchanged</span>
                </div>
              </div>

              <p style={s.diffSummary}>{diff.summary}</p>

              {(diff.changes.added.length + diff.changes.removed.length + diff.changes.moved.length) === 0 ? (
                <div style={s.noChange}>✓ No changes detected between these two scans.</div>
              ) : (
                <div style={s.diffGrid}>
                  {diff.changes.added.length > 0 && (
                    <div style={s.diffCol}>
                      <div style={s.diffColTitle}>Added</div>
                      {diff.changes.added.map(o => (
                        <div key={o.label} style={s.diffItemA}>+ {o.label}</div>
                      ))}
                    </div>
                  )}
                  {diff.changes.removed.length > 0 && (
                    <div style={s.diffCol}>
                      <div style={s.diffColTitle}>Removed</div>
                      {diff.changes.removed.map(o => (
                        <div key={o.label} style={s.diffItemR}>− {o.label}</div>
                      ))}
                    </div>
                  )}
                  {diff.changes.moved.length > 0 && (
                    <div style={s.diffCol}>
                      <div style={s.diffColTitle}>Moved</div>
                      {diff.changes.moved.map(o => (
                        <div key={o.label} style={s.diffItemM}>↔ {o.label} <span style={{ opacity: .6 }}>{o.distance.toFixed(2)}m</span></div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:        { display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg)", overflow:"hidden" },
  header:      { display:"flex", alignItems:"center", gap:10, padding:"0 24px", height:48, borderBottom:"1px solid var(--border)", flexShrink:0 },
  wordmark:    { display:"flex", alignItems:"center", gap:8, fontWeight:700, fontSize:15, letterSpacing:"-.01em" },
  dot:         { width:9, height:9, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
  headerSub:   { fontSize:11, color:"var(--text-3)", fontWeight:400 },
  backBtn:     { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" },
  clearBtn:    { background:"rgba(99,102,241,.1)", border:"1px solid rgba(99,102,241,.3)", color:"#a5b4fc", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" },

  titleRow:    { padding:"20px 24px 0", flexShrink:0 },
  title:       { fontSize:22, fontWeight:700, letterSpacing:"-.03em", marginBottom:4 },
  hint:        { fontSize:12, color:"var(--text-3)" },
  centered:    { flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"var(--text-3)", fontSize:13 },

  timelineWrap:{ flex:1, overflowX:"auto", overflowY:"hidden", padding:"28px 24px 0", display:"flex", flexDirection:"column", minHeight:0 },
  timeline:    { display:"flex", alignItems:"flex-start", gap:0, paddingBottom:16, minWidth:"max-content" },

  connectorWrap: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, paddingTop:24, width:64, flexShrink:0 },
  connectorLine: { height:2, width:"100%", background:"var(--border)" },
  deltaLabel:  { fontSize:10, fontWeight:700, fontFamily:"monospace", whiteSpace:"nowrap" as const },

  node:        { display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"12px 10px", borderRadius:"var(--radius-lg)", border:"1px solid var(--border)", background:"var(--surface)", cursor:"pointer", width:120, flexShrink:0, transition:"border-color 0.15s, box-shadow 0.15s", userSelect:"none" as const },
  nodeA:       { borderColor:"#6366f1", boxShadow:"0 0 0 2px rgba(99,102,241,.2)" },
  nodeB:       { borderColor:"#8b5cf6", boxShadow:"0 0 0 2px rgba(139,92,246,.2)" },

  nodeCircle:  { width:32, height:32, borderRadius:"50%", background:"var(--surface-2)", border:"1px solid var(--border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"var(--text-3)", flexShrink:0 },
  circleA:     { background:"#6366f1", color:"#fff", borderColor:"#6366f1" },
  circleB:     { background:"#8b5cf6", color:"#fff", borderColor:"#8b5cf6" },

  nodeId:      { fontSize:10, fontFamily:"monospace", fontWeight:600, color:"var(--text)", textAlign:"center" as const, wordBreak:"break-all" as const, lineHeight:1.3 },
  nodeDate:    { fontSize:9, color:"var(--text-3)", textAlign:"center" as const },
  nodeCount:   { fontSize:12, fontWeight:700, color:"var(--text-2)" },
  nodeTag:     { fontSize:9, fontWeight:700, color:"#6366f1", background:"rgba(99,102,241,.12)", border:"1px solid rgba(99,102,241,.25)", borderRadius:4, padding:"1px 6px" },
  openBtn:     { fontSize:10, fontWeight:700, color:"var(--accent)", background:"none", border:"none", cursor:"pointer", padding:"2px 0", marginTop:2 },

  legend:      { fontSize:11, color:"var(--text-3)", display:"flex", alignItems:"center", gap:4, paddingTop:8, paddingBottom:4, flexShrink:0 },
  legendDot:   { width:8, height:8, borderRadius:"50%", display:"inline-block" },

  diffPanel:   { flexShrink:0, borderTop:"1px solid var(--border)", background:"var(--surface)", padding:"20px 24px", maxHeight:"45vh", overflowY:"auto" },
  diffLoading: { display:"flex", alignItems:"center", gap:10, color:"var(--text-3)", fontSize:13 },
  spinner:     { width:16, height:16, borderRadius:"50%", border:"2px solid rgba(99,102,241,.2)", borderTopColor:"#6366f1", animation:"spin .8s linear infinite", flexShrink:0 },

  diffHeader:  { display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:10, flexWrap:"wrap" as const },
  diffTitle:   { display:"flex", alignItems:"center", gap:6, fontSize:14, fontWeight:700, fontFamily:"monospace" },
  badgeA:      { background:"#6366f1", color:"#fff", borderRadius:4, padding:"1px 6px", fontSize:11, fontWeight:700, marginRight:4 },
  badgeB:      { background:"#8b5cf6", color:"#fff", borderRadius:4, padding:"1px 6px", fontSize:11, fontWeight:700, marginRight:4 },
  arrow:       { color:"var(--text-3)", fontSize:12 },
  diffStats:   { display:"flex", gap:8, flexWrap:"wrap" as const },
  statA:       { fontSize:12, fontWeight:600, color:"#22c55e" },
  statR:       { fontSize:12, fontWeight:600, color:"#f87171" },
  statM:       { fontSize:12, fontWeight:600, color:"#f59e0b" },
  statU:       { fontSize:12, fontWeight:600, color:"var(--text-3)" },

  diffSummary: { margin:"0 0 14px", fontSize:13, color:"var(--text-2)", lineHeight:1.55 },
  noChange:    { fontSize:13, color:"var(--success)", fontWeight:600 },

  diffGrid:    { display:"flex", gap:24, flexWrap:"wrap" as const },
  diffCol:     { display:"flex", flexDirection:"column", gap:6, minWidth:140 },
  diffColTitle:{ fontSize:10, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase" as const, color:"var(--text-3)", marginBottom:2 },
  diffItemA:   { fontSize:13, color:"#22c55e", fontWeight:500 },
  diffItemR:   { fontSize:13, color:"#f87171", fontWeight:500 },
  diffItemM:   { fontSize:13, color:"#f59e0b", fontWeight:500 },
};
