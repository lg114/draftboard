"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BarChart3,
  GitCommitHorizontal,
  Image as ImageIcon,
  Minus,
  Plus,
  Square,
  Type,
  Workflow,
} from "lucide-react";
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
import { inferEffectiveLayout, needsContrastHairline } from "./layoutUtils";
import { MultiSelectBar } from "./stage/MultiSelectBar";
import { SelectedElementBar } from "./stage/SelectedElementBar";
import {
  type AlignMode,
  type DistributeAxis,
  computeAlignPatches,
  computeDistributePatches,
} from "./stage/snapGuides";
import {
  type StandardEditableField,
  BrandOverlay,
  StandardSlideView,
} from "./stage/StandardSlideView";

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
  isAgentBusy?: boolean;
  onStopAgent?: () => void;
  onExitDiffPreview?: () => void;
  onRevertFromDiff?: () => void;
  onSelectIndex: (idx: number) => void;
  onFocusField: (fieldId: string) => void;
  onPatchStandardField?: (field: StandardEditableField, value: string) => void;
  onUpdateCustomElementText?: (elementId: string, nextText: string) => void;
  onUpdateCustomElement?: (
    elementId: string,
    patch: Partial<CanvasElement>
  ) => void;
  onBatchUpdateCustomElements?: (
    patches: Record<string, Partial<CanvasElement>>,
    coalesceKey?: string
  ) => void;
  onDeleteCustomElement?: (elementId: string) => void;
  onBatchDeleteCustomElements?: (elementIds: string[]) => void;
  onAddCustomElement?: (element: CanvasElement) => void;
  onDuplicateCustomElement?: (elementId: string) => string | null;
  onBatchDuplicateCustomElements?: (elementIds: string[]) => string[];
  onReorderCustomElement?: (elementId: string, dir: "front" | "back") => void;
  onSelectedCustomElementChange?: (elementId: string | null) => void;
}

const MIN_ZOOM = 50;
const MAX_ZOOM = 300;
const ZOOM_STEPS = [50, 75, 100, 125, 150, 175, 200, 250, 300];

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value)));
}

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
  isAgentBusy = false,
  onStopAgent,
  onExitDiffPreview,
  onRevertFromDiff,
  onSelectIndex,
  onFocusField,
  onPatchStandardField,
  onUpdateCustomElementText,
  onUpdateCustomElement,
  onBatchUpdateCustomElements,
  onDeleteCustomElement,
  onBatchDeleteCustomElements,
  onAddCustomElement,
  onDuplicateCustomElement,
  onBatchDuplicateCustomElements,
  onReorderCustomElement,
  onSelectedCustomElementChange,
}: SlideStageCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const slideFrameRef = useRef<HTMLDivElement | null>(null);
  const [fitWidth, setFitWidth] = useState(720);
  const [zoomPct, setZoomPct] = useState(100);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [selectedElIds, setSelectedElIds] = useState<string[]>([]);
  const [editingCustomTextId, setEditingCustomTextId] = useState<string | null>(
    null
  );
  const [forceLiveStandard, setForceLiveStandard] = useState(false);
  const [pendingStandardField, setPendingStandardField] =
    useState<StandardEditableField | null>(null);

  const pendingZoomAnchorRef = useRef<{
    u: number;
    v: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const panStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  } | null>(null);

  const addWrapRef = useRef<HTMLDivElement | null>(null);
  const { mounted: addPopoverMounted, exiting: addPopoverExiting } =
    usePresence(addPopoverOpen, 130);
  useDismiss(addPopoverOpen, () => setAddPopoverOpen(false), [addWrapRef]);

  useEffect(() => {
    setSelectedElIds([]);
    setEditingCustomTextId(null);
    setForceLiveStandard(false);
    setPendingStandardField(null);
    setAddPopoverOpen(false);
  }, [selectedIndex, version, isAgentBusy]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const availW = Math.max(280, el.offsetWidth - 64);
      const availH = Math.max(180, el.offsetHeight - 64);
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
  const renderedHeight = Math.floor((renderedWidth * 9) / 16);
  const scale = renderedWidth / 960;

  const applyZoomWithAnchor = useCallback(
    (
      updater: (prev: number) => number,
      clientPoint?: { x: number; y: number }
    ) => {
      const vp = viewportRef.current;
      const frame = slideFrameRef.current;
      if (vp && frame) {
        const vpRect = vp.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        if (frameRect.width > 0 && frameRect.height > 0) {
          const pointerX = clientPoint
            ? clientPoint.x - vpRect.left
            : vpRect.width / 2;
          const pointerY = clientPoint
            ? clientPoint.y - vpRect.top
            : vpRect.height / 2;
          const frameLeftInContent =
            frameRect.left - vpRect.left + vp.scrollLeft;
          const frameTopInContent =
            frameRect.top - vpRect.top + vp.scrollTop;
          pendingZoomAnchorRef.current = {
            u: (vp.scrollLeft + pointerX - frameLeftInContent) / frameRect.width,
            v: (vp.scrollTop + pointerY - frameTopInContent) / frameRect.height,
            pointerX,
            pointerY,
          };
        }
      }
      setZoomPct((prev) => {
        const next = clampZoom(updater(prev));
        if (next === prev) {
          pendingZoomAnchorRef.current = null;
        }
        return next;
      });
    },
    []
  );

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor) return;
    pendingZoomAnchorRef.current = null;
    const vp = viewportRef.current;
    const frame = slideFrameRef.current;
    if (!vp || !frame) return;
    const vpRect = vp.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const frameLeftInContent = frameRect.left - vpRect.left + vp.scrollLeft;
    const frameTopInContent = frameRect.top - vpRect.top + vp.scrollTop;
    vp.scrollLeft =
      frameLeftInContent + anchor.u * frameRect.width - anchor.pointerX;
    vp.scrollTop =
      frameTopInContent + anchor.v * frameRect.height - anchor.pointerY;
  }, [renderedWidth, renderedHeight]);

  // Ctrl/Cmd + mouse wheel (and trackpad pinch) zooms ONLY the slide canvas around the pointer
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const delta =
        Math.abs(e.deltaY) >= 40
          ? Math.sign(-e.deltaY) * 10
          : Math.round(-e.deltaY * 0.6) || Math.sign(-e.deltaY);
      applyZoomWithAnchor((prev) => prev + delta, {
        x: e.clientX,
        y: e.clientY,
      });
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [applyZoomWithAnchor]);

  const total = outline.items.length;
  const item = outline.items[selectedIndex];
  const isCustomCanvas = Boolean(
    item?.custom_elements && item.custom_elements.length > 0
  );
  const selectedEls: CanvasElement[] = isCustomCanvas
    ? (item?.custom_elements ?? []).filter((el) =>
        selectedElIds.includes(el.id)
      )
    : [];
  const selectedEl: CanvasElement | null =
    selectedEls.length === 1 ? selectedEls[0] : null;
  const imageAssets = materials.filter((m) => m.asset_type === "image");
  const layout = item
    ? inferEffectiveLayout(item.layout, selectedIndex, total)
    : "content";
  const sw = activeTheme.swatches;

  const hasRenderedPage = Boolean(
    preview?.pages && preview.pages[selectedIndex]
  );
  const isSyncedArtifact =
    !diffPreviewActive && exportInSync && hasRenderedPage;
  const showRenderedImage =
    isSyncedArtifact && !isCustomCanvas && !forceLiveStandard;

  const handleQuickAddElement = (
    kind: "text" | "card" | "line" | "image" | "timeline" | "process" | "stacked_bar"
  ) => {
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
    } else if (kind === "timeline") {
      nextEl = {
        id,
        kind: "diagram",
        x: 48,
        y: 148 + (count % 3) * 12,
        w: 864,
        h: 256,
        diagram_type: "timeline",
        diagram_steps: [
          { label: "Q1", title: "需求调研与立项", desc: "梳理核心业务场景与目标指标" },
          { label: "Q2", title: "核心能力上线", desc: "完成架构落地并启动种子客户试点" },
          { label: "Q3", title: "规模化推广", desc: "全量开放并持续优化转化效率" },
          { label: "Q4", title: "复盘与迭代", desc: "沉淀标准方法论并规划下一周期" },
        ],
      };
    } else if (kind === "process") {
      nextEl = {
        id,
        kind: "diagram",
        x: 48,
        y: 156 + (count % 3) * 12,
        w: 864,
        h: 236,
        diagram_type: "process",
        diagram_steps: [
          { label: "01", title: "输入素材", desc: "上传文档、数据与关键配图" },
          { label: "02", title: "结构编排", desc: "提炼论点并匹配高信息密度版式" },
          { label: "03", title: "精准微调", desc: "可视化调整图表、图示与配色" },
          { label: "04", title: "交付导出", desc: "生成原生可编辑 PPTX 与矢量 PDF" },
        ],
      };
    } else if (kind === "stacked_bar") {
      nextEl = {
        id,
        kind: "chart",
        x: 120 + jitter,
        y: 132 + jitter,
        w: 720,
        h: 320,
        chart_type: "stacked_bar",
        chart_title: "季度营收构成（示例）",
        chart_categories: ["Q1", "Q2", "Q3", "Q4"],
        chart_series: [
          { name: "订阅收入", values: [32, 41, 52, 66] },
          { name: "企业定制", values: [18, 22, 26, 31] },
          { name: "增值服务", values: [9, 13, 16, 21] },
        ],
        show_values: true,
        value_suffix: "万",
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
    setSelectedElIds([id]);
    if (kind === "text" && onUpdateCustomElementText) {
      setEditingCustomTextId(id);
    }
    setAddPopoverOpen(false);
  };

  useEffect(() => {
    onSelectedCustomElementChange?.(selectedEl ? selectedEl.id : null);
  }, [selectedEl, onSelectedCustomElementChange]);

  const handleAlignSelected = useCallback(
    (mode: AlignMode) => {
      if (!item?.custom_elements || selectedEls.length < 2) return;
      const patches = computeAlignPatches(
        item.custom_elements,
        selectedEls.map((e) => e.id),
        mode
      );
      if (Object.keys(patches).length === 0) return;
      if (onBatchUpdateCustomElements) {
        onBatchUpdateCustomElements(patches);
      } else if (onUpdateCustomElement) {
        for (const [elId, patch] of Object.entries(patches)) {
          onUpdateCustomElement(elId, patch);
        }
      }
    },
    [item, selectedEls, onBatchUpdateCustomElements, onUpdateCustomElement]
  );

  const handleDistributeSelected = useCallback(
    (axis: DistributeAxis) => {
      if (!item?.custom_elements || selectedEls.length < 3) return;
      const patches = computeDistributePatches(
        item.custom_elements,
        selectedEls.map((e) => e.id),
        axis
      );
      if (Object.keys(patches).length === 0) return;
      if (onBatchUpdateCustomElements) {
        onBatchUpdateCustomElements(patches);
      } else if (onUpdateCustomElement) {
        for (const [elId, patch] of Object.entries(patches)) {
          onUpdateCustomElement(elId, patch);
        }
      }
    },
    [item, selectedEls, onBatchUpdateCustomElements, onUpdateCustomElement]
  );

  const handleDuplicateSelected = useCallback(() => {
    if (selectedEls.length === 0) return;
    if (selectedEls.length === 1 && onDuplicateCustomElement) {
      const createdId = onDuplicateCustomElement(selectedEls[0].id);
      if (createdId) setSelectedElIds([createdId]);
      return;
    }
    if (onBatchDuplicateCustomElements) {
      const createdIds = onBatchDuplicateCustomElements(
        selectedEls.map((e) => e.id)
      );
      if (createdIds.length > 0) setSelectedElIds(createdIds);
    }
  }, [
    selectedEls,
    onDuplicateCustomElement,
    onBatchDuplicateCustomElements,
  ]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedEls.length === 0) return;
    if (selectedEls.length === 1 && onDeleteCustomElement) {
      onDeleteCustomElement(selectedEls[0].id);
      setSelectedElIds([]);
      setEditingCustomTextId(null);
      return;
    }
    if (onBatchDeleteCustomElements) {
      onBatchDeleteCustomElements(selectedEls.map((e) => e.id));
      setSelectedElIds([]);
      setEditingCustomTextId(null);
    }
  }, [selectedEls, onDeleteCustomElement, onBatchDeleteCustomElements]);

  useEffect(() => {
    if (!isCustomCanvas || diffPreviewActive || isAgentBusy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(
        target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT" ||
            target.isContentEditable)
      );
      if (inEditable) return;

      // Ctrl/Cmd + A selects all elements on the current free canvas
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        const allIds = (item?.custom_elements ?? []).map((el) => el.id);
        if (allIds.length > 0) {
          e.preventDefault();
          setSelectedElIds(allIds);
        }
        return;
      }

      if (selectedEls.length === 0) return;

      if (e.key === "Escape") {
        if (editingCustomTextId) {
          setEditingCustomTextId(null);
        } else {
          setSelectedElIds([]);
        }
        return;
      }

      // Enter on a single selected text element enters inline canvas editing
      if (
        e.key === "Enter" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        selectedEl &&
        selectedEl.kind === "text" &&
        onUpdateCustomElementText
      ) {
        e.preventDefault();
        setEditingCustomTextId(selectedEl.id);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        if (onDuplicateCustomElement || onBatchDuplicateCustomElements) {
          e.preventDefault();
          handleDuplicateSelected();
        }
        return;
      }

      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (onDeleteCustomElement || onBatchDeleteCustomElements) {
          e.preventDefault();
          handleDeleteSelected();
        }
        return;
      }

      if (
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown") &&
        (onUpdateCustomElement || onBatchUpdateCustomElements) &&
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

        let minDx = -Infinity;
        let maxDx = Infinity;
        let minDy = -Infinity;
        let maxDy = Infinity;
        for (const el of selectedEls) {
          if (el.kind === "line") {
            minDx = Math.max(minDx, Math.min(0, -el.w) - el.x);
            maxDx = Math.min(maxDx, Math.min(960, 960 - el.w) - el.x);
            minDy = Math.max(minDy, Math.min(0, -el.h) - el.y);
            maxDy = Math.min(maxDy, Math.min(540, 540 - el.h) - el.y);
          } else {
            minDx = Math.max(minDx, -el.x);
            maxDx = Math.min(maxDx, 960 - el.w - el.x);
            minDy = Math.max(minDy, -el.y);
            maxDy = Math.min(maxDy, 540 - el.h - el.y);
          }
        }
        const effDx = Math.round(Math.max(minDx, Math.min(maxDx, dx)));
        const effDy = Math.round(Math.max(minDy, Math.min(maxDy, dy)));
        if (effDx === 0 && effDy === 0) return;

        if (selectedEls.length === 1 && onUpdateCustomElement) {
          const el = selectedEls[0];
          onUpdateCustomElement(el.id, {
            x: el.x + effDx,
            y: el.y + effDy,
          });
        } else if (onBatchUpdateCustomElements) {
          const patches: Record<string, Partial<CanvasElement>> = {};
          for (const el of selectedEls) {
            patches[el.id] = { x: el.x + effDx, y: el.y + effDy };
          }
          const key = `nudge:${selectedIndex}:${selectedEls
            .map((e) => e.id)
            .sort()
            .join(",")}`;
          onBatchUpdateCustomElements(patches, key);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isCustomCanvas,
    item,
    selectedIndex,
    selectedEls,
    selectedEl,
    editingCustomTextId,
    diffPreviewActive,
    isAgentBusy,
    onDeleteCustomElement,
    onBatchDeleteCustomElements,
    onDuplicateCustomElement,
    onBatchDuplicateCustomElements,
    onUpdateCustomElement,
    onBatchUpdateCustomElements,
    onUpdateCustomElementText,
    handleDuplicateSelected,
    handleDeleteSelected,
  ]);

  const firstIssueSlide = Array.from(issueSlideIndices).sort(
    (a, b) => a - b
  )[0];
  const hasLayoutIssues =
    issues.length > 0 || Boolean(report && !report.success);

  const stepZoom = useCallback(
    (dir: -1 | 1) => {
      applyZoomWithAnchor((prev) => {
        if (dir > 0) {
          const next = ZOOM_STEPS.find((s) => s > prev);
          return next ?? MAX_ZOOM;
        }
        for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
          if (ZOOM_STEPS[i] < prev) return ZOOM_STEPS[i];
        }
        return MIN_ZOOM;
      });
    },
    [applyZoomWithAnchor]
  );

  // Keyboard zoom (Ctrl/Cmd + +/-/0) & Space-to-pan modifier
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(
        el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "SELECT" ||
            el.isContentEditable)
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isEditableTarget(e.target)) return;

      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (zoomPct > 100) {
          e.preventDefault();
        }
        if (!e.repeat) setSpacePressed(true);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          stepZoom(1);
        } else if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          stepZoom(-1);
        } else if (e.key === "0") {
          e.preventDefault();
          applyZoomWithAnchor(() => 100);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };

    const onBlur = () => {
      setSpacePressed(false);
      panStateRef.current = null;
      setIsPanning(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [zoomPct, stepZoom, applyZoomWithAnchor]);

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

        {/* AI Streaming Soft-Lock Banner */}
        {isAgentBusy && !diffPreviewActive && (
          <div className="px-4 py-2 bg-ui-info-bg flex flex-wrap items-center justify-between gap-2 text-[13px] shrink-0 anim-msg-in">
            <span className="inline-flex items-center gap-2 text-ui-text-secondary">
              <span className="w-2 h-2 rounded-full bg-ui-accent animate-pulse shrink-0" />
              <span>AI 助手正在处理，编辑已暂锁（仍可切页浏览与缩放）</span>
            </span>
            {onStopAgent && (
              <button
                type="button"
                onClick={onStopAgent}
                className="ui-btn-subtle px-2.5 py-1 text-[12.5px] inline-flex items-center gap-1.5 shrink-0"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>停止</span>
              </button>
            )}
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
            {isCustomCanvas &&
              !diffPreviewActive &&
              !isAgentBusy &&
              onAddCustomElement && (
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
                    <div className="my-1 h-px bg-ui-border-subtle" />
                    <button
                      type="button"
                      onClick={() => handleQuickAddElement("timeline")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
                    >
                      <GitCommitHorizontal className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>时间轴图示</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAddElement("process")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
                    >
                      <Workflow className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>流程步骤图</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAddElement("stacked_bar")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
                    >
                      <BarChart3 className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                      <span>堆叠柱状图</span>
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
                disabled={zoomPct <= MIN_ZOOM}
                aria-label="缩小画布"
                title="缩小画布 (Ctrl + 滚轮 / Ctrl + -)"
                className="p-1 rounded hover:bg-ui-control-hover text-ui-icon hover:text-ui-text disabled:opacity-30 cursor-pointer transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => applyZoomWithAnchor(() => 100)}
                title="点击重置为 100% 适配 (Ctrl + 0)"
                className="px-1.5 py-0.5 rounded hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text cursor-pointer transition-colors min-w-[44px] text-center"
              >
                {zoomPct}%
              </button>
              <button
                type="button"
                onClick={() => stepZoom(1)}
                disabled={zoomPct >= MAX_ZOOM}
                aria-label="放大画布"
                title="放大画布 (Ctrl + 滚轮 / Ctrl + +)"
                className="p-1 rounded hover:bg-ui-control-hover text-ui-icon hover:text-ui-text disabled:opacity-30 cursor-pointer transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* Pure 16:9 Slide Canvas Viewport (Ctrl/Cmd + wheel zoom, Space/Middle-click pan, m-auto overflow-safe centering) */}
        {(() => {
          const slideBg = isCustomCanvas
            ? item?.custom_bg || sw.bg
            : layout === "cover" || layout === "closing"
            ? sw.cover_bg
            : sw.bg;
          const canSpacePan = spacePressed && zoomPct > 100;
          return (
        <div
          ref={viewportRef}
          onClick={() => {
            if (!isPanning) {
              if (selectedElIds.length > 0) setSelectedElIds([]);
              if (editingCustomTextId) setEditingCustomTextId(null);
            }
          }}
          onPointerDown={(e) => {
            const vp = viewportRef.current;
            if (!vp) return;
            const wantsPan = e.button === 1 || (e.button === 0 && canSpacePan);
            if (!wantsPan) return;
            e.preventDefault();
            e.stopPropagation();
            panStateRef.current = {
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              startScrollLeft: vp.scrollLeft,
              startScrollTop: vp.scrollTop,
            };
            vp.setPointerCapture(e.pointerId);
            setIsPanning(true);
          }}
          onPointerMove={(e) => {
            const pan = panStateRef.current;
            const vp = viewportRef.current;
            if (!pan || !vp || pan.pointerId !== e.pointerId) return;
            vp.scrollLeft = pan.startScrollLeft - (e.clientX - pan.startX);
            vp.scrollTop = pan.startScrollTop - (e.clientY - pan.startY);
          }}
          onPointerUp={(e) => {
            const pan = panStateRef.current;
            const vp = viewportRef.current;
            if (!pan || pan.pointerId !== e.pointerId) return;
            panStateRef.current = null;
            setIsPanning(false);
            if (vp?.hasPointerCapture(e.pointerId)) {
              vp.releasePointerCapture(e.pointerId);
            }
          }}
          onPointerCancel={(e) => {
            const pan = panStateRef.current;
            const vp = viewportRef.current;
            if (!pan || pan.pointerId !== e.pointerId) return;
            panStateRef.current = null;
            setIsPanning(false);
            if (vp?.hasPointerCapture(e.pointerId)) {
              vp.releasePointerCapture(e.pointerId);
            }
          }}
          className={`flex-1 min-h-0 overflow-auto clean-scroll ${
            isPanning
              ? "cursor-grabbing select-none"
              : canSpacePan
              ? "cursor-grab select-none"
              : ""
          }`}
        >
          <div className="min-w-full min-h-full w-fit h-fit flex p-6 sm:p-8">
            <div
              ref={slideFrameRef}
              onClick={(e) => {
                if (canSpacePan || isPanning) return;
                e.stopPropagation();
              }}
              style={{
                width: renderedWidth,
                height: renderedHeight,
                backgroundColor: slideBg,
                outline: needsContrastHairline(slideBg, "#151516", 18)
                  ? "1px solid var(--ui-neutral-7)"
                  : undefined,
              }}
              className={`m-auto shrink-0 rounded-[2px] overflow-hidden relative ${
                canSpacePan || isPanning ? "pointer-events-none" : ""
              }`}
            >
            <div
              key={`stage-${selectedIndex}-${diffPreviewActive ? "diff" : "live"}`}
              className="absolute inset-0 anim-slide-settle"
            >
              {showRenderedImage && preview?.pages[selectedIndex] ? (
                <div
                  onDoubleClick={(e) => {
                    if (isAgentBusy || diffPreviewActive || !onPatchStandardField)
                      return;
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relX =
                      rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
                    const relY =
                      rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
                    let targetField: StandardEditableField = "summary";
                    if (layout === "cover") {
                      targetField = relY < 0.52 ? "title" : "summary";
                    } else if (layout === "closing") {
                      targetField = relY < 0.45 ? "title" : "summary";
                    } else if (relY < 0.22) {
                      targetField = "title";
                    } else if (layout === "two_column" && relX > 0.5) {
                      targetField = "column_right";
                    }
                    setPendingStandardField(targetField);
                    setForceLiveStandard(true);
                  }}
                  style={{ backgroundColor: slideBg }}
                  className={`absolute inset-0 flex items-center justify-center ${
                    isAgentBusy ? "cursor-default" : "cursor-text"
                  }`}
                  title={
                    isAgentBusy
                      ? "AI 助手处理中，暂锁编辑"
                      : "双击直接在画布内编辑文字（当前展示已导出的渲染图）"
                  }
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
                    interactive={!diffPreviewActive && !isAgentBusy}
                    selectedElementIds={
                      diffPreviewActive || isAgentBusy ? [] : selectedElIds
                    }
                    onSelectElements={setSelectedElIds}
                    editingTextId={
                      diffPreviewActive || isAgentBusy
                        ? null
                        : editingCustomTextId
                    }
                    onStartEditText={setEditingCustomTextId}
                    onUpdateElementText={
                      diffPreviewActive || isAgentBusy
                        ? undefined
                        : onUpdateCustomElementText
                    }
                    onUpdateElement={
                      diffPreviewActive || isAgentBusy
                        ? undefined
                        : onUpdateCustomElement
                    }
                    onBatchUpdateElements={
                      diffPreviewActive || isAgentBusy
                        ? undefined
                        : onBatchUpdateCustomElements
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
                  interactive={!diffPreviewActive && !isAgentBusy}
                  onFocusField={
                    diffPreviewActive || isAgentBusy ? undefined : onFocusField
                  }
                  onUpdateField={
                    diffPreviewActive || isAgentBusy
                      ? undefined
                      : onPatchStandardField
                  }
                  initialEditField={pendingStandardField}
                  onClearInitialEditField={() => setPendingStandardField(null)}
                />
              ) : null}
            </div>
            </div>
          </div>
        </div>
          );
        })()}

        {/* Contextual Floating Bar for single or multi-selected free-canvas elements */}
        {!isAgentBusy &&
          !diffPreviewActive &&
          selectedEl &&
          onUpdateCustomElement && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-24px)]">
              <SelectedElementBar
                selectedEl={selectedEl}
                sw={sw}
                imageAssets={imageAssets}
                onUpdate={onUpdateCustomElement}
                onFocusField={onFocusField}
                onInlineEditText={
                  onUpdateCustomElementText
                    ? (elId) => setEditingCustomTextId(elId)
                    : undefined
                }
                onReorder={onReorderCustomElement}
                onDuplicate={
                  onDuplicateCustomElement
                    ? (elId) => {
                        const createdId = onDuplicateCustomElement(elId);
                        if (createdId) setSelectedElIds([createdId]);
                      }
                    : undefined
                }
                onDelete={
                  onDeleteCustomElement
                    ? (elId) => {
                        onDeleteCustomElement(elId);
                        setSelectedElIds([]);
                        setEditingCustomTextId(null);
                      }
                    : undefined
                }
                onClose={() => {
                  setSelectedElIds([]);
                  setEditingCustomTextId(null);
                }}
              />
            </div>
          )}

        {!isAgentBusy &&
          !diffPreviewActive &&
          selectedEls.length > 1 &&
          (onBatchUpdateCustomElements || onUpdateCustomElement) && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-24px)]">
              <MultiSelectBar
                count={selectedEls.length}
                onAlign={handleAlignSelected}
                onDistribute={handleDistributeSelected}
                onDuplicate={
                  onBatchDuplicateCustomElements
                    ? handleDuplicateSelected
                    : undefined
                }
                onDelete={
                  onBatchDeleteCustomElements ? handleDeleteSelected : undefined
                }
                onClose={() => setSelectedElIds([])}
              />
            </div>
          )}
      </div>
    </main>
  );
}
