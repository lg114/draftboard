"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Layers,
  Maximize2,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type {
  ExportReport,
  Issue,
  Outline,
  Preview,
  Project,
  SourceFragment,
  ThemeOption,
} from "../../lib/api";
import {
  inferEffectiveLayout,
  OUTLINE_LAYOUT_LABELS,
} from "./OutlineEditor";

interface SlidePreviewPanelProps {
  pid: string;
  project: Project | null;
  outline: Outline | null;
  version: string;
  isStale: boolean;
  selectedIndex: number;
  preview: Preview | null;
  report: ExportReport | null;
  issues: Issue[];
  sourceFragments: SourceFragment[];
  activeTheme: ThemeOption | null;
  selectedThemeId: string;
  autoFit: boolean;
  renderingPreview: boolean;
  onSelectIndex: (idx: number) => void;
  onRenderPreviewsNow: () => void;
}

export function SlidePreviewPanel({
  pid,
  project,
  outline,
  version,
  isStale,
  selectedIndex,
  preview,
  report,
  issues,
  sourceFragments,
  activeTheme,
  selectedThemeId,
  autoFit,
  renderingPreview,
  onSelectIndex,
  onRenderPreviewsNow,
}: SlidePreviewPanelProps) {
  const [showQADetails, setShowQADetails] = useState(false);
  const [preferDraftMode, setPreferDraftMode] = useState<boolean | null>(null);

  const currentItem = outline?.items[selectedIndex];
  const totalSlides = outline?.items.length ?? 0;

  const hasRenderedPage = Boolean(preview?.pages && preview.pages[selectedIndex]);
  const settingsMatch =
    !project?.latest_template_id ||
    (project.latest_template_id === selectedThemeId &&
      Boolean(project.latest_auto_fit) === autoFit);
  const previewMatchesCurrentOutline =
    !isStale &&
    settingsMatch &&
    Boolean(version) &&
    version === project?.generated_outline_version &&
    hasRenderedPage;

  const showRenderedImage =
    hasRenderedPage &&
    (preferDraftMode === null ? previewMatchesCurrentOutline : !preferDraftMode);

  const effectiveLayout = currentItem
    ? inferEffectiveLayout(currentItem.layout, selectedIndex, totalSlides)
    : "content";

  const isHero = effectiveLayout === "cover" || effectiveLayout === "closing";
  const swatches = activeTheme?.swatches || {
    bg: "#FFFFFF",
    cover_bg: "#FFFFFF",
    title: "#111827",
    cover_title: "#111827",
    body: "#4B5563",
    cover_body: "#4B5563",
    accent: "#2563EB",
    muted: "#9CA3AF",
  };
  const slideBg = isHero ? swatches.cover_bg : swatches.bg;
  const slideTitleColor = isHero ? swatches.cover_title : swatches.title;
  const slideBodyColor = isHero ? swatches.cover_body : swatches.body;

  const matchedFragments = currentItem
    ? currentItem.source_ids
        .map((sid) => sourceFragments.find((f) => f.source_id === sid))
        .filter((f): f is SourceFragment => Boolean(f))
    : [];

  return (
    <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-16 transition-all duration-200">
      <div className="bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-bento space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6] gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                outline ? "bg-[#10b981]" : "bg-[#d1d5db]"
              }`}
            />
            <span className="font-bold text-sm text-[#111827] tracking-tight">
              预览
            </span>
            <span className="text-[11px] px-2 py-0.5 bg-[#f3f4f6] text-[#4b5563] border border-[#e5e7eb] rounded-lg font-mono truncate">
              {totalSlides > 0
                ? `第 ${selectedIndex + 1} / ${totalSlides} 页`
                : "待排版"}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasRenderedPage && (
              <div className="inline-flex rounded-lg border border-[#e5e7eb] bg-[#f8f9fa] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setPreferDraftMode(false)}
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    showRenderedImage
                      ? "bg-white text-[#111827] font-semibold shadow-2xs"
                      : "text-[#6b7280] hover:text-[#111827]"
                  }`}
                >
                  真实渲染
                </button>
                <button
                  type="button"
                  onClick={() => setPreferDraftMode(true)}
                  className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                    !showRenderedImage
                      ? "bg-white text-[#111827] font-semibold shadow-2xs"
                      : "text-[#6b7280] hover:text-[#111827]"
                  }`}
                >
                  实时草稿
                </button>
              </div>
            )}

            {totalSlides > 0 && project?.download_available && (
              <Link
                href={`/p/${pid}/preview`}
                className="text-xs text-[#6b7280] hover:text-[#111827] flex items-center gap-1 transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>全屏</span>
              </Link>
            )}
          </div>
        </div>

        {/* 16:9 Canvas */}
        {outline && totalSlides > 0 ? (
          <div
            className="relative aspect-[16/9] w-full rounded-xl border border-[#e5e7eb] overflow-hidden shadow-2xs flex flex-col justify-between"
            style={{ backgroundColor: showRenderedImage ? "#FFFFFF" : slideBg }}
          >
            {showRenderedImage && preview?.pages[selectedIndex] ? (
              <div className="absolute inset-0 z-10 bg-white flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.pages[selectedIndex]}
                  alt={`第 ${selectedIndex + 1} 页`}
                  className="w-full h-full object-contain select-none"
                />
                {!previewMatchesCurrentOutline && (
                  <span className="absolute top-2.5 right-2.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#fef3c7]/95 text-[#b45309] border border-[#fde68a] shadow-2xs">
                    旧版本渲染图 · 重新生成后更新
                  </span>
                )}
              </div>
            ) : currentItem ? (
              <div className="relative p-5 flex flex-col justify-between h-full">
                {/* Top Theme Accent Stripe */}
                {selectedThemeId !== "default" && (
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: swatches.accent }}
                  />
                )}

                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span
                    className="font-semibold uppercase tracking-wider"
                    style={{ color: swatches.accent }}
                  >
                    {OUTLINE_LAYOUT_LABELS[effectiveLayout] || effectiveLayout}
                  </span>
                  <span style={{ color: swatches.muted }}>
                    {activeTheme?.name || "实时草稿"}
                  </span>
                </div>

                {isHero ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center px-4 space-y-2 overflow-hidden">
                    {selectedThemeId !== "default" && (
                      <div
                        className="w-10 h-0.5 rounded-full mb-1"
                        style={{ backgroundColor: swatches.accent }}
                      />
                    )}
                    <h3
                      className="text-base sm:text-lg font-bold leading-snug line-clamp-2"
                      style={{ color: slideTitleColor }}
                    >
                      {currentItem.title || "未命名标题"}
                    </h3>
                    <p
                      className="text-xs line-clamp-3 leading-relaxed whitespace-pre-wrap max-w-[85%]"
                      style={{ color: slideBodyColor }}
                    >
                      {currentItem.summary}
                    </p>
                  </div>
                ) : effectiveLayout === "two_column" ? (
                  <div className="flex-1 py-2 overflow-hidden flex flex-col space-y-2">
                    <h3
                      className="text-sm font-bold leading-snug line-clamp-1 pb-1.5 border-b"
                      style={{
                        color: slideTitleColor,
                        borderColor: `${swatches.muted}40`,
                      }}
                    >
                      {currentItem.title || "未命名标题"}
                    </h3>
                    <div className="grid grid-cols-2 gap-3 flex-1 overflow-hidden">
                      <p
                        className="text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-5 pr-2 border-r"
                        style={{
                          color: slideBodyColor,
                          borderColor: `${swatches.muted}40`,
                        }}
                      >
                        {currentItem.summary}
                      </p>
                      <p
                        className="text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-5"
                        style={{ color: slideBodyColor }}
                      >
                        {currentItem.column_right || "（待填写右栏内容）"}
                      </p>
                    </div>
                  </div>
                ) : effectiveLayout === "text_image" ? (
                  <div className="flex-1 py-2 overflow-hidden flex flex-col space-y-2">
                    <h3
                      className="text-sm font-bold leading-snug line-clamp-1 pb-1.5 border-b"
                      style={{
                        color: slideTitleColor,
                        borderColor: `${swatches.muted}40`,
                      }}
                    >
                      {currentItem.title || "未命名标题"}
                    </h3>
                    <div className="grid grid-cols-12 gap-3 flex-1 overflow-hidden items-center">
                      <p
                        className="col-span-7 text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-5"
                        style={{ color: slideBodyColor }}
                      >
                        {currentItem.summary}
                      </p>
                      <div className="col-span-5 h-full max-h-32 rounded-lg border border-black/10 bg-white/70 flex items-center justify-center overflow-hidden p-1">
                        {currentItem.image_asset_id ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={`/api/projects/${pid}/assets/${encodeURIComponent(
                              currentItem.image_asset_id
                            )}`}
                            alt={currentItem.image_asset_id}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-[10px] text-[#9ca3af]">
                            <ImageIcon className="w-4 h-4" />
                            <span>未选配图</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : effectiveLayout === "bullets" ? (
                  <div className="flex-1 py-2 overflow-hidden space-y-2">
                    <h3
                      className="text-sm font-bold leading-snug line-clamp-1 pb-1.5 border-b"
                      style={{
                        color: slideTitleColor,
                        borderColor: `${swatches.muted}40`,
                      }}
                    >
                      {currentItem.title || "未命名标题"}
                    </h3>
                    <ul
                      className="space-y-1 text-xs pl-4 list-disc"
                      style={{ color: slideBodyColor }}
                    >
                      {currentItem.summary
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .slice(0, 6)
                        .map((line, i) => (
                          <li key={i} className="leading-relaxed line-clamp-1">
                            {line}
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : (
                  <div className="flex-1 py-2 overflow-hidden space-y-2">
                    <h3
                      className="text-sm font-bold leading-snug line-clamp-2 pb-1.5 border-b"
                      style={{
                        color: slideTitleColor,
                        borderColor: `${swatches.muted}40`,
                      }}
                    >
                      {currentItem.title || "未命名标题"}
                    </h3>
                    <p
                      className="text-xs line-clamp-5 leading-relaxed whitespace-pre-wrap"
                      style={{ color: slideBodyColor }}
                    >
                      {currentItem.summary}
                    </p>
                  </div>
                )}

                <div
                  className="flex items-center justify-between text-[10px] font-mono pt-1"
                  style={{ color: swatches.muted }}
                >
                  <span>16:9 确定性母版草稿</span>
                  <span>
                    {selectedIndex + 1} / {totalSlides}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="aspect-[16/9] w-full rounded-xl border-2 border-dashed border-[#eaecf0] bg-[#f9fafb] flex flex-col items-center justify-center p-6 text-center space-y-2">
            <div className="w-10 h-10 rounded-xl bg-white shadow-2xs border border-[#eaecf0] flex items-center justify-center text-[#9ca3af]">
              <Layers className="w-5 h-5 text-[#6b7280]" />
            </div>
            <div className="text-xs font-semibold text-[#111827]">
              暂无排版预览
            </div>
            <p className="text-[11px] text-[#6b7280] leading-relaxed max-w-[220px]">
              完成大纲提炼后，将在此呈现 16:9 实时排版预览。
            </p>
          </div>
        )}

        {/* Speaker Notes Preview Strip */}
        {currentItem?.speaker_notes && (
          <div className="px-3 py-2 rounded-xl bg-[#eef2ff]/60 border border-[#c7d2fe]/70 text-xs space-y-1">
            <div className="text-[10px] font-semibold text-[#4f46e5] flex items-center gap-1">
              <MessageSquareText className="w-3 h-3" />
              <span>本页演讲者备注</span>
            </div>
            <p className="text-[#374151] text-xs leading-relaxed whitespace-pre-wrap">
              {currentItem.speaker_notes}
            </p>
          </div>
        )}

        {/* Slide Navigation Strip */}
        {outline && totalSlides > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {outline.items.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onSelectIndex(i)}
                className={`px-3 py-1 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer shrink-0 ${
                  i === selectedIndex
                    ? "bg-[#4f46e5] text-white shadow-2xs font-semibold"
                    : "bg-[#f3f4f6] text-[#4b5563] hover:bg-[#e5e7eb] hover:text-[#111827]"
                }`}
              >
                #{i + 1}
              </button>
            ))}
          </div>
        )}

        {/* LibreOffice Re-render Trigger */}
        {project?.download_available && (
          <div className="pt-2 border-t border-[#f3f4f6] flex items-center justify-between text-xs gap-2">
            <span className="text-xs text-[#6b7280]">
              {preview
                ? "已同步 LibreOffice 真机排版渲染图"
                : "可调用 LibreOffice 生成逐页真机排版图"}
            </span>
            <button
              type="button"
              onClick={onRenderPreviewsNow}
              disabled={renderingPreview}
              className="px-3 py-1.5 bg-white hover:bg-[#f9fafb] border border-[#eaecf0] text-[#374151] rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs shrink-0 disabled:opacity-50"
              title="调用 LibreOffice 对最新导出的 PPTX 重新渲染逐页截图"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${renderingPreview ? "animate-spin" : ""}`}
              />
              <span>{renderingPreview ? "渲染中..." : "更新真实排版图"}</span>
            </button>
          </div>
        )}

        {/* QA Panel */}
        <div className="p-4 rounded-xl bg-[#f8f9fa] border border-[#e5e7eb] space-y-2.5 text-xs">
          <div className="flex items-center justify-between font-semibold text-[#111827]">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#059669]" />
              <span>版面检查</span>
            </span>

            {!outline || totalSlides === 0 ? (
              <span className="text-[11px] text-[#6b7280] bg-[#f3f4f6] border border-[#eaecf0] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9ca3af]" />
                <span>等待内容</span>
              </span>
            ) : report && !report.success ? (
              <span className="text-[11px] text-[#db2777] bg-[#fdf2f8] border border-[#fbcfe8] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f43f5e]" />
                <span>排版未通过</span>
              </span>
            ) : issues.length > 0 ? (
              <span className="text-[11px] text-[#b45309] bg-[#fef3c7] border border-[#fde68a] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
                <span>{issues.length} 处需调整</span>
              </span>
            ) : project?.download_available ? (
              <span className="text-[11px] text-[#059669] bg-[#ecfdf5] border border-[#a7f3d0] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                <span>0 处溢出 (已校验)</span>
              </span>
            ) : (
              <span className="text-[11px] text-[#6b7280] bg-[#f3f4f6] border border-[#eaecf0] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9ca3af]" />
                <span>待生成校验</span>
              </span>
            )}
          </div>

          {issues.length > 0 ? (
            <ul className="space-y-1 text-[#db2777] text-xs pt-1">
              {issues.map((iss, i) => (
                <li key={i} className="flex items-start gap-1 font-mono">
                  <span>•</span>
                  <span>
                    [{iss.code}] {iss.slide_id ? `${iss.slide_id}: ` : ""}
                    {iss.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="pt-2 border-t border-[#eaecf0] text-xs text-[#6b7280]">
              <button
                type="button"
                onClick={() => setShowQADetails(!showQADetails)}
                className="text-[#374151] hover:text-[#111827] flex items-center gap-1 text-[11px] font-medium cursor-pointer"
              >
                <span>{showQADetails ? "收起度量规则" : "查看度量规则详情"}</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${
                    showQADetails ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showQADetails && (
                <div className="grid grid-cols-2 gap-2 text-[11px] text-[#4b5563] pt-2 font-mono">
                  <div>
                    <span className="block text-[#9ca3af]">字符物理宽度:</span>
                    <span>fontTools Advance Width</span>
                  </div>
                  <div>
                    <span className="block text-[#9ca3af]">字号自适应:</span>
                    <span className="text-[#059669]">
                      {autoFit ? "18→16→14pt 阶梯退让" : "严格 18pt 固定"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Real Source Traceability Panel */}
        {currentItem && (
          <div className="p-3.5 rounded-xl bg-[#f9fafb] border border-[#eaecf0] text-xs space-y-2">
            <div className="font-semibold text-xs text-[#374151] flex items-center justify-between gap-2">
              <span>材料出处对照</span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-md bg-[#fef3c7] text-[#b45309] border border-[#fde68a] truncate max-w-[65%]">
                {currentItem.source_ids.length > 0
                  ? currentItem.source_ids.join(", ")
                  : "暂无出处引用"}
              </span>
            </div>

            {matchedFragments.length > 0 ? (
              <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
                {matchedFragments.map((frag) => (
                  <div
                    key={frag.source_id}
                    className="bg-white p-2.5 rounded-lg border border-[#eaecf0] space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#6b7280]">
                      <span className="font-semibold text-[#111827]">
                        {frag.source_id}
                      </span>
                      <span>
                        {frag.asset_id} · {frag.location}
                      </span>
                    </div>
                    <p className="text-xs text-[#4b5563] leading-relaxed">
                      {frag.content_preview || "[图片素材占位，无文本摘录]"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6b7280] leading-relaxed bg-white p-2.5 rounded-lg border border-[#eaecf0]">
                {currentItem.source_ids.length > 0
                  ? "未在当前素材切片索引中检索到对应正文预览。"
                  : "当前页未绑定原始材料切片（人工新增或待补充），导出演示前请人工核对事实准确性。"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
