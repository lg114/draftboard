"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, Download, Play, RefreshCw, Sparkles } from "lucide-react";
import type { Outline, Project } from "../../lib/api";
import { BrandLogo } from "../BrandLogo";
import { ExportFormatMenu } from "./ExportFormatMenu";
import {
  PROJECT_STAGE_STEPS,
  resolveWorkspaceStageKey,
  type WorkspaceStage,
} from "./layoutUtils";

interface WorkspaceHeaderProps {
  pid: string;
  project: Project | null;
  materialsCount: number;
  outline: Outline | null;
  version: string;
  isStale: boolean;
  isSaving?: boolean;
  isGenerating: boolean;
  currentStage: WorkspaceStage;
  selectedThemeId: string;
  autoFit: boolean;
  showMaterialsDrawer: boolean;
  isChatOpen: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleChat: () => void;
  onToggleMaterialsDrawer: () => void;
  onSelectVersion: (v: string) => void;
  onSaveOutline: () => void;
  onRenameProject?: (newName: string) => Promise<void>;
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
  isSaving = false,
  isGenerating,
  currentStage,
  selectedThemeId,
  autoFit,
  showMaterialsDrawer,
  isChatOpen,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  onToggleChat,
  onToggleMaterialsDrawer,
  onSelectVersion,
  onSaveOutline,
  onRenameProject,
  onUploadClick,
  onGenerateOutline,
  onConfirmGenerate,
}: WorkspaceHeaderProps) {
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const sortedOutlines = [...(project?.outlines ?? [])].sort(
    (a, b) => b.mtime - a.mtime
  );
  const currentOutlineIndex = sortedOutlines.findIndex(
    (o) => o.outline_version === version
  );
  const versionOrdinal =
    currentOutlineIndex >= 0
      ? sortedOutlines.length - currentOutlineIndex
      : sortedOutlines.length;

  const settingsChangedSinceExport =
    Boolean(project?.latest_template_id) &&
    (project?.latest_template_id !== selectedThemeId ||
      Boolean(project?.latest_auto_fit) !== autoFit);

  const needsReexport =
    currentStage === "ppt_ready" &&
    (isStale ||
      settingsChangedSinceExport ||
      (outline && !outline.is_confirmed) ||
      (Boolean(version) && version !== project?.generated_outline_version));

  const hasOutline = Boolean(outline && outline.items.length > 0);
  const stageMeta = PROJECT_STAGE_STEPS[resolveWorkspaceStageKey(currentStage, outline)];

  return (
    <header className="h-[52px] apple-glass border-b border-black/[0.07] px-4 flex items-center justify-between gap-3 sticky top-0 z-40 shrink-0">
      {/* Left: Sidebar Toggle + Brand + Project Name & macOS Pages-style Version Popover */}
      <div className="flex items-center gap-2.5 min-w-0">
        {hasOutline && (
          <button
            type="button"
            onClick={onToggleLeft}
            title={leftOpen ? "收起幻灯片缩略轨" : "展开幻灯片缩略轨"}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
              leftOpen
                ? "text-ink bg-black/[0.06] hover:bg-black/[0.1]"
                : "text-ink-muted hover:text-ink hover:bg-black/[0.06]"
            }`}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
              <line x1="7.5" y1="3.5" x2="7.5" y2="16.5" />
            </svg>
          </button>
        )}

        <Link
          href="/"
          className="hover:opacity-85 transition-opacity shrink-0"
          title="返回文稿列表"
        >
          <BrandLogo className="w-7 h-7" />
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          {isEditingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setIsEditingName(false);
                if (onRenameProject && nameDraft.trim()) {
                  void onRenameProject(nameDraft.trim());
                }
              }}
              className="flex items-center"
            >
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  setIsEditingName(false);
                  if (onRenameProject && nameDraft.trim()) {
                    void onRenameProject(nameDraft.trim());
                  }
                }}
                autoFocus
                className="text-[14px] font-semibold bg-white border border-ink rounded-lg px-2 py-0.5 text-ink outline-none w-44"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!onRenameProject) return;
                setNameDraft(project?.name || pid);
                setIsEditingName(true);
              }}
              title="点击重命名文稿"
              className="text-[14.5px] font-semibold tracking-[-0.015em] text-ink hover:opacity-70 truncate cursor-pointer transition-opacity"
            >
              {project?.name || pid}
            </button>
          )}

          {/* Inline Save / Version Trigger (macOS Pages style) */}
          {hasOutline && (
            <div className="relative flex items-center gap-1.5 shrink-0">
              {isSaving ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-black/[0.05] text-ink-secondary text-[13px] font-medium whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-ink animate-pulse" />
                  <span>自动保存中…</span>
                </span>
              ) : isStale ? (
                <button
                  type="button"
                  onClick={onSaveOutline}
                  className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-warning-dot/15 hover:bg-warning-dot/25 text-warning text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap"
                  title="立即保存修改 (Ctrl/⌘+S，或停顿 1.2 秒自动保存)"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-warning-dot" />
                  <span>未保存</span>
                  <span className="font-semibold underline underline-offset-2">
                    保存
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsVersionOpen(!isVersionOpen)}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-black/[0.05] text-[13px] text-ink-muted hover:text-ink transition-colors cursor-pointer whitespace-nowrap"
                  title="查看与切换历史大纲版本"
                >
                  <span>已保存</span>
                  <span className="font-medium text-ink">
                    第 {versionOrdinal} 版
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      isVersionOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}

              {isVersionOpen && sortedOutlines.length > 0 && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsVersionOpen(false)}
                  />
                  <div className="absolute left-0 top-full mt-2 z-50 w-72 apple-glass dock-shadow rounded-2xl p-2 space-y-1">
                    <div className="px-2.5 py-1 text-[13px] font-semibold text-ink-secondary">
                      大纲版本历史 ({sortedOutlines.length})
                    </div>
                    <div className="max-h-60 overflow-y-auto clean-scroll space-y-0.5">
                      {sortedOutlines.map((o, idx) => {
                        const isSelected = o.outline_version === version;
                        const isExported =
                          o.outline_version === project?.generated_outline_version;
                        const num = sortedOutlines.length - idx;
                        return (
                          <button
                            key={o.outline_version}
                            type="button"
                            onClick={() => {
                              setIsVersionOpen(false);
                              onSelectVersion(o.outline_version);
                            }}
                            className={`w-full text-left px-2.5 py-2 rounded-xl text-[13px] flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-black/[0.06] text-ink font-medium"
                                : "text-ink-secondary hover:bg-black/[0.04]"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-ink">
                                  第 {num} 版
                                </span>
                                <span className="font-mono text-[13px] text-ink-muted">
                                  {o.outline_version}
                                </span>
                              </div>
                              <div className="text-[13px] text-ink-muted flex items-center gap-2.5 mt-0.5">
                                <span>{o.item_count} 页</span>
                                <span>{o.is_confirmed ? "已确认" : "草稿"}</span>
                                {isExported && (
                                  <span className="text-ink font-medium">
                                    当前 PPT
                                  </span>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-ink shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Quiet Utilities + Primary Action + Right Inspector Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {/* 4-Step Progress Indicator (replaces "素材 · 0" during initial import) */}
        <div
          className={`items-center gap-2.5 px-2.5 py-1 rounded-full ${
            currentStage === "no_materials" ||
            currentStage === "has_materials_no_outline"
              ? "flex"
              : "hidden lg:flex"
          }`}
          aria-label={`当前步骤 ${stageMeta.step}/4：${stageMeta.label}`}
        >
          <div className="flex items-center gap-1 w-[72px]">
            {[1, 2, 3, 4].map((idx) => (
              <span
                key={idx}
                className={`h-[3px] flex-1 rounded-full transition-colors ${
                  idx <= stageMeta.step ? "bg-ink" : "bg-black/[0.12]"
                }`}
              />
            ))}
          </div>
          <span className="text-[13px] font-medium text-ink tabular-nums whitespace-nowrap">
            {stageMeta.step}/4 {stageMeta.label}
          </span>
        </div>

        {currentStage !== "no_materials" && (
          <button
            type="button"
            onClick={onToggleMaterialsDrawer}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
              showMaterialsDrawer
                ? "bg-black/[0.08] text-ink"
                : "text-ink hover:bg-black/[0.05]"
            }`}
          >
            <span>素材</span>
            <span className="text-ink-secondary tabular-nums">
              {materialsCount}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleChat}
          title="打开或切换 PPT 创作 Agent 对话 (Ctrl/⌘+L)"
          className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
            isChatOpen
              ? "bg-black/[0.08] text-ink"
              : "text-ink hover:bg-black/[0.05]"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 对话</span>
        </button>

        {project?.download_available && (
          <Link
            href={`/p/${pid}/preview`}
            className="px-3 py-1.5 rounded-full text-[13px] font-medium text-ink hover:bg-black/[0.05] transition-colors flex items-center gap-1.5 whitespace-nowrap"
            title="全屏查看高清预览"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span className="hidden sm:inline">放映</span>
          </Link>
        )}

        {/* Note: In `no_materials` & `has_materials_no_outline`, the center onboarding card owns the single primary CTA. */}

        {currentStage === "outline_ready" && (
          <div className="flex items-center gap-1.5">
            <ExportFormatMenu
              pid={pid}
              label="导出"
              canDownloadRendered={false}
              canDownloadNotes={true}
            />
            <button
              type="button"
              onClick={onConfirmGenerate}
              disabled={isGenerating || !version}
              className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-ink hover:bg-ink-hover text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45"
            >
              {isGenerating ? "编译中…" : "确认并生成 PPTX"}
            </button>
          </div>
        )}

        {currentStage === "ppt_ready" && (
          <div className="flex items-center gap-1.5">
            {needsReexport ? (
              <>
                <ExportFormatMenu
                  pid={pid}
                  label="旧版导出"
                  includePptx={true}
                  canDownloadRendered={true}
                  canDownloadNotes={true}
                />
                <button
                  type="button"
                  onClick={onConfirmGenerate}
                  disabled={isGenerating}
                  className="px-3.5 py-1.5 rounded-full text-[13px] font-medium bg-ink hover:bg-ink-hover text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 flex items-center gap-1.5"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`}
                  />
                  <span>{isGenerating ? "编译中…" : "更新 PPTX"}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onConfirmGenerate}
                  disabled={isGenerating}
                  className="p-1.5 rounded-full text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer disabled:opacity-45"
                  title="重新生成 PPTX"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`}
                  />
                </button>
                <ExportFormatMenu
                  pid={pid}
                  label="更多格式"
                  canDownloadRendered={true}
                  canDownloadNotes={true}
                />
                <a
                  href={`/api/projects/${pid}/download`}
                  download
                  className="px-4 py-1.5 rounded-full text-[13px] font-medium bg-ink hover:bg-ink-hover text-white transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载 PPTX</span>
                </a>
              </>
            )}
          </div>
        )}

        {hasOutline && (
          <button
            type="button"
            onClick={onToggleRight}
            title={rightOpen ? "收起右侧编辑检查器" : "展开右侧编辑检查器"}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ml-0.5 ${
              rightOpen
                ? "text-ink bg-black/[0.06] hover:bg-black/[0.1]"
                : "text-ink-muted hover:text-ink hover:bg-black/[0.06]"
            }`}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
              <line x1="12.5" y1="3.5" x2="12.5" y2="16.5" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
