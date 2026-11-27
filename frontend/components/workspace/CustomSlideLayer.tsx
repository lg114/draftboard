"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasElement, ThemeOption, ThemeSwatches } from "../../lib/api";
import { normalizeEscapedNewlines } from "./layoutUtils";
import {
  type BoxRect,
  type SnapLine,
  type SpacingGuide,
  CANVAS_H,
  CANVAS_W,
  computeGroupBounds,
  computeSmartSnap,
  getElementBounds,
  rectsIntersect,
} from "./stage/snapGuides";

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

function InlineCellInput({
  value,
  ariaLabel,
  align = "left",
  fontSize,
  fontWeight = 400,
  color,
  onChange,
  onDone,
  onTab,
}: {
  value: string;
  ariaLabel: string;
  align?: "left" | "center" | "right";
  fontSize: number;
  fontWeight?: number;
  color: string;
  onChange: (nextValue: string) => void;
  onDone: () => void;
  onTab?: (shiftKey: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.select();
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.stopPropagation();
          onDone();
          return;
        }
        if (e.key === "Tab" && onTab) {
          e.preventDefault();
          e.stopPropagation();
          onTab(e.shiftKey);
        }
      }}
      style={{
        width: "100%",
        margin: 0,
        padding: "1px 3px",
        border: "none",
        borderRadius: 3,
        outline: `1.5px solid ${SELECTION_COLOR}`,
        background: "rgba(61, 99, 221, 0.12)",
        boxSizing: "border-box",
        fontFamily: "inherit",
        fontSize,
        fontWeight,
        lineHeight: 1.25,
        color,
        textAlign: align,
        caretColor: SELECTION_COLOR,
      }}
    />
  );
}

function InlineDiagramTextarea({
  value,
  ariaLabel,
  fontSize,
  lineHeight,
  color,
  onChange,
  onDone,
}: {
  value: string;
  ariaLabel: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  onChange: (nextValue: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      value={value}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      style={{
        width: "100%",
        flex: 1,
        minHeight: Math.round(lineHeight * 2),
        margin: 0,
        padding: "2px 4px",
        border: "none",
        borderRadius: 4,
        outline: `1.5px solid ${SELECTION_COLOR}`,
        background: "rgba(61, 99, 221, 0.08)",
        resize: "none",
        boxSizing: "border-box",
        fontFamily: "inherit",
        fontSize,
        lineHeight: `${lineHeight}px`,
        color,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        caretColor: SELECTION_COLOR,
      }}
    />
  );
}

function CustomTableView({
  el,
  sw,
  slideBg,
  interactive = false,
  editingCell = null,
  onStartEditCell,
  onUpdateCell,
}: {
  el: CanvasElement;
  sw: ThemeSwatches;
  slideBg: string;
  interactive?: boolean;
  editingCell?: { row: number; col: number } | null;
  onStartEditCell?: (cell: { row: number; col: number } | null) => void;
  onUpdateCell?: (row: number, col: number, value: string) => void;
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
  const canEdit = Boolean(interactive && onStartEditCell && onUpdateCell);

  const stepCell = (row: number, col: number, shiftKey: boolean) => {
    if (!onStartEditCell) return;
    const minRow = headers.length > 0 ? -1 : 0;
    const maxRow = rows.length - 1;
    let nextCol = col + (shiftKey ? -1 : 1);
    let nextRow = row;
    if (nextCol >= colCount) {
      nextCol = 0;
      nextRow += 1;
    } else if (nextCol < 0) {
      nextCol = colCount - 1;
      nextRow -= 1;
    }
    if (nextRow < minRow || nextRow > maxRow) {
      onStartEditCell(null);
      return;
    }
    onStartEditCell({ row: nextRow, col: nextCol });
  };

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
              const raw = String(headers[ci] ?? "");
              const isEditing =
                canEdit && editingCell?.row === -1 && editingCell?.col === ci;
              return (
                <th
                  key={ci}
                  onDoubleClick={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    onStartEditCell?.({ row: -1, col: ci });
                  }}
                  style={{
                    backgroundColor: headerFill,
                    color: headerCol,
                    fontWeight: 700,
                    textAlign: "left",
                    padding: isEditing ? "2px 4px" : "4px 8px",
                    borderTop: `1px solid ${sw.divider}`,
                    borderBottom: `1.5px solid ${sw.divider}`,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    cursor: isEditing ? "text" : undefined,
                  }}
                >
                  {isEditing ? (
                    <InlineCellInput
                      ariaLabel={`编辑表头第 ${ci + 1} 列`}
                      value={raw}
                      fontSize={fontSize}
                      fontWeight={700}
                      color={headerCol}
                      onChange={(val) => onUpdateCell?.(-1, ci, val)}
                      onDone={() => onStartEditCell?.(null)}
                      onTab={(shift) => stepCell(-1, ci, shift)}
                    />
                  ) : (
                    raw.trim()
                  )}
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
                const rawVal = String(row[ci] ?? "");
                const val = rawVal.trim();
                const isNumeric = ci > 0 && NUMERIC_CELL_RE.test(val);
                const isEditing =
                  canEdit && editingCell?.row === ri && editingCell?.col === ci;
                return (
                  <td
                    key={ci}
                    onDoubleClick={(e) => {
                      if (!canEdit) return;
                      e.stopPropagation();
                      onStartEditCell?.({ row: ri, col: ci });
                    }}
                    style={{
                      backgroundColor: rowBg,
                      color: cellCol,
                      fontWeight: ci === 0 && colCount >= 2 ? 700 : 400,
                      textAlign: isNumeric ? "right" : "left",
                      padding: isEditing ? "2px 4px" : "4px 8px",
                      borderBottom: `1px solid ${sw.divider}`,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: isNumeric ? "tabular-nums" : undefined,
                      cursor: isEditing ? "text" : undefined,
                    }}
                  >
                    {isEditing ? (
                      <InlineCellInput
                        ariaLabel={`编辑第 ${ri + 1} 行第 ${ci + 1} 列`}
                        value={rawVal}
                        align={isNumeric ? "right" : "left"}
                        fontSize={fontSize}
                        fontWeight={ci === 0 && colCount >= 2 ? 700 : 400}
                        color={cellCol}
                        onChange={(next) => onUpdateCell?.(ri, ci, next)}
                        onDone={() => onStartEditCell?.(null)}
                        onTab={(shift) => stepCell(ri, ci, shift)}
                      />
                    ) : (
                      val
                    )}
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

  const isHexDark = (hex: string): boolean => {
    const clean = hex.replace("#", "").trim();
    if (clean.length !== 6) return true;
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum < 0.62;
  };

  // Vertical Column ("bar"), Stacked Column ("stacked_bar"), & Line ("line")
  const isStacked = chartType === "stacked_bar";
  let rawMax: number;
  let minVal: number;
  if (isStacked) {
    const posSums = cats.map((_, ci) =>
      series.reduce((acc, s) => acc + Math.max(0, Number(s.values[ci]) || 0), 0)
    );
    const negSums = cats.map((_, ci) =>
      series.reduce((acc, s) => acc + Math.min(0, Number(s.values[ci]) || 0), 0)
    );
    rawMax = Math.max(...posSums, 1);
    minVal = Math.min(0, ...negSums);
  } else {
    const allVals = series.flatMap((s) => s.values.map((v) => Number(v) || 0));
    rawMax = Math.max(...allVals, 1);
    minVal = Math.min(0, ...allVals);
  }
  const maxVal = Math.max(rawMax * 1.14, 1e-6);
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
        : isStacked
        ? (() => {
            const barW = Math.min(slotW * 0.56, 68);
            return cats.map((_, ci) => {
              const bxBar = px + (ci + 0.5) * slotW - barW / 2;
              let cumPos = 0;
              let cumNeg = 0;
              const posIndices = series
                .map((s, si) => ((Number(s.values[ci]) || 0) > 0 ? si : -1))
                .filter((si) => si >= 0);
              const topPosSi =
                posIndices.length > 0 ? posIndices[posIndices.length - 1] : -1;
              return (
                <g key={ci}>
                  {series.map((s, si) => {
                    const v = Number(s.values[ci]) || 0;
                    if (Math.abs(v) < 1e-9) return null;
                    let yBot: number;
                    let yTop: number;
                    if (v >= 0) {
                      yBot = py + ph * (1 - (cumPos - minVal) / span);
                      cumPos += v;
                      yTop = py + ph * (1 - (cumPos - minVal) / span);
                    } else {
                      yTop = py + ph * (1 - (cumNeg - minVal) / span);
                      cumNeg += v;
                      yBot = py + ph * (1 - (cumNeg - minVal) / span);
                    }
                    const segH = Math.max(1.5, Math.abs(yBot - yTop));
                    const segTop = Math.min(yTop, yBot);
                    const fillHex = seriesColors[si];
                    const lblFill = isHexDark(fillHex) ? "#FFFFFF" : "#18181B";
                    const roundTop = si === topPosSi && segH >= 6;
                    const rx = Math.min(3, barW / 4);
                    return (
                      <g key={si}>
                        {roundTop ? (
                          <path
                            d={`M${bxBar},${segTop + rx} Q${bxBar},${segTop} ${bxBar + rx},${segTop} L${bxBar + barW - rx},${segTop} Q${bxBar + barW},${segTop} ${bxBar + barW},${segTop + rx} L${bxBar + barW},${segTop + segH} L${bxBar},${segTop + segH} Z`}
                            fill={fillHex}
                          />
                        ) : (
                          <rect
                            x={bxBar}
                            y={segTop}
                            width={barW}
                            height={segH}
                            fill={fillHex}
                          />
                        )}
                        {showValues && segH >= 15 && (
                          <text
                            x={bxBar + barW / 2}
                            y={segTop + segH / 2 + 3.2}
                            fill={lblFill}
                            fontSize={9}
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
          })()
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

function CustomDiagramView({
  el,
  sw,
  slideBg,
  interactive = false,
  editingField = null,
  onStartEditField,
  onUpdateStep,
}: {
  el: CanvasElement;
  sw: ThemeSwatches;
  slideBg: string;
  interactive?: boolean;
  editingField?: { stepIdx: number; field: "label" | "title" | "desc" } | null;
  onStartEditField?: (
    target: { stepIdx: number; field: "label" | "title" | "desc" } | null
  ) => void;
  onUpdateStep?: (
    stepIdx: number,
    field: "label" | "title" | "desc",
    value: string
  ) => void;
}) {
  const steps = el.diagram_steps || [];
  if (steps.length < 2) return null;
  const dtype = el.diagram_type || "timeline";
  const n = steps.length;
  const bw = Math.max(320, el.w);
  const bh = Math.max(120, el.h);
  const canEdit = Boolean(interactive && onStartEditField && onUpdateStep);

  const hexClean = sw.accent.replace("#", "").trim();
  const accentDark =
    hexClean.length === 6
      ? 0.2126 * (parseInt(hexClean.slice(0, 2), 16) / 255) +
          0.7152 * (parseInt(hexClean.slice(2, 4), 16) / 255) +
          0.0722 * (parseInt(hexClean.slice(4, 6), 16) / 255) <
        0.62
      : true;
  const accentFg = accentDark ? "#FFFFFF" : "#141416";

  if (dtype === "process") {
    const arrowGap = n <= 4 ? 22 : 16;
    const colW = (bw - arrowGap * (n - 1)) / n;
    const titlePt = colW >= 145 ? 14 : 13;
    const descPt = colW >= 155 ? 12 : 11;
    const padX = colW >= 135 ? 12 : 9;
    const padY = 12;

    return (
      <div
        style={{
          position: "relative",
          width: bw,
          height: bh,
          overflow: "hidden",
        }}
      >
        {steps.map((step, idx) => {
          const cx = idx * (colW + arrowGap);
          const badgeTxt = (step.label || "").trim() || String(idx + 1).padStart(2, "0");
          const aw = Math.max(8, arrowGap - 8);
          const ah = 13;
          const ax = cx + colW + (arrowGap - aw) / 2;
          const ay = (bh - ah) / 2;
          return (
            <div key={idx}>
              <div
                style={{
                  position: "absolute",
                  left: cx,
                  top: 0,
                  width: colW,
                  height: bh,
                  borderRadius: 12,
                  backgroundColor: sw.surface,
                  border: `0.75px solid ${sw.divider}`,
                  padding: `${padY}px ${padX}px`,
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  onDoubleClick={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    onStartEditField?.({ stepIdx: idx, field: "label" });
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    alignSelf: "flex-start",
                    height: 22,
                    minWidth: 34,
                    maxWidth: "100%",
                    padding:
                      canEdit &&
                      editingField?.stepIdx === idx &&
                      editingField?.field === "label"
                        ? "0 4px"
                        : "0 9px",
                    borderRadius: 11,
                    backgroundColor: sw.accent,
                    color: accentFg,
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: "12px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    marginBottom: 10,
                    flexShrink: 0,
                  }}
                >
                  {canEdit &&
                  editingField?.stepIdx === idx &&
                  editingField?.field === "label" ? (
                    <InlineCellInput
                      ariaLabel={`编辑步骤 ${idx + 1} 标签`}
                      value={step.label || ""}
                      align="center"
                      fontSize={10}
                      fontWeight={700}
                      color={accentFg}
                      onChange={(val) => onUpdateStep?.(idx, "label", val)}
                      onDone={() => onStartEditField?.(null)}
                    />
                  ) : (
                    badgeTxt
                  )}
                </div>
                <div
                  onDoubleClick={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    onStartEditField?.({ stepIdx: idx, field: "title" });
                  }}
                  style={{
                    fontSize: titlePt,
                    fontWeight: 700,
                    lineHeight: `${Math.round(titlePt * 1.28)}px`,
                    color: sw.title,
                    marginBottom:
                      step.desc?.trim() ||
                      (editingField?.stepIdx === idx &&
                        editingField?.field === "desc")
                        ? 6
                        : 0,
                    wordBreak: "break-word",
                  }}
                >
                  {canEdit &&
                  editingField?.stepIdx === idx &&
                  editingField?.field === "title" ? (
                    <InlineCellInput
                      ariaLabel={`编辑步骤 ${idx + 1} 标题`}
                      value={step.title || ""}
                      fontSize={titlePt}
                      fontWeight={700}
                      color={sw.title}
                      onChange={(val) => onUpdateStep?.(idx, "title", val)}
                      onDone={() => onStartEditField?.(null)}
                    />
                  ) : (
                    step.title
                  )}
                </div>
                {canEdit &&
                editingField?.stepIdx === idx &&
                editingField?.field === "desc" ? (
                  <InlineDiagramTextarea
                    ariaLabel={`编辑步骤 ${idx + 1} 说明`}
                    value={step.desc || ""}
                    fontSize={descPt}
                    lineHeight={Math.round(descPt * 1.38)}
                    color={sw.body}
                    onChange={(val) => onUpdateStep?.(idx, "desc", val)}
                    onDone={() => onStartEditField?.(null)}
                  />
                ) : step.desc?.trim() ? (
                  <div
                    onDoubleClick={(e) => {
                      if (!canEdit) return;
                      e.stopPropagation();
                      onStartEditField?.({ stepIdx: idx, field: "desc" });
                    }}
                    style={{
                      fontSize: descPt,
                      fontWeight: 400,
                      lineHeight: `${Math.round(descPt * 1.38)}px`,
                      color: sw.body,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      overflow: "hidden",
                    }}
                  >
                    {step.desc}
                  </div>
                ) : canEdit ? (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onStartEditField?.({ stepIdx: idx, field: "desc" });
                    }}
                    style={{ flex: 1, minHeight: 16 }}
                  />
                ) : null}
              </div>

              {idx < n - 1 && (
                <svg
                  width={aw}
                  height={ah}
                  viewBox={`0 0 ${aw} ${ah}`}
                  style={{
                    position: "absolute",
                    left: ax,
                    top: ay,
                    overflow: "visible",
                  }}
                >
                  {(() => {
                    const headW = Math.min(aw * 0.52, ah * 0.85);
                    const shaftH = ah * 0.36;
                    const midY = ah / 2;
                    const shaftX = aw - headW;
                    return (
                      <polygon
                        points={`0,${midY - shaftH / 2} ${shaftX},${midY - shaftH / 2} ${shaftX},0 ${aw},${midY} ${shaftX},${ah} ${shaftX},${midY + shaftH / 2} 0,${midY + shaftH / 2}`}
                        fill={sw.accent}
                      />
                    );
                  })()}
                </svg>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Timeline mode ("timeline")
  const gap = n <= 4 ? 14 : 10;
  const colW = (bw - gap * (n - 1)) / n;
  const titlePt = colW >= 145 ? 14 : 13;
  const descPt = colW >= 155 ? 12 : 11;
  const padX = colW >= 135 ? 12 : 9;
  const padY = 11;
  const trackY = 34;
  const nodeD = 16;
  const cardY = trackY + 18;
  const cardH = Math.max(56, bh - cardY);
  const firstCx = colW / 2;
  const lastCx = bw - colW / 2;

  return (
    <div
      style={{
        position: "relative",
        width: bw,
        height: bh,
        overflow: "hidden",
      }}
    >
      <svg
        width={bw}
        height={cardY}
        viewBox={`0 0 ${bw} ${cardY}`}
        style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
      >
        <line
          x1={firstCx}
          y1={trackY}
          x2={lastCx}
          y2={trackY}
          stroke={sw.divider}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {steps.map((_, idx) => {
          const cx = idx * (colW + gap) + colW / 2;
          return (
            <circle
              key={idx}
              cx={cx}
              cy={trackY}
              r={nodeD / 2}
              fill={sw.accent}
              stroke={slideBg}
              strokeWidth={2}
            />
          );
        })}
      </svg>

      {steps.map((step, idx) => {
        const colX = idx * (colW + gap);
        const lblTxt = (step.label || "").trim() || `0${idx + 1}`;
        return (
          <div key={idx}>
            <div
              onDoubleClick={(e) => {
                if (!canEdit) return;
                e.stopPropagation();
                onStartEditField?.({ stepIdx: idx, field: "label" });
              }}
              style={{
                position: "absolute",
                left: colX,
                top: 0,
                width: colW,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                color: sw.accent,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                padding: "0 2px",
                boxSizing: "border-box",
              }}
            >
              {canEdit &&
              editingField?.stepIdx === idx &&
              editingField?.field === "label" ? (
                <InlineCellInput
                  ariaLabel={`编辑节点 ${idx + 1} 标签`}
                  value={step.label || ""}
                  align="center"
                  fontSize={11}
                  fontWeight={700}
                  color={sw.accent}
                  onChange={(val) => onUpdateStep?.(idx, "label", val)}
                  onDone={() => onStartEditField?.(null)}
                />
              ) : (
                lblTxt
              )}
            </div>
            <div
              style={{
                position: "absolute",
                left: colX,
                top: cardY,
                width: colW,
                height: cardH,
                borderRadius: 10,
                backgroundColor: sw.surface,
                border: `0.75px solid ${sw.divider}`,
                padding: `${padY}px ${padX}px`,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div
                onDoubleClick={(e) => {
                  if (!canEdit) return;
                  e.stopPropagation();
                  onStartEditField?.({ stepIdx: idx, field: "title" });
                }}
                style={{
                  fontSize: titlePt,
                  fontWeight: 700,
                  lineHeight: `${Math.round(titlePt * 1.28)}px`,
                  color: sw.title,
                  marginBottom:
                    step.desc?.trim() ||
                    (editingField?.stepIdx === idx &&
                      editingField?.field === "desc")
                      ? 6
                      : 0,
                  wordBreak: "break-word",
                }}
              >
                {canEdit &&
                editingField?.stepIdx === idx &&
                editingField?.field === "title" ? (
                  <InlineCellInput
                    ariaLabel={`编辑节点 ${idx + 1} 标题`}
                    value={step.title || ""}
                    fontSize={titlePt}
                    fontWeight={700}
                    color={sw.title}
                    onChange={(val) => onUpdateStep?.(idx, "title", val)}
                    onDone={() => onStartEditField?.(null)}
                  />
                ) : (
                  step.title
                )}
              </div>
              {canEdit &&
              editingField?.stepIdx === idx &&
              editingField?.field === "desc" ? (
                <InlineDiagramTextarea
                  ariaLabel={`编辑节点 ${idx + 1} 说明`}
                  value={step.desc || ""}
                  fontSize={descPt}
                  lineHeight={Math.round(descPt * 1.38)}
                  color={sw.body}
                  onChange={(val) => onUpdateStep?.(idx, "desc", val)}
                  onDone={() => onStartEditField?.(null)}
                />
              ) : step.desc?.trim() ? (
                <div
                  onDoubleClick={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    onStartEditField?.({ stepIdx: idx, field: "desc" });
                  }}
                  style={{
                    fontSize: descPt,
                    fontWeight: 400,
                    lineHeight: `${Math.round(descPt * 1.38)}px`,
                    color: sw.body,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    overflow: "hidden",
                  }}
                >
                  {step.desc}
                </div>
              ) : canEdit ? (
                <div
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onStartEditField?.({ stepIdx: idx, field: "desc" });
                  }}
                  style={{ flex: 1, minHeight: 16 }}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CustomSlideLayerProps {
  pid: string;
  customBg?: string | null;
  elements: CanvasElement[];
  theme: ThemeOption;
  scale: number;
  interactive?: boolean;
  selectedElementIds?: string[];
  onSelectElements?: (elementIds: string[]) => void;
  editingTextId?: string | null;
  onStartEditText?: (elementId: string | null) => void;
  onUpdateElementText?: (elementId: string, nextText: string) => void;
  onUpdateElement?: (elementId: string, patch: Partial<CanvasElement>) => void;
  onBatchUpdateElements?: (
    patches: Record<string, Partial<CanvasElement>>
  ) => void;
  onFocusField?: (fieldId: string) => void;
}

interface OrigMemberState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: CanvasElement["kind"];
}

interface DragSession {
  mode: "move" | "resize" | "line-start" | "line-end";
  clickedId: string;
  collapseOnClick: boolean;
  members: OrigMemberState[];
  groupBounds: BoxRect;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface MarqueeSession {
  startX: number;
  startY: number;
  additive: boolean;
  baseSelection: string[];
  moved: boolean;
}

const GUIDE_COLOR = "#F43F5E";
const SELECTION_COLOR = "#3D63DD";

function InlineCustomTextarea({
  el,
  fontSize,
  lineHeight,
  color,
  onChange,
  onDone,
}: {
  el: CanvasElement;
  fontSize: number;
  lineHeight: number;
  color: string;
  onChange: (nextText: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const val = node.value;
    if (val === "新文本框（双击编辑）") {
      node.select();
    } else {
      node.setSelectionRange(val.length, val.length);
    }
  }, []);

  const value = normalizeEscapedNewlines(el.text || "");

  return (
    <textarea
      ref={ref}
      aria-label="编辑画布文本框内容"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onDone()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
          return;
        }
      }}
      style={{
        width: "100%",
        height: "100%",
        minHeight: el.h,
        margin: 0,
        padding: "2px 4px",
        border: "none",
        outline: "none",
        background: "transparent",
        resize: "none",
        boxSizing: "border-box",
        fontFamily: "inherit",
        fontSize,
        lineHeight: `${lineHeight}px`,
        fontWeight: el.bold ? 700 : 400,
        letterSpacing: fontSize >= 28 ? "-0.02em" : undefined,
        color,
        textAlign: el.align ?? "left",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "auto",
        userSelect: "text",
        WebkitUserSelect: "text",
        caretColor: SELECTION_COLOR,
        display: "block",
      }}
    />
  );
}

/**
 * Pure 960x540 proportional renderer for freeform custom canvas slides.
 * Supports all 7 native primitives (card, line, image, text, table, chart, diagram),
 * multi-select (Shift+click & marquee box), smart snap guides + equal-spacing indicators,
 * direct inline double-click text editing, and corner/endpoint resize when interactive.
 */
export function CustomSlideLayer({
  pid,
  customBg,
  elements,
  theme,
  scale,
  interactive = false,
  selectedElementIds = [],
  onSelectElements,
  editingTextId = null,
  onStartEditText,
  onUpdateElementText,
  onUpdateElement,
  onBatchUpdateElements,
  onFocusField,
}: CustomSlideLayerProps) {
  const sw = theme.swatches;
  const bg = resolveCanvasColor(customBg, sw, sw.bg) || sw.bg;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const marqueeRef = useRef<MarqueeSession | null>(null);
  const suppressBgClickRef = useRef(false);

  const liveBoxesRef = useRef<Record<string, BoxRect> | null>(null);
  const [liveBoxes, setLiveBoxes] = useState<Record<string, BoxRect> | null>(
    null
  );
  const [snapOverlay, setSnapOverlay] = useState<{
    lines: SnapLine[];
    spacings: SpacingGuide[];
  }>({ lines: [], spacings: [] });
  const [marqueeRect, setMarqueeRect] = useState<BoxRect | null>(null);
  const [editingTableCell, setEditingTableCell] = useState<{
    elId: string;
    row: number;
    col: number;
  } | null>(null);
  const [editingDiagramField, setEditingDiagramField] = useState<{
    elId: string;
    stepIdx: number;
    field: "label" | "title" | "desc";
  } | null>(null);

  useEffect(() => {
    if (!interactive) {
      setEditingTableCell(null);
      setEditingDiagramField(null);
    }
  }, [interactive]);

  useEffect(() => {
    if (
      editingTableCell &&
      !elements.some((e) => e.id === editingTableCell.elId)
    ) {
      setEditingTableCell(null);
    }
    if (
      editingDiagramField &&
      !elements.some((e) => e.id === editingDiagramField.elId)
    ) {
      setEditingDiagramField(null);
    }
  }, [elements, editingTableCell, editingDiagramField]);

  const selectedSet = new Set(interactive ? selectedElementIds : []);

  useEffect(() => {
    if (!interactive) return;

    const toCanvasPoint = (clientX: number, clientY: number) => {
      const safeScale = scale > 0.05 ? scale : 0.75;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: Math.max(0, Math.min(CANVAS_W, (clientX - rect.left) / safeScale)),
        y: Math.max(0, Math.min(CANVAS_H, (clientY - rect.top) / safeScale)),
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      // 1. Marquee drag selection on empty canvas
      const m = marqueeRef.current;
      if (m) {
        const pt = toCanvasPoint(e.clientX, e.clientY);
        const rx = Math.min(m.startX, pt.x);
        const ry = Math.min(m.startY, pt.y);
        const rw = Math.abs(pt.x - m.startX);
        const rh = Math.abs(pt.y - m.startY);
        if (!m.moved && Math.hypot(rw, rh) < 4) return;
        m.moved = true;
        const rect: BoxRect = { x: rx, y: ry, w: rw, h: rh };
        setMarqueeRect(rect);

        const hitIds = elements
          .filter((el) => rectsIntersect(rect, getElementBounds(el)))
          .map((el) => el.id);
        const nextIds = m.additive
          ? Array.from(new Set([...m.baseSelection, ...hitIds]))
          : hitIds;
        onSelectElements?.(nextIds);
        return;
      }

      // 2. Element / group drag & resize
      const d = dragRef.current;
      if (!d) return;
      const safeScale = scale > 0.05 ? scale : 0.75;
      const dx = (e.clientX - d.startClientX) / safeScale;
      const dy = (e.clientY - d.startClientY) / safeScale;
      if (!d.moved && Math.hypot(dx, dy) < 2.5) return;
      d.moved = true;

      if (d.mode === "move") {
        const draggingIds = new Set(d.members.map((mem) => mem.id));
        const allLines = d.members.every((mem) => mem.kind === "line");

        let snapDx = 0;
        let snapDy = 0;
        let lines: SnapLine[] = [];
        let spacings: SpacingGuide[] = [];

        if (!allLines) {
          const siblings = elements.filter((s) => !draggingIds.has(s.id));
          const movedGroup: BoxRect = {
            x: d.groupBounds.x + dx,
            y: d.groupBounds.y + dy,
            w: d.groupBounds.w,
            h: d.groupBounds.h,
          };
          const snapped = computeSmartSnap(movedGroup, siblings, {
            disableSnap: e.altKey,
          });
          snapDx = snapped.dx;
          snapDy = snapped.dy;
          lines = snapped.lines;
          spacings = snapped.spacings;
        }

        // Clamp combined delta so every dragged member remains inside 960x540
        let minDx = -Infinity;
        let maxDx = Infinity;
        let minDy = -Infinity;
        let maxDy = Infinity;
        for (const mem of d.members) {
          if (mem.kind === "line") {
            minDx = Math.max(minDx, Math.min(0, -mem.w) - mem.x);
            maxDx = Math.min(maxDx, Math.min(CANVAS_W, CANVAS_W - mem.w) - mem.x);
            minDy = Math.max(minDy, Math.min(0, -mem.h) - mem.y);
            maxDy = Math.min(maxDy, Math.min(CANVAS_H, CANVAS_H - mem.h) - mem.y);
          } else {
            minDx = Math.max(minDx, -mem.x);
            maxDx = Math.min(maxDx, CANVAS_W - mem.w - mem.x);
            minDy = Math.max(minDy, -mem.y);
            maxDy = Math.min(maxDy, CANVAS_H - mem.h - mem.y);
          }
        }
        const effDx = Math.round(Math.max(minDx, Math.min(maxDx, dx + snapDx)));
        const effDy = Math.round(Math.max(minDy, Math.min(maxDy, dy + snapDy)));

        const nextBoxes: Record<string, BoxRect> = {};
        for (const mem of d.members) {
          nextBoxes[mem.id] = {
            x: Math.round(mem.x + effDx),
            y: Math.round(mem.y + effDy),
            w: mem.w,
            h: mem.h,
          };
        }
        liveBoxesRef.current = nextBoxes;
        setLiveBoxes(nextBoxes);
        setSnapOverlay({ lines, spacings });
        return;
      }

      const mem = d.members[0];
      if (!mem) return;

      if (d.mode === "line-start") {
        const endX = mem.x + mem.w;
        const endY = mem.y + mem.h;
        let nx = Math.max(0, Math.min(CANVAS_W, mem.x + dx));
        let ny = Math.max(0, Math.min(CANVAS_H, mem.y + dy));
        if (e.shiftKey) {
          if (Math.abs(endX - nx) >= Math.abs(endY - ny)) {
            ny = endY;
          } else {
            nx = endX;
          }
        }
        let nw = endX - nx;
        let nh = endY - ny;
        if (Math.hypot(nw, nh) < 12) {
          nw = nw >= 0 ? 12 : -12;
          nx = endX - nw;
        }
        const nextBoxes = {
          [mem.id]: {
            x: Math.round(nx),
            y: Math.round(ny),
            w: Math.round(nw),
            h: Math.round(nh),
          },
        };
        liveBoxesRef.current = nextBoxes;
        setLiveBoxes(nextBoxes);
        setSnapOverlay({ lines: [], spacings: [] });
      } else if (d.mode === "line-end") {
        let ex = Math.max(0, Math.min(CANVAS_W, mem.x + mem.w + dx));
        let ey = Math.max(0, Math.min(CANVAS_H, mem.y + mem.h + dy));
        if (e.shiftKey) {
          if (Math.abs(ex - mem.x) >= Math.abs(ey - mem.y)) {
            ey = mem.y;
          } else {
            ex = mem.x;
          }
        }
        let nw = ex - mem.x;
        let nh = ey - mem.y;
        if (Math.hypot(nw, nh) < 12) {
          nw = nw >= 0 ? 12 : -12;
        }
        const nextBoxes = {
          [mem.id]: {
            x: mem.x,
            y: mem.y,
            w: Math.round(nw),
            h: Math.round(nh),
          },
        };
        liveBoxesRef.current = nextBoxes;
        setLiveBoxes(nextBoxes);
        setSnapOverlay({ lines: [], spacings: [] });
      } else {
        const minW =
          mem.kind === "diagram"
            ? 320
            : mem.kind === "chart"
            ? 180
            : mem.kind === "table"
            ? 160
            : 32;
        const minH =
          mem.kind === "diagram" || mem.kind === "chart"
            ? 120
            : mem.kind === "table"
            ? 60
            : 24;
        const nw = Math.round(
          Math.max(minW, Math.min(CANVAS_W - mem.x, mem.w + dx))
        );
        const nh = Math.round(
          Math.max(minH, Math.min(CANVAS_H - mem.y, mem.h + dy))
        );
        const nextBoxes = {
          [mem.id]: { x: mem.x, y: mem.y, w: nw, h: nh },
        };
        liveBoxesRef.current = nextBoxes;
        setLiveBoxes(nextBoxes);
        setSnapOverlay({ lines: [], spacings: [] });
      }
    };

    const onPointerUp = () => {
      const m = marqueeRef.current;
      if (m) {
        marqueeRef.current = null;
        setMarqueeRect(null);
        if (m.moved) {
          suppressBgClickRef.current = true;
        }
        return;
      }

      const d = dragRef.current;
      if (!d) return;
      const finalBoxes = liveBoxesRef.current;
      dragRef.current = null;
      liveBoxesRef.current = null;
      setLiveBoxes(null);
      setSnapOverlay({ lines: [], spacings: [] });

      if (!d.moved) {
        if (d.collapseOnClick) {
          onSelectElements?.([d.clickedId]);
        }
        return;
      }

      if (!finalBoxes) return;
      const ids = Object.keys(finalBoxes);
      if (ids.length === 1 && onUpdateElement) {
        const id = ids[0];
        const b = finalBoxes[id];
        onUpdateElement(id, { x: b.x, y: b.y, w: b.w, h: b.h });
      } else if (ids.length > 1) {
        const patches: Record<string, Partial<CanvasElement>> = {};
        for (const id of ids) {
          const b = finalBoxes[id];
          patches[id] = { x: b.x, y: b.y, w: b.w, h: b.h };
        }
        if (onBatchUpdateElements) {
          onBatchUpdateElements(patches);
        } else if (onUpdateElement) {
          for (const [id, patch] of Object.entries(patches)) {
            onUpdateElement(id, patch);
          }
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [
    interactive,
    scale,
    elements,
    onUpdateElement,
    onBatchUpdateElements,
    onSelectElements,
  ]);

  const startDrag = (
    e: React.PointerEvent,
    el: CanvasElement,
    mode: "move" | "resize" | "line-start" | "line-end"
  ) => {
    if (!interactive || e.button !== 0) return;
    if (
      editingTextId === el.id ||
      editingTableCell?.elId === el.id ||
      editingDiagramField?.elId === el.id
    ) {
      return;
    }
    e.stopPropagation();

    if (editingTextId) {
      onStartEditText?.(null);
    }
    if (editingTableCell) setEditingTableCell(null);
    if (editingDiagramField) setEditingDiagramField(null);

    // Shift+click toggles membership cleanly without initiating a drag
    if (mode === "move" && e.shiftKey) {
      const next = selectedSet.has(el.id)
        ? selectedElementIds.filter((id) => id !== el.id)
        : [...selectedElementIds, el.id];
      onSelectElements?.(next);
      return;
    }

    const isAlreadyInMulti =
      mode === "move" &&
      selectedElementIds.length > 1 &&
      selectedSet.has(el.id);

    let dragMembers: CanvasElement[];
    if (isAlreadyInMulti) {
      dragMembers = elements.filter((item) => selectedSet.has(item.id));
    } else {
      onSelectElements?.([el.id]);
      dragMembers = [el];
    }

    if (!onUpdateElement && !onBatchUpdateElements) return;

    const groupBounds =
      computeGroupBounds(dragMembers) ?? getElementBounds(el);

    dragRef.current = {
      mode,
      clickedId: el.id,
      collapseOnClick: isAlreadyInMulti,
      members: dragMembers.map((m) => ({
        id: m.id,
        x: m.x,
        y: m.y,
        w: m.w,
        h: m.h,
        kind: m.kind,
      })),
      groupBounds,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button !== 0) return;
    if (editingTextId) {
      onStartEditText?.(null);
    }
    if (editingTableCell) setEditingTableCell(null);
    if (editingDiagramField) setEditingDiagramField(null);
    const safeScale = scale > 0.05 ? scale : 0.75;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    marqueeRef.current = {
      startX: Math.max(0, Math.min(CANVAS_W, (e.clientX - rect.left) / safeScale)),
      startY: Math.max(0, Math.min(CANVAS_H, (e.clientY - rect.top) / safeScale)),
      additive: e.shiftKey,
      baseSelection: [...selectedElementIds],
      moved: false,
    };
  };

  const resolvedElements = elements.map((rawEl) => {
    const live = liveBoxes?.[rawEl.id];
    return live
      ? { ...rawEl, x: live.x, y: live.y, w: live.w, h: live.h }
      : rawEl;
  });

  const multiGroupBounds =
    interactive && selectedElementIds.length > 1
      ? computeGroupBounds(
          resolvedElements.filter((el) => selectedSet.has(el.id))
        )
      : null;

  const isSingleSelected = selectedElementIds.length === 1;

  return (
    <div
      ref={canvasRef}
      onPointerDown={handleCanvasPointerDown}
      onClick={() => {
        if (!interactive) return;
        if (suppressBgClickRef.current) {
          suppressBgClickRef.current = false;
          return;
        }
        onStartEditText?.(null);
        onSelectElements?.([]);
      }}
      className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 transition-colors duration-200 select-none"
      style={{
        transform: `scale(${scale})`,
        backgroundColor: bg,
      }}
    >
      {resolvedElements.map((el, idx) => {
        const key = `${el.id || "el"}-${idx}`;
        const isSelected = interactive && selectedSet.has(el.id);
        const isEditingThisText =
          interactive && el.kind === "text" && editingTextId === el.id;

        if (el.kind === "line") {
          const lineCol =
            resolveCanvasColor(el.color, sw, sw.divider) || sw.divider;
          const lw = el.line_width ?? 1.5;

          return (
            <svg
              key={key}
              width={CANVAS_W}
              height={CANVAS_H}
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              style={{
                position: "absolute",
                inset: 0,
                width: CANVAS_W,
                height: CANVAS_H,
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
                  onClick={(e) => e.stopPropagation()}
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
                <line
                  x1={el.x}
                  y1={el.y}
                  x2={el.x + el.w}
                  y2={el.y + el.h}
                  stroke={SELECTION_COLOR}
                  strokeOpacity={0.45}
                  strokeWidth={lw + 4}
                  strokeLinecap="round"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {isSelected && isSingleSelected && onUpdateElement && (
                <>
                  <circle
                    cx={el.x}
                    cy={el.y}
                    r={11}
                    fill="transparent"
                    style={{ pointerEvents: "all", cursor: "grab" }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => startDrag(e, el, "line-start")}
                  >
                    <title>拖拽起点（按住 Shift 吸附水平/垂直）</title>
                  </circle>
                  <circle
                    cx={el.x}
                    cy={el.y}
                    r={5}
                    fill={SELECTION_COLOR}
                    stroke="#FFFFFF"
                    strokeWidth={1.75}
                    style={{ pointerEvents: "none" }}
                  />
                  <circle
                    cx={el.x + el.w}
                    cy={el.y + el.h}
                    r={11}
                    fill="transparent"
                    style={{ pointerEvents: "all", cursor: "grab" }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => startDrag(e, el, "line-end")}
                  >
                    <title>拖拽终点（按住 Shift 吸附水平/垂直）</title>
                  </circle>
                  <circle
                    cx={el.x + el.w}
                    cy={el.y + el.h}
                    r={5}
                    fill={SELECTION_COLOR}
                    stroke="#FFFFFF"
                    strokeWidth={1.75}
                    style={{ pointerEvents: "none" }}
                  />
                </>
              )}
            </svg>
          );
        }

        const isEditingThisElement =
          isEditingThisText ||
          editingTableCell?.elId === el.id ||
          editingDiagramField?.elId === el.id;

        const selectionStyle: React.CSSProperties = isEditingThisElement
          ? {
              outline: `2px solid ${SELECTION_COLOR}`,
              outlineOffset: 2,
              boxShadow: "0 0 0 4px rgba(61, 99, 221, 0.16)",
              borderRadius: 4,
              zIndex: 35,
            }
          : isSelected
          ? {
              outline: `1.5px solid ${SELECTION_COLOR}`,
              outlineOffset: 1,
            }
          : {};

        const resizeHandle =
          isSelected &&
          isSingleSelected &&
          !isEditingThisElement &&
          onUpdateElement ? (
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
                backgroundColor: SELECTION_COLOR,
                border: "2px solid #FFFFFF",
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
              title={
                interactive
                  ? "拖拽移动 · 双击在属性栏替换配图 · Shift+点击多选"
                  : undefined
              }
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
              }}
              onDoubleClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelectElements?.([el.id]);
                onFocusField?.("custom-element-editor");
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
          const isEditingThisTable = editingTableCell?.elId === el.id;
          return (
            <div
              key={key}
              title={
                interactive && !isEditingThisTable
                  ? "拖拽移动 · 双击单元格直接编辑 · Shift+点击多选"
                  : undefined
              }
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                cursor: isEditingThisTable
                  ? "text"
                  : interactive
                  ? "move"
                  : "default",
                pointerEvents: interactive ? "auto" : "none",
                ...selectionStyle,
              }}
            >
              <CustomTableView
                el={el}
                sw={sw}
                slideBg={bg}
                interactive={interactive && Boolean(onUpdateElement)}
                editingCell={
                  isEditingThisTable && editingTableCell
                    ? { row: editingTableCell.row, col: editingTableCell.col }
                    : null
                }
                onStartEditCell={(cell) => {
                  if (cell) {
                    onStartEditText?.(null);
                    setEditingDiagramField(null);
                    onSelectElements?.([el.id]);
                    setEditingTableCell({ elId: el.id, ...cell });
                  } else {
                    setEditingTableCell(null);
                  }
                }}
                onUpdateCell={(row, col, val) => {
                  if (!onUpdateElement) return;
                  if (row === -1) {
                    const nextHeaders = [...(el.headers || [])];
                    nextHeaders[col] = val;
                    onUpdateElement(el.id, { headers: nextHeaders });
                  } else {
                    const nextRows = (el.rows || []).map((r) => [...r]);
                    while (nextRows.length <= row) nextRows.push([]);
                    nextRows[row][col] = val;
                    onUpdateElement(el.id, { rows: nextRows });
                  }
                }}
              />
              {resizeHandle}
            </div>
          );
        }

        if (el.kind === "chart") {
          return (
            <div
              key={key}
              title={
                interactive
                  ? "拖拽移动 · 双击在属性栏编辑图表数据 · Shift+点击多选"
                  : undefined
              }
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
              }}
              onDoubleClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                onSelectElements?.([el.id]);
                onFocusField?.("custom-element-editor");
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

        if (el.kind === "diagram") {
          const isEditingThisDiagram = editingDiagramField?.elId === el.id;
          return (
            <div
              key={key}
              title={
                interactive && !isEditingThisDiagram
                  ? "拖拽移动 · 双击节点文字直接编辑 · Shift+点击多选"
                  : undefined
              }
              onClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
              }}
              onPointerDown={(e) => startDrag(e, el, "move")}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                cursor: isEditingThisDiagram
                  ? "text"
                  : interactive
                  ? "move"
                  : "default",
                pointerEvents: interactive ? "auto" : "none",
                ...selectionStyle,
              }}
            >
              <CustomDiagramView
                el={el}
                sw={sw}
                slideBg={bg}
                interactive={interactive && Boolean(onUpdateElement)}
                editingField={
                  isEditingThisDiagram && editingDiagramField
                    ? {
                        stepIdx: editingDiagramField.stepIdx,
                        field: editingDiagramField.field,
                      }
                    : null
                }
                onStartEditField={(target) => {
                  if (target) {
                    onStartEditText?.(null);
                    setEditingTableCell(null);
                    onSelectElements?.([el.id]);
                    setEditingDiagramField({ elId: el.id, ...target });
                  } else {
                    setEditingDiagramField(null);
                  }
                }}
                onUpdateStep={(stepIdx, field, val) => {
                  if (!onUpdateElement) return;
                  const nextSteps = (el.diagram_steps || []).map((st, idx) =>
                    idx === stepIdx ? { ...st, [field]: val } : st
                  );
                  onUpdateElement(el.id, { diagram_steps: nextSteps });
                }}
              />
              {resizeHandle}
            </div>
          );
        }

        // Text element (matches CUSTOM_PAD_X_PT=4, CUSTOM_PAD_Y_PT=2 in pptx_export.py)
        const fontSize = Math.round(el.font_size ?? 18);
        const rawLh = el.line_height;
        const computedLh =
          rawLh == null || rawLh <= 0
            ? fontSize * 1.35
            : rawLh <= 4
            ? fontSize * rawLh
            : rawLh;
        const lineHeight = Math.max(
          Math.round(fontSize * 1.15),
          Math.round(computedLh)
        );
        const color = resolveCanvasColor(el.color, sw, sw.body) || sw.body;

        return (
          <div
            key={key}
            title={
              interactive && !isEditingThisText
                ? "拖拽移动 · 双击直接编辑文字 · Shift+点击多选"
                : undefined
            }
            onClick={(e) => {
              if (!interactive) return;
              e.stopPropagation();
            }}
            onDoubleClick={(e) => {
              if (!interactive || !onUpdateElementText) return;
              e.stopPropagation();
              onSelectElements?.([el.id]);
              onStartEditText?.(el.id);
            }}
            onPointerDown={(e) => startDrag(e, el, "move")}
            className={
              interactive && !isSelected && !isEditingThisText
                ? "clickable-slot"
                : undefined
            }
            style={{
              position: "absolute",
              left: el.x,
              top: el.y,
              width: el.w,
              height: el.h,
              padding: isEditingThisText ? 0 : "2px 4px",
              boxSizing: "border-box",
              fontSize,
              lineHeight: `${lineHeight}px`,
              fontWeight: el.bold ? 700 : 400,
              letterSpacing: fontSize >= 28 ? "-0.02em" : undefined,
              color,
              textAlign: el.align ?? "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: isSelected || isEditingThisText ? "visible" : "hidden",
              cursor: isEditingThisText
                ? "text"
                : interactive
                ? "move"
                : "default",
              pointerEvents: interactive ? "auto" : "none",
              ...selectionStyle,
            }}
          >
            {isEditingThisText && onUpdateElementText ? (
              <InlineCustomTextarea
                el={el}
                fontSize={fontSize}
                lineHeight={lineHeight}
                color={color}
                onChange={(nextText) => onUpdateElementText(el.id, nextText)}
                onDone={() => onStartEditText?.(null)}
              />
            ) : (
              normalizeEscapedNewlines(el.text || "")
            )}
            {resizeHandle}
          </div>
        );
      })}

      {/* Group selection frame when 2+ elements are selected */}
      {multiGroupBounds && (
        <div
          style={{
            position: "absolute",
            left: multiGroupBounds.x - 3,
            top: multiGroupBounds.y - 3,
            width: multiGroupBounds.w + 6,
            height: multiGroupBounds.h + 6,
            border: `1px dashed ${SELECTION_COLOR}`,
            borderRadius: 4,
            backgroundColor: "rgba(61, 99, 221, 0.04)",
            pointerEvents: "none",
            zIndex: 38,
          }}
        />
      )}

      {/* Drag marquee selection box */}
      {interactive && marqueeRect && (
        <div
          style={{
            position: "absolute",
            left: marqueeRect.x,
            top: marqueeRect.y,
            width: marqueeRect.w,
            height: marqueeRect.h,
            border: `1px solid ${SELECTION_COLOR}`,
            backgroundColor: "rgba(61, 99, 221, 0.14)",
            borderRadius: 2,
            pointerEvents: "none",
            zIndex: 42,
          }}
        />
      )}

      {/* Smart Snap Alignment Lines + Equal-Spacing Gap Indicators */}
      {interactive &&
        (snapOverlay.lines.length > 0 || snapOverlay.spacings.length > 0) && (
          <svg
            width={CANVAS_W}
            height={CANVAS_H}
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            style={{
              position: "absolute",
              inset: 0,
              width: CANVAS_W,
              height: CANVAS_H,
              pointerEvents: "none",
              zIndex: 45,
              overflow: "visible",
            }}
          >
            {snapOverlay.lines.map((line, i) =>
              line.axis === "x" ? (
                <line
                  key={`sx-${i}-${line.pos}`}
                  x1={line.pos}
                  y1={line.start}
                  x2={line.pos}
                  y2={line.end}
                  stroke={GUIDE_COLOR}
                  strokeWidth={1}
                  strokeDasharray={line.isCanvas ? "4 3" : undefined}
                />
              ) : (
                <line
                  key={`sy-${i}-${line.pos}`}
                  x1={line.start}
                  y1={line.pos}
                  x2={line.end}
                  y2={line.pos}
                  stroke={GUIDE_COLOR}
                  strokeWidth={1}
                  strokeDasharray={line.isCanvas ? "4 3" : undefined}
                />
              )
            )}

            {snapOverlay.spacings.map((sp, i) => {
              const label = `${sp.gapPx}px`;
              const pillW = Math.max(28, label.length * 6.5 + 8);
              const pillH = 16;
              if (sp.axis === "x") {
                const midX = (sp.start + sp.end) / 2;
                const y = sp.cross;
                return (
                  <g key={`sp-x-${i}`}>
                    <line
                      x1={sp.start}
                      y1={y}
                      x2={sp.end}
                      y2={y}
                      stroke={GUIDE_COLOR}
                      strokeWidth={1.25}
                    />
                    <line
                      x1={sp.start}
                      y1={y - 5}
                      x2={sp.start}
                      y2={y + 5}
                      stroke={GUIDE_COLOR}
                      strokeWidth={1.25}
                    />
                    <line
                      x1={sp.end}
                      y1={y - 5}
                      x2={sp.end}
                      y2={y + 5}
                      stroke={GUIDE_COLOR}
                      strokeWidth={1.25}
                    />
                    <rect
                      x={midX - pillW / 2}
                      y={y - pillH / 2}
                      width={pillW}
                      height={pillH}
                      rx={4}
                      fill={GUIDE_COLOR}
                    />
                    <text
                      x={midX}
                      y={y + 3.5}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize={10}
                      fontWeight={600}
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {label}
                    </text>
                  </g>
                );
              }
              const midY = (sp.start + sp.end) / 2;
              const x = sp.cross;
              return (
                <g key={`sp-y-${i}`}>
                  <line
                    x1={x}
                    y1={sp.start}
                    x2={x}
                    y2={sp.end}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1.25}
                  />
                  <line
                    x1={x - 5}
                    y1={sp.start}
                    x2={x + 5}
                    y2={sp.start}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1.25}
                  />
                  <line
                    x1={x - 5}
                    y1={sp.end}
                    x2={x + 5}
                    y2={sp.end}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1.25}
                  />
                  <rect
                    x={x - pillW / 2}
                    y={midY - pillH / 2}
                    width={pillW}
                    height={pillH}
                    rx={4}
                    fill={GUIDE_COLOR}
                  />
                  <text
                    x={x}
                    y={midY + 3.5}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize={10}
                    fontWeight={600}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>
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
