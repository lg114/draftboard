import type { Issue, Outline, OutlineLayout } from "../../lib/api";

export type WorkspaceStage =
  | "no_materials"
  | "has_materials_no_outline"
  | "outline_ready"
  | "ppt_ready";

export type ProjectStageKey =
  | "empty"
  | "materials_ready"
  | "outline_draft"
  | "confirmed"
  | "ready";

/**
 * Single source of truth for the 4-milestone completion progress (0/4 -> 4/4)
 * shared by both the Homepage project cards and the Editor header.
 */
export const PROJECT_STAGE_STEPS: Record<
  ProjectStageKey,
  { step: number; label: string }
> = {
  empty: { step: 0, label: "待导入素材" },
  materials_ready: { step: 1, label: "待生成大纲" },
  outline_draft: { step: 2, label: "大纲待审核" },
  confirmed: { step: 3, label: "大纲已确认" },
  ready: { step: 4, label: "PPT 已就绪" },
};

export function resolveWorkspaceStageKey(
  currentStage: WorkspaceStage,
  outline: Outline | null
): ProjectStageKey {
  if (currentStage === "ppt_ready") return "ready";
  if (currentStage === "outline_ready") {
    return outline?.is_confirmed ? "confirmed" : "outline_draft";
  }
  if (currentStage === "has_materials_no_outline") return "materials_ready";
  return "empty";
}

export type EditableOutlineField =
  | "title"
  | "summary"
  | "layout"
  | "column_right"
  | "image_asset_id"
  | "speaker_notes";

export const LAYOUT_OPTIONS: { value: OutlineLayout; label: string }[] = [
  { value: "cover", label: "封面" },
  { value: "content", label: "正文" },
  { value: "bullets", label: "分点" },
  { value: "two_column", label: "双栏" },
  { value: "text_image", label: "图文" },
  { value: "closing", label: "尾页" },
];

export const LAYOUT_LABELS: Record<string, string> = {
  cover: "封面",
  content: "正文",
  bullets: "分点",
  two_column: "双栏",
  text_image: "图文",
  closing: "尾页",
};

export function inferEffectiveLayout(
  layout: string | null | undefined,
  index: number,
  total: number
): OutlineLayout {
  if (
    layout === "cover" ||
    layout === "content" ||
    layout === "bullets" ||
    layout === "two_column" ||
    layout === "text_image" ||
    layout === "closing"
  ) {
    return layout;
  }
  if (index === 0) return "cover";
  if (index === total - 1 && total > 1) return "closing";
  return "content";
}

/**
 * Unescape literal `\n` sequences that LLMs occasionally emit inside JSON strings.
 */
export function normalizeEscapedNewlines(text: string): string {
  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

/**
 * Format raw fragment location tokens (e.g. `L1-L3`, `P2 L1-L10`, `P1`) into
 * clean Chinese labels (`第 1–3 行`, `第 2 页 · 第 1–10 行`, `第 1 页`).
 */
export function formatFragmentLocation(location: string): string {
  const loc = (location || "").trim();
  if (!loc) return "";
  const pdfLine = /^P(\d+)\s+L(\d+)-L(\d+)$/i.exec(loc);
  if (pdfLine) {
    return pdfLine[2] === pdfLine[3]
      ? `第 ${pdfLine[1]} 页 · 第 ${pdfLine[2]} 行`
      : `第 ${pdfLine[1]} 页 · 第 ${pdfLine[2]}–${pdfLine[3]} 行`;
  }
  const lineRange = /^L(\d+)-L(\d+)$/i.exec(loc);
  if (lineRange) {
    return lineRange[1] === lineRange[2]
      ? `第 ${lineRange[1]} 行`
      : `第 ${lineRange[1]}–${lineRange[2]} 行`;
  }
  const singleLine = /^L(\d+)$/i.exec(loc);
  if (singleLine) return `第 ${singleLine[1]} 行`;
  const pageRange = /^P(\d+)-P(\d+)$/i.exec(loc);
  if (pageRange) {
    return pageRange[1] === pageRange[2]
      ? `第 ${pageRange[1]} 页`
      : `第 ${pageRange[1]}–${pageRange[2]} 页`;
  }
  const singlePage = /^P(\d+)$/i.exec(loc);
  if (singlePage) return `第 ${singlePage[1]} 页`;
  return loc;
}

/**
 * Strip raw Markdown syntax (headings `# `, bold `**`, blockquotes `> `) for
 * clean provenance excerpt display and direct insertion into slide fields.
 */
export function cleanMarkdownExcerpt(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trimEnd()
    )
    .filter((line, idx, arr) => !(line === "" && (idx === 0 || arr[idx - 1] === "")))
    .join("\n")
    .trim();
}

/**
 * Return the layout-accurate target field name for inserting a source excerpt.
 */
export function getExcerptTargetLabel(layout: OutlineLayout): string {
  switch (layout) {
    case "cover":
      return "副标题";
    case "closing":
      return "结语";
    case "bullets":
      return "分点";
    case "two_column":
      return "左栏";
    case "text_image":
      return "说明";
    default:
      return "正文";
  }
}

/**
 * Extract 0-based slide indices referenced by backend validation/export issues
 * (e.g. slide_id="slide-002" or message containing "Slide 'slide-002'").
 */
export function extractIssueSlideIndices(issues: Issue[]): Set<number> {
  const result = new Set<number>();
  const re = /slide-(\d+)/gi;
  for (const iss of issues) {
    if (iss.slide_id) {
      const m = /slide-(\d+)/i.exec(iss.slide_id);
      if (m) result.add(Math.max(0, parseInt(m[1], 10) - 1));
    }
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(iss.message)) !== null) {
      result.add(Math.max(0, parseInt(m[1], 10) - 1));
    }
  }
  return result;
}
