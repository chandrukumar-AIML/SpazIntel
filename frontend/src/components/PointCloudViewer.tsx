import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { WalkthroughViewer } from "./WalkthroughViewer";

interface Props {
  scanId: string;
  label?: string;
}

interface CloudData {
  positions: Float32Array;
  colors:    Float32Array;
  count:     number;
}

// ── GLSL shaders ─────────────────────────────────────────────────────────────

const VERT = `#version 300 es
in vec3 a_pos;
in vec3 a_col;
uniform mat4 u_mvp;
uniform float u_ps;
out vec3 v_col;
void main() {
  gl_Position  = u_mvp * vec4(a_pos, 1.0);
  gl_PointSize = u_ps / gl_Position.w;
  v_col        = a_col;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 v_col;
out vec4 fragColor;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  if (dot(pc, pc) > 0.25) discard;
  fragColor = vec4(v_col, 1.0);
}`;

// ── mat4 helpers (column-major, WebGL convention) ─────────────────────────────

function matPerspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f  = 1 / Math.tan(fovY * 0.5);
  const nf = 1 / (near - far);
  const m  = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function matLookAt(ex: number, ey: number, ez: number): Float32Array {
  // Looking at origin
  const len = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
  const zx = ex / len, zy = ey / len, zz = ez / len;   // backward (eye → origin, negated)

  // right = (0,1,0) × backward (world-up cross backward)
  let rx = -zz, ry = 0, rz = zx;
  const rl = Math.sqrt(rx * rx + rz * rz) || 1;
  rx /= rl; rz /= rl;

  // up = backward × right
  const ux = zy * rz - zz * ry;
  const uy = zz * rx - zx * rz;
  const uz = zx * ry - zy * rx;

  const m = new Float32Array(16);
  m[0]  = rx;  m[4]  = ry;  m[8]  = rz;  m[12] = -(rx * ex + ry * ey + rz * ez);
  m[1]  = ux;  m[5]  = uy;  m[9]  = uz;  m[13] = -(ux * ex + uy * ey + uz * ez);
  m[2]  = zx;  m[6]  = zy;  m[10] = zz;  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[3]  = 0;   m[7]  = 0;   m[11] = 0;   m[15] = 1;
  return m;
}

function matMul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
      o[i + j * 4] = s;
    }
  return o;
}

// ── PLY parser (binary little-endian, x y z r g b) ───────────────────────────

async function parsePLY(url: string): Promise<CloudData> {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { httpStatus: res.status });

  const buf   = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const dec   = new TextDecoder();

  // Locate "end_header\n" — scan first 8 KB
  const sentinel = "end_header\n";
  let headerEnd   = -1;
  for (let i = 0; i < Math.min(bytes.length - sentinel.length, 8192); i++) {
    if (bytes[i] === 101 && dec.decode(bytes.slice(i, i + sentinel.length)) === sentinel) {
      headerEnd = i + sentinel.length;
      break;
    }
  }
  if (headerEnd < 0) throw new Error("PLY header not found");

  const header = dec.decode(bytes.slice(0, headerEnd));
  const match  = header.match(/element vertex (\d+)/);
  if (!match) throw new Error("No vertex count in PLY");
  const count = parseInt(match[1]);

  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  const view      = new DataView(buf);
  let off         = headerEnd;

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = view.getFloat32(off,      true); // x
    positions[i * 3 + 1] = view.getFloat32(off + 4,  true); // y
    positions[i * 3 + 2] = view.getFloat32(off + 8,  true); // z
    colors[i * 3]        = view.getUint8(off + 12) / 255;   // r
    colors[i * 3 + 1]    = view.getUint8(off + 13) / 255;   // g
    colors[i * 3 + 2]    = view.getUint8(off + 14) / 255;   // b
    off += 15;
  }

  // Center + normalize to [-1, 1]³
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) {
    cx += positions[i * 3]; cy += positions[i * 3 + 1]; cz += positions[i * 3 + 2];
  }
  cx /= count; cy /= count; cz /= count;
  let maxR = 0;
  for (let i = 0; i < count; i++) {
    const dx = (positions[i * 3]     -= cx);
    const dy = (positions[i * 3 + 1] -= cy);
    const dz = (positions[i * 3 + 2] -= cz);
    const r  = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > maxR) maxR = r;
  }
  if (maxR > 0)
    for (let i = 0; i < count * 3; i++) positions[i] /= maxR;

  return { positions, colors, count };
}

// ── Component ─────────────────────────────────────────────────────────────────

type Status = "loading" | "ok" | "empty" | "error";

export function PointCloudViewer({ scanId, label }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const glRef      = useRef<WebGL2RenderingContext | null>(null);
  const progRef    = useRef<WebGLProgram | null>(null);
  const mvpRef     = useRef<WebGLUniformLocation | null>(null);
  const psRef      = useRef<WebGLUniformLocation | null>(null);
  const countRef   = useRef(0);
  const rafRef     = useRef(0);
  const orbitRef   = useRef({ az: 0.4, el: 0.25, r: 2.5, drag: false, lx: 0, ly: 0 });

  const [status,         setStatus]         = useState<Status>("loading");
  const [pointCount,     setPointCount]     = useState(0);
  const [errMsg,         setErrMsg]         = useState("");
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  // ── fetch + init ────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setErrMsg("");

    parsePLY(api.pointcloudUrl(scanId))
      .then(cloud => {
        if (!alive) return;
        setPointCount(cloud.count);
        countRef.current = cloud.count;
        setStatus("ok");
        initGL(cloud);
      })
      .catch((e: Error & { httpStatus?: number }) => {
        if (!alive) return;
        if (e.httpStatus === 404) setStatus("empty");
        else { setErrMsg(e.message); setStatus("error"); }
      });

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [scanId]);

  // ── WebGL init ──────────────────────────────────────────────────────────────
  function initGL(cloud: CloudData) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2");
    if (!gl) return;
    glRef.current = gl;

    function compile(type: number, src: string) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error("shader:", gl.getShaderInfoLog(s));
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER,   VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    progRef.current = prog;

    mvpRef.current = gl.getUniformLocation(prog, "u_mvp");
    psRef.current  = gl.getUniformLocation(prog, "u_ps");

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    const colBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.colors, gl.STATIC_DRAW);
    const colLoc = gl.getAttribLocation(prog, "a_col");
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, 0, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.05, 0.05, 0.08, 1);

    drawLoop();
  }

  // ── render loop ─────────────────────────────────────────────────────────────
  function drawLoop() {
    const gl   = glRef.current;
    const prog = progRef.current;
    if (!gl || !prog) return;

    const o = orbitRef.current;
    if (!o.drag) o.az += 0.004; // auto-spin

    const canvas = canvasRef.current!;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const { az, el, r } = o;
    const ex = Math.sin(az) * Math.cos(el) * r;
    const ey = Math.sin(el) * r;
    const ez = Math.cos(az) * Math.cos(el) * r;

    const mvp = matMul(
      matPerspective(Math.PI / 3, W / H, 0.01, 100),
      matLookAt(ex, ey, ez),
    );

    gl.uniformMatrix4fv(mvpRef.current, false, mvp);
    gl.uniform1f(psRef.current, Math.max(2, 3.5 / r));
    gl.drawArrays(gl.POINTS, 0, countRef.current);

    rafRef.current = requestAnimationFrame(drawLoop);
  }

  // ── mouse / touch orbit ─────────────────────────────────────────────────────
  function onDown(e: React.MouseEvent | React.TouchEvent) {
    const o = orbitRef.current;
    o.drag = true;
    const pt = "touches" in e ? e.touches[0] : e;
    o.lx = pt.clientX; o.ly = pt.clientY;
  }
  function onMove(e: React.MouseEvent | React.TouchEvent) {
    const o = orbitRef.current;
    if (!o.drag) return;
    const pt = "touches" in e ? e.touches[0] : e;
    o.az    += (pt.clientX - o.lx) * 0.006;
    o.el     = Math.max(-1.4, Math.min(1.4, o.el - (pt.clientY - o.ly) * 0.006));
    o.lx = pt.clientX; o.ly = pt.clientY;
  }
  function onUp()    { orbitRef.current.drag = false; }
  function onWheel(e: React.WheelEvent) {
    orbitRef.current.r = Math.max(0.5, Math.min(8, orbitRef.current.r + e.deltaY * 0.004));
  }

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      {/* Header badge */}
      <div style={s.badge}>
        <span style={s.badgeDot} />
        {label ?? "Fast 3D Preview"}
        {status === "ok" && (
          <span style={s.pts}>{pointCount.toLocaleString()} pts</span>
        )}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={s.canvas}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
        onWheel={onWheel}
      />

      {/* Overlays */}
      {status === "loading" && (
        <div style={s.overlay}>
          <div style={s.spinner} />
          <span style={s.ovText}>Loading point cloud…</span>
        </div>
      )}
      {status === "empty" && (
        <div style={s.overlay}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>☁</div>
          <span style={s.ovText}>No point cloud yet</span>
          <span style={s.ovHint}>Will appear during scan processing</span>
        </div>
      )}
      {status === "error" && (
        <div style={s.overlay}>
          <span style={{ color: "#f87171", fontSize: 13 }}>Load error: {errMsg}</span>
        </div>
      )}

      {/* Controls hint */}
      {status === "ok" && (
        <div style={s.hint}>drag to orbit · scroll to zoom</div>
      )}

      {/* Enter Room button */}
      {status === "ok" && (
        <button style={s.walkBtn} onClick={() => setShowWalkthrough(true)}>
          🚶 Enter Room
        </button>
      )}

      {/* Walkthrough full-screen overlay */}
      {showWalkthrough && (
        <WalkthroughViewer scanId={scanId} onExit={() => setShowWalkthrough(false)} />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:    { position: "relative", width: "100%", height: "100%", background: "#060608", borderRadius: "inherit", overflow: "hidden", display: "flex", flexDirection: "column" },
  badge:   { position: "absolute", top: 10, left: 10, zIndex: 10, display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 600, color: "#a5b4fc", background: "rgba(8,8,12,.75)", backdropFilter: "blur(6px)", border: "1px solid rgba(99,102,241,.3)", borderRadius: 20, padding: "4px 12px", letterSpacing: ".02em" },
  badgeDot:{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", flexShrink: 0 },
  pts:     { color: "rgba(165,180,252,.6)", fontSize: 10, marginLeft: 4 },
  canvas:  { width: "100%", height: "100%", cursor: "grab", display: "block" },
  overlay: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(6,6,8,.7)", backdropFilter: "blur(4px)" },
  spinner: { width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(99,102,241,.2)", borderTopColor: "#6366f1", animation: "spin .8s linear infinite" },
  ovText:  { fontSize: 14, color: "rgba(255,255,255,.8)", fontWeight: 500 },
  ovHint:  { fontSize: 12, color: "rgba(255,255,255,.4)" },
  hint:    { position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "rgba(255,255,255,.3)", whiteSpace: "nowrap", pointerEvents: "none" },
  walkBtn: { position: "absolute", bottom: 36, right: 12, background: "rgba(99,102,241,.85)", backdropFilter: "blur(6px)", border: "1px solid rgba(99,102,241,.6)", color: "#fff", borderRadius: 20, padding: "6px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", letterSpacing: ".02em", zIndex: 10 },
};
