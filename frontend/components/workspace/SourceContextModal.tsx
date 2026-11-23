"use client";

import { useEffect, useRef } from "react";
import { FileText, X } from "lucide-react";
import type { Material, SourceFragment } from "../../lib/api";
import { formatFragmentLocation } from "./layoutUtils";

interface SourceContextModalProps {
  fragment: SourceFragment | null;
  materials: Material[];
  onClose: () => void;
}

function parseLineRange(location: string): { start: number; end: number } | null {
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
  const firstHighlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fragment) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      firstHighlightRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [fragment, onClose]);

  if (!fragment) return null;

  const mat = materials.find(
    (m) => m.asset_id === fragment.asset_id && m.asset_type !== "image"
  );
  const fullText = mat?.content || fragment.content_preview || "";
  const lines = fullText.split(/\r?\n/);
  const range = parseLineRange(fragment.location);
  const previewNeedle = (fragment.content_preview || "").trim().slice(0, 24);

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="原文溯源上下文"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4 sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[82vh] bg-surface rounded-2xl border border-black/[0.1] shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-black/[0.08] flex items-center justify-between gap-3 shrink-0 bg-surface-subtle">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="w-4 h-4 text-ink shrink-0" />
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold text-ink truncate">
                {fragment.asset_id}
              </div>
              <div className="text-[13px] text-ink-secondary">
                引用位置：{formatFragmentLocation(fragment.location)}（高亮区域为本页溯源依据）
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭原文视图"
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.06] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto clean-scroll p-4 bg-canvas">
          <div className="bg-surface rounded-xl border border-black/[0.08] overflow-hidden divide-y divide-black/[0.03] font-mono text-[13px] leading-relaxed">
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
                      ? "bg-warning-bg border-l-[3px] border-l-warning-dot text-ink font-medium"
                      : "text-ink-secondary"
                  }`}
                >
                  <span className="w-9 text-right text-ink-muted select-none shrink-0 tabular-nums">
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
    </div>
  );
}
