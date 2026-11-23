"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Image as ImageIcon,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type {
  BrandKit,
  CanvasElement,
  ExportReport,
  Issue,
  Material,
  Outline,
  OutlineLayout,
  Preview,
  Project,
  ThemeOption,
} from "../../lib/api";
import { CustomSlideLayer, resolveCanvasColor } from "./CustomSlideLayer";
import {
  inferEffectiveLayout,
  LAYOUT_OPTIONS,
  normalizeEscapedNewlines,
} from "./layoutUtils";

interface SlideStageCanvasProps {
  pid: string;
  project: Project | null;
  outline: Outline;
  version: string;
  isStale: boolean;
  selectedIndex: number;
  preview: Preview | null;
  report: ExportReport | null;
  issues: Issue[];
  issueSlideIndices: Set<number>;
  themes: ThemeOption[];
  activeTheme: ThemeOption;
  selectedThemeId: string;
  autoFit: boolean;
  statusText: string;
  isGenerating: boolean;
  materials?: Material[];
  brand?: BrandKit | null;
  diffPreviewActive?: boolean;
  onExitDiffPreview?: () => void;
  onRevertFromDiff?: () => void;
  onUpdateBrand?: (brand: BrandKit) => Promise<void>;
  onSelectIndex: (idx: number) => void;
  onSelectTheme: (themeId: string) => void;
  onSelectLayout: (layout: OutlineLayout) => void;
  onToggleAutoFit: () => void;
  onFocusField: (fieldId: string) => void;
  onUpdateCustomElement?: (elementId: string, patch: Partial<CanvasElement>) => void;
  onDeleteCustomElement?: (elementId: string) => void;
}

/**
 * True 16:9 (22x14) block-based miniature layout pictograms so users can
 * recognize each layout at a glance without reading the label.
 */
function LayoutIcon({ layout }: { layout: OutlineLayout }) {
  switch (layout) {
    case "cover":
      return (
        <svg className="w-[22px] h-[14px] shrink-0" viewBox="0 0 22 14" fill="none">
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="3.5" width="4.5" height="1.4" rx="0.7" fill="currentColor" />
          <rect x="3" y="6.2" width="12.5" height="2.4" rx="0.8" fill="currentColor" />
          <rect x="3" y="9.8" width="8.5" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.45" />
        </svg>
      );
    case "bullets":
      return (
        <svg className="w-[22px] h-[14px] shrink-0" viewBox="0 0 22 14" fill="none">
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.8" width="9" height="1.6" rx="0.6" fill="currentColor" />
          <circle cx="3.8" cy="6.5" r="0.9" fill="currentColor" />
          <rect x="5.8" y="5.9" width="12" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.6" />
          <circle cx="3.8" cy="9" r="0.9" fill="currentColor" />
          <rect x="5.8" y="8.4" width="10" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.6" />
          <circle cx="3.8" cy="11.3" r="0.9" fill="currentColor" />
          <rect x="5.8" y="10.7" width="11" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.6" />
        </svg>
      );
    case "two_column":
      return (
        <svg className="w-[22px] h-[14px] shrink-0" viewBox="0 0 22 14" fill="none">
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.6" width="9" height="1.5" rx="0.6" fill="currentColor" />
          <rect x="3" y="5.4" width="7.2" height="6.2" rx="1" fill="currentColor" fillOpacity="0.22" />
          <rect x="11.8" y="5.4" width="7.2" height="6.2" rx="1" fill="currentColor" fillOpacity="0.22" />
          <line x1="11" y1="5.4" x2="11" y2="11.6" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.5" />
        </svg>
      );
    case "text_image":
      return (
        <svg className="w-[22px] h-[14px] shrink-0" viewBox="0 0 22 14" fill="none">
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.6" width="8.5" height="1.5" rx="0.6" fill="currentColor" />
          <rect x="3" y="5.8" width="6.2" height="1.1" rx="0.5" fill="currentColor" fillOpacity="0.55" />
          <rect x="3" y="8" width="5.4" height="1.1" rx="0.5" fill="currentColor" fillOpacity="0.55" />
          <rect x="3" y="10.2" width="4.4" height="1.1" rx="0.5" fill="currentColor" fillOpacity="0.4" />
          <rect x="11" y="5.1" width="8.2" height="6.6" rx="1.1" fill="currentColor" fillOpacity="0.24" />
          <path
            d="M12.2 10.6L14.2 8.4L15.6 9.8L16.8 8.7L18.2 10.6H12.2Z"
            fill="currentColor"
            fillOpacity="0.85"
          />
        </svg>
      );
    case "closing":
      return (
        <svg className="w-[22px] h-[14px] shrink-0" viewBox="0 0 22 14" fill="none">
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="8.8" y="3.5" width="4.4" height="1.2" rx="0.6" fill="currentColor" />
          <rect x="5.5" y="6" width="11" height="2.2" rx="0.8" fill="currentColor" />
          <rect x="6.8" y="9.4" width="8.4" height="1.2" rx="0.6" fill="currentColor" fillOpacity="0.45" />
        </svg>
      );
    default:
      // content
      return (
        <svg className="w-[22px] h-[14px] shrink-0" viewBox="0 0 22 14" fill="none">
          <rect
            x="0.75"
            y="0.75"
            width="20.5"
            height="12.5"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeOpacity="0.45"
          />
          <rect x="3" y="2.8" width="9.5" height="1.6" rx="0.6" fill="currentColor" />
          <rect x="3" y="5.8" width="16" height="5.6" rx="1" fill="currentColor" fillOpacity="0.2" />
        </svg>
      );
  }
}

export function SlideStageCanvas({
  pid,
  project,
  outline,
  version,
  isStale,
  selectedIndex,
  preview,
  report,
  issues,
  issueSlideIndices,
  themes,
  activeTheme,
  selectedThemeId,
  autoFit,
  statusText,
  isGenerating,
  materials = [],
  brand = null,
  diffPreviewActive = false,
  onExitDiffPreview,
  onRevertFromDiff,
  onUpdateBrand,
  onSelectIndex,
  onSelectTheme,
  onSelectLayout,
  onToggleAutoFit,
  onFocusField,
  onUpdateCustomElement,
  onDeleteCustomElement,
}: SlideStageCanvasProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.75);
  const [compactDock, setCompactDock] = useState(false);
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);
  const [themeTab, setThemeTab] = useState<"themes" | "brand">("themes");
  const [brandDraft, setBrandDraft] = useState<BrandKit>({});
  const [savingBrand, setSavingBrand] = useState(false);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);

  useEffect(() => {
    setBrandDraft({
      accent_hex: brand?.accent_hex || "",
      bg_hex: brand?.bg_hex || "",
      footer_text: brand?.footer_text || "",
      logo_asset_id: brand?.logo_asset_id || "",
      logo_position: brand?.logo_position || "top_right",
    });
  }, [brand, themePopoverOpen]);

  useEffect(() => {
    setSelectedElId(null);
  }, [selectedIndex, version]);

  useEffect(() => {
    if (!selectedElId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedElId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedElId]);

  useEffect(() => {
    const update = () => {
      if (shellRef.current) {
        const w = shellRef.current.clientWidth;
        if (w > 0) setScale(w / 960);
      }
      if (colRef.current) {
        setCompactDock(colRef.current.clientWidth < 700);
      }
    };
    update();
    const obs = new ResizeObserver(update);
    if (shellRef.current) obs.observe(shellRef.current);
    if (colRef.current) obs.observe(colRef.current);
    return () => obs.disconnect();
  }, []);

  const total = outline.items.length;
  const item = outline.items[selectedIndex];
  const isCustomCanvas = Boolean(
    item?.custom_elements && item.custom_elements.length > 0
  );
  const selectedEl: CanvasElement | null = isCustomCanvas
    ? item?.custom_elements?.find((el) => el.id === selectedElId) ?? null
    : null;
  const imageAssets = materials.filter((m) => m.asset_type === "image");
  const firstCustomTextId = isCustomCanvas
    ? item?.custom_elements?.find((el) => el.kind === "text")?.id
    : undefined;
  const layout = item
    ? inferEffectiveLayout(item.layout, selectedIndex, total)
    : "content";
  const sw = activeTheme.swatches;
  const isHero = layout === "cover" || layout === "closing";
  const slideBg = isHero ? sw.cover_bg : sw.bg;
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;

  // Automatically display rendered PNG only when exported & strictly in sync;
  // any edit or theme switch seamlessly flips to the live 960x540 canvas!
  const hasRenderedPage = Boolean(preview?.pages && preview.pages[selectedIndex]);
  const settingsInSync =
    Boolean(project?.latest_template_id) &&
    project?.latest_template_id === selectedThemeId &&
    Boolean(project?.latest_auto_fit) === autoFit;
  const showRenderedImage =
    !diffPreviewActive &&
    !isStale &&
    settingsInSync &&
    Boolean(version) &&
    version === project?.generated_outline_version &&
    hasRenderedPage;

  const firstIssueSlide = Array.from(issueSlideIndices).sort((a, b) => a - b)[0];
  const hasLayoutIssues =
    issues.length > 0 || Boolean(report && !report.success);

  return (
    <main className="flex-1 bg-stage flex flex-col items-center justify-center px-4 lg:px-6 py-4 min-w-0 min-h-0 overflow-y-auto clean-scroll">
      <div
        ref={colRef}
        className="w-full max-w-[min(1080px,max(420px,calc((100vh-172px)*16/9)))] flex flex-col items-center gap-3.5 my-auto"
      >
        {/* Before/After Visual Diff Banner */}
        {diffPreviewActive && (
          <div className="w-full px-3.5 py-2 rounded-xl bg-warning-bg border border-warning-dot/30 flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-2 text-warning font-medium">
              <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
              <span>正在对比查看「AI 修改前」版本（只读预览）</span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {onRevertFromDiff && (
                <button
                  type="button"
                  onClick={onRevertFromDiff}
                  className="px-2.5 py-1 rounded-full bg-surface border border-black/15 text-ink font-medium hover:bg-canvas cursor-pointer"
                >
                  恢复为此版本
                </button>
              )}
              {onExitDiffPreview && (
                <button
                  type="button"
                  onClick={onExitDiffPreview}
                  className="px-3 py-1 rounded-full bg-ink text-white font-medium hover:bg-ink-hover cursor-pointer"
                >
                  切回改后版本
                </button>
              )}
            </div>
          </div>
        )}

        {/* Clean 1-line Quiet Status Above Stage */}
        <div className="w-full flex items-center justify-between px-0.5 text-[13px] gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {isGenerating ? (
              <span className="inline-flex items-center gap-2 text-ink font-medium truncate">
                <span className="w-2 h-2 rounded-full bg-ink animate-pulse shrink-0" />
                <span className="truncate">{statusText || "正在处理…"}</span>
              </span>
            ) : hasLayoutIssues ? (
              <button
                type="button"
                onClick={() => {
                  if (firstIssueSlide !== undefined) {
                    onSelectIndex(firstIssueSlide);
                  }
                }}
                className="inline-flex items-center gap-2 text-danger hover:underline font-medium cursor-pointer truncate"
              >
                <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
                <span className="truncate">
                  {firstIssueSlide !== undefined
                    ? `第 ${firstIssueSlide + 1} 页存在排版溢出或校验异常`
                    : "最近一次排版校验未通过"}
                </span>
                {firstIssueSlide !== undefined && (
                  <span className="shrink-0">点击定位 ›</span>
                )}
              </button>
            ) : showRenderedImage ? (
              <span className="inline-flex items-center gap-2 text-ink font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>已与 PPTX 同步</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-ink-secondary whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>排版安全</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            {isCustomCanvas && (
              <span className="px-2 py-0.5 rounded-full bg-black/[0.06] text-[13px] font-medium text-ink">
                自由画布
              </span>
            )}
            <span className="text-ink-secondary font-medium tabular-nums">
              {selectedIndex + 1} / {total}
            </span>
          </div>
        </div>

        {/* True 960x540 Proportional Scaled 16:9 Stage (crisp 3px corners matching PPTX output) */}
        <div
          ref={shellRef}
          className="aspect-[16/9] w-full rounded-[3px] overflow-hidden slide-shadow relative bg-surface"
        >
          {showRenderedImage && preview?.pages[selectedIndex] ? (
            <div
              onClick={() =>
                onFocusField(
                  firstCustomTextId
                    ? `custom-el-${firstCustomTextId}`
                    : "input-title"
                )
              }
              className="absolute inset-0 bg-white flex items-center justify-center cursor-text"
              title="点击右侧编辑内容（当前展示已导出的 Office 渲染图）"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.pages[selectedIndex]}
                alt={`第 ${selectedIndex + 1} 页`}
                className="w-full h-full object-contain select-none"
              />
            </div>
          ) : item && isCustomCanvas && item.custom_elements ? (
            <>
              <CustomSlideLayer
                pid={pid}
                customBg={item.custom_bg}
                elements={item.custom_elements}
                theme={activeTheme}
                scale={scale}
                interactive={!diffPreviewActive}
                selectedElementId={diffPreviewActive ? null : selectedElId}
                onSelectElement={setSelectedElId}
                onSelectTextElement={(elId) => onFocusField(`custom-el-${elId}`)}
                onUpdateElement={diffPreviewActive ? undefined : onUpdateCustomElement}
              />
              {brand && (brand.footer_text || brand.logo_asset_id) && (
                <div
                  className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 pointer-events-none"
                  style={{ transform: `scale(${scale})` }}
                >
                  {brand.logo_asset_id && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/projects/${encodeURIComponent(pid)}/assets/${encodeURIComponent(brand.logo_asset_id)}`}
                      alt="brand logo"
                      style={{
                        position: "absolute",
                        left: brand.logo_position === "bottom_left" ? 48 : 840,
                        top: brand.logo_position === "bottom_left" ? 502 : 14,
                        width: 72,
                        height: 24,
                        objectFit: "contain",
                      }}
                    />
                  )}
                  {brand.footer_text && (
                    <div
                      style={{
                        position: "absolute",
                        left: brand.logo_asset_id && brand.logo_position === "bottom_left" ? 128 : 48,
                        top: 506,
                        fontSize: 11,
                        color: sw.muted,
                      }}
                    >
                      {brand.footer_text}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : item ? (
            <div
              className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 transition-colors duration-200"
              style={{
                transform: `scale(${scale})`,
                backgroundColor: slideBg,
              }}
            >
              {layout === "cover" ? (
                <>
                  {/* Editorial top-left accent bar */}
                  <div
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 144,
                      width: 60,
                      height: 3.5,
                      borderRadius: 99,
                      backgroundColor: sw.accent,
                    }}
                  />
                  <div
                    onClick={() => onFocusField("input-title")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 172,
                      width: 864,
                      fontSize: 44,
                      lineHeight: "54px",
                      fontWeight: 700,
                      letterSpacing: "-0.028em",
                      color: titleCol,
                      textAlign: "left",
                    }}
                  >
                    {item.title || "未命名标题"}
                  </div>
                  <div
                    onClick={() => onFocusField("input-summary")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 298,
                      width: 820,
                      fontSize: 20,
                      lineHeight: "31px",
                      whiteSpace: "pre-wrap",
                      color: bodyCol,
                      textAlign: "left",
                    }}
                  >
                    {normalizeEscapedNewlines(item.summary)}
                  </div>
                </>
              ) : layout === "closing" ? (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: 452,
                      top: 140,
                      width: 56,
                      height: 3,
                      borderRadius: 99,
                      backgroundColor: sw.accent,
                    }}
                  />
                  <div
                    onClick={() => onFocusField("input-title")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 168,
                      width: 864,
                      fontSize: 34,
                      lineHeight: "44px",
                      fontWeight: 700,
                      letterSpacing: "-0.022em",
                      color: titleCol,
                      textAlign: "center",
                    }}
                  >
                    {item.title || "谢谢聆听"}
                  </div>
                  <div
                    onClick={() => onFocusField("input-summary")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 250,
                      width: 864,
                      fontSize: 20,
                      lineHeight: "32px",
                      whiteSpace: "pre-wrap",
                      color: bodyCol,
                      textAlign: "center",
                    }}
                  >
                    {normalizeEscapedNewlines(item.summary)}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 220,
                      top: 444,
                      width: 520,
                      height: 1,
                      backgroundColor: sw.divider,
                    }}
                  />
                </>
              ) : (
                <>
                  {/* Content / Bullets / Two Column / Text+Image Header */}
                  <div
                    onClick={() => onFocusField("input-title")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 28,
                      width: 864,
                      fontSize: 28,
                      lineHeight: "36px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: titleCol,
                    }}
                  >
                    {item.title || "未命名标题"}
                  </div>
                  {/* Full hairline + left theme accent segment */}
                  <div
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 104,
                      width: 864,
                      height: 1,
                      backgroundColor: sw.divider,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 103,
                      width: 60,
                      height: 2.5,
                      borderRadius: 99,
                      backgroundColor: sw.accent,
                    }}
                  />

                  {layout === "bullets" ? (
                    <ul
                      onClick={() => onFocusField("input-summary")}
                      className="clickable-slot"
                      style={{
                        position: "absolute",
                        left: 48,
                        top: 124,
                        width: 864,
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                      }}
                    >
                      {normalizeEscapedNewlines(item.summary)
                        .split("\n")
                        .map((s) => s.replace(/^[-*•·]\s+/, "").trim())
                        .filter(Boolean)
                        .map((line, i) => (
                          <li
                            key={i}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 14,
                              fontSize: 20,
                              lineHeight: "29px",
                              color: bodyCol,
                            }}
                          >
                            <span
                              style={{
                                marginTop: 11,
                                width: 6.5,
                                height: 6.5,
                                borderRadius: 99,
                                backgroundColor: sw.accent,
                                flexShrink: 0,
                              }}
                            />
                            <span>{line}</span>
                          </li>
                        ))}
                    </ul>
                  ) : layout === "two_column" ? (
                    <>
                      <div
                        style={{
                          position: "absolute",
                          left: 48,
                          top: 120,
                          width: 412,
                          height: 1,
                          backgroundColor: sw.divider,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: 500,
                          top: 120,
                          width: 412,
                          height: 1,
                          backgroundColor: sw.divider,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          left: 480,
                          top: 126,
                          width: 1,
                          height: 350,
                          backgroundColor: sw.divider,
                        }}
                      />
                      <div
                        onClick={() => onFocusField("input-summary")}
                        className="clickable-slot"
                        style={{
                          position: "absolute",
                          left: 48,
                          top: 128,
                          width: 412,
                          fontSize: 20,
                          lineHeight: "29px",
                          whiteSpace: "pre-wrap",
                          color: bodyCol,
                        }}
                      >
                        {normalizeEscapedNewlines(item.summary)}
                      </div>
                      <div
                        onClick={() => onFocusField("input-col-right")}
                        className="clickable-slot"
                        style={{
                          position: "absolute",
                          left: 500,
                          top: 128,
                          width: 412,
                          fontSize: 20,
                          lineHeight: "29px",
                          whiteSpace: "pre-wrap",
                          color: item.column_right ? bodyCol : sw.muted,
                        }}
                      >
                        {item.column_right
                          ? normalizeEscapedNewlines(item.column_right)
                          : "（请在右侧填写右栏内容）"}
                      </div>
                    </>
                  ) : layout === "text_image" ? (
                    <>
                      <div
                        onClick={() => onFocusField("input-summary")}
                        className="clickable-slot"
                        style={{
                          position: "absolute",
                          left: 48,
                          top: 126,
                          width: 388,
                          fontSize: 20,
                          lineHeight: "29px",
                          whiteSpace: "pre-wrap",
                          color: bodyCol,
                        }}
                      >
                        {normalizeEscapedNewlines(item.summary)}
                      </div>
                      {/* Expanded 456x372 image visual stage (clean borderless integration) */}
                      <div
                        style={{
                          position: "absolute",
                          left: 456,
                          top: 120,
                          width: 456,
                          height: 372,
                          backgroundColor: item.image_asset_id
                            ? "transparent"
                            : sw.surface,
                          borderRadius: item.image_asset_id ? 0 : 6,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                        }}
                      >
                        {item.image_asset_id ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`/api/projects/${pid}/assets/${encodeURIComponent(
                              item.image_asset_id
                            )}`}
                            alt={item.image_asset_id}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 8,
                              color: sw.muted,
                              fontSize: 15,
                            }}
                          >
                            <ImageIcon className="w-8 h-8 opacity-60" />
                            <span>请在右侧选择配图</span>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div
                      onClick={() => onFocusField("input-summary")}
                      className="clickable-slot"
                      style={{
                        position: "absolute",
                        left: 48,
                        top: 126,
                        width: 864,
                        fontSize: 20,
                        lineHeight: "30px",
                        whiteSpace: "pre-wrap",
                        color: bodyCol,
                      }}
                    >
                      {normalizeEscapedNewlines(item.summary)}
                    </div>
                  )}
                </>
              )}

              {layout !== "cover" && brand?.logo_asset_id && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/projects/${encodeURIComponent(pid)}/assets/${encodeURIComponent(brand.logo_asset_id)}`}
                  alt="brand logo"
                  style={{
                    position: "absolute",
                    left: brand.logo_position === "bottom_left" ? 48 : 840,
                    top: brand.logo_position === "bottom_left" ? 502 : 14,
                    width: 72,
                    height: 24,
                    objectFit: "contain",
                    pointerEvents: "none",
                  }}
                />
              )}
              {layout !== "cover" && brand?.footer_text && (
                <div
                  style={{
                    position: "absolute",
                    left: brand.logo_asset_id && brand.logo_position === "bottom_left" ? 128 : 48,
                    bottom: 18,
                    fontSize: 11,
                    color: sw.muted,
                    pointerEvents: "none",
                  }}
                >
                  {brand.footer_text}
                </div>
              )}
              {layout !== "cover" && (
                <div
                  style={{
                    position: "absolute",
                    right: 48,
                    bottom: 18,
                    fontSize: 12,
                    color: sw.muted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {String(selectedIndex + 1).padStart(2, "0")} /{" "}
                  {String(total).padStart(2, "0")}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Always-Single-Line Adaptive Floating Glass Dock OR Selected Custom Element Bar */}
        <div className="relative max-w-full">
          {selectedEl && onUpdateCustomElement ? (
            <div className="apple-glass dock-shadow rounded-2xl px-2.5 py-1.5 flex items-center gap-2 flex-nowrap max-w-full overflow-x-auto clean-scroll text-[13px]">
              <span className="px-2 py-0.5 rounded-lg bg-black/[0.06] font-semibold text-ink whitespace-nowrap shrink-0">
                {selectedEl.kind === "text"
                  ? "文本"
                  : selectedEl.kind === "card"
                  ? "卡片"
                  : selectedEl.kind === "image"
                  ? "图片"
                  : selectedEl.kind === "table"
                  ? "表格"
                  : selectedEl.kind === "chart"
                  ? "图表"
                  : "线条"}
              </span>

              {selectedEl.kind === "text" && (
                <>
                  <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-xl p-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomElement(selectedEl.id, {
                          font_size: Math.max(10, (selectedEl.font_size ?? 18) - 2),
                        })
                      }
                      title="减小字号"
                      className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-1.5 font-mono tabular-nums text-ink font-medium">
                      {Math.round(selectedEl.font_size ?? 18)}pt
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomElement(selectedEl.id, {
                          font_size: Math.min(72, (selectedEl.font_size ?? 18) + 2),
                        })
                      }
                      title="增大字号"
                      className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCustomElement(selectedEl.id, {
                        bold: !selectedEl.bold,
                      })
                    }
                    title="加粗"
                    className={`p-1.5 rounded-xl transition-colors cursor-pointer shrink-0 ${
                      selectedEl.bold
                        ? "bg-surface text-ink shadow-2xs ring-1 ring-black/10"
                        : "text-ink-secondary hover:bg-black/[0.05]"
                    }`}
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center bg-black/[0.05] rounded-xl p-0.5 gap-0.5 shrink-0">
                    {(["left", "center", "right"] as const).map((al) => {
                      const activeAl = (selectedEl.align ?? "left") === al;
                      const Icon =
                        al === "left"
                          ? AlignLeft
                          : al === "center"
                          ? AlignCenter
                          : AlignRight;
                      return (
                        <button
                          key={al}
                          type="button"
                          onClick={() =>
                            onUpdateCustomElement(selectedEl.id, { align: al })
                          }
                          title={
                            al === "left"
                              ? "左对齐"
                              : al === "center"
                              ? "居中对齐"
                              : "右对齐"
                          }
                          className={`p-1 rounded-lg transition-colors cursor-pointer ${
                            activeAl
                              ? "bg-surface text-ink shadow-2xs"
                              : "text-ink-secondary hover:text-ink"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {[
                      { token: "theme:title", label: "主标题色" },
                      { token: "theme:body", label: "正文色" },
                      { token: "theme:accent", label: "强调色" },
                      { token: "theme:muted", label: "次要色" },
                      { token: "theme:cover_title", label: "反白色" },
                    ].map((opt) => {
                      const hex = resolveCanvasColor(opt.token, sw, sw.body) || sw.body;
                      const activeCol = selectedEl.color === opt.token;
                      return (
                        <button
                          key={opt.token}
                          type="button"
                          onClick={() =>
                            onUpdateCustomElement(selectedEl.id, { color: opt.token })
                          }
                          title={opt.label}
                          className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                            activeCol
                              ? "ring-2 ring-ink ring-offset-1 scale-110"
                              : "ring-1 ring-black/20 hover:scale-110"
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => onFocusField(`custom-el-${selectedEl.id}`)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-black/[0.05] hover:bg-black/[0.1] text-ink font-medium cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>改文案</span>
                  </button>
                </>
              )}

              {selectedEl.kind === "card" && (
                <>
                  <div className="flex items-center gap-1 shrink-0">
                    {[
                      { token: "theme:surface", label: "卡片表面" },
                      { token: "theme:bg", label: "画布底色" },
                      { token: "theme:accent", label: "强调色填充" },
                      { token: "theme:cover_bg", label: "深色背景" },
                    ].map((opt) => {
                      const hex = resolveCanvasColor(opt.token, sw, sw.surface) || sw.surface;
                      const activeCol = (selectedEl.fill ?? "theme:surface") === opt.token;
                      return (
                        <button
                          key={opt.token}
                          type="button"
                          onClick={() =>
                            onUpdateCustomElement(selectedEl.id, { fill: opt.token })
                          }
                          title={opt.label}
                          className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                            activeCol
                              ? "ring-2 ring-ink ring-offset-1 scale-110"
                              : "ring-1 ring-black/20 hover:scale-110"
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-xl p-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomElement(selectedEl.id, {
                          radius: Math.max(0, (selectedEl.radius ?? 12) - 4),
                        })
                      }
                      title="减小圆角"
                      className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-1.5 font-mono text-ink">
                      R{Math.round(selectedEl.radius ?? 12)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomElement(selectedEl.id, {
                          radius: Math.min(48, (selectedEl.radius ?? 12) + 4),
                        })
                      }
                      title="增大圆角"
                      className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCustomElement(selectedEl.id, {
                        border_color: selectedEl.border_color ? null : "theme:divider",
                        border_width: selectedEl.border_color ? 0 : 1,
                      })
                    }
                    className={`px-2.5 py-1 rounded-xl font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                      selectedEl.border_color
                        ? "bg-surface text-ink ring-1 ring-black/10"
                        : "bg-black/[0.05] text-ink-secondary hover:text-ink"
                    }`}
                  >
                    边框
                  </button>
                </>
              )}

              {selectedEl.kind === "image" && (
                <>
                  <div className="flex items-center bg-black/[0.05] rounded-xl p-0.5 gap-0.5 shrink-0">
                    {(
                      [
                        { v: "cover", l: "填满裁切" },
                        { v: "contain", l: "完整适应" },
                      ] as const
                    ).map((opt) => {
                      const activeFit = (selectedEl.fit ?? "contain") === opt.v;
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() =>
                            onUpdateCustomElement(selectedEl.id, { fit: opt.v })
                          }
                          className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer whitespace-nowrap ${
                            activeFit
                              ? "bg-surface text-ink shadow-2xs"
                              : "text-ink-secondary hover:text-ink"
                          }`}
                        >
                          {opt.l}
                        </button>
                      );
                    })}
                  </div>
                  {imageAssets.length > 1 && (
                    <select
                      aria-label="切换配图"
                      value={selectedEl.image_asset_id || ""}
                      onChange={(e) =>
                        onUpdateCustomElement(selectedEl.id, {
                          image_asset_id: e.target.value,
                        })
                      }
                      className="bg-surface border border-black/15 rounded-xl px-2 py-1 text-[13px] text-ink outline-none cursor-pointer max-w-[160px]"
                    >
                      {imageAssets.map((img) => (
                        <option key={img.asset_id} value={img.asset_id}>
                          {img.asset_id}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}

              {selectedEl.kind === "table" && (
                <>
                  <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-xl p-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomElement(selectedEl.id, {
                          table_font_size: Math.max(10, (selectedEl.table_font_size ?? 14) - 1),
                        })
                      }
                      title="减小表内字号"
                      className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="px-1.5 font-mono text-ink">
                      {Math.round(selectedEl.table_font_size ?? 14)}pt
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCustomElement(selectedEl.id, {
                          table_font_size: Math.min(20, (selectedEl.table_font_size ?? 14) + 1),
                        })
                      }
                      title="增大表内字号"
                      className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const isAccent = selectedEl.header_fill === "theme:accent";
                      onUpdateCustomElement(selectedEl.id, {
                        header_fill: isAccent ? "theme:surface" : "theme:accent",
                        header_color: isAccent ? "theme:title" : "theme:cover_title",
                      });
                    }}
                    className="px-2.5 py-1 rounded-xl bg-black/[0.05] hover:bg-black/[0.1] text-ink font-medium cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {selectedEl.header_fill === "theme:accent" ? "浅色表头" : "强调表头"}
                  </button>
                </>
              )}

              {selectedEl.kind === "chart" && (
                <>
                  <div className="flex items-center bg-black/[0.05] rounded-xl p-0.5 gap-0.5 shrink-0">
                    {(
                      [
                        { v: "bar", l: "柱状" },
                        { v: "hbar", l: "条形" },
                        { v: "line", l: "折线" },
                        { v: "donut", l: "环形" },
                      ] as const
                    ).map((opt) => {
                      const activeCt = (selectedEl.chart_type ?? "bar") === opt.v;
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() =>
                            onUpdateCustomElement(selectedEl.id, {
                              chart_type: opt.v,
                            })
                          }
                          className={`px-2 py-1 rounded-lg font-medium cursor-pointer whitespace-nowrap ${
                            activeCt
                              ? "bg-surface text-ink shadow-2xs"
                              : "text-ink-secondary hover:text-ink"
                          }`}
                        >
                          {opt.l}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCustomElement(selectedEl.id, {
                        show_values: selectedEl.show_values === false,
                      })
                    }
                    className={`px-2.5 py-1 rounded-xl font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                      selectedEl.show_values !== false
                        ? "bg-surface text-ink ring-1 ring-black/10"
                        : "bg-black/[0.05] text-ink-secondary hover:text-ink"
                    }`}
                  >
                    数值标签
                  </button>
                </>
              )}

              {selectedEl.kind === "line" && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {[
                    { token: "theme:accent", label: "强调色" },
                    { token: "theme:divider", label: "分割线色" },
                    { token: "theme:title", label: "主标题色" },
                  ].map((opt) => {
                    const hex = resolveCanvasColor(opt.token, sw, sw.divider) || sw.divider;
                    const activeCol = (selectedEl.color ?? "theme:divider") === opt.token;
                    return (
                      <button
                        key={opt.token}
                        type="button"
                        onClick={() =>
                          onUpdateCustomElement(selectedEl.id, { color: opt.token })
                        }
                        title={opt.label}
                        className={`w-4 h-4 rounded-full cursor-pointer ${
                          activeCol
                            ? "ring-2 ring-ink ring-offset-1"
                            : "ring-1 ring-black/20"
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCustomElement(selectedEl.id, {
                        line_width: (selectedEl.line_width ?? 1.5) >= 2.5 ? 1.5 : 3,
                      })
                    }
                    className="px-2 py-1 rounded-xl bg-black/[0.05] hover:bg-black/[0.1] text-ink font-medium cursor-pointer whitespace-nowrap"
                  >
                    {(selectedEl.line_width ?? 1.5) >= 2.5 ? "细线" : "粗线"}
                  </button>
                </div>
              )}

              <div className="w-px h-5 bg-black/[0.08] shrink-0" />

              {onDeleteCustomElement && (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteCustomElement(selectedEl.id);
                    setSelectedElId(null);
                  }}
                  title="删除选中元素（支持 Ctrl+Z 撤销）"
                  className="p-1.5 rounded-xl text-ink-muted hover:text-danger hover:bg-danger-bg transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedElId(null)}
                title="完成选中 (Esc)"
                className="p-1.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <>
              {themePopoverOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setThemePopoverOpen(false)}
              />
              <div className="absolute bottom-full left-0 mb-2.5 w-[348px] apple-glass dock-shadow rounded-2xl p-3 z-50 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5">
                    <button
                      type="button"
                      onClick={() => setThemeTab("themes")}
                      className={`px-3 py-1 rounded-[9px] text-[13px] cursor-pointer transition-all ${
                        themeTab === "themes"
                          ? "bg-surface text-ink font-semibold shadow-2xs"
                          : "text-ink-secondary hover:text-ink font-medium"
                      }`}
                    >
                      预设主题
                    </button>
                    {onUpdateBrand && (
                      <button
                        type="button"
                        onClick={() => setThemeTab("brand")}
                        className={`px-3 py-1 rounded-[9px] text-[13px] cursor-pointer transition-all ${
                          themeTab === "brand"
                            ? "bg-surface text-ink font-semibold shadow-2xs"
                            : "text-ink-secondary hover:text-ink font-medium"
                        }`}
                      >
                        品牌定制
                      </button>
                    )}
                  </div>
                </div>

                {themeTab === "brand" && onUpdateBrand ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setSavingBrand(true);
                      try {
                        await onUpdateBrand({
                          accent_hex: brandDraft.accent_hex || null,
                          bg_hex: brandDraft.bg_hex || null,
                          footer_text: brandDraft.footer_text || null,
                          logo_asset_id: brandDraft.logo_asset_id || null,
                          logo_position: brandDraft.logo_position || "top_right",
                        });
                        setThemePopoverOpen(false);
                      } finally {
                        setSavingBrand(false);
                      }
                    }}
                    className="space-y-3 text-[13px]"
                  >
                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="space-y-1 block">
                        <span className="text-ink-secondary font-medium">品牌强调色</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={brandDraft.accent_hex || sw.accent}
                            onChange={(e) =>
                              setBrandDraft((d) => ({ ...d, accent_hex: e.target.value }))
                            }
                            className="w-8 h-8 rounded-lg border border-black/15 cursor-pointer bg-surface p-0.5"
                          />
                          <input
                            type="text"
                            value={brandDraft.accent_hex || ""}
                            onChange={(e) =>
                              setBrandDraft((d) => ({ ...d, accent_hex: e.target.value }))
                            }
                            placeholder={sw.accent}
                            className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-surface border border-black/15 font-mono text-[13px] text-ink outline-none"
                          />
                        </div>
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-ink-secondary font-medium">画布底色</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={brandDraft.bg_hex || sw.bg}
                            onChange={(e) =>
                              setBrandDraft((d) => ({ ...d, bg_hex: e.target.value }))
                            }
                            className="w-8 h-8 rounded-lg border border-black/15 cursor-pointer bg-surface p-0.5"
                          />
                          <input
                            type="text"
                            value={brandDraft.bg_hex || ""}
                            onChange={(e) =>
                              setBrandDraft((d) => ({ ...d, bg_hex: e.target.value }))
                            }
                            placeholder={sw.bg}
                            className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-surface border border-black/15 font-mono text-[13px] text-ink outline-none"
                          />
                        </div>
                      </label>
                    </div>

                    <label className="space-y-1 block">
                      <span className="text-ink-secondary font-medium">统一页脚文案（非封面页）</span>
                      <input
                        type="text"
                        value={brandDraft.footer_text || ""}
                        onChange={(e) =>
                          setBrandDraft((d) => ({ ...d, footer_text: e.target.value }))
                        }
                        placeholder="例如：2026 内部汇报 · 机密"
                        className="w-full h-8 px-2.5 rounded-lg bg-surface border border-black/15 text-[13px] text-ink outline-none"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 block">
                        <span className="text-ink-secondary font-medium">角落 Logo</span>
                        <select
                          value={brandDraft.logo_asset_id || ""}
                          onChange={(e) =>
                            setBrandDraft((d) => ({ ...d, logo_asset_id: e.target.value }))
                          }
                          className="w-full h-8 px-2 rounded-lg bg-surface border border-black/15 text-[13px] text-ink outline-none"
                        >
                          <option value="">不使用 Logo</option>
                          {imageAssets.map((img) => (
                            <option key={img.asset_id} value={img.asset_id}>
                              {img.asset_id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-ink-secondary font-medium">Logo 位置</span>
                        <select
                          value={brandDraft.logo_position || "top_right"}
                          onChange={(e) =>
                            setBrandDraft((d) => ({
                              ...d,
                              logo_position: e.target.value as "top_right" | "bottom_left",
                            }))
                          }
                          className="w-full h-8 px-2 rounded-lg bg-surface border border-black/15 text-[13px] text-ink outline-none"
                        >
                          <option value="top_right">右上角</option>
                          <option value="bottom_left">左下角</option>
                        </select>
                      </label>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        disabled={savingBrand}
                        onClick={async () => {
                          setSavingBrand(true);
                          try {
                            await onUpdateBrand({
                              accent_hex: null,
                              bg_hex: null,
                              footer_text: null,
                              logo_asset_id: null,
                              logo_position: "top_right",
                            });
                            setThemePopoverOpen(false);
                          } finally {
                            setSavingBrand(false);
                          }
                        }}
                        className="text-[13px] text-ink-secondary hover:text-ink cursor-pointer"
                      >
                        恢复主题默认
                      </button>
                      <button
                        type="submit"
                        disabled={savingBrand}
                        className="ui-btn-primary px-4 h-8 text-[13px]"
                      >
                        {savingBrand ? "保存中…" : "应用品牌"}
                      </button>
                    </div>
                  </form>
                ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {themes.map((th) => {
                    const active = th.id === selectedThemeId;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => {
                          onSelectTheme(th.id);
                          setThemePopoverOpen(false);
                        }}
                        className={`text-left p-2 rounded-xl transition-all cursor-pointer ${
                          active
                            ? "ring-2 ring-ink bg-black/[0.04]"
                            : "ring-1 ring-black/[0.08] bg-surface hover:bg-canvas"
                        }`}
                      >
                        <div
                          className="aspect-[16/9] rounded-[4px] overflow-hidden mb-1.5 p-2.5 flex flex-col justify-between border border-black/[0.08]"
                          style={{ backgroundColor: th.swatches.cover_bg }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="w-3.5 h-[2px] rounded-full"
                              style={{ backgroundColor: th.swatches.accent }}
                            />
                            <span
                              className="w-5 h-1 rounded-full opacity-35"
                              style={{ backgroundColor: th.swatches.cover_body }}
                            />
                          </div>
                          <div className="space-y-1">
                            <div
                              className="w-11 h-1.5 rounded-full opacity-90"
                              style={{ backgroundColor: th.swatches.cover_title }}
                            />
                            <div
                              className="w-7 h-1 rounded-full opacity-45"
                              style={{ backgroundColor: th.swatches.cover_body }}
                            />
                          </div>
                        </div>
                        <div className="text-[13px] font-semibold text-ink">
                          {th.name}
                        </div>
                        <div className="text-[13px] text-ink-muted truncate">
                          {th.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
            </>
          )}

          <div className="apple-glass dock-shadow rounded-2xl px-2 py-1.5 flex items-center gap-1.5 flex-nowrap">
            {/* Theme Trigger */}
            <button
              type="button"
              onClick={() => setThemePopoverOpen(!themePopoverOpen)}
              title={`切换主题：当前「${activeTheme.name}」`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span
                className="w-4 h-4 rounded-full ring-1 ring-black/15 shrink-0"
                style={{
                  background: `radial-gradient(circle at 35% 35%, ${sw.bg} 45%, ${sw.cover_bg} 100%)`,
                }}
              />
              {!compactDock && (
                <span className="text-[13px] font-medium text-ink">
                  {activeTheme.name}
                </span>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-ink-muted shrink-0" />
            </button>

            <div className="w-px h-5 bg-black/[0.08] shrink-0" />

            {/* Segmented Layout Control — crisp white sliding pill on gray track (Item 4) */}
            <div className="flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5 flex-nowrap shrink-0">
              {LAYOUT_OPTIONS.map((opt) => {
                const active = !isCustomCanvas && layout === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onSelectLayout(opt.value)}
                    title={
                      isCustomCanvas
                        ? `切换回「${opt.label}」标准版式`
                        : opt.label
                    }
                    className={`px-2.5 py-1 rounded-[9px] text-[13px] flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                        : "text-ink-secondary hover:text-ink font-medium"
                    }`}
                  >
                    <LayoutIcon layout={opt.value} />
                    {!compactDock && <span>{opt.label}</span>}
                  </button>
                );
              })}
            </div>

            <div className="w-px h-5 bg-black/[0.08] shrink-0" />

            {/* Explicit Auto-Fit Pill Toggle Switch with Clear Tooltip (Item 10) */}
            <button
              type="button"
              role="switch"
              aria-checked={autoFit}
              onClick={onToggleAutoFit}
              title="文字过多时自动缩小，防止超出版面"
              className="px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] text-[13px] font-medium text-ink flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <span
                className={`w-8 h-[18px] rounded-full p-[2px] flex items-center transition-colors shrink-0 ${
                  autoFit ? "bg-ink/75" : "bg-black/20"
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 rounded-full bg-surface shadow-xs transition-transform ${
                    autoFit ? "translate-x-[14px]" : "translate-x-0"
                  }`}
                />
              </span>
              {!compactDock && <span>自动缩字</span>}
            </button>
          </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
