"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon } from "lucide-react";
import type {
  ExportReport,
  Issue,
  Outline,
  OutlineLayout,
  Preview,
  Project,
  ThemeOption,
} from "../../lib/api";
import { inferEffectiveLayout, LAYOUT_OPTIONS } from "./layoutUtils";

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
  onSelectIndex: (idx: number) => void;
  onSelectTheme: (themeId: string) => void;
  onSelectLayout: (layout: OutlineLayout) => void;
  onToggleAutoFit: () => void;
  onFocusField: (fieldId: string) => void;
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
  onSelectIndex,
  onSelectTheme,
  onSelectLayout,
  onToggleAutoFit,
  onFocusField,
}: SlideStageCanvasProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.75);
  const [compactDock, setCompactDock] = useState(false);
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      if (shellRef.current) {
        const w = shellRef.current.clientWidth;
        if (w > 0) setScale(w / 960);
      }
      if (colRef.current) {
        setCompactDock(colRef.current.clientWidth < 640);
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
  const layout = item
    ? inferEffectiveLayout(item.layout, selectedIndex, total)
    : "content";
  const sw = activeTheme.swatches;
  const isHero = layout === "cover" || layout === "closing";
  const slideBg = isHero ? sw.cover_bg : sw.bg;
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;

  // Automatically display real LibreOffice PNG only when exported & strictly in sync;
  // any edit or theme switch seamlessly flips to the 960x540 live canvas!
  const hasRenderedPage = Boolean(preview?.pages && preview.pages[selectedIndex]);
  const settingsInSync =
    Boolean(project?.latest_template_id) &&
    project?.latest_template_id === selectedThemeId &&
    Boolean(project?.latest_auto_fit) === autoFit;
  const showRenderedImage =
    !isStale &&
    settingsInSync &&
    Boolean(version) &&
    version === project?.generated_outline_version &&
    hasRenderedPage;

  const firstIssueSlide = Array.from(issueSlideIndices).sort((a, b) => a - b)[0];
  const hasLayoutIssues =
    issues.length > 0 || Boolean(report && !report.success);

  return (
    <main className="flex-1 bg-[#dcdce1] flex flex-col items-center justify-center px-5 lg:px-8 py-5 min-w-0 min-h-0 overflow-y-auto clean-scroll">
      <div
        ref={colRef}
        className="w-full max-w-[min(920px,max(360px,calc((100vh-196px)*16/9)))] flex flex-col items-center gap-4 my-auto"
      >
        {/* Clean 1-line Quiet Status Above Stage */}
        <div className="w-full flex items-center justify-between px-1 text-[12.5px] gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {isGenerating ? (
              <span className="inline-flex items-center gap-2 text-[#1d1d1f] font-medium truncate">
                <span className="w-2 h-2 rounded-full bg-[#1d1d1f] animate-pulse shrink-0" />
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
                className="inline-flex items-center gap-2 text-[#c02620] hover:underline font-medium cursor-pointer truncate"
              >
                <span className="w-2 h-2 rounded-full bg-[#d70015] shrink-0" />
                <span className="truncate">
                  {firstIssueSlide !== undefined
                    ? `第 ${firstIssueSlide + 1} 页存在排版溢出或校验异常 · 点击定位 ›`
                    : "最近一次排版校验未通过"}
                </span>
              </button>
            ) : showRenderedImage ? (
              <span className="inline-flex items-center gap-2 text-[#27272a] font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-[#248a3d] shrink-0" />
                <span>已与 PPTX 同步</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-[#52525b] whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-[#248a3d] shrink-0" />
                <span>排版安全</span>
              </span>
            )}
          </div>

          <span className="text-[#52525b] font-medium tabular-nums whitespace-nowrap shrink-0">
            {selectedIndex + 1} / {total}
          </span>
        </div>

        {/* True 960x540 Proportional Scaled 16:9 Stage */}
        <div
          ref={shellRef}
          className="aspect-[16/9] w-full rounded-[14px] overflow-hidden slide-shadow relative bg-white"
        >
          {showRenderedImage && preview?.pages[selectedIndex] ? (
            <div
              onClick={() => onFocusField("input-title")}
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
                    {item.summary}
                  </div>
                  {/* Anchoring bottom hairline */}
                  <div
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 458,
                      width: 864,
                      height: 1,
                      backgroundColor: sw.divider,
                    }}
                  />
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
                    {item.summary}
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
                      {item.summary
                        .split("\n")
                        .map((s) => s.trim())
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
                        {item.summary}
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
                        {item.column_right || "（请在右侧填写右栏内容）"}
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
                        {item.summary}
                      </div>
                      {/* Expanded 456x372 image visual stage */}
                      <div
                        style={{
                          position: "absolute",
                          left: 456,
                          top: 120,
                          width: 456,
                          height: 372,
                          borderTop: `1px solid ${sw.divider}`,
                          borderBottom: `1px solid ${sw.divider}`,
                          backgroundColor: sw.surface,
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
                      {item.summary}
                    </div>
                  )}
                </>
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

        {/* Always-Single-Line Adaptive Floating Glass Dock */}
        <div className="relative max-w-full">
          {themePopoverOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setThemePopoverOpen(false)}
              />
              <div className="absolute bottom-full left-0 mb-2.5 w-[312px] apple-glass dock-shadow rounded-2xl p-3 z-50">
                <div className="text-[12px] font-semibold text-[#52525b] px-1 pb-2.5">
                  选择演示主题
                </div>
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
                            ? "ring-2 ring-[#1d1d1f] bg-black/[0.04]"
                            : "ring-1 ring-black/[0.08] bg-white hover:bg-[#f5f5f7]"
                        }`}
                      >
                        <div
                          className="aspect-[16/9] rounded-lg overflow-hidden mb-1.5 p-2.5 flex flex-col justify-between border border-black/[0.08]"
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
                        <div className="text-[12.5px] font-semibold text-[#1d1d1f]">
                          {th.name}
                        </div>
                        <div className="text-[11px] text-[#71717a] truncate">
                          {th.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
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
                <span className="text-[12.5px] font-medium text-[#1d1d1f]">
                  {activeTheme.name}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-[#71717a] shrink-0" />
            </button>

            <div className="w-px h-5 bg-black/[0.08] shrink-0" />

            {/* Segmented Layout Control with Distinct 16:9 Miniature Diagrams */}
            <div className="flex items-center bg-black/[0.05] p-[3px] rounded-xl gap-0.5 flex-nowrap shrink-0">
              {LAYOUT_OPTIONS.map((opt) => {
                const active = layout === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onSelectLayout(opt.value)}
                    title={opt.label}
                    className={`px-2.5 py-1 rounded-[9px] text-[12px] flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? "bg-[#1d1d1f] text-white font-medium shadow-[0_1px_3px_rgba(0,0,0,0.16)]"
                        : "text-[#52525b] hover:text-[#1d1d1f] font-medium"
                    }`}
                  >
                    <LayoutIcon layout={opt.value} />
                    {!compactDock && <span>{opt.label}</span>}
                  </button>
                );
              })}
            </div>

            <div className="w-px h-5 bg-black/[0.08] shrink-0" />

            {/* Auto-Fit Toggle */}
            <button
              type="button"
              onClick={onToggleAutoFit}
              title={
                autoFit
                  ? "自动缩字已开启（正文轻度超框时自动按 20→18→16→14pt 退让）"
                  : "自动缩字已关闭（严格按固定字号测量）"
              }
              className="px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] text-[12.5px] font-medium text-[#1d1d1f] flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  autoFit ? "bg-[#1d1d1f]" : "bg-[#a1a1aa]"
                }`}
              />
              {!compactDock && <span>{autoFit ? "自动缩字" : "固定字号"}</span>}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
