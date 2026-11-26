"use client";

import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AtSign,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Layers,
  Paperclip,
  RotateCcw,
  Settings,
  Square,
  Upload,
} from "lucide-react";
import type {
  ChatDeckChanges,
  ChatMessage,
  ChatToolStep,
  LLMSettingsResponse,
  Material,
  Outline,
  ThemeOption,
} from "../../lib/api";
import { ModelQuickSwitcher } from "../ModelQuickSwitcher";
import { Collapse } from "../ui/Collapse";

interface AgentChatPanelProps {
  pid: string;
  outline: Outline | null;
  selectedIndex: number;
  materials?: Material[];
  materialsCount: number;
  themes: ThemeOption[];
  selectedThemeId: string;
  autoFit: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  llmConfigured: boolean;
  activeModelLabel?: string;
  llmSettings?: LLMSettingsResponse | null;
  onLLMSettingsUpdated?: (next: LLMSettingsResponse) => void;
  diffPreviewVersion?: string | null;
  onToggleDiffPreview?: (beforeVersion: string | null) => void;
  onOpenLLMSettings: () => void;
  onSendMessage: (text: string) => void;
  onRetryMessage: (text: string, failedMessageId: string) => void;
  onStopStreaming: () => void;
  onJumpToSlide: (slideIndex: number) => void;
  onRevertVersion: (version: string) => void;
  onUploadClick: () => void;
  onDropFiles: (files: FileList) => void;
}

function renderSlideLinkPill(
  pageNum: number,
  key: string | number,
  onJumpToSlide: (idx: number) => void,
  bold = false
) {
  return (
    <button
      key={key}
      type="button"
      onClick={() => onJumpToSlide(pageNum - 1)}
      title={`跳转到第 ${pageNum} 页`}
      className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-ui-bg-selected hover:bg-ui-control-active text-[12.5px] text-ui-accent-text transition-colors cursor-pointer align-baseline ${
        bold ? "font-semibold" : "font-medium"
      }`}
    >
      第 {pageNum} 页
    </button>
  );
}

function renderInlineWithSlideLinks(
  text: string,
  totalSlides: number,
  onJumpToSlide: (idx: number) => void,
  options?: { inBold?: boolean; keyPrefix?: string }
): ReactNode[] {
  const inBold = options?.inBold ?? false;
  const keyPrefix = options?.keyPrefix ?? "in";
  const tokenRegex = inBold
    ? /(`[^`]+`|第\s*\d+\s*页)/g
    : /(\*\*[^*]+\*\*|`[^`]+`|第\s*\d+\s*页)/g;
  const parts = text.split(tokenRegex);
  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (!part) return null;
    if (!inBold && part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const inner = part.slice(2, -2);
      const exactPage = /^第\s*(\d+)\s*页$/.exec(inner.trim());
      if (exactPage) {
        const pageNum = parseInt(exactPage[1], 10);
        if (pageNum >= 1 && pageNum <= totalSlides) {
          return renderSlideLinkPill(pageNum, key, onJumpToSlide, true);
        }
      }
      return (
        <strong key={key} className="font-semibold text-ui-text">
          {renderInlineWithSlideLinks(inner, totalSlides, onJumpToSlide, {
            inBold: true,
            keyPrefix: `${key}-b`,
          })}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-ui-bg-selected text-[12.5px] font-mono font-normal text-ui-text-secondary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const pageMatch = /^第\s*(\d+)\s*页$/.exec(part);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      if (pageNum >= 1 && pageNum <= totalSlides) {
        return renderSlideLinkPill(pageNum, key, onJumpToSlide, inBold);
      }
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function FormattedMessageBody({
  content,
  totalSlides,
  onJumpToSlide,
}: {
  content: string;
  totalSlides: number;
  onJumpToSlide: (idx: number) => void;
}) {
  const lines = content.split(/\r?\n/);
  return (
    <div className="space-y-1.5 text-[13.5px] leading-relaxed text-ui-text">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) {
          return <div key={idx} className="h-1" />;
        }
        const headingMatch = /^#{1,4}\s+(.+)$/.exec(line);
        if (headingMatch) {
          return (
            <div key={idx} className="text-[14px] font-semibold text-ui-text pt-1">
              {renderInlineWithSlideLinks(
                headingMatch[1],
                totalSlides,
                onJumpToSlide
              )}
            </div>
          );
        }
        const bulletMatch = /^[-*•]\s+(.+)$/.exec(line);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-0.5">
              <span className="w-1 h-1 rounded-full bg-ui-text-muted shrink-0 mt-[9px]" />
              <div className="flex-1 min-w-0">
                {renderInlineWithSlideLinks(
                  bulletMatch[1],
                  totalSlides,
                  onJumpToSlide
                )}
              </div>
            </div>
          );
        }
        const numMatch = /^(\d+)\.\s+(.+)$/.exec(line);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-0.5">
              <span className="text-ui-text-muted font-medium tabular-nums shrink-0">
                {numMatch[1]}.
              </span>
              <div className="flex-1 min-w-0">
                {renderInlineWithSlideLinks(
                  numMatch[2],
                  totalSlides,
                  onJumpToSlide
                )}
              </div>
            </div>
          );
        }
        return (
          <p key={idx} className="break-words">
            {renderInlineWithSlideLinks(line, totalSlides, onJumpToSlide)}
          </p>
        );
      })}
    </div>
  );
}

function ToolStepsBar({
  steps,
  isRunning,
}: {
  steps: ChatToolStep[];
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!steps.length) return null;

  const activeStep = [...steps].reverse().find((s) => s.status === "running");
  const errorCount = steps.filter((s) => s.status === "error").length;
  const warningCount = steps.filter((s) => s.status === "warning").length;

  return (
    <div className="rounded-lg bg-ui-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-left text-[12.5px] cursor-pointer hover:bg-ui-control-hover transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && activeStep ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-ui-accent animate-pulse shrink-0" />
              <span className="font-medium text-ui-text truncate">
                正在{activeStep.label}…
              </span>
            </>
          ) : errorCount > 0 ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-ui-danger shrink-0" />
              <span className="font-medium text-ui-text-secondary truncate">
                执行 {steps.length} 项操作（{errorCount} 项异常）
              </span>
            </>
          ) : warningCount > 0 ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
              <span className="font-medium text-ui-text-secondary truncate">
                完成 {steps.length} 项操作（{warningCount} 项提醒）
              </span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-ui-success shrink-0 anim-check-pop" />
              <span className="font-medium text-ui-text-secondary truncate">
                已完成 {steps.length} 项操作
              </span>
            </>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ui-icon shrink-0 transition-transform duration-[160ms] ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <Collapse open={expanded || (isRunning && steps.length > 1)}>
        <div className="px-2.5 pb-2 pt-1 space-y-1.5">
          {steps.map((st) => (
            <div
              key={st.id}
              className="flex items-center justify-between gap-2 text-[12.5px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    st.status === "running"
                      ? "bg-ui-accent animate-pulse"
                      : st.status === "error"
                      ? "bg-ui-danger"
                      : st.status === "warning"
                      ? "bg-ui-warning"
                      : "bg-ui-success"
                  }`}
                />
                <span className="text-ui-text-secondary truncate">
                  {st.label}
                </span>
              </div>
              {st.summary && (
                <span
                  className={`shrink-0 truncate max-w-[130px] ${
                    st.status === "error"
                      ? "text-ui-danger"
                      : st.status === "warning"
                      ? "text-ui-warning"
                      : "text-ui-text-muted"
                  }`}
                >
                  {st.summary}
                </span>
              )}
            </div>
          ))}
        </div>
      </Collapse>
    </div>
  );
}

function ErrorBubbleCard({
  msg,
  retryText,
  disabled,
  onRetry,
  onOpenLLMSettings,
}: {
  msg: ChatMessage;
  retryText: string | null;
  disabled: boolean;
  onRetry: () => void;
  onOpenLLMSettings: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const showModelSettings =
    !msg.error_code ||
    [
      "LLM_NOT_CONFIGURED",
      "AUTH_ERROR",
      "MODEL_NOT_FOUND",
      "RATE_LIMIT",
      "TIMEOUT_OR_NETWORK",
      "AGENT_ERROR",
    ].includes(msg.error_code);

  return (
    <div className="p-3 rounded-lg bg-ui-danger-bg border border-ui-danger/30 text-[13px] text-ui-danger leading-relaxed space-y-2">
      <div className="whitespace-pre-wrap break-words">{msg.content}</div>

      <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[12.5px]">
        {retryText && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-medium text-ui-danger underline underline-offset-2 hover:opacity-80 cursor-pointer disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重试</span>
          </button>
        )}

        {showModelSettings && (
          <button
            type="button"
            onClick={onOpenLLMSettings}
            className="font-medium text-ui-danger underline underline-offset-2 hover:opacity-80 cursor-pointer"
          >
            检查模型设置
          </button>
        )}

        {msg.error_detail && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-ui-danger/80 hover:text-ui-danger underline underline-offset-2 cursor-pointer"
          >
            {showDetail ? "收起详情" : "查看详情"}
          </button>
        )}
      </div>

      {showDetail && msg.error_detail && (
        <pre className="p-2 rounded bg-ui-bg border border-ui-danger/20 text-[12px] font-mono text-ui-danger/90 whitespace-pre-wrap break-all overflow-x-auto">
          {msg.error_detail}
        </pre>
      )}
    </div>
  );
}

function ChangeReceiptCard({
  pid,
  changes,
  totalSlides,
  themes,
  diffPreviewVersion,
  onToggleDiffPreview,
  onJumpToSlide,
  onRevertVersion,
}: {
  pid: string;
  changes: ChatDeckChanges;
  totalSlides: number;
  themes: ThemeOption[];
  diffPreviewVersion?: string | null;
  onToggleDiffPreview?: (beforeVersion: string | null) => void;
  onJumpToSlide: (idx: number) => void;
  onRevertVersion: (version: string) => void;
}) {
  const touched = (changes.touched_slides || []).filter(
    (n) => n >= 1 && n <= totalSlides
  );
  const themeName = changes.theme_id
    ? themes.find((t) => t.id === changes.theme_id)?.name || changes.theme_id
    : null;
  const canRevert = Boolean(
    changes.before_outline_version && changes.after_outline_version
  );

  if (!touched.length && !themeName && !changes.exported && !canRevert) {
    return null;
  }

  return (
    <div className="p-2.5 rounded-lg bg-ui-surface border border-ui-border-subtle space-y-2 anim-msg-in">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        {touched.length > 0 && (
          <>
            <span className="text-ui-text-muted mr-0.5">已更新</span>
            {touched.slice(0, 6).map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => onJumpToSlide(num - 1)}
                className="px-1.5 py-0.5 rounded bg-ui-surface-input hover:bg-ui-control-hover border border-ui-border-subtle text-ui-text transition-colors cursor-pointer"
              >
                第 {num} 页
              </button>
            ))}
            {touched.length > 6 && (
              <span className="text-ui-text-muted">等 {touched.length} 页</span>
            )}
          </>
        )}

        {themeName && (
          <span className="px-1.5 py-0.5 rounded bg-ui-surface-input border border-ui-border-subtle text-ui-text-secondary">
            主题：{themeName}
          </span>
        )}

        {changes.layout_checked_ok === true && (
          <span className="inline-flex items-center gap-1 text-ui-success">
            <Check className="w-3.5 h-3.5 anim-check-pop" />
            <span>排版安全</span>
          </span>
        )}
      </div>

      {(changes.exported || canRevert) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-ui-border-subtle text-[12.5px]">
          <div className="flex items-center gap-1.5">
            {changes.exported && (
              <>
                <a
                  href={`/api/projects/${pid}/download`}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md ui-btn-subtle text-[12.5px]"
                >
                  <Download className="w-3 h-3" />
                  <span>PPTX</span>
                </a>
                <a
                  href={`/api/projects/${pid}/download/pdf`}
                  download
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md ui-btn-subtle text-[12.5px]"
                >
                  <span>PDF</span>
                </a>
              </>
            )}
          </div>

          {canRevert && changes.before_outline_version && (
            <div className="flex items-center gap-3">
              {onToggleDiffPreview && (
                <button
                  type="button"
                  onClick={() =>
                    onToggleDiffPreview(
                      diffPreviewVersion === changes.before_outline_version
                        ? null
                        : changes.before_outline_version!
                    )
                  }
                  className={`inline-flex items-center gap-1 font-medium transition-colors cursor-pointer ${
                    diffPreviewVersion === changes.before_outline_version
                      ? "text-ui-warning"
                      : "text-ui-text-muted hover:text-ui-text"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>
                    {diffPreviewVersion === changes.before_outline_version
                      ? "退出对比"
                      : "对比改前"}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onRevertVersion(changes.before_outline_version!)}
                className="inline-flex items-center gap-1 text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>撤回</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentChatPanel({
  pid,
  outline,
  selectedIndex,
  materials = [],
  materialsCount,
  themes,
  messages,
  isStreaming,
  llmConfigured,
  activeModelLabel = "",
  llmSettings = null,
  onLLMSettingsUpdated,
  diffPreviewVersion = null,
  onToggleDiffPreview,
  onOpenLLMSettings,
  onSendMessage,
  onRetryMessage,
  onStopStreaming,
  onJumpToSlide,
  onRevertVersion,
  onUploadClick,
  onDropFiles,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const totalSlides = outline?.items.length || 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [draft]);

  function submitDraft() {
    const clean = draft.trim();
    if (!clean || isStreaming) return;
    setDraft("");
    onSendMessage(clean);
  }

  const mentionItems = (() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return [
      ...(outline?.items || []).map((it, i) => ({
        kind: "slide" as const,
        label: `第 ${i + 1} 页`,
        sub: it.title || "未命名",
        insert: `@第 ${i + 1} 页 `,
      })),
      ...materials.map((m) => ({
        kind: "material" as const,
        label: m.asset_id,
        sub: m.asset_type === "image" ? "图片素材" : "文档素材",
        insert: `@${m.asset_id} `,
      })),
    ]
      .filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.sub.toLowerCase().includes(q)
      )
      .slice(0, 10);
  })();

  const applyMention = (ins: string) => {
    const next = draft.replace(/@([^\s@]*)$/, ins);
    setDraft(next);
    setMentionQuery(null);
    setMentionIdx(0);
    inputRef.current?.focus();
  };

  const quickPrompts =
    totalSlides > 0
      ? [
          `只精简第 ${selectedIndex + 1} 页的正文，保留核心事实`,
          "检查全稿排版并找出缺失素材出处的页面",
          "给每一页补齐演讲者口播备注",
        ]
      : materialsCount > 0
      ? [
          "基于当前素材生成一份 6 页汇报大纲",
          "先帮我梳理素材里的核心结论与数据",
        ]
      : [
          "帮我搭一份 6 页产品介绍演示大纲框架",
          "我想做一份项目复盘 PPT，应该怎么安排结构？",
        ];

  return (
    <div
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
      className="flex-1 min-h-0 flex flex-col relative bg-ui-bg"
    >
      {/* Drag-Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-3 z-30 rounded-xl border border-dashed border-ui-focus bg-ui-surface/95 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-5 h-5 text-ui-accent-text" />
          <span className="text-[13.5px] font-medium text-ui-text">
            松开即可添加到材料库并参与对话
          </span>
        </div>
      )}

      {/* Scrollable Editorial Conversation Thread (matching mockup: 当前第 N 页 + 你 / 助手) */}
      <div className="flex-1 min-h-0 overflow-y-auto clean-scroll px-4 py-3.5 space-y-5">
        {totalSlides > 0 && (
          <div className="text-[12.5px] text-ui-text-muted">
            当前第 {selectedIndex + 1} 页
          </div>
        )}

        {!llmConfigured && (
          <div className="p-3.5 rounded-xl bg-ui-warning-bg border border-ui-warning/30 space-y-2.5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ui-warning">
              <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
              <span>尚未配置大模型</span>
            </div>
            <p className="text-[13px] text-ui-text-secondary leading-relaxed">
              配置 OpenAI、Google Gemini、DeepSeek 或本地 Ollama 后即可使用 AI 助手对话与精修。
            </p>
            <button
              type="button"
              onClick={onOpenLLMSettings}
              className="ui-btn-primary h-8 px-3.5 text-[13px] inline-flex items-center gap-1.5"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>前往配置模型</span>
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          llmConfigured ? (
            <div className="space-y-4">
              <p className="text-[13px] text-ui-text-muted leading-relaxed">
                告诉我你想修改的内容、版式或图表，所有改动都会实时同步到左侧画布并支持撤回。
              </p>

              <div className="space-y-1.5">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => onSendMessage(prompt)}
                    className="w-full text-left px-3 py-2 rounded-lg bg-ui-bg-hover hover:bg-ui-control-hover text-[13px] text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer leading-snug"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null
        ) : (
          messages.map((msg, idx) => {
            const isLastAssistant =
              msg.role === "assistant" && idx === messages.length - 1;
            const runningNow = isLastAssistant && isStreaming;

            if (msg.role === "user") {
              return (
                <div key={msg.id} className="space-y-1 anim-msg-in">
                  <div className="text-[12px] text-ui-text-muted">你</div>
                  <div className="text-[13.5px] text-ui-text leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              );
            }

            const prevUserMsg =
              idx > 0 && messages[idx - 1]?.role === "user"
                ? messages[idx - 1].content
                : null;

            return (
              <div key={msg.id} className="space-y-2 anim-msg-in">
                <div className="text-[12px] text-ui-text-muted">助手</div>

                {msg.tool_steps && msg.tool_steps.length > 0 && (
                  <ToolStepsBar
                    steps={msg.tool_steps}
                    isRunning={runningNow}
                  />
                )}

                {msg.content ? (
                  msg.is_error ? (
                    <ErrorBubbleCard
                      msg={msg}
                      retryText={prevUserMsg}
                      disabled={isStreaming}
                      onRetry={() => {
                        if (prevUserMsg) onRetryMessage(prevUserMsg, msg.id);
                      }}
                      onOpenLLMSettings={onOpenLLMSettings}
                    />
                  ) : (
                    <FormattedMessageBody
                      content={msg.content}
                      totalSlides={totalSlides}
                      onJumpToSlide={onJumpToSlide}
                    />
                  )
                ) : runningNow ? (
                  <div className="flex items-center gap-2 text-[13px] text-ui-text-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-ui-accent animate-pulse" />
                    <span>思考中…</span>
                  </div>
                ) : null}

                {msg.changes && !runningNow && (
                  <ChangeReceiptCard
                    pid={pid}
                    changes={msg.changes}
                    totalSlides={totalSlides}
                    themes={themes}
                    diffPreviewVersion={diffPreviewVersion}
                    onToggleDiffPreview={onToggleDiffPreview}
                    onJumpToSlide={onJumpToSlide}
                    onRevertVersion={onRevertVersion}
                  />
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Bottom Composer (matching mockup: --ui-surface-input + blue → send button) */}
      <div className="px-3.5 pb-3.5 pt-2 bg-ui-bg shrink-0 relative">
        {/* @ Mention Autocomplete Popover */}
        {mentionQuery !== null && mentionItems.length > 0 && (
          <div className="absolute bottom-full left-3.5 right-3.5 mb-2 z-30 ui-popover rounded-xl p-1.5 max-h-52 overflow-y-auto clean-scroll space-y-0.5 anim-popover-up-in">
            <div className="px-2 py-1 flex items-center justify-between text-[12px] font-medium text-ui-text-muted">
              <span>引用页面或材料</span>
              <span>↑↓ 选择 · Enter 确认</span>
            </div>
            {mentionItems.map((it, i) => (
              <button
                key={`${it.kind}-${it.label}-${i}`}
                type="button"
                onMouseEnter={() => setMentionIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(it.insert);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[13px] cursor-pointer transition-colors ${
                  i === Math.min(mentionIdx, mentionItems.length - 1)
                    ? "bg-ui-bg-selected text-ui-text font-medium"
                    : "text-ui-text-secondary hover:bg-ui-control-hover"
                }`}
              >
                {it.kind === "slide" ? (
                  <Layers className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                )}
                <span className="font-medium shrink-0">{it.label}</span>
                <span className="text-ui-text-muted truncate">{it.sub}</span>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-ui-surface-input focus-within:ring-1 focus-within:ring-ui-focus transition-shadow duration-150 px-3 pt-2.5 pb-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              const val = e.target.value;
              setDraft(val);
              const m = /@([^\s@]*)$/.exec(val);
              if (m) {
                setMentionQuery(m[1]);
                setMentionIdx(0);
              } else {
                setMentionQuery(null);
              }
            }}
            onKeyDown={(e) => {
              if (mentionQuery !== null && mentionItems.length > 0) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIdx((i) => (i + 1) % mentionItems.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIdx(
                    (i) => (i - 1 + mentionItems.length) % mentionItems.length
                  );
                  return;
                }
                if (
                  (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  const chosen =
                    mentionItems[Math.min(mentionIdx, mentionItems.length - 1)];
                  if (chosen) applyMention(chosen.insert);
                  return;
                }
              } else if (mentionQuery !== null && e.key === "Escape") {
                e.preventDefault();
                setMentionQuery(null);
                return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                setMentionQuery(null);
                submitDraft();
              }
            }}
            disabled={!llmConfigured}
            placeholder={
              !llmConfigured
                ? "请先配置大模型…"
                : "描述你想修改的内容…"
            }
            className="w-full bg-transparent text-[13.5px] text-ui-text placeholder:text-ui-text-muted outline-none resize-none leading-relaxed max-h-[150px] disabled:text-ui-text-disabled"
          />

          <div className="flex items-center justify-between gap-2 pt-1.5">
            <div className="flex items-center gap-0.5 min-w-0">
              <button
                type="button"
                onClick={onUploadClick}
                title="上传文档或图片到材料库"
                aria-label="添加材料"
                className="w-7 h-7 rounded-md inline-flex items-center justify-center text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft((d) => (d.endsWith("@") ? d : `${d}@`));
                  setMentionQuery("");
                  setMentionIdx(0);
                  inputRef.current?.focus();
                }}
                title="引用指定页码或材料 (@)"
                aria-label="引用页面或材料"
                className="w-7 h-7 rounded-md inline-flex items-center justify-center text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
              >
                <AtSign className="w-3.5 h-3.5" />
              </button>
              {llmSettings ? (
                <ModelQuickSwitcher
                  settings={llmSettings}
                  onSettingsUpdated={onLLMSettingsUpdated}
                  onOpenSettings={onOpenLLMSettings}
                  align="left"
                  compact={true}
                />
              ) : (
                <button
                  type="button"
                  onClick={onOpenLLMSettings}
                  title="切换或配置大模型"
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[12.5px] text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer min-w-0"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[120px] font-mono">
                    {llmConfigured && activeModelLabel
                      ? activeModelLabel
                      : "配置模型"}
                  </span>
                </button>
              )}
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                title="停止生成"
                className="h-7 px-2.5 rounded-lg ui-btn-outline text-[12.5px] inline-flex items-center gap-1 shrink-0"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!llmConfigured || !draft.trim()}
                onClick={submitDraft}
                title="发送 (Enter)"
                aria-label="发送消息"
                className="w-7 h-7 rounded-lg bg-ui-accent hover:bg-ui-accent-hover active:bg-ui-accent-active text-ui-on-accent flex items-center justify-center transition-[background-color,opacity] cursor-pointer disabled:opacity-45 disabled:hover:bg-ui-accent disabled:cursor-not-allowed shrink-0"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
