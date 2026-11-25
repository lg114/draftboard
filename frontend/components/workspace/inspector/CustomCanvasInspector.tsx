"use client";

import { useState } from "react";
import { BookmarkPlus, Layers, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import type { CanvasElement, OutlineItem } from "../../../lib/api";
import { Collapse } from "../../ui/Collapse";
import { AutoGrowTextarea } from "./inspectorUtils";

interface CustomCanvasInspectorProps {
  item: OutlineItem;
  primaryInputBase: string;
  onUpdateCustomElementText?: (elementId: string, text: string) => void;
  onUpdateCustomElement?: (
    elementId: string,
    patch: Partial<CanvasElement>
  ) => void;
  onSaveCustomLayout?: (name: string) => Promise<void>;
  onClearCustomLayout?: () => void;
  onSwitchToChat?: () => void;
}

export function CustomCanvasInspector({
  item,
  primaryInputBase,
  onUpdateCustomElementText,
  onUpdateCustomElement,
  onSaveCustomLayout,
  onClearCustomLayout,
  onSwitchToChat,
}: CustomCanvasInspectorProps) {
  const [saveLayoutOpen, setSaveLayoutOpen] = useState(false);
  const [saveLayoutName, setSaveLayoutName] = useState("");
  const [savingLayout, setSavingLayout] = useState(false);

  const elements = item.custom_elements || [];
  const customTextElements = elements.filter((el) => el.kind === "text");
  const customTableElements = elements.filter((el) => el.kind === "table");
  const customChartElements = elements.filter((el) => el.kind === "chart");

  let primaryCustomHeadingId: string | null = null;
  let maxFs = -1;
  for (const el of customTextElements) {
    const fs = el.font_size ?? 18;
    if (fs > maxFs) {
      maxFs = fs;
      primaryCustomHeadingId = el.id;
    }
  }

  return (
    <section className="space-y-4">
      <div className="p-3 rounded-xl bg-ui-surface space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-ui-icon shrink-0" />
            <span className="text-[13.5px] font-semibold text-ui-text whitespace-nowrap">
              自由画布排版
            </span>
            <span className="text-[12.5px] text-ui-text-muted shrink-0">
              {elements.length} 个元素
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onSaveCustomLayout && (
              <button
                type="button"
                onClick={() => {
                  setSaveLayoutName(item.title.slice(0, 18) || "常用自由版式");
                  setSaveLayoutOpen((v) => !v);
                }}
                title="将当前自由画布结构收藏为常用版式，随时复用到其他页面"
                className="ui-btn-subtle inline-flex items-center gap-1 px-2 py-1 text-[12px]"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>收藏</span>
              </button>
            )}
            {onClearCustomLayout && (
              <button
                type="button"
                onClick={onClearCustomLayout}
                title="放弃自由画布，恢复使用标准模板版式"
                className="ui-btn-subtle inline-flex items-center gap-1 px-2 py-1 text-[12px]"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>恢复标准</span>
              </button>
            )}
          </div>
        </div>
        <Collapse open={saveLayoutOpen && Boolean(onSaveCustomLayout)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!saveLayoutName.trim() || savingLayout || !onSaveCustomLayout)
                return;
              setSavingLayout(true);
              try {
                await onSaveCustomLayout(saveLayoutName.trim());
                setSaveLayoutOpen(false);
              } finally {
                setSavingLayout(false);
              }
            }}
            className="flex items-center gap-1.5 pt-1"
          >
            <input
              type="text"
              value={saveLayoutName}
              onChange={(e) => setSaveLayoutName(e.target.value)}
              placeholder="输入版式名称（如：3卡片KPI页）"
              className="ui-field flex-1 min-w-0 h-8 px-2.5 text-[12.5px]"
            />
            <button
              type="submit"
              disabled={savingLayout || !saveLayoutName.trim()}
              className="ui-btn-primary h-8 px-3 text-[12.5px] shrink-0"
            >
              {savingLayout ? "保存…" : "保存"}
            </button>
          </form>
        </Collapse>
        <p className="text-[12.5px] text-ui-text-muted leading-relaxed">
          点击左侧画布元素可直接拖拽、缩放、改配色或图表类型；也可以在下方修改文本与数据。
        </p>
        {onSwitchToChat && (
          <button
            type="button"
            onClick={onSwitchToChat}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ui-accent-text hover:underline cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>前往 AI 助手重构布局</span>
          </button>
        )}
      </div>

      {customTextElements.length > 0 ? (
        <div className="space-y-3">
          {customTextElements.map((el, idx) => {
            const isHeading = el.id === primaryCustomHeadingId;
            const fs = Math.round(el.font_size ?? 18);
            return (
              <div key={`${el.id}-${idx}`} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`custom-el-${el.id}`}
                    className="text-[12.5px] font-medium text-ui-text-muted truncate"
                  >
                    {isHeading ? "主标题文本" : `文本块 ${idx + 1}`}
                  </label>
                  <span className="text-[12px] text-ui-text-disabled font-mono shrink-0">
                    {fs}pt
                  </span>
                </div>
                <AutoGrowTextarea
                  id={`custom-el-${el.id}`}
                  value={el.text || ""}
                  minRows={isHeading ? 1 : 2}
                  placeholder="输入文本内容…"
                  onChange={(val) => onUpdateCustomElementText?.(el.id, val)}
                  className={primaryInputBase}
                />
              </div>
            );
          })}
        </div>
      ) : customTableElements.length === 0 &&
        customChartElements.length === 0 ? (
        <div className="p-3 rounded-xl bg-ui-surface text-[13px] text-ui-text-muted">
          本页自由画布暂无可编辑文本、表格或图表。
        </div>
      ) : null}

      {/* Inline Table Data Editors */}
      {customTableElements.length > 0 && onUpdateCustomElement && (
        <div className="space-y-3 pt-1">
          {customTableElements.map((el, tIdx) => {
            const headers = el.headers || [];
            const rows = el.rows || [];
            const colCount = Math.max(headers.length, rows[0]?.length || 0, 1);
            return (
              <div
                key={`${el.id}-tbl-${tIdx}`}
                className="rounded-xl bg-ui-surface p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ui-text">
                    {customTableElements.length > 1
                      ? `表格 ${tIdx + 1}`
                      : "表格数据"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newRow = Array.from({ length: colCount }, () => "");
                      onUpdateCustomElement(el.id, {
                        rows: [...rows, newRow],
                      });
                    }}
                    className="ui-btn-subtle inline-flex items-center gap-1 px-2 py-0.5 text-[12px]"
                  >
                    <Plus className="w-3 h-3" />
                    <span>加一行</span>
                  </button>
                </div>

                <div className="overflow-x-auto clean-scroll">
                  <table
                    className="w-full table-fixed border-collapse text-[12.5px]"
                    style={{
                      minWidth:
                        colCount >= 3
                          ? 92 + (colCount - 1) * 54 + 24
                          : colCount * 76 + 24,
                    }}
                  >
                    <colgroup>
                      {Array.from({ length: colCount }).map((_, ci) => (
                        <col
                          key={ci}
                          style={
                            ci === 0 && colCount >= 3
                              ? { width: "34%" }
                              : undefined
                          }
                        />
                      ))}
                      <col style={{ width: 24 }} />
                    </colgroup>
                    {headers.length > 0 && (
                      <thead>
                        <tr>
                          {headers.map((h, ci) => (
                            <th key={ci} className="p-0.5">
                              <input
                                type="text"
                                value={h}
                                onChange={(e) => {
                                  const nextHeaders = [...headers];
                                  nextHeaders[ci] = e.target.value;
                                  onUpdateCustomElement(el.id, {
                                    headers: nextHeaders,
                                  });
                                }}
                                placeholder={`列 ${ci + 1}`}
                                title={h}
                                className="ui-field w-full min-w-0 px-1.5 py-1 text-[12.5px] font-semibold"
                              />
                            </th>
                          ))}
                          <th className="w-6" />
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {rows.map((row, ri) => (
                        <tr key={ri}>
                          {Array.from({ length: colCount }).map((_, ci) => (
                            <td key={ci} className="p-0.5">
                              <input
                                type="text"
                                value={row[ci] ?? ""}
                                onChange={(e) => {
                                  const nextRows = rows.map((r, rIdx) => {
                                    if (rIdx !== ri) return r;
                                    const copy = Array.from(
                                      { length: colCount },
                                      (__, idx) => r[idx] ?? ""
                                    );
                                    copy[ci] = e.target.value;
                                    return copy;
                                  });
                                  onUpdateCustomElement(el.id, {
                                    rows: nextRows,
                                  });
                                }}
                                title={row[ci] ?? ""}
                                className="ui-field w-full min-w-0 px-1.5 py-1 text-[12.5px] bg-ui-bg"
                              />
                            </td>
                          ))}
                          <td className="w-6 p-0.5 text-center">
                            {rows.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateCustomElement(el.id, {
                                    rows: rows.filter((_, rIdx) => rIdx !== ri),
                                  })
                                }
                                title="删除该行"
                                className="p-1 rounded text-ui-icon-quiet hover:text-ui-danger hover:bg-ui-danger-bg cursor-pointer transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline Chart Data Editors */}
      {customChartElements.length > 0 && onUpdateCustomElement && (
        <div className="space-y-3 pt-1">
          {customChartElements.map((el, cIdx) => {
            const cats = el.chart_categories || [];
            const series = el.chart_series || [];
            return (
              <div
                key={`${el.id}-chart-${cIdx}`}
                className="rounded-xl bg-ui-surface border border-ui-border-subtle p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ui-text">
                    {customChartElements.length > 1
                      ? `图表 ${cIdx + 1}`
                      : "图表数据"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextCats = [...cats, `项 ${cats.length + 1}`];
                      const nextSeries = series.map((s) => ({
                        ...s,
                        values: [...s.values, 0],
                      }));
                      onUpdateCustomElement(el.id, {
                        chart_categories: nextCats,
                        chart_series: nextSeries,
                      });
                    }}
                    className="ui-btn-subtle inline-flex items-center gap-1 px-2 py-0.5 text-[12px]"
                  >
                    <Plus className="w-3 h-3" />
                    <span>加一项</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={el.chart_title || ""}
                    onChange={(e) =>
                      onUpdateCustomElement(el.id, {
                        chart_title: e.target.value,
                      })
                    }
                    placeholder="图表标题（选填）"
                    title={el.chart_title || ""}
                    className="ui-field flex-1 min-w-0 px-2.5 py-1.5 text-[12.5px]"
                  />
                  <input
                    type="text"
                    value={el.value_suffix || ""}
                    onChange={(e) =>
                      onUpdateCustomElement(el.id, {
                        value_suffix: e.target.value,
                      })
                    }
                    placeholder="单位"
                    title="数值单位后缀（如 %、万、ms）"
                    className="ui-field w-[62px] shrink-0 px-2 py-1.5 text-[12.5px]"
                  />
                </div>

                {cats.length > 0 && series.length > 0 && (
                  <div className="overflow-x-auto clean-scroll">
                    <table className="w-full border-collapse text-[12.5px]">
                      <thead>
                        <tr>
                          <th className="p-0.5 text-left text-[12px] font-medium text-ui-text-muted">
                            分类
                          </th>
                          {series.map((s, si) => (
                            <th key={si} className="p-0.5">
                              <input
                                type="text"
                                value={s.name}
                                onChange={(e) => {
                                  const nextSeries = series.map((itemS, idxS) =>
                                    idxS === si
                                      ? { ...itemS, name: e.target.value }
                                      : itemS
                                  );
                                  onUpdateCustomElement(el.id, {
                                    chart_series: nextSeries,
                                  });
                                }}
                                placeholder={`系列 ${si + 1}`}
                                className="ui-field w-full min-w-[58px] px-1.5 py-1 text-[12.5px] font-semibold"
                              />
                            </th>
                          ))}
                          <th className="w-6" />
                        </tr>
                      </thead>
                      <tbody>
                        {cats.map((cat, ri) => (
                          <tr key={ri}>
                            <td className="p-0.5">
                              <input
                                type="text"
                                value={cat}
                                onChange={(e) => {
                                  const nextCats = [...cats];
                                  nextCats[ri] = e.target.value;
                                  onUpdateCustomElement(el.id, {
                                    chart_categories: nextCats,
                                  });
                                }}
                                className="ui-field w-full min-w-[60px] px-1.5 py-1 text-[12.5px] bg-ui-bg"
                              />
                            </td>
                            {series.map((s, si) => (
                              <td key={si} className="p-0.5">
                                <input
                                  type="number"
                                  step="any"
                                  value={
                                    Number.isFinite(s.values[ri])
                                      ? s.values[ri]
                                      : 0
                                  }
                                  onChange={(e) => {
                                    const parsed = parseFloat(e.target.value);
                                    const num = Number.isFinite(parsed)
                                      ? parsed
                                      : 0;
                                    const nextSeries = series.map(
                                      (itemS, idxS) => {
                                        if (idxS !== si) return itemS;
                                        const nextVals = [...itemS.values];
                                        nextVals[ri] = num;
                                        return { ...itemS, values: nextVals };
                                      }
                                    );
                                    onUpdateCustomElement(el.id, {
                                      chart_series: nextSeries,
                                    });
                                  }}
                                  className="ui-field w-full min-w-[58px] px-1.5 py-1 text-[12.5px] bg-ui-bg font-mono tabular-nums"
                                />
                              </td>
                            ))}
                            <td className="p-0.5 text-center">
                              {cats.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onUpdateCustomElement(el.id, {
                                      chart_categories: cats.filter(
                                        (_, idxC) => idxC !== ri
                                      ),
                                      chart_series: series.map((s) => ({
                                        ...s,
                                        values: s.values.filter(
                                          (_, idxV) => idxV !== ri
                                        ),
                                      })),
                                    });
                                  }}
                                  title="删除该项"
                                  className="p-1 rounded text-ui-icon-quiet hover:text-ui-danger hover:bg-ui-danger-bg cursor-pointer transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
