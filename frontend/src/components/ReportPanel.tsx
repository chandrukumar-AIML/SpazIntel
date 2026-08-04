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

interface Props { scanId: string; }

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

  function downloadCsv() {
    const csv = buildCsv(report!);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${report!.scan_id}_scene_graph.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
          <button style={s.iconBtn} onClick={downloadCsv} title="Download CSV">↓ CSV</button>
          <button style={s.iconBtn} onClick={downloadPdf} title="Open printable report">↓ PDF</button>
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
            No insights generated — check your LLM provider (Claude, Groq, or Ollama).
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
  const isKey = /no llm available|your_key_here/i.test(msg);
  return (
    <div style={s.centred}>
      <div style={{ color: "#f87171", fontSize: 13, textAlign: "center", padding: "0 20px" }}>
        {isKey
          ? "No LLM available. Add ANTHROPIC_API_KEY, GROQ_API_KEY, or run Ollama locally."
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

function buildFloorPlanSvg(objects: ReportData["objects"]): string {
  const W = 360, H = 240, PAD = 24;
  const colors: Record<string, string> = {
    chair:"#6366f1", sofa:"#6366f1", couch:"#6366f1",
    table:"#f59e0b", desk:"#f59e0b", shelf:"#f59e0b",
    tv:"#10b981", monitor:"#10b981",
    bed:"#a855f7", pillow:"#c084fc",
    lamp:"#fbbf24", plant:"#22c55e",
    refrigerator:"#06b6d4",
  };
  // objects in print HTML don't have position — use index layout in a grid
  const n = objects.length;
  const cols = Math.ceil(Math.sqrt(n * 1.5));
  const rows = Math.ceil(n / cols);
  const cw = (W - PAD * 2) / cols;
  const ch = (H - PAD * 2) / rows;

  const dots = objects.map((o, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = PAD + col * cw + cw / 2;
    const cy = PAD + row * ch + ch / 2;
    const color = colors[o.label] ?? "#71717a";
    const r = 8;
    const lbl = o.label.length > 8 ? o.label.slice(0, 7) + "…" : o.label;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}cc" stroke="${color}" stroke-width="1.5"/>
<text x="${cx}" y="${cy + r + 10}" text-anchor="middle" font-size="7" fill="#555" font-family="system-ui">${lbl}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="4" fill="#f8f8fa" stroke="#e5e7eb" stroke-width="1"/>
  <rect x="${PAD}" y="${PAD}" width="${W - PAD * 2}" height="${H - PAD * 2}" rx="2" fill="none" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4 3"/>
  ${dots}
</svg>`;
}

function buildPrintHtml(r: ReportData): string {
  const distRows = r.top_distances
    .map((d, i) => `<tr class="${i % 2 ? "alt" : ""}"><td>${d.from}</td><td class="arrow">↔</td><td>${d.to}</td><td class="val">${d.distance_m} m</td></tr>`)
    .join("");
  const date = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  const svgFloor = buildFloorPlanSvg(r.objects);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Spatial Report — ${r.scan_id}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#111;line-height:1.55;font-size:13px}
  .page{max-width:720px;margin:0 auto;padding:48px 40px}
  .header{display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:20px;border-bottom:2px solid #6366f1;margin-bottom:28px}
  .brand{font-size:11px;font-weight:700;letter-spacing:.08em;color:#6366f1;text-transform:uppercase;margin-bottom:6px}
  .room-type{font-size:26px;font-weight:800;letter-spacing:-.02em;color:#111}
  .scan-meta{font-size:11px;color:#888;margin-top:4px;font-family:monospace}
  .date{font-size:11px;color:#aaa;text-align:right}
  .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:28px}
  .tile{background:#f4f4f5;border-radius:8px;padding:12px;text-align:center}
  .tile-v{font-size:22px;font-weight:800;color:#111}
  .tile-l{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;align-items:start}
  h2{font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  .overview{font-size:13px;color:#333;line-height:1.65;margin-bottom:24px}
  table{border-collapse:collapse;width:100%;font-size:12px}
  tr.alt td{background:#f9f9fb}
  td{padding:5px 8px;border-bottom:1px solid #f0f0f0;color:#333}
  td.arrow{color:#bbb;padding:5px 4px;text-align:center}
  td.val{font-weight:700;color:#6366f1;text-align:right;font-family:monospace}
  .insight-box{background:#faf5ff;border-left:3px solid #7c3aed;padding:11px 14px;border-radius:0 6px 6px 0;margin-bottom:7px;font-size:12px;color:#3b2f6b;line-height:1.6}
  .floor-plan{text-align:center;margin-bottom:24px}
  .footer{margin-top:40px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:10px;color:#bbb;display:flex;justify-content:space-between}
  @media print{
    .page{padding:24px 28px}
    @page{margin:12mm;size:A4}
  }
</style></head><body><div class="page">
  <div class="header">
    <div>
      <div class="brand">SpazIntel — Spatial Intelligence Report</div>
      <div class="room-type">${r.room_type}</div>
      <div class="scan-meta">${r.scan_id}</div>
    </div>
    <div class="date">${date}</div>
  </div>

  <div class="tiles">
    <div class="tile"><div class="tile-v">${r.metrics.object_count}</div><div class="tile-l">objects</div></div>
    <div class="tile"><div class="tile-v">${r.metrics.room_width_m != null ? r.metrics.room_width_m + "m" : "—"}</div><div class="tile-l">width</div></div>
    <div class="tile"><div class="tile-v">${r.metrics.room_depth_m != null ? r.metrics.room_depth_m + "m" : "—"}</div><div class="tile-l">depth</div></div>
    <div class="tile"><div class="tile-v">${r.metrics.distance_pairs}</div><div class="tile-l">dist pairs</div></div>
  </div>

  ${r.overview ? `<div class="overview"><h2>Overview</h2><p>${r.overview}</p></div>` : ""}

  <div class="floor-plan">
    <h2 style="text-align:left;margin-bottom:10px">Object Layout</h2>
    ${svgFloor}
  </div>

  <div class="two-col">
    ${distRows ? `<div><h2>Key Distances</h2><table>${distRows}</table></div>` : ""}
    <div>
      <h2>Detected Objects</h2>
      <table>
        ${r.objects.map((o, i) => `<tr class="${i % 2 ? "alt" : ""}"><td>${o.label}</td><td class="val">${Math.round(o.confidence * 100)}%</td></tr>`).join("")}
      </table>
    </div>
  </div>

  ${r.insights.length > 0 ? `<div><h2 style="margin-bottom:10px">✦ AI Insights</h2>${r.insights.map(i => `<div class="insight-box">${i}</div>`).join("")}</div>` : ""}

  <div class="footer">
    <span>Generated by SpazIntel — Spatial Intelligence Platform</span>
    <span>${r.scan_id}</span>
  </div>
</div></body></html>`;
}


// ── CSV Export ─────────────────────────────────────────────────────────────────

function buildCsv(r: ReportData): string {
  const lines: string[] = [
    `# SpazIntel Scene Graph Export — ${r.scan_id}`,
    `# Room type: ${r.room_type}`,
    `# Room size: ${r.metrics.room_width_m ?? "?"}m × ${r.metrics.room_depth_m ?? "?"}m`,
    "",
    "label,confidence_pct",
    ...r.objects.map(o => `${o.label},${Math.round(o.confidence * 100)}`),
    "",
    "from,to,distance_m",
    ...r.top_distances.map(d => `${d.from},${d.to},${d.distance_m}`),
  ];
  return lines.join("\n");
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
