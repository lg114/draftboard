"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FileText,
  History,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";
import type { Outline, Project } from "../../lib/api";

export type WorkspaceStage =
  | "no_materials"
  | "has_materials_no_outline"
  | "outline_ready"
  | "ppt_ready";

interface WorkspaceHeaderProps {
  pid: string;
  project: Project | null;
  materialsCount: number;
  outline: Outline | null;
  version: string;
  isStale: boolean;
  isGenerating: boolean;
  currentStage: WorkspaceStage;
  showMaterialsDrawer: boolean;
  onToggleMaterialsDrawer: () => void;
  onSelectVersion: (v: string) => void;
  onSaveOutline: () => void;
  onUploadClick: () => void;
  onGenerateOutline: () => void;
  onConfirmGenerate: () => void;
}

export function WorkspaceHeader({
  pid,
  project,
  materialsCount,
  outline,
  version,
  isStale,
  isGenerating,
  currentStage,
  showMaterialsDrawer,
  onToggleMaterialsDrawer,
  onSelectVersion,
  onSaveOutline,
  onUploadClick,
  onGenerateOutline,
  onConfirmGenerate,
}: WorkspaceHeaderProps) {
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);

  const currentOutlineMeta = project?.outlines?.find(
    (o) => o.outline_version === version
  );

  const outlineOutOfSyncWithPpt =
    currentStage === "ppt_ready" &&
    (isStale ||
      (outline && !outline.is_confirmed) ||
      (Boolean(version) && version !== project?.generated_outline_version));

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-2xl px-5 py-3 shadow-bento flex flex-wrap items-center justify-between gap-4">
      {/* Left: Breadcrumb & Project Name */}
      <div className="flex items-center gap-2.5">
        <Link
          href="/"
          className="text-[#6b7280] hover:text-[#111827] text-xs font-medium transition-colors"
        >
          项目
        </Link>
        <span className="text-[#d1d5db]">/</span>
        <span className="font-bold text-base text-[#111827] tracking-tight">
          {project?.name || pid}
        </span>
        {outline && (
          <span className="text-xs font-mono px-2 py-0.5 rounded-lg bg-[#f3f4f6] text-[#4b5563] border border-[#e5e7eb]">
            {outline.items.length} 页
          </span>
        )}
        {isStale && (
          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#fef3c7] text-[#b45309] border border-[#fde68a] flex items-center gap-1.5 shadow-2xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
            <span>未保存的修改</span>
          </span>
        )}
      </div>

      {/* Center: Pipeline Progress Pill */}
      <div className="hidden md:flex items-center gap-2 text-xs font-medium px-4 py-1.5 bg-[#f8f9fa] rounded-full border border-[#e5e7eb] select-none shadow-2xs">
        <span
          className={`flex items-center gap-1.5 ${
            materialsCount > 0 ? "text-[#059669] font-semibold" : "text-[#9ca3af]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              materialsCount > 0 ? "bg-[#10b981]" : "bg-[#d1d5db]"
            }`}
          />
          <span>素材 ({materialsCount})</span>
        </span>
        <span className="text-[#d1d5db]">→</span>
        <span
          className={`flex items-center gap-1.5 ${
            outline ? "text-[#059669] font-semibold" : "text-[#9ca3af]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              outline ? "bg-[#10b981]" : "bg-[#d1d5db]"
            }`}
          />
          <span>大纲 ({outline?.items?.length || 0}页)</span>
        </span>
        <span className="text-[#d1d5db]">→</span>
        <span
          className={`flex items-center gap-1.5 ${
            project?.download_available
              ? "text-[#059669] font-semibold"
              : "text-[#9ca3af]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              project?.download_available ? "bg-[#10b981]" : "bg-[#d1d5db]"
            }`}
          />
          <span>生成 PPT</span>
        </span>
      </div>

      {/* Right: Adaptive Action Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Outline Version Switcher */}
        {(project?.outlines?.length ?? 0) > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsVersionDropdownOpen(!isVersionDropdownOpen)}
              className="flex items-center gap-2 bg-white hover:bg-[#f9fafb] border border-[#e5e7eb] hover:border-[#d1d5db] rounded-xl px-3 py-1.5 text-xs text-[#374151] font-mono transition-colors shadow-2xs cursor-pointer"
              title="切换历史大纲版本"
            >
              <History className="w-3.5 h-3.5 text-[#6b7280] shrink-0" />
              <span className="font-semibold text-[#111827]">
                {version || project?.outlines?.[0]?.outline_version || "大纲版本"}
              </span>
              {currentOutlineMeta && (
                <span className="text-[#6b7280] font-sans">
                  ({currentOutlineMeta.item_count}页 ·{" "}
                  {currentOutlineMeta.is_confirmed ? "已确认" : "草稿"})
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 text-[#6b7280] transition-transform duration-200 ${
                  isVersionDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {isVersionDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsVersionDropdownOpen(false)}
                />
                <div className="absolute left-0 top-full mt-2 z-50 w-72 bg-white border border-[#e5e7eb] rounded-2xl shadow-xl p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9ca3af] uppercase tracking-wider border-b border-[#f3f4f6]">
                    历史大纲版本
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
                    {[...(project?.outlines ?? [])]
                      .sort((a, b) => b.mtime - a.mtime)
                      .map((o) => {
                        const isSelected = o.outline_version === version;
                        const isExported =
                          o.outline_version === project?.generated_outline_version;
                        return (
                          <button
                            key={o.outline_version}
                            type="button"
                            onClick={() => {
                              setIsVersionDropdownOpen(false);
                              onSelectVersion(o.outline_version);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-[#f3f4f6] text-[#111827] font-semibold"
                                : "text-[#374151] hover:bg-[#f9fafb]"
                            }`}
                          >
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-[#111827] flex items-center gap-1.5">
                                <span>{o.outline_version}</span>
                                <span className="text-[#6b7280] text-[11px] font-sans font-normal">
                                  · {o.item_count} 页
                                </span>
                              </span>
                              {isExported && (
                                <span className="text-[10px] font-sans text-[#059669]">
                                  当前 PPT 对应版本
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex items-center gap-1 shadow-2xs ${
                                  o.is_confirmed
                                    ? "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]"
                                    : "bg-[#fef3c7] text-[#b45309] border-[#fde68a]"
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    o.is_confirmed ? "bg-[#10b981]" : "bg-[#f59e0b]"
                                  }`}
                                />
                                <span>{o.is_confirmed ? "已确认" : "草稿"}</span>
                              </span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-[#4f46e5]" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Material Pool Toggle */}
        <button
          type="button"
          onClick={onToggleMaterialsDrawer}
          className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs ${
            showMaterialsDrawer
              ? "bg-[#eef2ff] border-[#c7d2fe] text-[#4f46e5]"
              : "border-[#e5e7eb] bg-white hover:bg-[#f9fafb] text-[#374151]"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>素材池 ({materialsCount})</span>
        </button>

        {/* Save Outline Button */}
        {outline && (
          <button
            type="button"
            onClick={onSaveOutline}
            disabled={!isStale}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
              isStale
                ? "bg-[#111827] hover:bg-black text-white shadow-xs cursor-pointer"
                : "bg-white border border-[#e5e7eb] text-[#9ca3af] cursor-default"
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isStale ? "保存修改" : "已保存"}</span>
          </button>
        )}

        {/* Stage-Driven Primary Action */}
        {currentStage === "no_materials" && (
          <button
            type="button"
            onClick={onUploadClick}
            className="px-4 py-1.5 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-[#34d399]" />
            <span>上传素材</span>
          </button>
        )}

        {currentStage === "has_materials_no_outline" && (
          <button
            type="button"
            onClick={onGenerateOutline}
            disabled={isGenerating}
            className="px-4 py-1.5 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#34d399]" />
            <span>{isGenerating ? "正在提炼..." : "生成大纲"}</span>
          </button>
        )}

        {currentStage === "outline_ready" && (
          <button
            type="button"
            onClick={onConfirmGenerate}
            disabled={isGenerating || !version}
            className="px-4 py-1.5 rounded-xl bg-[#111827] hover:bg-[#1f2937] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#34d399]" />
            <span>{isGenerating ? "正在生成..." : "确认大纲并生成 PPT"}</span>
          </button>
        )}

        {currentStage === "ppt_ready" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirmGenerate}
              disabled={isGenerating}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                outlineOutOfSyncWithPpt
                  ? "bg-[#111827] hover:bg-black text-white shadow-xs"
                  : "border border-[#eaecf0] bg-white hover:bg-[#f9fafb] text-[#374151] shadow-2xs"
              }`}
              title="按当前大纲重新编译并生成 PPTX"
            >
              <RefreshCw className={`w-3 h-3 ${isGenerating ? "animate-spin" : ""}`} />
              <span>
                {isGenerating
                  ? "正在生成..."
                  : outlineOutOfSyncWithPpt
                  ? "确认并重新生成"
                  : "重新生成"}
              </span>
            </button>

            <a
              href={`/api/projects/${pid}/download`}
              download
              className="px-4 py-1.5 rounded-xl bg-[#059669] hover:bg-[#047857] text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 PPTX</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
