export type EvidenceStatus = "supported" | "partial" | "unsupported";

export type OutlineLayout =
  | "cover"
  | "content"
  | "bullets"
  | "two_column"
  | "text_image"
  | "closing";

export interface OutlineItem {
  outline_item_id: string;
  title: string;
  summary: string;
  source_ids: string[];
  evidence_status: EvidenceStatus | string;
  layout: OutlineLayout | string | null;
  column_right?: string | null;
  image_asset_id?: string | null;
  speaker_notes?: string | null;
}

export interface ThemeSwatches {
  bg: string;
  cover_bg: string;
  title: string;
  cover_title: string;
  body: string;
  cover_body: string;
  accent: string;
  muted: string;
}

export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  swatches: ThemeSwatches;
}

export interface SourceFragment {
  source_id: string;
  asset_id: string;
  location: string;
  content_preview: string | null;
}

export interface MaterialsResponse {
  project_id: string;
  materials: Material[];
  source_fragments: SourceFragment[];
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

export interface ProjectSummary {
  project_id: string;
  name?: string;
  stage?: "ready" | "confirmed" | "outline_draft" | "materials_ready" | "empty";
  stage_label?: string;
  slide_count?: number;
  materials_count?: number;
  insufficient_evidence_count?: number;
  download_available?: boolean;
  mtime?: number;
}

export interface Project {
  project_id: string;
  name?: string;
  stage?: string;
  stage_label?: string;
  slide_count?: number;
  materials_count?: number;
  insufficient_evidence_count?: number;
  outlines: OutlineSummary[];
  generated_outline_version: string | null;
  latest_template_id?: string | null;
  latest_auto_fit?: boolean | null;
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