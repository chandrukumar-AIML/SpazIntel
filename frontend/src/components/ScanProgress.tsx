import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import type { JobStatus } from "../lib/api";

interface Props {
  scanId: string;
  onComplete: (scanId: string, objectCount: number, hasSplat: boolean) => void;
  onError: (msg: string) => void;
}

type StepKey = "queued" | "extracting" | "depth" | "detecting" | "colmap" | "splat" | "building_graph" | "complete";

const STEPS: { key: StepKey; label: string; hint?: string }[] = [
  { key: "queued",         label: "Preparing"                                       },
  { key: "extracting",     label: "Extracting frames"                               },
  { key: "detecting",      label: "Detecting objects",   hint: "YOLO-World, ~30–60s"},
  { key: "depth",          label: "Estimating depth",    hint: "Depth Anything v2"  },
  { key: "colmap",         label: "3D structure (COLMAP)", hint: "Structure from motion" },
  { key: "splat",          label: "Training 3D splat",   hint: "gsplat on RTX 4050, ~5–8 min" },
  { key: "building_graph", label: "Building scene graph"                            },
  { key: "complete",       label: "Complete!"                                       },
];

const ORDER: Record<string, number> = Object.fromEntries(STEPS.map((s, i) => [s.key, i]));

export function ScanProgress({ scanId, onComplete, onError }: Props) {
  const [job, setJob]         = useState<JobStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTime    = useRef(Date.now());

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, []);

  useEffect(() => {
    async function poll() {
      try {
        const j = await api.jobStatus(scanId);
        setJob(j);
        if (j.status === "complete") {
          clearInterval(intervalRef.current!);
          onComplete(scanId, j.objects_found, j.has_splat ?? false);
        } else if (j.status === "error") {
          clearInterval(intervalRef.current!);
          onError(j.error ?? "Pipeline failed");
        }
      } catch { /* network blip — keep polling */ }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => clearInterval(intervalRef.current!);
  }, [scanId, onComplete, onError]);

  const currentOrder = ORDER[job?.status ?? "queued"] ?? 0;
  const activeStep = STEPS[currentOrder];

  return (
    <div style={styles.root}>
      <motion.div
        style={styles.card}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div style={styles.titleRow}>
          <div style={styles.title}>Processing Room Scan</div>
          <div style={styles.timer}>
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </div>
        </div>
        <div style={styles.scanId}>{scanId}</div>

        <div style={styles.steps}>
          {STEPS.map((step, i) => {
            const state: "done" | "active" | "waiting" =
              currentOrder > i ? "done" :
              currentOrder === i ? "active" : "waiting";

            return (
              <div key={step.key} style={styles.stepRow}>
                <div style={{
                  ...styles.circle,
                  background: state === "done" ? "var(--success)" : state === "active" ? "var(--accent)" : "transparent",
                  border: state === "waiting" ? "1px solid var(--border)" : "none",
                }}>
                  {state === "done" && <span style={{ fontSize: 10, color: "#fff" }}>✓</span>}
                  {state === "active" && <span style={styles.activeDot} />}
                </div>
                <span style={{
                  ...styles.stepLabel,
                  color: state === "waiting" ? "var(--text-3)" : state === "active" ? "var(--text)" : "var(--text-2)",
                  fontWeight: state === "active" ? 600 : 400,
                }}>
                  {step.label}
                </span>
                {state === "active" && <span style={styles.runningBadge}>running…</span>}
                {state === "done"   && <span style={styles.doneBadge}>✓</span>}
              </div>
            );
          })}
        </div>

        {job?.frames_count ? <div style={styles.stat}>{job.frames_count} frames extracted</div> : null}
        {activeStep?.hint && (
          <div style={styles.hint}>{activeStep.hint}</div>
        )}

        <div style={styles.note}>
          The 3D splat training step takes 5–8 min on GPU.
          You can close this page and come back — the pipeline keeps running.
        </div>
      </motion.div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root:         { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"var(--bg)", padding:24 },
  card:         { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", padding:32, width:"100%", maxWidth:420, display:"flex", flexDirection:"column", gap:14 },
  titleRow:     { display:"flex", alignItems:"center", justifyContent:"space-between" },
  title:        { fontSize:18, fontWeight:700, letterSpacing:"-0.01em" },
  timer:        { fontSize:20, fontWeight:700, fontFamily:"monospace", color:"var(--accent)", letterSpacing:".05em" },
  scanId:       { fontSize:11, color:"var(--text-3)", fontFamily:"monospace" },
  steps:        { display:"flex", flexDirection:"column", gap:2, borderTop:"1px solid var(--border)", borderBottom:"1px solid var(--border)", padding:"12px 0", margin:"4px 0" },
  stepRow:      { display:"flex", alignItems:"center", gap:12, padding:"6px 0" },
  circle:       { width:20, height:20, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", transition:"background 0.3s" },
  activeDot:    { width:8, height:8, borderRadius:"50%", background:"#fff", animation:"pulse 1s ease-in-out infinite" },
  stepLabel:    { fontSize:13, transition:"color 0.3s" },
  runningBadge: { fontSize:11, color:"var(--accent)", marginLeft:"auto" },
  doneBadge:    { fontSize:11, color:"var(--success)", marginLeft:"auto" },
  stat:         { fontSize:12, color:"var(--text-3)" },
  hint:         { fontSize:12, color:"var(--accent)", fontWeight:500 },
  note:         { fontSize:11, color:"var(--text-3)", lineHeight:1.5, padding:"8px 10px", background:"var(--surface-2)", borderRadius:"var(--radius)", border:"1px solid var(--border)" },
};
