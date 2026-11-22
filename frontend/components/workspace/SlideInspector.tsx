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
  EditableOutlineField,
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
      if (slice) return slice;
    }
    if (frag.content_preview) return frag.content_preview;
    const trimmed = mat.content.trim();
    if (trimmed) return trimmed.slice(0, 360);
  }
  return frag.content_preview || "";
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
  // Speaker notes stay collapsed by default so they never compete with primary slide content.
  const [notesOpen, setNotesOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(true);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [refiningMode, setRefiningMode] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [refineCandidate, setRefineCandidate] =
    useState<SlideRefineCandidate | null>(null);
  const [refineNotice, setRefineNotice] = useState("");

  useEffect(() => {
    setNotesOpen(false);
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

  // Primary editable field surface: crisp white with hairline border & monochrome focus ring
  const primaryInputBase =
    "text-[14.5px] text-[#1d1d1f] placeholder-[#a1a1aa] bg-white rounded-xl px-3.5 py-2.5 border border-black/[0.12] hover:border-black/[0.22] focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.06] outline-none leading-relaxed transition-all";

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
    <aside className="w-[320px] xl:w-[376px] shrink-0 bg-[#fafafa] border-l border-black/[0.08] flex flex-col min-h-0 overflow-y-auto clean-scroll">
      {/* Sticky Monochrome Inspector Header */}
      <div className="px-5 py-3 border-b border-black/[0.07] flex items-center justify-between sticky top-0 bg-[#fafafa]/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[13.5px] font-semibold text-[#1d1d1f]">
            第 {slideIndex + 1} 页
          </span>
          <span className="text-black/20">·</span>
          <span className="text-[13px] font-medium text-[#52525b]">
            {LAYOUT_LABELS[layout] || "正文"}
          </span>
        </div>

        <span className="text-[11.5px] text-[#71717a] tabular-nums">
          {slideIndex + 1} / {totalSlides}
        </span>
      </div>

      <div className="p-5 space-y-6 flex-1">
        {/* In-place Slide QA Issues */}
        {slideIssues.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-[#fff2f2] border border-[#ff3b30]/20 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12.5px] font-semibold text-[#c02620]">
                本页排版校验未通过
              </div>
              <button
                type="button"
                disabled={Boolean(refiningMode)}
                onClick={() => void triggerRefine("concise")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#d70015] hover:bg-[#b80012] text-white text-[11.5px] font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />
                <span>
                  {refiningMode === "concise"
                    ? "正在精简…"
                    : "AI 一键精简防超框"}
                </span>
              </button>
            </div>
            {slideIssues.map((iss, i) => (
              <p
                key={i}
                className="text-[12px] text-[#9b1c1c] leading-relaxed font-mono break-all"
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
              ? "bg-white border-black/[0.09] shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
              : "bg-[#fffaf0] border-[#d97706]/25"
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
                  isSupported ? "bg-[#248a3d]" : "bg-[#d97706]"
                }`}
              />
              <span className="text-[12.5px] font-semibold text-[#1d1d1f] truncate">
                {isSupported
                  ? `依据充分 · ${matchedFragments.length} 处素材`
                  : isPartial
                  ? `部分依据 · ${matchedFragments.length} 处素材`
                  : "待补素材出处"}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-[#71717a] shrink-0 transition-transform ${
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
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/[0.05] hover:bg-black/[0.1] text-[11.5px] font-medium text-[#1d1d1f] cursor-pointer transition-colors shrink-0"
            >
              <Link2 className="w-3 h-3" />
              <span>{sourcePickerOpen ? "收起" : "关联素材"}</span>
            </button>
          </div>

          {provenanceOpen && (
            <div className="px-3.5 pb-3.5 pt-1 border-t border-black/[0.06] space-y-2.5">
              {/* Inline Source Binding Picker */}
              {sourcePickerOpen && (
                <div className="p-2.5 rounded-xl bg-[#f5f5f7] border border-black/[0.07] space-y-2">
                  <div className="flex items-center justify-between text-[11.5px] text-[#52525b]">
                    <span>勾选本页引用的原始素材切片</span>
                    <button
                      type="button"
                      onClick={() => setSourcePickerOpen(false)}
                      className="text-[#1d1d1f] font-medium hover:underline cursor-pointer"
                    >
                      完成
                    </button>
                  </div>

                  {sourceFragments.length > 0 ? (
                    <div className="space-y-1.5 max-h-[190px] overflow-y-auto clean-scroll pr-0.5">
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
                            className={`w-full text-left p-2 rounded-xl transition-all flex items-start gap-2.5 cursor-pointer ${
                              bound
                                ? "bg-white ring-1.5 ring-[#1d1d1f] shadow-2xs"
                                : "bg-white/75 hover:bg-white ring-1 ring-black/[0.07]"
                            }`}
                          >
                            <div
                              className={`mt-0.5 w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                                bound
                                  ? "bg-[#1d1d1f] text-white"
                                  : "border border-black/25 bg-white"
                              }`}
                            >
                              {bound && (
                                <Check className="w-3 h-3 stroke-[2.5]" />
                              )}
                            </div>

                            {isImg ? (
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-10 h-7 rounded bg-[#f5f5f7] overflow-hidden shrink-0 flex items-center justify-center border border-black/[0.07]">
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
                                    className="text-[12px] font-medium text-[#1d1d1f] truncate"
                                    title={frag.asset_id}
                                  >
                                    {formatAssetLabel(frag.asset_id)}
                                  </div>
                                  <div className="text-[11px] text-[#71717a]">
                                    图片素材
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center justify-between gap-1 text-[11.5px]">
                                  <span
                                    className="font-medium text-[#1d1d1f] truncate"
                                    title={frag.asset_id}
                                  >
                                    {formatAssetLabel(frag.asset_id)}
                                  </span>
                                  <span className="text-[10.5px] text-[#71717a] shrink-0">
                                    {frag.location}
                                  </span>
                                </div>
                                <p className="text-[11.5px] text-[#52525b] line-clamp-2 leading-snug">
                                  {excerpt || "文本切片"}
                                </p>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[12px] text-[#71717a] py-2 text-center">
                      项目暂无素材切片，请先上传文件或粘贴笔记。
                    </div>
                  )}
                </div>
              )}

              {/* Bound Provenance Excerpts */}
              {matchedFragments.length > 0 ? (
                <div className="space-y-2 max-h-[220px] overflow-y-auto clean-scroll pr-0.5">
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
                          className="p-2.5 rounded-xl bg-[#f5f5f7] space-y-2 group"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <ImageIcon className="w-3.5 h-3.5 text-[#52525b] shrink-0" />
                              <span
                                className="text-[12px] font-semibold text-[#1d1d1f] truncate"
                                title={frag.asset_id}
                              >
                                {formatAssetLabel(frag.asset_id)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => onToggleSourceId(frag.source_id)}
                              title="解除关联"
                              className="text-[#71717a] hover:text-[#d70015] p-0.5 rounded opacity-65 group-hover:opacity-100 transition-opacity cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-2.5">
                            <div className="w-16 h-10 rounded-lg bg-white border border-black/[0.07] overflow-hidden flex items-center justify-center shrink-0">
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
                                <span className="text-[11.5px] font-medium text-[#248a3d] flex items-center gap-1">
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
                                  className="text-[12px] font-medium text-[#1d1d1f] underline underline-offset-2 hover:opacity-70 cursor-pointer"
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
                        className="p-2.5 rounded-xl bg-[#f5f5f7] space-y-1.5 group"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11.5px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-[#52525b] shrink-0" />
                            <span
                              className="font-semibold text-[#1d1d1f] truncate"
                              title={frag.asset_id}
                            >
                              {formatAssetLabel(frag.asset_id)}
                            </span>
                            <span className="text-[#71717a] shrink-0">
                              · {frag.location.replace(/^L/, "第 ")} 行
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onToggleSourceId(frag.source_id)}
                            title="解除关联"
                            className="text-[#71717a] hover:text-[#d70015] p-0.5 rounded opacity-65 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <p className="text-[12px] text-[#3f3f46] leading-relaxed whitespace-pre-wrap line-clamp-3">
                          {excerpt || "（该文本切片为空）"}
                        </p>

                        {excerpt && (
                          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-black/[0.06] text-[11.5px]">
                            <button
                              type="button"
                              onClick={() => fillFromExcerpt("summary", excerpt)}
                              className="text-[#1d1d1f] font-medium underline underline-offset-2 hover:opacity-70 cursor-pointer"
                            >
                              {layout === "two_column" ? "填入左栏" : "填入正文"}
                            </button>
                            {layout === "two_column" && (
                              <>
                                <span className="text-black/20">·</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    fillFromExcerpt("column_right", excerpt)
                                  }
                                  className="text-[#1d1d1f] font-medium underline underline-offset-2 hover:opacity-70 cursor-pointer"
                                >
                                  填入右栏
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2 pt-0.5">
                  <p className="text-[12px] text-[#52525b] leading-relaxed">
                    {item.source_ids.length > 0
                      ? "未检索到对应素材切片，可重新选择关联。"
                      : "关联原始素材切片或配图后，随时对照原文并标记为「依据充分」。"}
                  </p>
                  {sourceFragments.length > 0 && !sourcePickerOpen && (
                    <button
                      type="button"
                      onClick={() => setSourcePickerOpen(true)}
                      className="px-3 py-1 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[12px] font-medium transition-colors cursor-pointer"
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
              className="block text-[12px] font-semibold text-[#27272a]"
            >
              幻灯片标题
            </label>
            <input
              id="input-title"
              type="text"
              value={item.title}
              onChange={(e) => onUpdateField("title", e.target.value)}
              placeholder="输入本页主标题…"
              className={`w-full text-[18px] font-semibold tracking-[-0.02em] text-[#1d1d1f] placeholder-[#a1a1aa] bg-white rounded-xl px-3.5 py-2.5 border outline-none transition-all leading-snug ${
                missingTitle
                  ? "border-[#ff3b30]/70 focus:border-[#d70015]"
                  : "border-black/[0.12] hover:border-black/[0.22] focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.06]"
              }`}
            />
            {missingTitle && (
              <p className="text-[12px] text-[#c02620]">标题不能为空</p>
            )}
          </div>

          {/* Layout-Aware Primary Body Editors */}
          {layout === "two_column" ? (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <label
                  htmlFor="input-summary"
                  className="block text-[12px] font-semibold text-[#27272a]"
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
                    className="block text-[12px] font-semibold text-[#27272a]"
                  >
                    右栏内容
                  </label>
                  {canSplitSummary && (
                    <button
                      type="button"
                      onClick={onSplitTwoColumn}
                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#1d1d1f] underline underline-offset-2 hover:opacity-70 cursor-pointer"
                    >
                      <Columns2 className="w-3 h-3" />
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
                    missingColRight ? "!border-[#d97706]/70" : ""
                  }`}
                />
                {missingColRight && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <p className="text-[12px] text-[#b45309]">
                      双栏版式需填写右栏内容
                    </p>
                    {canSplitSummary && (
                      <button
                        type="button"
                        onClick={onSplitTwoColumn}
                        className="px-2.5 py-1 rounded-full bg-[#1d1d1f] text-white text-[11.5px] font-medium hover:bg-[#323236] transition-colors cursor-pointer"
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
                  className="block text-[12px] font-semibold text-[#27272a]"
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
                  <span className="text-[12px] font-semibold text-[#27272a]">
                    右侧配图
                  </span>
                  <button
                    type="button"
                    onClick={onUploadClick}
                    className="text-[12px] text-[#1d1d1f] underline underline-offset-2 hover:opacity-70 font-medium cursor-pointer"
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
                          className={`group rounded-xl overflow-hidden bg-white p-1.5 text-left transition-all cursor-pointer ${
                            selected
                              ? "ring-2 ring-[#1d1d1f]"
                              : "ring-1 ring-black/[0.1] hover:ring-black/25"
                          }`}
                        >
                          <div className="aspect-[16/10] rounded-lg bg-[#f5f5f7] overflow-hidden flex items-center justify-center mb-1">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/projects/${pid}/assets/${encodeURIComponent(
                                img.asset_id
                              )}`}
                              alt={img.asset_id}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="text-[11px] text-[#1d1d1f] truncate px-0.5 font-medium">
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
                    className="w-full py-5 px-3 rounded-2xl border border-dashed border-black/[0.18] hover:border-[#1d1d1f] bg-white flex flex-col items-center justify-center gap-1.5 text-[#52525b] hover:text-[#1d1d1f] transition-colors cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-full bg-[#f5f5f7] flex items-center justify-center">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span className="text-[12.5px] font-medium">
                      上传 PNG / JPG 配图
                    </span>
                  </button>
                )}

                {missingImage && (
                  <p className="text-[12px] text-[#b45309] flex items-center gap-1">
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
                className="block text-[12px] font-semibold text-[#27272a]"
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
                  missingSummary ? "!border-[#ff3b30]/70" : ""
                }`}
              />
              {missingSummary && (
                <p className="text-[12px] text-[#c02620]">正文内容不能为空</p>
              )}
            </div>
          )}

          {/* Lightweight Inline AI Refine Action Strip (layout-aware, only relevant actions) */}
          <div className="space-y-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#71717a] mr-0.5">
                <Sparkles className="w-3 h-3" />
                <span>精修</span>
              </span>
              <button
                type="button"
                disabled={Boolean(refiningMode)}
                onClick={() => void triggerRefine("concise")}
                className="px-2.5 py-1 rounded-full bg-black/[0.05] hover:bg-[#1d1d1f] text-[#27272a] hover:text-white text-[11.5px] font-medium transition-colors cursor-pointer disabled:opacity-40"
              >
                {refiningMode === "concise"
                  ? "处理中…"
                  : layout === "cover" || layout === "closing"
                  ? "润色精炼"
                  : "精简字数"}
              </button>
              {(layout === "content" || layout === "two_column") && (
                <button
                  type="button"
                  disabled={Boolean(refiningMode)}
                  onClick={() => void triggerRefine("bullets")}
                  className="px-2.5 py-1 rounded-full bg-black/[0.05] hover:bg-[#1d1d1f] text-[#27272a] hover:text-white text-[11.5px] font-medium transition-colors cursor-pointer disabled:opacity-40"
                >
                  {refiningMode === "bullets" ? "提炼中…" : "转分点"}
                </button>
              )}
              {(layout === "content" || layout === "bullets") && (
                <button
                  type="button"
                  disabled={Boolean(refiningMode)}
                  onClick={() => void triggerRefine("two_column")}
                  className="px-2.5 py-1 rounded-full bg-black/[0.05] hover:bg-[#1d1d1f] text-[#27272a] hover:text-white text-[11.5px] font-medium transition-colors cursor-pointer disabled:opacity-40"
                >
                  {refiningMode === "two_column" ? "拆分中…" : "转双栏"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setCustomOpen((v) => !v)}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors cursor-pointer ${
                  customOpen
                    ? "bg-[#1d1d1f] text-white"
                    : "bg-black/[0.05] hover:bg-black/[0.1] text-[#27272a]"
                }`}
              >
                自定义
              </button>
            </div>

            {refineNotice && (
              <div className="text-[12px] text-[#52525b] px-1">
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
                  placeholder="输入修改要求（如：更专业简洁、突出关键数据）…"
                  className="flex-1 min-w-0 text-[12.5px] text-[#1d1d1f] placeholder-[#a1a1aa] bg-white rounded-xl px-3 py-1.5 border border-black/[0.12] focus:border-[#1d1d1f] outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!customInstruction.trim() || Boolean(refiningMode)}
                  className="px-3 py-1.5 rounded-xl bg-[#1d1d1f] hover:bg-[#323236] text-white text-[12px] font-medium cursor-pointer disabled:opacity-40 shrink-0"
                >
                  {refiningMode === "custom" ? "生成中…" : "生成"}
                </button>
              </form>
            )}

            {/* Non-Destructive Diff Candidate Card */}
            {refineCandidate && (
              <div className="p-3.5 rounded-2xl bg-white border border-[#1d1d1f]/20 shadow-[0_4px_16px_rgba(0,0,0,0.06)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#1d1d1f] flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {refineCandidate.source === "fallback"
                        ? "本地规则整理 · 确认后生效"
                        : "AI 修改建议 · 确认后生效"}
                    </span>
                  </span>
                  {refineCandidate.layout && refineCandidate.layout !== layout && (
                    <span className="text-[11px] font-medium text-[#27272a] bg-[#f5f5f7] px-2 py-0.5 rounded-full border border-black/[0.08]">
                      切为：{LAYOUT_LABELS[refineCandidate.layout] || refineCandidate.layout}
                    </span>
                  )}
                </div>

                {refineCandidate.rationale && (
                  <p className="text-[11.5px] text-[#52525b] leading-snug">
                    {refineCandidate.rationale}
                  </p>
                )}

                <div className="p-2.5 rounded-xl bg-[#fafafa] border border-black/[0.07] space-y-1.5 text-[12.5px]">
                  {refineCandidate.title !== item.title && (
                    <div className="font-semibold text-[#1d1d1f] pb-1 border-b border-black/[0.06]">
                      标题：{refineCandidate.title}
                    </div>
                  )}
                  <div className="text-[#1d1d1f] whitespace-pre-wrap leading-relaxed">
                    {refineCandidate.summary}
                  </div>
                  {refineCandidate.layout === "two_column" &&
                    refineCandidate.column_right && (
                      <div className="pt-1.5 border-t border-black/[0.06] text-[#1d1d1f] whitespace-pre-wrap leading-relaxed">
                        <span className="text-[11px] font-semibold text-[#52525b] block mb-0.5">
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
                    className="px-3 py-1 rounded-full text-[12px] font-medium text-[#52525b] hover:text-[#1d1d1f] cursor-pointer"
                  >
                    放弃
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onApplyRefineCandidate(refineCandidate);
                      setRefineCandidate(null);
                    }}
                    className="px-3.5 py-1 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[12px] font-medium transition-colors cursor-pointer"
                  >
                    确认应用
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── TIER 3 (LOW WEIGHT FOOTER): Collapsed-by-Default Speaker Notes ── */}
        <section className="pt-3 border-t border-black/[0.07] space-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left group cursor-pointer"
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-[12px] font-medium text-[#71717a] group-hover:text-[#1d1d1f] transition-colors shrink-0">
                演讲者备注
              </span>
              {!notesOpen && item.speaker_notes && (
                <span className="text-[11.5px] text-[#a1a1aa] truncate">
                  {item.speaker_notes}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#a1a1aa] group-hover:text-[#1d1d1f] shrink-0 transition-transform ${
                notesOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {notesOpen && (
            <AutoGrowTextarea
              id="input-notes"
              value={item.speaker_notes || ""}
              minRows={2}
              placeholder="写下有实质补充的口播提示，导出时将写入 PowerPoint 备注栏…"
              onChange={(val) => onUpdateField("speaker_notes", val)}
              className="text-[13px] text-[#27272a] placeholder-[#a1a1aa] bg-white rounded-xl px-3 py-2 border border-black/[0.1] focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.05] outline-none leading-relaxed transition-all"
            />
          )}
        </section>
      </div>
    </aside>
  );
}
