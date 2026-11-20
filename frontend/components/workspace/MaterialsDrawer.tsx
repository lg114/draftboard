"use client";

import { FileText, Image as ImageIcon, Plus, Sparkles, Upload } from "lucide-react";
import type { Material } from "../../lib/api";

interface MaterialsDrawerProps {
  materials: Material[];
  fragmentsCount: number;
  isGenerating: boolean;
  onUploadClick: () => void;
  onGenerateOutline: () => void;
}

export function MaterialsDrawer({
  materials,
  fragmentsCount,
  isGenerating,
  onUploadClick,
  onGenerateOutline,
}: MaterialsDrawerProps) {
  return (
    <div className="bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-bento space-y-4 animate-in fade-in duration-150">
      <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6]">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
          <Upload className="w-4 h-4 text-[#6b7280]" />
          <span>原始素材池管理 ({materials.length})</span>
          {fragmentsCount > 0 && (
            <span className="font-mono text-[11px] font-normal text-[#6b7280] bg-[#f3f4f6] px-2 py-0.5 rounded-md">
              {fragmentsCount} 个溯源切片
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onUploadClick}
          className="cursor-pointer px-3.5 py-1.5 bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] rounded-xl text-[#374151] text-xs font-medium shadow-2xs transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#6b7280]" />
          <span>上传材料 (.md, .txt, .png, .jpg)</span>
        </button>
      </div>

      {materials.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {materials.map((m) => (
            <div
              key={m.asset_id}
              className="p-3 rounded-xl bg-[#f8f9fa] border border-[#e5e7eb] flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                {m.asset_type === "image" ? (
                  <ImageIcon className="w-4 h-4 text-[#d97706] shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-[#059669] shrink-0" />
                )}
                <span className="truncate font-mono font-medium text-[#111827]">
                  {m.asset_id}
                </span>
              </div>
              <span
                className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-md border ${
                  m.asset_type === "image"
                    ? "bg-[#fef3c7] text-[#b45309] border-[#fde68a]"
                    : "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]"
                }`}
              >
                {m.asset_type}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-[#9ca3af] text-xs">
          暂无上传的材料。点击右上角按钮添加 Markdown 笔记或图片。
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-[#f3f4f6] text-xs gap-4">
        <span className="text-[#6b7280]">
          上传素材后，系统将建立可溯源的事实切片索引，作为大纲与幻灯片的依据。
        </span>
        {materials.length > 0 && (
          <button
            type="button"
            onClick={onGenerateOutline}
            disabled={isGenerating}
            className="text-[#059669] font-semibold hover:underline flex items-center gap-1 disabled:opacity-50 cursor-pointer shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isGenerating ? "提炼中..." : "重新提取大纲"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
