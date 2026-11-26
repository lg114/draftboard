"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import type { Material, SourceFragment } from "../../../lib/api";
import { cleanMarkdownExcerpt } from "../layoutUtils";

export function formatAssetLabel(assetId: string): string {
  if (assetId.length <= 20) return assetId;
  return `${assetId.slice(0, 10)}…${assetId.slice(-6)}`;
}

export function extractFragmentText(
  frag: SourceFragment,
  materials: Material[]
): string {
  const mat = materials.find(
    (m) => m.asset_id === frag.asset_id && m.asset_type !== "image"
  );
  if (mat && mat.content) {
    const match = /L(\d+)-L(\d+)$/.exec(frag.location);
    if (match) {
      const start = Math.max(0, parseInt(match[1], 10) - 1);
      const end = parseInt(match[2], 10);
      const slice = mat.content
        .split(/\r?\n/)
        .slice(start, end)
        .join("\n")
        .trim();
      if (slice) return cleanMarkdownExcerpt(slice);
    }
    if (frag.content_preview) return cleanMarkdownExcerpt(frag.content_preview);
    const trimmed = mat.content.trim();
    if (trimmed) return cleanMarkdownExcerpt(trimmed.slice(0, 360));
  }
  return cleanMarkdownExcerpt(frag.content_preview || "");
}

export function AutoGrowTextarea({
  id,
  value,
  placeholder,
  minRows = 3,
  onChange,
  className = "",
}: {
  id?: string;
  value: string;
  placeholder?: string;
  minRows?: number;
  onChange: (val: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("field-sizing", "content")
    ) {
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const fieldSizingStyle = {
    fieldSizing: "content",
    height: "auto",
    minBlockSize: `${minRows}lh`,
  } as CSSProperties;

  return (
    <textarea
      ref={ref}
      id={id}
      rows={minRows}
      value={value}
      placeholder={placeholder}
      style={fieldSizingStyle}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full overflow-hidden resize-none ${className}`}
    />
  );
}
