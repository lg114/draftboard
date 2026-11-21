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
  onGenerateOutline: () => void;
}

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
          className={`w-full max-w-[760px] aspect-[16/9] rounded-[18px] bg-white slide-shadow border-2 border-dashed transition-all flex flex-col items-center justify-center text-center p-8 sm:p-12 space-y-5 ${
            isDragging
              ? "border-[#0071e3] bg-[#0071e3]/[0.03]"
              : "border-black/[0.12]"
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#f5f5f7] flex items-center justify-center text-[#0071e3]">
            <Upload className="w-6 h-6" />
          </div>
          <div className="space-y-2 max-w-md">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
              拖入 Markdown、笔记或图片开始
            </h2>
            <p className="text-[14.5px] text-[#6e6e73] leading-relaxed">
              仅基于你的原始材料提炼大纲并编译为原生可编辑 PPTX，绝不虚构任何未出现的数据与结论。
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onUploadClick}
              className="px-5 py-2.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] font-medium shadow-[0_2px_8px_rgba(0,113,227,0.22)] cursor-pointer transition-colors"
            >
              选择本地文件
            </button>
            <button
              type="button"
              onClick={() => setPasteMode(true)}
              className="px-5 py-2.5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.07] text-[#1d1d1f] text-[14px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <ClipboardPaste className="w-4 h-4 text-[#0071e3]" />
              <span>直接粘贴文本笔记</span>
            </button>
          </div>

          <div className="text-[12.5px] text-[#86868b]">
            支持 .md · .txt · .png · .jpg 或直接粘贴内容
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 min-h-0 overflow-y-auto bg-[#ececef] flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-[760px] aspect-[16/9] rounded-[18px] bg-white slide-shadow flex flex-col items-center justify-center text-center p-8 sm:p-12 space-y-6">
        <div className="w-14 h-14 rounded-2xl bg-[#34c759]/12 flex items-center justify-center text-[#248a3d]">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-2 max-w-md">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
            已就绪 {materials.length} 份原始材料
          </h2>
          <p className="text-[14.5px] text-[#6e6e73] leading-relaxed">
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

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={onGenerateOutline}
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
