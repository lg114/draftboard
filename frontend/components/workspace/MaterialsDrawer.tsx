"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardPaste,
  FileText,
  Image as ImageIcon,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Material,
  Outline,
  OutlineItem,
  SourceFragment,
} from "../../lib/api";
import { extractFragmentText } from "./SlideInspector";
import {
  formatFragmentLocation,
  getExcerptTargetLabel,
  inferEffectiveLayout,
} from "./layoutUtils";

type MaterialFilter = "all" | "doc" | "image";
type DrawerView =
  | { kind: "list" }
  | { kind: "detail"; assetId: string }
  | { kind: "paste" }
  | { kind: "regen" };

interface MaterialsDrawerProps {
  pid: string;
  materials: Material[];
  sourceFragments: SourceFragment[];
  outline?: Outline | null;
  currentSlide?: OutlineItem;
  currentSlideIndex: number;
  isGenerating: boolean;
  onUploadClick: () => void;
  onDropFiles?: (files: FileList) => void;
  onPasteNote: (title: string, content: string) => Promise<void>;
  onDeleteMaterial: (assetId: string) => Promise<void>;
  onToggleSourceId?: (sourceId: string) => void;
  onInsertExcerptToSlide?: (sourceId: string, text: string) => void;
  onApplyImageToSlide?: (imageAssetId: string, sourceId?: string) => void;
  onGenerateOutline: (prompt?: string) => void;
  onClose: () => void;
}

export function MaterialsDrawer({
  pid,
  materials,
  sourceFragments,
  outline,
  currentSlide,
  currentSlideIndex,
  isGenerating,
  onUploadClick,
  onDropFiles,
  onPasteNote,
  onDeleteMaterial,
  onToggleSourceId,
  onInsertExcerptToSlide,
  onApplyImageToSlide,
  onGenerateOutline,
  onClose,
}: MaterialsDrawerProps) {
  const [view, setView] = useState<DrawerView>({ kind: "list" });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<MaterialFilter>("all");
  const [isDragging, setIsDragging] = useState(false);

  const [regenPrompt, setRegenPrompt] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<string | null>(
    null
  );
  const [deletingAsset, setDeletingAsset] = useState(false);

  // Esc goes back to list from sub-views, or closes drawer from list view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (view.kind !== "list") {
        setConfirmDeleteAsset(null);
        setView({ kind: "list" });
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view.kind, onClose]);

  const fragmentsByAsset = useMemo(() => {
    const map = new Map<string, SourceFragment[]>();
    for (const f of sourceFragments) {
      const list = map.get(f.asset_id) || [];
      list.push(f);
      map.set(f.asset_id, list);
    }
    return map;
  }, [sourceFragments]);

  // Map each asset_id to 1-based slide numbers referencing it
  const slideRefsByAsset = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!outline?.items.length) return map;
    for (const m of materials) {
      const frags = fragmentsByAsset.get(m.asset_id) || [];
      const fragIds = new Set(frags.map((f) => f.source_id));
      const pages: number[] = [];
      outline.items.forEach((it, idx) => {
        if (
          it.image_asset_id === m.asset_id ||
          it.source_ids.some((sid) => fragIds.has(sid))
        ) {
          pages.push(idx + 1);
        }
      });
      map.set(m.asset_id, pages);
    }
    return map;
  }, [materials, fragmentsByAsset, outline]);

  const docCount = useMemo(
    () => materials.filter((m) => m.asset_type !== "image").length,
    [materials]
  );
  const imgCount = useMemo(
    () => materials.filter((m) => m.asset_type === "image").length,
    [materials]
  );

  const showSearchAndFilter =
    materials.length >= 4 || (docCount > 0 && imgCount > 0 && materials.length >= 2);

  const filteredMaterials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return materials.filter((m) => {
      if (filterType === "doc" && m.asset_type === "image") return false;
      if (filterType === "image" && m.asset_type !== "image") return false;
      if (!q) return true;
      if (m.asset_id.toLowerCase().includes(q)) return true;
      if (m.content && m.content.toLowerCase().includes(q)) return true;
      const frags = fragmentsByAsset.get(m.asset_id) || [];
      return frags.some((f) =>
        (f.content_preview || "").toLowerCase().includes(q)
      );
    });
  }, [materials, filterType, searchQuery, fragmentsByAsset]);

  const activeMaterial =
    view.kind === "detail"
      ? materials.find((m) => m.asset_id === view.assetId) || null
      : null;

  useEffect(() => {
    if (view.kind === "detail" && !activeMaterial) {
      setView({ kind: "list" });
    }
  }, [view.kind, activeMaterial]);

  const activeFragments = activeMaterial
    ? fragmentsByAsset.get(activeMaterial.asset_id) || []
    : [];
  const affectedSlides = activeMaterial
    ? slideRefsByAsset.get(activeMaterial.asset_id) || []
    : [];

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      await onPasteNote(noteTitle.trim(), noteContent);
      setNoteTitle("");
      setNoteContent("");
      setView({ kind: "list" });
    } finally {
      setSavingNote(false);
    }
  }

  async function handleConfirmDelete(assetId: string) {
    setDeletingAsset(true);
    try {
      await onDeleteMaterial(assetId);
      setConfirmDeleteAsset(null);
      setView({ kind: "list" });
    } finally {
      setDeletingAsset(false);
    }
  }

  const currentLayout = currentSlide
    ? inferEffectiveLayout(
        currentSlide.layout,
        currentSlideIndex,
        outline?.items.length || 1
      )
    : "content";

  return (
    <aside
      aria-label="项目素材库"
      onDragOver={(e) => {
        if (!onDropFiles) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={(e) => {
        if (!onDropFiles) return;
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
      className="fixed top-[52px] right-0 bottom-0 z-30 w-full sm:w-[460px] xl:w-[496px] bg-surface border-l border-black/[0.08] shadow-[-12px_0_36px_rgba(0,0,0,0.08)] flex flex-col"
    >
      {/* Drag-Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-3 z-40 rounded-2xl border-2 border-dashed border-ink bg-surface/95 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-6 h-6 text-ink" />
          <span className="text-[14px] font-semibold text-ink">
            松开鼠标即可导入到素材库
          </span>
        </div>
      )}

      {/* Drawer Sticky Header */}
      <div className="px-5 py-3.5 border-b border-black/[0.07] flex items-center justify-between gap-3 shrink-0 bg-surface">
        {view.kind === "list" ? (
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h2 className="text-[15px] font-semibold text-ink tracking-[-0.015em]">
              素材库
            </h2>
            <span className="text-[13px] text-ink-secondary tabular-nums">
              {materials.length} 份素材
              {sourceFragments.length > 0 && `  ${sourceFragments.length} 处切片`}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirmDeleteAsset(null);
              setView({ kind: "list" });
            }}
            className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-secondary hover:text-ink transition-colors cursor-pointer min-w-0"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {view.kind === "paste"
                ? "粘贴文本笔记"
                : view.kind === "regen"
                ? "重新提炼大纲"
                : "返回素材列表"}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          title="关闭素材库 (Esc)"
          aria-label="关闭素材库"
          className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── VIEW 1: Vertical Materials List ─────────────────────────────────── */}
      {view.kind === "list" && (
        <>
          {/* Quick Actions + Optional Search & Filter */}
          <div className="px-5 py-3.5 border-b border-black/[0.06] space-y-3 shrink-0 bg-surface-subtle/60">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onUploadClick}
                className="h-9 px-3 rounded-xl ui-btn-outline text-[13px] inline-flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>上传文件 / 图片</span>
              </button>
              <button
                type="button"
                onClick={() => setView({ kind: "paste" })}
                className="h-9 px-3 rounded-xl bg-surface hover:bg-canvas border border-black/[0.1] hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <ClipboardPaste className="w-3.5 h-3.5 shrink-0" />
                <span>粘贴文本笔记</span>
              </button>
            </div>

            {showSearchAndFilter && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索文件名或素材内容…"
                    className="w-full h-9 pl-8.5 pr-8 text-[13px] ui-field"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="清空搜索"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {docCount > 0 && imgCount > 0 && (
                  <div className="inline-flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5">
                    {(
                      [
                        { id: "all", label: `全部 ${materials.length}` },
                        { id: "doc", label: `文档 ${docCount}` },
                        { id: "image", label: `图片 ${imgCount}` },
                      ] as const
                    ).map((tab) => {
                      const active = filterType === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setFilterType(tab.id)}
                          className={`px-3 py-1 rounded-[9px] text-[13px] transition-all cursor-pointer tabular-nums ${
                            active
                              ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                              : "text-ink-secondary hover:text-ink font-medium"
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scrollable Vertical List */}
          <div className="flex-1 min-h-0 overflow-y-auto clean-scroll px-5 py-4 space-y-2">
            {materials.length === 0 ? (
              <div className="py-12 px-4 rounded-2xl border border-dashed border-border-dashed text-center space-y-2">
                <p className="text-[14px] font-medium text-ink">
                  项目暂无素材
                </p>
                <p className="text-[13px] text-ink-secondary leading-relaxed">
                  点击上方按钮上传 PDF、Word、Markdown、图片，或直接拖拽文件到此抽屉。
                </p>
              </div>
            ) : filteredMaterials.length === 0 ? (
              <div className="py-10 text-center space-y-2.5">
                <p className="text-[13.5px] text-ink-secondary">
                  没有找到匹配的素材
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setFilterType("all");
                  }}
                  className="text-[13px] font-medium text-ink underline underline-offset-2 hover:opacity-70 cursor-pointer"
                >
                  清除筛选条件
                </button>
              </div>
            ) : (
              filteredMaterials.map((m, i) => {
                const isImg = m.asset_type === "image";
                const frags = fragmentsByAsset.get(m.asset_id) || [];
                const refs = slideRefsByAsset.get(m.asset_id) || [];
                return (
                  <button
                    key={`${m.asset_id}-${m.asset_type}-${i}`}
                    type="button"
                    onClick={() => {
                      setConfirmDeleteAsset(null);
                      setView({ kind: "detail", assetId: m.asset_id });
                    }}
                    className="w-full text-left p-3 rounded-xl bg-surface-subtle hover:bg-canvas border border-black/[0.07] hover:border-black/[0.16] transition-colors flex items-center gap-3 group cursor-pointer"
                  >
                    {isImg ? (
                      <div className="w-12 h-8 rounded-[4px] bg-surface border border-black/[0.08] overflow-hidden flex items-center justify-center shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/projects/${pid}/assets/${encodeURIComponent(
                            m.asset_id
                          )}`}
                          alt={m.asset_id}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-surface border border-black/[0.08] flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-ink-secondary" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div
                        className="text-[13.5px] font-semibold text-ink truncate"
                        title={m.asset_id}
                      >
                        {m.asset_id}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]">
                        <span className="text-ink-muted">
                          {isImg ? "图片素材" : `${frags.length} 处切片`}
                        </span>
                        {refs.length > 0 ? (
                          <span className="text-ink-secondary">
                            已用于第{" "}
                            {refs.length <= 4
                              ? refs.join("、")
                              : `${refs.slice(0, 3).join("、")} 等 ${refs.length} `}
                            页
                          </span>
                        ) : (
                          <span className="text-ink-muted">尚未引用</span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-ink transition-colors shrink-0" />
                  </button>
                );
              })
            )}
          </div>

          {/* Sticky Drawer Footer */}
          <div className="px-5 py-3 border-t border-black/[0.07] bg-surface-subtle flex items-center justify-between gap-3 shrink-0">
            <span className="text-[13px] text-ink-secondary truncate">
              {currentSlide
                ? `当前选中 第 ${currentSlideIndex + 1} 页`
                : "支持拖拽文件直接导入"}
            </span>
            {materials.length > 0 && (
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => setView({ kind: "regen" })}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink hover:opacity-70 transition-opacity cursor-pointer disabled:opacity-40 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isGenerating ? "提炼中…" : "重新提炼大纲"}</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* ── VIEW 2: Material Detail & Fragments ─────────────────────────────── */}
      {view.kind === "detail" && activeMaterial && (
        <>
          <div className="px-5 py-3.5 border-b border-black/[0.06] bg-surface-subtle/60 space-y-2.5 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                {activeMaterial.asset_type === "image" ? (
                  <ImageIcon className="w-4 h-4 text-ink-secondary shrink-0 mt-0.5" />
                ) : (
                  <FileText className="w-4 h-4 text-ink-secondary shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <div
                    className="text-[14px] font-semibold text-ink break-all"
                    title={activeMaterial.asset_id}
                  >
                    {activeMaterial.asset_id}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-muted mt-0.5">
                    <span>
                      {activeMaterial.asset_type === "image"
                        ? "图片素材"
                        : `共 ${activeFragments.length} 处文本切片`}
                    </span>
                    {affectedSlides.length > 0 && (
                      <span className="text-ink-secondary">
                        已用于第 {affectedSlides.join("、")} 页
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {confirmDeleteAsset !== activeMaterial.asset_id && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAsset(activeMaterial.asset_id)}
                  className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-danger transition-colors cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除</span>
                </button>
              )}
            </div>

            {confirmDeleteAsset === activeMaterial.asset_id && (
              <div className="p-3 rounded-xl bg-danger-bg border border-danger/20 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <span className="text-danger font-medium">
                  {affectedSlides.length > 0
                    ? `第 ${affectedSlides.join("、")} 页正引用此素材，确认删除？`
                    : "确认从项目删除此素材？"}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAsset(null)}
                    className="px-2.5 py-1 rounded-full text-ink-secondary hover:text-ink cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={deletingAsset}
                    onClick={() =>
                      void handleConfirmDelete(activeMaterial.asset_id)
                    }
                    className="px-3 py-1 rounded-full bg-danger hover:bg-danger-hover text-white font-medium cursor-pointer disabled:opacity-40"
                  >
                    {deletingAsset ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto clean-scroll px-5 py-4 space-y-3">
            {currentSlide && (
              <div className="text-[13px] text-ink-secondary">
                可点击左侧缩略图切换页面，下方操作将作用于
                <span className="font-semibold text-ink ml-1">
                  第 {currentSlideIndex + 1} 页
                </span>
              </div>
            )}

            {activeMaterial.asset_type === "image" ? (
              <div className="space-y-4">
                <div className="aspect-[16/10] w-full rounded-xl bg-canvas border border-black/[0.08] overflow-hidden flex items-center justify-center p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/projects/${pid}/assets/${encodeURIComponent(
                      activeMaterial.asset_id
                    )}`}
                    alt={activeMaterial.asset_id}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>

                {currentSlide && (
                  <div className="flex flex-col gap-2">
                    {onApplyImageToSlide && (
                      <button
                        type="button"
                        onClick={() =>
                          onApplyImageToSlide(
                            activeMaterial.asset_id,
                            activeFragments[0]?.source_id
                          )
                        }
                        className="w-full h-10 rounded-xl ui-btn-outline text-[13px]"
                      >
                        设为第 {currentSlideIndex + 1} 页配图（切为图文页）
                      </button>
                    )}
                    {onToggleSourceId && activeFragments[0] && (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleSourceId(activeFragments[0].source_id)
                        }
                        className="w-full h-10 rounded-xl bg-canvas hover:bg-black/[0.08] text-ink text-[13px] font-medium transition-colors cursor-pointer"
                      >
                        {currentSlide.source_ids.includes(
                          activeFragments[0].source_id
                        )
                          ? `✓ 已关联到第 ${currentSlideIndex + 1} 页（点击解除）`
                          : `仅关联为第 ${currentSlideIndex + 1} 页出处`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {activeFragments.map((frag) => {
                  const excerpt = extractFragmentText(frag, materials);
                  const bound =
                    currentSlide?.source_ids.includes(frag.source_id) ?? false;
                  return (
                    <div
                      key={frag.source_id}
                      className="p-3.5 rounded-xl bg-surface-subtle border border-black/[0.08] space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="font-semibold text-ink">
                          {formatFragmentLocation(frag.location)}
                        </span>
                        {bound && (
                          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success">
                            <Check className="w-3.5 h-3.5" />
                            <span>已关联第 {currentSlideIndex + 1} 页</span>
                          </span>
                        )}
                      </div>

                      <p className="text-[13.5px] text-ink-secondary leading-relaxed whitespace-pre-wrap">
                        {excerpt || activeMaterial.content}
                      </p>

                      {currentSlide && (
                        <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-black/[0.06] text-[13px]">
                          {onToggleSourceId && (
                            <button
                              type="button"
                              onClick={() => onToggleSourceId(frag.source_id)}
                              className="text-ink underline underline-offset-2 hover:opacity-70 font-medium cursor-pointer"
                            >
                              {bound
                                ? `解除第 ${currentSlideIndex + 1} 页关联`
                                : `关联到第 ${currentSlideIndex + 1} 页`}
                            </button>
                          )}
                          {onInsertExcerptToSlide && excerpt && (
                            <button
                              type="button"
                              onClick={() =>
                                onInsertExcerptToSlide(frag.source_id, excerpt)
                              }
                              className="text-ink-secondary hover:text-ink font-medium cursor-pointer"
                            >
                              填入第 {currentSlideIndex + 1} 页
                              {getExcerptTargetLabel(currentLayout)}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── VIEW 3: Paste Text Note ─────────────────────────────────────────── */}
      {view.kind === "paste" && (
        <form
          onSubmit={(e) => void handleSaveNote(e)}
          className="flex-1 min-h-0 flex flex-col"
        >
          <div className="flex-1 min-h-0 overflow-y-auto clean-scroll p-5 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="drawer-note-title"
                className="block text-[13px] font-semibold text-ink"
              >
                素材名称（选填）
              </label>
              <input
                id="drawer-note-title"
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="例如：架构评审纪要"
                className="w-full h-10 px-3.5 text-[13.5px] ui-field"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="drawer-note-content"
                className="block text-[13px] font-semibold text-ink"
              >
                正文内容（支持 Markdown）
              </label>
              <textarea
                id="drawer-note-content"
                rows={12}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="直接粘贴会议纪要、技术文档、产品需求或核心数据段落，保存后将自动切分为可溯源的原始素材切片…"
                className="w-full px-3.5 py-2.5 text-[13.5px] ui-field leading-relaxed resize-y"
                autoFocus
              />
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-black/[0.07] bg-surface-subtle flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setView({ kind: "list" })}
              className="px-4 h-9 rounded-full text-[13px] font-medium text-ink-secondary hover:text-ink cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteContent.trim()}
              className="px-5 h-9 ui-btn-primary text-[13px]"
            >
              {savingNote ? "正在保存…" : "保存为项目素材"}
            </button>
          </div>
        </form>
      )}

      {/* ── VIEW 4: Regenerate Outline ──────────────────────────────────────── */}
      {view.kind === "regen" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setView({ kind: "list" });
            onGenerateOutline(regenPrompt.trim() || undefined);
          }}
          className="flex-1 min-h-0 flex flex-col"
        >
          <div className="flex-1 min-h-0 overflow-y-auto clean-scroll p-5 space-y-4">
            <div className="p-3.5 rounded-xl bg-canvas border border-black/[0.07] space-y-1.5">
              <div className="text-[13.5px] font-semibold text-ink">
                基于当前 {materials.length} 份素材生成新版本大纲
              </div>
              <p className="text-[13px] text-ink-secondary leading-relaxed">
                {outline && outline.items.length > 0
                  ? "将派生一份全新大纲草稿，当前版本仍保留在顶栏历史版本列表中，可随时切回。"
                  : "系统将依据素材内容自动结构化提炼页面大纲，不会编造无依据数字。"}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="drawer-regen-prompt"
                className="block text-[13px] font-semibold text-ink"
              >
                补充提炼要求（选填）
              </label>
              <textarea
                id="drawer-regen-prompt"
                rows={5}
                value={regenPrompt}
                onChange={(e) => setRegenPrompt(e.target.value)}
                placeholder="例如：控制在 6 页以内，重点突出性能对比与落地结论"
                className="w-full px-3.5 py-2.5 text-[13.5px] ui-field leading-relaxed resize-y"
                autoFocus
              />
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-black/[0.07] bg-surface-subtle flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setView({ kind: "list" })}
              className="px-4 h-9 rounded-full text-[13px] font-medium text-ink-secondary hover:text-ink cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="px-5 h-9 ui-btn-primary text-[13px]"
            >
              {isGenerating ? "正在提炼…" : "开始提炼新版本"}
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}
