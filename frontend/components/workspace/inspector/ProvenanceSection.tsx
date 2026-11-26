"use client";

import { Eye, FileText, Image as ImageIcon } from "lucide-react";
import type { OutlineItem, SourceFragment } from "../../../lib/api";
import { formatFragmentLocation } from "../layoutUtils";
import { formatAssetLabel } from "./inspectorUtils";

interface ProvenanceSectionProps {
  item: OutlineItem;
  sourceFragments: SourceFragment[];
  imageAssetIds: Set<string>;
  onInspectFragment?: (frag: SourceFragment) => void;
}

export function ProvenanceSection({
  item,
  sourceFragments,
  imageAssetIds,
  onInspectFragment,
}: ProvenanceSectionProps) {
  const matchedFragments = item.source_ids
    .map((sid) => sourceFragments.find((f) => f.source_id === sid))
    .filter((f): f is SourceFragment => Boolean(f));

  if (matchedFragments.length === 0) return null;

  const isImageFragment = (frag: SourceFragment) =>
    frag.source_id.endsWith("-img") || imageAssetIds.has(frag.asset_id);

  return (
    <section className="space-y-1.5">
      <div className="text-[12px] font-medium text-ui-text-muted">
        参考来源
      </div>
      <div className="space-y-1">
        {matchedFragments.map((frag) => {
          const isImg = isImageFragment(frag);
          const location = isImg ? "图片" : formatFragmentLocation(frag.location);
          const clickable = Boolean(onInspectFragment && !isImg);

          if (clickable && onInspectFragment) {
            return (
              <button
                key={frag.source_id}
                type="button"
                onClick={() => onInspectFragment(frag)}
                title="点击查看原始出处"
                className="w-full text-left px-2.5 py-1.5 rounded-lg bg-ui-surface hover:bg-ui-control-hover transition-colors flex items-center justify-between gap-2 group cursor-pointer"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                  <span className="text-[12.5px] text-ui-text-secondary group-hover:text-ui-text truncate">
                    {formatAssetLabel(frag.asset_id)}
                  </span>
                  {location && (
                    <span className="text-[11.5px] text-ui-text-muted shrink-0">
                      {location}
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 text-[11.5px] text-ui-text-muted group-hover:text-ui-accent-text shrink-0 transition-colors">
                  <Eye className="w-3 h-3" />
                  <span>原文</span>
                </span>
              </button>
            );
          }

          return (
            <div
              key={frag.source_id}
              className="px-2.5 py-1.5 rounded-lg bg-ui-surface flex items-center gap-2 min-w-0"
            >
              {isImg ? (
                <ImageIcon className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              )}
              <span className="text-[12.5px] text-ui-text-secondary truncate">
                {formatAssetLabel(frag.asset_id)}
              </span>
              {location && (
                <span className="text-[11.5px] text-ui-text-muted shrink-0 ml-auto">
                  {location}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
