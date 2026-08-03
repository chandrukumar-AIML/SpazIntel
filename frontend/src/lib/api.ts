// Empty string → relative paths → Vite proxy forwards to localhost:8000
const BASE = import.meta.env.VITE_BACKEND_URL ?? "";

async function action<T>(act: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/spatial/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: act, payload }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Unknown error");
  return json.data as T;
}

export const api = {
  query: (scan_id: string, question: string) =>
    action<{ answer: string; prompt_version?: string }>("query", { scan_id, question }),

  diff: (scan_id_a: string, scan_id_b: string) =>
    action<DiffResult>("diff", { scan_id_a, scan_id_b }),

  status: (scan_id: string) =>
    action<{ has_scene_graph: boolean; has_splat: boolean; status: string }>("status", { scan_id }),

  upload: async (files: FileList | File[], mode: "room" | "object" = "room"): Promise<{ scan_id: string; type: string }> => {
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append("files", f));
    const res = await fetch(`${BASE}/api/spatial/upload?mode=${mode}`, { method: "POST", body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail ?? "Upload failed");
    }
    return res.json();
  },

  jobStatus: (scan_id: string): Promise<JobStatus> =>
    fetch(`${BASE}/api/spatial/job/${scan_id}`).then(r => r.json()),

  sceneGraph: (scan_id: string) =>
    action<{ objects: SceneObject[]; structure: unknown; distances: { from: string; to: string; distance_m: number }[]; room_size?: { width_m: number; depth_m: number } }>("scene_graph", { scan_id }),

  measure: (scan_id: string, label_a: string, label_b: string) =>
    action<{ label_a: string; label_b: string; distance_m: number; note: string }>("measure", { scan_id, label_a, label_b }),

  report: (scan_id: string, regen = false) =>
    action<ReportData>("report", { scan_id, regen }),

  search: (query: string) =>
    action<SearchData>("search", { query }),

  rename: (scan_id: string, name: string) =>
    action<{ scan_id: string; name: string }>("rename", { scan_id, name }),

  deleteScan: (scan_id: string) =>
    action<{ scan_id: string; deleted: boolean }>("delete", { scan_id }),

  listScans: (): Promise<{ scans: ScanSummary[] }> =>
    fetch(`${BASE}/api/scans`).then(r => r.json()),

  exportUrl:    (scan_id: string) => `${BASE}/api/spatial/export/${scan_id}`,
  exportObjUrl: (scan_id: string) => `${BASE}/api/spatial/export/${scan_id}/obj`,
  exportGltfUrl:(scan_id: string) => `${BASE}/api/spatial/export/${scan_id}/gltf`,
  splatUrl:     (scan_id: string) => `${BASE}/api/spatial/splat/${scan_id}`,
  floorPlanUrl: (scan_id: string) => `${BASE}/api/spatial/floor_plan/${scan_id}`,
};

export interface SceneObject {
  id: string;
  label: string;
  confidence: number;
  position: { x_norm: number; y_norm: number; z_m: number | null };
}

export interface JobStatus {
  scan_id: string;
  status: "queued" | "extracting" | "depth" | "detecting" | "colmap" | "splat" | "building_graph" | "complete" | "error" | "not_found";
  step: string;
  frames_count: number;
  objects_found: number;
  has_splat: boolean;
  error: string | null;
}

export interface ScanSummary {
  scan_id: string;
  name?: string;
  status: string;
  objects_found: number;
  has_splat: boolean;
  created_at: number;
}

interface SearchResultItem {
  scan_id: string;
  name?: string;
  score: number;
  reason: string;
  preview_objects: string[];
}

interface SearchData {
  query: string;
  results: SearchResultItem[];
  total_scans_searched: number;
}

interface ReportData {
  scan_id: string;
  room_type: string;
  overview: string;
  insights: string[];
  metrics: {
    object_count: number;
    room_width_m: number | null;
    room_depth_m: number | null;
    distance_pairs: number;
  };
  objects: { label: string; confidence: number }[];
  top_distances: { from: string; to: string; distance_m: number }[];
  cached: boolean;
}

export interface DiffResult {
  scan_a: string;
  scan_b: string;
  changes: {
    added:   { label: string; position: SceneObject["position"] }[];
    removed: { label: string }[];
    moved:   { label: string; from: SceneObject["position"]; to: SceneObject["position"]; distance: number }[];
  };
  unchanged_count: number;
  summary: string;
}
