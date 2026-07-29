const BASE = "http://localhost:8000";

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
  query:  (scan_id: string, question: string) =>
    action<{ answer: string; prompt_version?: string }>("query", { scan_id, question }),
  diff:   (scan_id_a: string, scan_id_b: string) =>
    action<DiffResult>("diff", { scan_id_a, scan_id_b }),
  status: (scan_id: string) =>
    action<{ has_scene_graph: boolean; has_splat: boolean; status: string }>("status", { scan_id }),
};

export interface SceneObject {
  id: string;
  label: string;
  confidence: number;
  position: { x_norm: number; y_norm: number; z_m: number | null };
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
