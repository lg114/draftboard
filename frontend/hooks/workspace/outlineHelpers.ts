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

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

function validHex(val?: string | null): string | null {
  const s = (val || "").trim();
  return HEX6_RE.test(s) ? s.toUpperCase() : null;
}

function parseHexRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [ra, ga, ba] = parseHexRgb(hexA);
  const [rb, gb, bb] = parseHexRgb(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  const fmt = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${fmt(ra * (1 - w) + rb * w)}${fmt(ga * (1 - w) + gb * w)}${fmt(
    ba * (1 - w) + bb * w
  )}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexRgb(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function hasCustomPalette(brand?: BrandKit | null): boolean {
  if (!brand) return false;
  return Boolean(
    validHex(brand.accent_hex) ||
      validHex(brand.bg_hex) ||
      validHex(brand.cover_bg_hex) ||
      validHex(brand.surface_hex)
  );
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
  if (!brand) return base;

  const paletteName = (brand.palette_name || "").trim().slice(0, 24) || null;
  const accent = validHex(brand.accent_hex);
  const bg = validHex(brand.bg_hex);
  const coverBg = validHex(brand.cover_bg_hex);
  const surface = validHex(brand.surface_hex);

  if (!paletteName && !accent && !bg && !coverBg && !surface) {
    return base;
  }

  const swatches = { ...base.swatches };

  if (bg) {
    swatches.bg = bg;
    const lumBg = relativeLuminance(bg);
    if (lumBg < 0.28) {
      swatches.title = mixHex(bg, "#FFFFFF", 0.92);
      swatches.body = mixHex(bg, "#F2F4F8", 0.72);
      swatches.muted = mixHex(bg, "#D8DCE4", 0.48);
      swatches.divider = mixHex(bg, "#FFFFFF", 0.16);
      if (!surface) {
        swatches.surface = mixHex(bg, "#FFFFFF", 0.07);
      }
    } else {
      swatches.title = mixHex(bg, "#121316", 0.88);
      swatches.body = mixHex(bg, "#1C1E22", 0.72);
      swatches.muted = mixHex(bg, "#2A2D33", 0.46);
      swatches.divider = mixHex(bg, "#1A1B1E", 0.12);
      if (!surface) {
        swatches.surface =
          lumBg > 0.95
            ? mixHex(bg, "#1A1B1E", 0.04)
            : mixHex(bg, "#FFFFFF", 0.52);
      }
    }
  }

  if (surface) {
    swatches.surface = surface;
  }

  if (coverBg) {
    swatches.cover_bg = coverBg;
    const lumCover = relativeLuminance(coverBg);
    if (lumCover < 0.3) {
      swatches.cover_title = mixHex(coverBg, "#FFFFFF", 0.94);
      swatches.cover_body = mixHex(coverBg, "#EFF2F7", 0.74);
    } else {
      swatches.cover_title = mixHex(coverBg, "#121316", 0.88);
      swatches.cover_body = mixHex(coverBg, "#1F2126", 0.68);
    }
  }

  let chartPalette = base.chart_palette;
  if (accent) {
    swatches.accent = accent;
    const darkBg = relativeLuminance(swatches.bg) < 0.28;
    const tintTarget = darkBg ? "#FFFFFF" : "#121316";
    const softAccent = mixHex(accent, darkBg ? "#FFFFFF" : swatches.bg, 0.35);
    const deepAccent = mixHex(accent, tintTarget, 0.32);
    chartPalette = [
      accent,
      swatches.title,
      softAccent,
      deepAccent,
      swatches.muted,
    ];
  }

  return {
    ...base,
    name:
      paletteName ||
      (hasCustomPalette(brand) ? "自定义配色" : base.name),
    swatches,
    chart_palette: chartPalette,
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
