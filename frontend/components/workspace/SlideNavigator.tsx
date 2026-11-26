"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Copy,
  Keyboard,
  Palette,
  Plus,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import type { BrandKit, Outline, ThemeOption } from "../../lib/api";
import { useDismiss } from "../../lib/useDismiss";
import { inferEffectiveLayout, needsContrastHairline } from "./layoutUtils";
import { SlideRenderer } from "./stage/StandardSlideView";

interface SlideNavigatorProps {
  pid: string;
  outline: Outline;
  selectedIndex: number;
  activeTheme: ThemeOption;
  brand?: BrandKit | null;
  issueSlideIndices: Set<number>;
  materialsCount: number;
  leftTab: "pages" | "materials";
  onChangeLeftTab: (tab: "pages" | "materials") => void;
  materialsPanel?: ReactNode;
  llmConfigured?: boolean;
  activeModelLabel?: string;
  onSelectIndex: (idx: number) => void;
  onMoveItem: (idx: number, delta: number) => void;
  onReorderItem?: (fromIdx: number, toIdx: number) => void;
  onDuplicateItem?: (idx: number) => void;
  onDeleteItem: (idx: number) => void;
  onAddItem: () => void;
  onUploadClick?: () => void;
  onCollapseLeft: () => void;
  onOpenThemeModal: () => void;
  onOpenLLMSettings: () => void;
  onOpenPreflight: () => void;
  onOpenShortcuts: () => void;
}

export function SlideNavigator({
  pid,
  outline,
  selectedIndex,
  activeTheme,
  brand = null,
  issueSlideIndices,
  materialsCount,
  leftTab,
  onChangeLeftTab,
  materialsPanel,
  llmConfigured = true,
  activeModelLabel = "",
  onSelectIndex,
  onMoveItem,
  onReorderItem,
  onDuplicateItem,
  onDeleteItem,
  onAddItem,
  onUploadClick,
  onCollapseLeft,
  onOpenThemeModal,
  onOpenLLMSettings,
  onOpenPreflight,
  onOpenShortcuts,
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

  const [ctxMenu, setCtxMenu] = useState<{
    idx: number;
    x: number;
    y: number;
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  useDismiss(Boolean(ctxMenu), () => setCtxMenu(null), [ctxMenuRef]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(settingsOpen, () => setSettingsOpen(false), [settingsWrapRef]);

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
  }, [total, leftTab]);

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
    <aside className="w-[216px] xl:w-[244px] shrink-0 bg-ui-bg flex flex-col min-h-0 select-none">
      {/* Top Rail Header: 页面 / 材料 tabs + add + collapse (<) */}
      <div className="h-10 px-3.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3.5 text-[13px]">
          <button
            type="button"
            onClick={() => onChangeLeftTab("pages")}
            className={`cursor-pointer transition-colors ${
              leftTab === "pages"
                ? "text-ui-text font-medium"
                : "text-ui-text-muted hover:text-ui-text-secondary"
            }`}
          >
            页面
          </button>
          <button
            type="button"
            onClick={() => onChangeLeftTab("materials")}
            className={`cursor-pointer transition-colors inline-flex items-center gap-1 ${
              leftTab === "materials"
                ? "text-ui-text font-medium"
                : "text-ui-text-muted hover:text-ui-text-secondary"
            }`}
          >
            <span>材料</span>
            {materialsCount > 0 && (
              <span className="text-[12px] text-ui-text-muted tabular-nums">
                {materialsCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          {leftTab === "pages" ? (
            <button
              type="button"
              onClick={onAddItem}
              aria-label="新建幻灯片"
              title="新建幻灯片"
              className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : (
            onUploadClick && (
              <button
                type="button"
                onClick={onUploadClick}
                aria-label="上传材料"
                title="上传材料文件"
                className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )
          )}
          <button
            type="button"
            onClick={onCollapseLeft}
            aria-label="收起左侧边栏"
            title="收起左侧边栏"
            className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Content: Pages OR Materials */}
      {leftTab === "materials" && materialsPanel ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {materialsPanel}
        </div>
      ) : (
        <div className="flex-1 px-3 py-2 space-y-4 overflow-y-auto clean-scroll">
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
                className={`w-full group relative space-y-1.5 transition-opacity ${
                  total > 1 && onReorderItem
                    ? "cursor-grab active:cursor-grabbing"
                    : "cursor-pointer"
                } ${isDragging ? "opacity-40" : "opacity-100"}`}
              >
                {showBeforeLine && (
                  <div className="absolute -top-2 left-0 right-0 h-[2px] rounded-full bg-ui-accent pointer-events-none z-20" />
                )}
                {showAfterLine && (
                  <div className="absolute -bottom-2 left-0 right-0 h-[2px] rounded-full bg-ui-accent pointer-events-none z-20" />
                )}

                <div className="relative">
                  <div
                    ref={idx === 0 ? firstThumbRef : undefined}
                    className={`aspect-[16/9] w-full rounded-[4px] overflow-hidden relative transition-[box-shadow,opacity] duration-[150ms] ease-out ${
                      active
                        ? "thumb-selected"
                        : "thumb-idle opacity-90 group-hover:opacity-100"
                    }`}
                    style={{
                      backgroundColor: bg,
                      outline:
                        !active && needsContrastHairline(bg, "#0D0D0E", 24)
                          ? "1px solid var(--ui-border-subtle)"
                          : undefined,
                    }}
                  >
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

                  {/* Bottom-right translucent dark micro controls */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-0.5 bg-ui-bg/90 backdrop-blur-sm rounded-md p-0.5 border border-ui-border-subtle shadow-md"
                  >
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMoveItem(idx, -1)}
                      aria-label="上移"
                      title="上移"
                      className="w-[22px] h-[22px] flex items-center justify-center text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover rounded disabled:opacity-25 cursor-pointer transition-colors"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === total - 1}
                      onClick={() => onMoveItem(idx, 1)}
                      aria-label="下移"
                      title="下移"
                      className="w-[22px] h-[22px] flex items-center justify-center text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover rounded disabled:opacity-25 cursor-pointer transition-colors"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {onDuplicateItem && (
                      <button
                        type="button"
                        onClick={() => onDuplicateItem(idx)}
                        aria-label="复制此页"
                        title="复制此页"
                        className="w-[22px] h-[22px] flex items-center justify-center text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover rounded cursor-pointer transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {total > 1 && (
                      <>
                        <span className="w-px h-3.5 bg-ui-border-subtle mx-0.5" />
                        <button
                          type="button"
                          onClick={() => onDeleteItem(idx)}
                          aria-label="删除此页"
                          title="删除此页（可立即撤销）"
                          className="w-[22px] h-[22px] flex items-center justify-center text-ui-icon hover:text-ui-danger hover:bg-ui-danger-bg rounded cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Page number & title below thumbnail (matching mockup) */}
                <div className="flex items-center justify-between gap-1.5 px-0.5 text-[12.5px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {active && (
                      <span className="w-1.5 h-1.5 rounded-full bg-ui-text shrink-0" />
                    )}
                    <span
                      className={`tabular-nums shrink-0 ${
                        active
                          ? "text-ui-text font-medium"
                          : "text-ui-text-muted"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className={`truncate ${
                        active
                          ? "text-ui-text font-medium"
                          : "text-ui-text-muted group-hover:text-ui-text-secondary"
                      }`}
                    >
                      {item.title || "未命名页面"}
                    </span>
                  </div>
                  {(hasError || needsEvidence) && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        hasError ? "bg-ui-danger" : "bg-ui-warning"
                      }`}
                      title={hasError ? "该页存在排版或校验问题" : "待补充出处"}
                    />
                  )}
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={onAddItem}
            className="w-full py-2 rounded-lg text-[13px] text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建页面</span>
          </button>
        </div>
      )}

      {/* Bottom Footer: 项目设置 (matching mockup, seamless on --ui-bg) */}
      <div
        ref={settingsWrapRef}
        className="px-3 py-3 shrink-0 relative"
      >
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          aria-haspopup="menu"
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[13px] text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover transition-colors cursor-pointer"
        >
          <span className="inline-flex items-center gap-2 min-w-0">
            <Settings className="w-3.5 h-3.5 text-ui-icon shrink-0" />
            <span className="truncate">项目设置</span>
          </span>
          {!llmConfigured && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0"
              title="尚未配置大模型"
            />
          )}
        </button>

        {settingsOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-3 right-3 mb-2 z-50 ui-popover rounded-xl p-1.5 space-y-0.5 anim-popover-up-in"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onOpenThemeModal();
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <Palette className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span className="truncate">主题与品牌</span>
              </span>
              <span className="text-[12px] text-ui-text-muted truncate max-w-[80px]">
                {activeTheme.name}
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onOpenLLMSettings();
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <SlidersHorizontal className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span className="truncate">模型设置</span>
              </span>
              {!llmConfigured ? (
                <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
              ) : activeModelLabel ? (
                <span className="text-[12px] text-ui-text-muted font-mono truncate max-w-[82px]">
                  {activeModelLabel.split("·").pop()?.trim()}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onOpenPreflight();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              <span>交付体检</span>
            </button>

            <div className="my-1 border-t border-ui-border-subtle" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setSettingsOpen(false);
                onOpenShortcuts();
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
            >
              <span className="inline-flex items-center gap-2">
                <Keyboard className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span>快捷键速查</span>
              </span>
              <kbd className="px-1.5 py-0.5 rounded bg-ui-surface-input border border-ui-border-subtle text-[11px] font-mono text-ui-text-muted">
                ?
              </kbd>
            </button>
          </div>
        )}
      </div>

      {/* Right-click context menu for slide thumbnails */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          role="menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          className="fixed z-50 w-[160px] ui-popover rounded-xl p-1 space-y-0.5 anim-popover-down-left-in"
        >
          <button
            type="button"
            role="menuitem"
            disabled={ctxMenu.idx === 0}
            onClick={() => {
              onMoveItem(ctxMenu.idx, -1);
              setCtxMenu(null);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover disabled:opacity-35 disabled:pointer-events-none cursor-pointer text-left"
          >
            <ArrowUp className="w-3.5 h-3.5 text-ui-icon shrink-0" />
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
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover disabled:opacity-35 disabled:pointer-events-none cursor-pointer text-left"
          >
            <ArrowDown className="w-3.5 h-3.5 text-ui-icon shrink-0" />
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
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover cursor-pointer text-left"
            >
              <Copy className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              <span>复制此页</span>
            </button>
          )}
          {total > 1 && (
            <>
              <div className="my-1 border-t border-ui-border-subtle" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDeleteItem(ctxMenu.idx);
                  setCtxMenu(null);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-danger hover:bg-ui-danger-bg cursor-pointer text-left"
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
