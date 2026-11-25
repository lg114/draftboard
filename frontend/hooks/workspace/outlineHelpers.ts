import {
  BrandKit,
  FALLBACK_THEMES,
  Outline,
  ThemeOption,
} from "../../lib/api";

export function buildOutlineEditPayload(outline: Outline) {
  return {
    items: outline.items.map((item) => ({
      outline_item_id: item.outline_item_id,
      title: item.title,
      summary: item.summary,
      layout: item.layout ?? null,
      source_ids: item.source_ids,
      column_right: item.column_right ?? null,
      image_asset_id: item.image_asset_id ?? null,
      speaker_notes: item.speaker_notes ?? null,
      custom_bg: item.custom_bg ?? null,
      custom_elements: item.custom_elements ?? null,
    })),
  };
}

export function isOutlineReadyForAutoSave(outline: Outline | null): boolean {
  if (!outline || outline.items.length === 0) return false;
  for (const item of outline.items) {
    if (!item.title.trim() || !item.summary.trim()) return false;
    if (item.custom_elements && item.custom_elements.length > 0) {
      continue;
    }
    if (
      item.layout === "two_column" &&
      !(item.column_right && item.column_right.trim())
    ) {
      return false;
    }
    if (
      item.layout === "text_image" &&
      !(item.image_asset_id && item.image_asset_id.trim())
    ) {
      return false;
    }
  }
  return true;
}

export function humanizeWorkspaceError(rawError: string | null): string | null {
  if (!rawError) return null;
  if (
    rawError.includes("没有保存任何大纲") ||
    rawError.includes("暂无可用素材") ||
    rawError.includes("未检测到有效素材")
  ) {
    return "大纲提炼未完成：请确认已上传有效的 Markdown/TXT 笔记或图片材料。";
  }
  if (rawError.includes("requires non-empty column_right")) {
    return "双栏对比页缺少右栏内容，请先填写后再保存或导出。";
  }
  if (rawError.includes("requires an image_asset_id")) {
    return "左文右图页尚未选择配图，请先在右侧选择已上传的图片。";
  }
  if (rawError.includes("empty title") || rawError.includes("empty summary")) {
    return "每一页都必须包含非空的标题和正文说明。";
  }
  if (rawError.includes("MISSING_IMAGE")) {
    return "图文页引用的图片素材不存在，请重新选择配图。";
  }
  if (
    rawError.includes("排版检查未通过") ||
    rawError.includes("OVERFLOW") ||
    rawError.includes("溢出")
  ) {
    return "部分页面文字超出安全版面，请精简文字或开启「自动缩字」后重试。";
  }
  if (rawError.includes("LibreOffice")) {
    return "LibreOffice 渲染失败，已生成的 PPTX 文件仍可直接下载。";
  }
  return rawError;
}

export function computeActiveTheme(
  themes: ThemeOption[],
  selectedThemeId: string,
  brand?: BrandKit | null
): ThemeOption {
  const base =
    themes.find((t) => t.id === selectedThemeId) ||
    themes[0] ||
    FALLBACK_THEMES[0];
  if (!brand || (!brand.accent_hex && !brand.bg_hex)) return base;
  const nextPalette = [...(base.chart_palette || [])];
  if (brand.accent_hex && nextPalette.length > 0) {
    nextPalette[0] = brand.accent_hex;
  }
  return {
    ...base,
    swatches: {
      ...base.swatches,
      accent: brand.accent_hex || base.swatches.accent,
      bg: brand.bg_hex || base.swatches.bg,
    },
    chart_palette: nextPalette.length > 0 ? nextPalette : base.chart_palette,
  };
}

export function splitSummaryIntoColumns(
  rawText: string
): { left: string; right: string } | null {
  const raw = rawText.trim();
  if (!raw) return null;
  let parts = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    parts = raw
      .split(/(?<=[。；;！!？?])/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (parts.length < 2) return null;
  const mid = Math.ceil(parts.length / 2);
  return {
    left: parts.slice(0, mid).join("\n"),
    right: parts.slice(mid).join("\n"),
  };
}
