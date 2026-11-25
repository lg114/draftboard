"use client";

import { useState } from "react";
import {
  ClipboardPaste,
  FileText,
  Globe,
  Image as ImageIcon,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react";
import type { LLMSettingsResponse, Material } from "../../lib/api";
import { ModelQuickSwitcher } from "../ModelQuickSwitcher";
import { formatAssetLabel } from "./SlideInspector";

interface EmptyStageOnboardingProps {
  materials: Material[];
  isGenerating: boolean;
  llmConfigured?: boolean;
  activeModelLabel?: string;
  llmSettings?: LLMSettingsResponse | null;
  onLLMSettingsUpdated?: (next: LLMSettingsResponse) => void;
  onOpenLLMSettings?: () => void;
  onUploadClick: () => void;
  onDropFiles: (files: FileList) => void;
  onPasteNote: (title: string, content: string) => Promise<void>;
  onImportUrl?: (url: string, title?: string) => Promise<void>;
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
  llmConfigured = true,
  activeModelLabel = "",
  llmSettings = null,
  onLLMSettingsUpdated,
  onOpenLLMSettings,
  onUploadClick,
  onDropFiles,
  onPasteNote,
  onImportUrl,
  onGenerateOutline,
}: EmptyStageOnboardingProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
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
    } catch {
      // Top workspace error banner handles save failure cleanly
    } finally {
      setSavingNote(false);
    }
  }

  async function handleImportUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!urlValue.trim() || !onImportUrl) return;
    setFetchingUrl(true);
    setUrlError(null);
    try {
      await onImportUrl(urlValue.trim(), urlTitle.trim() || undefined);
      setUrlValue("");
      setUrlTitle("");
      setUrlError(null);
      setUrlMode(false);
    } catch (err) {
      setUrlError(
        (err as Error).message ||
          "未能提取到网页正文，建议换具体文章链接或改为手动粘贴正文。"
      );
    } finally {
      setFetchingUrl(false);
    }
  }

  function handleFallbackToPasteFromUrl() {
    const cleanUrl = urlValue.trim();
    if (urlTitle.trim() && !noteTitle.trim()) {
      setNoteTitle(urlTitle.trim());
    }
    if (cleanUrl && !noteContent.trim()) {
      setNoteContent(`> 来源链接：${cleanUrl}\n\n`);
    }
    setUrlError(null);
    setUrlMode(false);
    setPasteMode(true);
  }

  if (urlMode && onImportUrl) {
    return (
      <section className="flex-1 min-h-0 overflow-y-auto bg-stage flex items-center justify-center p-6 sm:p-10">
        <form
          onSubmit={(e) => void handleImportUrl(e)}
          className="w-full max-w-[680px] rounded-[18px] bg-surface border border-black/[0.08] p-7 sm:p-10 space-y-5"
        >
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
              从公开网页链接抓取素材
            </h2>
            <p className="text-[13.5px] text-ink-secondary mt-0.5">
              自动提取网页正文并转为可溯源的 Markdown 素材切片（支持公开文章、文档与博客）。
            </p>
          </div>
          {urlError && (
            <div className="p-3.5 rounded-xl bg-danger-bg border border-danger/20 space-y-2.5 text-[13px] text-danger">
              <p className="leading-relaxed">{urlError}</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleFallbackToPasteFromUrl}
                  className="px-3 py-1 rounded-full bg-surface border border-danger/25 text-ink font-medium hover:bg-canvas transition-colors cursor-pointer"
                >
                  改为手动粘贴正文
                </button>
                <span className="text-danger/80 text-[13px]">
                  将自动保留上方来源链接，直接复制网页文字粘入即可
                </span>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <input
              type="url"
              required
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="https://example.com/article"
              className="ui-field w-full h-11 px-4 text-[14px] bg-canvas focus:bg-surface font-mono"
              autoFocus
            />
            <input
              type="text"
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
              placeholder="素材名称（选填，留空自动使用网页标题）"
              className="ui-field w-full h-11 px-4 text-[14px] bg-canvas focus:bg-surface"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setUrlError(null);
                setUrlMode(false);
              }}
              className="h-10 px-4 rounded-full bg-transparent hover:bg-black/[0.05] text-ink-secondary hover:text-ink text-[13.5px] font-medium transition-colors cursor-pointer"
            >
              返回
            </button>
            <button
              type="submit"
              disabled={fetchingUrl || !urlValue.trim()}
              className="ui-btn-primary h-10 px-5 text-[13.5px]"
            >
              {fetchingUrl ? "正在抓取正文…" : "抓取并导入素材"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (pasteMode) {
    return (
      <section className="flex-1 min-h-0 overflow-y-auto bg-stage flex items-center justify-center p-6 sm:p-10">
        <form
          onSubmit={(e) => void handleSaveNote(e)}
          className="w-full max-w-[760px] rounded-[18px] bg-surface border border-black/[0.08] p-7 sm:p-10 space-y-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
                直接粘贴文本或 Markdown 笔记
              </h2>
              <p className="text-[13.5px] text-ink-secondary mt-0.5">
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
              className="ui-field w-full h-11 px-4 text-[14px] bg-canvas focus:bg-surface"
            />
            <textarea
              rows={7}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="在此直接粘贴会议纪要、技术方案、飞书文档或核心数据段落…"
              className="ui-field w-full px-4 py-3 text-[14px] bg-canvas focus:bg-surface leading-relaxed resize-y"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setPasteMode(false)}
              className="h-10 px-4 rounded-full bg-transparent hover:bg-black/[0.05] text-ink-secondary hover:text-ink text-[13.5px] font-medium transition-colors cursor-pointer"
            >
              返回
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteContent.trim()}
              className="ui-btn-primary h-10 px-5 text-[13.5px]"
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
        className="flex-1 min-h-0 overflow-y-auto bg-stage flex items-center justify-center p-6 sm:p-10"
      >
        <div
          className={`w-full max-w-[780px] rounded-[18px] bg-surface border-2 border-dashed transition-colors duration-200 flex flex-col items-center justify-center text-center p-8 sm:p-11 space-y-5 ${
            isDragging
              ? "border-ink bg-surface-subtle"
              : "border-border-dashed"
          }`}
        >
          <div className="w-14 h-14 rounded-2xl bg-canvas flex items-center justify-center text-ink">
            <Upload className="w-6 h-6" />
          </div>

          <div className="space-y-1.5 max-w-md">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
              导入文档素材，或从一句话主题开始
            </h2>
            <p className="text-[14px] text-ink-secondary leading-relaxed">
              支持 PDF、Word、Excel/CSV、旧 PPTX、Markdown、网页链接与图片（Ctrl+V 直接贴截图）。
              <br />
              缺少依据的数据会标记为「待补出处」，不会编造数字。
            </p>
          </div>

          {!llmConfigured && onOpenLLMSettings && (
            <div className="w-full max-w-lg px-4 py-2.5 rounded-xl bg-warning-bg border border-warning-dot/25 flex flex-wrap items-center justify-between gap-2 text-left text-[13px]">
              <span className="inline-flex items-center gap-2 text-warning font-medium">
                <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
                <span>尚未配置大模型，生成大纲前需先完成模型设置</span>
              </span>
              <button
                type="button"
                onClick={onOpenLLMSettings}
                className="font-semibold text-ink underline underline-offset-2 hover:opacity-70 cursor-pointer shrink-0"
              >
                前往模型设置
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onUploadClick}
              className="ui-btn-primary h-11 px-6 text-[14px]"
            >
              选择文件
            </button>
            <button
              type="button"
              onClick={() => setPasteMode(true)}
              className="ui-btn-subtle h-11 px-4 text-[14px] inline-flex items-center gap-1.5"
            >
              <ClipboardPaste className="w-4 h-4 text-ink" />
              <span>粘贴笔记</span>
            </button>
            {onImportUrl && (
              <button
                type="button"
                onClick={() => setUrlMode(true)}
                className="ui-btn-subtle h-11 px-4 text-[14px] inline-flex items-center gap-1.5"
              >
                <Globe className="w-4 h-4 text-ink" />
                <span>导入网页</span>
              </button>
            )}
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
            <div className="text-[13px] text-ink-secondary">
              没有现成文档？输入一句话主题，先生成大纲。
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <input
                type="text"
                value={outlinePrompt}
                onChange={(e) => setOutlinePrompt(e.target.value)}
                disabled={isGenerating}
                placeholder="例如：制作一份 6 页的 Q3 产品技术复盘汇报…"
                className="ui-pill-input flex-1 text-[14px]"
              />
              <button
                type="submit"
                disabled={!outlinePrompt.trim() || isGenerating}
                className="ui-btn-outline h-11 px-5 text-[13px] shrink-0 whitespace-nowrap"
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
      className="flex-1 min-h-0 overflow-y-auto bg-stage flex items-center justify-center p-6 sm:p-10"
    >
      <div
        className={`w-full max-w-[780px] rounded-[18px] bg-surface border transition-colors duration-200 flex flex-col items-center justify-center text-center p-8 sm:p-11 space-y-5 ${
          isDragging ? "border-ink border-2 border-dashed" : "border-black/[0.08]"
        }`}
      >
        <div className="w-13 h-13 rounded-2xl bg-canvas flex items-center justify-center text-ink">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 max-w-md">
          <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
            已就绪 {materials.length} 份原始材料
          </h2>
          <p className="text-[14px] text-ink-secondary leading-relaxed">
            AI 将严格按照这些材料切片提炼演示大纲，每一页均保留可追溯的出处引用。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
          {materials.slice(0, 6).map((m, i) => (
            <span
              key={`${m.asset_id}-${m.asset_type}-${i}`}
              title={m.asset_id}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-canvas text-[13px] font-medium text-ink"
            >
              {m.asset_type === "image" ? (
                <ImageIcon className="w-3.5 h-3.5 text-ink-secondary" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-ink-secondary" />
              )}
              <span className="truncate max-w-[140px]">
                {formatAssetLabel(m.asset_id)}
              </span>
            </span>
          ))}
          {materials.length > 6 && (
            <span className="text-[13px] text-ink-muted">
              +{materials.length - 6} 份
            </span>
          )}
        </div>

        {/* Optional Direction / Audience / Page Count Prompt (PRD Stage 2 & F-04) */}
        {!llmConfigured && onOpenLLMSettings && (
          <div className="w-full max-w-lg px-4 py-2.5 rounded-xl bg-warning-bg border border-warning-dot/25 flex flex-wrap items-center justify-between gap-2 text-left text-[13px]">
            <span className="inline-flex items-center gap-2 text-warning font-medium">
              <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
              <span>尚未配置大模型，配置后即可基于这些素材生成大纲</span>
            </span>
            <button
              type="button"
              onClick={onOpenLLMSettings}
              className="font-semibold text-ink underline underline-offset-2 hover:opacity-70 cursor-pointer shrink-0"
            >
              前往模型设置
            </button>
          </div>
        )}

        <div className="w-full max-w-lg space-y-2 text-left bg-canvas p-3.5 rounded-2xl">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <label className="block text-[13px] font-medium text-ink-secondary">
              提炼方向与要求（选填）
            </label>
            {llmConfigured && onOpenLLMSettings && (
              llmSettings ? (
                <ModelQuickSwitcher
                  settings={llmSettings}
                  onSettingsUpdated={onLLMSettingsUpdated}
                  onOpenSettings={onOpenLLMSettings}
                  align="right"
                />
              ) : activeModelLabel ? (
                <button
                  type="button"
                  onClick={onOpenLLMSettings}
                  title="点击切换或修改模型设置"
                  className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink transition-colors cursor-pointer shrink-0"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[160px]">{activeModelLabel}</span>
                </button>
              ) : null
            )}
          </div>
          <input
            type="text"
            value={outlinePrompt}
            onChange={(e) => setOutlinePrompt(e.target.value)}
            placeholder="例如：控制在 6 页以内，面向技术架构评审，重点突出性能数据…"
            className="ui-pill-input w-full h-10 bg-surface text-[14px]"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setOutlinePrompt(preset)}
                className="text-[13px] px-2.5 py-0.5 rounded-full bg-surface hover:bg-ink text-ink-secondary hover:text-white border border-black/[0.08] transition-colors cursor-pointer"
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
            className="ui-btn-primary h-11 px-6 text-[14px]"
          >
            {isGenerating ? "正在解析并提炼大纲…" : "开始提炼大纲"}
          </button>
          <button
            type="button"
            onClick={onUploadClick}
            className="ui-btn-subtle h-11 px-4 text-[13.5px]"
          >
            + 上传文件
          </button>
          <button
            type="button"
            onClick={() => setPasteMode(true)}
            className="ui-btn-subtle h-11 px-4 text-[13.5px] inline-flex items-center gap-1.5"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-ink" />
            <span>粘贴笔记</span>
          </button>
        </div>
      </div>
    </section>
  );
}
