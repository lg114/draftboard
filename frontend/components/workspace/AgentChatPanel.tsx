"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
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
  Sparkles,
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
import { inferEffectiveLayout, LAYOUT_LABELS } from "./layoutUtils";

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
      className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-canvas hover:bg-black/[0.09] border border-black/[0.1] text-[13px] text-ink transition-colors cursor-pointer align-baseline ${
        bold ? "font-semibold" : "font-medium"
      }`}
    >
      第 {pageNum} 页
    </button>
  );
}

/** Render inline markdown bold (**...**), inline code (`...`), and clickable `第 N 页` slide pills (including nested inside **...**). */
function renderInlineWithSlideLinks(
  text: string,
  totalSlides: number,
  onJumpToSlide: (idx: number) => void
) {
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|第\s*\d+\s*页)/g;
  const parts = text.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const inner = part.slice(2, -2);
      const exactPage = /^第\s*(\d+)\s*页$/.exec(inner.trim());
      if (exactPage) {
        const pageNum = parseInt(exactPage[1], 10);
        if (pageNum >= 1 && pageNum <= totalSlides) {
          return renderSlideLinkPill(pageNum, idx, onJumpToSlide, true);
        }
      }
      // Handle mixed bold content such as **第 1 页：图文版式**
      if (/第\s*\d+\s*页/.test(inner)) {
        const subParts = inner.split(/(第\s*\d+\s*页)/g);
        return (
          <strong key={idx} className="font-semibold text-ink">
            {subParts.map((sp, si) => {
              const m = /^第\s*(\d+)\s*页$/.exec(sp);
              if (m) {
                const pn = parseInt(m[1], 10);
                if (pn >= 1 && pn <= totalSlides) {
                  return renderSlideLinkPill(pn, `${idx}-${si}`, onJumpToSlide, true);
                }
              }
              return <Fragment key={`${idx}-${si}`}>{sp}</Fragment>;
            })}
          </strong>
        );
      }
      return (
        <strong key={idx} className="font-semibold text-ink">
          {inner}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <span
          key={idx}
          className="px-1.5 py-0.5 rounded bg-canvas border border-black/[0.08] text-[13px] font-medium text-ink"
        >
          {part.slice(1, -1)}
        </span>
      );
    }
    const pageMatch = /^第\s*(\d+)\s*页$/.exec(part);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      if (pageNum >= 1 && pageNum <= totalSlides) {
        return renderSlideLinkPill(pageNum, idx, onJumpToSlide, false);
      }
    }
    return <Fragment key={idx}>{part}</Fragment>;
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
    <div className="space-y-1.5 text-[13.5px] leading-relaxed text-ink">
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();
        if (!line) {
          return <div key={idx} className="h-1" />;
        }
        const headingMatch = /^#{1,4}\s+(.+)$/.exec(line);
        if (headingMatch) {
          return (
            <div key={idx} className="text-[14px] font-semibold text-ink pt-1">
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
              <span className="w-1.5 h-1.5 rounded-full bg-ink-secondary shrink-0 mt-[9px]" />
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
              <span className="text-ink-secondary font-medium tabular-nums shrink-0">
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
    <div className="rounded-xl bg-canvas border border-black/[0.07] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-[13px] cursor-pointer hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && activeStep ? (
            <>
              <span className="w-2 h-2 rounded-full bg-ink animate-pulse shrink-0" />
              <span className="font-medium text-ink truncate">
                正在{activeStep.label}…
              </span>
            </>
          ) : errorCount > 0 ? (
            <>
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
              <span className="font-medium text-ink-secondary truncate">
                执行 {steps.length} 项操作（{errorCount} 项异常）
              </span>
            </>
          ) : warningCount > 0 ? (
            <>
              <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
              <span className="font-medium text-ink-secondary truncate">
                完成 {steps.length} 项操作（{warningCount} 项提醒）
              </span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-success shrink-0 anim-check-pop" />
              <span className="font-medium text-ink-secondary truncate">
                已完成 {steps.length} 项工作台操作
              </span>
            </>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ink-muted shrink-0 transition-transform duration-[160ms] ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <Collapse open={expanded || (isRunning && steps.length > 1)}>
        <div className="px-3 pb-2.5 pt-1 border-t border-black/[0.06] space-y-1.5">
          {steps.map((st) => (
            <div
              key={st.id}
              className="flex items-center justify-between gap-2 text-[13px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-[160ms] ${
                    st.status === "running"
                      ? "bg-ink animate-pulse"
                      : st.status === "error"
                      ? "bg-danger"
                      : st.status === "warning"
                      ? "bg-warning-dot"
                      : "bg-success"
                  }`}
                />
                <span className="text-ink truncate">{st.label}</span>
              </div>
              {st.summary && (
                <span
                  className={`shrink-0 truncate max-w-[155px] ${
                    st.status === "error"
                      ? "text-danger"
                      : st.status === "warning"
                      ? "text-warning"
                      : "text-ink-muted"
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
    <div className="p-3 rounded-xl bg-danger-bg border border-danger/20 text-[13px] text-danger leading-relaxed space-y-2.5">
      <div className="whitespace-pre-wrap break-words">{msg.content}</div>

      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        {retryText && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRetry}
            className="inline-flex items-center gap-1 font-semibold text-danger underline underline-offset-2 hover:opacity-80 cursor-pointer disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>重试</span>
          </button>
        )}

        {showModelSettings && (
          <button
            type="button"
            onClick={onOpenLLMSettings}
            className="font-semibold text-danger underline underline-offset-2 hover:opacity-80 cursor-pointer"
          >
            检查模型设置
          </button>
        )}

        {msg.error_detail && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-danger/80 hover:text-danger underline underline-offset-2 cursor-pointer"
          >
            {showDetail ? "收起详情" : "查看详情"}
          </button>
        )}
      </div>

      {showDetail && msg.error_detail && (
        <pre className="p-2.5 rounded-lg bg-surface/85 border border-danger/15 text-[13px] font-mono text-danger/90 whitespace-pre-wrap break-all overflow-x-auto">
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
    <div className="p-3 rounded-xl bg-surface border border-black/[0.08] space-y-2.5 anim-msg-in">
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
        {touched.length > 0 && (
          <>
            <span className="text-ink-secondary font-medium mr-0.5">
              已同步画布
            </span>
            {touched.slice(0, 6).map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => onJumpToSlide(num - 1)}
                className="px-2 py-0.5 rounded-md bg-canvas hover:bg-black/[0.09] border border-black/[0.08] text-[13px] font-medium text-ink transition-colors cursor-pointer"
              >
                第 {num} 页
              </button>
            ))}
            {touched.length > 6 && (
              <span className="text-ink-muted">等 {touched.length} 页</span>
            )}
          </>
        )}

        {themeName && (
          <span className="px-2 py-0.5 rounded-md bg-canvas text-[13px] text-ink">
            主题：{themeName}
          </span>
        )}

        {changes.layout_checked_ok === true && (
          <span className="inline-flex items-center gap-1 text-[13px] text-success font-medium">
            <Check className="w-3.5 h-3.5 anim-check-pop" />
            <span>排版安全</span>
          </span>
        )}
      </div>

      {(changes.exported || canRevert) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-black/[0.06]">
          <div className="flex items-center gap-2">
            {changes.exported && (
              <>
                <a
                  href={`/api/projects/${pid}/download`}
                  download
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full ui-btn-outline text-[13px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>下载 PPTX</span>
                </a>
                <a
                  href={`/api/projects/${pid}/download/pdf`}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-canvas hover:bg-black/[0.08] text-ink text-[13px] font-medium transition-colors"
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
                  className={`inline-flex items-center gap-1 text-[13px] font-medium transition-colors cursor-pointer ${
                    diffPreviewVersion === changes.before_outline_version
                      ? "text-warning font-semibold"
                      : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>
                    {diffPreviewVersion === changes.before_outline_version
                      ? "退出改前对比"
                      : "对比改前"}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onRevertVersion(changes.before_outline_version!)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary hover:text-ink transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>撤回修改</span>
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
  const currentSlide = outline?.items[selectedIndex];
  const currentLayout = currentSlide
    ? inferEffectiveLayout(currentSlide.layout, selectedIndex, totalSlides)
    : "content";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function submitDraft() {
    const clean = draft.trim();
    if (!clean || isStreaming) return;
    setDraft("");
    onSendMessage(clean);
  }

  const quickPrompts =
    totalSlides > 0
      ? [
          "检查全稿排版并找出缺失素材出处的页面",
          `把第 ${selectedIndex + 1} 页改写得更精炼有力`,
          "给每一页补齐实用的演讲者口播备注",
          "把整套文稿改成更适合管理层汇报的精简结构",
        ]
      : materialsCount > 0
      ? [
          "基于当前素材生成一份 6 页汇报大纲并自检排版",
          "先帮我梳理项目素材里的核心结论和关键数据",
          "按「背景 → 核心成果 → 规划」结构生成大纲",
        ]
      : [
          "帮我先搭一份 6 页 Q3 产品技术复盘大纲框架",
          "我想做一份项目立项评审 PPT，应该怎么安排结构？",
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
      className="flex-1 min-h-0 flex flex-col relative bg-surface-subtle"
    >
      {/* Drag-Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-3 z-30 rounded-2xl border-2 border-dashed border-ink bg-surface/95 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-6 h-6 text-ink" />
          <span className="text-[14px] font-semibold text-ink">
            松开即可添加到素材库并参与对话
          </span>
        </div>
      )}

      {/* Scrollable Conversation Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto clean-scroll px-4 py-4 space-y-5">
        {!llmConfigured && (
          <div className="p-4 rounded-2xl bg-surface border border-warning-dot/30 space-y-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
              <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
              <span>尚未配置大模型</span>
            </div>
            <p className="text-[13px] text-ink-secondary leading-relaxed">
              配置 OpenAI、Google Gemini、DeepSeek 或本地 Ollama 后，即可使用 PPT 创作 Agent 对话、自动提炼大纲与单页精修。未配置时仍可正常手动编辑并导出 PPTX / PDF。
            </p>
            <button
              type="button"
              onClick={onOpenLLMSettings}
              className="ui-btn-primary h-9 px-4 text-[13px] inline-flex items-center gap-1.5"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>立即配置大模型</span>
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          llmConfigured ? (
            <div className="pt-4 space-y-5">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                  <Sparkles className="w-4 h-4" />
                  <span>PPT 创作 Agent</span>
                </div>
                <p className="text-[13px] text-ink-secondary leading-relaxed">
                  像协作伙伴一样直接告诉我你想改哪一页、调整结构、换主题或检查排版。所有修改都会实时同步到左侧画布并保留可撤回快照。
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[13px] font-medium text-ink-muted">
                  试试这样说
                </div>
                <div className="space-y-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={isStreaming}
                      onClick={() => onSendMessage(prompt)}
                      className="w-full text-left px-3.5 py-2.5 rounded-xl bg-surface hover:bg-canvas border border-black/[0.08] hover:border-black/[0.18] text-[13px] text-ink transition-colors cursor-pointer leading-snug"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
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
                <div key={msg.id} className="flex justify-end anim-msg-in">
                  <div className="max-w-[88%] rounded-2xl bg-canvas border border-black/[0.08] px-3.5 py-2.5 text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words">
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
              <div key={msg.id} className="space-y-2.5">
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
                    <div className="px-0.5">
                      <FormattedMessageBody
                        content={msg.content}
                        totalSlides={totalSlides}
                        onJumpToSlide={onJumpToSlide}
                      />
                    </div>
                  )
                ) : runningNow ? (
                  <div className="flex items-center gap-2 text-[13px] text-ink-muted px-0.5">
                    <span className="w-2 h-2 rounded-full bg-ink animate-pulse" />
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

      {/* Bottom Composer (with @ Mention Autocomplete & Contextual Quick Actions) */}
      <div className="px-3.5 pb-3.5 pt-1 bg-surface-subtle shrink-0 relative space-y-2">
        {/* Contextual Quick Action Chips */}
        {llmConfigured && totalSlides > 0 && !isStreaming && (
          <div className="flex items-center gap-1.5 overflow-x-auto clean-scroll pb-0.5">
            {(outline?.items[selectedIndex]?.custom_elements?.length
              ? [
                  `第 ${selectedIndex + 1} 页精简文字留白更多`,
                  `给第 ${selectedIndex + 1} 页补一张柱状趋势图`,
                  "按 10 分钟汇报节奏补全全稿演讲者备注",
                ]
              : [
                  `把第 ${selectedIndex + 1} 页改成 3 张核心指标卡`,
                  `把第 ${selectedIndex + 1} 页做成对比表格+图表`,
                  "按 10 分钟汇报节奏补全全稿演讲者备注",
                ]
            ).map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => onSendMessage(chip)}
                className="px-2.5 py-1 rounded-full bg-surface hover:bg-canvas border border-black/[0.08] hover:border-black/20 text-[13px] text-ink-secondary hover:text-ink transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* @ Mention Autocomplete Popover */}
        {mentionQuery !== null && (() => {
          const q = mentionQuery.toLowerCase();
          const mentionItems: Array<{ kind: "slide" | "material"; label: string; sub: string; insert: string }> = [
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
          ].filter(
            (item) =>
              !q ||
              item.label.toLowerCase().includes(q) ||
              item.sub.toLowerCase().includes(q)
          );

          if (mentionItems.length === 0) return null;
          const applyMention = (ins: string) => {
            const next = draft.replace(/@([^\s@]*)$/, ins);
            setDraft(next);
            setMentionQuery(null);
            setMentionIdx(0);
            inputRef.current?.focus();
          };

          return (
            <div className="absolute bottom-full left-3.5 right-3.5 mb-1.5 z-30 apple-glass dock-shadow rounded-xl p-1.5 max-h-52 overflow-y-auto clean-scroll space-y-0.5 anim-popover-up-in">
              <div className="px-2 py-1 text-[13px] font-medium text-ink-muted">
                引用页面或素材
              </div>
              {mentionItems.slice(0, 10).map((it, i) => (
                <button
                  key={`${it.kind}-${it.label}-${i}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(it.insert);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-[13px] cursor-pointer transition-colors ${
                    i === mentionIdx
                      ? "bg-black/[0.07] text-ink font-medium"
                      : "text-ink hover:bg-black/[0.04]"
                  }`}
                >
                  {it.kind === "slide" ? (
                    <Layers className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                  )}
                  <span className="font-medium shrink-0">{it.label}</span>
                  <span className="text-ink-muted truncate">{it.sub}</span>
                </button>
              ))}
            </div>
          );
        })()}

        {/* Input Box */}
        <div className="rounded-2xl bg-surface border border-black/[0.12] hover:border-black/25 focus-within:border-ink focus-within:ring-4 focus-within:ring-black/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-200 px-3 pt-2.5 pb-2">
          <textarea
            ref={inputRef}
            rows={2}
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
              if (mentionQuery !== null && e.key === "Escape") {
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
                ? "请先点击上方「立即配置大模型」…"
                : totalSlides > 0
                ? "告诉 Agent 要修改的内容、版式或图表（输入 @ 可引用页码或素材）…"
                : "输入想法，或拖入文档/粘贴截图让 Agent 帮你从零搭 PPT…"
            }
            className="w-full bg-transparent text-[13.5px] text-ink placeholder:text-ink-muted outline-none resize-none leading-relaxed max-h-[160px] disabled:opacity-60"
          />

          <div className="flex items-center justify-between gap-2 pt-1.5">
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={onUploadClick}
                title="上传文档或图片到素材库"
                aria-label="添加素材"
                className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer shrink-0"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft((d) => (d.endsWith("@") ? d : `${d}@`));
                  setMentionQuery("");
                  setMentionIdx(0);
                  inputRef.current?.focus();
                }}
                title="引用指定页码或素材 (@)"
                aria-label="引用页面或素材"
                className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer shrink-0"
              >
                <AtSign className="w-3.5 h-3.5" />
              </button>
              {llmSettings ? (
                <ModelQuickSwitcher
                  settings={llmSettings}
                  onSettingsUpdated={onLLMSettingsUpdated}
                  onOpenSettings={onOpenLLMSettings}
                  align="left"
                />
              ) : (
                <button
                  type="button"
                  onClick={onOpenLLMSettings}
                  title="切换或配置大模型"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer min-w-0"
                >
                  <Settings className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[175px]">
                    {llmConfigured && activeModelLabel
                      ? activeModelLabel
                      : "配置模型"}
                  </span>
                </button>
              )}
              <span className="hidden xl:inline text-[13px] text-ink-muted truncate">
                {totalSlides > 0
                  ? `第 ${selectedIndex + 1} 页`
                  : `${materialsCount} 份素材`}
              </span>
            </div>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                title="停止生成"
                className="h-8 px-3 rounded-full ui-btn-outline text-[13px] inline-flex items-center gap-1.5 shrink-0"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!llmConfigured || !draft.trim()}
                onClick={submitDraft}
                title="发送 (Enter)"
                aria-label="发送消息"
                className="w-8 h-8 rounded-full bg-ink hover:bg-ink-hover text-white flex items-center justify-center transition-colors cursor-pointer disabled:bg-disabled-bg disabled:text-ink-muted disabled:cursor-not-allowed shrink-0"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
