"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import type { BrandKit, Outline, ThemeOption } from "../../lib/api";
import { useDismiss } from "../../lib/useDismiss";
import { inferEffectiveLayout } from "./layoutUtils";
import { SlideRenderer } from "./stage/StandardSlideView";

interface SlideNavigatorProps {
  pid: string;
  outline: Outline;
  selectedIndex: number;
  activeTheme: ThemeOption;
  brand?: BrandKit | null;
  issueSlideIndices: Set<number>;
  onSelectIndex: (idx: number) => void;
  onMoveItem: (idx: number, delta: number) => void;
  onReorderItem?: (fromIdx: number, toIdx: number) => void;
  onDuplicateItem?: (idx: number) => void;
  onDeleteItem: (idx: number) => void;
  onAddItem: () => void;
}

export function SlideNavigator({
  pid,
  outline,
  selectedIndex,
  activeTheme,
  brand = null,
  issueSlideIndices,
  onSelectIndex,
  onMoveItem,
  onReorderItem,
  onDuplicateItem,
  onDeleteItem,
  onAddItem,
}: SlideNavigatorProps) {
  const sw = activeTheme.swatches;
  const total = outline.items.length;
  const firstThumbRef = useRef<HTMLDivElement | null>(null);
  const [thumbScale, setThumbScale] = useState(0.18);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);

  // Right-click context menu state (rendered at aside level, outside transformed thumbs)
  const [ctxMenu, setCtxMenu] = useState<{
    idx: number;
    x: number;
    y: number;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  useDismiss(Boolean(ctxMenu), () => setCtxMenu(null), [ctxMenuRef]);

  useEffect(() => {
    const el = firstThumbRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setThumbScale(w / 960);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [total]);

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

  const openContextMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    const menuW = 164;
    const menuH = 168;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    setCtxMenu({ idx, x: Math.max(8, x), y: Math.max(8, y) });
  };

  return (
    <aside className="w-[180px] xl:w-[224px] shrink-0 bg-canvas border-r border-black/[0.08] flex flex-col min-h-0">
      <div className="flex-1 px-3 py-3.5 space-y-3 overflow-y-auto clean-scroll">
        {outline.items.map((item, idx) => {
          const active = idx === selectedIndex;
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
              onContextMenu={(e) => openContextMenu(e, idx)}
              title={
                total > 1
                  ? "点击切换页面，拖拽调整页序，或右键打开菜单"
                  : "右键打开菜单"
              }
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
                  ref={idx === 0 ? firstThumbRef : undefined}
                  className={`aspect-[16/9] w-full rounded-[5px] overflow-hidden relative transition-[box-shadow,transform,opacity] duration-[160ms] ease-out ${
                    active
                      ? "thumb-selected"
                      : "thumb-idle group-hover:brightness-[0.98]"
                  }`}
                  style={{ backgroundColor: bg }}
                >
                  {(hasError || needsEvidence) && (
                    <span
                      className={`absolute top-1.5 right-1.5 z-10 w-1.5 h-1.5 rounded-full ring-2 ring-white/80 ${
                        hasError ? "bg-danger" : "bg-warning-dot"
                      }`}
                      title={hasError ? "该页存在排版或校验问题" : "待补充出处"}
                    />
                  )}
                  <SlideRenderer
                    pid={pid}
                    item={item}
                    index={idx}
                    total={total}
                    theme={activeTheme}
                    brand={brand}
                    scale={thumbScale}
                  />
                </div>

                {/* Bottom-right translucent controls (avoids covering slide title at top) */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-0.5 apple-glass rounded-lg p-0.5 shadow-sm border border-black/10"
                >
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMoveItem(idx, -1)}
                    aria-label="上移"
                    title="上移"
                    className="w-[22px] h-[22px] flex items-center justify-center text-ink hover:bg-black/[0.07] rounded-md disabled:opacity-25 cursor-pointer transition-colors"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === total - 1}
                    onClick={() => onMoveItem(idx, 1)}
                    aria-label="下移"
                    title="下移"
                    className="w-[22px] h-[22px] flex items-center justify-center text-ink hover:bg-black/[0.07] rounded-md disabled:opacity-25 cursor-pointer transition-colors"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  {onDuplicateItem && (
                    <button
                      type="button"
                      onClick={() => onDuplicateItem(idx)}
                      aria-label="复制此页"
                      title="复制此页"
                      className="w-[22px] h-[22px] flex items-center justify-center text-ink-secondary hover:text-ink hover:bg-black/[0.07] rounded-md cursor-pointer transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {total > 1 && (
                    <>
                      <span className="w-px h-3.5 bg-black/15 mx-0.5" />
                      <button
                        type="button"
                        onClick={() => onDeleteItem(idx)}
                        aria-label="删除此页"
                        title="删除此页（可立即撤销）"
                        className="w-[22px] h-[22px] flex items-center justify-center text-ink-muted hover:text-danger hover:bg-danger-bg rounded-md cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
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

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          role="menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          className="fixed z-50 w-[160px] apple-glass dock-shadow rounded-xl p-1 space-y-0.5 anim-popover-down-left-in"
        >
          <button
            type="button"
            role="menuitem"
            disabled={ctxMenu.idx === 0}
            onClick={() => {
              onMoveItem(ctxMenu.idx, -1);
              setCtxMenu(null);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ink hover:bg-black/[0.06] disabled:opacity-35 disabled:pointer-events-none cursor-pointer text-left"
          >
            <ArrowUp className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
            <span>上移一页</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={ctxMenu.idx === total - 1}
            onClick={() => {
              onMoveItem(ctxMenu.idx, 1);
              setCtxMenu(null);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ink hover:bg-black/[0.06] disabled:opacity-35 disabled:pointer-events-none cursor-pointer text-left"
          >
            <ArrowDown className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
            <span>下移一页</span>
          </button>
          {onDuplicateItem && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDuplicateItem(ctxMenu.idx);
                setCtxMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ink hover:bg-black/[0.06] cursor-pointer text-left"
            >
              <Copy className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
              <span>复制此页</span>
            </button>
          )}
          {total > 1 && (
            <>
              <div className="my-1 border-t border-black/[0.08]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDeleteItem(ctxMenu.idx);
                  setCtxMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-danger hover:bg-danger-bg cursor-pointer text-left"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>删除此页</span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
