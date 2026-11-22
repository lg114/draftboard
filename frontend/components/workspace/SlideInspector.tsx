"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
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
  const [notesOpen, setNotesOpen] = useState(Boolean(item.speaker_notes));
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [refiningMode, setRefiningMode] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [refineCandidate, setRefineCandidate] =
    useState<SlideRefineCandidate | null>(null);

  useEffect(() => {
    if (item.speaker_notes) setNotesOpen(true);
    setRefineCandidate(null);
  }, [item.outline_item_id, item.speaker_notes]);

  async function triggerRefine(
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ) {
    setRefiningMode(mode);
    try {
      const candidate = await onRefineSlide(mode, instruction);
      if (candidate) {
        setRefineCandidate(candidate);
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

  const inputBase =
    "text-[14.5px] text-[#1d1d1f] placeholder-[#a1a1a6] bg-[#f5f5f7] focus:bg-white rounded-xl px-3.5 py-2.5 border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 outline-none leading-relaxed transition-all";

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
    <aside className="w-[304px] xl:w-[360px] shrink-0 bg-white border-l border-black/[0.07] flex flex-col min-h-0 overflow-y-auto clean-scroll">
      {/* Sticky Inspector Header */}
      <div className="px-5 py-3.5 border-b border-black/[0.06] flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[13.5px] font-semibold text-[#0071e3]">
            第 {slideIndex + 1} 页
          </span>
          <span className="text-[#d2d2d7]">·</span>
          <span className="text-[13.5px] font-medium text-[#6e6e73]">
            {LAYOUT_LABELS[layout] || "正文"}
          </span>
        </div>

        {item.evidence_status === "supported" && item.source_ids.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#248a3d] bg-[#34c759]/12 px-2.5 py-0.5 rounded-full whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
            依据充分
          </span>
        ) : item.evidence_status === "partial" && item.source_ids.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#b25000] bg-[#ff9500]/14 px-2.5 py-0.5 rounded-full whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff9500]" />
            部分依据
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setSourcePickerOpen(true)}
            title="点击为本页关联原始素材出处"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#b25000] bg-[#ff9500]/14 hover:bg-[#ff9500]/22 px-2.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff9500]" />
            待补出处 · 点击关联
          </button>
        )}
      </div>

      {/* Natural Top-to-Bottom Editorial Flow */}
      <div className="p-5 space-y-5 flex-1">
        {/* In-place Slide QA Issues */}
        {slideIssues.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-[#fff2f2] border border-[#ff3b30]/20 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12.5px] font-semibold text-[#d70015]">
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

        {/* Title */}
        <div className="space-y-1.5">
          <label
            htmlFor="input-title"
            className="block text-[12.5px] font-medium text-[#6e6e73]"
          >
            幻灯片标题
          </label>
          <input
            id="input-title"
            type="text"
            value={item.title}
            onChange={(e) => onUpdateField("title", e.target.value)}
            placeholder="输入本页主标题…"
            className={`w-full text-[17.5px] font-semibold tracking-[-0.02em] text-[#1d1d1f] placeholder-[#a1a1a6] bg-[#f5f5f7] focus:bg-white rounded-xl px-3.5 py-2.5 border outline-none transition-all leading-snug ${
              missingTitle
                ? "border-[#ff3b30]/60 focus:border-[#ff3b30]"
                : "border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10"
            }`}
          />
          {missingTitle && (
            <p className="text-[12px] text-[#d70015]">标题不能为空</p>
          )}
        </div>

        {/* Layout-Aware Body Editors */}
        {layout === "two_column" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="input-summary"
                className="block text-[12.5px] font-medium text-[#6e6e73]"
              >
                左栏内容
              </label>
              <AutoGrowTextarea
                id="input-summary"
                value={item.summary}
                minRows={3}
                placeholder="输入左栏要点或对比项…"
                onChange={(val) => onUpdateField("summary", val)}
                className={inputBase}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="input-col-right"
                  className="block text-[12.5px] font-medium text-[#6e6e73]"
                >
                  右栏内容
                </label>
                {canSplitSummary && (
                  <button
                    type="button"
                    onClick={onSplitTwoColumn}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[#0071e3] hover:underline cursor-pointer"
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
                className={`${inputBase} ${
                  missingColRight ? "!border-[#ff9500]/70" : ""
                }`}
              />
              {missingColRight && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <p className="text-[12px] text-[#b25000]">
                    双栏对比版式需填写右栏内容后才能保存
                  </p>
                  {canSplitSummary && (
                    <button
                      type="button"
                      onClick={onSplitTwoColumn}
                      className="px-2.5 py-1 rounded-full bg-[#0071e3]/10 hover:bg-[#0071e3]/16 text-[#0071e3] text-[11.5px] font-medium transition-colors cursor-pointer"
                    >
                      一键拆入右栏
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : layout === "text_image" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="input-summary"
                className="block text-[12.5px] font-medium text-[#6e6e73]"
              >
                左侧说明文案
              </label>
              <AutoGrowTextarea
                id="input-summary"
                value={item.summary}
                minRows={3}
                placeholder="输入左侧要点说明…"
                onChange={(val) => onUpdateField("summary", val)}
                className={inputBase}
              />
            </div>

            {/* Visual Thumbnail Image Picker */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-[#6e6e73]">
                  右侧配图
                </span>
                <button
                  type="button"
                  onClick={onUploadClick}
                  className="text-[12px] text-[#0071e3] hover:underline font-medium cursor-pointer"
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
                        className={`group rounded-xl overflow-hidden bg-[#f5f5f7] p-1.5 text-left transition-all cursor-pointer ${
                          selected
                            ? "ring-2 ring-[#0071e3] bg-[#0071e3]/[0.06]"
                            : "ring-1 ring-black/[0.08] hover:ring-black/20"
                        }`}
                      >
                        <div className="aspect-[16/10] rounded-lg bg-white overflow-hidden flex items-center justify-center mb-1">
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
                  className="w-full py-5 px-3 rounded-2xl border border-dashed border-black/[0.15] hover:border-[#0071e3] bg-[#f5f5f7]/60 hover:bg-[#0071e3]/[0.03] flex flex-col items-center justify-center gap-1.5 text-[#6e6e73] hover:text-[#0071e3] transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-2xs">
                    <Plus className="w-4 h-4" />
                  </div>
                  <span className="text-[12.5px] font-medium">
                    上传 PNG / JPG 配图
                  </span>
                </button>
              )}

              {missingImage && (
                <p className="text-[12px] text-[#b25000] flex items-center gap-1">
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
              className="block text-[12.5px] font-medium text-[#6e6e73]"
            >
              {layout === "bullets"
                ? "分点要点（每行一条）"
                : layout === "cover"
                ? "副标题 / 演讲信息"
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
              className={`${inputBase} ${
                missingSummary ? "!border-[#ff3b30]/60" : ""
              }`}
            />
            {missingSummary && (
              <p className="text-[12px] text-[#d70015]">正文内容不能为空</p>
            )}
          </div>
        )}

        {/* Single-Slide AI Refinement & Diff Preview (PRD F-12) */}
        <div className="pt-3 border-t border-black/[0.06] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#6e6e73]">
              <Sparkles className="w-3.5 h-3.5 text-[#0071e3]" />
              <span>AI 本页精修</span>
            </span>
            <button
              type="button"
              onClick={() => setCustomOpen((v) => !v)}
              className="text-[11.5px] text-[#0071e3] hover:underline font-medium cursor-pointer"
            >
              {customOpen ? "收起指令" : "自定义指令"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={Boolean(refiningMode)}
              onClick={() => void triggerRefine("concise")}
              className="px-2.5 py-1 rounded-full bg-[#f5f5f7] hover:bg-[#0071e3]/10 text-[#1d1d1f] hover:text-[#0071e3] text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {refiningMode === "concise" ? "精简中…" : "精简字数防超框"}
            </button>
            <button
              type="button"
              disabled={Boolean(refiningMode)}
              onClick={() => void triggerRefine("bullets")}
              className="px-2.5 py-1 rounded-full bg-[#f5f5f7] hover:bg-[#0071e3]/10 text-[#1d1d1f] hover:text-[#0071e3] text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {refiningMode === "bullets" ? "提炼中…" : "提炼为分点"}
            </button>
            <button
              type="button"
              disabled={Boolean(refiningMode)}
              onClick={() => void triggerRefine("two_column")}
              className="px-2.5 py-1 rounded-full bg-[#f5f5f7] hover:bg-[#0071e3]/10 text-[#1d1d1f] hover:text-[#0071e3] text-[12px] font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {refiningMode === "two_column" ? "拆分中…" : "改写为双栏对比"}
            </button>
          </div>

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
                placeholder="输入修改要求（如：更精炼、补充性能指标）…"
                className="flex-1 min-w-0 text-[12.5px] text-[#1d1d1f] placeholder-[#86868b] bg-[#f5f5f7] focus:bg-white rounded-xl px-3 py-1.5 border border-transparent focus:border-[#0071e3] outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={!customInstruction.trim() || Boolean(refiningMode)}
                className="px-3 py-1.5 rounded-xl bg-[#0071e3] hover:bg-[#0077ed] text-white text-[12px] font-medium cursor-pointer disabled:opacity-40 shrink-0"
              >
                {refiningMode === "custom" ? "生成中…" : "生成建议"}
              </button>
            </form>
          )}

          {/* Non-Destructive Diff Candidate Card */}
          {refineCandidate && (
            <div className="p-3.5 rounded-2xl bg-[#0071e3]/[0.05] border border-[#0071e3]/25 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[#0071e3] flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 修改建议 · 确认后生效</span>
                </span>
                {refineCandidate.layout && (
                  <span className="text-[11px] font-medium text-[#0071e3] bg-white px-2 py-0.5 rounded-full border border-[#0071e3]/20">
                    建议版式：{LAYOUT_LABELS[refineCandidate.layout] || refineCandidate.layout}
                  </span>
                )}
              </div>

              {refineCandidate.rationale && (
                <p className="text-[11.5px] text-[#6e6e73] leading-snug">
                  {refineCandidate.rationale}
                </p>
              )}

              <div className="p-2.5 rounded-xl bg-white border border-black/[0.06] space-y-1.5 text-[12.5px]">
                {refineCandidate.title !== item.title && (
                  <div className="font-semibold text-[#1d1d1f] pb-1 border-b border-black/[0.05]">
                    标题：{refineCandidate.title}
                  </div>
                )}
                <div className="text-[#1d1d1f] whitespace-pre-wrap leading-relaxed">
                  {refineCandidate.summary}
                </div>
                {refineCandidate.layout === "two_column" &&
                  refineCandidate.column_right && (
                    <div className="pt-1.5 border-t border-black/[0.06] text-[#1d1d1f] whitespace-pre-wrap leading-relaxed">
                      <span className="text-[11px] font-semibold text-[#6e6e73] block mb-0.5">
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
                  className="px-3 py-1 rounded-full text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer"
                >
                  放弃
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onApplyRefineCandidate(refineCandidate);
                    setRefineCandidate(null);
                  }}
                  className="px-3.5 py-1 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[12px] font-medium transition-colors cursor-pointer"
                >
                  确认应用
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Collapsible Speaker Notes */}
        <div className="pt-4 border-t border-black/[0.06] space-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen(!notesOpen)}
            className="w-full flex items-center justify-between text-[13px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer"
          >
            <span>演讲者备注</span>
            <span className="text-[12px] text-[#86868b]">
              {notesOpen ? "收起" : item.speaker_notes ? "已填写" : "展开"}
            </span>
          </button>
          {notesOpen && (
            <AutoGrowTextarea
              id="input-notes"
              value={item.speaker_notes || ""}
              minRows={2}
              placeholder="写下口播提示，导出时将写入 PowerPoint 备注栏…"
              onChange={(val) => onUpdateField("speaker_notes", val)}
              className="text-[13.5px] text-[#1d1d1f] placeholder-[#a1a1a6] bg-[#f5f5f7] focus:bg-white rounded-xl px-3.5 py-2.5 border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 outline-none leading-relaxed transition-all"
            />
          )}
        </div>

        {/* Always-Visible Companion Source Provenance & Manual Source Binding */}
        <div className="pt-4 border-t border-black/[0.06] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-[#6e6e73] whitespace-nowrap">
              材料出处对照
              {matchedFragments.length > 0 && (
                <span className="ml-1.5 text-[11.5px] font-normal text-[#86868b]">
                  ({matchedFragments.length})
                </span>
              )}
            </span>

            <button
              type="button"
              onClick={() => setSourcePickerOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0071e3] hover:underline cursor-pointer whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{sourcePickerOpen ? "收起素材列表" : "+ 关联素材"}</span>
            </button>
          </div>

          {/* Inline Source Binding Picker */}
          {sourcePickerOpen && (
            <div className="p-3 rounded-2xl bg-[#f5f5f7] border border-black/[0.07] space-y-2">
              <div className="flex items-center justify-between text-[11.5px] text-[#6e6e73]">
                <span>勾选本页引用的原始素材切片：</span>
                <button
                  type="button"
                  onClick={() => setSourcePickerOpen(false)}
                  className="text-[#86868b] hover:text-[#1d1d1f] cursor-pointer"
                >
                  完成
                </button>
              </div>

              {sourceFragments.length > 0 ? (
                <div className="space-y-1.5 max-h-[210px] overflow-y-auto clean-scroll pr-0.5">
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
                            ? "bg-white ring-1.5 ring-[#0071e3] shadow-2xs"
                            : "bg-white/70 hover:bg-white ring-1 ring-black/[0.06]"
                        }`}
                      >
                        <div
                          className={`mt-0.5 w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                            bound
                              ? "bg-[#0071e3] text-white"
                              : "border border-black/20 bg-white"
                          }`}
                        >
                          {bound && <Check className="w-3 h-3 stroke-[2.5]" />}
                        </div>

                        {isImg ? (
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="w-10 h-7 rounded bg-[#f5f5f7] overflow-hidden shrink-0 flex items-center justify-center border border-black/[0.06]">
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
                              <div className="text-[11px] text-[#86868b]">
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
                              <span className="text-[10.5px] text-[#86868b] shrink-0">
                                {frag.location}
                              </span>
                            </div>
                            <p className="text-[11.5px] text-[#6e6e73] line-clamp-2 leading-snug">
                              {excerpt || "文本切片"}
                            </p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[12px] text-[#86868b] py-2 text-center">
                  项目暂无素材切片，请先上传文件或粘贴笔记。
                </div>
              )}
            </div>
          )}

          {/* Bound Provenance Cards */}
          {matchedFragments.length > 0 ? (
            <div className="space-y-2.5">
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
                      className="p-3 rounded-2xl bg-[#f5f5f7] space-y-2.5 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ImageIcon className="w-3.5 h-3.5 text-[#0071e3] shrink-0" />
                          <span
                            className="text-[12px] font-semibold text-[#1d1d1f] truncate"
                            title={frag.asset_id}
                          >
                            {formatAssetLabel(frag.asset_id)}
                          </span>
                          <span className="text-[11px] text-[#86868b] bg-black/[0.05] px-1.5 py-0.2 rounded-md shrink-0">
                            图片素材
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleSourceId(frag.source_id)}
                          title="解除该素材与本页的关联"
                          className="text-[#86868b] hover:text-[#d70015] p-0.5 rounded opacity-70 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="aspect-[16/9] w-full rounded-xl bg-white border border-black/[0.06] overflow-hidden flex items-center justify-center p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/projects/${pid}/assets/${encodeURIComponent(
                            frag.asset_id
                          )}`}
                          alt={frag.asset_id}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        {isCurrentSlideImage ? (
                          <span className="text-[11.5px] font-medium text-[#248a3d] flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            <span>已设为本页配图</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onApplyImageToSlide(frag.asset_id, frag.source_id)
                            }
                            className="text-[12px] font-medium text-[#0071e3] hover:underline cursor-pointer"
                          >
                            设为本页配图（切为图文页）
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={frag.source_id}
                    className="p-3.5 rounded-2xl bg-[#f5f5f7] space-y-2 group"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11.5px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-[#6e6e73] shrink-0" />
                        <span
                          className="font-semibold text-[#1d1d1f] truncate"
                          title={frag.asset_id}
                        >
                          {formatAssetLabel(frag.asset_id)}
                        </span>
                        <span className="text-[#86868b] shrink-0">
                          · {frag.location.replace(/^L/, "第 ")} 行
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleSourceId(frag.source_id)}
                        title="解除该素材与本页的关联"
                        className="text-[#86868b] hover:text-[#d70015] p-0.5 rounded opacity-70 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[12.5px] text-[#424245] leading-relaxed whitespace-pre-wrap max-h-[140px] overflow-y-auto clean-scroll">
                      {excerpt || "（该文本切片为空）"}
                    </p>

                    {excerpt && (
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-black/[0.05] text-[11.5px]">
                        <button
                          type="button"
                          onClick={() => fillFromExcerpt("summary", excerpt)}
                          className="text-[#0071e3] hover:underline font-medium cursor-pointer"
                        >
                          {layout === "two_column" ? "填入左栏" : "填入正文"}
                        </button>
                        {layout === "two_column" && (
                          <>
                            <span className="text-[#d2d2d7]">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                fillFromExcerpt("column_right", excerpt)
                              }
                              className="text-[#0071e3] hover:underline font-medium cursor-pointer"
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
            <div className="p-3.5 rounded-2xl bg-[#fff8ee] border border-[#ff9500]/20 space-y-2">
              <div className="text-[12.5px] font-semibold text-[#b25000]">
                {item.source_ids.length > 0
                  ? "未检索到对应素材切片"
                  : "本页尚未关联原始素材"}
              </div>
              <p className="text-[12px] text-[#6e6e73] leading-relaxed">
                关联原始素材切片或配图后，既可随时对照原文，也能标记本页为「依据充分」。
              </p>
              {sourceFragments.length > 0 && !sourcePickerOpen && (
                <button
                  type="button"
                  onClick={() => setSourcePickerOpen(true)}
                  className="px-3 py-1 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[12px] font-medium transition-colors cursor-pointer"
                >
                  选择关联素材
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
