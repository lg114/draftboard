"use client";

import { useState } from "react";
import { ChevronDown, Palette, Sparkles, Trash2 } from "lucide-react";
import type {
  CanvasElement,
  Issue,
  Material,
  OutlineItem,
  OutlineLayout,
  SavedLayoutPreset,
  SourceFragment,
  ThemeOption,
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
  LAYOUT_OPTIONS,
} from "./layoutUtils";
import { LayoutIcon } from "./stage/LayoutIcon";

export { extractFragmentText, formatAssetLabel };

interface SlideInspectorProps {
  pid: string;
  item: OutlineItem;
  slideIndex: number;
  totalSlides: number;
  materials: Material[];
  sourceFragments: SourceFragment[];
  slideIssues: Issue[];
  activeTheme?: ThemeOption;
  onSelectLayout?: (layout: OutlineLayout) => void;
  onOpenThemeModal?: () => void;
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
  onUploadClick: () => void;
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
  activeTheme,
  onSelectLayout,
  onOpenThemeModal,
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
  onUploadClick,
  embedded = false,
}: SlideInspectorProps) {
  const [notesOpen, setNotesOpen] = useState(true);

  const layout = inferEffectiveLayout(item.layout, slideIndex, totalSlides);
  const isCustomCanvas = Boolean(
    item.custom_elements && item.custom_elements.length > 0
  );
  const imageAssets = materials.filter((m) => m.asset_type === "image");
  const imageAssetIds = new Set(imageAssets.map((m) => m.asset_id));

  const primaryInputBase =
    "ui-field text-[13.5px] px-3 py-2 leading-relaxed";

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
        <div className="px-4 py-2.5 flex items-center justify-between sticky top-0 bg-ui-bg z-10">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[13.5px] font-semibold text-ui-text">
              第 {slideIndex + 1} 页
            </span>
            <span className="text-[12.5px] text-ui-text-muted">
              {isCustomCanvas ? "自由画布" : LAYOUT_LABELS[layout] || "正文"}
            </span>
          </div>
        </div>
      )}

      <div className="p-4 space-y-5 flex-1">
        {/* Compact Layout & Theme Controls (moved cleanly from removed bottom dock) */}
        {(onSelectLayout || onOpenThemeModal) && (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="font-medium text-ui-text-muted">
                页面版式与样式
              </span>
              {activeTheme && onOpenThemeModal && (
                <button
                  type="button"
                  onClick={onOpenThemeModal}
                  className="inline-flex items-center gap-1.5 text-ui-text-secondary hover:text-ui-text cursor-pointer transition-colors"
                  title="切换演示文稿主题与品牌定制"
                >
                  <span
                    className="w-3 h-3 rounded-full ring-1 ring-white/20 shrink-0"
                    style={{
                      background: `radial-gradient(circle at 35% 35%, ${activeTheme.swatches.bg} 45%, ${activeTheme.swatches.cover_bg} 100%)`,
                    }}
                  />
                  <span>{activeTheme.name}</span>
                  <Palette className="w-3 h-3 text-ui-icon" />
                </button>
              )}
            </div>

            {onSelectLayout && (
              <div className="grid grid-cols-3 gap-1.5">
                {LAYOUT_OPTIONS.map((opt) => {
                  const active = !isCustomCanvas && layout === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onSelectLayout(opt.value)}
                      title={
                        isCustomCanvas
                          ? `切换回「${opt.label}」标准版式（退出自由画布，可撤销）`
                          : opt.label
                      }
                      className={`px-2 py-1.5 rounded-lg text-[12.5px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        active
                          ? "bg-ui-bg-selected ring-1 ring-ui-accent text-ui-text font-medium"
                          : "bg-ui-surface-input text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover"
                      }`}
                    >
                      <LayoutIcon layout={opt.value} />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* In-place Slide QA Issues */}
        {slideIssues.length > 0 && (
          <div className="p-3 rounded-xl bg-ui-danger-bg border border-ui-danger/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-ui-danger">
                本页排版校验未通过
              </div>
              {onSwitchToChat && (
                <button
                  type="button"
                  onClick={onSwitchToChat}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-ui-danger text-ui-bg text-[12.5px] font-medium hover:brightness-110 transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>让 AI 调整</span>
                </button>
              )}
            </div>
            {slideIssues.map((iss, i) => (
              <p
                key={i}
                className="text-[12.5px] text-ui-danger/90 leading-relaxed font-mono break-all"
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
            onUpdateField={onUpdateField}
            onSplitTwoColumn={onSplitTwoColumn}
            onUploadClick={onUploadClick}
          />
        )}

        {/* Saved Reusable Custom Layouts Library */}
        {savedLayouts.length > 0 && onApplySavedLayout && (
          <section className="space-y-2">
            <div className="text-[12.5px] font-medium text-ui-text-muted">
              已收藏自由版式（点击套用）
            </div>
            <div className="space-y-1.5">
              {savedLayouts.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-ui-surface-input hover:bg-ui-control-hover transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onApplySavedLayout(preset)}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="text-[13px] font-medium text-ui-text truncate">
                      {preset.name}
                    </div>
                    <div className="text-[12px] text-ui-text-muted">
                      {preset.elements.length} 个原生元素
                    </div>
                  </button>
                  {onDeleteSavedLayout && (
                    <button
                      type="button"
                      onClick={() => void onDeleteSavedLayout(preset.id)}
                      title="删除收藏版式"
                      className="p-1 rounded-md text-ui-icon hover:text-ui-danger cursor-pointer shrink-0"
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
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left group cursor-pointer"
          >
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-[12.5px] font-medium text-ui-text-muted group-hover:text-ui-text transition-colors shrink-0">
                演讲者备注
              </span>
              {!notesOpen && item.speaker_notes && (
                <span className="text-[12.5px] text-ui-text-disabled truncate">
                  {item.speaker_notes}
                </span>
              )}
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 text-ui-icon group-hover:text-ui-text shrink-0 transition-transform ${
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
                placeholder="写下口播提示，导出时将写入 PowerPoint 备注栏…"
                onChange={(val) => onUpdateField("speaker_notes", val)}
                className="ui-field text-[13px] px-3 py-2 leading-relaxed"
              />
            </div>
          </Collapse>
        </section>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto clean-scroll bg-ui-bg">
        {innerContent}
      </div>
    );
  }

  return (
    <aside className="w-[320px] xl:w-[356px] shrink-0 bg-ui-bg flex flex-col min-h-0 overflow-y-auto clean-scroll">
      {innerContent}
    </aside>
  );
}
