export interface OutlineItem {
  outline_item_id: string;
  title: string;
  summary: string;
  source_ids: string[];
  evidence_status: string;
  layout: string | null;
}

export interface Outline {
  outline_version: string;
  project_id: string;
  items: OutlineItem[];
  is_confirmed: boolean;
}

export interface OutlineSummary {
  outline_version: string;
  is_confirmed: boolean;
  item_count: number;
  mtime: number;
}

export interface Task {
  task_id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  step: string;
  error: string | null;
  result: {
    outline_version?: string;
    artifact_id?: string;
    artifact_revision?: number;
    export?: ExportReport;
    validation?: { issues: Issue[] };
    preview_pages?: number;
    preview_error?: string;
  };
}

export interface Issue {
  level: string;
  code: string;
  message: string;
  slide_id: string | null;
}

export interface ExportReport {
  success: boolean;
  artifact_id: string;
  artifact_revision: number;
  pptx_path: string | null;
  slide_count: number;
  issues: Issue[];
}

export interface Project {
  project_id: string;
  outlines: OutlineSummary[];
  generated_outline_version: string | null;
  latest_report: ExportReport | null;
  download_available: boolean;
  tasks: Task[];
}

export interface Material {
  asset_id: string;
  asset_type: string;
  content: string;
}

export interface Preview {
  artifact_id: string;
  artifact_revision: number;
  pages: string[];
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export function jsonOptions(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}