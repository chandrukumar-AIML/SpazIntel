import React, { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

interface ReportData {
  scan_id: string;
  room_type: string;
  overview: string;
  insights: string[];
  metrics: {
    object_count: number;
    room_width_m: number | null;
    room_depth_m: number | null;
    distance_pairs: number;
  };
  objects: { label: string; confidence: number }[];
  top_distances: { from: string; to: string; distance_m: number }[];
  cached: boolean;
}

interface Props { scanId: string }

export function ReportPanel({ scanId }: Props) {
  const [state,  setState]  = useState<"idle" | "loading" | "done" | "error">("idle");
  const [report, setReport] = useState<ReportData | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(async (regen = false) => {
    setState("loading");
    setErrMsg("");
    try {
      const data = await api.report(scanId, regen);
      setReport(data);
      setState("done");
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Failed to generate report");
      setState("error");
    }
  }, [scanId]);

  useEffect(() => { load(); }, [load]);

  function downloadPdf() {
    const w = window.open("", "_blank")!;
    w.document.write(buildPrintHtml(report!));
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 400);
  }

  if (state === "loading") return <LoadingState />;
  if (state === "error")   return <ErrorState msg={errMsg} onRetry={() => load(true)} />;
  if (!report)             return <IdleState onGenerate={() => load()} />;

  const { room_type, overview, insights, metrics, objects, top_distances, cached } = report;

  return (
    <div style={s.wrap} id="report-root">
      {/* Header */}
      <div style={s.header}>
        <div style={s.roomBadge}>{room_type}</div>
        <div style={s.headerRight}>
          {cached && <span style={s.cachedTag}>cached</span>}
          <button style={s.iconBtn} onClick={() => load(true)} title="Regenerate">↺</button>
          <button style={s.iconBtn} onClick={downloadPdf} title="Download PDF">↓ PDF</button>
        </div>
      </div>

      <div style={s.body}>
        {/* Stat tiles */}
        <div style={s.tiles}>
          <Tile value={metrics.object_count} label="objects" />
          <Tile value={metrics.room_width_m != null ? `${metrics.room_width_m}m` : "—"} label="width" />
          <Tile value={metrics.room_depth_m != null ? `${metrics.room_depth_m}m` : "—"} label="depth" />
          <Tile value={metrics.distance_pairs} label="pairs" />
        </div>

        {/* Overview */}
        {overview && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Overview</div>
            <p style={s.overviewText}>{overview}</p>
          </section>
        )}

        {/* Objects */}
        {objects.length > 0 && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Objects detected</div>
            <div style={s.objGrid}>
              {objects.map(o => (
                <div key={o.label} style={s.objChip}>
                  <span style={s.objLabel}>{o.label}</span>
                  <ConfBar pct={o.confidence} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Distances */}
        {top_distances.length > 0 && (
          <section style={s.section}>
            <div style={s.sectionLabel}>Key distances</div>
            <table style={s.distTable}>
              <tbody>
                {top_distances.map((d, i) => (
                  <tr key={i} style={s.distRow}>
                    <td style={s.distFrom}>{d.from}</td>
                    <td style={s.distArrow}>↔</td>
                    <td style={s.distTo}>{d.to}</td>
                    <td style={s.distVal}>{d.distance_m} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* AI Insights */}
        {insights.length > 0 && (
          <section style={s.insightSection}>
            <div style={s.insightLabel}>✦ AI Insights</div>
            <ul style={s.insightList}>
              {insights.map((txt, i) => (
                <li key={i} style={s.insightItem}>{txt}</li>
              ))}
            </ul>
          </section>
        )}

        {insights.length === 0 && state === "done" && (
          <div style={s.noInsights}>
            No AI key configured — add <code>ANTHROPIC_API_KEY</code> to .env for insights.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Tile({ value, label }: { value: string | number; label: string }) {
  return (
    <div style={s.tile}>
      <div style={s.tileVal}>{value}</div>
      <div style={s.tileLabel}>{label}</div>
    </div>
  );
}

function ConfBar({ pct }: { pct: number }) {
  const w = Math.round(pct * 100);
  const color = pct >= 0.85 ? "#22c55e" : pct >= 0.65 ? "#f59e0b" : "#94a3b8";
  return (
    <div style={s.barTrack}>
      <div style={{ ...s.barFill, width: `${w}%`, background: color }} />
      <span style={s.barLabel}>{w}%</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={s.centred}>
      <div style={s.spinner} />
      <span style={s.dimText}>Generating report…</span>
    </div>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  const isKey = /api.?key|authentication|401/i.test(msg);
  return (
    <div style={s.centred}>
      <div style={{ color: "#f87171", fontSize: 13, textAlign: "center", padding: "0 20px" }}>
        {isKey
          ? "Add ANTHROPIC_API_KEY to .env to enable AI reports."
          : `Error: ${msg}`}
      </div>
      <button style={s.retryBtn} onClick={onRetry}>Retry</button>
    </div>
  );
}

function IdleState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div style={s.centred}>
      <button style={s.genBtn} onClick={onGenerate}>Generate Report</button>
    </div>
  );
}

// ── Print HTML ─────────────────────────────────────────────────────────────────

function buildPrintHtml(r: ReportData): string {
  const rows = r.top_distances
    .map(d => `<tr><td>${d.from}</td><td>↔</td><td>${d.to}</td><td>${d.distance_m} m</td></tr>`)
    .join("");
  const objs = r.objects.map(o => `${o.label} (${Math.round(o.confidence * 100)}%)`).join(" · ");
  const insightItems = r.insights.map(i => `<li>${i}</li>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Spatial Report — ${r.scan_id}</title>
<style>
  body{font-family:-apple-system,sans-serif;max-width:680px;margin:40px auto;color:#111;line-height:1.5}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:#666;font-size:13px;margin-bottom:24px}
  .tiles{display:flex;gap:16px;margin-bottom:24px}
  .tile{background:#f4f4f5;border-radius:8px;padding:12px 16px;min-width:80px}
  .tile .v{font-size:20px;font-weight:700}
  .tile .l{font-size:11px;color:#888;margin-top:2px}
  h2{font-size:14px;font-weight:600;color:#444;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin:20px 0 10px}
  p{margin:0;font-size:14px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  td{padding:5px 8px}
  td:last-child{font-weight:600;text-align:right}
  .insight{background:#faf5ff;border-left:3px solid #7c3aed;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}
  .objs{font-size:13px;color:#374151}
  @media print{body{margin:20px}}
</style></head><body>
<h1>${r.room_type}</h1>
<div class="sub">${r.scan_id} · Generated by SpazIntel</div>
<div class="tiles">
  <div class="tile"><div class="v">${r.metrics.object_count}</div><div class="l">objects</div></div>
  ${r.metrics.room_width_m != null ? `<div class="tile"><div class="v">${r.metrics.room_width_m}m</div><div class="l">width</div></div>` : ""}
  ${r.metrics.room_depth_m != null ? `<div class="tile"><div class="v">${r.metrics.room_depth_m}m</div><div class="l">depth</div></div>` : ""}
</div>
${r.overview ? `<h2>Overview</h2><p>${r.overview}</p>` : ""}
${objs ? `<h2>Objects</h2><p class="objs">${objs}</p>` : ""}
${rows ? `<h2>Key Distances</h2><table>${rows}</table>` : ""}
${insightItems ? `<h2>AI Insights</h2>${r.insights.map(i => `<div class="insight">${i}</div>`).join("")}` : ""}
</body></html>`;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  wrap:        { display:"flex", flexDirection:"column", height:"100%", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" },
  header:      { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderBottom:"1px solid var(--border)", flexShrink:0 },
  roomBadge:   { background:"rgba(124,58,237,.15)", color:"#a78bfa", border:"1px solid rgba(124,58,237,.3)", borderRadius:20, padding:"3px 12px", fontSize:12, fontWeight:700, letterSpacing:".01em" },
  headerRight: { display:"flex", alignItems:"center", gap:6 },
  cachedTag:   { fontSize:10, color:"var(--text-3)", fontFamily:"monospace", padding:"2px 6px", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:10 },
  iconBtn:     { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"4px 10px", fontSize:12, cursor:"pointer", fontWeight:600 },
  body:        { flex:1, overflowY:"auto", padding:"14px", display:"flex", flexDirection:"column", gap:14 },
  tiles:       { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 },
  tile:        { background:"var(--surface-2)", borderRadius:"var(--radius)", padding:"10px 8px", textAlign:"center" },
  tileVal:     { fontSize:18, fontWeight:700, color:"var(--text)", lineHeight:1 },
  tileLabel:   { fontSize:10, color:"var(--text-3)", marginTop:3, textTransform:"uppercase", letterSpacing:".05em" },
  section:     { display:"flex", flexDirection:"column", gap:8 },
  sectionLabel:{ fontSize:11, fontWeight:600, color:"var(--text-3)", textTransform:"uppercase", letterSpacing:".06em" },
  overviewText:{ fontSize:13, color:"var(--text-2)", lineHeight:1.6, margin:0 },
  objGrid:     { display:"flex", flexDirection:"column", gap:5 },
  objChip:     { display:"flex", alignItems:"center", gap:8, fontSize:12 },
  objLabel:    { color:"var(--text-2)", minWidth:90, fontWeight:500 },
  barTrack:    { flex:1, height:6, background:"var(--surface-2)", borderRadius:3, position:"relative", overflow:"hidden", display:"flex", alignItems:"center" },
  barFill:     { position:"absolute", left:0, top:0, bottom:0, borderRadius:3, transition:"width .3s" },
  barLabel:    { position:"absolute", right:4, fontSize:9, color:"var(--text-3)", zIndex:1 },
  distTable:   { width:"100%", borderCollapse:"collapse" as const, fontSize:12 },
  distRow:     { borderBottom:"1px solid var(--border)" },
  distFrom:    { padding:"5px 0", color:"var(--text-2)", fontWeight:500 },
  distArrow:   { padding:"5px 6px", color:"var(--text-3)", textAlign:"center" as const },
  distTo:      { padding:"5px 0", color:"var(--text-2)", fontWeight:500 },
  distVal:     { padding:"5px 0", color:"var(--accent)", fontWeight:700, textAlign:"right" as const, fontFamily:"monospace" },
  insightSection: { background:"rgba(124,58,237,.06)", border:"1px solid rgba(124,58,237,.2)", borderRadius:"var(--radius)", padding:"12px 14px" },
  insightLabel:   { fontSize:11, fontWeight:700, color:"#a78bfa", marginBottom:8, letterSpacing:".04em" },
  insightList:    { margin:0, padding:"0 0 0 16px", display:"flex", flexDirection:"column", gap:6 },
  insightItem:    { fontSize:12, color:"var(--text-2)", lineHeight:1.55 },
  noInsights:     { fontSize:12, color:"var(--text-3)", padding:"10px 0" },
  centred:     { flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 },
  spinner:     { width:24, height:24, borderRadius:"50%", border:"2px solid rgba(99,102,241,.25)", borderTopColor:"#6366f1", animation:"spin .8s linear infinite" },
  dimText:     { fontSize:13, color:"var(--text-3)" },
  retryBtn:    { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"6px 16px", fontSize:12, cursor:"pointer", fontWeight:600 },
  genBtn:      { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 20px", fontSize:13, fontWeight:600, cursor:"pointer" },
};
