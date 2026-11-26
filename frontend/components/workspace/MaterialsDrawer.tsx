"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardPaste,
  FileText,
  Globe,
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
import { usePresence } from "../../lib/usePresence";
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
  | { kind: "url" }
  | { kind: "regen" };

interface MaterialsDrawerProps {
  open?: boolean;
  embedded?: boolean;
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
  onImportUrl?: (url: string, title?: string) => Promise<void>;
  onDeleteMaterial: (assetId: string) => Promise<void>;
  onToggleSourceId?: (sourceId: string) => void;
  onInsertExcerptToSlide?: (sourceId: string, text: string) => void;
  onApplyImageToSlide?: (imageAssetId: string, sourceId?: string) => void;
  onGenerateOutline: (prompt?: string) => void;
  onClose: () => void;
}

export function MaterialsDrawer({
  open = true,
  embedded = false,
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
  onImportUrl,
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
  const [urlValue, setUrlValue] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<string | null>(
    null
  );
  const [deletingAsset, setDeletingAsset] = useState(false);

  const { mounted, exiting } = usePresence(open, 170);

  // Esc goes back to list from sub-views, or closes drawer from list view
  useEffect(() => {
    if (!open || embedded) return;
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
  }, [open, embedded, view.kind, onClose]);

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
        const usedInCustom = Boolean(
          it.custom_elements?.some(
            (el) => el.kind === "image" && el.image_asset_id === m.asset_id
          )
        );
        if (
          it.image_asset_id === m.asset_id ||
          usedInCustom ||
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
    materials.length >= 4 ||
    (docCount > 0 && imgCount > 0 && materials.length >= 2);

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
    } catch {
      // Handled by workspace error banner
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
    } catch {
      // Handled by workspace error banner
    } finally {
      setDeletingAsset(false);
    }
  }

  function handleFallbackToPasteFromUrl() {
    const cleanUrl = urlValue.trim();
    if (urlTitle.trim() && !noteTitle.trim()) {
      setNoteTitle(urlTitle.trim());
    }
    if (cleanUrl && !noteContent.trim()) {
      setNoteContent(`> 来源链接：${cleanUrl}\n\n`);
    }
    setUrlError(null);
    setView({ kind: "paste" });
  }

  const currentLayout = currentSlide
    ? inferEffectiveLayout(
        currentSlide.layout,
        currentSlideIndex,
        outline?.items.length || 1
      )
    : "content";

  if (!embedded && !mounted) return null;

  const padX = embedded ? "px-3" : "px-5";
  // Context-aware tonal contrast: embedded sits on #0D0D0E, slide-over drawer sits on #151516
  const wellBg = embedded ? "bg-ui-surface" : "bg-ui-bg";
  const inputBg = embedded ? "bg-ui-surface-input" : "bg-ui-bg";
  const rowHover = embedded ? "hover:bg-ui-surface" : "hover:bg-ui-control-hover";
  const actionBtnTone = embedded
    ? "bg-ui-surface hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text"
    : "bg-ui-bg hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text";

  const panelBody = (
    <div
      onDragOver={(e) => {
        if (!onDropFiles) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => {
        if (!onDropFiles) return;
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
      className={
        embedded
          ? "flex-1 min-h-0 flex flex-col relative bg-ui-bg"
          : `fixed top-12 right-0 bottom-0 z-30 w-full sm:w-[440px] xl:w-[468px] bg-ui-surface shadow-[-16px_0_48px_rgba(0,0,0,0.65)] flex flex-col ${
              exiting
                ? "anim-drawer-right-out pointer-events-none"
                : "anim-drawer-right-in"
            }`
      }
    >
      {/* Drag-Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-2 z-40 rounded-xl ring-1 ring-ui-focus bg-ui-bg-selected/95 flex flex-col items-center justify-center gap-2 pointer-events-none px-4 text-center">
          <Upload className="w-5 h-5 text-ui-accent-text" />
          <span className="text-[13px] font-medium text-ui-text">
            松开即可导入材料
          </span>
        </div>
      )}

      {/* Header (omitted on embedded list view since left rail header shows tabs) */}
      {(!embedded || view.kind !== "list") && (
        <div
          className={`${padX} pt-3.5 pb-2.5 flex items-center justify-between gap-2 shrink-0`}
        >
          {view.kind === "list" ? (
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ui-text">
                材料库
              </h2>
              <span className="text-[12.5px] text-ui-text-muted tabular-nums">
                {materials.length}
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteAsset(null);
                setUrlError(null);
                setView({ kind: "list" });
              }}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer min-w-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              <span className="truncate">
                {view.kind === "paste"
                  ? "粘贴文本笔记"
                  : view.kind === "url"
                  ? "导入公开网页"
                  : view.kind === "regen"
                  ? "重新提炼大纲"
                  : "材料列表"}
              </span>
            </button>
          )}

          {!embedded && (
            <button
              type="button"
              onClick={onClose}
              title="关闭材料库 (Esc)"
              aria-label="关闭材料库"
              className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* ── VIEW 1: Borderless Materials List ───────────────────────────────── */}
      {view.kind === "list" && (
        <>
          <div className={`${padX} pt-1 pb-2 space-y-2.5 shrink-0`}>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={onUploadClick}
                className={`h-8 px-2 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${actionBtnTone}`}
              >
                <Plus className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span>上传</span>
              </button>
              <button
                type="button"
                onClick={() => setView({ kind: "paste" })}
                className={`h-8 px-2 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${actionBtnTone}`}
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span>粘贴</span>
              </button>
              {onImportUrl && (
                <button
                  type="button"
                  onClick={() => setView({ kind: "url" })}
                  className={`h-8 px-2 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${actionBtnTone}`}
                >
                  <Globe className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                  <span>网页</span>
                </button>
              )}
            </div>

            {showSearchAndFilter && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-ui-icon absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    aria-label="搜索材料"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索材料"
                    className={`ui-field ${inputBg} w-full h-8 pl-8 pr-7 text-[12.5px]`}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      aria-label="清空搜索"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-ui-icon hover:text-ui-text cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {docCount > 0 && imgCount > 0 && (
                  <div className="flex items-center gap-1 text-[12px]">
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
                          className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer tabular-nums ${
                            active
                              ? "bg-ui-bg-selected text-ui-text font-medium"
                              : "text-ui-text-muted hover:text-ui-text-secondary"
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

          <div
            className={`flex-1 min-h-0 overflow-y-auto clean-scroll ${padX} py-2 space-y-1`}
          >
            {materials.length === 0 ? (
              <div
                className={`py-8 px-4 rounded-xl ${wellBg} text-center space-y-1.5`}
              >
                <p className="text-[13px] font-medium text-ui-text">
                  暂无参考材料
                </p>
                <p className="text-[12px] text-ui-text-muted leading-relaxed">
                  点击上方导入，或直接将文件拖入此区域。
                </p>
              </div>
            ) : filteredMaterials.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-[13px] text-ui-text-muted">
                  没有匹配的材料
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setFilterType("all");
                  }}
                  className="text-[12.5px] font-medium text-ui-accent-text hover:underline cursor-pointer"
                >
                  清除筛选
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
                    className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors flex items-center gap-2.5 group cursor-pointer ${rowHover}`}
                  >
                    {isImg ? (
                      <div
                        className={`w-10 h-7 rounded-md ${wellBg} overflow-clip flex items-center justify-center shrink-0`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/projects/${pid}/assets/${encodeURIComponent(
                            m.asset_id
                          )}`}
                          alt={m.asset_id}
                          className="w-full h-full object-cover block"
                        />
                      </div>
                    ) : (
                      <div
                        className={`w-8 h-8 rounded-lg ${wellBg} flex items-center justify-center shrink-0`}
                      >
                        <FileText className="w-3.5 h-3.5 text-ui-icon" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div
                        className="text-[13px] font-medium text-ui-text truncate"
                        title={m.asset_id}
                      >
                        {m.asset_id}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 text-[11.5px] text-ui-text-muted tabular-nums">
                        <span>
                          {isImg ? "图片" : `${frags.length} 切片`}
                        </span>
                        {refs.length > 0 && (
                          <span className="truncate">
                            第{" "}
                            {refs.length <= 3
                              ? refs.join("、")
                              : `${refs.slice(0, 2).join("、")}等${refs.length}`}
                            页
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="w-3.5 h-3.5 text-ui-icon-quiet opacity-50 group-hover:opacity-100 group-hover:text-ui-text transition-opacity shrink-0" />
                  </button>
                );
              })
            )}
          </div>

          {materials.length > 0 && (
            <div className={`${padX} pt-2 pb-3 shrink-0`}>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => setView({ kind: "regen" })}
                className={`w-full h-8.5 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 ${actionBtnTone}`}
              >
                <Sparkles className="w-3.5 h-3.5 text-ui-accent-text" />
                <span>{isGenerating ? "提炼中…" : "重新提炼大纲"}</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* ── VIEW 2: Material Detail & Fragments ─────────────────────────────── */}
      {view.kind === "detail" && activeMaterial && (
        <>
          <div className={`${padX} pt-1 pb-3 space-y-2.5 shrink-0`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className={`w-7 h-7 rounded-lg ${wellBg} flex items-center justify-center shrink-0 mt-0.5`}
                >
                  {activeMaterial.asset_type === "image" ? (
                    <ImageIcon className="w-3.5 h-3.5 text-ui-icon" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-ui-icon" />
                  )}
                </div>
                <div className="min-w-0">
                  <div
                    className="text-[13px] font-semibold text-ui-text break-all leading-snug"
                    title={activeMaterial.asset_id}
                  >
                    {activeMaterial.asset_id}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 text-[12px] text-ui-text-muted mt-0.5 tabular-nums">
                    <span>
                      {activeMaterial.asset_type === "image"
                        ? "图片素材"
                        : `共 ${activeFragments.length} 处切片`}
                    </span>
                    {affectedSlides.length > 0 && (
                      <span>第 {affectedSlides.join("、")} 页引用</span>
                    )}
                  </div>
                </div>
              </div>

              {confirmDeleteAsset !== activeMaterial.asset_id && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAsset(activeMaterial.asset_id)}
                  className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-danger hover:bg-ui-danger-bg transition-colors cursor-pointer shrink-0"
                  title="删除此材料"
                  aria-label="删除此材料"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {confirmDeleteAsset === activeMaterial.asset_id && (
              <div className="p-3 rounded-xl bg-ui-danger-bg space-y-2.5 text-[12.5px]">
                <div className="text-ui-danger font-medium leading-snug">
                  {affectedSlides.length > 0
                    ? `第 ${affectedSlides.join("、")} 页正引用此材料，确认删除？`
                    : "确认从项目删除此材料？"}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAsset(null)}
                    className="px-2.5 py-1 rounded-md text-ui-text-secondary hover:text-ui-text cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={deletingAsset}
                    onClick={() =>
                      void handleConfirmDelete(activeMaterial.asset_id)
                    }
                    className="px-2.5 py-1 rounded-md bg-ui-danger text-ui-bg font-medium hover:brightness-110 cursor-pointer disabled:opacity-40"
                  >
                    {deletingAsset ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div
            className={`flex-1 min-h-0 overflow-y-auto clean-scroll ${padX} pb-4 space-y-2.5`}
          >
            {activeMaterial.asset_type === "image" ? (
              <div className="space-y-3">
                <div
                  className={`aspect-[16/10] w-full rounded-xl ${wellBg} overflow-clip flex items-center justify-center p-2`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/projects/${pid}/assets/${encodeURIComponent(
                      activeMaterial.asset_id
                    )}`}
                    alt={activeMaterial.asset_id}
                    className="max-w-full max-h-full object-contain block"
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
                        className="w-full h-8.5 ui-btn-primary text-[12.5px]"
                      >
                        设为第 {currentSlideIndex + 1} 页配图
                      </button>
                    )}
                    {onToggleSourceId && activeFragments[0] && (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleSourceId(activeFragments[0].source_id)
                        }
                        className={`w-full h-8.5 rounded-lg text-[12.5px] font-medium transition-colors cursor-pointer ${actionBtnTone}`}
                      >
                        {currentSlide.source_ids.includes(
                          activeFragments[0].source_id
                        )
                          ? `已关联第 ${currentSlideIndex + 1} 页`
                          : `关联为第 ${currentSlideIndex + 1} 页出处`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {activeFragments.map((frag) => {
                  const excerpt = extractFragmentText(frag, materials);
                  const bound =
                    currentSlide?.source_ids.includes(frag.source_id) ?? false;
                  return (
                    <div
                      key={frag.source_id}
                      className={`p-3 rounded-xl ${wellBg} space-y-2`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[12px]">
                        <span className="font-medium text-ui-text">
                          {formatFragmentLocation(frag.location)}
                        </span>
                        {bound && (
                          <span className="inline-flex items-center gap-1 text-ui-success font-medium">
                            <Check className="w-3 h-3" />
                            <span>已关联</span>
                          </span>
                        )}
                      </div>

                      <p className="text-[12.5px] text-ui-text-secondary leading-relaxed whitespace-pre-wrap">
                        {excerpt || activeMaterial.content}
                      </p>

                      {currentSlide && (
                        <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px]">
                          {onToggleSourceId && (
                            <button
                              type="button"
                              onClick={() => onToggleSourceId(frag.source_id)}
                              className="text-ui-accent-text hover:underline font-medium cursor-pointer"
                            >
                              {bound
                                ? "解除关联"
                                : `关联到第 ${currentSlideIndex + 1} 页`}
                            </button>
                          )}
                          {onInsertExcerptToSlide && excerpt && (
                            <button
                              type="button"
                              onClick={() =>
                                onInsertExcerptToSlide(frag.source_id, excerpt)
                              }
                              className="text-ui-text-muted hover:text-ui-text font-medium transition-colors cursor-pointer"
                            >
                              填入{getExcerptTargetLabel(currentLayout)}
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
          <div
            className={`flex-1 min-h-0 overflow-y-auto clean-scroll ${padX} py-2 space-y-3.5`}
          >
            <div className="space-y-1.5">
              <label
                htmlFor="drawer-note-title"
                className="block text-[12.5px] font-medium text-ui-text-secondary"
              >
                材料名称（选填）
              </label>
              <input
                id="drawer-note-title"
                name="title"
                type="text"
                enterKeyHint="next"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder="例如：架构评审纪要"
                className={`ui-field ${inputBg} w-full h-9 px-3 text-[13px]`}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="drawer-note-content"
                className="block text-[12.5px] font-medium text-ui-text-secondary"
              >
                正文内容
              </label>
              <textarea
                id="drawer-note-content"
                name="content"
                required
                rows={9}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="粘贴会议纪要、技术方案或核心数据段落…"
                className={`ui-field ${inputBg} ui-autogrow-note px-3 py-2 text-[13px] leading-relaxed resize-y`}
                autoFocus
              />
            </div>
          </div>

          <div
            className={`${padX} py-3 flex items-center justify-end gap-2 shrink-0`}
          >
            <button
              type="button"
              onClick={() => setView({ kind: "list" })}
              className="px-3 h-8 rounded-lg text-[12.5px] text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={savingNote}
              className="px-3.5 h-8 ui-btn-primary text-[12.5px]"
            >
              {savingNote ? "保存中…" : "保存材料"}
            </button>
          </div>
        </form>
      )}

      {/* ── VIEW 3B: Import Web URL ─────────────────────────────────────────── */}
      {view.kind === "url" && onImportUrl && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!urlValue.trim()) return;
            void (async () => {
              setFetchingUrl(true);
              setUrlError(null);
              try {
                await onImportUrl(
                  urlValue.trim(),
                  urlTitle.trim() || undefined
                );
                setUrlValue("");
                setUrlTitle("");
                setUrlError(null);
                setView({ kind: "list" });
              } catch (err) {
                setUrlError(
                  (err as Error).message ||
                    "未能提取到网页正文，建议换具体文章链接或改为手动粘贴正文。"
                );
              } finally {
                setFetchingUrl(false);
              }
            })();
          }}
          className="flex-1 min-h-0 flex flex-col"
        >
          <div
            className={`flex-1 min-h-0 overflow-y-auto clean-scroll ${padX} py-2 space-y-3.5`}
          >
            {urlError && (
              <div
                id="drawer-url-error"
                role="alert"
                className="p-3 rounded-xl bg-ui-danger-bg space-y-2 text-[12.5px] text-ui-danger"
              >
                <p className="leading-relaxed">{urlError}</p>
                <button
                  type="button"
                  onClick={handleFallbackToPasteFromUrl}
                  className="ui-btn-subtle px-2.5 py-1 text-[12px] text-ui-text"
                >
                  改为手动粘贴正文
                </button>
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="drawer-url-input"
                className="block text-[12.5px] font-medium text-ui-text-secondary"
              >
                网页链接
              </label>
              <input
                id="drawer-url-input"
                name="url"
                type="url"
                required
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="done"
                aria-invalid={urlError ? "true" : undefined}
                aria-describedby={urlError ? "drawer-url-error" : undefined}
                value={urlValue}
                onChange={(e) => {
                  setUrlValue(e.target.value);
                  if (urlError) setUrlError(null);
                }}
                placeholder="https://example.com/article"
                className={`ui-field ${inputBg} w-full h-9 px-3 text-[13px] font-mono`}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="drawer-url-title"
                className="block text-[12.5px] font-medium text-ui-text-secondary"
              >
                材料名称（选填）
              </label>
              <input
                id="drawer-url-title"
                name="title"
                type="text"
                enterKeyHint="done"
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                placeholder="留空自动使用网页标题"
                className={`ui-field ${inputBg} w-full h-9 px-3 text-[13px]`}
              />
            </div>
          </div>

          <div
            className={`${padX} py-3 flex items-center justify-end gap-2 shrink-0`}
          >
            <button
              type="button"
              onClick={() => {
                setUrlError(null);
                setView({ kind: "list" });
              }}
              className="px-3 h-8 rounded-lg text-[12.5px] text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={fetchingUrl}
              className="px-3.5 h-8 ui-btn-primary text-[12.5px]"
            >
              {fetchingUrl ? "抓取中…" : "抓取导入"}
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
          <div
            className={`flex-1 min-h-0 overflow-y-auto clean-scroll ${padX} py-2 space-y-3.5`}
          >
            <div className={`p-3 rounded-xl ${wellBg} space-y-1`}>
              <div className="text-[13px] font-medium text-ui-text">
                基于 {materials.length} 份材料生成新版大纲
              </div>
              <p className="text-[12px] text-ui-text-muted leading-relaxed">
                将派生新版本，当前版本仍保留在历史版本中。
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="drawer-regen-prompt"
                className="block text-[12.5px] font-medium text-ui-text-secondary"
              >
                补充要求（选填）
              </label>
              <textarea
                id="drawer-regen-prompt"
                name="regen_prompt"
                rows={4}
                value={regenPrompt}
                onChange={(e) => setRegenPrompt(e.target.value)}
                placeholder="例如：控制在 6 页以内，重点突出性能对比"
                className={`ui-field ${inputBg} ui-autogrow-textarea px-3 py-2 text-[13px] leading-relaxed resize-y`}
                autoFocus
              />
            </div>
          </div>

          <div
            className={`${padX} py-3 flex items-center justify-end gap-2 shrink-0`}
          >
            <button
              type="button"
              onClick={() => setView({ kind: "list" })}
              className="px-3 h-8 rounded-lg text-[12.5px] text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="px-3.5 h-8 ui-btn-primary text-[12.5px]"
            >
              {isGenerating ? "提炼中…" : "开始提炼"}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  if (embedded) {
    return panelBody;
  }

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-x-0 top-12 bottom-0 z-29 bg-black/60 ${
          exiting ? "anim-scrim-out pointer-events-none" : "anim-scrim-in"
        }`}
      />
      {panelBody}
    </>
  );
}
