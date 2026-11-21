"use client";

import { useState } from "react";
import { FileText, Image as ImageIcon, Sparkles, Upload } from "lucide-react";
import type { Material } from "../../lib/api";

interface EmptyStageOnboardingProps {
  materials: Material[];
  isGenerating: boolean;
  onUploadClick: () => void;
  onDropFiles: (files: FileList) => void;
  onGenerateOutline: () => void;
}

export function EmptyStageOnboarding({
  materials,
  isGenerating,
  onUploadClick,
  onDropFiles,
  onGenerateOutline,
}: EmptyStageOnboardingProps) {
  const [isDragging, setIsDragging] = useState(false);

  if (materials.length === 0) {
    return (
      <section className="flex-1 bg-[#ececef] flex items-center justify-center p-6 sm:p-10 min-h-[calc(100vh-52px)]">
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
          className={`w-full max-w-[760px] aspect-[16/9] rounded-[18px] bg-white slide-shadow border-2 border-dashed transition-all flex flex-col items-center justify-center text-center p-8 sm:p-12 space-y-5 cursor-pointer ${
            isDragging
              ? "border-[#0071e3] bg-[#0071e3]/[0.03]"
              : "border-black/[0.12] hover:border-[#0071e3]/50"
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
          <span className="px-5 py-2.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] font-medium shadow-[0_2px_8px_rgba(0,113,227,0.22)]">
            选择本地文件
          </span>
          <div className="text-[12.5px] text-[#86868b]">
            支持 .md · .txt · .png · .jpg
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 bg-[#ececef] flex items-center justify-center p-6 sm:p-10 min-h-[calc(100vh-52px)]">
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
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f5f5f7] text-[12.5px] font-medium text-[#1d1d1f]"
            >
              {m.asset_type === "image" ? (
                <ImageIcon className="w-3.5 h-3.5 text-[#0071e3]" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-[#6e6e73]" />
              )}
              <span className="truncate max-w-[140px]">{m.asset_id}</span>
            </span>
          ))}
          {materials.length > 6 && (
            <span className="text-[12.5px] text-[#86868b]">
              +{materials.length - 6} 份
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
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
            + 继续添加
          </button>
        </div>
      </div>
    </section>
  );
}
