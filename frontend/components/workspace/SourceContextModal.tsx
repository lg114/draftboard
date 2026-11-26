"use client";

import { useEffect, useRef } from "react";
import { FileText, X } from "lucide-react";
import type { Material, SourceFragment } from "../../lib/api";
import { useModalDialog } from "../../lib/useModalDialog";
import { formatFragmentLocation } from "./layoutUtils";

interface SourceContextModalProps {
  fragment: SourceFragment | null;
  materials: Material[];
  onClose: () => void;
}

function parseLineRange(
  location: string
): { start: number; end: number } | null {
  const m = /L(\d+)-L(\d+)/.exec(location);
  if (!m) return null;
  return {
    start: Math.max(1, parseInt(m[1], 10)),
    end: Math.max(1, parseInt(m[2], 10)),
  };
}

/**
 * Full-document provenance reader with cited line range highlighted & auto-scrolled.
 */
export function SourceContextModal({
  fragment,
  materials,
  onClose,
}: SourceContextModalProps) {
  const open = Boolean(fragment);
  const { dialogRef, handleDialogClose } = useModalDialog(open, onClose);
  const firstHighlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fragment) return;
    const t = setTimeout(() => {
      firstHighlightRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 60);
    return () => clearTimeout(t);
  }, [fragment]);

  const mat = fragment
    ? materials.find(
        (m) => m.asset_id === fragment.asset_id && m.asset_type !== "image"
      )
    : undefined;
  const fullText = mat?.content || fragment?.content_preview || "";
  const lines = fullText.split(/\r?\n/);
  const range = fragment ? parseLineRange(fragment.location) : null;
  const previewNeedle = (fragment?.content_preview || "").trim().slice(0, 24);

  let firstHitLine = -1;
  const isHighlighted = (lineNo: number, text: string): boolean => {
    if (range) {
      return lineNo >= range.start && lineNo <= range.end;
    }
    if (previewNeedle && text.includes(previewNeedle)) {
      return true;
    }
    return false;
  };

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby="source-context-title"
      onClose={handleDialogClose}
      className="ui-modal-dialog w-[min(740px,calc(100dvw-2rem))] max-h-[82dvh] rounded-2xl bg-ui-surface ring-1 ring-ui-border-subtle shadow-[0_24px_72px_rgba(0,0,0,0.72)] overflow-clip anim-modal-in"
    >
      {fragment && (
        <div className="w-full flex flex-col min-h-0 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3 shrink-0">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-ui-bg flex items-center justify-center shrink-0 mt-0.5">
                <FileText className="w-3.5 h-3.5 text-ui-icon" />
              </div>
              <div className="min-w-0">
                <h1
                  id="source-context-title"
                  className="text-[15px] font-semibold tracking-[-0.015em] text-ui-text truncate"
                >
                  {fragment.asset_id}
                </h1>
                <p className="text-[12.5px] text-ui-text-muted mt-0.5">
                  引用位置：{formatFragmentLocation(fragment.location)}（高亮行即本页来源）
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭原文视图"
              title="关闭 (Esc)"
              className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto clean-scroll px-5 pb-5">
            <div className="rounded-xl bg-ui-bg py-2 overflow-hidden font-mono text-[13px] leading-relaxed">
              {lines.map((ln, i) => {
                const lineNo = i + 1;
                const hit = isHighlighted(lineNo, ln);
                let attachRef = false;
                if (hit && firstHitLine === -1) {
                  firstHitLine = lineNo;
                  attachRef = true;
                }
                return (
                  <div
                    key={lineNo}
                    ref={attachRef ? firstHighlightRef : undefined}
                    className={`flex items-start gap-3 px-3.5 py-1 ${
                      hit
                        ? "bg-ui-warning-bg border-l-[3px] border-l-ui-warning text-ui-text"
                        : "text-ui-text-secondary"
                    }`}
                  >
                    <span className="w-8 text-right text-ui-text-disabled select-none shrink-0 tabular-nums text-[12px] pt-0.5">
                      {lineNo}
                    </span>
                    <span className="whitespace-pre-wrap break-words flex-1 min-w-0 font-sans">
                      {ln || "\u00A0"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
