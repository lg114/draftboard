"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Minus, Plus, Square, Type } from "lucide-react";
import type {
  BrandKit,
  CanvasElement,
  ExportReport,
  Issue,
  Material,
  Outline,
  Preview,
  Project,
  ThemeOption,
} from "../../lib/api";
import { useDismiss } from "../../lib/useDismiss";
import { usePresence } from "../../lib/usePresence";
import { CustomSlideLayer } from "./CustomSlideLayer";
import { inferEffectiveLayout } from "./layoutUtils";
import { SelectedElementBar } from "./stage/SelectedElementBar";
import { BrandOverlay, StandardSlideView } from "./stage/StandardSlideView";

interface SlideStageCanvasProps {
  pid: string;
  project: Project | null;
  outline: Outline;
  version: string;
  isStale: boolean;
  selectedIndex: number;
  preview: Preview | null;
  report: ExportReport | null;
  issues: Issue[];
  issueSlideIndices: Set<number>;
  activeTheme: ThemeOption;
  exportInSync: boolean;
  statusText: string;
  isGenerating: boolean;
  materials?: Material[];
  brand?: BrandKit | null;
  diffPreviewActive?: boolean;
  onExitDiffPreview?: () => void;
  onRevertFromDiff?: () => void;
  onSelectIndex: (idx: number) => void;
  onFocusField: (fieldId: string) => void;
  onUpdateCustomElement?: (
    elementId: string,
    patch: Partial<CanvasElement>
  ) => void;
  onDeleteCustomElement?: (elementId: string) => void;
  onAddCustomElement?: (element: CanvasElement) => void;
  onDuplicateCustomElement?: (elementId: string) => string | null;
  onReorderCustomElement?: (elementId: string, dir: "front" | "back") => void;
  onSelectedCustomElementChange?: (elementId: string | null) => void;
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 175];

export function SlideStageCanvas({
  pid,
  outline,
  version,
  selectedIndex,
  preview,
  report,
  issues,
  issueSlideIndices,
  activeTheme,
  exportInSync,
  statusText,
  isGenerating,
  materials = [],
  brand = null,
  diffPreviewActive = false,
  onExitDiffPreview,
  onRevertFromDiff,
  onSelectIndex,
  onFocusField,
  onUpdateCustomElement,
  onDeleteCustomElement,
  onAddCustomElement,
  onDuplicateCustomElement,
  onReorderCustomElement,
  onSelectedCustomElementChange,
}: SlideStageCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = useState(720);
  const [zoomPct, setZoomPct] = useState(100);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);

  const addWrapRef = useRef<HTMLDivElement | null>(null);
  const { mounted: addPopoverMounted, exiting: addPopoverExiting } =
    usePresence(addPopoverOpen, 130);
  useDismiss(addPopoverOpen, () => setAddPopoverOpen(false), [addWrapRef]);

  useEffect(() => {
    setSelectedElId(null);
    setAddPopoverOpen(false);
  }, [selectedIndex, version]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const availW = Math.max(280, el.clientWidth - 64);
      const availH = Math.max(180, el.clientHeight - 64);
      const byWidth = availW;
      const byHeight = (availH * 16) / 9;
      setFitWidth(Math.min(1080, byWidth, byHeight));
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const renderedWidth = Math.max(240, Math.round((fitWidth * zoomPct) / 100));
  const scale = renderedWidth / 960;

  const total = outline.items.length;
  const item = outline.items[selectedIndex];
  const isCustomCanvas = Boolean(
    item?.custom_elements && item.custom_elements.length > 0
  );
  const selectedEl: CanvasElement | null = isCustomCanvas
    ? item?.custom_elements?.find((el) => el.id === selectedElId) ?? null
    : null;
  const imageAssets = materials.filter((m) => m.asset_type === "image");
  const firstCustomTextId = isCustomCanvas
    ? item?.custom_elements?.find((el) => el.kind === "text")?.id
    : undefined;
  const layout = item
    ? inferEffectiveLayout(item.layout, selectedIndex, total)
    : "content";
  const sw = activeTheme.swatches;

  const hasRenderedPage = Boolean(
    preview?.pages && preview.pages[selectedIndex]
  );
  const isSyncedArtifact =
    !diffPreviewActive && exportInSync && hasRenderedPage;
  const showRenderedImage = isSyncedArtifact && !isCustomCanvas;

  const handleQuickAddElement = (kind: "text" | "card" | "line" | "image") => {
    if (!onAddCustomElement) return;
    const id = `el_${kind}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 5)}`;
    const count = item?.custom_elements?.length ?? 0;
    const jitter = (count % 5) * 14;
    let nextEl: CanvasElement;
    if (kind === "text") {
      nextEl = {
        id,
        kind: "text",
        x: 300 + jitter,
        y: 220 + jitter,
        w: 360,
        h: 72,
        text: "新文本框（双击编辑）",
        font_size: 20,
        color: "theme:body",
        align: "left",
      };
    } else if (kind === "card") {
      nextEl = {
        id,
        kind: "card",
        x: 320 + jitter,
        y: 180 + jitter,
        w: 300,
        h: 168,
        fill: "theme:surface",
        border_color: "theme:divider",
        border_width: 1,
        radius: 12,
      };
    } else if (kind === "line") {
      nextEl = {
        id,
        kind: "line",
        x: 280,
        y: 270 + jitter,
        w: 400,
        h: 0,
        color: "theme:divider",
        line_width: 2,
      };
    } else {
      const firstImg = imageAssets[0];
      if (!firstImg) return;
      nextEl = {
        id,
        kind: "image",
        x: 310 + jitter,
        y: 140 + jitter,
        w: 340,
        h: 240,
        image_asset_id: firstImg.asset_id,
        fit: "contain",
        radius: 8,
      };
    }
    onAddCustomElement(nextEl);
    setSelectedElId(id);
    setAddPopoverOpen(false);
  };

  useEffect(() => {
    onSelectedCustomElementChange?.(selectedEl ? selectedEl.id : null);
  }, [selectedEl, onSelectedCustomElementChange]);

  useEffect(() => {
    if (!selectedEl || diffPreviewActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        setSelectedElId(null);
        return;
      }
      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
      );
      if (inEditable) return;

      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "d" &&
        onDuplicateCustomElement
      ) {
        e.preventDefault();
        const createdId = onDuplicateCustomElement(selectedEl.id);
        if (createdId) setSelectedElId(createdId);
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        onDeleteCustomElement &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        onDeleteCustomElement(selectedEl.id);
        setSelectedElId(null);
        return;
      }

      if (
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown") &&
        onUpdateCustomElement &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy =
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        let nx: number;
        let ny: number;
        if (selectedEl.kind === "line") {
          const minX = Math.min(0, -selectedEl.w);
          const maxX = Math.min(960, 960 - selectedEl.w);
          const minY = Math.min(0, -selectedEl.h);
          const maxY = Math.min(540, 540 - selectedEl.h);
          nx = Math.round(Math.max(minX, Math.min(maxX, selectedEl.x + dx)));
          ny = Math.round(Math.max(minY, Math.min(maxY, selectedEl.y + dy)));
        } else {
          nx = Math.round(
            Math.max(0, Math.min(960 - selectedEl.w, selectedEl.x + dx))
          );
          ny = Math.round(
            Math.max(0, Math.min(540 - selectedEl.h, selectedEl.y + dy))
          );
        }
        if (nx !== selectedEl.x || ny !== selectedEl.y) {
          onUpdateCustomElement(selectedEl.id, { x: nx, y: ny });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedEl,
    diffPreviewActive,
    onDeleteCustomElement,
    onDuplicateCustomElement,
    onUpdateCustomElement,
  ]);

  const firstIssueSlide = Array.from(issueSlideIndices).sort(
    (a, b) => a - b
  )[0];
  const hasLayoutIssues =
    issues.length > 0 || Boolean(report && !report.success);

  const stepZoom = (dir: -1 | 1) => {
    const idx = ZOOM_STEPS.indexOf(zoomPct);
    if (idx === -1) {
      setZoomPct(100);
      return;
    }
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir))];
    setZoomPct(next);
  };

  return (
    <main className="flex-1 bg-ui-bg px-1 pb-3 pt-0.5 flex flex-col min-w-0 min-h-0 overflow-hidden">
      {/* Gently raised dark stage surface (--ui-surface, no outer frame border) */}
      <div className="flex-1 min-h-0 bg-ui-surface rounded-xl flex flex-col overflow-hidden relative">
        {/* Before/After Visual Diff Banner */}
        {diffPreviewActive && (
          <div className="px-4 py-2 bg-ui-warning-bg border-b border-ui-warning/25 flex flex-wrap items-center justify-between gap-2 text-[13px] shrink-0 anim-msg-in">
            <span className="inline-flex items-center gap-2 text-ui-warning font-medium">
              <span className="w-2 h-2 rounded-full bg-ui-warning shrink-0" />
              <span>正在对比查看「AI 修改前」版本（只读预览）</span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {onRevertFromDiff && (
                <button
                  type="button"
                  onClick={onRevertFromDiff}
                  className="ui-btn-subtle px-2.5 py-1 text-[12.5px]"
                >
                  恢复为此版本
                </button>
              )}
              {onExitDiffPreview && (
                <button
                  type="button"
                  onClick={onExitDiffPreview}
                  className="ui-btn-primary px-3 py-1 text-[12.5px]"
                >
                  切回改后版本
                </button>
              )}
            </div>
          </div>
        )}

        {/* Stage Top Meta Row: 第 N 页 · 标题  |  16:9  − 100% + */}
        <div className="h-10 px-4 flex items-center justify-between gap-4 text-[13px] shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-ui-text-secondary truncate">
              <span className="tabular-nums text-ui-text-muted">
                第 {selectedIndex + 1} 页
              </span>
              <span className="mx-1.5 text-ui-text-disabled">·</span>
              <span className="text-ui-text-secondary font-medium">
                {item?.title || "未命名页面"}
              </span>
            </span>

            {isGenerating ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-ui-info-bg text-ui-info text-[12px] font-medium truncate shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-ui-info animate-pulse" />
                <span className="truncate max-w-[180px]">
                  {statusText || "正在处理…"}
                </span>
              </span>
            ) : hasLayoutIssues ? (
              <button
                type="button"
                onClick={() => {
                  if (firstIssueSlide !== undefined) {
                    onSelectIndex(firstIssueSlide);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-ui-danger-bg text-ui-danger text-[12px] font-medium hover:underline cursor-pointer shrink-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-ui-danger" />
                <span>
                  {firstIssueSlide !== undefined
                    ? `第 ${firstIssueSlide + 1} 页排版异常`
                    : "排版校验未通过"}
                </span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3 shrink-0 text-ui-text-muted">
            {isCustomCanvas && !diffPreviewActive && onAddCustomElement && (
              <div ref={addWrapRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAddPopoverOpen((v) => !v)}
                  title="向自由画布添加元素"
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12.5px] transition-colors cursor-pointer ${
                    addPopoverOpen
                      ? "bg-ui-bg-selected text-ui-text"
                      : "text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover"
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">添加元素</span>
                </button>

                {addPopoverMounted && (
                  <div
                    className={`absolute right-0 top-full mt-2 w-44 ui-popover rounded-xl p-1.5 z-50 space-y-0.5 ${
                      addPopoverExiting
                        ? "anim-popover-down-out pointer-events-none"
                        : "anim-popover-down-in"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleQuickAddElement("text")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
                    >
                      <Type className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>文本框</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAddElement("card")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
                    >
                      <Square className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>卡片背景</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAddElement("line")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
                    >
                      <Minus className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>分割线</span>
                    </button>
                    <button
                      type="button"
                      disabled={imageAssets.length === 0}
                      onClick={() => handleQuickAddElement("image")}
                      title={
                        imageAssets.length === 0
                          ? "请先上传图片素材"
                          : "插入第一张已上传的图片"
                      }
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer text-left"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>
                        {imageAssets.length > 0
                          ? "图片元素"
                          : "图片（需先上传）"}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <span className="text-[12.5px] tabular-nums text-ui-text-disabled hidden sm:inline">
              16:9
            </span>

            <div className="flex items-center gap-1 text-[12.5px] tabular-nums">
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                disabled={zoomPct <= ZOOM_STEPS[0]}
                aria-label="缩小画布"
                title="缩小画布"
                className="p-1 rounded hover:bg-ui-control-hover text-ui-icon hover:text-ui-text disabled:opacity-30 cursor-pointer transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setZoomPct(100)}
                title="点击重置为适应画布 (100%)"
                className="px-1.5 py-0.5 rounded hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text cursor-pointer transition-colors min-w-[44px] text-center"
              >
                {zoomPct}%
              </button>
              <button
                type="button"
                onClick={() => stepZoom(1)}
                disabled={zoomPct >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                aria-label="放大画布"
                title="放大画布"
                className="p-1 rounded hover:bg-ui-control-hover text-ui-icon hover:text-ui-text disabled:opacity-30 cursor-pointer transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Pure 16:9 Slide Canvas Viewport */}
        {(() => {
          const slideBg = isCustomCanvas
            ? item?.custom_bg || sw.bg
            : layout === "cover" || layout === "closing"
            ? sw.cover_bg
            : sw.bg;
          return (
        <div
          ref={viewportRef}
          onClick={() => {
            if (selectedElId) setSelectedElId(null);
          }}
          className="flex-1 min-h-0 overflow-auto clean-scroll flex items-center justify-center p-6 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: renderedWidth,
              height: Math.floor((renderedWidth * 9) / 16),
              backgroundColor: slideBg,
            }}
            className="shrink-0 rounded-[2px] overflow-hidden relative"
          >
            <div
              key={`stage-${selectedIndex}-${diffPreviewActive ? "diff" : "live"}`}
              className="absolute inset-0 anim-slide-settle"
            >
              {showRenderedImage && preview?.pages[selectedIndex] ? (
                <div
                  onClick={() =>
                    onFocusField(
                      firstCustomTextId
                        ? `custom-el-${firstCustomTextId}`
                        : "input-title"
                    )
                  }
                  style={{ backgroundColor: slideBg }}
                  className="absolute inset-0 flex items-center justify-center cursor-text"
                  title="点击右侧属性编辑内容（当前展示已导出的渲染图）"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.pages[selectedIndex]}
                    alt={`第 ${selectedIndex + 1} 页`}
                    className="w-full h-full object-contain select-none"
                  />
                </div>
              ) : item && isCustomCanvas && item.custom_elements ? (
                <>
                  <CustomSlideLayer
                    pid={pid}
                    customBg={item.custom_bg}
                    elements={item.custom_elements}
                    theme={activeTheme}
                    scale={scale}
                    interactive={!diffPreviewActive}
                    selectedElementId={diffPreviewActive ? null : selectedElId}
                    onSelectElement={setSelectedElId}
                    onSelectTextElement={(elId) =>
                      onFocusField(`custom-el-${elId}`)
                    }
                    onUpdateElement={
                      diffPreviewActive ? undefined : onUpdateCustomElement
                    }
                  />
                  {brand && (
                    <BrandOverlay
                      pid={pid}
                      brand={brand}
                      mutedColor={sw.muted}
                      scale={scale}
                    />
                  )}
                </>
              ) : item ? (
                <StandardSlideView
                  pid={pid}
                  item={item}
                  layout={layout}
                  sw={sw}
                  scale={scale}
                  selectedIndex={selectedIndex}
                  total={total}
                  brand={brand}
                  onFocusField={onFocusField}
                />
              ) : null}
            </div>
          </div>
        </div>
          );
        })()}

        {/* Contextual Floating Bar ONLY when a free-canvas element is selected */}
        {selectedEl && onUpdateCustomElement && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-24px)]">
            <SelectedElementBar
              selectedEl={selectedEl}
              sw={sw}
              imageAssets={imageAssets}
              onUpdate={onUpdateCustomElement}
              onFocusField={onFocusField}
              onReorder={onReorderCustomElement}
              onDuplicate={
                onDuplicateCustomElement
                  ? (elId) => {
                      const createdId = onDuplicateCustomElement(elId);
                      if (createdId) setSelectedElId(createdId);
                    }
                  : undefined
              }
              onDelete={
                onDeleteCustomElement
                  ? (elId) => {
                      onDeleteCustomElement(elId);
                      setSelectedElId(null);
                    }
                  : undefined
              }
              onClose={() => setSelectedElId(null)}
            />
          </div>
        )}
      </div>
    </main>
  );
}
