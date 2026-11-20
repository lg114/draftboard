"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import type { Outline, OutlineLayout } from "../../lib/api";
import type { WorkspaceStage } from "./WorkspaceHeader";

export const OUTLINE_LAYOUT_OPTIONS: { value: OutlineLayout; label: string }[] = [
  { value: "cover", label: "封面" },
  { value: "content", label: "正文" },
  { value: "bullets", label: "分点要点" },
  { value: "closing", label: "致谢尾页" },
];

export const OUTLINE_LAYOUT_LABELS: Record<string, string> = {
  cover: "封面",
  content: "正文",
  bullets: "分点要点",
  closing: "致谢尾页",
};

export function inferEffectiveLayout(
  layout: string | null | undefined,
  index: number,
  total: number
): OutlineLayout {
  if (
    layout === "cover" ||
    layout === "content" ||
    layout === "bullets" ||
    layout === "closing"
  ) {
    return layout;
  }
  if (index === 0) return "cover";
  if (index === total - 1 && total > 1) return "closing";
  return "content";
}

interface OutlineEditorProps {
  currentStage: WorkspaceStage;
  materialsCount: number;
  outline: Outline | null;
  selectedIndex: number;
  isGenerating: boolean;
  onSelectIndex: (idx: number) => void;
  onUploadClick: () => void;
  onDropFiles: (files: FileList) => void;
  onGenerateOutline: () => void;
  onUpdateItem: (
    index: number,
    field: "title" | "summary" | "layout",
    value: string
  ) => void;
  onMoveItem: (index: number, delta: number) => void;
  onAddItem: () => void;
  onDeleteItem: (index: number) => void;
}

export function OutlineEditor({
  currentStage,
  materialsCount,
  outline,
  selectedIndex,
  isGenerating,
  onSelectIndex,
  onUploadClick,
  onDropFiles,
  onGenerateOutline,
  onUpdateItem,
  onMoveItem,
  onAddItem,
  onDeleteItem,
}: OutlineEditorProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [activeLayoutDropdownIdx, setActiveLayoutDropdownIdx] = useState<
    number | null
  >(null);

  return (
    <div className="lg:col-span-7 bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-bento space-y-4 min-h-[580px] flex flex-col justify-between transition-all duration-200">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6]">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-base text-[#111827] tracking-tight">
                大纲
              </h2>
              {outline && (
                <span className="text-xs font-mono text-[#4b5563] bg-[#f3f4f6] border border-[#e5e7eb] px-2 py-0.5 rounded-lg">
                  {outline.items.length} 页
                </span>
              )}
            </div>
            <p className="text-xs text-[#6b7280]">
              支持修改标题、要点、版式以及增删与排序；人工新增页将自动标记为「待补充出处」。
            </p>
          </div>

          {outline && outline.items.length > 0 && (
            <button
              type="button"
              onClick={onAddItem}
              className="px-3 py-1 bg-white hover:bg-[#f9fafb] text-[#374151] border border-[#e5e7eb] rounded-xl text-xs font-medium shadow-2xs transition-colors flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5 text-[#6b7280]" />
              <span>添加一页</span>
            </button>
          )}
        </div>

        {/* Stage 1: No Materials */}
        {currentStage === "no_materials" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              onDropFiles(e.dataTransfer.files);
            }}
            onClick={onUploadClick}
            className={`py-16 px-6 text-center rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 ${
              isDragging
                ? "border-[#4f46e5] bg-[#eef2ff]/50"
                : "border-[#d1d5db] hover:border-[#9ca3af] bg-[#f9fafb] hover:bg-[#f3f4f6]"
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-white shadow-2xs border border-[#eaecf0] flex items-center justify-center text-[#374151]">
              <Upload className="w-5 h-5 text-[#4f46e5]" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <div className="text-sm font-semibold text-[#111827]">
                第一步：投入原始材料
              </div>
              <p className="text-xs text-[#6b7280] leading-relaxed">
                点击选择或直接将 Markdown (.md / .txt) 笔记、数据切片或图片拖入此处。
              </p>
            </div>
            <span className="px-4 py-2 bg-[#111827] hover:bg-black text-white rounded-xl text-xs font-medium shadow-xs">
              选择本地文件
            </span>
            <span className="text-[11px] text-[#9ca3af]">
              系统将严格以你上传的内容为事实基准，绝不编造虚构内容。
            </span>
          </div>
        )}

        {/* Stage 2: Has Materials, No Outline */}
        {currentStage === "has_materials_no_outline" && (
          <div className="py-12 px-6 text-center rounded-2xl border border-[#eaecf0] bg-[#f9fafb] space-y-4">
            <div className="w-10 h-10 rounded-xl bg-[#ecfdf5] border border-[#a7f3d0] flex items-center justify-center mx-auto text-[#059669]">
              <FileText className="w-5 h-5" />
            </div>
            <div className="space-y-1.5 max-w-sm mx-auto">
              <div className="text-sm font-semibold text-[#111827]">
                已导入 {materialsCount} 份材料
              </div>
              <p className="text-xs text-[#6b7280] leading-relaxed">
                原始材料已就绪，点击下方按钮让 AI 梳理结构化大纲并建立事实引用索引。
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={onGenerateOutline}
                disabled={isGenerating}
                className="w-full sm:w-auto px-5 py-2.5 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#34d399]" />
                <span>{isGenerating ? "正在提炼大纲..." : "开始提炼大纲"}</span>
              </button>
              <button
                type="button"
                onClick={onUploadClick}
                className="w-full sm:w-auto px-4 py-2.5 bg-white border border-[#eaecf0] hover:bg-[#f9fafb] text-[#374151] text-xs font-medium rounded-xl transition-colors cursor-pointer shadow-2xs"
              >
                + 继续上传素材
              </button>
            </div>
          </div>
        )}

        {/* Stage 3 & 4: Sequential Block Outline Editor */}
        {outline && outline.items.length > 0 && (
          <div className="space-y-2.5">
            {outline.items.map((item, idx) => {
              const isActive = idx === selectedIndex;
              const effectiveLayout = inferEffectiveLayout(
                item.layout,
                idx,
                outline.items.length
              );
              const isImplicitLayout = !item.layout;

              return (
                <div
                  key={item.outline_item_id}
                  onClick={() => onSelectIndex(idx)}
                  className={`doc-block-transition pl-3.5 pr-3 py-3 rounded-xl transition-all cursor-pointer relative border ${
                    isActive
                      ? "border-[#e5e7eb] bg-[#f8f9fa] shadow-2xs border-l-[3.5px] border-l-[#4f46e5]"
                      : "border-[#e5e7eb]/80 bg-white hover:bg-[#f8f9fa]/70 hover:border-[#cbd5e1]"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#6b7280]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>

                      {/* Layout Selector (only backend-supported outline layouts) */}
                      <div
                        className="relative"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setActiveLayoutDropdownIdx(
                              activeLayoutDropdownIdx === idx ? null : idx
                            )
                          }
                          className="text-[11px] font-sans bg-white hover:bg-[#f9fafb] border border-[#eaecf0] hover:border-[#d1d5db] rounded-lg px-2 py-0.5 text-[#374151] shadow-2xs flex items-center gap-1 cursor-pointer transition-colors"
                          title="切换页面排版布局"
                        >
                          <span>
                            {OUTLINE_LAYOUT_LABELS[effectiveLayout] || "正文"}
                            {isImplicitLayout ? " (默认)" : ""}
                          </span>
                          <ChevronDown
                            className={`w-3 h-3 text-[#6b7280] transition-transform duration-150 ${
                              activeLayoutDropdownIdx === idx ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        {activeLayoutDropdownIdx === idx && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setActiveLayoutDropdownIdx(null)}
                            />
                            <div className="absolute left-0 top-full mt-1.5 z-50 w-36 bg-white border border-[#eaecf0] rounded-xl shadow-xl p-1 space-y-0.5 animate-in fade-in zoom-in-95 duration-150">
                              {OUTLINE_LAYOUT_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => {
                                    onUpdateItem(idx, "layout", opt.value);
                                    setActiveLayoutDropdownIdx(null);
                                  }}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                    effectiveLayout === opt.value
                                      ? "bg-[#f3f4f6] text-[#111827] font-semibold"
                                      : "text-[#374151] hover:bg-[#f9fafb]"
                                  }`}
                                >
                                  <span>{opt.label}</span>
                                  {effectiveLayout === opt.value && (
                                    <Check className="w-3 h-3 text-[#4f46e5]" />
                                  )}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {effectiveLayout === "bullets" && (
                        <span className="text-[10px] text-[#6b7280] hidden sm:inline">
                          每行一条要点
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Evidence Status Pill */}
                      <span
                        className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1.5 shadow-2xs ${
                          item.evidence_status === "supported"
                            ? "bg-[#ecfdf5] text-[#059669] border border-[#a7f3d0]/60"
                            : item.evidence_status === "partial"
                            ? "bg-[#fef3c7] text-[#b45309] border border-[#fde68a]/60"
                            : "bg-[#fdf2f8] text-[#db2777] border border-[#fbcfe8]/60"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            item.evidence_status === "supported"
                              ? "bg-[#10b981]"
                              : item.evidence_status === "partial"
                              ? "bg-[#f59e0b]"
                              : "bg-[#f43f5e]"
                          }`}
                        />
                        <span>
                          {item.evidence_status === "supported"
                            ? "依据充分"
                            : item.evidence_status === "partial"
                            ? "部分依据"
                            : "待补充出处"}
                        </span>
                      </span>

                      {/* Reorder & Delete */}
                      <div
                        className="flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onMoveItem(idx, -1)}
                          title="上移"
                          className="p-1 text-[#9ca3af] hover:text-[#374151] disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === outline.items.length - 1}
                          onClick={() => onMoveItem(idx, 1)}
                          title="下移"
                          className="p-1 text-[#9ca3af] hover:text-[#374151] disabled:opacity-20 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        {outline.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onDeleteItem(idx)}
                            title="删除此页"
                            className="p-1 text-[#9ca3af] hover:text-[#e11d48] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Editable Title */}
                  <input
                    value={item.title}
                    onChange={(e) => onUpdateItem(idx, "title", e.target.value)}
                    placeholder="输入幻灯片标题..."
                    className="w-full font-semibold text-sm text-[#111827] bg-transparent border-b border-transparent hover:border-[#e5e7eb] focus:border-[#4f46e5] focus:bg-white rounded-md px-1 py-0.5 outline-none transition-all"
                  />

                  {/* Editable Summary */}
                  <textarea
                    rows={effectiveLayout === "bullets" ? 3 : 2}
                    value={item.summary}
                    onChange={(e) =>
                      onUpdateItem(idx, "summary", e.target.value)
                    }
                    placeholder={
                      effectiveLayout === "bullets"
                        ? "每行输入一条分点要点..."
                        : "输入本页正文摘要..."
                    }
                    className="w-full text-xs text-[#4b5563] bg-transparent border-b border-transparent hover:border-[#e5e7eb] focus:border-[#4f46e5] focus:bg-white rounded-md px-1 py-0.5 outline-none mt-1 leading-relaxed resize-y transition-all"
                  />

                  {/* Sources Footer */}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-[#6b7280] pt-2 border-t border-[#f3f4f6]">
                    <span className="font-mono text-[#4b5563] bg-white border border-[#eaecf0] px-2 py-0.5 rounded text-[10px] truncate max-w-[80%]">
                      材料出处:{" "}
                      {item.source_ids.length > 0
                        ? item.source_ids.join(", ")
                        : "暂无引用（人工编写）"}
                    </span>
                    {isActive && (
                      <span className="text-[#4f46e5] font-semibold whitespace-nowrap text-[11px]">
                        当前聚焦
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Footer */}
      <div className="pt-3 border-t border-[#f3f4f6] text-xs text-[#9ca3af] flex items-center justify-between">
        <span>修改已确认大纲时会自动派生新草稿版本，不影响已导出的 PPTX。</span>
        {materialsCount > 0 && (
          <button
            type="button"
            onClick={onUploadClick}
            className="text-[#6b7280] hover:text-[#111827] underline text-xs cursor-pointer shrink-0 ml-2"
          >
            + 添加更多材料
          </button>
        )}
      </div>
    </div>
  );
}
