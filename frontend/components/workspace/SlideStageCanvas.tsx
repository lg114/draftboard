"use client";

import { useEffect, useRef, useState } from "react";
import type {
  BrandKit,
  CanvasElement,
  ExportReport,
  Issue,
  Material,
  Outline,
  OutlineLayout,
  Preview,
  Project,
  ThemeOption,
} from "../../lib/api";
import { CustomSlideLayer } from "./CustomSlideLayer";
import { inferEffectiveLayout } from "./layoutUtils";
import { SelectedElementBar } from "./stage/SelectedElementBar";
import { StageDock } from "./stage/StageDock";
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
  themes: ThemeOption[];
  activeTheme: ThemeOption;
  selectedThemeId: string;
  autoFit: boolean;
  exportInSync: boolean;
  statusText: string;
  isGenerating: boolean;
  materials?: Material[];
  brand?: BrandKit | null;
  diffPreviewActive?: boolean;
  onExitDiffPreview?: () => void;
  onRevertFromDiff?: () => void;
  onUpdateBrand?: (brand: BrandKit) => Promise<void>;
  onSelectIndex: (idx: number) => void;
  onSelectTheme: (themeId: string) => void;
  onSelectLayout: (layout: OutlineLayout) => void;
  onToggleAutoFit: () => void;
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

export function SlideStageCanvas({
  pid,
  project,
  outline,
  version,
  selectedIndex,
  preview,
  report,
  issues,
  issueSlideIndices,
  themes,
  activeTheme,
  selectedThemeId,
  autoFit,
  exportInSync,
  statusText,
  isGenerating,
  materials = [],
  brand = null,
  diffPreviewActive = false,
  onExitDiffPreview,
  onRevertFromDiff,
  onUpdateBrand,
  onSelectIndex,
  onSelectTheme,
  onSelectLayout,
  onToggleAutoFit,
  onFocusField,
  onUpdateCustomElement,
  onDeleteCustomElement,
  onAddCustomElement,
  onDuplicateCustomElement,
  onReorderCustomElement,
  onSelectedCustomElementChange,
}: SlideStageCanvasProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.75);
  const [compactDock, setCompactDock] = useState(false);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedElId(null);
    setAddPopoverOpen(false);
  }, [selectedIndex, version]);

  useEffect(() => {
    const update = () => {
      if (shellRef.current) {
        const w = shellRef.current.clientWidth;
        if (w > 0) setScale(w / 960);
      }
      if (colRef.current) {
        setCompactDock(colRef.current.clientWidth < 700);
      }
    };
    update();
    const obs = new ResizeObserver(update);
    if (shellRef.current) obs.observe(shellRef.current);
    if (colRef.current) obs.observe(colRef.current);
    return () => obs.disconnect();
  }, []);

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

  // Show rendered PPTX PNG only when frozen inputs match the exported artifact.
  // Keep freeform canvas slides interactive on the stage so elements remain draggable.
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

  return (
    <main className="flex-1 bg-stage flex flex-col items-center justify-center px-4 lg:px-6 py-4 min-w-0 min-h-0 overflow-y-auto clean-scroll">
      <div
        ref={colRef}
        className="w-full max-w-[min(1080px,max(420px,calc((100vh-172px)*16/9)))] flex flex-col items-center gap-3.5 my-auto"
      >
        {/* Before/After Visual Diff Banner */}
        {diffPreviewActive && (
          <div className="w-full px-3.5 py-2 rounded-xl bg-warning-bg border border-warning-dot/30 flex flex-wrap items-center justify-between gap-2 text-[13px] anim-msg-in">
            <span className="inline-flex items-center gap-2 text-warning font-medium">
              <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
              <span>正在对比查看「AI 修改前」版本（只读预览）</span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {onRevertFromDiff && (
                <button
                  type="button"
                  onClick={onRevertFromDiff}
                  className="px-2.5 py-1 rounded-full bg-surface border border-black/15 text-ink font-medium hover:bg-canvas cursor-pointer"
                >
                  恢复为此版本
                </button>
              )}
              {onExitDiffPreview && (
                <button
                  type="button"
                  onClick={onExitDiffPreview}
                  className="px-3 py-1 rounded-full bg-ink text-white font-medium hover:bg-ink-hover cursor-pointer"
                >
                  切回改后版本
                </button>
              )}
            </div>
          </div>
        )}

        {/* Quiet 1-line Status Above Stage */}
        <div className="w-full flex items-center justify-between px-0.5 text-[13px] gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {isGenerating ? (
              <span className="inline-flex items-center gap-2 text-ink font-medium truncate">
                <span className="w-2 h-2 rounded-full bg-ink animate-pulse shrink-0" />
                <span className="truncate">{statusText || "正在处理…"}</span>
              </span>
            ) : hasLayoutIssues ? (
              <button
                type="button"
                onClick={() => {
                  if (firstIssueSlide !== undefined) {
                    onSelectIndex(firstIssueSlide);
                  }
                }}
                className="inline-flex items-center gap-2 text-danger hover:underline font-medium cursor-pointer truncate"
              >
                <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
                <span className="truncate">
                  {firstIssueSlide !== undefined
                    ? `第 ${firstIssueSlide + 1} 页存在排版溢出或校验异常`
                    : "最近一次排版校验未通过"}
                </span>
                {firstIssueSlide !== undefined && (
                  <span className="shrink-0">点击定位 ›</span>
                )}
              </button>
            ) : isSyncedArtifact ? (
              <span className="inline-flex items-center gap-2 text-ink font-medium whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>已与 PPTX 同步</span>
              </span>
            ) : project?.download_available && !exportInSync ? (
              <span className="inline-flex items-center gap-2 text-warning font-medium truncate">
                <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
                <span className="truncate">
                  已下载的 PPTX 是更早的导出，与当前设置不一致
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-ink-secondary whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                <span>排版安全</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            {isCustomCanvas && !diffPreviewActive && (
              <span className="hidden lg:inline text-[13px] text-ink-muted">
                {selectedEl
                  ? "方向键微调 · Shift×10 · Ctrl+D 复制 · Delete 删除"
                  : "点击画布元素可直接拖拽微调 · 双击改文字"}
              </span>
            )}
            {isCustomCanvas && (
              <span className="px-2 py-0.5 rounded-full bg-black/[0.06] text-[13px] font-medium text-ink">
                自由画布
              </span>
            )}
            <span className="text-ink-secondary font-medium tabular-nums">
              {selectedIndex + 1} / {total}
            </span>
          </div>
        </div>

        {/* True 960x540 Proportional Scaled 16:9 Stage */}
        <div
          ref={shellRef}
          className="aspect-[16/9] w-full rounded-[3px] overflow-hidden slide-shadow relative bg-surface"
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
                className="absolute inset-0 bg-white flex items-center justify-center cursor-text"
                title="点击右侧编辑内容（当前展示已导出的 Office 渲染图）"
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

        {/* Floating Dock OR Selected Custom Element Bar */}
        <div className="relative max-w-full">
          {selectedEl && onUpdateCustomElement ? (
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
          ) : (
            <StageDock
              themes={themes}
              activeTheme={activeTheme}
              selectedThemeId={selectedThemeId}
              layout={layout}
              autoFit={autoFit}
              isCustomCanvas={isCustomCanvas}
              diffPreviewActive={diffPreviewActive}
              compactDock={compactDock}
              brand={brand}
              imageAssets={imageAssets}
              addPopoverOpen={addPopoverOpen}
              setAddPopoverOpen={setAddPopoverOpen}
              onSelectTheme={onSelectTheme}
              onSelectLayout={onSelectLayout}
              onToggleAutoFit={onToggleAutoFit}
              onUpdateBrand={onUpdateBrand}
              onQuickAddElement={
                onAddCustomElement ? handleQuickAddElement : undefined
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}
