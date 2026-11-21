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

function LayoutIcon({ layout }: { layout: OutlineLayout }) {
  switch (layout) {
    case "cover":
      return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="4" y1="7" x2="11" y2="7" />
          <line x1="4" y1="9.5" x2="8.5" y2="9.5" />
        </svg>
      );
    case "bullets":
      return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <circle cx="4.2" cy="6.2" r="0.7" fill="currentColor" />
          <line x1="6.2" y1="6.2" x2="12" y2="6.2" />
          <circle cx="4.2" cy="9.8" r="0.7" fill="currentColor" />
          <line x1="6.2" y1="9.8" x2="11" y2="9.8" />
        </svg>
      );
    case "two_column":
      return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="8" y1="5.2" x2="8" y2="11.5" />
          <line x1="3.8" y1="6.5" x2="6.4" y2="6.5" />
          <line x1="9.6" y1="6.5" x2="12.2" y2="6.5" />
        </svg>
      );
    case "text_image":
      return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="3.8" y1="6.5" x2="7.2" y2="6.5" />
          <line x1="3.8" y1="9" x2="6.8" y2="9" />
          <rect x="8.8" y="5.5" width="3.7" height="5" rx="0.8" />
        </svg>
      );
    case "closing":
      return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="5" y1="5.8" x2="11" y2="5.8" />
          <line x1="4" y1="9.5" x2="12" y2="9.5" />
        </svg>
      );
    default:
      return (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35">
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <line x1="4" y1="5.5" x2="9.5" y2="5.5" />
          <line x1="4" y1="8.5" x2="12" y2="8.5" />
          <line x1="4" y1="10.8" x2="10.5" y2="10.8" />
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
        setCompactDock(colRef.current.clientWidth < 600);
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
    <main className="flex-1 bg-[#ececef] flex flex-col items-center justify-center px-5 lg:px-8 py-5 min-w-0 overflow-hidden h-full">
      <div
        ref={colRef}
        className="w-full max-w-[920px] flex flex-col items-center gap-4"
      >
        {/* Clean 1-line Quiet Status Above Stage */}
        <div className="w-full flex items-center justify-between px-1 text-[12.5px] gap-4">
          <div className="flex items-center gap-2 min-w-0">
            {isGenerating ? (
              <span className="inline-flex items-center gap-2 text-[#0071e3] font-medium truncate">
                <span className="w-2 h-2 rounded-full bg-[#0071e3] animate-pulse shrink-0" />
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
                className="inline-flex items-center gap-2 text-[#d70015] hover:underline font-medium cursor-pointer truncate"
              >
                <span className="w-2 h-2 rounded-full bg-[#ff3b30] shrink-0" />
                <span className="truncate">
                  {firstIssueSlide !== undefined
                    ? `第 ${firstIssueSlide + 1} 页存在排版溢出或校验异常 · 点击定位 ›`
                    : "最近一次排版校验未通过"}
                </span>
              </button>
            ) : showRenderedImage ? (
              <span className="inline-flex items-center gap-2 text-[#248a3d] whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-[#34c759] shrink-0" />
                <span>已与 PPTX 同步</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-[#6e6e73] whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-[#34c759] shrink-0" />
                <span>排版安全</span>
              </span>
            )}
          </div>

          <span className="text-[#86868b] tabular-nums whitespace-nowrap shrink-0">
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
                  <div
                    onClick={() => onFocusField("input-title")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 190,
                      width: 864,
                      fontSize: 40,
                      lineHeight: "48px",
                      fontWeight: 700,
                      letterSpacing: "-0.025em",
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
                      top: 300,
                      width: 820,
                      fontSize: 18,
                      lineHeight: "28px",
                      whiteSpace: "pre-wrap",
                      color: bodyCol,
                      textAlign: "left",
                    }}
                  >
                    {item.summary}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 464,
                      width: 48,
                      height: 3,
                      borderRadius: 99,
                      backgroundColor: sw.accent,
                    }}
                  />
                </>
              ) : layout === "closing" ? (
                <>
                  <div
                    onClick={() => onFocusField("input-title")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 34,
                      width: 864,
                      fontSize: 28,
                      lineHeight: "36px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: titleCol,
                      textAlign: "center",
                    }}
                  >
                    {item.title || "谢谢聆听"}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 456,
                      top: 108,
                      width: 48,
                      height: 2.5,
                      borderRadius: 99,
                      backgroundColor: sw.accent,
                    }}
                  />
                  <div
                    onClick={() => onFocusField("input-summary")}
                    className="clickable-slot"
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 180,
                      width: 864,
                      fontSize: 19,
                      lineHeight: "30px",
                      whiteSpace: "pre-wrap",
                      color: bodyCol,
                      textAlign: "center",
                    }}
                  >
                    {item.summary}
                  </div>
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
                      top: 30,
                      width: 864,
                      fontSize: 26,
                      lineHeight: "34px",
                      fontWeight: 700,
                      letterSpacing: "-0.02em",
                      color: titleCol,
                    }}
                  >
                    {item.title || "未命名标题"}
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: 48,
                      top: 106,
                      width: 864,
                      height: 1,
                      backgroundColor: sw.divider,
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
                        gap: 12,
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
                              fontSize: 18,
                              lineHeight: "26px",
                              color: bodyCol,
                            }}
                          >
                            <span
                              style={{
                                marginTop: 10,
                                width: 6,
                                height: 6,
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
                          left: 480,
                          top: 128,
                          width: 1,
                          height: 344,
                          backgroundColor: sw.divider,
                        }}
                      />
                      <div
                        onClick={() => onFocusField("input-summary")}
                        className="clickable-slot"
                        style={{
                          position: "absolute",
                          left: 48,
                          top: 124,
                          width: 412,
                          fontSize: 18,
                          lineHeight: "26px",
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
                          top: 124,
                          width: 412,
                          fontSize: 18,
                          lineHeight: "26px",
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
                          top: 124,
                          width: 440,
                          fontSize: 18,
                          lineHeight: "26px",
                          whiteSpace: "pre-wrap",
                          color: bodyCol,
                        }}
                      >
                        {item.summary}
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          left: 512,
                          top: 124,
                          width: 400,
                          height: 356,
                          borderRadius: 12,
                          border: `1px solid ${sw.divider}`,
                          backgroundColor: sw.surface,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          padding: 12,
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
                              maxWidth: "100%",
                              maxHeight: "100%",
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
                        top: 124,
                        width: 864,
                        fontSize: 18,
                        lineHeight: "28px",
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
                <div className="text-[12px] font-semibold text-[#6e6e73] px-1 pb-2.5">
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
                            ? "ring-2 ring-[#0071e3] bg-[#0071e3]/[0.06]"
                            : "ring-1 ring-black/[0.08] bg-white hover:bg-[#f5f5f7]"
                        }`}
                      >
                        <div
                          className="aspect-[16/9] rounded-lg overflow-hidden mb-1.5 p-2.5 flex flex-col justify-between border border-black/[0.08]"
                          style={{ backgroundColor: th.swatches.cover_bg }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
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
                        <div className="text-[11px] text-[#86868b] truncate">
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
              <ChevronDown className="w-3 h-3 text-[#86868b] shrink-0" />
            </button>

            <div className="w-px h-5 bg-black/[0.08] shrink-0" />

            {/* Segmented Layout Control with Wireframe Mini-Icons */}
            <div className="flex items-center bg-black/[0.045] p-[3px] rounded-xl gap-0.5 flex-nowrap shrink-0">
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
                        ? "bg-white text-[#1d1d1f] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                        : "text-[#6e6e73] hover:text-[#1d1d1f] font-medium"
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
                  ? "自动缩字已开启（正文轻度超框时自动按 18→16→14pt 退让）"
                  : "自动缩字已关闭（严格按 18pt 测量）"
              }
              className="px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] text-[12.5px] font-medium text-[#1d1d1f] flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  autoFit ? "bg-[#34c759]" : "bg-[#c7c7cc]"
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
