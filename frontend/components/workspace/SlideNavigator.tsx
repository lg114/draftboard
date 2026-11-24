"use client";

import { useState } from "react";
import type { Outline, OutlineItem, ThemeOption } from "../../lib/api";
import { AutoScaledCustomSlide } from "./CustomSlideLayer";
import { inferEffectiveLayout, normalizeEscapedNewlines } from "./layoutUtils";

interface SlideNavigatorProps {
  pid: string;
  outline: Outline;
  selectedIndex: number;
  activeTheme: ThemeOption;
  issueSlideIndices: Set<number>;
  onSelectIndex: (idx: number) => void;
  onMoveItem: (idx: number, delta: number) => void;
  onReorderItem?: (fromIdx: number, toIdx: number) => void;
  onDeleteItem: (idx: number) => void;
  onAddItem: () => void;
}

function ThumbSkeleton({
  pid,
  item,
  index,
  total,
  theme,
}: {
  pid: string;
  item: OutlineItem;
  index: number;
  total: number;
  theme: ThemeOption;
}) {
  const layout = inferEffectiveLayout(item.layout, index, total);
  const sw = theme.swatches;
  const isHero = layout === "cover" || layout === "closing";
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;
  const cleanSummary = normalizeEscapedNewlines(item.summary || "");
  const cleanColRight = normalizeEscapedNewlines(item.column_right || "");

  if (layout === "cover") {
    return (
      <div className="flex-1 flex flex-col justify-between px-1 py-0.5 min-h-0">
        <div
          className="w-5 h-[2px] rounded-full mt-1"
          style={{ backgroundColor: sw.accent }}
        />
        <div className="space-y-0.5 my-auto">
          <div
            className="text-[9.5px] font-bold leading-tight line-clamp-2 tracking-tight"
            style={{ color: titleCol }}
          >
            {item.title || "未命名"}
          </div>
          {cleanSummary && (
            <div
              className="text-[6.5px] leading-snug line-clamp-1 opacity-80"
              style={{ color: bodyCol }}
            >
              {cleanSummary}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (layout === "closing") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-1.5 gap-1 min-h-0">
        <div
          className="w-5 h-[2px] rounded-full"
          style={{ backgroundColor: sw.accent }}
        />
        <div
          className="text-[9px] font-bold leading-tight line-clamp-2"
          style={{ color: titleCol }}
        >
          {item.title || "未命名"}
        </div>
        {cleanSummary && (
          <div
            className="text-[6.5px] leading-snug line-clamp-1 opacity-80"
            style={{ color: bodyCol }}
          >
            {cleanSummary}
          </div>
        )}
      </div>
    );
  }

  if (layout === "two_column") {
    return (
      <>
        <div
          className="text-[8px] font-bold truncate pb-1 border-b relative"
          style={{ color: titleCol, borderColor: sw.divider }}
        >
          {item.title || "未命名"}
        </div>
        <div className="grid grid-cols-2 gap-1.5 flex-1 pt-1 min-h-0 overflow-hidden">
          <div
            className="text-[6.5px] leading-snug line-clamp-4 pr-1 border-r whitespace-pre-wrap"
            style={{ color: bodyCol, borderColor: sw.divider }}
          >
            {cleanSummary}
          </div>
          <div
            className="text-[6.5px] leading-snug line-clamp-4 whitespace-pre-wrap"
            style={{ color: bodyCol }}
          >
            {cleanColRight || "右栏"}
          </div>
        </div>
      </>
    );
  }

  if (layout === "text_image") {
    return (
      <>
        <div
          className="text-[8px] font-bold truncate pb-1 border-b"
          style={{ color: titleCol, borderColor: sw.divider }}
        >
          {item.title || "未命名"}
        </div>
        <div className="grid grid-cols-12 gap-1.5 flex-1 pt-1 min-h-0 items-stretch overflow-hidden">
          <div
            className="col-span-6 text-[6.5px] leading-snug line-clamp-4 whitespace-pre-wrap"
            style={{ color: bodyCol }}
          >
            {cleanSummary}
          </div>
          <div
            className="col-span-6 h-full rounded-[4px] overflow-hidden flex items-center justify-center border"
            style={{ backgroundColor: sw.surface, borderColor: sw.divider }}
          >
            {item.image_asset_id ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/projects/${pid}/assets/${encodeURIComponent(
                  item.image_asset_id
                )}`}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-4 h-4 rounded-sm opacity-35"
                style={{ backgroundColor: sw.accent }}
              />
            )}
          </div>
        </div>
      </>
    );
  }

  if (layout === "bullets") {
    const bulletLines = cleanSummary
      .split("\n")
      .map((s) => s.replace(/^[-*•·]\s+/, "").trim())
      .filter(Boolean)
      .slice(0, 3);
    return (
      <>
        <div
          className="text-[8px] font-bold truncate pb-1 border-b"
          style={{ color: titleCol, borderColor: sw.divider }}
        >
          {item.title || "未命名"}
        </div>
        <ul className="pt-1 space-y-0.5 flex-1 overflow-hidden">
          {bulletLines.map((line, i) => (
            <li
              key={i}
              className="flex items-start gap-1 text-[6px] leading-tight"
              style={{ color: bodyCol }}
            >
              <span
                className="w-1 h-1 rounded-full mt-[2.5px] shrink-0"
                style={{ backgroundColor: sw.accent }}
              />
              <span className="truncate">{line}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <div
        className="text-[8px] font-bold truncate pb-1 border-b"
        style={{ color: titleCol, borderColor: sw.divider }}
      >
        {item.title || "未命名"}
      </div>
      <div
        className="text-[6.5px] leading-snug line-clamp-4 pt-1 flex-1 overflow-hidden whitespace-pre-wrap"
        style={{ color: bodyCol }}
      >
        {cleanSummary}
      </div>
    </>
  );
}

export function SlideNavigator({
  pid,
  outline,
  selectedIndex,
  activeTheme,
  issueSlideIndices,
  onSelectIndex,
  onMoveItem,
  onReorderItem,
  onDeleteItem,
  onAddItem,
}: SlideNavigatorProps) {
  const sw = activeTheme.swatches;
  const total = outline.items.length;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || !onReorderItem) {
      setDragIdx(null);
      setDropTarget(null);
      return;
    }
    const pos = dropTarget?.position ?? "before";
    let dest = pos === "after" ? targetIdx + 1 : targetIdx;
    if (dragIdx < dest) dest -= 1;
    dest = Math.max(0, Math.min(total - 1, dest));
    if (dest !== dragIdx) {
      onReorderItem(dragIdx, dest);
    }
    setDragIdx(null);
    setDropTarget(null);
  };

  return (
    <aside className="w-[180px] xl:w-[224px] shrink-0 bg-canvas border-r border-black/[0.08] flex flex-col min-h-0">
      <div className="flex-1 px-3 py-3.5 space-y-3 overflow-y-auto clean-scroll">
        {outline.items.map((item, idx) => {
          const active = idx === selectedIndex;
          const isCustomCanvas = Boolean(
            item.custom_elements && item.custom_elements.length > 0
          );
          const layout = inferEffectiveLayout(item.layout, idx, total);
          const isHero = layout === "cover" || layout === "closing";
          const bg = isHero ? sw.cover_bg : sw.bg;
          const hasError = issueSlideIndices.has(idx);
          const needsEvidence = item.evidence_status !== "supported";
          const isDragging = dragIdx === idx;
          const showBeforeLine =
            dragIdx !== null &&
            dragIdx !== idx &&
            dropTarget?.index === idx &&
            dropTarget.position === "before";
          const showAfterLine =
            dragIdx !== null &&
            dragIdx !== idx &&
            dropTarget?.index === idx &&
            dropTarget.position === "after";

          return (
            <div
              key={item.outline_item_id}
              draggable={total > 1 && Boolean(onReorderItem)}
              onDragStart={(e) => {
                setDragIdx(idx);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              onDragOver={(e) => {
                if (dragIdx === null || dragIdx === idx) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const pos =
                  e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                setDropTarget((prev) =>
                  prev?.index === idx && prev.position === pos
                    ? prev
                    : { index: idx, position: pos }
                );
              }}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={() => {
                setDragIdx(null);
                setDropTarget(null);
              }}
              onClick={() => onSelectIndex(idx)}
              title={total > 1 ? "点击切换页面，或拖拽调整页序" : undefined}
              className={`w-full flex items-start gap-2 group relative transition-opacity ${
                total > 1 && onReorderItem
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-pointer"
              } ${isDragging ? "opacity-40" : "opacity-100"}`}
            >
              {showBeforeLine && (
                <div className="absolute -top-2 left-5 right-0 h-[2px] rounded-full bg-ink pointer-events-none z-20" />
              )}
              {showAfterLine && (
                <div className="absolute -bottom-2 left-5 right-0 h-[2px] rounded-full bg-ink pointer-events-none z-20" />
              )}
              <span
                className={`w-4 text-right pt-0.5 text-[13px] tabular-nums shrink-0 ${
                  active
                    ? "text-ink font-semibold"
                    : "text-ink-muted font-medium"
                }`}
              >
                {idx + 1}
              </span>

              <div className="flex-1 min-w-0 relative">
                <div
                  className={`aspect-[16/9] w-full rounded-[5px] overflow-hidden ${
                    isCustomCanvas ? "" : "p-2 flex flex-col"
                  } relative transition-[box-shadow,transform,opacity] duration-[160ms] ease-out ${
                    active
                      ? "thumb-selected"
                      : "thumb-idle group-hover:brightness-[0.98]"
                  }`}
                  style={{ backgroundColor: bg }}
                >
                  {(hasError || needsEvidence) && (
                    <span
                      className={`absolute top-1.5 right-1.5 z-10 w-1.5 h-1.5 rounded-full ring-2 ring-white/80 group-hover:opacity-0 transition-opacity ${
                        hasError ? "bg-danger" : "bg-warning-dot"
                      }`}
                      title={hasError ? "该页存在排版或校验问题" : "待补充出处"}
                    />
                  )}
                  {isCustomCanvas && item.custom_elements ? (
                    <AutoScaledCustomSlide
                      pid={pid}
                      customBg={item.custom_bg}
                      elements={item.custom_elements}
                      theme={activeTheme}
                    />
                  ) : (
                    <ThumbSkeleton
                      pid={pid}
                      item={item}
                      index={idx}
                      total={total}
                      theme={activeTheme}
                    />
                  )}
                </div>

                {/* Hover-only translucent micro controls */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 apple-glass rounded-md px-1 py-0.5 shadow-sm border border-black/10"
                >
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMoveItem(idx, -1)}
                    title="上移"
                    className="px-1 py-0.5 text-ink hover:bg-black/[0.06] rounded disabled:opacity-25 cursor-pointer text-[10px] leading-none"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === total - 1}
                    onClick={() => onMoveItem(idx, 1)}
                    title="下移"
                    className="px-1 py-0.5 text-ink hover:bg-black/[0.06] rounded disabled:opacity-25 cursor-pointer text-[10px] leading-none"
                  >
                    ↓
                  </button>
                  {total > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteItem(idx)}
                      title="删除此页"
                      className="px-1 py-0.5 text-ink hover:text-danger hover:bg-black/[0.06] rounded cursor-pointer text-[10px] leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-black/[0.07]">
        <button
          type="button"
          onClick={onAddItem}
          className="w-full py-2 rounded-[10px] bg-surface hover:bg-black/[0.02] text-[13px] font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.08)] transition-all cursor-pointer whitespace-nowrap"
        >
          + 新建幻灯片
        </button>
      </div>
    </aside>
  );
}
