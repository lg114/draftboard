"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasElement, ThemeOption, ThemeSwatches } from "../../lib/api";
import { normalizeEscapedNewlines } from "./layoutUtils";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Resolve a semantic theme token (`theme:*`), `transparent`/`none`, or `#RRGGBB`
 * against the active ThemeOption swatches — mirrors `resolve_canvas_hex` in
 * `backend/src/draftboard/pptx_export.py` so Web, PPTX, and PDF stay in lockstep.
 */
export function resolveCanvasColor(
  spec: string | null | undefined,
  sw: ThemeSwatches,
  fallback: string | null
): string | null {
  if (!spec || !spec.trim()) return fallback;
  const s = spec.trim();
  const low = s.toLowerCase();
  if (low === "transparent" || low === "none") return null;

  const tokenMap: Record<string, string> = {
    "theme:bg": sw.bg,
    "theme:cover_bg": sw.cover_bg,
    "theme:surface": sw.surface,
    "theme:title": sw.title,
    "theme:cover_title": sw.cover_title,
    "theme:body": sw.body,
    "theme:cover_body": sw.cover_body,
    "theme:accent": sw.accent,
    "theme:muted": sw.muted,
    "theme:divider": sw.divider,
  };
  if (low in tokenMap) return tokenMap[low];
  if (HEX_COLOR_RE.test(s)) return s;
  return fallback;
}

interface CustomSlideLayerProps {
  pid: string;
  customBg?: string | null;
  elements: CanvasElement[];
  theme: ThemeOption;
  scale: number;
  interactive?: boolean;
  onSelectTextElement?: (elementId: string) => void;
}

/**
 * Pure 960x540 proportional renderer for freeform custom canvas slides.
 * Uses identical box coordinates, padding (`2px 4px`), line heights, and Z-order
 * as `backend/src/draftboard/pptx_export.py`.
 */
export function CustomSlideLayer({
  pid,
  customBg,
  elements,
  theme,
  scale,
  interactive = false,
  onSelectTextElement,
}: CustomSlideLayerProps) {
  const sw = theme.swatches;
  const bg = resolveCanvasColor(customBg, sw, sw.bg) || sw.bg;

  return (
    <div
      className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 transition-colors duration-200 select-none"
      style={{
        transform: `scale(${scale})`,
        backgroundColor: bg,
      }}
    >
      {elements.map((el, idx) => {
        const key = `${el.id || "el"}-${idx}`;

        if (el.kind === "card") {
          const radius = el.radius ?? 12;
          const fill = resolveCanvasColor(el.fill, sw, sw.surface);
          const borderColor = el.border_color
            ? resolveCanvasColor(el.border_color, sw, sw.divider)
            : null;
          const bw = el.border_width ?? (borderColor ? 1 : 0);

          return (
            <div
              key={key}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                borderRadius: radius,
                backgroundColor: fill ?? "transparent",
                border:
                  borderColor && bw > 0 ? `${bw}px solid ${borderColor}` : "none",
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
          );
        }

        if (el.kind === "line") {
          const lineCol =
            resolveCanvasColor(el.color, sw, sw.divider) || sw.divider;
          const lw = el.line_width ?? 1.5;

          return (
            <svg
              key={key}
              width={960}
              height={540}
              viewBox="0 0 960 540"
              style={{
                position: "absolute",
                inset: 0,
                width: 960,
                height: 540,
                pointerEvents: "none",
                overflow: "visible",
              }}
            >
              <line
                x1={el.x}
                y1={el.y}
                x2={el.x + el.w}
                y2={el.y + el.h}
                stroke={lineCol}
                strokeWidth={lw}
                strokeLinecap="round"
              />
            </svg>
          );
        }

        if (el.kind === "image") {
          const assetId = (el.image_asset_id || "").trim();
          const radius = el.radius ?? 0;

          return (
            <div
              key={key}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                borderRadius: radius,
                overflow: "hidden",
                backgroundColor: assetId ? "transparent" : sw.surface,
                pointerEvents: "none",
              }}
            >
              {assetId ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/projects/${encodeURIComponent(
                    pid
                  )}/assets/${encodeURIComponent(assetId)}`}
                  alt={assetId}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: el.fit === "cover" ? "cover" : "contain",
                    display: "block",
                  }}
                />
              ) : null}
            </div>
          );
        }

        // Text element (matches CUSTOM_PAD_X_PT=4, CUSTOM_PAD_Y_PT=2 in pptx_export.py)
        const fontSize = Math.round(el.font_size ?? 18);
        const lineHeight = Math.round(el.line_height ?? fontSize * 1.35);
        const color = resolveCanvasColor(el.color, sw, sw.body) || sw.body;
        const canClick = interactive && Boolean(onSelectTextElement);

        return (
          <div
            key={key}
            onClick={
              canClick ? () => onSelectTextElement?.(el.id) : undefined
            }
            className={canClick ? "clickable-slot" : undefined}
            style={{
              position: "absolute",
              left: el.x,
              top: el.y,
              width: el.w,
              height: el.h,
              padding: "2px 4px",
              boxSizing: "border-box",
              fontSize,
              lineHeight: `${lineHeight}px`,
              fontWeight: el.bold ? 700 : 400,
              letterSpacing: fontSize >= 28 ? "-0.02em" : undefined,
              color,
              textAlign: el.align ?? "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "hidden",
              pointerEvents: canClick ? "auto" : "none",
            }}
          >
            {normalizeEscapedNewlines(el.text || "")}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Self-measuring miniature container for SlideNavigator thumbnails & homepage cards.
 */
export function AutoScaledCustomSlide({
  pid,
  customBg,
  elements,
  theme,
}: {
  pid: string;
  customBg?: string | null;
  elements: CanvasElement[];
  theme: ThemeOption;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const update = () => {
      if (hostRef.current) {
        const w = hostRef.current.clientWidth;
        if (w > 0) setScale(w / 960);
      }
    };
    update();
    const obs = new ResizeObserver(update);
    if (hostRef.current) obs.observe(hostRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="w-full h-full relative overflow-hidden"
    >
      <CustomSlideLayer
        pid={pid}
        customBg={customBg}
        elements={elements}
        theme={theme}
        scale={scale}
        interactive={false}
      />
    </div>
  );
}
