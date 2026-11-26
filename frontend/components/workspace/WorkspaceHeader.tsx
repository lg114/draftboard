"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  FileDown,
  FileText,
  Images,
  PanelLeft,
  PanelRight,
  Presentation,
  Redo2,
  RefreshCw,
  Settings,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { Outline, Project } from "../../lib/api";
import { useDismiss } from "../../lib/useDismiss";
import { usePresence } from "../../lib/usePresence";
import { BrandLogo } from "../BrandLogo";
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
  exportInSync: boolean;
  showMaterialsDrawer: boolean;
  isChatOpen: boolean;
  llmConfigured?: boolean;
  activeModelLabel?: string;
  leftOpen: boolean;
  rightOpen: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleChat: () => void;
  onOpenLLMSettings: () => void;
  onToggleMaterialsDrawer: () => void;
  onSelectVersion: (v: string) => void;
  onSaveOutline: () => void;
  onFlushBeforeLeave?: () => Promise<void>;
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
  exportInSync,
  isChatOpen,
  llmConfigured = true,
  activeModelLabel = "",
  leftOpen,
  rightOpen,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onToggleLeft,
  onToggleRight,
  onToggleChat,
  onOpenLLMSettings,
  onToggleMaterialsDrawer,
  onSelectVersion,
  onSaveOutline,
  onFlushBeforeLeave,
  onRenameProject,
  onConfirmGenerate,
}: WorkspaceHeaderProps) {
  const router = useRouter();
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  const handleGuardedNavigate = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (
      !isStale ||
      !onFlushBeforeLeave ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0
    ) {
      return;
    }
    e.preventDefault();
    try {
      await onFlushBeforeLeave();
    } finally {
      router.push(href);
    }
  };

  const { mounted: versionMounted, exiting: versionExiting } = usePresence(
    isVersionOpen,
    130
  );
  const { mounted: exportMounted, exiting: exportExiting } = usePresence(
    isExportOpen,
    130
  );

  const versionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const versionPopoverRef = useRef<HTMLDivElement | null>(null);
  const exportWrapRef = useRef<HTMLDivElement | null>(null);

  useDismiss(isVersionOpen, () => setIsVersionOpen(false), [
    versionTriggerRef,
    versionPopoverRef,
  ]);
  useDismiss(isExportOpen, () => setIsExportOpen(false), [exportWrapRef]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const sortedOutlines = (project?.outlines ?? []).toSorted(
    (a, b) => b.mtime - a.mtime
  );
  const currentOutlineIndex = sortedOutlines.findIndex(
    (o) => o.outline_version === version
  );
  const versionOrdinal =
    currentOutlineIndex >= 0
      ? sortedOutlines.length - currentOutlineIndex
      : sortedOutlines.length;

  const needsReexport = currentStage === "ppt_ready" && !exportInSync;
  const hasOutline = Boolean(outline && outline.items.length > 0);
  const stageMeta =
    PROJECT_STAGE_STEPS[resolveWorkspaceStageKey(currentStage, outline)];

  return (
    <header className="h-12 bg-ui-bg px-4 flex items-center justify-between gap-3 sticky top-0 z-40 shrink-0 select-none">
      {/* Left: Brand / Reopen Left Rail / Project Name / Save & Version */}
      <div className="flex items-center gap-2.5 min-w-0">
        {hasOutline && !leftOpen && (
          <button
            type="button"
            onClick={onToggleLeft}
            aria-label="展开左侧边栏"
            title="展开左侧边栏"
            className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer shrink-0"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}

        <Link
          href="/"
          onClick={(e) => void handleGuardedNavigate(e, "/")}
          className="hover:opacity-85 transition-opacity shrink-0"
          title="返回文稿列表"
        >
          <BrandLogo className="w-6 h-6" />
        </Link>

        <div className="flex items-center gap-2.5 min-w-0">
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
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditingName(false);
                  }
                }}
                autoFocus
                className="ui-field text-[13.5px] font-semibold px-2 py-0.5 w-44"
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
              className="text-[14px] font-semibold tracking-[-0.01em] text-ui-text hover:text-white truncate cursor-pointer transition-colors"
            >
              {project?.name || pid}
            </button>
          )}

          {/* Quiet Inline Save & Version Trigger */}
          {hasOutline && (
            <div className="relative flex items-center gap-1.5 shrink-0">
              {isSaving ? (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ui-text-muted whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-ui-accent animate-pulse" />
                  <span>保存中…</span>
                </span>
              ) : isStale ? (
                <button
                  type="button"
                  onClick={onSaveOutline}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-ui-warning-bg text-ui-warning text-[12.5px] font-medium hover:brightness-110 transition-all cursor-pointer whitespace-nowrap"
                  title="立即保存修改 (Ctrl/⌘+S，或停顿 1.2 秒自动保存)"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-ui-warning" />
                  <span>未保存</span>
                  <span className="underline underline-offset-2">保存</span>
                </button>
              ) : (
                <button
                  ref={versionTriggerRef}
                  type="button"
                  onClick={() => setIsVersionOpen(!isVersionOpen)}
                  aria-expanded={isVersionOpen}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-ui-bg-hover text-[12.5px] text-ui-text-muted hover:text-ui-text-secondary transition-colors cursor-pointer whitespace-nowrap"
                  title={`已保存（第 ${versionOrdinal} 版），点击查看历史版本`}
                >
                  <Check className="w-3.5 h-3.5 text-ui-icon" />
                  <span>已保存</span>
                  <ChevronDown
                    className={`w-3 h-3 text-ui-icon-quiet transition-transform ${
                      isVersionOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              )}

              {versionMounted && sortedOutlines.length > 0 && (
                <div
                  ref={versionPopoverRef}
                  className={`absolute left-0 top-full mt-2 z-50 w-72 ui-popover rounded-xl p-2 space-y-1 ${
                    versionExiting
                      ? "anim-popover-down-left-out pointer-events-none"
                      : "anim-popover-down-left-in"
                  }`}
                >
                  <div className="px-2.5 py-1 text-[12.5px] font-semibold text-ui-text-muted">
                    大纲版本历史 ({sortedOutlines.length})
                  </div>
                  <div className="max-h-60 overflow-y-auto clean-scroll space-y-0.5">
                    {sortedOutlines.map((o, idx) => {
                      const isSelected = o.outline_version === version;
                      const isExported =
                        o.outline_version ===
                        project?.generated_outline_version;
                      const num = sortedOutlines.length - idx;
                      return (
                        <button
                          key={o.outline_version}
                          type="button"
                          onClick={() => {
                            setIsVersionOpen(false);
                            onSelectVersion(o.outline_version);
                          }}
                          className={`w-full text-left px-2.5 py-2 rounded-lg text-[13px] flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-ui-bg-selected text-ui-text font-medium"
                              : "text-ui-text-secondary hover:bg-ui-control-hover"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-ui-text">
                                第 {num} 版
                              </span>
                              <span className="font-mono text-[12px] text-ui-text-muted">
                                {o.outline_version}
                              </span>
                            </div>
                            <div className="text-[12px] text-ui-text-muted flex items-center gap-2 mt-0.5">
                              <span>{o.item_count} 页</span>
                              <span>{o.is_confirmed ? "已确认" : "草稿"}</span>
                              {isExported && (
                                <span className="text-ui-accent-text font-medium">
                                  当前 PPT
                                </span>
                              )}
                            </div>
                          </div>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-ui-accent-text shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Quiet Utilities + Preview + Single Blue Export CTA */}
      <div className="flex items-center gap-2 shrink-0">
        {!hasOutline && (
          <>
            <div
              className="hidden sm:flex items-center gap-2 px-2 py-1"
              aria-label={`当前步骤 ${stageMeta.step}/4：${stageMeta.label}`}
            >
              <div className="flex items-center gap-1 w-14">
                {[1, 2, 3, 4].map((idx) => (
                  <span
                    key={idx}
                    className={`h-[3px] flex-1 rounded-full ${
                      idx <= stageMeta.step
                        ? "bg-ui-accent"
                        : "bg-ui-border-subtle"
                    }`}
                  />
                ))}
              </div>
              <span className="text-[12.5px] text-ui-text-muted tabular-nums whitespace-nowrap">
                {stageMeta.step}/4 {stageMeta.label}
              </span>
            </div>

            {currentStage !== "no_materials" && (
              <button
                type="button"
                onClick={onToggleMaterialsDrawer}
                className="px-2.5 py-1 rounded-md text-[13px] text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5"
              >
                <span>材料</span>
                <span className="text-ui-text-muted tabular-nums">
                  {materialsCount}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleChat}
              title="打开 AI 助手对话 (Ctrl/⌘+L)"
              className={`px-2.5 py-1 rounded-md text-[13px] transition-colors cursor-pointer whitespace-nowrap inline-flex items-center gap-1.5 ${
                isChatOpen
                  ? "bg-ui-bg-selected text-ui-text"
                  : "text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">AI 助手</span>
            </button>

            <button
              type="button"
              onClick={onOpenLLMSettings}
              aria-label="模型设置"
              title={
                llmConfigured && activeModelLabel
                  ? `模型设置（当前：${activeModelLabel}）`
                  : "模型设置（尚未配置，点击前往设置）"
              }
              className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <Settings className="w-4 h-4" />
              {!llmConfigured && (
                <span className="w-1.5 h-1.5 rounded-full bg-ui-warning" />
              )}
            </button>
          </>
        )}

        {hasOutline && (
          <>
            {/* Quiet circular Undo / Redo buttons matching mockup */}
            {(onUndo || onRedo) && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canUndo}
                  onClick={onUndo}
                  aria-label="撤销"
                  title="撤销 (Ctrl/⌘+Z)"
                  className="w-7 h-7 rounded-full border border-ui-border-subtle flex items-center justify-center text-ui-icon hover:text-ui-text hover:bg-ui-bg-hover hover:border-ui-border disabled:opacity-30 disabled:pointer-events-none ui-press cursor-pointer transition-colors"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  onClick={onRedo}
                  aria-label="重做"
                  title="重做 (Ctrl/⌘+Shift+Z)"
                  className="w-7 h-7 rounded-full border border-ui-border-subtle flex items-center justify-center text-ui-icon hover:text-ui-text hover:bg-ui-bg-hover hover:border-ui-border disabled:opacity-30 disabled:pointer-events-none ui-press cursor-pointer transition-colors"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Quiet Preview link */}
            <Link
              href={`/p/${pid}/preview`}
              onClick={(e) =>
                void handleGuardedNavigate(e, `/p/${pid}/preview`)
              }
              className="px-2.5 py-1 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors whitespace-nowrap"
              title="全屏放映与演讲者视图"
            >
              预览
            </Link>

            {/* Single Primary Blue Export CTA + Unified Export/Preflight Popover */}
            <div ref={exportWrapRef} className="relative">
              <button
                type="button"
                onClick={() => setIsExportOpen((v) => !v)}
                aria-expanded={isExportOpen}
                aria-haspopup="menu"
                className="ui-btn-primary h-8 px-3.5 text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {isGenerating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                <span>{isGenerating ? "导出中…" : "导出"}</span>
              </button>

              {exportMounted && (
                <div
                  role="menu"
                  className={`absolute right-0 top-full mt-2 z-50 w-72 ui-popover rounded-xl p-2 space-y-1.5 ${
                    exportExiting
                      ? "anim-popover-down-out pointer-events-none"
                      : "anim-popover-down-in"
                  }`}
                >
                  {/* Primary Compile / Download Action */}
                  <div className="p-2 rounded-lg bg-ui-surface-input border border-ui-border-subtle space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="inline-flex items-center gap-1.5 text-ui-text-secondary">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            currentStage === "ppt_ready" && !needsReexport
                              ? "bg-ui-success"
                              : "bg-ui-warning"
                          }`}
                        />
                        <span>
                          {currentStage === "ppt_ready" && !needsReexport
                            ? "PPTX 已与当前文稿同步"
                            : needsReexport
                            ? "文稿已更新，需重新编译"
                            : "尚未编译 PPTX 文件"}
                        </span>
                      </span>
                    </div>

                    {currentStage === "ppt_ready" && !needsReexport ? (
                      <div className="flex items-center gap-1.5">
                        <a
                          role="menuitem"
                          href={`/api/projects/${pid}/download`}
                          download
                          onClick={() => setIsExportOpen(false)}
                          className="flex-1 ui-btn-primary h-8 px-3 text-[13px] inline-flex items-center justify-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>下载 PPTX</span>
                        </a>
                        <button
                          type="button"
                          disabled={isGenerating}
                          onClick={() => {
                            setIsExportOpen(false);
                            onConfirmGenerate();
                          }}
                          title="重新编译 PPTX"
                          className="ui-btn-subtle h-8 px-2.5 text-[13px] inline-flex items-center justify-center"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              isGenerating ? "animate-spin" : ""
                            }`}
                          />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isGenerating || !version}
                        onClick={() => {
                          setIsExportOpen(false);
                          onConfirmGenerate();
                        }}
                        className="w-full ui-btn-primary h-8 px-3 text-[13px] inline-flex items-center justify-center gap-1.5"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            isGenerating ? "animate-spin" : ""
                          }`}
                        />
                        <span>
                          {isGenerating
                            ? "正在编译 PPTX…"
                            : needsReexport
                            ? "重新编译最新版 PPTX"
                            : "立即编译 PPTX"}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Secondary export formats */}
                  <div className="space-y-0.5">
                    {currentStage === "ppt_ready" && needsReexport && (
                      <a
                        role="menuitem"
                        href={`/api/projects/${pid}/download`}
                        download
                        onClick={() => setIsExportOpen(false)}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover transition-colors"
                      >
                        <Presentation className="w-4 h-4 text-ui-icon shrink-0" />
                        <span>下载上一版 PPTX</span>
                      </a>
                    )}

                    {currentStage === "ppt_ready" && (
                      <>
                        <a
                          role="menuitem"
                          href={`/api/projects/${pid}/download/pdf`}
                          download
                          onClick={() => setIsExportOpen(false)}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover transition-colors"
                        >
                          <FileDown className="w-4 h-4 text-ui-icon shrink-0" />
                          <span>导出矢量 PDF</span>
                        </a>
                        <a
                          role="menuitem"
                          href={`/api/projects/${pid}/download/pngs.zip`}
                          download
                          onClick={() => setIsExportOpen(false)}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover transition-colors"
                        >
                          <Images className="w-4 h-4 text-ui-icon shrink-0" />
                          <span>导出逐页高清 PNG (ZIP)</span>
                        </a>
                      </>
                    )}

                    <a
                      role="menuitem"
                      href={`/api/projects/${pid}/download/notes.md`}
                      download
                      onClick={() => setIsExportOpen(false)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover transition-colors"
                    >
                      <FileText className="w-4 h-4 text-ui-icon shrink-0" />
                      <span>导出演讲者讲稿 (Markdown)</span>
                    </a>
                  </div>
                </div>
              )}
            </div>

            {!rightOpen && (
              <button
                type="button"
                onClick={onToggleRight}
                aria-label="展开右侧面板"
                title="展开右侧面板（AI 助手 / 属性）"
                className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer shrink-0"
              >
                <PanelRight className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
