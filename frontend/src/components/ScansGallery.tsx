import React, { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";
import type { ScanSummary } from "../lib/api";

interface Props {
  onOpen:     (scanId: string, hasSplat: boolean) => void;
  onNewScan:  () => void;
  onSearch:   () => void;
  onTimeline: () => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60)    return "just now";
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_COLOR: Record<string, string> = {
  complete:   "var(--success)",
  error:      "var(--danger)",
  processing: "var(--amber)",
  queued:     "var(--amber)",
};

function ScanCard({
  scan,
  onOpen,
  onRenamed,
  onDeleted,
}: {
  scan: ScanSummary;
  onOpen: Props["onOpen"];
  onRenamed: (scan_id: string, name: string) => void;
  onDeleted: (scan_id: string) => void;
}) {
  const [editing,     setEditing]     = useState(false);
  const [nameVal,     setNameVal]     = useState(scan.name ?? "");
  const [saving,      setSaving]      = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function commitRename() {
    const trimmed = nameVal.trim();
    setEditing(false);
    if (!trimmed || trimmed === (scan.name ?? "")) return;
    setSaving(true);
    try {
      await api.rename(scan.scan_id, trimmed);
      onRenamed(scan.scan_id, trimmed);
    } catch {}
    setSaving(false);
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await api.deleteScan(scan.scan_id);
      onDeleted(scan.scan_id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
      setConfirmDel(false);
    }
  }

  const displayName = scan.name || scan.scan_id;

  return (
    <div style={s.card}>
      {/* Card header */}
      <div style={s.cardTop}>
        <div style={s.cardNameRow}>
          {editing ? (
            <input
              ref={inputRef}
              style={s.nameInput}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }}
              maxLength={48}
            />
          ) : (
            <span
              style={{ ...s.scanName, ...(saving ? { opacity: 0.5 } : {}) }}
              onClick={() => { setNameVal(scan.name ?? ""); setEditing(true); }}
              title="Click to rename"
            >
              {displayName}
              <span style={s.editHint}>✎</span>
            </span>
          )}
          {scan.name && (
            <span style={s.scanIdSub}>{scan.scan_id}</span>
          )}
        </div>
        <span style={{ ...s.statusDot, background: STATUS_COLOR[scan.status] ?? "var(--text-3)" }} />
      </div>

      {/* Stats row */}
      <div style={s.statsRow}>
        <div style={s.stat}>
          <div style={s.statNum}>{scan.objects_found}</div>
          <div style={s.statLabel}>objects</div>
        </div>
        <div style={s.stat}>
          <div style={s.statNum}>{scan.has_splat ? "3D" : "2D"}</div>
          <div style={s.statLabel}>{scan.has_splat ? "splat" : "map"}</div>
        </div>
        <div style={s.stat}>
          <div style={s.statNum}>{relativeTime(scan.created_at)}</div>
          <div style={s.statLabel}>created</div>
        </div>
      </div>

      {/* Tags */}
      <div style={s.tags}>
        {scan.has_splat && <span style={{ ...s.tag, ...s.tagAccent }}>Gaussian Splat</span>}
        {scan.objects_found > 0 && <span style={{ ...s.tag, ...s.tagGreen }}>Scene graph</span>}
        {scan.status !== "complete" && <span style={{ ...s.tag, ...s.tagAmber }}>{scan.status}</span>}
      </div>

      {/* Actions */}
      <div style={s.actions}>
        <button
          style={s.openBtn}
          onClick={() => onOpen(scan.scan_id, scan.has_splat)}
          disabled={scan.status !== "complete"}
        >
          Open →
        </button>
        <a
          href={api.exportUrl(scan.scan_id)}
          download={`${scan.scan_id}.zip`}
          style={{ ...s.exportBtn, ...(scan.status !== "complete" ? s.exportBtnDisabled : {}) }}
          onClick={e => scan.status !== "complete" && e.preventDefault()}
        >
          ↓
        </a>
        {confirmDel ? (
          <div style={s.delConfirm}>
            <span style={s.delConfirmText}>Delete?</span>
            <button style={s.delYes} onClick={doDelete} disabled={deleting}>
              {deleting ? "…" : "Yes"}
            </button>
            <button style={s.delNo} onClick={() => setConfirmDel(false)}>No</button>
          </div>
        ) : (
          scan.scan_id !== "scan_001" && (
            <button style={s.delBtn} onClick={() => setConfirmDel(true)} title="Delete scan">🗑</button>
          )
        )}
      </div>
    </div>
  );
}

export function ScansGallery({ onOpen, onNewScan, onSearch, onTimeline }: Props) {
  const [scans,   setScans]   = useState<ScanSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    function fetchScans() {
      api.listScans()
        .then(d => { if (mounted) { setScans(Array.isArray(d.scans) ? d.scans : []); setLoading(false); } })
        .catch(() => { if (mounted) setLoading(false); });
    }
    fetchScans();
    const id = setInterval(fetchScans, 4000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  function handleRenamed(scan_id: string, name: string) {
    setScans(prev => prev.map(s => s.scan_id === scan_id ? { ...s, name } : s));
  }

  function handleDeleted(scan_id: string) {
    setScans(prev => prev.filter(s => s.scan_id !== scan_id));
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.wordmark}>
          <span style={s.dot} />
          SpazIntel
        </div>
        <div style={s.headerRight}>
          <button style={s.searchBtn} onClick={onSearch}>🔍 Search</button>
          <button style={s.searchBtn} onClick={onTimeline}>📅 Timeline</button>
          <button style={s.newBtn} onClick={onNewScan}>+ New Scan</button>
        </div>
      </div>

      <div style={s.body}>
        <div style={s.title}>Your Scans</div>
        <div style={s.sub}>{scans.length} scan{scans.length !== 1 ? "s" : ""} · click a name to rename</div>

        {loading ? (
          <div style={s.empty}>Loading…</div>
        ) : scans.length === 0 ? (
          <div style={s.empty}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📷</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No scans yet</div>
            <div style={{ color: "var(--text-3)", fontSize: 12 }}>
              Upload a video or use live scan to create your first room capture.
            </div>
            <button style={{ ...s.newBtn, marginTop: 16 }} onClick={onNewScan}>Start scanning</button>
          </div>
        ) : (
          <div style={s.grid}>
            {scans.map(scan => (
              <ScanCard
                key={scan.scan_id}
                scan={scan}
                onOpen={onOpen}
                onRenamed={handleRenamed}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:     { display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg)", overflow:"hidden" },
  header:   { display:"flex", alignItems:"center", gap:12, padding:"0 24px", height:48, borderBottom:"1px solid var(--border)", flexShrink:0 },
  wordmark: { display:"flex", alignItems:"center", gap:8, fontWeight:700, fontSize:15, letterSpacing:"-.01em" },
  dot:      { width:9, height:9, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
  headerRight:{ marginLeft:"auto", display:"flex", gap:8 },
  searchBtn:{ background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"6px 14px", fontSize:13, fontWeight:600, cursor:"pointer" },
  newBtn:   { background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"6px 16px", fontSize:13, fontWeight:600, cursor:"pointer" },
  body:     { flex:1, overflowY:"auto", padding:"32px 24px" },
  title:    { fontSize:22, fontWeight:700, letterSpacing:"-.03em", marginBottom:4 },
  sub:      { fontSize:13, color:"var(--text-3)", marginBottom:24 },
  empty:    { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:280, color:"var(--text-2)", textAlign:"center" as const, gap:0 },
  grid:     { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:12 },

  card:        { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:18, display:"flex", flexDirection:"column", gap:12 },
  cardTop:     { display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 },
  cardNameRow: { display:"flex", flexDirection:"column", gap:3, flex:1, minWidth:0 },
  scanName:    { fontSize:14, fontWeight:700, color:"var(--text)", cursor:"pointer", whiteSpace:"nowrap" as const, overflow:"hidden", textOverflow:"ellipsis", display:"flex", alignItems:"center", gap:5 },
  editHint:    { fontSize:11, color:"var(--text-3)", opacity:0.4 },
  scanIdSub:   { fontSize:10, fontFamily:"monospace", color:"var(--text-3)" },
  nameInput:   { fontSize:14, fontWeight:700, background:"var(--surface-2)", border:"1px solid var(--accent)", borderRadius:4, padding:"2px 6px", color:"var(--text)", outline:"none", width:"100%" },
  statusDot:   { width:8, height:8, borderRadius:"50%", flexShrink:0, marginTop:4 },

  statsRow:  { display:"flex", gap:0 },
  stat:      { flex:1, display:"flex", flexDirection:"column", gap:2 },
  statNum:   { fontSize:18, fontWeight:700, letterSpacing:"-.02em", fontVariantNumeric:"tabular-nums" as const },
  statLabel: { fontSize:10, color:"var(--text-3)", fontWeight:500, letterSpacing:".04em", textTransform:"uppercase" as const },

  tags:     { display:"flex", flexWrap:"wrap" as const, gap:5 },
  tag:      { fontSize:10, fontWeight:600, padding:"2px 8px", borderRadius:4, border:"1px solid var(--border)" },
  tagAccent:{ background:"rgba(99,102,241,.12)", color:"#6366f1",  borderColor:"rgba(99,102,241,.25)" },
  tagGreen: { background:"rgba(16,185,129,.12)", color:"#10b981",  borderColor:"rgba(16,185,129,.25)" },
  tagAmber: { background:"rgba(245,158,11,.12)", color:"#f59e0b",  borderColor:"rgba(245,158,11,.25)" },

  actions:         { display:"flex", gap:8, marginTop:"auto", alignItems:"center" },
  openBtn:         { flex:1, background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"8px 0", fontSize:13, fontWeight:600, cursor:"pointer" },
  exportBtn:       { display:"flex", alignItems:"center", justifyContent:"center", background:"var(--surface-2)", color:"var(--text-2)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"8px 10px", fontSize:12, fontWeight:600, cursor:"pointer", textDecoration:"none" },
  exportBtnDisabled:{ opacity:0.4, cursor:"not-allowed" as const, pointerEvents:"none" as const },
  delBtn:          { background:"none", border:"1px solid var(--border)", color:"var(--text-3)", borderRadius:"var(--radius)", padding:"7px 9px", fontSize:13, cursor:"pointer" },
  delConfirm:      { display:"flex", alignItems:"center", gap:4 },
  delConfirmText:  { fontSize:11, color:"var(--danger)" },
  delYes:          { background:"var(--danger)", color:"#fff", border:"none", borderRadius:4, padding:"4px 8px", fontSize:11, fontWeight:700, cursor:"pointer" },
  delNo:           { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:4, padding:"4px 8px", fontSize:11, cursor:"pointer" },
};
