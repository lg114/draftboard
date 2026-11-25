"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  FileText,
  Image as ImageIcon,
  Link2,
  X,
} from "lucide-react";
import type {
  Material,
  OutlineItem,
  OutlineLayout,
  SourceFragment,
} from "../../../lib/api";
import { Collapse } from "../../ui/Collapse";
import {
  formatFragmentLocation,
  getExcerptTargetLabel,
} from "../layoutUtils";
import { extractFragmentText, formatAssetLabel } from "./inspectorUtils";

interface ProvenanceSectionProps {
  pid: string;
  item: OutlineItem;
  layout: OutlineLayout;
  isCustomCanvas: boolean;
  materials: Material[];
  sourceFragments: SourceFragment[];
  imageAssetIds: Set<string>;
  onToggleSourceId: (sourceId: string) => void;
  onApplyImageToSlide: (imageAssetId: string, sourceId?: string) => void;
  onInspectFragment?: (frag: SourceFragment) => void;
  onFillFromExcerpt: (
    targetField: "summary" | "column_right",
    text: string
  ) => void;
}

export function ProvenanceSection({
  pid,
  item,
  layout,
  isCustomCanvas,
  materials,
  sourceFragments,
  imageAssetIds,
  onToggleSourceId,
  onApplyImageToSlide,
  onInspectFragment,
  onFillFromExcerpt,
}: ProvenanceSectionProps) {
  const [provenanceOpen, setProvenanceOpen] = useState(true);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);

  useEffect(() => {
    setSourcePickerOpen(false);
  }, [item.outline_item_id]);

  const matchedFragments = item.source_ids
    .map((sid) => sourceFragments.find((f) => f.source_id === sid))
    .filter((f): f is SourceFragment => Boolean(f));
  const boundAssetCount = new Set(matchedFragments.map((f) => f.asset_id)).size;

  const isImageFragment = (frag: SourceFragment) =>
    frag.source_id.endsWith("-img") || imageAssetIds.has(frag.asset_id);

  const isSupported =
    item.evidence_status === "supported" && item.source_ids.length > 0;
  const isPartial =
    item.evidence_status === "partial" && item.source_ids.length > 0;

  return (
    <section
      className={`rounded-xl border overflow-hidden transition-colors ${
        isSupported
          ? "bg-ui-surface border-ui-border-subtle"
          : "bg-ui-warning-bg border-ui-warning/30"
      }`}
    >
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setProvenanceOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isSupported ? "bg-ui-success" : "bg-ui-warning"
            }`}
          />
          <span className="flex items-center gap-2 text-[12.5px] min-w-0 truncate">
            <span
              className={`font-medium ${
                isSupported ? "text-ui-text" : "text-ui-warning"
              }`}
            >
              {isSupported
                ? "依据充分"
                : isPartial
                ? "部分依据"
                : "待补素材出处"}
            </span>
            {(isSupported || isPartial) && (
              <span className="text-ui-text-muted">
                {boundAssetCount} 份材料
              </span>
            )}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-ui-icon shrink-0 transition-transform ${
              provenanceOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => {
            setProvenanceOpen(true);
            setSourcePickerOpen((v) => !v);
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-ui-surface-input hover:bg-ui-control-hover border border-ui-border-subtle text-[12px] font-medium text-ui-text-secondary hover:text-ui-text cursor-pointer transition-colors shrink-0"
        >
          <Link2 className="w-3 h-3" />
          <span>{sourcePickerOpen ? "收起" : "关联材料"}</span>
        </button>
      </div>

      <Collapse open={provenanceOpen}>
        <div className="px-3 pb-3 pt-2 border-t border-ui-border-subtle space-y-2">
          {/* Inline Source Binding Picker */}
          <Collapse open={sourcePickerOpen}>
            <div className="p-2.5 rounded-lg bg-ui-bg border border-ui-border-subtle space-y-2">
              <div className="flex items-center justify-between text-[12px] text-ui-text-muted">
                <span>勾选本页引用的原始切片</span>
                <button
                  type="button"
                  onClick={() => setSourcePickerOpen(false)}
                  className="text-ui-accent-text font-medium hover:underline cursor-pointer"
                >
                  完成
                </button>
              </div>

              {sourceFragments.length > 0 ? (
                <div className="space-y-1.5 max-h-[190px] overflow-y-auto clean-scroll pr-0.5">
                  {sourceFragments.map((frag) => {
                    const bound = item.source_ids.includes(frag.source_id);
                    const isImg = isImageFragment(frag);
                    const excerpt = isImg
                      ? ""
                      : extractFragmentText(frag, materials);

                    return (
                      <button
                        key={frag.source_id}
                        type="button"
                        onClick={() => onToggleSourceId(frag.source_id)}
                        className={`w-full text-left p-2 rounded-lg transition-all flex items-start gap-2 cursor-pointer border ${
                          bound
                            ? "bg-ui-bg-selected border-ui-accent"
                            : "bg-ui-surface-input hover:bg-ui-control-hover border-ui-border-subtle"
                        }`}
                      >
                        <div
                          className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                            bound
                              ? "bg-ui-accent text-ui-on-accent"
                              : "border border-ui-border bg-ui-bg"
                          }`}
                        >
                          {bound && <Check className="w-3 h-3 stroke-[2.5]" />}
                        </div>

                        {isImg ? (
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-9 h-6 rounded bg-ui-bg overflow-hidden shrink-0 flex items-center justify-center border border-ui-border-subtle">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/projects/${pid}/assets/${encodeURIComponent(
                                  frag.asset_id
                                )}`}
                                alt={frag.asset_id}
                                className="w-full h-full object-contain"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div
                                className="text-[12.5px] font-medium text-ui-text truncate"
                                title={frag.asset_id}
                              >
                                {formatAssetLabel(frag.asset_id)}
                              </div>
                              <div className="text-[11.5px] text-ui-text-muted">
                                图片素材
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center justify-between gap-2 text-[12.5px]">
                              <span
                                className="font-medium text-ui-text truncate"
                                title={frag.asset_id}
                              >
                                {formatAssetLabel(frag.asset_id)}
                              </span>
                              <span className="text-[11.5px] text-ui-text-muted shrink-0">
                                {formatFragmentLocation(frag.location)}
                              </span>
                            </div>
                            <p className="text-[12px] text-ui-text-muted line-clamp-2 leading-snug">
                              {excerpt || "文本切片"}
                            </p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[12.5px] text-ui-text-muted py-2 text-center">
                  项目暂无材料切片，请先在左栏「材料」导入。
                </div>
              )}
            </div>
          </Collapse>

          {/* Bound Provenance Excerpts */}
          {matchedFragments.length > 0 ? (
            <div className="space-y-2 max-h-[220px] overflow-y-auto clean-scroll pr-0.5">
              {matchedFragments.map((frag) => {
                const isImg = isImageFragment(frag);
                const excerpt = isImg
                  ? ""
                  : extractFragmentText(frag, materials);
                const isCurrentSlideImage =
                  layout === "text_image" &&
                  item.image_asset_id === frag.asset_id;

                if (isImg) {
                  return (
                    <div
                      key={frag.source_id}
                      className="p-2.5 rounded-lg bg-ui-surface-input border border-ui-border-subtle space-y-2 group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ImageIcon className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                          <span
                            className="text-[12.5px] font-medium text-ui-text truncate"
                            title={frag.asset_id}
                          >
                            {formatAssetLabel(frag.asset_id)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleSourceId(frag.source_id)}
                          title="解除关联"
                          className="text-ui-icon-quiet hover:text-ui-danger p-0.5 rounded opacity-65 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="w-14 h-9 rounded bg-ui-bg border border-ui-border-subtle overflow-hidden flex items-center justify-center shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/projects/${pid}/assets/${encodeURIComponent(
                              frag.asset_id
                            )}`}
                            alt={frag.asset_id}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          {isCurrentSlideImage ? (
                            <span className="text-[12.5px] font-medium text-ui-success flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" />
                              <span>已设为本页配图</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                onApplyImageToSlide(
                                  frag.asset_id,
                                  frag.source_id
                                )
                              }
                              className="text-[12.5px] font-medium text-ui-accent-text hover:underline cursor-pointer"
                            >
                              设为本页配图
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={frag.source_id}
                    className="p-2.5 rounded-lg bg-ui-surface-input border border-ui-border-subtle space-y-1.5 group"
                  >
                    <div className="flex items-center justify-between gap-2 text-[12.5px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                        <span
                          className="font-medium text-ui-text truncate"
                          title={frag.asset_id}
                        >
                          {formatAssetLabel(frag.asset_id)}
                        </span>
                        <span className="text-ui-text-muted shrink-0">
                          {formatFragmentLocation(frag.location)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleSourceId(frag.source_id)}
                        title="解除关联"
                        className="text-ui-icon-quiet hover:text-ui-danger p-0.5 rounded opacity-65 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <p className="text-[12.5px] text-ui-text-muted leading-relaxed whitespace-pre-wrap line-clamp-3">
                      {excerpt || "（该文本切片为空）"}
                    </p>

                    {excerpt && (
                      <div className="flex flex-wrap items-center gap-3 pt-1.5 border-t border-ui-border-subtle text-[12.5px]">
                        {onInspectFragment && (
                          <button
                            type="button"
                            onClick={() => onInspectFragment(frag)}
                            className="inline-flex items-center gap-1 text-ui-accent-text font-medium hover:underline cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>查看原文</span>
                          </button>
                        )}
                        {!isCustomCanvas && (
                          <button
                            type="button"
                            onClick={() =>
                              onFillFromExcerpt("summary", excerpt)
                            }
                            className="text-ui-text-secondary hover:text-ui-text font-medium hover:underline cursor-pointer"
                          >
                            填入{getExcerptTargetLabel(layout)}
                          </button>
                        )}
                        {!isCustomCanvas && layout === "two_column" && (
                          <button
                            type="button"
                            onClick={() =>
                              onFillFromExcerpt("column_right", excerpt)
                            }
                            className="text-ui-text-secondary hover:text-ui-text font-medium hover:underline cursor-pointer"
                          >
                            填入右栏
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 pt-0.5">
              <p className="text-[12.5px] text-ui-text-secondary leading-relaxed">
                {item.source_ids.length > 0
                  ? "未检索到对应材料切片，可重新选择关联。"
                  : "关联原始材料切片或配图后，随时对照原文并标记为「依据充分」。"}
              </p>
              {sourceFragments.length > 0 && !sourcePickerOpen && (
                <button
                  type="button"
                  onClick={() => setSourcePickerOpen(true)}
                  className="ui-btn-subtle px-2.5 py-1 text-[12.5px]"
                >
                  选择关联材料
                </button>
              )}
            </div>
          )}
        </div>
      </Collapse>
    </section>
  );
}
