"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Plus } from "lucide-react";
import type {
  Issue,
  Material,
  OutlineItem,
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
  onUploadClick: () => void;
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
  onUploadClick,
}: SlideInspectorProps) {
  const [notesOpen, setNotesOpen] = useState(Boolean(item.speaker_notes));

  useEffect(() => {
    if (item.speaker_notes) setNotesOpen(true);
  }, [item.outline_item_id, item.speaker_notes]);

  const layout = inferEffectiveLayout(item.layout, slideIndex, totalSlides);
  const imageAssets = materials.filter((m) => m.asset_type === "image");

  const matchedFragments = item.source_ids
    .map((sid) => sourceFragments.find((f) => f.source_id === sid))
    .filter((f): f is SourceFragment => Boolean(f));

  const missingTitle = !item.title.trim();
  const missingSummary = !item.summary.trim();
  const missingColRight =
    layout === "two_column" && !(item.column_right && item.column_right.trim());
  const missingImage =
    layout === "text_image" &&
    !(item.image_asset_id && item.image_asset_id.trim());

  const inputBase =
    "text-[14.5px] text-[#1d1d1f] placeholder-[#a1a1a6] bg-[#f5f5f7] focus:bg-white rounded-xl px-3.5 py-2.5 border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 outline-none leading-relaxed transition-all";

  return (
    <aside className="w-[304px] xl:w-[360px] shrink-0 bg-white border-l border-black/[0.07] flex flex-col h-full overflow-y-auto clean-scroll">
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

        {item.evidence_status === "supported" ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#248a3d] bg-[#34c759]/12 px-2.5 py-0.5 rounded-full whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
            依据充分
          </span>
        ) : item.evidence_status === "partial" ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#b25000] bg-[#ff9500]/14 px-2.5 py-0.5 rounded-full whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff9500]" />
            部分依据
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#b25000] bg-[#ff9500]/14 px-2.5 py-0.5 rounded-full whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff9500]" />
            待补充出处
          </span>
        )}
      </div>

      {/* Natural Top-to-Bottom Editorial Flow */}
      <div className="p-5 space-y-5 flex-1">
        {/* In-place Slide QA Issues (if any belong to this slide) */}
        {slideIssues.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-[#fff2f2] border border-[#ff3b30]/20 space-y-1">
            <div className="text-[12.5px] font-semibold text-[#d70015]">
              本页排版校验未通过
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
              <label
                htmlFor="input-col-right"
                className="block text-[12.5px] font-medium text-[#6e6e73]"
              >
                右栏内容
              </label>
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
                <p className="text-[12px] text-[#b25000]">
                  双栏对比版式需要填写右栏内容后才能保存
                </p>
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
                <div className="grid grid-cols-3 gap-2">
                  {imageAssets.map((img, i) => {
                    const selected = item.image_asset_id === img.asset_id;
                    return (
                      <button
                        key={`${img.asset_id}-${i}`}
                        type="button"
                        onClick={() =>
                          onUpdateField("image_asset_id", img.asset_id)
                        }
                        className={`group rounded-xl overflow-hidden bg-[#f5f5f7] p-1.5 text-left transition-all cursor-pointer ${
                          selected
                            ? "ring-2 ring-[#0071e3] bg-[#0071e3]/[0.06]"
                            : "ring-1 ring-black/[0.08] hover:ring-black/20"
                        }`}
                      >
                        <div className="aspect-[4/3] rounded-lg bg-white overflow-hidden flex items-center justify-center mb-1">
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
                          {img.asset_id}
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

        {/* Always-Visible Companion Source Provenance */}
        <div className="pt-4 border-t border-black/[0.06] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-[#6e6e73] whitespace-nowrap">
              材料出处对照
            </span>
            <span className="text-[11.5px] text-[#86868b] font-mono truncate">
              {item.source_ids.length > 0
                ? item.source_ids.join(", ")
                : "无绑定切片"}
            </span>
          </div>

          {matchedFragments.length > 0 ? (
            <div className="space-y-2">
              {matchedFragments.map((frag) => (
                <div
                  key={frag.source_id}
                  className="p-3.5 rounded-2xl bg-[#f5f5f7] space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[11.5px]">
                    <span className="font-mono font-semibold text-[#1d1d1f]">
                      {frag.source_id}
                    </span>
                    <span className="text-[#86868b] truncate">
                      {frag.asset_id} · {frag.location}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#424245] leading-relaxed">
                    {frag.content_preview || "[图片素材占位，无文本摘录]"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-[#fff8ee] border border-[#ff9500]/20 space-y-1">
              <div className="text-[12.5px] font-semibold text-[#b25000]">
                {item.source_ids.length > 0
                  ? "未检索到片段摘录"
                  : "人工补充内容 · 待核验"}
              </div>
              <p className="text-[12.5px] text-[#6e6e73] leading-relaxed">
                {item.source_ids.length > 0
                  ? "已记录出处编号，但当前素材切片索引暂无预览文本。"
                  : "该页未关联原始素材切片，正式导出前请确认事实与数字准确。"}
              </p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
