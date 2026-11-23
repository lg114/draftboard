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
  divider: string;
  surface: string;
}

export interface ThemeOption {
  id: string;
  name: string;
  description: string;
  swatches: ThemeSwatches;
}

export const FALLBACK_THEMES: ThemeOption[] = [
  {
    id: "keynote_light",
    name: "苹果白",
    description: "纯净画布 · 极简黑字",
    swatches: {
      bg: "#FBFBFD",
      cover_bg: "#F5F5F7",
      title: "#1D1D1F",
      cover_title: "#1D1D1F",
      body: "#424245",
      cover_body: "#424245",
      accent: "#0071E3",
      muted: "#6E6E73",
      divider: "#E5E5EA",
      surface: "#FFFFFF",
    },
  },
  {
    id: "keynote_dark",
    name: "深空钛黑",
    description: "发布会暗黑 · 银灰层次",
    swatches: {
      bg: "#111113",
      cover_bg: "#000000",
      title: "#F5F5F7",
      cover_title: "#FFFFFF",
      body: "#A1A1A6",
      cover_body: "#B4B4BA",
      accent: "#2997FF",
      muted: "#8E8E93",
      divider: "#262629",
      surface: "#1C1C1F",
    },
  },
  {
    id: "nordic_pine",
    name: "松柏森绿",
    description: "深松封面 · 象牙正文",
    swatches: {
      bg: "#FAFBF9",
      cover_bg: "#0F2922",
      title: "#10241E",
      cover_title: "#F4F7F5",
      body: "#3D4F49",
      cover_body: "#C2D6CF",
      accent: "#2E7D63",
      muted: "#7E948C",
      divider: "#E3EAE6",
      surface: "#F2F6F4",
    },
  },
  {
    id: "gallery_sand",
    name: "美术馆暖石",
    description: "亚麻纸感 · 陶土点缀",
    swatches: {
      bg: "#F4F1EA",
      cover_bg: "#23221F",
      title: "#1F1E1B",
      cover_title: "#F4F1EA",
      body: "#4F4B45",
      cover_body: "#D4CFC4",
      accent: "#B4533C",
      muted: "#948E84",
      divider: "#E3DDD2",
      surface: "#ECE7DD",
    },
  },
];

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

export interface CoverSlidePreview {
  title: string;
  summary: string;
  layout: OutlineLayout | string | null;
  column_right?: string | null;
  image_asset_id?: string | null;
}

export interface ProjectSummary {
  project_id: string;
  name?: string;
  theme_id?: string;
  stage?: "ready" | "confirmed" | "outline_draft" | "materials_ready" | "empty";
  stage_label?: string;
  slide_count?: number;
  materials_count?: number;
  material_names?: string[];
  insufficient_evidence_count?: number;
  cover_slide?: CoverSlidePreview | null;
  preview_cover_url?: string | null;
  download_available?: boolean;
  mtime?: number;
}

export interface Project {
  project_id: string;
  name?: string;
  theme_id?: string;
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

export interface SlideRefineCandidate {
  outline_item_id: string;
  title: string;
  summary: string;
  column_right?: string | null;
  layout?: OutlineLayout | string | null;
  rationale?: string;
  source?: "llm" | "fallback";
}

export interface ChatToolStep {
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error";
  summary?: string;
}

export interface ChatDeckChanges {
  before_outline_version?: string | null;
  after_outline_version?: string | null;
  touched_slides?: number[];
  theme_id?: string | null;
  auto_fit?: boolean | null;
  exported?: boolean;
  layout_checked_ok?: boolean | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  selected_slide?: number;
  tool_steps?: ChatToolStep[];
  changes?: ChatDeckChanges | null;
  is_error?: boolean;
}

export interface ChatHistoryResponse {
  project_id: string;
  messages: ChatMessage[];
}

export interface LLMProviderPreset {
  id: string;
  name: string;
  base_url: string;
  default_model: string;
  requires_api_key: boolean;
  suggested_models: string[];
}

export interface LLMProfilePublic {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  model: string;
  has_api_key: boolean;
  api_key_masked: string;
  usable: boolean;
}

export interface LLMActiveSummary {
  name: string;
  provider: string;
  model: string;
  base_url: string;
  source?: "profile" | "env";
  has_api_key?: boolean;
  api_key_masked?: string;
}

export interface LLMSettingsResponse {
  configured: boolean;
  source: "profile" | "env" | "none";
  active_profile_id: string | null;
  active_summary: LLMActiveSummary | null;
  env_detected: LLMActiveSummary | null;
  profiles: LLMProfilePublic[];
  presets: LLMProviderPreset[];
}

export interface LLMConnectionTestResponse {
  ok: boolean;
  latency_ms?: number;
  model?: string;
  error?: string;
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
