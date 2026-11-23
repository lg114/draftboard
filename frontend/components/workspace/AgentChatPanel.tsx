"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  Paperclip,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  ChatDeckChanges,
  ChatMessage,
  ChatToolStep,
  Outline,
  ThemeOption,
} from "../../lib/api";
import { inferEffectiveLayout, LAYOUT_LABELS } from "./layoutUtils";

interface AgentChatPanelProps {
  pid: string;
  outline: Outline | null;
  selectedIndex: number;
  materialsCount: number;
  themes: ThemeOption[];
  selectedThemeId: string;
  autoFit: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onStopStreaming: () => void;
  onClearHistory: () => void;
  onJumpToSlide: (slideIndex: number) => void;
  onRevertVersion: (version: string) => void;
  onUploadClick: () => void;
  onDropFiles: (files: FileList) => void;
}

/** Render inline markdown bold (**...**), inline code (`...`), and clickable `第 N 页` slide pills. */
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
      return (
        <strong key={idx} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-canvas border border-black/[0.08] font-mono text-[13px] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const pageMatch = /^第\s*(\d+)\s*页$/.exec(part);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      if (pageNum >= 1 && pageNum <= totalSlides) {
        return (
          <button
            key={idx}
            type="button"
            onClick={() => onJumpToSlide(pageNum - 1)}
            title={`跳转到第 ${pageNum} 页`}
            className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md bg-canvas hover:bg-black/[0.09] border border-black/[0.1] text-[13px] font-medium text-ink transition-colors cursor-pointer align-baseline"
          >
            第 {pageNum} 页
          </button>
        );
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
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-success shrink-0" />
              <span className="font-medium text-ink-secondary truncate">
                已完成 {steps.length} 项工作台操作
              </span>
            </>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ink-muted shrink-0 transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {(expanded || (isRunning && steps.length > 1)) && (
        <div className="px-3 pb-2.5 pt-1 border-t border-black/[0.06] space-y-1.5">
          {steps.map((st) => (
            <div
              key={st.id}
              className="flex items-center justify-between gap-2 text-[13px]"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    st.status === "running"
                      ? "bg-ink animate-pulse"
                      : st.status === "error"
                      ? "bg-danger"
                      : "bg-success"
                  }`}
                />
                <span className="text-ink truncate">{st.label}</span>
              </div>
              {st.summary && (
                <span className="text-ink-muted shrink-0 truncate max-w-[140px]">
                  {st.summary}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeReceiptCard({
  pid,
  changes,
  totalSlides,
  themes,
  onJumpToSlide,
  onRevertVersion,
}: {
  pid: string;
  changes: ChatDeckChanges;
  totalSlides: number;
  themes: ThemeOption[];
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
    <div className="p-3 rounded-xl bg-surface border border-black/[0.08] space-y-2.5">
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
            <Check className="w-3.5 h-3.5" />
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
            <button
              type="button"
              onClick={() => onRevertVersion(changes.before_outline_version!)}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary hover:text-ink transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>撤回本次修改</span>
            </button>
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
  materialsCount,
  themes,
  messages,
  isStreaming,
  onSendMessage,
  onStopStreaming,
  onClearHistory,
  onJumpToSlide,
  onRevertVersion,
  onUploadClick,
  onDropFiles,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [isDragging, setIsDragging] = useState(false);
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
        {messages.length === 0 ? (
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
        ) : (
          messages.map((msg, idx) => {
            const isLastAssistant =
              msg.role === "assistant" && idx === messages.length - 1;
            const runningNow = isLastAssistant && isStreaming;

            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl bg-canvas border border-black/[0.08] px-3.5 py-2.5 text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="space-y-2.5">
                {msg.tool_steps && msg.tool_steps.length > 0 && (
                  <ToolStepsBar
                    steps={msg.tool_steps}
                    isRunning={runningNow}
                  />
                )}

                {msg.content ? (
                  <div
                    className={
                      msg.is_error
                        ? "p-3 rounded-xl bg-danger-bg border border-danger/20 text-[13px] text-danger leading-relaxed"
                        : "px-0.5"
                    }
                  >
                    {msg.is_error ? (
                      msg.content
                    ) : (
                      <FormattedMessageBody
                        content={msg.content}
                        totalSlides={totalSlides}
                        onJumpToSlide={onJumpToSlide}
                      />
                    )}
                  </div>
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

      {/* Bottom Composer */}
      <div className="p-3.5 border-t border-black/[0.08] bg-surface shrink-0 space-y-2">
        {/* Live Context Strip */}
        <div className="flex items-center justify-between gap-2 px-1 text-[13px]">
          <div className="flex items-center gap-2 min-w-0 text-ink-secondary truncate">
            <span className="truncate">
              {totalSlides > 0
                ? `当前焦点 第 ${selectedIndex + 1} 页 ${
                    LAYOUT_LABELS[currentLayout] || "正文"
                  }`
                : `${materialsCount} 份项目素材`}
            </span>
          </div>

          {messages.length > 0 && !isStreaming && (
            <button
              type="button"
              onClick={onClearHistory}
              title="清空本项目的历史对话"
              className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink transition-colors cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空</span>
            </button>
          )}
        </div>

        {/* Input Box */}
        <div className="rounded-2xl bg-canvas border border-black/[0.12] focus-within:bg-surface focus-within:border-ink focus-within:ring-4 focus-within:ring-black/[0.06] transition-[border-color,background-color,box-shadow] duration-200 px-3 pt-2.5 pb-2">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submitDraft();
              }
            }}
            placeholder={
              totalSlides > 0
                ? "告诉 Agent 要修改的内容、版式、主题或导出要求…"
                : "输入想法，或拖入文档/图片让 Agent 帮你从零搭 PPT…"
            }
            className="w-full bg-transparent text-[13.5px] text-ink placeholder:text-ink-muted outline-none resize-none leading-relaxed max-h-[160px]"
          />

          <div className="flex items-center justify-between gap-2 pt-1.5">
            <button
              type="button"
              onClick={onUploadClick}
              title="上传文档或图片到素材库"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13px] text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
            >
              <Paperclip className="w-3.5 h-3.5" />
              <span>添素材</span>
            </button>

            {isStreaming ? (
              <button
                type="button"
                onClick={onStopStreaming}
                title="停止生成"
                className="h-8 px-3 rounded-full ui-btn-outline text-[13px] inline-flex items-center gap-1.5"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!draft.trim()}
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
