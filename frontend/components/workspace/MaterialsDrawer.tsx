"use client";

import { useState } from "react";
import {
  Check,
  ClipboardPaste,
  FileText,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  Material,
  Outline,
  OutlineItem,
  SourceFragment,
} from "../../lib/api";
import { extractFragmentText, formatAssetLabel } from "./SlideInspector";

interface MaterialsDrawerProps {
  pid: string;
  materials: Material[];
  sourceFragments: SourceFragment[];
  outline?: Outline | null;
  currentSlide?: OutlineItem;
  currentSlideIndex: number;
  isGenerating: boolean;
  onUploadClick: () => void;
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
  onPasteNote,
  onDeleteMaterial,
  onToggleSourceId,
  onInsertExcerptToSlide,
  onApplyImageToSlide,
  onGenerateOutline,
  onClose,
}: MaterialsDrawerProps) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState<string | null>(
    null
  );
  const [deletingAsset, setDeletingAsset] = useState(false);

  const activeMaterial =
    materials.find((m) => m.asset_id === selectedAssetId) || null;
  const activeFragments = activeMaterial
    ? sourceFragments.filter((f) => f.asset_id === activeMaterial.asset_id)
    : [];
  const activeFragIds = new Set(activeFragments.map((f) => f.source_id));

  const affectedSlides =
    activeMaterial && outline
      ? outline.items
          .map((it, idx) => ({ it, idx }))
          .filter(
            ({ it }) =>
              it.image_asset_id === activeMaterial.asset_id ||
              it.source_ids.some((sid) => activeFragIds.has(sid))
          )
          .map(({ idx }) => idx + 1)
      : [];

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      await onPasteNote(noteTitle.trim(), noteContent);
      setNoteTitle("");
      setNoteContent("");
      setPasteOpen(false);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleConfirmDelete(assetId: string) {
    setDeletingAsset(true);
    try {
      await onDeleteMaterial(assetId);
      setConfirmDeleteAsset(null);
      setSelectedAssetId(null);
    } finally {
      setDeletingAsset(false);
    }
  }

  return (
    <div className="border-b border-black/[0.07] bg-white px-5 py-3.5 shrink-0 space-y-3">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-[#1d1d1f] mr-1 whitespace-nowrap">
            素材库
            {sourceFragments.length > 0 && (
              <span className="font-normal text-[#86868b] ml-1.5">
                {sourceFragments.length} 处切片 · 点击预览或引用
              </span>
            )}
          </span>

          {materials.length > 0 ? (
            materials.map((m, i) => {
              const isSelected = selectedAssetId === m.asset_id;
              const isImg = m.asset_type === "image";
              return (
                <button
                  key={`${m.asset_id}-${m.asset_type}-${i}`}
                  type="button"
                  onClick={() => {
                    setPasteOpen(false);
                    setRegenOpen(false);
                    setConfirmDeleteAsset(null);
                    setSelectedAssetId(isSelected ? null : m.asset_id);
                  }}
                  title={`点击查看「${m.asset_id}」内容`}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-medium transition-all cursor-pointer ${
                    isSelected
                      ? "bg-[#0071e3] text-white shadow-2xs"
                      : isImg
                      ? "bg-[#0071e3]/[0.08] text-[#0071e3] hover:bg-[#0071e3]/[0.14]"
                      : "bg-[#f5f5f7] text-[#1d1d1f] hover:bg-black/[0.08]"
                  }`}
                >
                  {isImg ? (
                    <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <FileText
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected ? "text-white" : "text-[#6e6e73]"
                      }`}
                    />
                  )}
                  <span className="truncate max-w-[180px]">
                    {formatAssetLabel(m.asset_id)}
                  </span>
                </button>
              );
            })
          ) : (
            <span className="text-[13px] text-[#86868b]">暂无材料</span>
          )}
        </div>

        <div className="flex items-center gap-3.5 text-[13px] shrink-0">
          <button
            type="button"
            onClick={() => {
              setSelectedAssetId(null);
              setRegenOpen(false);
              setPasteOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-1 font-medium cursor-pointer whitespace-nowrap ${
              pasteOpen
                ? "text-[#1d1d1f] underline"
                : "text-[#0071e3] hover:underline"
            }`}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>+ 粘贴文本笔记</span>
          </button>

          <button
            type="button"
            onClick={onUploadClick}
            className="inline-flex items-center gap-1 text-[#0071e3] hover:underline font-medium cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>上传文件/图片</span>
          </button>

          {materials.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedAssetId(null);
                setPasteOpen(false);
                setRegenOpen((v) => !v);
              }}
              disabled={isGenerating}
              className={`font-medium cursor-pointer disabled:opacity-40 whitespace-nowrap ${
                regenOpen
                  ? "text-[#0071e3] underline"
                  : "text-[#1d1d1f] hover:text-[#0071e3]"
              }`}
            >
              {isGenerating ? "提炼中…" : "重新提炼大纲"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[#86868b] hover:text-[#1d1d1f] cursor-pointer whitespace-nowrap"
          >
            收起
          </button>
        </div>
      </div>

      {/* Controlled Regenerate Outline Panel (PRD Stage 2 & 7.3) */}
      {regenOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRegenOpen(false);
            onGenerateOutline(regenPrompt.trim() || undefined);
          }}
          className="max-w-6xl mx-auto p-4 rounded-2xl bg-[#f5f5f7] border border-black/[0.07] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0071e3]" />
              <span className="text-[13px] font-semibold text-[#1d1d1f]">
                按当前素材库重新提炼大纲
              </span>
              {outline && outline.items.length > 0 && (
                <span className="text-[11.5px] text-[#6e6e73] bg-white px-2.5 py-0.5 rounded-full border border-black/[0.06]">
                  将生成全新大纲版本，当前版本仍保留在顶栏历史版本列表中可随时切回
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setRegenOpen(false)}
              className="text-[#86868b] hover:text-[#1d1d1f] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <input
              type="text"
              value={regenPrompt}
              onChange={(e) => setRegenPrompt(e.target.value)}
              placeholder="可选：输入提炼要求（例如：控制在 6 页以内，重点突出性能对比与落地结论）"
              className="flex-1 text-[13px] text-[#1d1d1f] placeholder-[#86868b] bg-white rounded-xl px-3.5 py-2 border border-black/[0.08] focus:border-[#0071e3] outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={isGenerating}
              className="px-4 py-2 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[12.5px] font-medium transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              {isGenerating ? "正在提炼…" : "开始提炼新版本"}
            </button>
          </div>
        </form>
      )}

      {/* Inline "Paste Text Note" Sheet */}
      {pasteOpen && (
        <form
          onSubmit={(e) => void handleSaveNote(e)}
          className="max-w-6xl mx-auto p-4 rounded-2xl bg-[#f5f5f7] border border-black/[0.07] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[#1d1d1f]">
              直接粘贴文本或 Markdown 笔记
            </span>
            <button
              type="button"
              onClick={() => setPasteOpen(false)}
              className="text-[#86868b] hover:text-[#1d1d1f] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="素材名称（选填，如：架构纪要）"
              className="sm:col-span-1 text-[13px] text-[#1d1d1f] placeholder-[#86868b] bg-white rounded-xl px-3 py-2 border border-black/[0.08] focus:border-[#0071e3] outline-none"
            />
            <textarea
              rows={3}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="在此直接粘贴会议纪要、技术文档、产品需求或核心数据段落，保存后将自动切分为可溯源的原始素材切片…"
              className="sm:col-span-3 text-[13px] text-[#1d1d1f] placeholder-[#86868b] bg-white rounded-xl px-3 py-2 border border-black/[0.08] focus:border-[#0071e3] outline-none resize-y leading-relaxed"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPasteOpen(false)}
              className="px-3.5 py-1.5 rounded-full text-[12.5px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteContent.trim()}
              className="px-4 py-1.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[12.5px] font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {savingNote ? "正在保存…" : "保存为项目素材"}
            </button>
          </div>
        </form>
      )}

      {/* Selected Material Inspector Panel */}
      {activeMaterial && (
        <div className="max-w-6xl mx-auto p-4 rounded-2xl bg-[#f5f5f7] border border-black/[0.07] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {activeMaterial.asset_type === "image" ? (
                <ImageIcon className="w-4 h-4 text-[#0071e3] shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-[#6e6e73] shrink-0" />
              )}
              <span className="text-[13px] font-semibold text-[#1d1d1f] truncate">
                {activeMaterial.asset_id}
              </span>
              <span className="text-[11.5px] text-[#86868b] shrink-0">
                {activeMaterial.asset_type === "image"
                  ? "图片素材"
                  : `共 ${activeFragments.length} 个文本切片`}
              </span>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {confirmDeleteAsset === activeMaterial.asset_id ? (
                <div className="flex items-center gap-2 bg-[#fff2f2] border border-[#ff3b30]/20 px-2.5 py-1 rounded-full text-[12px]">
                  <span className="text-[#d70015] font-medium">
                    {affectedSlides.length > 0
                      ? `第 ${affectedSlides.join("、")} 页正引用此素材，确认删除？`
                      : "确认从项目删除此素材？"}
                  </span>
                  <button
                    type="button"
                    disabled={deletingAsset}
                    onClick={() =>
                      void handleConfirmDelete(activeMaterial.asset_id)
                    }
                    className="px-2.5 py-0.5 rounded-full bg-[#ff3b30] text-white font-medium cursor-pointer disabled:opacity-40"
                  >
                    {deletingAsset ? "删除中…" : "确认删除"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAsset(null)}
                    className="text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAsset(activeMaterial.asset_id)}
                  className="inline-flex items-center gap-1 text-[12px] text-[#86868b] hover:text-[#d70015] transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>删除素材</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedAssetId(null)}
                className="text-[#86868b] hover:text-[#1d1d1f] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {activeMaterial.asset_type === "image" ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-3 rounded-xl border border-black/[0.06]">
              <div className="w-44 aspect-[16/10] rounded-lg bg-[#f5f5f7] overflow-hidden flex items-center justify-center shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/projects/${pid}/assets/${encodeURIComponent(
                    activeMaterial.asset_id
                  )}`}
                  alt={activeMaterial.asset_id}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <div className="flex-1 space-y-2 text-center sm:text-left">
                <div className="text-[13px] font-medium text-[#1d1d1f]">
                  原始图片素材：{activeMaterial.asset_id}
                </div>
                <p className="text-[12px] text-[#6e6e73]">
                  可将此图片直接设为当前选中幻灯片（第 {currentSlideIndex + 1}{" "}
                  页）的右侧配图，或关联为该页的材料出处。
                </p>
                {currentSlide && (
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                    {onApplyImageToSlide && (
                      <button
                        type="button"
                        onClick={() =>
                          onApplyImageToSlide(
                            activeMaterial.asset_id,
                            activeFragments[0]?.source_id
                          )
                        }
                        className="px-3.5 py-1.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[12px] font-medium transition-colors cursor-pointer"
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
                        className="px-3.5 py-1.5 rounded-full bg-[#f5f5f7] hover:bg-black/[0.08] text-[#1d1d1f] text-[12px] font-medium transition-colors cursor-pointer"
                      >
                        {currentSlide.source_ids.includes(
                          activeFragments[0].source_id
                        )
                          ? `✓ 已关联到第 ${currentSlideIndex + 1} 页`
                          : `仅关联为第 ${currentSlideIndex + 1} 页出处`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[210px] overflow-y-auto clean-scroll pr-0.5">
              {activeFragments.map((frag) => {
                const excerpt = extractFragmentText(frag, materials);
                const bound =
                  currentSlide?.source_ids.includes(frag.source_id) ?? false;
                return (
                  <div
                    key={frag.source_id}
                    className="p-3 rounded-xl bg-white border border-black/[0.06] flex flex-col justify-between gap-2"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="font-mono font-semibold text-[#1d1d1f]">
                          {frag.location.replace(/^L/, "第 ")}
                        </span>
                        {bound && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#248a3d]">
                            <Check className="w-3 h-3" />
                            <span>已关联第 {currentSlideIndex + 1} 页</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[12.5px] text-[#424245] leading-relaxed whitespace-pre-wrap max-h-[110px] overflow-y-auto clean-scroll">
                        {excerpt || activeMaterial.content}
                      </p>
                    </div>

                    {currentSlide && (
                      <div className="flex items-center gap-3 pt-1.5 border-t border-black/[0.05] text-[12px]">
                        {onToggleSourceId && (
                          <button
                            type="button"
                            onClick={() => onToggleSourceId(frag.source_id)}
                            className="text-[#0071e3] hover:underline font-medium cursor-pointer"
                          >
                            {bound
                              ? `解除与第 ${currentSlideIndex + 1} 页关联`
                              : `关联到第 ${currentSlideIndex + 1} 页`}
                          </button>
                        )}
                        {onInsertExcerptToSlide && excerpt && (
                          <>
                            <span className="text-[#d2d2d7]">·</span>
                            <button
                              type="button"
                              onClick={() =>
                                onInsertExcerptToSlide(frag.source_id, excerpt)
                              }
                              className="text-[#1d1d1f] hover:text-[#0071e3] font-medium cursor-pointer"
                            >
                              填入第 {currentSlideIndex + 1} 页正文
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
