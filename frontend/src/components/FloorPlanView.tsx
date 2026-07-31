import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Props { scanId: string }

export function FloorPlanView({ scanId }: Props) {
  const [svg, setSvg]       = useState<string>("");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [copied, setCopied] = useState(false);

  const url = api.floorPlanUrl(scanId);

  useEffect(() => {
    setStatus("loading");
    setSvg("");
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(text => { setSvg(text); setStatus("ok"); })
      .catch(() => setStatus("error"));
  }, [url]);

  function downloadSvg() {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a    = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${scanId}-floor-plan.svg`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyEmbedCode() {
    const origin = window.location.origin;
    const code   = `<iframe src="${origin}/?scan=${scanId}&embed=1" width="800" height="600" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={s.wrap}>
      <div style={s.toolbar}>
        <span style={s.label}>Floor Plan</span>
        <div style={s.actions}>
          <button style={s.btn} onClick={copyEmbedCode} disabled={status !== "ok"}>
            {copied ? "✓ Copied!" : "</> Embed"}
          </button>
          <button style={s.btn} onClick={downloadSvg} disabled={status !== "ok"}>
            ↓ SVG
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" style={s.btn}>
            ↗ Full size
          </a>
        </div>
      </div>

      <div style={s.viewer}>
        {status === "loading" && <div style={s.overlay}>Generating floor plan…</div>}
        {status === "error"   && <div style={s.overlay}>Could not load floor plan</div>}
        {status === "ok" && (
          <div
            style={s.svgWrap}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap:    { display:"flex", flexDirection:"column", height:"100%", padding:"8px 12px", gap:8, overflow:"hidden" },
  toolbar: { display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 },
  label:   { fontSize:11, fontWeight:600, color:"var(--text-3)" },
  actions: { display:"flex", gap:6 },
  btn:     { background:"var(--surface-2)", border:"1px solid var(--border)", color:"var(--text-2)",
              borderRadius:"var(--radius)", padding:"4px 10px", fontSize:11, cursor:"pointer",
              fontWeight:600, textDecoration:"none", display:"inline-flex", alignItems:"center" },
  viewer:  { flex:1, minHeight:0, display:"flex", alignItems:"center", justifyContent:"center",
              overflow:"hidden", position:"relative" },
  svgWrap: { width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center" },
  overlay: { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, color:"var(--text-3)" },
};
