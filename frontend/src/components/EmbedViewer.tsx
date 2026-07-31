import React, { useEffect, useState } from "react";
import { SplatViewer } from "./SplatViewer";
import { RoomMap }     from "./RoomMap";
import { api }         from "../lib/api";

interface Props {
  scanId:  string;
  hasSplat: boolean;
}

type Mode = "map" | "splat";

export function EmbedViewer({ scanId, hasSplat }: Props) {
  const [mode, setMode] = useState<Mode>(hasSplat ? "splat" : "map");
  const [resolvedSplat, setResolvedSplat] = useState(hasSplat);

  useEffect(() => {
    if (!hasSplat) {
      api.jobStatus(scanId)
        .then(j => { if (j.has_splat) { setResolvedSplat(true); setMode("splat"); } })
        .catch(() => {});
    }
  }, [scanId, hasSplat]);

  const splatUrl = api.splatUrl(scanId);

  return (
    <div style={s.root}>
      {/* Viewer fills entire viewport */}
      <div style={s.viewer}>
        {mode === "splat" && resolvedSplat
          ? <SplatViewer splatUrl={splatUrl} />
          : <RoomMap scanId={scanId} />
        }
      </div>

      {/* Minimal HUD: mode toggle + attribution */}
      <div style={s.hud}>
        {resolvedSplat && (
          <button style={s.pill} onClick={() => setMode(m => m === "map" ? "splat" : "map")}>
            {mode === "map" ? "3D View" : "2D Map"}
          </button>
        )}
        <a
          href="https://spazintel.com"
          target="_blank"
          rel="noopener noreferrer"
          style={s.badge}
        >
          <span style={s.dot} />
          SpazIntel
        </a>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:   { position:"fixed", inset:0, background:"var(--bg)", display:"flex", flexDirection:"column" },
  viewer: { flex:1, minHeight:0, overflow:"hidden" },
  hud:    { position:"absolute", bottom:12, right:12, display:"flex", alignItems:"center", gap:8, zIndex:10 },
  pill:   { background:"rgba(0,0,0,0.6)", backdropFilter:"blur(8px)", border:"1px solid rgba(255,255,255,0.12)",
             color:"rgba(255,255,255,0.8)", borderRadius:20, padding:"5px 12px", fontSize:12,
             fontWeight:600, cursor:"pointer", letterSpacing:"0.01em" },
  badge:  { display:"flex", alignItems:"center", gap:5, background:"rgba(0,0,0,0.5)", backdropFilter:"blur(8px)",
             border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.5)", borderRadius:20,
             padding:"4px 10px", fontSize:11, fontWeight:600, textDecoration:"none", letterSpacing:"0.02em" },
  dot:    { width:6, height:6, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink:0 },
};
