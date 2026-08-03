/**
 * 3D Gaussian Splat viewer — inline WebGL2 renderer in sandboxed iframe.
 * Sprint 7 adds: click-to-measure mode with 3D point picking.
 */
import React, { useEffect, useRef, useState } from "react";

interface Props { splatUrl: string }

function buildHtml(dataBlobUrl: string): string { return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050508;overflow:hidden;width:100vw;height:100vh}
canvas{display:block;position:absolute;inset:0;width:100%;height:100%}
#ov{pointer-events:none;z-index:2}
#c{z-index:1}
#hud{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:3;
  font:11px/1 -apple-system,sans-serif;color:#94a3b8;background:rgba(0,0,0,.6);
  padding:5px 12px;border-radius:20px;white-space:nowrap;pointer-events:none;opacity:0;
  transition:opacity .3s}
#overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:10px;color:#94a3b8;font:13px/1 sans-serif;z-index:4}
#spin{width:24px;height:24px;border-radius:50%;border:2px solid rgba(99,102,241,.25);
  border-top-color:#6366f1;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
</style></head><body>
<canvas id="c"></canvas>
<canvas id="ov"></canvas>
<div id="hud"></div>
<div id="overlay"><div id="spin"></div><span id="status">Loading…</span></div>
<script>
const SPLAT_URL="${dataBlobUrl}";
const canvas=document.getElementById('c');
const ov=document.getElementById('ov');
const hud=document.getElementById('hud');
const overlay=document.getElementById('overlay');
const statusEl=document.getElementById('status');
const octx=ov.getContext('2d');
function setStatus(s){statusEl.textContent=s;}
function hideOverlay(){overlay.style.display='none';hud.style.opacity='1';}

// WebGL2
const gl=canvas.getContext('webgl2',{antialias:false,alpha:false});
if(!gl){setStatus('WebGL2 not available');throw new Error('no webgl2');}

function resize(){
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  ov.width=window.innerWidth;ov.height=window.innerHeight;
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
gl.vertexAttribDivisor(aPos,0);

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

// ── Scene data ────────────────────────────────────────────────────────────────
let splats=null,N=0,needSort=true;
let centerArr=null,colorArr=null,covAArr=null,covBArr=null;
let sortOrder=null; // maps sorted index j → original index i

// ── Camera ────────────────────────────────────────────────────────────────────
let az=0,el=0.2,radius=15,target=[0,0,0];
let camPos=[0,0,0];
// Current camera basis (updated in updateCam, used by projectPoint)
let camFw=[0,0,1],camRi=[1,0,0],camUu=[0,1,0],camTx=0,camTy=0,camTz=0;

function norm3(v){const l=Math.sqrt(v[0]**2+v[1]**2+v[2]**2)+1e-8;return[v[0]/l,v[1]/l,v[2]/l];}
function cross3(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}

function updateCam(){
  const ex=Math.cos(el)*Math.sin(az),ey=Math.sin(el),ez=Math.cos(el)*Math.cos(az);
  camPos=[target[0]+radius*ex,target[1]+radius*ey,target[2]+radius*ez];
  const up=[0,1,0];
  camFw=norm3([target[0]-camPos[0],target[1]-camPos[1],target[2]-camPos[2]]);
  camRi=norm3(cross3(camFw,up));
  camUu=cross3(camRi,camFw);
  camTx=dot3(camRi,camPos);camTy=dot3(camUu,camPos);camTz=dot3(camFw,camPos);
  needSort=true;
}
updateCam();

// Project a world point to screen coords (returns null if behind camera)
function projectPoint(wx,wy,wz){
  const W=canvas.width,H=canvas.height;
  const fx=W*0.85,fy=H*0.85;
  const vx=camRi[0]*wx+camRi[1]*wy+camRi[2]*wz-camTx;
  const vy=camUu[0]*wx+camUu[1]*wy+camUu[2]*wz-camTy;
  const vz=camFw[0]*wx+camFw[1]*wy+camFw[2]*wz-camTz;
  if(vz<0.1)return null;
  return[(vx/vz)*fx+W*0.5,(vy/vz)*fy+H*0.5];
}

// ── Measure mode ──────────────────────────────────────────────────────────────
let measureMode=false;
let pointA=null,pointB=null,measureDist=0;

function resetMeasure(){pointA=null;pointB=null;measureDist=0;}

function findNearestSplat(mx,my){
  if(!centerArr||!sortOrder)return null;
  let bestDist=Infinity,bestJ=-1;
  for(let j=0;j<N;j++){
    const cx=centerArr[j*2],cy=centerArr[j*2+1];
    if(cx<-9000)continue;
    const d=(cx-mx)**2+(cy-my)**2;
    if(d<bestDist){bestDist=d;bestJ=j;}
  }
  if(bestJ<0||bestDist>80*80)return null;
  const i=sortOrder[bestJ];
  return[splats[i*10],splats[i*10+1],splats[i*10+2]];
}

function drawOverlay(){
  const W=ov.width,H=ov.height;
  octx.clearRect(0,0,W,H);

  const sa=pointA?projectPoint(...pointA):null;
  const sb=pointB?projectPoint(...pointB):null;

  if(sa){
    octx.fillStyle='#f59e0b';
    octx.beginPath();octx.arc(sa[0],sa[1],7,0,Math.PI*2);octx.fill();
    octx.strokeStyle='white';octx.lineWidth=1.5;
    octx.beginPath();octx.arc(sa[0],sa[1],7,0,Math.PI*2);octx.stroke();
    octx.fillStyle='white';octx.font='bold 11px sans-serif';
    octx.fillText('A',sa[0]+10,sa[1]-5);
  }

  if(sa&&sb){
    octx.strokeStyle='#f59e0b';octx.lineWidth=2;
    octx.setLineDash([6,4]);
    octx.beginPath();octx.moveTo(sa[0],sa[1]);octx.lineTo(sb[0],sb[1]);octx.stroke();
    octx.setLineDash([]);

    octx.fillStyle='#f59e0b';
    octx.beginPath();octx.arc(sb[0],sb[1],7,0,Math.PI*2);octx.fill();
    octx.strokeStyle='white';octx.lineWidth=1.5;
    octx.beginPath();octx.arc(sb[0],sb[1],7,0,Math.PI*2);octx.stroke();
    octx.fillStyle='white';octx.font='bold 11px sans-serif';
    octx.fillText('B',sb[0]+10,sb[1]-5);

    const mx2=(sa[0]+sb[0])/2,my2=(sa[1]+sb[1])/2;
    const label=measureDist.toFixed(2)+'m';
    const tw=octx.measureText(label).width;
    octx.fillStyle='rgba(0,0,0,0.75)';
    octx.beginPath();
    const pad=6;
    octx.roundRect(mx2-tw/2-pad,my2-14,tw+pad*2,22,4);
    octx.fill();
    octx.fillStyle='#f59e0b';
    octx.font='bold 12px -apple-system,sans-serif';
    octx.textAlign='center';
    octx.fillText(label,mx2,my2+1);
    octx.textAlign='left';
  }

  if(measureMode){
    const hint=!pointA?'Click to set point A':'Click to set point B — click again to reset';
    const tw=octx.measureText(hint).width;
    octx.fillStyle='rgba(0,0,0,0.65)';
    octx.beginPath();
    octx.roundRect(12,H-38,tw+20,26,6);
    octx.fill();
    octx.fillStyle='#f59e0b';
    octx.font='11px -apple-system,sans-serif';
    octx.fillText(hint,22,H-21);
  }
}

// ── Mouse controls ────────────────────────────────────────────────────────────
let dragging=false,rDrag=false,lx=0,ly=0,moved=false;
canvas.addEventListener('mousedown',e=>{dragging=true;rDrag=e.button===2;lx=e.clientX;ly=e.clientY;moved=false;});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('mouseup',()=>{dragging=false;});
window.addEventListener('mousemove',e=>{
  if(!dragging||!splats)return;
  moved=true;
  const dx=(e.clientX-lx)/canvas.width,dy=(e.clientY-ly)/canvas.height;
  if(!rDrag){az-=dx*4;el=Math.max(-1.5,Math.min(1.5,el+dy*2));}
  else{target[0]-=dx*radius;target[1]+=dy*radius;}
  lx=e.clientX;ly=e.clientY;updateCam();
});
canvas.addEventListener('wheel',e=>{
  radius=Math.max(0.5,Math.min(200,radius*Math.exp(e.deltaY*0.001)));updateCam();
});
canvas.addEventListener('click',e=>{
  if(!measureMode||moved||!splats)return;
  const rect=canvas.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  const pt=findNearestSplat(mx,my);
  if(!pt)return;
  if(!pointA){
    pointA=pt;
  } else if(!pointB){
    pointB=pt;
    const dx=pointB[0]-pointA[0],dy=pointB[1]-pointA[1],dz=pointB[2]-pointA[2];
    measureDist=Math.sqrt(dx*dx+dy*dy+dz*dz);
    window.parent.postMessage({type:'MEASUREMENT',distance_m:parseFloat(measureDist.toFixed(3))},'*');
  } else {
    // Third click: start new measurement from this point
    pointA=pt;pointB=null;measureDist=0;
    window.parent.postMessage({type:'MEASURE_RESET'},'*');
  }
});

// Touch
let pt_t=null,pinch0=0,tMoved=false;
canvas.addEventListener('touchstart',e=>{e.preventDefault();
  tMoved=false;
  if(e.touches.length===1){dragging=true;lx=e.touches[0].clientX;ly=e.touches[0].clientY;}
  if(e.touches.length===2){pt_t=e.touches;pinch0=Math.hypot(pt_t[1].clientX-pt_t[0].clientX,pt_t[1].clientY-pt_t[0].clientY);}
},{passive:false});
canvas.addEventListener('touchend',e=>{e.preventDefault();dragging=false;pt_t=null;},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();
  tMoved=true;
  if(e.touches.length===1&&dragging&&splats){
    const dx=(e.touches[0].clientX-lx)/canvas.width,dy=(e.touches[0].clientY-ly)/canvas.height;
    az-=dx*4;el=Math.max(-1.5,Math.min(1.5,el+dy*2));lx=e.touches[0].clientX;ly=e.touches[0].clientY;updateCam();
  }
  if(e.touches.length===2&&pt_t){
    const d=Math.hypot(e.touches[1].clientX-e.touches[0].clientX,e.touches[1].clientY-e.touches[0].clientY);
    radius=Math.max(0.5,Math.min(200,radius*(pinch0/d)));pinch0=d;updateCam();
  }
},{passive:false});

// ── postMessage API ───────────────────────────────────────────────────────────
window.addEventListener('message',e=>{
  if(!e.data)return;
  if(e.data.type==='SET_MEASURE'){
    measureMode=e.data.active;
    if(!measureMode)resetMeasure();
  }
});

// ── project (depth sort + GPU upload) ────────────────────────────────────────
function project(){
  if(!splats)return;
  const W=canvas.width,H=canvas.height;
  const fx=W*0.85,fy=H*0.85;

  const cx=new Float32Array(N*2),cl=new Float32Array(N*4);
  const ca=new Float32Array(N*2),cb=new Float32Array(N*2);

  for(let i=0;i<N;i++){
    const b=i*10;
    const px=splats[b],py=splats[b+1],pz=splats[b+2];
    const sx=splats[b+3],sy=splats[b+4];
    const r=splats[b+6],g=splats[b+7],bl=splats[b+8],a=splats[b+9];
    const vx=camRi[0]*px+camRi[1]*py+camRi[2]*pz-camTx;
    const vy=camUu[0]*px+camUu[1]*py+camUu[2]*pz-camTy;
    const vz=camFw[0]*px+camFw[1]*py+camFw[2]*pz-camTz;
    if(vz<0.1){cx[i*2]=cx[i*2+1]=-99999;continue;}
    cx[i*2  ]=(vx/vz)*fx+W*0.5;
    cx[i*2+1]=(vy/vz)*fy+H*0.5;
    ca[i*2]=Math.min(sx*fx/vz,300);ca[i*2+1]=0;
    cb[i*2]=0;cb[i*2+1]=Math.min(sy*fy/vz,300);
    cl[i*4]=r;cl[i*4+1]=g;cl[i*4+2]=bl;cl[i*4+3]=a;
  }

  const depths=new Float32Array(N);
  for(let i=0;i<N;i++){
    const b=i*10;
    depths[i]=camFw[0]*splats[b]+camFw[1]*splats[b+1]+camFw[2]*splats[b+2];
  }
  const order=Array.from({length:N},(_,i)=>i).sort((a,b2)=>depths[a]-depths[b2]);
  sortOrder=order;

  const sx2=new Float32Array(N*2),sl=new Float32Array(N*4);
  const sa2=new Float32Array(N*2),sb2=new Float32Array(N*2);
  for(let j=0;j<N;j++){
    const i=order[j],d=j*2,d4=j*4,s=i*2,s4=i*4;
    sx2[d]=cx[s];sx2[d+1]=cx[s+1];
    sl[d4]=cl[s4];sl[d4+1]=cl[s4+1];sl[d4+2]=cl[s4+2];sl[d4+3]=cl[s4+3];
    sa2[d]=ca[s];sa2[d+1]=ca[s+1];
    sb2[d]=cb[s];sb2[d+1]=cb[s+1];
  }
  centerArr=sx2;colorArr=sl;covAArr=sa2;covBArr=sb2;

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
    let mx=0,my=0,mz=0;
    for(let i=0;i<N;i++){mx+=splats[i*10];my+=splats[i*10+1];mz+=splats[i*10+2];}
    target=[mx/N,my/N,mz/N];
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

// ── Render loop ───────────────────────────────────────────────────────────────
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

  drawOverlay();
}
requestAnimationFrame(render);
</script></body></html>`;
}

export function SplatViewer({ splatUrl }: Props) {
  const iframeRef    = useRef<HTMLIFrameElement>(null);
  const htmlBlobRef  = useRef("");
  const dataBlobRef  = useRef("");
  const [iframeSrc,  setIframeSrc]    = useState<string | null>(null);
  const [error,      setError]        = useState("");
  const [measuring,  setMeasuring]    = useState(false);
  const [measurement, setMeasurement] = useState<number | null>(null);

  // Load splat binary and build iframe
  useEffect(() => {
    let cancelled = false;
    setIframeSrc(null); setError(""); setMeasuring(false); setMeasurement(null);

    fetch(splatUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(buf => {
        if (cancelled) return;
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
      htmlBlobRef.current = ""; dataBlobRef.current = "";
    };
  }, [splatUrl]);

  // Listen for measurement results from iframe
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.data?.type === "MEASUREMENT") setMeasurement(e.data.distance_m);
      if (e.data?.type === "MEASURE_RESET") setMeasurement(null);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Sync measure mode into iframe
  function toggleMeasure() {
    const next = !measuring;
    setMeasuring(next);
    if (!next) setMeasurement(null);
    iframeRef.current?.contentWindow?.postMessage({ type: "SET_MEASURE", active: next }, "*");
  }

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
          ref={iframeRef}
          key={iframeSrc}
          src={iframeSrc}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          title="3D Gaussian Splat Viewer"
          sandbox="allow-scripts allow-same-origin"
        />
      )}

      {/* Measure toggle — only show when splat is loaded */}
      {iframeSrc && !error && (
        <div style={ctrlBar}>
          <button
            style={{ ...measureBtn, ...(measuring ? measureBtnActive : {}) }}
            onClick={toggleMeasure}
            title="Click two points in the 3D scene to measure distance"
          >
            📏 {measuring ? "Measuring…" : "Measure"}
          </button>
          {measurement !== null && (
            <div style={distBadge}>
              {measurement.toFixed(3)} m
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ctrlBar: React.CSSProperties = {
  position: "absolute", top: 10, right: 10, zIndex: 20,
  display: "flex", alignItems: "center", gap: 6,
};
const measureBtn: React.CSSProperties = {
  background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
  border: "1px solid rgba(255,255,255,0.15)", color: "#94a3b8",
  borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600,
  cursor: "pointer", transition: "all 0.15s",
};
const measureBtnActive: React.CSSProperties = {
  background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.5)",
  color: "#f59e0b",
};
const distBadge: React.CSSProperties = {
  background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)",
  border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b",
  borderRadius: 8, padding: "5px 12px", fontSize: 13, fontWeight: 700,
  fontFamily: "monospace",
};
