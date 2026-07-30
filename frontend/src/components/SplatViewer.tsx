/**
 * 3D Gaussian Splat viewer — inline WebGL2 renderer in sandboxed iframe.
 * Parent pre-fetches the .splat binary (avoids sandbox CORS restriction),
 * creates a same-origin blob URL, passes it into the iframe HTML.
 */
import React, { useEffect, useRef, useState } from "react";

interface Props { splatUrl: string }

function buildHtml(dataBlobUrl: string): string { return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050508;overflow:hidden;width:100vw;height:100vh}
canvas{display:block;width:100%;height:100%}
#hud{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);
  font:11px/1 -apple-system,sans-serif;color:#94a3b8;background:rgba(0,0,0,.6);
  padding:5px 12px;border-radius:20px;white-space:nowrap;pointer-events:none;opacity:0;
  transition:opacity .3s}
#overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;color:#94a3b8;font:13px/1 sans-serif}
#spin{width:24px;height:24px;border-radius:50%;border:2px solid rgba(99,102,241,.25);
  border-top-color:#6366f1;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
</style></head><body>
<canvas id="c"></canvas>
<div id="hud"></div>
<div id="overlay"><div id="spin"></div><span id="status">Loading…</span></div>
<script>
const SPLAT_URL="${dataBlobUrl}";
const canvas=document.getElementById('c');
const hud=document.getElementById('hud');
const overlay=document.getElementById('overlay');
const statusEl=document.getElementById('status');
function setStatus(s){statusEl.textContent=s;}
function hideOverlay(){overlay.style.display='none';hud.style.opacity='1';}

// WebGL2
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false});
if(!gl){setStatus('WebGL2 not available');throw new Error('no webgl2');}

function resize(){
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  gl.viewport(0,0,canvas.width,canvas.height);
}
resize();
window.addEventListener('resize',resize);

// ── GLSL 300 es shaders ───────────────────────────────────────────────────────
const VS=\`#version 300 es
precision mediump float;
in vec2 a_pos;
in vec4 a_color;
in vec2 a_center;
in vec2 a_covA;
in vec2 a_covB;
uniform vec2 u_vp;
out vec4 v_color;
out vec2 v_pos;
void main(){
  vec2 d=(a_pos*2.0-1.0)*3.0;
  vec2 p=a_center+mat2(a_covA.x,a_covA.y,a_covB.x,a_covB.y)*d;
  v_color=a_color;
  v_pos=d;
  vec2 clip=p/u_vp*2.0-1.0;
  gl_Position=vec4(clip.x,-clip.y,0.0,1.0);
}
\`;
const FS=\`#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_pos;
out vec4 fragColor;
void main(){
  float r=dot(v_pos,v_pos);
  if(r>9.0)discard;
  float a=v_color.a*exp(-0.5*r);
  if(a<0.003)discard;
  fragColor=vec4(v_color.rgb*a,a);
}
\`;

function compileShader(type,src){
  const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
    setStatus('Shader error: '+gl.getShaderInfoLog(s));throw new Error('shader');}
  return s;
}
const prog=gl.createProgram();
gl.attachShader(prog,compileShader(gl.VERTEX_SHADER,VS));
gl.attachShader(prog,compileShader(gl.FRAGMENT_SHADER,FS));
gl.linkProgram(prog);
if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){
  setStatus('Link error: '+gl.getProgramInfoLog(prog));throw new Error('link');}
gl.useProgram(prog);

const aPos=gl.getAttribLocation(prog,'a_pos');
const aColor=gl.getAttribLocation(prog,'a_color');
const aCenter=gl.getAttribLocation(prog,'a_center');
const aCovA=gl.getAttribLocation(prog,'a_covA');
const aCovB=gl.getAttribLocation(prog,'a_covB');
const uVP=gl.getUniformLocation(prog,'u_vp');

// ── Geometry: instanced quad ──────────────────────────────────────────────────
const vao=gl.createVertexArray();
gl.bindVertexArray(vao);

const quadBuf=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,quadBuf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
gl.vertexAttribDivisor(aPos,0); // per-vertex

// instance buffers (sized after load)
const cBuf=gl.createBuffer(),clBuf=gl.createBuffer(),caBuf=gl.createBuffer(),cbBuf=gl.createBuffer();

function bindInstance(buf,loc,size){
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);
  gl.vertexAttribDivisor(loc,1);
}
bindInstance(cBuf,aCenter,2);
bindInstance(clBuf,aColor,4);
bindInstance(caBuf,aCovA,2);
bindInstance(cbBuf,aCovB,2);

gl.bindVertexArray(null);

// ── Scene data (hoisted — updateCam references needSort) ──────────────────────
let splats=null,N=0,needSort=true;
let centerArr=null,colorArr=null,covAArr=null,covBArr=null;

// ── Camera ────────────────────────────────────────────────────────────────────
let az=0,el=0.2,radius=15,target=[0,0,0];
let camPos=[0,0,0];
function updateCam(){
  const ex=Math.cos(el)*Math.sin(az),ey=Math.sin(el),ez=Math.cos(el)*Math.cos(az);
  camPos=[target[0]+radius*ex,target[1]+radius*ey,target[2]+radius*ez];
  needSort=true;
}
updateCam();

let dragging=false,rDrag=false,lx=0,ly=0;
canvas.addEventListener('mousedown',e=>{dragging=true;rDrag=e.button===2;lx=e.clientX;ly=e.clientY;});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mouseup',()=>{dragging=false;});
window.addEventListener('mousemove',e=>{
  if(!dragging||!splats)return;
  const dx=(e.clientX-lx)/canvas.width,dy=(e.clientY-ly)/canvas.height;
  if(!rDrag){az-=dx*4;el=Math.max(-1.5,Math.min(1.5,el+dy*2));}
  else{target[0]-=dx*radius;target[1]+=dy*radius;}
  lx=e.clientX;ly=e.clientY;updateCam();
});
canvas.addEventListener('wheel',e=>{
  radius=Math.max(0.5,Math.min(200,radius*Math.exp(e.deltaY*0.001)));updateCam();
});
// Touch
let pt=null,pinch0=0;
canvas.addEventListener('touchstart',e=>{e.preventDefault();
  if(e.touches.length===1){dragging=true;lx=e.touches[0].clientX;ly=e.touches[0].clientY;}
  if(e.touches.length===2){pt=e.touches;pinch0=Math.hypot(pt[1].clientX-pt[0].clientX,pt[1].clientY-pt[0].clientY);}
},{passive:false});
canvas.addEventListener('touchend',e=>{e.preventDefault();dragging=false;pt=null;},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();
  if(e.touches.length===1&&dragging&&splats){
    const dx=(e.touches[0].clientX-lx)/canvas.width,dy=(e.touches[0].clientY-ly)/canvas.height;
    az-=dx*4;el=Math.max(-1.5,Math.min(1.5,el+dy*2));lx=e.touches[0].clientX;ly=e.touches[0].clientY;updateCam();
  }
  if(e.touches.length===2&&pt){
    const d=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
    radius=Math.max(0.5,Math.min(200,radius*(pinch0/d)));pinch0=d;updateCam();
  }
},{passive:false});

function norm3(v){const l=Math.sqrt(v[0]**2+v[1]**2+v[2]**2)+1e-8;return[v[0]/l,v[1]/l,v[2]/l];}
function cross3(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}

function project(){
  if(!splats)return;
  const W=canvas.width,H=canvas.height;
  const fx=W*0.85,fy=H*0.85;
  const up=[0,1,0];
  const fw=norm3([target[0]-camPos[0],target[1]-camPos[1],target[2]-camPos[2]]);
  const ri=norm3(cross3(fw,up));
  const uu=cross3(ri,fw);
  const tx=dot3(ri,camPos),ty=dot3(uu,camPos),tz=dot3(fw,camPos);

  const cx=new Float32Array(N*2),cl=new Float32Array(N*4);
  const ca=new Float32Array(N*2),cb=new Float32Array(N*2);

  for(let i=0;i<N;i++){
    const b=i*10;
    const px=splats[b],py=splats[b+1],pz=splats[b+2];
    const sx=splats[b+3],sy=splats[b+4],sz=splats[b+5];
    const r=splats[b+6],g=splats[b+7],bl=splats[b+8],a=splats[b+9];

    // View-space
    const vx=ri[0]*px+ri[1]*py+ri[2]*pz-tx;
    const vy=uu[0]*px+uu[1]*py+uu[2]*pz-ty;
    const vz=fw[0]*px+fw[1]*py+fw[2]*pz-tz;

    if(vz<0.1){cx[i*2]=cx[i*2+1]=-99999;continue;}

    // Screen center (pixel space)
    cx[i*2  ]=(vx/vz)*fx+W*0.5;
    cx[i*2+1]=(vy/vz)*fy+H*0.5;

    // 2D covariance (simplified: axes-aligned from scale)
    const s2d_x=Math.min(sx*fx/(vz),300);
    const s2d_y=Math.min(sy*fy/(vz),300);
    ca[i*2]=s2d_x;ca[i*2+1]=0;
    cb[i*2]=0;cb[i*2+1]=s2d_y;

    cl[i*4]=r;cl[i*4+1]=g;cl[i*4+2]=bl;cl[i*4+3]=a;
  }

  // Depth sort (front-to-back for correct blending)
  const depths=new Float32Array(N);
  for(let i=0;i<N;i++){
    const b=i*10;
    depths[i]=fw[0]*splats[b]+fw[1]*splats[b+1]+fw[2]*splats[b+2];
  }
  const order=Array.from({length:N},(_,i)=>i).sort((a,b2)=>depths[a]-depths[b2]);

  const sx2=new Float32Array(N*2),sl=new Float32Array(N*4);
  const sa=new Float32Array(N*2),sb=new Float32Array(N*2);
  for(let j=0;j<N;j++){
    const i=order[j],d=j*2,d4=j*4,s=i*2,s4=i*4;
    sx2[d]=cx[s];sx2[d+1]=cx[s+1];
    sl[d4]=cl[s4];sl[d4+1]=cl[s4+1];sl[d4+2]=cl[s4+2];sl[d4+3]=cl[s4+3];
    sa[d]=ca[s];sa[d+1]=ca[s+1];
    sb[d]=cb[s];sb[d+1]=cb[s+1];
  }
  centerArr=sx2;colorArr=sl;covAArr=sa;covBArr=sb;

  gl.bindBuffer(gl.ARRAY_BUFFER,cBuf);gl.bufferData(gl.ARRAY_BUFFER,centerArr,gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,clBuf);gl.bufferData(gl.ARRAY_BUFFER,colorArr,gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,caBuf);gl.bufferData(gl.ARRAY_BUFFER,covAArr,gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,cbBuf);gl.bufferData(gl.ARRAY_BUFFER,covBArr,gl.DYNAMIC_DRAW);
}

// ── Load ──────────────────────────────────────────────────────────────────────
setStatus('Parsing 3D scene…');
fetch(SPLAT_URL)
  .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})
  .then(buf=>{
    N=buf.byteLength/32;
    const dv=new DataView(buf);
    splats=new Float32Array(N*10);
    for(let i=0;i<N;i++){
      const o=i*32,d=i*10;
      splats[d  ]=dv.getFloat32(o,   true);
      splats[d+1]=dv.getFloat32(o+4, true);
      splats[d+2]=dv.getFloat32(o+8, true);
      splats[d+3]=dv.getFloat32(o+12,true);
      splats[d+4]=dv.getFloat32(o+16,true);
      splats[d+5]=dv.getFloat32(o+20,true);
      splats[d+6]=dv.getUint8(o+24)/255;
      splats[d+7]=dv.getUint8(o+25)/255;
      splats[d+8]=dv.getUint8(o+26)/255;
      splats[d+9]=dv.getUint8(o+27)/255;
    }
    // Auto-center on scene
    let mx=0,my=0,mz=0;
    for(let i=0;i<N;i++){mx+=splats[i*10];my+=splats[i*10+1];mz+=splats[i*10+2];}
    target=[mx/N,my/N,mz/N];
    // Set radius based on scene scale
    let maxD=0;
    for(let i=0;i<N;i++){
      const dx=splats[i*10]-target[0],dy=splats[i*10+1]-target[1],dz=splats[i*10+2]-target[2];
      maxD=Math.max(maxD,Math.sqrt(dx*dx+dy*dy+dz*dz));
    }
    radius=maxD*1.5;
    updateCam();
    project();
    needSort=false;
    hideOverlay();
    hud.textContent=N.toLocaleString()+' Gaussians · Drag to rotate · Scroll to zoom';
  })
  .catch(e=>{setStatus('Error: '+e.message);document.getElementById('spin').style.display='none';});

// ── Render ────────────────────────────────────────────────────────────────────
let lastSort=0;
function render(t){
  requestAnimationFrame(render);
  if(!splats||!centerArr)return;
  if(needSort||(t-lastSort>1000)){project();needSort=false;lastSort=t;}

  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0.02,0.02,0.03,1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(prog);
  gl.uniform2f(uVP,canvas.width,canvas.height);
  gl.bindVertexArray(vao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,N);
  gl.bindVertexArray(null);
}
requestAnimationFrame(render);
</script></body></html>`;
}

export function SplatViewer({ splatUrl }: Props) {
  const htmlBlobRef = useRef("");
  const dataBlobRef = useRef("");
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error,     setError]     = useState("");

  useEffect(() => {
    let cancelled = false;
    setIframeSrc(null);
    setError("");

    fetch(splatUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(buf => {
        if (cancelled) return;
        // Binary blob as same-origin URL — iframe can fetch it without CORS restrictions
        const dataUrl = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
        dataBlobRef.current = dataUrl;
        const htmlUrl = URL.createObjectURL(new Blob([buildHtml(dataUrl)], { type: "text/html" }));
        htmlBlobRef.current = htmlUrl;
        setIframeSrc(htmlUrl);
      })
      .catch(e => { if (!cancelled) setError(e.message); });

    return () => {
      cancelled = true;
      if (htmlBlobRef.current) URL.revokeObjectURL(htmlBlobRef.current);
      if (dataBlobRef.current) URL.revokeObjectURL(dataBlobRef.current);
      htmlBlobRef.current = "";
      dataBlobRef.current = "";
    };
  }, [splatUrl]);

  const overlayStyle: React.CSSProperties = {
    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 10,
    color: "#94a3b8", fontSize: 13, pointerEvents: "none",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {error ? (
        <div style={{ ...overlayStyle, color: "#f87171", textAlign: "center", padding: 20 }}>
          Failed to load 3D scene: {error}
        </div>
      ) : !iframeSrc ? (
        <div style={overlayStyle}>
          <div style={{ width: 24, height: 24, borderRadius: "50%",
            border: "2px solid rgba(99,102,241,.25)", borderTopColor: "#6366f1",
            animation: "spin .8s linear infinite" }} />
          Fetching 3D scene…
        </div>
      ) : (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          title="3D Gaussian Splat Viewer"
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </div>
  );
}
