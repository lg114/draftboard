"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Sparkles, Trash2 } from "lucide-react";
import type {
  CanvasElement,
  Issue,
  LLMSettingsResponse,
  Material,
  OutlineItem,
  SavedLayoutPreset,
  SlideRefineCandidate,
  SourceFragment,
} from "../../lib/api";
import { Collapse } from "../ui/Collapse";
import { CustomCanvasInspector } from "./inspector/CustomCanvasInspector";
import {
  AutoGrowTextarea,
  extractFragmentText,
  formatAssetLabel,
} from "./inspector/inspectorUtils";
import { ProvenanceSection } from "./inspector/ProvenanceSection";
import { StandardSlideEditor } from "./inspector/StandardSlideEditor";
import {
  EditableOutlineField,
  inferEffectiveLayout,
  LAYOUT_LABELS,
} from "./layoutUtils";

export { extractFragmentText, formatAssetLabel };

interface SlideInspectorProps {
  pid: string;
  item: OutlineItem;
  slideIndex: number;
  totalSlides: number;
  materials: Material[];
  sourceFragments: SourceFragment[];
  slideIssues: Issue[];
  onUpdateField: (field: EditableOutlineField, value: string) => void;
  onUpdateCustomElementText?: (elementId: string, text: string) => void;
  onUpdateCustomElement?: (
    elementId: string,
    patch: Partial<CanvasElement>
  ) => void;
  onClearCustomLayout?: () => void;
  onSwitchToChat?: () => void;
  onInspectFragment?: (frag: SourceFragment) => void;
  savedLayouts?: SavedLayoutPreset[];
  onSaveCustomLayout?: (name: string) => Promise<void>;
  onApplySavedLayout?: (preset: SavedLayoutPreset) => void;
  onDeleteSavedLayout?: (layoutId: string) => Promise<void>;
  onToggleSourceId: (sourceId: string) => void;
  onApplyImageToSlide: (imageAssetId: string, sourceId?: string) => void;
  onSplitTwoColumn: () => void;
  onRefineSlide: (
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ) => Promise<SlideRefineCandidate | null>;
  onApplyRefineCandidate: (candidate: SlideRefineCandidate) => void;
  onUploadClick: () => void;
  llmConfigured?: boolean;
  activeModelLabel?: string;
  llmSettings?: LLMSettingsResponse | null;
  onLLMSettingsUpdated?: (next: LLMSettingsResponse) => void;
  onOpenLLMSettings?: () => void;
  embedded?: boolean;
}

export function SlideInspector({
  pid,
  item,
  slideIndex,
  totalSlides,
  materials,
  sourceFragments,
  slideIssues,
  onUpdateField,
  onUpdateCustomElementText,
  onUpdateCustomElement,
  onClearCustomLayout,
  onSwitchToChat,
  onInspectFragment,
  savedLayouts = [],
  onSaveCustomLayout,
  onApplySavedLayout,
  onDeleteSavedLayout,
  onToggleSourceId,
  onApplyImageToSlide,
  onSplitTwoColumn,
  onRefineSlide,
  onApplyRefineCandidate,
  onUploadClick,
  llmConfigured = true,
  activeModelLabel = "",
  llmSettings = null,
  onLLMSettingsUpdated,
  onOpenLLMSettings,
  embedded = false,
}: SlideInspectorProps) {
  const [notesOpen, setNotesOpen] = useState(true);
  const [refiningMode, setRefiningMode] = useState<string | null>(null);
  const [refineCandidate, setRefineCandidate] =
    useState<SlideRefineCandidate | null>(null);
  const [refineNotice, setRefineNotice] = useState("");

  useEffect(() => {
    setRefineCandidate(null);
    setRefineNotice("");
  }, [item.outline_item_id]);

  const layout = inferEffectiveLayout(item.layout, slideIndex, totalSlides);
  const isCustomCanvas = Boolean(
    item.custom_elements && item.custom_elements.length > 0
  );
  const imageAssets = materials.filter((m) => m.asset_type === "image");
  const imageAssetIds = new Set(imageAssets.map((m) => m.asset_id));

  const primaryInputBase =
    "ui-field text-[14.5px] px-3.5 py-2.5 leading-relaxed";

  async function triggerRefine(
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ) {
    setRefiningMode(mode);
    setRefineNotice("");
    try {
      const candidate = await onRefineSlide(mode, instruction);
      if (candidate) {
        const unchanged =
          candidate.title.trim() === item.title.trim() &&
          candidate.summary.trim() === item.summary.trim() &&
          (candidate.column_right || "").trim() ===
            (item.column_right || "").trim() &&
          (!candidate.layout || candidate.layout === layout);
        if (unchanged) {
          setRefineCandidate(null);
          setRefineNotice(
            "当前内容已足够精炼，无需改动（可用「自定义」指定改写方向）。"
          );
        } else {
          setRefineCandidate(candidate);
        }
      }
    } finally {
      setRefiningMode(null);
    }
  }

  function fillFromExcerpt(
    targetField: "summary" | "column_right",
    text: string
  ) {
    const cleaned = text.trim();
    if (!cleaned) return;
    const current =
      targetField === "column_right"
        ? (item.column_right || "").trim()
        : item.summary.trim();
    const isDefaultPlaceholder =
      current === "输入本页的核心陈述内容…" || current === "";
    const nextValue = isDefaultPlaceholder ? cleaned : `${current}\n${cleaned}`;
    onUpdateField(targetField, nextValue);
  }

  const innerContent = (
    <>
      {!embedded && (
        <div className="px-5 py-3 border-b border-black/[0.07] flex items-center justify-between sticky top-0 bg-surface-subtle/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <span className="text-[14px] font-semibold text-ink">
              第 {slideIndex + 1} 页
            </span>
            <span className="text-[13px] font-medium text-ink-secondary">
              {isCustomCanvas ? "自由画布" : LAYOUT_LABELS[layout] || "正文"}
            </span>
          </div>
        </div>
      )}

      <div className="p-5 space-y-6 flex-1">
        {/* In-place Slide QA Issues */}
        {slideIssues.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-danger-bg border border-danger/20 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-danger">
                本页排版校验未通过
              </div>
              <button
                type="button"
                disabled={Boolean(refiningMode)}
                onClick={() => void triggerRefine("concise")}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-danger hover:bg-danger-hover text-white text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {refiningMode === "concise" ? "正在精简…" : "AI 精简防超框"}
                </span>
              </button>
            </div>
            {slideIssues.map((iss, i) => (
              <p
                key={i}
                className="text-[13px] text-danger leading-relaxed font-mono break-all"
              >
                {iss.message}
              </p>
            ))}
          </div>
        )}

        {/* TIER 1: Source Provenance & Evidence Bar */}
        <ProvenanceSection
          pid={pid}
          item={item}
          layout={layout}
          isCustomCanvas={isCustomCanvas}
          materials={materials}
          sourceFragments={sourceFragments}
          imageAssetIds={imageAssetIds}
          onToggleSourceId={onToggleSourceId}
          onApplyImageToSlide={onApplyImageToSlide}
          onInspectFragment={onInspectFragment}
          onFillFromExcerpt={fillFromExcerpt}
        />

        {/* TIER 2: Slide Content Editors */}
        {isCustomCanvas ? (
          <CustomCanvasInspector
            item={item}
            primaryInputBase={primaryInputBase}
            onUpdateCustomElementText={onUpdateCustomElementText}
            onUpdateCustomElement={onUpdateCustomElement}
            onSaveCustomLayout={onSaveCustomLayout}
            onClearCustomLayout={onClearCustomLayout}
            onSwitchToChat={onSwitchToChat}
          />
        ) : (
          <StandardSlideEditor
            pid={pid}
            item={item}
            layout={layout}
            imageAssets={imageAssets}
            primaryInputBase={primaryInputBase}
            refiningMode={refiningMode}
            refineCandidate={refineCandidate}
            refineNotice={refineNotice}
            llmConfigured={llmConfigured}
            activeModelLabel={activeModelLabel}
            llmSettings={llmSettings}
            onLLMSettingsUpdated={onLLMSettingsUpdated}
            onOpenLLMSettings={onOpenLLMSettings}
            onUpdateField={onUpdateField}
            onSplitTwoColumn={onSplitTwoColumn}
            onUploadClick={onUploadClick}
            onTriggerRefine={triggerRefine}
            onDismissCandidate={() => setRefineCandidate(null)}
            onApplyCandidate={(cand) => {
              onApplyRefineCandidate(cand);
              setRefineCandidate(null);
            }}
          />
        )}

        {/* Saved Reusable Custom Layouts Library */}
        {savedLayouts.length > 0 && onApplySavedLayout && (
          <section className="pt-3 border-t border-black/[0.07] space-y-2">
            <div className="text-[13px] font-semibold text-ink-secondary">
              已收藏自由版式（点击套用到本页）
            </div>
            <div className="space-y-1.5">
              {savedLayouts.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-surface border border-black/[0.08] hover:border-black/20 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onApplySavedLayout(preset)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="text-[13px] font-medium text-ink truncate">
                      {preset.name}
                    </div>
                    <div className="text-[13px] text-ink-muted">
                      {preset.elements.length} 个原生元素
                    </div>
                  </button>
                  {onDeleteSavedLayout && (
                    <button
                      type="button"
                      onClick={() => void onDeleteSavedLayout(preset.id)}
                      title="删除收藏版式"
                      className="p-1 rounded-lg text-ink-muted hover:text-danger cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* TIER 3: Collapsible Speaker Notes */}
        <section className="pt-3 border-t border-black/[0.07] space-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left group cursor-pointer"
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-[13px] font-semibold text-ink-secondary group-hover:text-ink transition-colors shrink-0">
                演讲者备注
              </span>
              {!notesOpen && item.speaker_notes && (
                <span className="text-[13px] text-ink-muted truncate">
                  {item.speaker_notes}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-ink-muted group-hover:text-ink shrink-0 transition-transform ${
                notesOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          <Collapse open={notesOpen}>
            <div className="pt-0.5">
              <AutoGrowTextarea
                id="input-notes"
                value={item.speaker_notes || ""}
                minRows={3}
                placeholder="写下有实质补充的口播提示，导出时将写入 PowerPoint 备注栏…"
                onChange={(val) => onUpdateField("speaker_notes", val)}
                className="text-[13px] text-ink placeholder:text-ink-muted bg-surface rounded-xl px-3 py-2.5 border border-black/[0.1] hover:border-black/20 focus:border-ink focus:ring-4 focus:ring-black/[0.05] outline-none leading-relaxed transition-[border-color,box-shadow] duration-[160ms]"
              />
            </div>
          </Collapse>
        </section>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto clean-scroll">
        {innerContent}
      </div>
    );
  }

  return (
    <aside className="w-[344px] xl:w-[396px] shrink-0 bg-surface-subtle border-l border-black/[0.08] flex flex-col min-h-0 overflow-y-auto clean-scroll">
      {innerContent}
    </aside>
  );
}
