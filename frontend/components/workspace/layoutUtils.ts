import type { Issue, OutlineLayout } from "../../lib/api";

export type WorkspaceStage =
  | "no_materials"
  | "has_materials_no_outline"
  | "outline_ready"
  | "ppt_ready";

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
