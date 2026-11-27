"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Copy,
  Minus,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { CanvasElement, Material, ThemeSwatches } from "../../../lib/api";
import { resolveCanvasColor } from "../CustomSlideLayer";

interface SelectedElementBarProps {
  selectedEl: CanvasElement;
  sw: ThemeSwatches;
  imageAssets: Material[];
  onUpdate: (elementId: string, patch: Partial<CanvasElement>) => void;
  onFocusField: (fieldId: string) => void;
  onInlineEditText?: (elementId: string) => void;
  onReorder?: (elementId: string, dir: "front" | "back") => void;
  onDuplicate?: (elementId: string) => void;
  onDelete?: (elementId: string) => void;
  onClose: () => void;
}

const KIND_LABELS: Record<CanvasElement["kind"], string> = {
  text: "文本",
  card: "卡片",
  image: "图片",
  table: "表格",
  chart: "图表",
  diagram: "图示",
  line: "线条",
};

export function SelectedElementBar({
  selectedEl,
  sw,
  imageAssets,
  onUpdate,
  onFocusField,
  onInlineEditText,
  onReorder,
  onDuplicate,
  onDelete,
  onClose,
}: SelectedElementBarProps) {
  return (
    <div
      key="selected-element-bar"
      className="ui-popover rounded-xl px-2.5 py-1.5 flex items-center gap-2 flex-nowrap max-w-full overflow-x-auto clean-scroll text-[12.5px] anim-dock-swap"
    >
      <span className="px-2 py-0.5 rounded-md bg-ui-bg font-medium text-ui-text-secondary whitespace-nowrap shrink-0">
        {KIND_LABELS[selectedEl.kind]}
      </span>

      {selectedEl.kind === "text" && (
        <>
          <div className="flex items-center gap-0.5 bg-ui-bg rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  font_size: Math.max(10, (selectedEl.font_size ?? 18) - 2),
                })
              }
              title="减小字号"
              aria-label="减小字号"
              className="p-1 rounded-md hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-ui-text font-medium">
              {Math.round(selectedEl.font_size ?? 18)}pt
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  font_size: Math.min(72, (selectedEl.font_size ?? 18) + 2),
                })
              }
              title="增大字号"
              aria-label="增大字号"
              className="p-1 rounded-md hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            aria-pressed={Boolean(selectedEl.bold)}
            onClick={() => onUpdate(selectedEl.id, { bold: !selectedEl.bold })}
            title="加粗"
            aria-label="加粗"
            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
              selectedEl.bold
                ? "bg-ui-bg-selected text-ui-text"
                : "text-ui-icon hover:text-ui-text hover:bg-ui-control-hover"
            }`}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
            {(["left", "center", "right"] as const).map((al) => {
              const activeAl = (selectedEl.align ?? "left") === al;
              const Icon =
                al === "left"
                  ? AlignLeft
                  : al === "center"
                  ? AlignCenter
                  : AlignRight;
              const label =
                al === "left"
                  ? "左对齐"
                  : al === "center"
                  ? "居中对齐"
                  : "右对齐";
              return (
                <button
                  key={al}
                  type="button"
                  aria-pressed={activeAl}
                  onClick={() => onUpdate(selectedEl.id, { align: al })}
                  title={label}
                  aria-label={label}
                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                    activeAl
                      ? "bg-ui-bg-selected text-ui-text"
                      : "text-ui-icon hover:text-ui-text"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 px-1 shrink-0">
            {[
              { token: "theme:title", label: "主标题色" },
              { token: "theme:body", label: "正文色" },
              { token: "theme:accent", label: "强调色" },
              { token: "theme:muted", label: "次要色" },
              { token: "theme:cover_title", label: "反白色" },
            ].map((opt) => {
              const hex = resolveCanvasColor(opt.token, sw, sw.body) || sw.body;
              const activeCol = selectedEl.color === opt.token;
              return (
                <button
                  key={opt.token}
                  type="button"
                  aria-pressed={activeCol}
                  onClick={() => onUpdate(selectedEl.id, { color: opt.token })}
                  title={opt.label}
                  aria-label={opt.label}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    activeCol
                      ? "ring-[1.5px] ring-ui-text ring-offset-[1.5px] ring-offset-ui-surface scale-105"
                      : "ring-1 ring-white/30 hover:scale-110"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              if (onInlineEditText) {
                onInlineEditText(selectedEl.id);
              } else {
                onFocusField(`custom-el-${selectedEl.id}`);
              }
            }}
            title="直接在画布内编辑文案（也可双击文本框）"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-ui-bg hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Pencil className="w-3.5 h-3.5 text-ui-icon" />
            <span>改文案</span>
          </button>
        </>
      )}

      {selectedEl.kind === "card" && (
        <>
          <div className="flex items-center gap-1.5 px-1 shrink-0">
            {[
              { token: "theme:surface", label: "卡片表面" },
              { token: "theme:bg", label: "画布底色" },
              { token: "theme:accent", label: "强调色填充" },
              { token: "theme:cover_bg", label: "深色背景" },
            ].map((opt) => {
              const hex =
                resolveCanvasColor(opt.token, sw, sw.surface) || sw.surface;
              const activeCol =
                (selectedEl.fill ?? "theme:surface") === opt.token;
              return (
                <button
                  key={opt.token}
                  type="button"
                  aria-pressed={activeCol}
                  onClick={() => onUpdate(selectedEl.id, { fill: opt.token })}
                  title={opt.label}
                  aria-label={opt.label}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    activeCol
                      ? "ring-[1.5px] ring-ui-text ring-offset-[1.5px] ring-offset-ui-surface scale-105"
                      : "ring-1 ring-white/30 hover:scale-110"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-0.5 bg-ui-bg rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  radius: Math.max(0, (selectedEl.radius ?? 12) - 4),
                })
              }
              title="减小圆角"
              aria-label="减小圆角"
              className="p-1 rounded-md hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-ui-text">
              R{Math.round(selectedEl.radius ?? 12)}
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  radius: Math.min(48, (selectedEl.radius ?? 12) + 4),
                })
              }
              title="增大圆角"
              aria-label="增大圆角"
              className="p-1 rounded-md hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            aria-pressed={Boolean(selectedEl.border_color)}
            onClick={() =>
              onUpdate(selectedEl.id, {
                border_color: selectedEl.border_color ? null : "theme:divider",
                border_width: selectedEl.border_color ? 0 : 1,
              })
            }
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              selectedEl.border_color
                ? "bg-ui-bg-selected text-ui-text"
                : "bg-ui-bg text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover"
            }`}
          >
            边框
          </button>
        </>
      )}

      {selectedEl.kind === "image" && (
        <>
          <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
            {(
              [
                { v: "cover", l: "填满裁切" },
                { v: "contain", l: "完整适应" },
              ] as const
            ).map((opt) => {
              const activeFit = (selectedEl.fit ?? "contain") === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  aria-pressed={activeFit}
                  onClick={() => onUpdate(selectedEl.id, { fit: opt.v })}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeFit
                      ? "bg-ui-bg-selected text-ui-text"
                      : "text-ui-text-muted hover:text-ui-text"
                  }`}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
          {imageAssets.length > 1 && (
            <select
              aria-label="切换配图"
              value={selectedEl.image_asset_id || ""}
              onChange={(e) =>
                onUpdate(selectedEl.id, { image_asset_id: e.target.value })
              }
              className="ui-field bg-ui-bg px-2 py-1 text-[12.5px] cursor-pointer max-w-[160px]"
            >
              {imageAssets.map((img) => (
                <option key={img.asset_id} value={img.asset_id}>
                  {img.asset_id}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {selectedEl.kind === "table" && (
        <>
          <div className="flex items-center gap-0.5 bg-ui-bg rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  table_font_size: Math.max(
                    10,
                    (selectedEl.table_font_size ?? 14) - 1
                  ),
                })
              }
              title="减小表内字号"
              aria-label="减小表内字号"
              className="p-1 rounded-md hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-ui-text">
              {Math.round(selectedEl.table_font_size ?? 14)}pt
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  table_font_size: Math.min(
                    20,
                    (selectedEl.table_font_size ?? 14) + 1
                  ),
                })
              }
              title="增大表内字号"
              aria-label="增大表内字号"
              className="p-1 rounded-md hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              const isAccent = selectedEl.header_fill === "theme:accent";
              onUpdate(selectedEl.id, {
                header_fill: isAccent ? "theme:surface" : "theme:accent",
                header_color: isAccent ? "theme:title" : "theme:cover_title",
              });
            }}
            className="px-2.5 py-1 rounded-lg bg-ui-bg hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {selectedEl.header_fill === "theme:accent" ? "浅色表头" : "强调表头"}
          </button>
        </>
      )}

      {selectedEl.kind === "chart" && (
        <>
          <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
            {(
              [
                { v: "bar", l: "柱状" },
                { v: "stacked_bar", l: "堆叠" },
                { v: "hbar", l: "条形" },
                { v: "line", l: "折线" },
                { v: "donut", l: "环形" },
              ] as const
            ).map((opt) => {
              const activeCt = (selectedEl.chart_type ?? "bar") === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  aria-pressed={activeCt}
                  onClick={() => onUpdate(selectedEl.id, { chart_type: opt.v })}
                  className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeCt
                      ? "bg-ui-bg-selected text-ui-text"
                      : "text-ui-text-muted hover:text-ui-text"
                  }`}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-pressed={selectedEl.show_values !== false}
            onClick={() =>
              onUpdate(selectedEl.id, {
                show_values: selectedEl.show_values === false,
              })
            }
            className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              selectedEl.show_values !== false
                ? "bg-ui-bg-selected text-ui-text"
                : "bg-ui-bg text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover"
            }`}
          >
            数值标签
          </button>
        </>
      )}

      {selectedEl.kind === "diagram" && (
        <>
          <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
            {(
              [
                { v: "timeline", l: "时间轴" },
                { v: "process", l: "流程步骤" },
              ] as const
            ).map((opt) => {
              const activeDt = (selectedEl.diagram_type ?? "timeline") === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  aria-pressed={activeDt}
                  onClick={() =>
                    onUpdate(selectedEl.id, { diagram_type: opt.v })
                  }
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeDt
                      ? "bg-ui-bg-selected text-ui-text"
                      : "text-ui-text-muted hover:text-ui-text"
                  }`}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={(selectedEl.diagram_steps?.length ?? 0) >= 6}
            onClick={() => {
              const steps = selectedEl.diagram_steps || [];
              if (steps.length >= 6) return;
              const nextNum = steps.length + 1;
              onUpdate(selectedEl.id, {
                diagram_steps: [
                  ...steps,
                  {
                    label:
                      (selectedEl.diagram_type ?? "timeline") === "timeline"
                        ? `Q${nextNum}`
                        : String(nextNum).padStart(2, "0"),
                    title: `阶段 ${nextNum}`,
                    desc: "补充本阶段核心交付与里程碑",
                  },
                ],
              });
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-ui-bg hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-ui-icon" />
            <span>加阶段</span>
          </button>
        </>
      )}

      {selectedEl.kind === "line" && (
        <div className="flex items-center gap-1.5 px-1 shrink-0">
          {[
            { token: "theme:accent", label: "强调色" },
            { token: "theme:divider", label: "分割线色" },
            { token: "theme:title", label: "主标题色" },
          ].map((opt) => {
            const hex =
              resolveCanvasColor(opt.token, sw, sw.divider) || sw.divider;
            const activeCol = (selectedEl.color ?? "theme:divider") === opt.token;
            return (
              <button
                key={opt.token}
                type="button"
                aria-pressed={activeCol}
                onClick={() => onUpdate(selectedEl.id, { color: opt.token })}
                title={opt.label}
                aria-label={opt.label}
                className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                  activeCol
                    ? "ring-[1.5px] ring-ui-text ring-offset-[1.5px] ring-offset-ui-surface scale-105"
                    : "ring-1 ring-white/30 hover:scale-110"
                }`}
                style={{ backgroundColor: hex }}
              />
            );
          })}
          <button
            type="button"
            onClick={() =>
              onUpdate(selectedEl.id, {
                line_width: (selectedEl.line_width ?? 1.5) >= 2.5 ? 1.5 : 3,
              })
            }
            className="px-2.5 py-1 rounded-lg bg-ui-bg hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            {(selectedEl.line_width ?? 1.5) >= 2.5 ? "细线" : "粗线"}
          </button>
        </div>
      )}

      <div className="w-px h-4 bg-ui-border-subtle shrink-0" />

      {onReorder && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onReorder(selectedEl.id, "front")}
            title="置于顶层"
            aria-label="置于顶层"
            className="p-1.5 rounded-lg text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
          >
            <ArrowUpToLine className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onReorder(selectedEl.id, "back")}
            title="置于底层"
            aria-label="置于底层"
            className="p-1.5 rounded-lg text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {onDuplicate && (
        <button
          type="button"
          onClick={() => onDuplicate(selectedEl.id)}
          title="复制元素 (Ctrl/⌘+D)"
          aria-label="复制元素"
          className="p-1.5 rounded-lg text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(selectedEl.id)}
          title="删除选中元素（Delete / Backspace，支持 Ctrl+Z 撤销）"
          aria-label="删除选中元素"
          className="p-1.5 rounded-lg text-ui-icon hover:text-ui-danger hover:bg-ui-danger-bg transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        title="完成选中 (Esc)"
        aria-label="完成选中"
        className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
