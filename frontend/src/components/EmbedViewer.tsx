import React, { useEffect, useState } from "react";
import { SplatViewer }       from "./SplatViewer";
import { RoomMap }           from "./RoomMap";
import { PointCloudViewer }  from "./PointCloudViewer";
import { api }               from "../lib/api";

interface Props {
  scanId:  string;
  hasSplat: boolean;
}

type Mode = "cloud" | "map" | "splat";

interface ScanMeta {
  hasSplat:      boolean;
  hasCloud:      boolean;
  objectsFound:  number;
  name?:         string;
}

export function EmbedViewer({ scanId, hasSplat }: Props) {
  const [meta,    setMeta]    = useState<ScanMeta>({ hasSplat, hasCloud: false, objectsFound: 0 });
  const [mode,    setMode]    = useState<Mode>("map");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.jobStatus(scanId)
      .then(j => {
        const hasCloud = j.has_pointcloud ?? false;
        const m: ScanMeta = {
          hasSplat:     j.has_splat ?? hasSplat,
          hasCloud,
          objectsFound: j.objects_found ?? 0,
        };
        setMeta(m);
        // Auto-pick best view
        if (hasCloud) setMode("cloud");
        else if (m.hasSplat) setMode("splat");
        else setMode("map");
      })
      .catch(() => {
        if (hasSplat) setMode("splat");
      })
      .finally(() => setLoading(false));
  }, [scanId, hasSplat]);

  const tabs: { key: Mode; label: string }[] = [
    ...(meta.hasCloud  ? [{ key: "cloud" as Mode, label: "☁ Cloud" }] : []),
    { key: "map",   label: "⊞ Map"  },
    ...(meta.hasSplat ? [{ key: "splat" as Mode, label: "✦ 3D"    }] : []),
  ];

  const scanLabel = scanId.replace(/_/g, " ").replace(/scan /i, "Scan #");

  return (
    <div style={s.root}>
      {/* ── viewer ──────────────────────────────────────────────────────────── */}
      <div style={s.viewer}>
        {loading
          ? <div style={s.loadingScreen}><div style={s.spinner} /><span style={s.loadingTxt}>Loading scan…</span></div>
          : mode === "cloud"
          ? <PointCloudViewer scanId={scanId} label={scanLabel} />
          : mode === "splat"
          ? <SplatViewer splatUrl={api.splatUrl(scanId)} />
          : <RoomMap scanId={scanId} />
        }
      </div>

      {/* ── floating topbar ─────────────────────────────────────────────────── */}
      <div style={s.topbar}>
        <div style={s.brand}>
          <span style={s.brandDot} />
          <span style={s.brandName}>SpazIntel</span>
          <span style={s.brandSep}>·</span>
          <span style={s.scanName}>{scanLabel}</span>
        </div>

        <div style={s.meta}>
          {meta.objectsFound > 0 && (
            <span style={s.metaPill}>
              <span style={s.metaDot} />
              {meta.objectsFound} objects
            </span>
          )}
          {meta.hasCloud  && <span style={s.metaPill}>☁ 3D cloud</span>}
          {meta.hasSplat  && <span style={s.metaPill}>✦ 3D splat</span>}
        </div>

        <a
          href={`${window.location.origin}${window.location.pathname}`}
          target="_blank"
          rel="noopener noreferrer"
          style={s.cta}
        >
          Make your own ↗
        </a>
      </div>

      {/* ── floating mode tabs ──────────────────────────────────────────────── */}
      {tabs.length > 1 && !loading && (
        <div style={s.tabRow}>
          {tabs.map(t => (
            <button
              key={t.key}
              style={{ ...s.tab, ...(mode === t.key ? s.tabActive : {}) }}
              onClick={() => setMode(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── powered-by badge ────────────────────────────────────────────────── */}
      <div style={s.poweredBy}>
        <span style={s.pwDot} />
        Powered by SpazIntel
      </div>
    </div>
  );
}

const glass = {
  background:    "rgba(8,8,12,0.72)",
  backdropFilter:"blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  border:        "1px solid rgba(255,255,255,0.08)",
} as React.CSSProperties;

const s: Record<string, React.CSSProperties> = {
  root:   { position:"fixed", inset:0, background:"#040406", overflow:"hidden" },
  viewer: { position:"absolute", inset:0 },

  // loading
  loadingScreen: { position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 },
  spinner:       { width:32, height:32, borderRadius:"50%", border:"2px solid rgba(99,102,241,.2)", borderTopColor:"#6366f1", animation:"spin .8s linear infinite" },
  loadingTxt:    { fontSize:14, color:"rgba(255,255,255,.5)", fontWeight:500 },

  // topbar
  topbar: {
    ...glass,
    position:"absolute", top:12, left:12, right:12,
    borderRadius:14, padding:"10px 16px",
    display:"flex", alignItems:"center", gap:12,
    zIndex:20,
  },
  brand:    { display:"flex", alignItems:"center", gap:7, flexShrink:0 },
  brandDot: { width:8, height:8, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
  brandName:{ fontSize:13, fontWeight:700, color:"rgba(255,255,255,.9)", letterSpacing:"-.01em" },
  brandSep: { color:"rgba(255,255,255,.2)", fontSize:13 },
  scanName: { fontSize:12, color:"rgba(255,255,255,.55)", fontWeight:500, fontFamily:"monospace" },

  meta:    { display:"flex", alignItems:"center", gap:6, flex:1, flexWrap:"wrap" as const },
  metaPill:{ fontSize:10, color:"rgba(165,180,252,.7)", background:"rgba(99,102,241,.12)", border:"1px solid rgba(99,102,241,.2)", borderRadius:20, padding:"2px 8px", fontWeight:600, letterSpacing:".02em", display:"flex", alignItems:"center", gap:4 },
  metaDot: { width:5, height:5, borderRadius:"50%", background:"#6366f1", flexShrink:0 },

  cta:  { fontSize:11, color:"rgba(165,180,252,.8)", background:"rgba(99,102,241,.2)", border:"1px solid rgba(99,102,241,.35)", borderRadius:20, padding:"5px 14px", fontWeight:700, textDecoration:"none", letterSpacing:".02em", flexShrink:0, whiteSpace:"nowrap" as const, transition:"background .15s" },

  // mode tabs
  tabRow:   {
    ...glass,
    position:"absolute", bottom:20, left:"50%", transform:"translateX(-50%)",
    borderRadius:30, padding:4,
    display:"flex", gap:2, zIndex:20,
  },
  tab:      { background:"transparent", border:"none", color:"rgba(255,255,255,.45)", borderRadius:24, padding:"6px 16px", fontSize:12, fontWeight:600, cursor:"pointer", letterSpacing:".02em", transition:"all .15s", whiteSpace:"nowrap" as const },
  tabActive:{ background:"rgba(99,102,241,.3)", color:"#a5b4fc", border:"1px solid rgba(99,102,241,.4)" },

  // powered-by
  poweredBy: {
    position:"absolute", bottom:20, right:16,
    fontSize:10, color:"rgba(255,255,255,.2)", fontWeight:600,
    display:"flex", alignItems:"center", gap:5, letterSpacing:".04em",
    zIndex:20, pointerEvents:"none",
  },
  pwDot: { width:5, height:5, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
};
