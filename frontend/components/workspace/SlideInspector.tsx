"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Columns2,
  FileText,
  Image as ImageIcon,
  Link2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import type {
  Issue,
  Material,
  OutlineItem,
  SlideRefineCandidate,
  SourceFragment,
} from "../../lib/api";
import {
  cleanMarkdownExcerpt,
  EditableOutlineField,
  formatFragmentLocation,
  getExcerptTargetLabel,
  inferEffectiveLayout,
  LAYOUT_LABELS,
} from "./layoutUtils";

interface SlideInspectorProps {
  pid: string;
  item: OutlineItem;
  slideIndex: number;
  totalSlides: number;
  materials: Material[];
  sourceFragments: SourceFragment[];
  slideIssues: Issue[];
  onUpdateField: (field: EditableOutlineField, value: string) => void;
  onToggleSourceId: (sourceId: string) => void;
  onApplyImageToSlide: (imageAssetId: string, sourceId?: string) => void;
  onSplitTwoColumn: () => void;
  onRefineSlide: (
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ) => Promise<SlideRefineCandidate | null>;
  onApplyRefineCandidate: (candidate: SlideRefineCandidate) => void;
  onUploadClick: () => void;
}

export function formatAssetLabel(assetId: string): string {
  if (assetId.length <= 20) return assetId;
  return `${assetId.slice(0, 10)}…${assetId.slice(-6)}`;
}

export function extractFragmentText(
  frag: SourceFragment,
  materials: Material[]
): string {
  const mat = materials.find(
    (m) => m.asset_id === frag.asset_id && m.asset_type !== "image"
  );
  if (mat && mat.content) {
    const match = /L(\d+)-L(\d+)$/.exec(frag.location);
    if (match) {
      const start = Math.max(0, parseInt(match[1], 10) - 1);
      const end = parseInt(match[2], 10);
      const slice = mat.content
        .split(/\r?\n/)
        .slice(start, end)
        .join("\n")
        .trim();
      if (slice) return cleanMarkdownExcerpt(slice);
    }
    if (frag.content_preview) return cleanMarkdownExcerpt(frag.content_preview);
    const trimmed = mat.content.trim();
    if (trimmed) return cleanMarkdownExcerpt(trimmed.slice(0, 360));
  }
  return cleanMarkdownExcerpt(frag.content_preview || "");
}

function AutoGrowTextarea({
  id,
  value,
  placeholder,
  minRows = 3,
  onChange,
  className = "",
}: {
  id?: string;
  value: string;
  placeholder?: string;
  minRows?: number;
  onChange: (val: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      id={id}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full overflow-hidden resize-none ${className}`}
    />
  );
}

export function SlideInspector({
  pid,
  item,
  slideIndex,
  totalSlides,
  materials,
  sourceFragments,
  slideIssues,
  onUpdateField,
  onToggleSourceId,
  onApplyImageToSlide,
  onSplitTwoColumn,
  onRefineSlide,
  onApplyRefineCandidate,
  onUploadClick,
}: SlideInspectorProps) {
  // Speaker notes stay expanded by default to utilize lower inspector space (still collapsible).
  const [notesOpen, setNotesOpen] = useState(true);
  const [provenanceOpen, setProvenanceOpen] = useState(true);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [refiningMode, setRefiningMode] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [refineCandidate, setRefineCandidate] =
    useState<SlideRefineCandidate | null>(null);
  const [refineNotice, setRefineNotice] = useState("");

  useEffect(() => {
    setRefineCandidate(null);
    setRefineNotice("");
    setSourcePickerOpen(false);
  }, [item.outline_item_id]);

  async function triggerRefine(
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ) {
    setRefiningMode(mode);
    setRefineNotice("");
    try {
      const candidate = await onRefineSlide(mode, instruction);
      if (candidate) {
        const unchanged =
          candidate.title.trim() === item.title.trim() &&
          candidate.summary.trim() === item.summary.trim() &&
          (candidate.column_right || "").trim() === (item.column_right || "").trim() &&
          (!candidate.layout || candidate.layout === layout);
        if (unchanged) {
          setRefineCandidate(null);
          setRefineNotice("当前内容已足够精炼，无需改动（可用「自定义」指定改写方向）。");
        } else {
          setRefineCandidate(candidate);
        }
      }
    } finally {
      setRefiningMode(null);
    }
  }

  const layout = inferEffectiveLayout(item.layout, slideIndex, totalSlides);
  const imageAssets = materials.filter((m) => m.asset_type === "image");
  const imageAssetIds = new Set(imageAssets.map((m) => m.asset_id));

  const matchedFragments = item.source_ids
    .map((sid) => sourceFragments.find((f) => f.source_id === sid))
    .filter((f): f is SourceFragment => Boolean(f));
  const boundAssetCount = new Set(matchedFragments.map((f) => f.asset_id)).size;

  const isImageFragment = (frag: SourceFragment) =>
    frag.source_id.endsWith("-img") || imageAssetIds.has(frag.asset_id);

  const missingTitle = !item.title.trim();
  const missingSummary = !item.summary.trim();
  const missingColRight =
    layout === "two_column" && !(item.column_right && item.column_right.trim());
  const missingImage =
    layout === "text_image" &&
    !(item.image_asset_id && item.image_asset_id.trim());

  const canSplitSummary =
    item.summary.trim().split(/\r?\n|[。；;]/).filter((s) => s.trim()).length >=
    2;

  const isSupported =
    item.evidence_status === "supported" && item.source_ids.length > 0;
  const isPartial =
    item.evidence_status === "partial" && item.source_ids.length > 0;

  // Primary editable field surface: canonical design-system field primitive
  const primaryInputBase =
    "ui-field text-[14.5px] px-3.5 py-2.5 leading-relaxed";

  function fillFromExcerpt(targetField: "summary" | "column_right", text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const current =
      targetField === "column_right"
        ? (item.column_right || "").trim()
        : item.summary.trim();
    const isDefaultPlaceholder =
      current === "输入本页的核心陈述内容…" || current === "";
    const nextValue = isDefaultPlaceholder
      ? cleaned
      : `${current}\n${cleaned}`;
    onUpdateField(targetField, nextValue);
  }

  return (
    <aside className="w-[320px] xl:w-[376px] shrink-0 bg-surface-subtle border-l border-black/[0.08] flex flex-col min-h-0 overflow-y-auto clean-scroll">
      {/* Sticky Monochrome Inspector Header (page count lives above stage only) */}
      <div className="px-5 py-3 border-b border-black/[0.07] flex items-center justify-between sticky top-0 bg-surface-subtle/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2.5 whitespace-nowrap">
          <span className="text-[14px] font-semibold text-ink">
            第 {slideIndex + 1} 页
          </span>
          <span className="text-[13px] font-medium text-ink-secondary">
            {LAYOUT_LABELS[layout] || "正文"}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-6 flex-1">
        {/* In-place Slide QA Issues */}
        {slideIssues.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-danger-bg border border-danger/20 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-danger">
                本页排版校验未通过
              </div>
              <button
                type="button"
                disabled={Boolean(refiningMode)}
                onClick={() => void triggerRefine("concise")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger hover:bg-danger-hover text-white text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {refiningMode === "concise"
                    ? "正在精简…"
                    : "AI 精简防超框"}
                </span>
              </button>
            </div>
            {slideIssues.map((iss, i) => (
              <p
                key={i}
                className="text-[13px] text-danger leading-relaxed font-mono break-all"
              >
                {iss.message}
              </p>
            ))}
          </div>
        )}

        {/* ── TIER 1 (TOP): Core Selling Point — Source Provenance & Evidence Bar ── */}
        <section
          className={`rounded-2xl border overflow-hidden transition-colors ${
            isSupported
              ? "bg-surface border-black/[0.09] shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
              : "bg-warning-bg border-warning-dot/25"
          }`}
        >
          <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setProvenanceOpen((v) => !v)}
              className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isSupported ? "bg-success" : "bg-warning-dot"
                }`}
              />
              <span className="flex items-center gap-2 text-[13px] min-w-0 truncate">
                <span className="font-semibold text-ink">
                  {isSupported
                    ? "依据充分"
                    : isPartial
                    ? "部分依据"
                    : "待补素材出处"}
                </span>
                {(isSupported || isPartial) && (
                  <span className="text-ink-secondary font-normal">
                    {boundAssetCount} 份素材
                  </span>
                )}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-ink-muted shrink-0 transition-transform ${
                  provenanceOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => {
                setProvenanceOpen(true);
                setSourcePickerOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/[0.05] hover:bg-black/[0.1] text-[13px] font-medium text-ink cursor-pointer transition-colors shrink-0"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{sourcePickerOpen ? "收起" : "关联素材"}</span>
            </button>
          </div>

          {provenanceOpen && (
            <div className="px-3.5 pb-3.5 pt-1.5 border-t border-black/[0.06] space-y-2.5">
              {/* Inline Source Binding Picker */}
              {sourcePickerOpen && (
                <div className="p-2.5 rounded-xl bg-canvas border border-black/[0.07] space-y-2">
                  <div className="flex items-center justify-between text-[13px] text-ink-secondary">
                    <span>勾选本页引用的原始素材切片</span>
                    <button
                      type="button"
                      onClick={() => setSourcePickerOpen(false)}
                      className="text-ink font-medium hover:underline cursor-pointer"
                    >
                      完成
                    </button>
                  </div>

                  {sourceFragments.length > 0 ? (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto clean-scroll pr-0.5">
                      {sourceFragments.map((frag) => {
                        const bound = item.source_ids.includes(frag.source_id);
                        const isImg = isImageFragment(frag);
                        const excerpt = isImg
                          ? ""
                          : extractFragmentText(frag, materials);

                        return (
                          <button
                            key={frag.source_id}
                            type="button"
                            onClick={() => onToggleSourceId(frag.source_id)}
                            className={`w-full text-left p-2.5 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                              bound
                                ? "bg-surface ring-1.5 ring-ink/70 shadow-2xs"
                                : "bg-surface/75 hover:bg-surface ring-1 ring-black/[0.07]"
                            }`}
                          >
                            <div
                              className={`mt-0.5 w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                                bound
                                  ? "bg-ink text-white"
                                  : "border border-black/25 bg-surface"
                              }`}
                            >
                              {bound && (
                                <Check className="w-3 h-3 stroke-[2.5]" />
                              )}
                            </div>

                            {isImg ? (
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-10 h-7 rounded bg-canvas overflow-hidden shrink-0 flex items-center justify-center border border-black/[0.07]">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`/api/projects/${pid}/assets/${encodeURIComponent(
                                      frag.asset_id
                                    )}`}
                                    alt={frag.asset_id}
                                    className="w-full h-full object-contain"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div
                                    className="text-[13px] font-medium text-ink truncate"
                                    title={frag.asset_id}
                                  >
                                    {formatAssetLabel(frag.asset_id)}
                                  </div>
                                  <div className="text-[13px] text-ink-muted">
                                    图片素材
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center justify-between gap-2 text-[13px]">
                                  <span
                                    className="font-medium text-ink truncate"
                                    title={frag.asset_id}
                                  >
                                    {formatAssetLabel(frag.asset_id)}
                                  </span>
                                  <span className="text-[13px] text-ink-muted shrink-0">
                                    {formatFragmentLocation(frag.location)}
                                  </span>
                                </div>
                                <p className="text-[13px] text-ink-secondary line-clamp-2 leading-snug">
                                  {excerpt || "文本切片"}
                                </p>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[13px] text-ink-muted py-2 text-center">
                      项目暂无素材切片，请先上传文件或粘贴笔记。
                    </div>
                  )}
                </div>
              )}

              {/* Bound Provenance Excerpts */}
              {matchedFragments.length > 0 ? (
                <div className="space-y-2 max-h-[240px] overflow-y-auto clean-scroll pr-0.5">
                  {matchedFragments.map((frag) => {
                    const isImg = isImageFragment(frag);
                    const excerpt = isImg
                      ? ""
                      : extractFragmentText(frag, materials);
                    const isCurrentSlideImage =
                      layout === "text_image" &&
                      item.image_asset_id === frag.asset_id;

                    if (isImg) {
                      return (
                        <div
                          key={frag.source_id}
                          className="p-2.5 rounded-xl bg-canvas space-y-2 group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <ImageIcon className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                              <span
                                className="text-[13px] font-semibold text-ink truncate"
                                title={frag.asset_id}
                              >
                                {formatAssetLabel(frag.asset_id)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => onToggleSourceId(frag.source_id)}
                              title="解除关联"
                              className="text-ink-muted hover:text-danger p-0.5 rounded opacity-65 group-hover:opacity-100 transition-opacity cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <div className="w-16 h-10 rounded-lg bg-surface border border-black/[0.07] overflow-hidden flex items-center justify-center shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/projects/${pid}/assets/${encodeURIComponent(
                                  frag.asset_id
                                )}`}
                                alt={frag.asset_id}
                                className="w-full h-full object-contain"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              {isCurrentSlideImage ? (
                                <span className="text-[13px] font-medium text-success flex items-center gap-1">
                                  <Check className="w-3.5 h-3.5" />
                                  <span>已设为本页配图</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onApplyImageToSlide(
                                      frag.asset_id,
                                      frag.source_id
                                    )
                                  }
                                  className="text-[13px] font-medium text-ink underline underline-offset-2 hover:opacity-70 cursor-pointer"
                                >
                                  设为本页配图
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={frag.source_id}
                        className="p-2.5 rounded-xl bg-canvas space-y-1.5 group"
                      >
                        <div className="flex items-center justify-between gap-2 text-[13px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                            <span
                              className="font-semibold text-ink truncate"
                              title={frag.asset_id}
                            >
                              {formatAssetLabel(frag.asset_id)}
                            </span>
                            <span className="text-ink-muted shrink-0">
                              {formatFragmentLocation(frag.location)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onToggleSourceId(frag.source_id)}
                            title="解除关联"
                            className="text-ink-muted hover:text-danger p-0.5 rounded opacity-65 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <p className="text-[13px] text-ink-secondary leading-relaxed whitespace-pre-wrap line-clamp-3">
                          {excerpt || "（该文本切片为空）"}
                        </p>

                        {excerpt && (
                          <div className="flex flex-wrap items-center gap-3 pt-1.5 border-t border-black/[0.06] text-[13px]">
                            <button
                              type="button"
                              onClick={() => fillFromExcerpt("summary", excerpt)}
                              className="text-ink font-medium underline underline-offset-2 hover:opacity-70 cursor-pointer"
                            >
                              填入{getExcerptTargetLabel(layout)}
                            </button>
                            {layout === "two_column" && (
                              <button
                                type="button"
                                onClick={() =>
                                  fillFromExcerpt("column_right", excerpt)
                                }
                                className="text-ink font-medium underline underline-offset-2 hover:opacity-70 cursor-pointer"
                              >
                                填入右栏
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2 pt-0.5">
                  <p className="text-[13px] text-ink-secondary leading-relaxed">
                    {item.source_ids.length > 0
                      ? "未检索到对应素材切片，可重新选择关联。"
                      : "关联原始素材切片或配图后，随时对照原文并标记为「依据充分」。"}
                  </p>
                  {sourceFragments.length > 0 && !sourcePickerOpen && (
                    <button
                      type="button"
                      onClick={() => setSourcePickerOpen(true)}
                      className="ui-btn-outline px-3 py-1 text-[13px]"
                    >
                      选择关联素材
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── TIER 2 (PRIMARY FOCUS): Slide Content Editors + Inline AI Refine Strip ── */}
        <section className="space-y-4">
          {/* Primary Title Field */}
          <div className="space-y-1.5">
            <label
              htmlFor="input-title"
              className="block text-[13px] font-semibold text-ink"
            >
              幻灯片标题
            </label>
            <input
              id="input-title"
              type="text"
              value={item.title}
              onChange={(e) => onUpdateField("title", e.target.value)}
              placeholder="输入本页主标题…"
              className={`w-full text-[18px] font-semibold tracking-[-0.02em] text-ink placeholder:text-ink-muted bg-surface rounded-xl px-3.5 py-2.5 border outline-none transition-all leading-snug ${
                missingTitle
                  ? "border-danger/70 focus:border-danger"
                  : "border-black/[0.12] hover:border-black/[0.22] focus:border-ink focus:ring-4 focus:ring-black/[0.06]"
              }`}
            />
            {missingTitle && (
              <p className="text-[13px] text-danger">标题不能为空</p>
            )}
          </div>

          {/* Layout-Aware Primary Body Editors */}
          {layout === "two_column" ? (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <label
                  htmlFor="input-summary"
                  className="block text-[13px] font-semibold text-ink"
                >
                  左栏内容
                </label>
                <AutoGrowTextarea
                  id="input-summary"
                  value={item.summary}
                  minRows={3}
                  placeholder="输入左栏要点或对比项…"
                  onChange={(val) => onUpdateField("summary", val)}
                  className={primaryInputBase}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="input-col-right"
                    className="block text-[13px] font-semibold text-ink"
                  >
                    右栏内容
                  </label>
                  {canSplitSummary && (
                    <button
                      type="button"
                      onClick={onSplitTwoColumn}
                      className="inline-flex items-center gap-1 text-[13px] font-medium text-ink underline underline-offset-2 hover:opacity-70 cursor-pointer"
                    >
                      <Columns2 className="w-3.5 h-3.5" />
                      <span>从左栏拆分后半段</span>
                    </button>
                  )}
                </div>
                <AutoGrowTextarea
                  id="input-col-right"
                  value={item.column_right || ""}
                  minRows={3}
                  placeholder="输入右栏对比内容…"
                  onChange={(val) => onUpdateField("column_right", val)}
                  className={`${primaryInputBase} ${
                    missingColRight ? "!border-warning-dot/70" : ""
                  }`}
                />
                {missingColRight && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <p className="text-[13px] text-warning">
                      双栏版式需填写右栏内容
                    </p>
                    {canSplitSummary && (
                      <button
                        type="button"
                        onClick={onSplitTwoColumn}
                        className="ui-btn-outline px-2.5 py-1 text-[13px]"
                      >
                        一键拆入右栏
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : layout === "text_image" ? (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <label
                  htmlFor="input-summary"
                  className="block text-[13px] font-semibold text-ink"
                >
                  左侧说明文案
                </label>
                <AutoGrowTextarea
                  id="input-summary"
                  value={item.summary}
                  minRows={3}
                  placeholder="输入左侧要点说明…"
                  onChange={(val) => onUpdateField("summary", val)}
                  className={primaryInputBase}
                />
              </div>

              {/* Visual Thumbnail Image Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-ink">
                    右侧配图
                  </span>
                  <button
                    type="button"
                    onClick={onUploadClick}
                    className="text-[13px] text-ink underline underline-offset-2 hover:opacity-70 font-medium cursor-pointer"
                  >
                    + 上传图片
                  </button>
                </div>

                {imageAssets.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {imageAssets.map((img, i) => {
                      const selected = item.image_asset_id === img.asset_id;
                      return (
                        <button
                          key={`${img.asset_id}-${i}`}
                          type="button"
                          onClick={() =>
                            onUpdateField("image_asset_id", img.asset_id)
                          }
                          title={img.asset_id}
                          className={`group rounded-xl overflow-hidden bg-surface p-1.5 text-left transition-all cursor-pointer ${
                            selected
                              ? "ring-2 ring-ink/75"
                              : "ring-1 ring-black/[0.1] hover:ring-black/25"
                          }`}
                        >
                          <div className="aspect-[16/10] rounded-lg bg-canvas overflow-hidden flex items-center justify-center mb-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/projects/${pid}/assets/${encodeURIComponent(
                                img.asset_id
                              )}`}
                              alt={img.asset_id}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="text-[13px] text-ink truncate px-0.5 font-medium">
                            {formatAssetLabel(img.asset_id)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onUploadClick}
                    className="w-full py-5 px-3 rounded-2xl border border-dashed border-border-dashed hover:border-ink bg-surface flex flex-col items-center justify-center gap-1.5 text-ink-secondary hover:text-ink transition-colors cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-full bg-canvas flex items-center justify-center">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span className="text-[13px] font-medium">
                      上传 PNG / JPG 配图
                    </span>
                  </button>
                )}

                {missingImage && (
                  <p className="text-[13px] text-warning flex items-center gap-1">
                    <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>请选择一张项目配图后保存</span>
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="input-summary"
                className="block text-[13px] font-semibold text-ink"
              >
                {layout === "bullets"
                  ? "分点要点（每行一条）"
                  : layout === "cover"
                  ? "副标题 / 核心提要"
                  : layout === "closing"
                  ? "结语说明"
                  : "正文内容"}
              </label>
              <AutoGrowTextarea
                id="input-summary"
                value={item.summary}
                minRows={layout === "bullets" ? 4 : 3}
                placeholder={
                  layout === "bullets"
                    ? "每行输入一条分点要点…"
                    : "输入本页正文内容…"
                }
                onChange={(val) => onUpdateField("summary", val)}
                className={`${primaryInputBase} ${
                  missingSummary ? "!border-danger/70" : ""
                }`}
              />
              {missingSummary && (
                <p className="text-[13px] text-danger">正文内容不能为空</p>
              )}
            </div>
          )}

          {/* Lightweight Inline AI Refine Action Strip (whole-slide scope clearly stated) */}
          <div className="space-y-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary mr-1"
                title="对本页标题与正文整体改写，确认后生效"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>本页 AI 精修</span>
              </span>
              <button
                type="button"
                disabled={Boolean(refiningMode)}
                onClick={() => void triggerRefine("concise")}
                title="由 AI 整体改写本页标题与正文，确认后生效"
                className="px-3 py-1 rounded-full bg-black/[0.04] hover:bg-surface border border-transparent hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40"
              >
                {refiningMode === "concise"
                  ? "处理中…"
                  : layout === "cover" || layout === "closing"
                  ? "润色整页"
                  : "精简整页"}
              </button>
              {(layout === "content" || layout === "two_column") && (
                <button
                  type="button"
                  disabled={Boolean(refiningMode)}
                  onClick={() => void triggerRefine("bullets")}
                  title="将本页内容重排为分点要点"
                  className="px-3 py-1 rounded-full bg-black/[0.04] hover:bg-surface border border-transparent hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40"
                >
                  {refiningMode === "bullets" ? "提炼中…" : "转分点"}
                </button>
              )}
              {(layout === "content" || layout === "bullets") && (
                <button
                  type="button"
                  disabled={Boolean(refiningMode)}
                  onClick={() => void triggerRefine("two_column")}
                  title="将本页内容拆分为双栏对比"
                  className="px-3 py-1 rounded-full bg-black/[0.04] hover:bg-surface border border-transparent hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40"
                >
                  {refiningMode === "two_column" ? "拆分中…" : "转双栏"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors cursor-pointer border ${
                  customOpen
                    ? "bg-surface border-ink/60 text-ink shadow-2xs"
                    : "bg-black/[0.04] hover:bg-surface border-transparent hover:border-black/25 text-ink"
                }`}
              >
                自定义
              </button>
            </div>

            {refineNotice && (
              <div className="text-[13px] text-ink-secondary px-1">
                {refineNotice}
              </div>
            )}

            {customOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customInstruction.trim() || refiningMode) return;
                  void triggerRefine("custom", customInstruction.trim());
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  placeholder="输入整页修改要求（如：更专业简洁、突出关键数据）…"
                  className="flex-1 min-w-0 text-[13px] text-ink placeholder:text-ink-muted bg-surface rounded-xl px-3 py-1.5 border border-black/[0.12] hover:border-black/25 focus:border-ink outline-none transition-colors"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!customInstruction.trim() || Boolean(refiningMode)}
                  className="ui-btn-outline px-3 py-1.5 rounded-xl text-[13px] shrink-0"
                >
                  {refiningMode === "custom" ? "生成中…" : "生成"}
                </button>
              </form>
            )}

            {/* Non-Destructive Diff Candidate Card */}
            {refineCandidate && (
              <div className="p-3.5 rounded-2xl bg-surface border border-ink/25 shadow-[0_4px_16px_rgba(0,0,0,0.06)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {refineCandidate.source === "fallback"
                        ? "本地规则整理"
                        : "AI 修改建议"}
                    </span>
                    <span className="font-normal text-ink-muted">
                      确认后生效
                    </span>
                  </span>
                  {refineCandidate.layout && refineCandidate.layout !== layout && (
                    <span className="text-[13px] font-medium text-ink bg-canvas px-2 py-0.5 rounded-full border border-black/[0.08]">
                      切为：{LAYOUT_LABELS[refineCandidate.layout] || refineCandidate.layout}
                    </span>
                  )}
                </div>

                {refineCandidate.rationale && (
                  <p className="text-[13px] text-ink-secondary leading-snug">
                    {refineCandidate.rationale}
                  </p>
                )}

                <div className="p-2.5 rounded-xl bg-surface-subtle border border-black/[0.07] space-y-1.5 text-[13px]">
                  {refineCandidate.title !== item.title && (
                    <div className="font-semibold text-ink pb-1 border-b border-black/[0.06]">
                      标题：{refineCandidate.title}
                    </div>
                  )}
                  <div className="text-ink whitespace-pre-wrap leading-relaxed">
                    {refineCandidate.summary}
                  </div>
                  {refineCandidate.layout === "two_column" &&
                    refineCandidate.column_right && (
                      <div className="pt-1.5 border-t border-black/[0.06] text-ink whitespace-pre-wrap leading-relaxed">
                        <span className="text-[13px] font-semibold text-ink-secondary block mb-0.5">
                          右栏对比：
                        </span>
                        {refineCandidate.column_right}
                      </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setRefineCandidate(null)}
                    className="px-3 py-1 rounded-full text-[13px] font-medium text-ink-secondary hover:text-ink cursor-pointer"
                  >
                    放弃
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyRefineCandidate(refineCandidate);
                      setRefineCandidate(null);
                    }}
                    className="ui-btn-outline px-3.5 py-1 text-[13px]"
                  >
                    确认应用
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── TIER 3: Expanded-by-Default Speaker Notes (still collapsible) ── */}
        <section className="pt-3 border-t border-black/[0.07] space-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left group cursor-pointer"
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-[13px] font-semibold text-ink-secondary group-hover:text-ink transition-colors shrink-0">
                演讲者备注
              </span>
              {!notesOpen && item.speaker_notes && (
                <span className="text-[13px] text-ink-muted truncate">
                  {item.speaker_notes}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-ink-muted group-hover:text-ink shrink-0 transition-transform ${
                notesOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {notesOpen && (
            <AutoGrowTextarea
              id="input-notes"
              value={item.speaker_notes || ""}
              minRows={3}
              placeholder="写下有实质补充的口播提示，导出时将写入 PowerPoint 备注栏…"
              onChange={(val) => onUpdateField("speaker_notes", val)}
              className="text-[13px] text-ink placeholder:text-ink-muted bg-surface rounded-xl px-3 py-2.5 border border-black/[0.1] hover:border-black/20 focus:border-ink focus:ring-4 focus:ring-black/[0.05] outline-none leading-relaxed transition-all"
            />
          )}
        </section>
      </div>
    </aside>
  );
}
