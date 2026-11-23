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
      <section className="flex-1 min-h-0 overflow-y-auto bg-[#dcdce1] flex items-center justify-center p-6 sm:p-10">
        <form
          onSubmit={(e) => void handleSaveNote(e)}
          className="w-full max-w-[760px] rounded-[18px] bg-white border border-black/[0.08] p-7 sm:p-10 space-y-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                直接粘贴文本或 Markdown 笔记
              </h2>
              <p className="text-[13.5px] text-[#52525b] mt-0.5">
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
              className="w-full h-11 text-[14px] text-[#1d1d1f] placeholder-[#71717a] bg-[#f5f5f7] border border-black/[0.12] rounded-xl px-4 outline-none transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-black/30 focus:bg-white focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.08]"
            />
            <textarea
              rows={7}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="在此直接粘贴会议纪要、技术方案、飞书文档或核心数据段落…"
              className="w-full text-[14px] text-[#1d1d1f] placeholder-[#71717a] bg-[#f5f5f7] border border-black/[0.12] rounded-xl px-4 py-3 outline-none leading-relaxed resize-y transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-black/30 focus:bg-white focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.08]"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setPasteMode(false)}
              className="h-10 px-4 rounded-full bg-transparent hover:bg-black/[0.05] text-[#52525b] hover:text-[#1d1d1f] text-[13.5px] font-medium transition-colors cursor-pointer"
            >
              返回
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteContent.trim()}
              className="h-10 px-5 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[13.5px] font-medium transition-colors duration-200 cursor-pointer disabled:bg-[#e4e4e7] disabled:text-[#52525b] disabled:cursor-not-allowed"
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
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) {
            onDropFiles(e.dataTransfer.files);
          }
        }}
        className="flex-1 min-h-0 overflow-y-auto bg-[#dcdce1] flex items-center justify-center p-6 sm:p-10"
      >
        <div
          className={`w-full max-w-[780px] rounded-[18px] bg-white border-2 border-dashed transition-colors duration-200 flex flex-col items-center justify-center text-center p-8 sm:p-11 space-y-5 ${
            isDragging
              ? "border-[#1d1d1f] bg-[#fafafa]"
              : "border-[#8e9099]"
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-[#1d1d1f]">
            <Upload className="w-6 h-6" />
          </div>

          <div className="space-y-1.5 max-w-md">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
              导入文档素材，或从一句话主题开始
            </h2>
            <p className="text-[14px] text-[#52525b] leading-relaxed">
              支持 PDF、Word、Markdown、TXT 和图片。
              <br />
              缺少依据的数据会标记为「待补出处」，不会编造数字。
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onUploadClick}
              className="h-11 px-6 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[14px] font-medium cursor-pointer transition-colors duration-200"
            >
              选择文件
            </button>
            <button
              type="button"
              onClick={() => setPasteMode(true)}
              className="h-11 px-5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] text-[#1d1d1f] text-[14px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-200"
            >
              <ClipboardPaste className="w-4 h-4 text-[#1d1d1f]" />
              <span>直接粘贴长文笔记</span>
            </button>
          </div>

          {/* Low-weight fallback path: start from a 1-sentence topic */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!outlinePrompt.trim() || isGenerating) return;
              onGenerateOutline(outlinePrompt.trim());
            }}
            className="w-full max-w-lg pt-4 border-t border-black/[0.07] space-y-2.5"
          >
            <div className="text-[13px] text-[#52525b]">
              没有现成文档？输入一句话主题，先生成大纲。
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <input
                type="text"
                value={outlinePrompt}
                onChange={(e) => setOutlinePrompt(e.target.value)}
                disabled={isGenerating}
                placeholder="例如：制作一份 6 页的 Q3 产品技术复盘汇报…"
                className="flex-1 h-11 rounded-full bg-[#f5f5f7] border border-black/[0.12] px-5 text-[14px] text-[#1d1d1f] placeholder-[#71717a] outline-none transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-black/30 focus:bg-white focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.08] disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!outlinePrompt.trim() || isGenerating}
                className="h-11 px-5 rounded-full bg-white border border-black/25 hover:border-[#1d1d1f] hover:bg-black/[0.04] text-[#1d1d1f] text-[13px] font-medium transition-colors duration-200 shrink-0 cursor-pointer disabled:bg-[#f4f4f5] disabled:border-black/[0.1] disabled:text-[#71717a] disabled:cursor-not-allowed whitespace-nowrap"
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
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
      className="flex-1 min-h-0 overflow-y-auto bg-[#dcdce1] flex items-center justify-center p-6 sm:p-10"
    >
      <div
        className={`w-full max-w-[780px] rounded-[18px] bg-white border transition-colors duration-200 flex flex-col items-center justify-center text-center p-8 sm:p-11 space-y-5 ${
          isDragging ? "border-[#1d1d1f] border-2 border-dashed" : "border-black/[0.08]"
        }`}
      >
        <div className="w-13 h-13 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-[#1d1d1f]">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
            已就绪 {materials.length} 份原始材料
          </h2>
          <p className="text-[14px] text-[#52525b] leading-relaxed">
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
                <ImageIcon className="w-3.5 h-3.5 text-[#52525b]" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-[#52525b]" />
              )}
              <span className="truncate max-w-[140px]">
                {formatAssetLabel(m.asset_id)}
              </span>
            </span>
          ))}
          {materials.length > 6 && (
            <span className="text-[12.5px] text-[#71717a]">
              +{materials.length - 6} 份
            </span>
          )}
        </div>

        {/* Optional Direction / Audience / Page Count Prompt (PRD Stage 2 & F-04) */}
        <div className="w-full max-w-lg space-y-2 text-left bg-[#f5f5f7] p-3.5 rounded-2xl">
          <label className="block text-[12.5px] font-medium text-[#52525b] px-0.5">
            提炼方向与要求（选填：指定目标页数、受众或重点章节）
          </label>
          <input
            type="text"
            value={outlinePrompt}
            onChange={(e) => setOutlinePrompt(e.target.value)}
            placeholder="例如：控制在 6 页以内，面向技术架构评审，重点突出性能数据…"
            className="w-full h-10 text-[14px] text-[#1d1d1f] placeholder-[#71717a] bg-white rounded-full px-4 border border-black/[0.12] outline-none transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-black/30 focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.08]"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setOutlinePrompt(preset)}
                className="text-[11.5px] px-2.5 py-0.5 rounded-full bg-white hover:bg-[#1d1d1f] text-[#52525b] hover:text-white border border-black/[0.08] transition-colors cursor-pointer"
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
            className="h-11 px-6 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[14px] font-medium transition-colors duration-200 cursor-pointer disabled:bg-[#e4e4e7] disabled:text-[#52525b] disabled:cursor-not-allowed"
          >
            {isGenerating ? "正在解析并提炼大纲…" : "开始提炼大纲"}
          </button>
          <button
            type="button"
            onClick={onUploadClick}
            className="h-11 px-4 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] text-[#1d1d1f] text-[13.5px] font-medium transition-colors cursor-pointer"
          >
            + 上传文件
          </button>
          <button
            type="button"
            onClick={() => setPasteMode(true)}
            className="h-11 px-4 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] text-[#1d1d1f] text-[13.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-[#1d1d1f]" />
            <span>粘贴笔记</span>
          </button>
        </div>
      </div>
    </section>
  );
}
