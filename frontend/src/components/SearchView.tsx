import React, { useState, useRef } from "react";
import { api } from "../lib/api";

interface SearchResultItem {
  scan_id: string;
  name?: string;
  score: number;
  reason: string;
  preview_objects: string[];
}

interface Props {
  onOpen: (scanId: string, hasSplat: boolean) => void;
  onBack: () => void;
}

const EXAMPLE_QUERIES = [
  "bedroom with a bed and pillow",
  "home office with desk",
  "room with sofa",
  "scan with the most objects",
];

export function SearchView({ onOpen, onBack }: Props) {
  const [query,    setQuery]    = useState("");
  const [state,    setState]    = useState<"idle" | "loading" | "done" | "error">("idle");
  const [results,  setResults]  = useState<SearchResultItem[]>([]);
  const [meta,     setMeta]     = useState({ total: 0, query: "" });
  const [errMsg,   setErrMsg]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setState("loading");
    setErrMsg("");
    try {
      const data = await api.search(trimmed);
      setResults(data.results);
      setMeta({ total: data.total_scans_searched, query: data.query });
      setState("done");
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Search failed");
      setState("error");
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") runSearch(query);
  }

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.wordmark}>
          <span style={s.dot} />
          SpazIntel
        </div>
        <button style={s.backBtn} onClick={onBack}>← Back</button>
      </div>

      {/* Search bar */}
      <div style={s.searchWrap}>
        <div style={s.searchBar}>
          <span style={s.searchIcon}>🔍</span>
          <input
            ref={inputRef}
            style={s.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search all your scans…"
            autoFocus
          />
          {query && (
            <button style={s.clearBtn} onClick={() => { setQuery(""); inputRef.current?.focus(); setState("idle"); }}>✕</button>
          )}
          <button style={s.goBtn} onClick={() => runSearch(query)} disabled={!query.trim() || state === "loading"}>
            {state === "loading" ? "…" : "Search"}
          </button>
        </div>

        {/* Example chips */}
        {state === "idle" && (
          <div style={s.chips}>
            {EXAMPLE_QUERIES.map(q => (
              <button key={q} style={s.chip} onClick={() => { setQuery(q); runSearch(q); }}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={s.body}>
        {state === "idle" && (
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>🔍</div>
            <div style={s.emptyTitle}>Search across all your scans</div>
            <div style={s.emptySub}>
              Describe a room, an object, or a spatial arrangement — AI finds the matching scans.
            </div>
            <div style={s.uniqueBadge}>✦ No competitor offers this</div>
          </div>
        )}

        {state === "loading" && (
          <div style={s.centered}>
            <div style={s.spinner} />
            <span style={s.dimText}>Searching {meta.total > 0 ? meta.total : ""} scans…</span>
          </div>
        )}

        {state === "error" && (
          <div style={s.centered}>
            <div style={{ color: "#f87171", fontSize: 13 }}>{errMsg}</div>
          </div>
        )}

        {state === "done" && (
          <>
            <div style={s.resultsMeta}>
              {results.length === 0
                ? `No matches in ${meta.total} scan${meta.total !== 1 ? "s" : ""}`
                : `${results.length} match${results.length !== 1 ? "es" : ""} across ${meta.total} scan${meta.total !== 1 ? "s" : ""} for "${meta.query}"`}
            </div>

            {results.length === 0 ? (
              <div style={s.centered}>
                <div style={s.emptyIcon}>🗂️</div>
                <div style={s.emptySub}>Try a different query or scan more rooms.</div>
              </div>
            ) : (
              <div style={s.resultsList}>
                {results.map(r => (
                  <ResultCard key={r.scan_id} result={r} onOpen={onOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ResultCard({ result, onOpen }: { result: SearchResultItem; onOpen: Props["onOpen"] }) {
  const { scan_id, score, reason, preview_objects } = result;
  const scoreColor = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#94a3b8";

  return (
    <div style={s.card}>
      <div style={s.cardTop}>
        <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
          <span style={s.cardScanId}>{result.name ?? scan_id}</span>
          {result.name && <span style={{ fontSize:9, fontFamily:"monospace", color:"var(--text-3)" }}>{scan_id}</span>}
        </div>
        <div style={s.scorePill}>
          <div style={{ ...s.scoreBar, width: `${score}%`, background: scoreColor }} />
          <span style={{ ...s.scoreNum, color: scoreColor }}>{score}</span>
        </div>
      </div>

      <p style={s.reason}>{reason}</p>

      <div style={s.objTags}>
        {preview_objects.map(obj => (
          <span key={obj} style={s.objTag}>{obj}</span>
        ))}
      </div>

      <button style={s.openBtn} onClick={() => onOpen(scan_id, false)}>
        Open scan →
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:      { display:"flex", flexDirection:"column", height:"100vh", background:"var(--bg)", overflow:"hidden" },
  header:    { display:"flex", alignItems:"center", gap:12, padding:"0 24px", height:48, borderBottom:"1px solid var(--border)", flexShrink:0 },
  wordmark:  { display:"flex", alignItems:"center", gap:8, fontWeight:700, fontSize:15, letterSpacing:"-.01em" },
  dot:       { width:9, height:9, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
  backBtn:   { marginLeft:"auto", background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:"var(--radius)", padding:"5px 12px", fontSize:12, fontWeight:600, cursor:"pointer" },

  searchWrap:  { padding:"24px 24px 0", flexShrink:0 },
  searchBar:   { display:"flex", alignItems:"center", gap:8, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"8px 12px", boxShadow:"0 1px 8px rgba(0,0,0,.12)" },
  searchIcon:  { fontSize:18, flexShrink:0 },
  searchInput: { flex:1, background:"transparent", border:"none", outline:"none", fontSize:15, color:"var(--text)", fontFamily:"inherit" },
  clearBtn:    { background:"none", border:"none", color:"var(--text-3)", cursor:"pointer", fontSize:14, padding:"0 4px", lineHeight:1 },
  goBtn:       { background:"var(--accent)", color:"#fff", border:"none", borderRadius:8, padding:"6px 16px", fontSize:13, fontWeight:700, cursor:"pointer", flexShrink:0 },

  chips: { display:"flex", flexWrap:"wrap" as const, gap:6, marginTop:12 },
  chip:  { background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text-2)", borderRadius:20, padding:"5px 14px", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" as const },

  body:     { flex:1, overflowY:"auto", padding:"20px 24px" },
  centered: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, minHeight:200 },

  emptyState:  { display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center" as const, gap:10, paddingTop:60 },
  emptyIcon:   { fontSize:48, marginBottom:4 },
  emptyTitle:  { fontSize:18, fontWeight:700, letterSpacing:"-.02em" },
  emptySub:    { fontSize:13, color:"var(--text-3)", maxWidth:340, lineHeight:1.6 },
  uniqueBadge: { background:"rgba(124,58,237,.12)", color:"#a78bfa", border:"1px solid rgba(124,58,237,.3)", borderRadius:20, padding:"4px 14px", fontSize:11, fontWeight:700, marginTop:8 },

  spinner:  { width:24, height:24, borderRadius:"50%", border:"2px solid rgba(99,102,241,.2)", borderTopColor:"#6366f1", animation:"spin .8s linear infinite" },
  dimText:  { fontSize:13, color:"var(--text-3)" },

  resultsMeta: { fontSize:12, color:"var(--text-3)", marginBottom:14 },
  resultsList: { display:"flex", flexDirection:"column", gap:10 },

  card:      { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:"16px 18px", display:"flex", flexDirection:"column", gap:10 },
  cardTop:   { display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 },
  cardScanId:{ fontFamily:"monospace", fontSize:13, fontWeight:700, color:"var(--text)" },

  scorePill: { display:"flex", alignItems:"center", gap:8, flexShrink:0 },
  scoreBar:  { height:4, borderRadius:2, background:"var(--success)", minWidth:4, maxWidth:80, transition:"width .3s" },
  scoreNum:  { fontSize:11, fontWeight:700, fontFamily:"monospace", minWidth:24, textAlign:"right" as const },

  reason:  { margin:0, fontSize:13, color:"var(--text-2)", lineHeight:1.55 },
  objTags: { display:"flex", flexWrap:"wrap" as const, gap:5 },
  objTag:  { fontSize:11, fontWeight:600, color:"var(--text-3)", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:4, padding:"2px 8px" },

  openBtn: { alignSelf:"flex-end" as const, background:"var(--accent)", color:"#fff", border:"none", borderRadius:"var(--radius)", padding:"6px 18px", fontSize:12, fontWeight:700, cursor:"pointer" },
};
