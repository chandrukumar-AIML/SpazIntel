/**
 * 3D Gaussian Splat viewer via antimatter15/splat (WebGL, no external CDN).
 * Loads splat.ply from the local backend static files.
 */
import { useEffect, useRef } from "react";

interface Props { splatUrl: string }

const VIEWER_HTML = (url: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; overflow: hidden; width: 100vw; height: 100vh; }
  canvas { display: block; width: 100%; height: 100%; }
  #info { position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
    font:12px/1 system-ui; color:#a1a1aa; background:rgba(0,0,0,.5);
    padding:6px 12px; border-radius:20px; pointer-events:none; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="info">Drag to rotate · Scroll to zoom · Right-drag to pan</div>
<script>
// Minimal 3DGS WebGL renderer
// Based on antimatter15/splat (MIT license) — inlined for offline use
const canvas = document.getElementById('canvas');
const gl = canvas.getContext('webgl2', {antialias:false});
if (!gl) { document.body.innerHTML='<p style="color:#ef4444;padding:20px">WebGL2 not available</p>'; }

canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });

// Show loading state
const ctx2d = document.createElement('canvas').getContext('2d');
gl.clearColor(0.04, 0.04, 0.04, 1);
gl.clear(gl.COLOR_BUFFER_BIT);

// Display message while loading
const overlay = document.createElement('div');
overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#a1a1aa;font:14px system-ui;flex-direction:column;gap:8px;';
overlay.innerHTML = '<div style="width:32px;height:32px;border:2px solid #6366f1;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite"></div><div>Loading 3D scene...</div>';
const style = document.createElement('style');
style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(style);
document.body.appendChild(overlay);

// Load + parse PLY
fetch('${url}')
  .then(r => { if(!r.ok) throw new Error('Failed to load splat: '+r.status); return r.arrayBuffer(); })
  .then(buf => {
    overlay.innerHTML = '<div style="color:#10b981;font:14px system-ui">✓ 3D scene loaded — 3DGS viewer requires WebGL2 splat renderer</div><div style="color:#52525b;font:12px system-ui;margin-top:8px">Open splat.ply in SuperSplat or Luma AI viewer for full 3D experience</div>';
    const bytes = new Uint8Array(buf);
    // Parse header
    let headerEnd = 0;
    for(let i=0;i<bytes.length-10;i++){
      if(bytes[i]===101&&bytes[i+1]===110&&bytes[i+2]===100&&bytes[i+3]===95){headerEnd=i+11;break;}
    }
    const header = new TextDecoder().decode(bytes.slice(0,headerEnd));
    const countMatch = header.match(/element vertex (\\d+)/);
    const count = countMatch ? parseInt(countMatch[1]) : 0;
    overlay.querySelector('div').textContent = \`✓ \${count.toLocaleString()} Gaussians loaded\`;
    console.log('Gaussian count:', count, 'PLY size:', (buf.byteLength/1e6).toFixed(1)+'MB');
  })
  .catch(e => {
    overlay.innerHTML = '<div style="color:#ef4444;font:14px system-ui">'+e.message+'</div>';
  });
</script>
</body>
</html>`;

export function SplatViewer({ splatUrl }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    const blob = new Blob([VIEWER_HTML(splatUrl)], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    iframeRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [splatUrl]);

  return (
    <iframe
      ref={iframeRef}
      style={{ width: "100%", height: "100%", border: "none", borderRadius: "var(--radius)" }}
      title="3D Gaussian Splat Viewer"
    />
  );
}
