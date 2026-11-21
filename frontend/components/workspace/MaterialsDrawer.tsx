"use client";

import { FileText, Image as ImageIcon } from "lucide-react";
import type { Material } from "../../lib/api";

interface MaterialsDrawerProps {
  materials: Material[];
  fragmentsCount: number;
  isGenerating: boolean;
  onUploadClick: () => void;
  onGenerateOutline: () => void;
  onClose: () => void;
}

export function MaterialsDrawer({
  materials,
  fragmentsCount,
  isGenerating,
  onUploadClick,
  onGenerateOutline,
  onClose,
}: MaterialsDrawerProps) {
  return (
    <div className="border-b border-black/[0.07] bg-white px-5 py-3.5 shrink-0">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-[#1d1d1f] mr-1 whitespace-nowrap">
            已导入素材
            {fragmentsCount > 0 && (
              <span className="font-normal text-[#86868b] ml-1.5">
                {fragmentsCount} 处溯源切片
              </span>
            )}
          </span>

          {materials.length > 0 ? (
            materials.map((m, i) => (
              <span
                key={`${m.asset_id}-${m.asset_type}-${i}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-medium ${
                  m.asset_type === "image"
                    ? "bg-[#0071e3]/[0.08] text-[#0071e3]"
                    : "bg-[#f5f5f7] text-[#1d1d1f]"
                }`}
              >
                {m.asset_type === "image" ? (
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-[#6e6e73] shrink-0" />
                )}
                <span className="truncate max-w-[180px]">{m.asset_id}</span>
              </span>
            ))
          ) : (
            <span className="text-[13px] text-[#86868b]">暂无材料</span>
          )}
        </div>

        <div className="flex items-center gap-4 text-[13px] shrink-0">
          <button
            type="button"
            onClick={onUploadClick}
            className="text-[#0071e3] hover:underline font-medium cursor-pointer whitespace-nowrap"
          >
            + 上传材料
          </button>
          {materials.length > 0 && (
            <button
              type="button"
              onClick={onGenerateOutline}
              disabled={isGenerating}
              className="text-[#1d1d1f] hover:text-[#0071e3] font-medium cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              {isGenerating ? "提炼中…" : "重新提炼大纲"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[#86868b] hover:text-[#1d1d1f] cursor-pointer whitespace-nowrap"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
