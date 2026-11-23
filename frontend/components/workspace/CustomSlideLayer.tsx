"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasElement, ThemeOption, ThemeSwatches } from "../../lib/api";
import { normalizeEscapedNewlines } from "./layoutUtils";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const NUMERIC_CELL_RE = /^[+\-¥$€£]?\d[\d,.]*\s*[%倍×xX亿万kKmMbBms]*$/;

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

function fmtChartNum(val: number, suffix = ""): string {
  if (!Number.isFinite(val)) return `0${suffix}`;
  let s: string;
  if (Math.abs(val - Math.round(val)) < 1e-6) {
    s = String(Math.round(val));
  } else if (Math.abs(val) >= 100) {
    s = val.toFixed(1).replace(/\.0$/, "");
  } else {
    s = val.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
  return `${s}${suffix}`;
}

function CustomTableView({
  el,
  sw,
  slideBg,
}: {
  el: CanvasElement;
  sw: ThemeSwatches;
  slideBg: string;
}) {
  const headers = el.headers || [];
  const rows = el.rows || [];
  const colCount =
    headers.length > 0
      ? headers.length
      : rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (colCount === 0) return null;

  const fontSize = Math.round(el.table_font_size ?? 14);
  const headerFill = resolveCanvasColor(el.header_fill, sw, sw.surface) || sw.surface;
  const headerCol = resolveCanvasColor(el.header_color, sw, sw.title) || sw.title;
  const cellCol = resolveCanvasColor(el.cell_color, sw, sw.body) || sw.body;
  const stripeFill = resolveCanvasColor(el.stripe_fill, sw, sw.surface);

  return (
    <table
      style={{
        width: "100%",
        height: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontSize,
        lineHeight: 1.25,
      }}
    >
      {headers.length > 0 && (
        <thead>
          <tr>
            {Array.from({ length: colCount }).map((_, ci) => {
              const raw = String(headers[ci] ?? "").trim();
              return (
                <th
                  key={ci}
                  style={{
                    backgroundColor: headerFill,
                    color: headerCol,
                    fontWeight: 700,
                    textAlign: "left",
                    padding: "4px 8px",
                    borderTop: `1px solid ${sw.divider}`,
                    borderBottom: `1.5px solid ${sw.divider}`,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {raw}
                </th>
              );
            })}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((row, ri) => {
          const rowBg = ri % 2 === 1 && stripeFill ? stripeFill : slideBg;
          return (
            <tr key={ri}>
              {Array.from({ length: colCount }).map((_, ci) => {
                const val = String(row[ci] ?? "").trim();
                const isNumeric = ci > 0 && NUMERIC_CELL_RE.test(val);
                return (
                  <td
                    key={ci}
                    style={{
                      backgroundColor: rowBg,
                      color: cellCol,
                      fontWeight: ci === 0 && colCount >= 2 ? 700 : 400,
                      textAlign: isNumeric ? "right" : "left",
                      padding: "4px 8px",
                      borderBottom: `1px solid ${sw.divider}`,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: isNumeric ? "tabular-nums" : undefined,
                    }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function donutArcPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startDeg: number,
  sweepDeg: number
): string {
  const clamped = Math.min(359.8, Math.max(0.1, sweepDeg));
  const rad = (d: number) => (d * Math.PI) / 180;
  const a0 = rad(startDeg);
  const a1 = rad(startDeg + clamped);
  const large = clamped > 180 ? 1 : 0;

  const ox0 = cx + outerR * Math.cos(a0);
  const oy0 = cy + outerR * Math.sin(a0);
  const ox1 = cx + outerR * Math.cos(a1);
  const oy1 = cy + outerR * Math.sin(a1);

  if (innerR <= 1) {
    return `M ${cx} ${cy} L ${ox0} ${oy0} A ${outerR} ${outerR} 0 ${large} 1 ${ox1} ${oy1} Z`;
  }
  const ix1 = cx + innerR * Math.cos(a1);
  const iy1 = cy + innerR * Math.sin(a1);
  const ix0 = cx + innerR * Math.cos(a0);
  const iy0 = cy + innerR * Math.sin(a0);
  return [
    `M ${ox0} ${oy0}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${ox1} ${oy1}`,
    `L ${ix1} ${iy1}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${ix0} ${iy0}`,
    "Z",
  ].join(" ");
}

function CustomChartView({
  el,
  theme,
}: {
  el: CanvasElement;
  theme: ThemeOption;
}) {
  const sw = theme.swatches;
  const palette =
    theme.chart_palette && theme.chart_palette.length > 0
      ? theme.chart_palette
      : [sw.accent, sw.title, sw.muted, sw.body, sw.divider];

  const cats = el.chart_categories || [];
  const rawSeries = el.chart_series || [];
  if (cats.length === 0 || rawSeries.length === 0) return null;

  const chartType = el.chart_type || "bar";
  const series = chartType === "donut" ? rawSeries.slice(0, 1) : rawSeries;
  const showValues = el.show_values !== false;
  const suffix = (el.value_suffix || "").trim();
  const title = (el.chart_title || "").trim();
  const bw = Math.max(100, el.w);
  const bh = Math.max(80, el.h);

  const topPad = title ? 26 : 10;
  const showLegend = series.length > 1 || chartType === "donut";
  const botLegendH = showLegend ? 22 : 4;

  const seriesColors = series.map((s, si) => {
    const fb = palette[si % palette.length];
    return resolveCanvasColor(s.color, sw, fb) || fb;
  });

  const renderLegend = (items: Array<{ label: string; color: string }>) => {
    const approxWidths = items.map((it) => 16 + it.label.length * 8.5);
    const gap = 14;
    const totalW =
      approxWidths.reduce((a, b) => a + b, 0) + gap * Math.max(0, items.length - 1);
    let cx = Math.max(6, (bw - totalW) / 2);
    const ly = bh - 12;
    return (
      <g>
        {items.map((it, idx) => {
          const x = cx;
          cx += approxWidths[idx] + gap;
          return (
            <g key={idx}>
              <rect
                x={x}
                y={ly - 4}
                width={8}
                height={8}
                rx={2}
                fill={it.color}
              />
              <text
                x={x + 11}
                y={ly + 3.5}
                fill={sw.muted}
                fontSize={10}
                fontWeight={500}
              >
                {it.label}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  if (chartType === "donut") {
    const vals = series[0].values.map((v) => Math.max(0, Number(v) || 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const areaH = Math.max(40, bh - topPad - botLegendH - 8);
    const outerR = Math.min(bw * 0.36, areaH * 0.46);
    const innerR = outerR * 0.56;
    const cx = bw * 0.5;
    const cy = topPad + areaH * 0.5;
    let curAngle = -90;

    return (
      <svg width={bw} height={bh} viewBox={`0 0 ${bw} ${bh}`} style={{ display: "block" }}>
        {title && (
          <text x={4} y={16} fill={sw.title} fontSize={13.5} fontWeight={700}>
            {title}
          </text>
        )}
        {vals.map((v, i) => {
          const sweep = (v / total) * 360;
          const start = curAngle;
          curAngle += sweep;
          if (sweep <= 0.1) return null;
          const col = palette[i % palette.length];
          const midRad = ((start + sweep / 2) * Math.PI) / 180;
          const lx = cx + (outerR + 15) * Math.cos(midRad);
          const ly = cy + (outerR + 15) * Math.sin(midRad);
          return (
            <g key={i}>
              <path d={donutArcPath(cx, cy, outerR, innerR, start, sweep)} fill={col} />
              {showValues && sweep >= 18 && (
                <text
                  x={lx}
                  y={ly + 3}
                  fill={sw.body}
                  fontSize={10}
                  fontWeight={700}
                  textAnchor="middle"
                >
                  {fmtChartNum(v, suffix)}
                </text>
              )}
            </g>
          );
        })}
        {showLegend &&
          renderLegend(
            cats.map((label, i) => ({
              label,
              color: palette[i % palette.length],
            }))
          )}
      </svg>
    );
  }

  if (chartType === "hbar") {
    const allVals = series.flatMap((s) => s.values.map((v) => Math.max(0, Number(v) || 0)));
    const maxVal = Math.max(...allVals, 1e-6);
    const maxCatLen = cats.reduce((m, c) => Math.max(m, c.length), 2);
    const labelW = Math.min(bw * 0.34, Math.max(58, maxCatLen * 10 + 16));
    const rightPad = showValues ? 42 : 12;
    const px = labelW;
    const pw = Math.max(40, bw - labelW - rightPad);
    const py = topPad;
    const ph = Math.max(40, bh - topPad - botLegendH - 8);
    const slotH = ph / cats.length;
    const groupH = slotH * 0.68;
    const barH = Math.max(
      4,
      (groupH - Math.max(0, series.length - 1) * 2) / series.length
    );

    return (
      <svg width={bw} height={bh} viewBox={`0 0 ${bw} ${bh}`} style={{ display: "block" }}>
        {title && (
          <text x={4} y={16} fill={sw.title} fontSize={13.5} fontWeight={700}>
            {title}
          </text>
        )}
        <line x1={px} y1={py} x2={px} y2={py + ph} stroke={sw.divider} strokeWidth={1} />
        {cats.map((cat, ci) => {
          const slotTop = py + ci * slotH;
          const gTop = slotTop + (slotH - groupH) / 2;
          return (
            <g key={ci}>
              <text
                x={px - 8}
                y={slotTop + slotH / 2 + 3.5}
                fill={sw.muted}
                fontSize={10.5}
                textAnchor="end"
              >
                {cat}
              </text>
              {series.map((s, si) => {
                const v = Math.max(0, Number(s.values[ci]) || 0);
                const wBar = Math.max(2, (v / maxVal) * pw);
                const yBar = gTop + si * (barH + 2);
                return (
                  <g key={si}>
                    <rect
                      x={px}
                      y={yBar}
                      width={wBar}
                      height={barH}
                      rx={Math.min(3, barH / 2.5)}
                      fill={seriesColors[si]}
                    />
                    {showValues && (
                      <text
                        x={px + wBar + 6}
                        y={yBar + barH / 2 + 3.5}
                        fill={sw.body}
                        fontSize={10}
                        fontWeight={700}
                      >
                        {fmtChartNum(v, suffix)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        {showLegend &&
          renderLegend(
            series.map((s, si) => ({ label: s.name, color: seriesColors[si] }))
          )}
      </svg>
    );
  }

  // Vertical Column ("bar") & Line ("line")
  const allVals = series.flatMap((s) => s.values.map((v) => Number(v) || 0));
  const rawMax = Math.max(...allVals, 1);
  const maxVal = Math.max(rawMax * 1.14, 1e-6);
  const minVal = Math.min(0, ...allVals);
  const span = Math.max(maxVal - minVal, 1e-6);

  const yAxisW = 36;
  const xLabelH = 20;
  const px = yAxisW;
  const pw = Math.max(40, bw - yAxisW - 10);
  const py = topPad + 8;
  const ph = Math.max(40, bh - topPad - 8 - xLabelH - botLegendH);
  const slotW = pw / cats.length;
  const ticks = 4;
  const baseY = py + ph * (1 - (0 - minVal) / span);

  return (
    <svg width={bw} height={bh} viewBox={`0 0 ${bw} ${bh}`} style={{ display: "block" }}>
      {title && (
        <text x={4} y={16} fill={sw.title} fontSize={13.5} fontWeight={700}>
          {title}
        </text>
      )}
      {Array.from({ length: ticks + 1 }).map((_, ti) => {
        const frac = ti / ticks;
        const gy = py + ph * (1 - frac);
        const tv = minVal + span * frac;
        return (
          <g key={ti}>
            <line
              x1={px}
              y1={gy}
              x2={px + pw}
              y2={gy}
              stroke={sw.divider}
              strokeWidth={ti === 0 ? 1 : 0.6}
            />
            <text
              x={px - 6}
              y={gy + 3}
              fill={sw.muted}
              fontSize={9}
              textAnchor="end"
            >
              {fmtChartNum(tv)}
            </text>
          </g>
        );
      })}

      {cats.map((cat, ci) => (
        <text
          key={ci}
          x={px + (ci + 0.5) * slotW}
          y={py + ph + 14}
          fill={sw.muted}
          fontSize={10}
          textAnchor="middle"
        >
          {cat}
        </text>
      ))}

      {chartType === "line"
        ? series.map((s, si) => {
            const pts = cats.map((_, ci) => {
              const v = Number(s.values[ci]) || 0;
              return {
                x: px + (ci + 0.5) * slotW,
                y: py + ph * (1 - (v - minVal) / span),
                v,
              };
            });
            const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <g key={si}>
                <polyline
                  points={poly}
                  fill="none"
                  stroke={seriesColors[si]}
                  strokeWidth={2.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {pts.map((p, ci) => (
                  <g key={ci}>
                    <circle cx={p.x} cy={p.y} r={3.8} fill={seriesColors[si]} />
                    {showValues && (
                      <text
                        x={p.x}
                        y={p.y - 8}
                        fill={sw.body}
                        fontSize={9.5}
                        fontWeight={700}
                        textAnchor="middle"
                      >
                        {fmtChartNum(p.v, suffix)}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            );
          })
        : (() => {
            const groupW = Math.min(slotW * 0.64, 56 * series.length);
            const barW = Math.max(
              6,
              (groupW - Math.max(0, series.length - 1) * 3) / series.length
            );
            return cats.map((_, ci) => {
              const gLeft = px + (ci + 0.5) * slotW - groupW / 2;
              return (
                <g key={ci}>
                  {series.map((s, si) => {
                    const v = Number(s.values[ci]) || 0;
                    const topY = py + ph * (1 - (v - minVal) / span);
                    const bxBar = gLeft + si * (barW + 3);
                    const bhBar = Math.max(2, Math.abs(baseY - topY));
                    const barTop = Math.min(topY, baseY);
                    return (
                      <g key={si}>
                        <rect
                          x={bxBar}
                          y={barTop}
                          width={barW}
                          height={bhBar}
                          rx={Math.min(3, barW / 3)}
                          fill={seriesColors[si]}
                        />
                        {showValues && (
                          <text
                            x={bxBar + barW / 2}
                            y={barTop - 5}
                            fill={sw.body}
                            fontSize={9.5}
                            fontWeight={700}
                            textAnchor="middle"
                          >
                            {fmtChartNum(v, suffix)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            });
          })()}

      {showLegend &&
        renderLegend(
          series.map((s, si) => ({ label: s.name, color: seriesColors[si] }))
        )}
    </svg>
  );
}

interface CustomSlideLayerProps {
  pid: string;
  customBg?: string | null;
  elements: CanvasElement[];
  theme: ThemeOption;
  scale: number;
  interactive?: boolean;
  selectedElementId?: string | null;
  onSelectElement?: (elementId: string | null) => void;
  onSelectTextElement?: (elementId: string) => void;
  onUpdateElement?: (elementId: string, patch: Partial<CanvasElement>) => void;
}

interface DragSession {
  elementId: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  kind: CanvasElement["kind"];
  moved: boolean;
}

const SNAP_THRESHOLD = 6;

function computeSnap(
  x: number,
  y: number,
  w: number,
  h: number,
  siblings: CanvasElement[]
): { x: number; y: number; guideX: number | null; guideY: number | null } {
  const xTargets = [48, 480, 912];
  const yTargets = [36, 270, 504];
  for (const s of siblings) {
    if (s.kind === "line") continue;
    xTargets.push(s.x, s.x + s.w / 2, s.x + s.w);
    yTargets.push(s.y, s.y + s.h / 2, s.y + s.h);
  }

  let bestX = x;
  let guideX: number | null = null;
  let bestDx = SNAP_THRESHOLD + 1;
  const xAnchors: Array<[number, number]> = [
    [x, 0],
    [x + w / 2, w / 2],
    [x + w, w],
  ];
  for (const [val, offset] of xAnchors) {
    for (const target of xTargets) {
      const d = Math.abs(val - target);
      if (d < bestDx) {
        bestDx = d;
        bestX = target - offset;
        guideX = target;
      }
    }
  }

  let bestY = y;
  let guideY: number | null = null;
  let bestDy = SNAP_THRESHOLD + 1;
  const yAnchors: Array<[number, number]> = [
    [y, 0],
    [y + h / 2, h / 2],
    [y + h, h],
  ];
  for (const [val, offset] of yAnchors) {
    for (const target of yTargets) {
      const d = Math.abs(val - target);
      if (d < bestDy) {
        bestDy = d;
        bestY = target - offset;
        guideY = target;
      }
    }
  }

  return {
    x: Math.round(Math.max(0, Math.min(960 - w, bestX))),
    y: Math.round(Math.max(0, Math.min(540 - h, bestY))),
    guideX,
    guideY,
  };
}

/**
 * Pure 960x540 proportional renderer for freeform custom canvas slides.
 * Supports all 6 native primitives (card, line, image, text, table, chart)
 * plus direct selection, magnetic drag-to-move, and corner resize when interactive.
 */
export function CustomSlideLayer({
  pid,
  customBg,
  elements,
  theme,
  scale,
  interactive = false,
  selectedElementId = null,
  onSelectElement,
  onSelectTextElement,
  onUpdateElement,
}: CustomSlideLayerProps) {
  const sw = theme.swatches;
  const bg = resolveCanvasColor(customBg, sw, sw.bg) || sw.bg;

  const dragRef = useRef<DragSession | null>(null);
  const liveBoxRef = useRef<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [liveBox, setLiveBox] = useState<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  useEffect(() => {
    if (!interactive) return;

    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const safeScale = scale > 0.05 ? scale : 0.75;
      const dx = (e.clientX - d.startClientX) / safeScale;
      const dy = (e.clientY - d.startClientY) / safeScale;
      if (!d.moved && Math.hypot(dx, dy) < 2.5) return;
      d.moved = true;

      if (d.mode === "move") {
        if (d.kind === "line") {
          const minX = Math.min(0, -d.origW);
          const maxX = Math.min(960, 960 - d.origW);
          const minY = Math.min(0, -d.origH);
          const maxY = Math.min(540, 540 - d.origH);
          const nx = Math.round(Math.max(minX, Math.min(maxX, d.origX + dx)));
          const ny = Math.round(Math.max(minY, Math.min(maxY, d.origY + dy)));
          const nextBox = { id: d.elementId, x: nx, y: ny, w: d.origW, h: d.origH };
          liveBoxRef.current = nextBox;
          setLiveBox(nextBox);
          setGuides({ x: null, y: null });
          return;
        }
        const siblings = elements.filter((s) => s.id !== d.elementId);
        const snapped = computeSnap(
          d.origX + dx,
          d.origY + dy,
          d.origW,
          d.origH,
          siblings
        );
        const nextBox = {
          id: d.elementId,
          x: snapped.x,
          y: snapped.y,
          w: d.origW,
          h: d.origH,
        };
        liveBoxRef.current = nextBox;
        setLiveBox(nextBox);
        setGuides({ x: snapped.guideX, y: snapped.guideY });
      } else {
        const minW = d.kind === "chart" ? 180 : d.kind === "table" ? 160 : 32;
        const minH = d.kind === "chart" ? 120 : d.kind === "table" ? 60 : 24;
        const nw = Math.round(
          Math.max(minW, Math.min(960 - d.origX, d.origW + dx))
        );
        const nh = Math.round(
          Math.max(minH, Math.min(540 - d.origY, d.origH + dy))
        );
        const nextBox = { id: d.elementId, x: d.origX, y: d.origY, w: nw, h: nh };
        liveBoxRef.current = nextBox;
        setLiveBox(nextBox);
        setGuides({ x: null, y: null });
      }
    };

    const onPointerUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const finalBox = liveBoxRef.current;
      dragRef.current = null;
      liveBoxRef.current = null;
      setLiveBox(null);
      setGuides({ x: null, y: null });
      if (d.moved && finalBox && finalBox.id === d.elementId && onUpdateElement) {
        onUpdateElement(d.elementId, {
          x: finalBox.x,
          y: finalBox.y,
          w: finalBox.w,
          h: finalBox.h,
        });
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [interactive, scale, elements, onUpdateElement]);

  const startDrag = (
    e: React.PointerEvent,
    el: CanvasElement,
    mode: "move" | "resize"
  ) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    onSelectElement?.(el.id);
    if (!onUpdateElement) return;
    dragRef.current = {
      elementId: el.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: el.x,
      origY: el.y,
      origW: el.w,
      origH: el.h,
      kind: el.kind,
      moved: false,
    };
  };

  return (
    <div
      onClick={() => {
        if (interactive) onSelectElement?.(null);
      }}
      className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 transition-colors duration-200 select-none"
      style={{
        transform: `scale(${scale})`,
        backgroundColor: bg,
      }}
    >
      {elements.map((rawEl, idx) => {
        const key = `${rawEl.id || "el"}-${idx}`;
        const el =
          liveBox && liveBox.id === rawEl.id
            ? { ...rawEl, x: liveBox.x, y: liveBox.y, w: liveBox.w, h: liveBox.h }
            : rawEl;
        const isSelected = interactive && selectedElementId === el.id;

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
              {interactive && (
                <line
                  x1={el.x}
                  y1={el.y}
                  x2={el.x + el.w}
                  y2={el.y + el.h}
                  stroke="transparent"
                  strokeWidth={Math.max(14, lw + 10)}
                  style={{ pointerEvents: "stroke", cursor: "move" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectElement?.(el.id);
                  }}
                  onPointerDown={(e) => startDrag(e, el, "move")}
                />
              )}
              <line
                x1={el.x}
                y1={el.y}
                x2={el.x + el.w}
                y2={el.y + el.h}
                stroke={lineCol}
                strokeWidth={lw}
                strokeLinecap="round"
              />
              {isSelected && (
                <>
                  <circle cx={el.x} cy={el.y} r={4.5} fill={sw.accent} />
                  <circle cx={el.x + el.w} cy={el.y + el.h} r={4.5} fill={sw.accent} />
                </>
              )}
            </svg>
          );
        }

        const selectionStyle: React.CSSProperties = isSelected
          ? {
              outline: `2px solid ${sw.accent}`,
              outlineOffset: 1,
            }
          : {};

        const resizeHandle =
          isSelected && onUpdateElement ? (
            <div
              onPointerDown={(e) => startDrag(e, el, "resize")}
              onClick={(e) => e.stopPropagation()}
              title="拖拽调整尺寸"
              style={{
                position: "absolute",
                right: -5,
                bottom: -5,
                width: 11,
                height: 11,
                borderRadius: 3,
                backgroundColor: sw.accent,
                border: `2px solid ${sw.surface}`,
                cursor: "nwse-resize",
                zIndex: 30,
              }}
            />
          ) : null;

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
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelectElement?.(el.id);
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
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
                cursor: interactive ? "move" : "default",
                pointerEvents: interactive ? "auto" : "none",
                ...selectionStyle,
              }}
            >
              {resizeHandle}
            </div>
          );
        }

        if (el.kind === "image") {
          const assetId = (el.image_asset_id || "").trim();
          const radius = el.radius ?? 0;

          return (
            <div
              key={key}
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelectElement?.(el.id);
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                borderRadius: radius,
                backgroundColor: assetId ? "transparent" : sw.surface,
                cursor: interactive ? "move" : "default",
                pointerEvents: interactive ? "auto" : "none",
                ...selectionStyle,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: radius,
                  overflow: "hidden",
                }}
              >
                {assetId ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/projects/${encodeURIComponent(
                      pid
                    )}/assets/${encodeURIComponent(assetId)}`}
                    alt={assetId}
                    draggable={false}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: el.fit === "cover" ? "cover" : "contain",
                      display: "block",
                    }}
                  />
                ) : null}
              </div>
              {resizeHandle}
            </div>
          );
        }

        if (el.kind === "table") {
          return (
            <div
              key={key}
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelectElement?.(el.id);
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                cursor: interactive ? "move" : "default",
                pointerEvents: interactive ? "auto" : "none",
                ...selectionStyle,
              }}
            >
              <CustomTableView el={el} sw={sw} slideBg={bg} />
              {resizeHandle}
            </div>
          );
        }

        if (el.kind === "chart") {
          return (
            <div
              key={key}
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelectElement?.(el.id);
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                cursor: interactive ? "move" : "default",
                pointerEvents: interactive ? "auto" : "none",
                ...selectionStyle,
              }}
            >
              <CustomChartView el={el} theme={theme} />
              {resizeHandle}
            </div>
          );
        }

        // Text element (matches CUSTOM_PAD_X_PT=4, CUSTOM_PAD_Y_PT=2 in pptx_export.py)
        const fontSize = Math.round(el.font_size ?? 18);
        const lineHeight = Math.round(el.line_height ?? fontSize * 1.35);
        const color = resolveCanvasColor(el.color, sw, sw.body) || sw.body;

        return (
          <div
            key={key}
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              onSelectElement?.(el.id);
            }}
            onDoubleClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
              onSelectTextElement?.(el.id);
            }}
            onPointerDown={(e) => startDrag(e, el, "move")}
            className={interactive && !isSelected ? "clickable-slot" : undefined}
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
              overflow: isSelected ? "visible" : "hidden",
              cursor: interactive ? "move" : "default",
              pointerEvents: interactive ? "auto" : "none",
              ...selectionStyle,
            }}
          >
            {normalizeEscapedNewlines(el.text || "")}
            {resizeHandle}
          </div>
        );
      })}

      {/* Live magnetic snap alignment guides while dragging */}
      {interactive && guides.x !== null && (
        <div
          style={{
            position: "absolute",
            left: guides.x,
            top: 0,
            width: 1,
            height: 540,
            borderLeft: `1px dashed ${sw.accent}`,
            pointerEvents: "none",
            zIndex: 40,
          }}
        />
      )}
      {interactive && guides.y !== null && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: guides.y,
            width: 960,
            height: 1,
            borderTop: `1px dashed ${sw.accent}`,
            pointerEvents: "none",
            zIndex: 40,
          }}
        />
      )}
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
    <div ref={hostRef} className="w-full h-full relative overflow-hidden">
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
