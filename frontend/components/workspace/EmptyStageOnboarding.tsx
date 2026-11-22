"use client";

import { useState } from "react";
import {
  ClipboardPaste,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Upload,
} from "lucide-react";
import type { Material } from "../../lib/api";
import { formatAssetLabel } from "./SlideInspector";

interface EmptyStageOnboardingProps {
  materials: Material[];
  isGenerating: boolean;
  onUploadClick: () => void;
  onDropFiles: (files: FileList) => void;
  onPasteNote: (title: string, content: string) => Promise<void>;
  onGenerateOutline: (prompt?: string) => void;
}

const PROMPT_PRESETS = [
  "控制在 5 页以内，精炼核心结论",
  "面向技术架构评审，重点提炼性能与指标数据",
  "面向管理层季度复盘，结构按背景→成果→规划展开",
];

export function EmptyStageOnboarding({
  materials,
  isGenerating,
  onUploadClick,
  onDropFiles,
  onPasteNote,
  onGenerateOutline,
}: EmptyStageOnboardingProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [outlinePrompt, setOutlinePrompt] = useState("");

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      await onPasteNote(noteTitle.trim(), noteContent);
      setNoteTitle("");
      setNoteContent("");
      setPasteMode(false);
    } finally {
      setSavingNote(false);
    }
  }

  if (pasteMode) {
    return (
      <section className="flex-1 min-h-0 overflow-y-auto bg-[#ececef] flex items-center justify-center p-6 sm:p-10">
        <form
          onSubmit={(e) => void handleSaveNote(e)}
          className="w-full max-w-[760px] rounded-[18px] bg-white slide-shadow p-7 sm:p-10 space-y-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                直接粘贴文本或 Markdown 笔记
              </h2>
              <p className="text-[13.5px] text-[#6e6e73] mt-0.5">
                保存后将自动切分为可溯源的原始素材切片，无需先在本地新建文件。
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="素材名称（选填，如：2026 架构评审纪要）"
              className="w-full text-[14px] text-[#1d1d1f] placeholder-[#86868b] bg-[#f5f5f7] focus:bg-white rounded-xl px-3.5 py-2.5 border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 outline-none transition-all"
            />
            <textarea
              rows={7}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="在此直接粘贴会议纪要、技术方案、飞书文档或核心数据段落…"
              className="w-full text-[14px] text-[#1d1d1f] placeholder-[#86868b] bg-[#f5f5f7] focus:bg-white rounded-xl px-3.5 py-3 border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 outline-none leading-relaxed resize-y transition-all"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setPasteMode(false)}
              className="px-4 py-2 rounded-full bg-[#f5f5f7] hover:bg-black/[0.07] text-[#1d1d1f] text-[13.5px] font-medium transition-colors cursor-pointer"
            >
              返回
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteContent.trim()}
              className="px-5 py-2 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13.5px] font-medium transition-colors cursor-pointer disabled:opacity-40 shadow-[0_2px_8px_rgba(0,113,227,0.22)]"
            >
              {savingNote ? "正在保存…" : "保存为项目素材"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (materials.length === 0) {
    return (
      <section className="flex-1 min-h-0 overflow-y-auto bg-[#ececef] flex items-center justify-center p-6 sm:p-10">
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
          className={`w-full max-w-[780px] rounded-[18px] bg-white slide-shadow border-2 border-dashed transition-all flex flex-col items-center justify-center text-center p-8 sm:p-11 space-y-5 ${
            isDragging
              ? "border-[#0071e3] bg-[#0071e3]/[0.03]"
              : "border-black/[0.12]"
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-[#0071e3]">
            <Upload className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-md">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
              导入文档素材，或从一句话主题开始
            </h2>
            <p className="text-[14px] text-[#6e6e73] leading-relaxed">
              支持 PDF、Word (.docx)、Markdown、TXT 与图片；凡缺少原始素材依据的数据将自动标记为「待补出处」，绝不编造数字。
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onUploadClick}
              className="px-5 py-2.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] font-medium shadow-[0_2px_8px_rgba(0,113,227,0.22)] cursor-pointer transition-colors"
            >
              选择本地文件 (.md / .pdf / .docx / 图片)
            </button>
            <button
              type="button"
              onClick={() => setPasteMode(true)}
              className="px-5 py-2.5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.07] text-[#1d1d1f] text-[14px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ClipboardPaste className="w-4 h-4 text-[#0071e3]" />
              <span>直接粘贴长文笔记</span>
            </button>
          </div>

          {/* PRD 2.2 Scenario B: Start from a 1-sentence brief */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!outlinePrompt.trim() || isGenerating) return;
              onGenerateOutline(outlinePrompt.trim());
            }}
            className="w-full max-w-lg pt-3 border-t border-black/[0.06] space-y-2"
          >
            <div className="text-[12px] text-[#86868b]">
              还没有现成文档？输入一句话主题先拉出大纲框架：
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={outlinePrompt}
                onChange={(e) => setOutlinePrompt(e.target.value)}
                placeholder="例如：制作一份 6 页的 Q3 产品技术复盘汇报…"
                className="flex-1 text-[13.5px] text-[#1d1d1f] placeholder-[#86868b] bg-[#f5f5f7] focus:bg-white rounded-full px-4 py-2 border border-transparent focus:border-[#0071e3] outline-none transition-all"
              />
              <button
                type="submit"
                disabled={!outlinePrompt.trim() || isGenerating}
                className="px-4 py-2 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
              >
                {isGenerating ? "生成中…" : "生成大纲"}
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 min-h-0 overflow-y-auto bg-[#ececef] flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-[780px] rounded-[18px] bg-white slide-shadow flex flex-col items-center justify-center text-center p-8 sm:p-11 space-y-5">
        <div className="w-13 h-13 rounded-2xl bg-[#34c759]/12 flex items-center justify-center text-[#248a3d]">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
            已就绪 {materials.length} 份原始材料
          </h2>
          <p className="text-[14px] text-[#6e6e73] leading-relaxed">
            AI 将严格按照这些材料切片提炼演示大纲，每一页均保留可追溯的出处引用。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
          {materials.slice(0, 6).map((m, i) => (
            <span
              key={`${m.asset_id}-${m.asset_type}-${i}`}
              title={m.asset_id}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f5f5f7] text-[12.5px] font-medium text-[#1d1d1f]"
            >
              {m.asset_type === "image" ? (
                <ImageIcon className="w-3.5 h-3.5 text-[#0071e3]" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-[#6e6e73]" />
              )}
              <span className="truncate max-w-[140px]">
                {formatAssetLabel(m.asset_id)}
              </span>
            </span>
          ))}
          {materials.length > 6 && (
            <span className="text-[12.5px] text-[#86868b]">
              +{materials.length - 6} 份
            </span>
          )}
        </div>

        {/* Optional Direction / Audience / Page Count Prompt (PRD Stage 2 & F-04) */}
        <div className="w-full max-w-lg space-y-2 text-left bg-[#f5f5f7] p-3.5 rounded-2xl">
          <label className="block text-[12px] font-medium text-[#6e6e73] px-0.5">
            提炼方向与要求（选填：指定目标页数、受众或重点章节）
          </label>
          <input
            type="text"
            value={outlinePrompt}
            onChange={(e) => setOutlinePrompt(e.target.value)}
            placeholder="例如：控制在 6 页以内，面向技术架构评审，重点突出性能数据…"
            className="w-full text-[13.5px] text-[#1d1d1f] placeholder-[#86868b] bg-white rounded-xl px-3.5 py-2 border border-black/[0.07] focus:border-[#0071e3] outline-none transition-all"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setOutlinePrompt(preset)}
                className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-white hover:bg-[#0071e3]/10 text-[#6e6e73] hover:text-[#0071e3] border border-black/[0.06] transition-colors cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => onGenerateOutline(outlinePrompt.trim() || undefined)}
            disabled={isGenerating}
            className="px-6 py-2.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] font-medium transition-colors cursor-pointer disabled:opacity-50 shadow-[0_2px_8px_rgba(0,113,227,0.22)]"
          >
            {isGenerating ? "正在解析并提炼大纲…" : "开始提炼大纲"}
          </button>
          <button
            type="button"
            onClick={onUploadClick}
            className="px-4 py-2.5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.07] text-[#1d1d1f] text-[13.5px] font-medium transition-colors cursor-pointer"
          >
            + 上传文件
          </button>
          <button
            type="button"
            onClick={() => setPasteMode(true)}
            className="px-4 py-2.5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.07] text-[#1d1d1f] text-[13.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-[#0071e3]" />
            <span>粘贴笔记</span>
          </button>
        </div>
      </div>
    </section>
  );
}
