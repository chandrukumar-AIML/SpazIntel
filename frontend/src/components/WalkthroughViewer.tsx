/**
 * WalkthroughViewer — first-person room walkthrough inside the point cloud.
 * Desktop: click to lock pointer → WASD move, mouse look, Esc to exit.
 * Mobile:  left joystick move, right joystick look.
 */
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

interface Props {
  scanId: string;
  onExit: () => void;
}

interface Cloud {
  positions: Float32Array;
  colors:    Float32Array;
  count:     number;
}

// ── GLSL ──────────────────────────────────────────────────────────────────────
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

// ── mat4 (column-major, WebGL) ─────────────────────────────────────────────
function matPerspective(fovY: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovY * 0.5), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) * nf; m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function fpvView(px: number, py: number, pz: number, yaw: number, pitch: number) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw),   sy = Math.sin(yaw);
  // forward direction in world space
  const fx = cp * sy, fy = -sp, fz = cp * cy;
  // right = (-fz, 0, fx) normalised (horizontal, no pitch)
  const rLen = Math.sqrt(fz * fz + fx * fx) || 1;
  const rx = -fz / rLen, rz = fx / rLen;
  // up = right × forward
  const ux = 0 * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - 0 * fx;
  const m = new Float32Array(16);
  m[0] = rx;  m[4] = 0;  m[8]  = rz;  m[12] = -(rx * px + rz * pz);
  m[1] = ux;  m[5] = uy; m[9]  = uz;  m[13] = -(ux * px + uy * py + uz * pz);
  m[2] = -fx; m[6] = -fy; m[10]= -fz; m[14] = fx * px + fy * py + fz * pz;
  m[3] = 0;   m[7] = 0;  m[11] = 0;  m[15] = 1;
  return m;
}

function matMul(a: Float32Array, b: Float32Array) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i + k * 4] * b[k + j * 4];
      o[i + j * 4] = s;
    }
  return o;
}

// ── PLY parser (same format as reconstruct_fast: xyz float32 + rgb uint8) ───
async function parsePLY(url: string): Promise<Cloud> {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { httpStatus: res.status });
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const dec   = new TextDecoder();
  let headerEnd = -1;
  const SEN = "end_header\n";
  for (let i = 0; i < Math.min(bytes.length - SEN.length, 8192); i++) {
    if (bytes[i] === 101 && dec.decode(bytes.slice(i, i + SEN.length)) === SEN) {
      headerEnd = i + SEN.length; break;
    }
  }
  if (headerEnd < 0) throw new Error("Bad PLY");
  const count = parseInt(dec.decode(bytes.slice(0, headerEnd)).match(/element vertex (\d+)/)![1]);
  const positions = new Float32Array(count * 3);
  const colors    = new Float32Array(count * 3);
  const dv = new DataView(buf);
  let off = headerEnd;
  for (let i = 0; i < count; i++) {
    positions[i * 3]   = dv.getFloat32(off,     true);
    positions[i * 3+1] = dv.getFloat32(off + 4, true);
    positions[i * 3+2] = dv.getFloat32(off + 8, true);
    colors[i * 3]   = dv.getUint8(off + 12) / 255;
    colors[i * 3+1] = dv.getUint8(off + 13) / 255;
    colors[i * 3+2] = dv.getUint8(off + 14) / 255;
    off += 15;
  }
  // Centre + normalise
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < count; i++) { cx += positions[i*3]; cy += positions[i*3+1]; cz += positions[i*3+2]; }
  cx /= count; cy /= count; cz /= count;
  let maxR = 0;
  for (let i = 0; i < count; i++) {
    const dx = (positions[i*3]   -= cx);
    const dy = (positions[i*3+1] -= cy);
    const dz = (positions[i*3+2] -= cz);
    const r = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (r > maxR) maxR = r;
  }
  if (maxR > 0) for (let i = 0; i < count * 3; i++) positions[i] /= maxR;
  return { positions, colors, count };
}

// ── Touch joystick state ──────────────────────────────────────────────────────
interface Stick { id: number; baseX: number; baseY: number; dx: number; dy: number }

// ── Component ─────────────────────────────────────────────────────────────────
type Status = "loading" | "ok" | "empty" | "error";

export function WalkthroughViewer({ scanId, onExit }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const glRef      = useRef<WebGL2RenderingContext | null>(null);
  const progRef    = useRef<WebGLProgram | null>(null);
  const mvpRef     = useRef<WebGLUniformLocation | null>(null);
  const psRef      = useRef<WebGLUniformLocation | null>(null);
  const countRef   = useRef(0);
  const rafRef     = useRef(0);
  const lastTRef   = useRef(0);

  // Camera (mutable, not state — high-freq updates)
  const camRef = useRef({ px: 0, py: 0, pz: 0.3, yaw: 0, pitch: 0 });
  const keysRef = useRef(new Set<string>());

  // Touch joysticks
  const stickLRef = useRef<Stick | null>(null);
  const stickRRef = useRef<Stick | null>(null);

  const [status,  setStatus]  = useState<Status>("loading");
  const [locked,  setLocked]  = useState(false);
  const [started, setStarted] = useState(false);

  // ── fetch + init GL ─────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    parsePLY(api.pointcloudUrl(scanId))
      .then(cloud => {
        if (!alive) return;
        countRef.current = cloud.count;
        initGL(cloud);
        setStatus("ok");
      })
      .catch((e: Error & { httpStatus?: number }) => {
        if (!alive) return;
        setStatus(e.httpStatus === 404 ? "empty" : "error");
      });
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
  }, [scanId]);

  // ── pointer lock listeners ───────────────────────────────────────────────────
  useEffect(() => {
    function onChange() {
      const isLocked = document.pointerLockElement === canvasRef.current;
      setLocked(isLocked);
      if (!isLocked) keysRef.current.clear();
    }
    function onMouseMove(e: MouseEvent) {
      if (document.pointerLockElement !== canvasRef.current) return;
      const cam = camRef.current;
      cam.yaw   += e.movementX * 0.0025;
      cam.pitch  = Math.max(-1.48, Math.min(1.48, cam.pitch + e.movementY * 0.0025));
    }
    function onKeyDown(e: KeyboardEvent) { keysRef.current.add(e.key.toLowerCase()); }
    function onKeyUp(e: KeyboardEvent)   { keysRef.current.delete(e.key.toLowerCase()); }
    document.addEventListener("pointerlockchange", onChange);
    document.addEventListener("mousemove",  onMouseMove);
    document.addEventListener("keydown",    onKeyDown);
    document.addEventListener("keyup",      onKeyUp);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      document.removeEventListener("mousemove",  onMouseMove);
      document.removeEventListener("keydown",    onKeyDown);
      document.removeEventListener("keyup",      onKeyUp);
    };
  }, []);

  // ── WebGL init ──────────────────────────────────────────────────────────────
  function initGL(cloud: Cloud) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2");
    if (!gl) return;
    glRef.current = gl;

    function sh(type: number, src: string) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s); return s;
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER,   VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    progRef.current = prog;
    mvpRef.current  = gl.getUniformLocation(prog, "u_mvp");
    psRef.current   = gl.getUniformLocation(prog, "u_ps");

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const pb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.positions, gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(pl);
    gl.vertexAttribPointer(pl, 3, gl.FLOAT, false, 0, 0);

    const cb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.colors, gl.STATIC_DRAW);
    const cl = gl.getAttribLocation(prog, "a_col");
    gl.enableVertexAttribArray(cl);
    gl.vertexAttribPointer(cl, 3, gl.FLOAT, false, 0, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.04, 0.04, 0.06, 1);
    drawLoop(performance.now());
  }

  // ── render loop ─────────────────────────────────────────────────────────────
  function drawLoop(now: number) {
    const gl = glRef.current, prog = progRef.current;
    if (!gl || !prog) return;

    const dt = Math.min((now - (lastTRef.current || now)) / 1000, 0.05);
    lastTRef.current = now;

    updateMovement(dt);

    const canvas = canvasRef.current!;
    const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = camRef.current;
    const proj = matPerspective(Math.PI / 2.2, W / H, 0.005, 50);
    const view = fpvView(cam.px, cam.py, cam.pz, cam.yaw, cam.pitch);
    const mvp  = matMul(proj, view);

    gl.uniformMatrix4fv(mvpRef.current, false, mvp);
    gl.uniform1f(psRef.current, 4);
    gl.drawArrays(gl.POINTS, 0, countRef.current);

    rafRef.current = requestAnimationFrame(t => drawLoop(t));
  }

  // ── movement update ──────────────────────────────────────────────────────────
  function updateMovement(dt: number) {
    const cam = camRef.current;
    const speed = 0.7 * dt;
    const keys  = keysRef.current;

    // WASD / arrow keys
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    if (keys.has("w") || keys.has("arrowup"))    { cam.px += sy * speed; cam.pz += cy * speed; }
    if (keys.has("s") || keys.has("arrowdown"))  { cam.px -= sy * speed; cam.pz -= cy * speed; }
    if (keys.has("a") || keys.has("arrowleft"))  { cam.px -= cy * speed; cam.pz += sy * speed; }
    if (keys.has("d") || keys.has("arrowright")) { cam.px += cy * speed; cam.pz -= sy * speed; }
    if (keys.has(" ") || keys.has("q"))           cam.py += speed;
    if (keys.has("shift") || keys.has("e"))       cam.py -= speed;

    // Touch joystick L → move (dy<0 = forward, dx>0 = strafe right)
    const sl = stickLRef.current;
    if (sl && (sl.dx !== 0 || sl.dy !== 0)) {
      const scale = 1.5;
      cam.px += (-sl.dy * sy + sl.dx * cy) * speed * scale;
      cam.pz += (-sl.dy * cy - sl.dx * sy) * speed * scale;
    }

    // Touch joystick R → look
    const sr = stickRRef.current;
    if (sr && (sr.dx !== 0 || sr.dy !== 0)) {
      cam.yaw   += sr.dx * dt * 2;
      cam.pitch  = Math.max(-1.48, Math.min(1.48, cam.pitch + sr.dy * dt * 2));
    }
  }

  // ── enter pointer lock ───────────────────────────────────────────────────────
  function enterWalk() {
    setStarted(true);
    canvasRef.current?.requestPointerLock();
  }

  function exitWalk() {
    document.exitPointerLock();
    onExit();
  }

  // ── touch joysticks ─────────────────────────────────────────────────────────
  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - rect.left;
      const y = t.clientY - rect.top;
      const isLeft = x < rect.width / 2;
      if (isLeft && !stickLRef.current) {
        stickLRef.current = { id: t.identifier, baseX: x, baseY: y, dx: 0, dy: 0 };
      } else if (!isLeft && !stickRRef.current) {
        stickRRef.current = { id: t.identifier, baseX: x, baseY: y, dx: 0, dy: 0 };
      }
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const x  = t.clientX - rect.left;
      const y  = t.clientY - rect.top;
      const sl = stickLRef.current;
      const sr = stickRRef.current;
      if (sl && t.identifier === sl.id) {
        const R = 50;
        const dx = (x - sl.baseX) / R, dy = (y - sl.baseY) / R;
        const len = Math.sqrt(dx * dx + dy * dy);
        const clamp = len > 1 ? 1 / len : 1;
        sl.dx = dx * clamp; sl.dy = dy * clamp;
      }
      if (sr && t.identifier === sr.id) {
        const R = 50;
        const dx = (x - sr.baseX) / R, dy = (y - sr.baseY) / R;
        const len = Math.sqrt(dx * dx + dy * dy);
        const clamp = len > 1 ? 1 / len : 1;
        sr.dx = dx * clamp; sr.dy = dy * clamp;
      }
    }
    e.preventDefault();
  }

  function onTouchEnd(e: React.TouchEvent<HTMLCanvasElement>) {
    for (const t of Array.from(e.changedTouches)) {
      if (stickLRef.current?.id === t.identifier) stickLRef.current = null;
      if (stickRRef.current?.id === t.identifier) stickRRef.current = null;
    }
  }

  const isMobile = typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>

      {/* WebGL canvas */}
      <canvas
        ref={canvasRef}
        style={{ ...s.canvas, cursor: locked ? "none" : "default" }}
        onClick={!started ? enterWalk : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {/* Loading states */}
      {status === "loading" && (
        <div style={s.overlay}>
          <div style={s.spinner} />
          <span style={s.ovTxt}>Loading room…</span>
        </div>
      )}
      {status === "empty" && (
        <div style={s.overlay}>
          <div style={{ fontSize: 48 }}>☁</div>
          <span style={s.ovTxt}>No point cloud yet</span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,.4)" }}>Process a scan first</span>
          <button style={s.exitBtn} onClick={onExit}>← Back</button>
        </div>
      )}

      {/* Splash — click to start (desktop) */}
      {status === "ok" && !started && !isMobile && (
        <div style={s.splash} onClick={enterWalk}>
          <div style={s.splashIcon}>🚶</div>
          <div style={s.splashTitle}>Walk Through Your Room</div>
          <div style={s.splashHint}>Click anywhere to start</div>
          <div style={s.splashControls}>
            <span style={s.key}>W A S D</span> move &nbsp;·&nbsp;
            <span style={s.key}>mouse</span> look &nbsp;·&nbsp;
            <span style={s.key}>Space / Shift</span> up / down &nbsp;·&nbsp;
            <span style={s.key}>Esc</span> exit
          </div>
          <button style={s.exitBtn} onClick={e => { e.stopPropagation(); onExit(); }}>← Back to orbit view</button>
        </div>
      )}

      {/* Mobile: auto-start with joystick hints */}
      {status === "ok" && !started && isMobile && (
        <div style={s.splash}>
          <div style={s.splashIcon}>🚶</div>
          <div style={s.splashTitle}>Walk Through Your Room</div>
          <div style={s.splashHint}>Left joystick: move &nbsp;·&nbsp; Right joystick: look</div>
          <button style={{ ...s.enterBtn, marginTop: 16 }} onClick={() => setStarted(true)}>Enter Room →</button>
          <button style={{ ...s.exitBtn, marginTop: 8 }} onClick={onExit}>← Back</button>
        </div>
      )}

      {/* Active HUD (pointer locked or mobile) */}
      {started && (
        <>
          {/* Crosshair */}
          <div style={s.crosshairH} />
          <div style={s.crosshairV} />

          {/* Top bar */}
          <div style={s.hud}>
            <span style={s.hudLabel}>Walking inside room</span>
            <button style={s.hudExit} onClick={exitWalk}>✕ Exit</button>
          </div>

          {/* Desktop: show hint if pointer not locked yet */}
          {!locked && !isMobile && (
            <div style={s.clickHint} onClick={enterWalk}>
              Click to capture mouse &amp; look around
            </div>
          )}

          {/* Mobile joystick zones (visual only — touch handled by canvas) */}
          {isMobile && (
            <>
              <div style={{ ...s.joystickZone, left: 24, bottom: 80 }}>
                <div style={s.joystickRing}>
                  <div style={s.joystickDot} />
                </div>
                <div style={s.joystickLabel}>MOVE</div>
              </div>
              <div style={{ ...s.joystickZone, right: 24, bottom: 80 }}>
                <div style={s.joystickRing}>
                  <div style={s.joystickDot} />
                </div>
                <div style={s.joystickLabel}>LOOK</div>
              </div>
            </>
          )}

          {/* Desktop WASD reminder (fades after 4s) */}
          {!isMobile && locked && (
            <div style={s.wasdHint}>
              W A S D · Space · Shift · Esc
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root:       { position: "fixed", inset: 0, background: "#040406", zIndex: 100 },
  canvas:     { width: "100%", height: "100%", display: "block", touchAction: "none" },

  overlay:    { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(4,4,6,.85)", backdropFilter: "blur(6px)" },
  spinner:    { width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(99,102,241,.2)", borderTopColor: "#6366f1", animation: "spin .8s linear infinite" },
  ovTxt:      { fontSize: 15, color: "rgba(255,255,255,.8)", fontWeight: 600 },

  splash:     { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(4,4,6,.8)", backdropFilter: "blur(8px)", cursor: "pointer" },
  splashIcon: { fontSize: 56, marginBottom: 4 },
  splashTitle:{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-.02em" },
  splashHint: { fontSize: 13, color: "rgba(255,255,255,.5)" },
  splashControls: { fontSize: 12, color: "rgba(255,255,255,.4)", marginTop: 8, display: "flex", alignItems: "center", flexWrap: "wrap" as const, justifyContent: "center", gap: 4 },
  key:        { background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontFamily: "monospace" },

  enterBtn:   { background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "10px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  exitBtn:    { background: "transparent", border: "1px solid rgba(255,255,255,.2)", color: "rgba(255,255,255,.5)", borderRadius: 8, padding: "7px 18px", fontSize: 12, cursor: "pointer" },

  hud:        { position: "absolute", top: 0, left: 0, right: 0, height: 44, display: "flex", alignItems: "center", padding: "0 16px", background: "linear-gradient(rgba(4,4,6,.8), transparent)", backdropFilter: "blur(4px)" },
  hudLabel:   { fontSize: 12, color: "rgba(255,255,255,.5)", fontWeight: 500, flex: 1 },
  hudExit:    { background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)", color: "rgba(255,255,255,.7)", borderRadius: 6, padding: "4px 14px", fontSize: 12, cursor: "pointer" },

  crosshairH: { position: "absolute", top: "50%", left: "50%", width: 18, height: 2, background: "rgba(255,255,255,.6)", transform: "translate(-50%, -50%)", pointerEvents: "none" },
  crosshairV: { position: "absolute", top: "50%", left: "50%", width: 2, height: 18, background: "rgba(255,255,255,.6)", transform: "translate(-50%, -50%)", pointerEvents: "none" },

  clickHint:  { position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)", background: "rgba(99,102,241,.2)", border: "1px solid rgba(99,102,241,.4)", color: "#a5b4fc", borderRadius: 20, padding: "8px 20px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" as const },
  wasdHint:   { position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", fontSize: 11, color: "rgba(255,255,255,.25)", fontFamily: "monospace", whiteSpace: "nowrap" as const, pointerEvents: "none" },

  joystickZone:  { position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none" },
  joystickRing:  { width: 72, height: 72, borderRadius: "50%", border: "2px solid rgba(255,255,255,.2)", background: "rgba(255,255,255,.05)", display: "flex", alignItems: "center", justifyContent: "center" },
  joystickDot:   { width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,.3)" },
  joystickLabel: { fontSize: 9, color: "rgba(255,255,255,.35)", fontWeight: 700, letterSpacing: ".1em" },
};
