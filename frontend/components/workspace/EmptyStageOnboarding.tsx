"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  FileText,
  Globe,
  Image as ImageIcon,
  Paperclip,
  Settings,
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
  "面向管理层季度复盘，按背景、成果与规划展开",
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
  const [promptHint, setPromptHint] = useState<string | null>(null);

  const composerFormRef = useRef<HTMLFormElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);

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
      // Handled by workspace error banner
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

  function handleComposerSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isGenerating) return;
    const cleanPrompt = outlinePrompt.trim();
    if (materials.length === 0 && !cleanPrompt) {
      setPromptHint("请先输入演示主题，或添加至少一份参考材料。");
      promptInputRef.current?.focus();
      return;
    }
    setPromptHint(null);
    onGenerateOutline(cleanPrompt || undefined);
  }

  function handlePromptKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
        return;
      }
      composerFormRef.current?.requestSubmit();
    }
  }

  if (urlMode && onImportUrl) {
    return (
      <section className="flex-1 min-h-0 overflow-y-auto clean-scroll bg-ui-bg flex flex-col p-6 sm:p-10">
        <div className="my-auto w-full max-w-[660px] mx-auto space-y-4">
          <button
            type="button"
            onClick={() => {
              setUrlError(null);
              setUrlMode(false);
            }}
            className="inline-flex items-center gap-1.5 text-[13px] text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回</span>
          </button>

          <form
            aria-labelledby="url-form-heading"
            onSubmit={(e) => void handleImportUrl(e)}
            className="rounded-2xl bg-ui-surface p-6 sm:p-8 space-y-5"
          >
            <div className="space-y-1">
              <h1
                id="url-form-heading"
                className="text-[20px] font-semibold tracking-[-0.02em] text-ui-text"
              >
                导入公开网页
              </h1>
              <p
                id="url-import-help"
                className="text-[13.5px] text-ui-text-muted leading-relaxed"
              >
                提取公开文章、文档或博客正文并切分为可溯源材料。
              </p>
            </div>

            {urlError && (
              <div
                id="url-import-error"
                role="alert"
                className="p-3.5 rounded-xl bg-ui-danger-bg space-y-2.5 text-[13px] text-ui-danger"
              >
                <p className="leading-relaxed">{urlError}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleFallbackToPasteFromUrl}
                    className="ui-btn-subtle px-3 py-1 text-[13px] text-ui-text"
                  >
                    改为手动粘贴正文
                  </button>
                  <span className="text-ui-danger/80 text-[12.5px]">
                    会自动保留来源链接，直接粘贴文字即可
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="import-url-input"
                  className="block text-[13px] font-medium text-ui-text-secondary"
                >
                  网页链接
                </label>
                <input
                  id="import-url-input"
                  name="url"
                  type="url"
                  required
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="done"
                  aria-invalid={urlError ? "true" : undefined}
                  aria-describedby={
                    urlError ? "url-import-error" : "url-import-help"
                  }
                  value={urlValue}
                  onChange={(e) => {
                    setUrlValue(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  placeholder="https://example.com/article"
                  className="ui-field bg-ui-bg w-full h-10 px-3.5 text-[14px] font-mono"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="import-url-title"
                  className="block text-[13px] font-medium text-ui-text-secondary"
                >
                  材料名称（选填）
                </label>
                <input
                  id="import-url-title"
                  name="title"
                  type="text"
                  enterKeyHint="done"
                  value={urlTitle}
                  onChange={(e) => setUrlTitle(e.target.value)}
                  placeholder="留空则自动使用网页标题"
                  className="ui-field bg-ui-bg w-full h-10 px-3.5 text-[14px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setUrlError(null);
                  setUrlMode(false);
                }}
                className="h-9 px-4 rounded-lg text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover text-[13.5px] font-medium transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={fetchingUrl}
                className="ui-btn-primary h-9 px-5 text-[13.5px]"
              >
                {fetchingUrl ? "正在抓取正文…" : "抓取并导入"}
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  if (pasteMode) {
    return (
      <section className="flex-1 min-h-0 overflow-y-auto clean-scroll bg-ui-bg flex flex-col p-6 sm:p-10">
        <div className="my-auto w-full max-w-[700px] mx-auto space-y-4">
          <button
            type="button"
            onClick={() => setPasteMode(false)}
            className="inline-flex items-center gap-1.5 text-[13px] text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回</span>
          </button>

          <form
            aria-labelledby="paste-form-heading"
            onSubmit={(e) => void handleSaveNote(e)}
            className="rounded-2xl bg-ui-surface p-6 sm:p-8 space-y-5"
          >
            <div className="space-y-1">
              <h1
                id="paste-form-heading"
                className="text-[20px] font-semibold tracking-[-0.02em] text-ui-text"
              >
                粘贴文本或笔记
              </h1>
              <p className="text-[13.5px] text-ui-text-muted leading-relaxed">
                保存后会自动切分为可溯源的原始材料，无需先在本地创建文件。
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="paste-note-title"
                  className="block text-[13px] font-medium text-ui-text-secondary"
                >
                  材料名称（选填）
                </label>
                <input
                  id="paste-note-title"
                  name="title"
                  type="text"
                  enterKeyHint="next"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="例如：2026 架构评审纪要"
                  className="ui-field bg-ui-bg w-full h-10 px-3.5 text-[14px]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="paste-note-content"
                  className="block text-[13px] font-medium text-ui-text-secondary"
                >
                  正文内容
                </label>
                <textarea
                  id="paste-note-content"
                  name="content"
                  required
                  rows={7}
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="粘贴会议纪要、技术方案、文档段落或核心数据…"
                  className="ui-field bg-ui-bg ui-autogrow-note px-3.5 py-2.5 text-[14px] leading-relaxed resize-y"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setPasteMode(false)}
                className="h-9 px-4 rounded-lg text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover text-[13.5px] font-medium transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={savingNote}
                className="ui-btn-primary h-9 px-5 text-[13.5px]"
              >
                {savingNote ? "正在保存…" : "保存材料"}
              </button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  const hasMaterials = materials.length > 0;

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
          setPromptHint(null);
          onDropFiles(e.dataTransfer.files);
        }
      }}
      className="flex-1 min-h-0 overflow-y-auto clean-scroll bg-ui-bg flex flex-col p-6 sm:p-10"
    >
      <div className="my-auto w-full max-w-[700px] mx-auto space-y-6">
        {/* Left-Aligned Studio Heading */}
        <div className="space-y-2">
          <h1
            id="onboarding-heading"
            className="text-[24px] sm:text-[26px] font-semibold tracking-[-0.025em] leading-[1.3] text-ui-text"
          >
            {hasMaterials
              ? `已就绪 ${materials.length} 份材料`
              : "你想做什么演示文稿？"}
          </h1>
          <p className="text-[13.5px] text-ui-text-muted leading-relaxed max-w-[60ch]">
            {hasMaterials
              ? "补充受众、页数或重点方向，AI 将基于材料切片生成可溯源大纲。"
              : "输入主题，或直接拖入文档、粘贴笔记与网页链接；所有数据均保留来源出处。"}
          </p>
        </div>

        {!llmConfigured && onOpenLLMSettings && (
          <div className="px-4 py-2.5 rounded-xl bg-ui-warning-bg flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-2 text-ui-warning font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
              <span>尚未配置大模型，生成大纲前需先完成模型设置</span>
            </span>
            <button
              type="button"
              onClick={onOpenLLMSettings}
              className="font-medium text-ui-text underline underline-offset-2 hover:opacity-80 cursor-pointer shrink-0"
            >
              前往设置
            </button>
          </div>
        )}

        {/* Unified Borderless Dark Studio Composer */}
        <form
          ref={composerFormRef}
          aria-labelledby="onboarding-heading"
          onSubmit={handleComposerSubmit}
          className={`rounded-2xl p-4 sm:p-5 transition-[background-color,box-shadow] duration-[160ms] ease-out ${
            isDragging
              ? "bg-ui-bg-selected ring-1 ring-ui-focus"
              : "bg-ui-surface focus-within:ring-1 focus-within:ring-ui-border/50"
          }`}
        >
          {isDragging && (
            <div className="pb-3 text-[13px] font-medium text-ui-accent-text">
              松开鼠标即可导入材料
            </div>
          )}

          {hasMaterials && (
            <div className="flex flex-wrap items-center gap-1.5 pb-3.5">
              {materials.slice(0, 8).map((m, i) => (
                <span
                  key={`${m.asset_id}-${m.asset_type}-${i}`}
                  title={m.asset_id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ui-bg text-[12.5px] text-ui-text-secondary max-w-[200px]"
                >
                  {m.asset_type === "image" ? (
                    <ImageIcon className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                  )}
                  <span className="truncate">
                    {formatAssetLabel(m.asset_id)}
                  </span>
                </span>
              ))}
              {materials.length > 8 && (
                <span className="text-[12.5px] text-ui-text-muted px-1">
                  +{materials.length - 8} 份
                </span>
              )}
            </div>
          )}

          <div>
            <label htmlFor="onboarding-prompt" className="sr-only">
              {hasMaterials ? "提炼方向与要求（选填）" : "演示主题或要求"}
            </label>
            <textarea
              ref={promptInputRef}
              id="onboarding-prompt"
              name="prompt"
              rows={3}
              enterKeyHint="send"
              value={outlinePrompt}
              disabled={isGenerating}
              aria-invalid={promptHint ? "true" : undefined}
              aria-describedby={
                promptHint ? "onboarding-prompt-hint" : undefined
              }
              onChange={(e) => {
                setOutlinePrompt(e.target.value);
                if (promptHint) setPromptHint(null);
              }}
              onKeyDown={handlePromptKeyDown}
              placeholder={
                hasMaterials
                  ? "补充提炼方向（选填），例如：控制在 6 页以内，面向技术评审…"
                  : "描述主题、受众或页数要求，例如：制作一份 6 页的 Q3 产品技术复盘汇报…"
              }
              className="ui-autogrow-textarea bg-transparent text-[15px] leading-[1.6] text-ui-text placeholder:text-ui-text-muted outline-none resize-none disabled:opacity-60"
            />
            {promptHint && (
              <p
                id="onboarding-prompt-hint"
                role="alert"
                className="text-[12.5px] text-ui-warning pt-1"
              >
                {promptHint}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={onUploadClick}
                className="h-8 px-2.5 rounded-lg text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Paperclip className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span>{hasMaterials ? "添加文件" : "上传文件"}</span>
              </button>
              <button
                type="button"
                onClick={() => setPasteMode(true)}
                className="h-8 px-2.5 rounded-lg text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span>粘贴笔记</span>
              </button>
              {onImportUrl && (
                <button
                  type="button"
                  onClick={() => setUrlMode(true)}
                  className="h-8 px-2.5 rounded-lg text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                  <span>导入网页</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {llmConfigured &&
                onOpenLLMSettings &&
                (llmSettings ? (
                  <ModelQuickSwitcher
                    settings={llmSettings}
                    onSettingsUpdated={onLLMSettingsUpdated}
                    onOpenSettings={onOpenLLMSettings}
                    align="right"
                    compact
                  />
                ) : activeModelLabel ? (
                  <button
                    type="button"
                    onClick={onOpenLLMSettings}
                    title="切换或修改模型设置"
                    className="inline-flex items-center gap-1 text-[12.5px] text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer px-2 py-1 rounded-md hover:bg-ui-control-hover shrink-0"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[140px]">
                      {activeModelLabel}
                    </span>
                  </button>
                ) : null)}

              <button
                type="submit"
                disabled={isGenerating}
                className="ui-btn-primary h-8.5 px-4 text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {isGenerating ? "正在生成大纲…" : "生成大纲"}
              </button>
            </div>
          </div>
        </form>

        {/* Contextual Quiet Footer: Format Note (empty) OR Direction Chips (materials ready) */}
        {hasMaterials ? (
          <div className="flex flex-wrap items-center gap-2">
            {PROMPT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setOutlinePrompt(preset);
                  setPromptHint(null);
                  promptInputRef.current?.focus();
                }}
                className="text-[12.5px] px-3 py-1.5 rounded-lg bg-ui-surface hover:bg-ui-control-hover text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
              >
                {preset}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-ui-text-muted leading-relaxed">
            支持拖入 PDF、Word、Excel/CSV、PPTX、Markdown 与图片，或直接按 Ctrl+V 粘贴截图。缺乏依据的数据会标记为待补出处，不会编造数字。
          </p>
        )}
      </div>
    </section>
  );
}
