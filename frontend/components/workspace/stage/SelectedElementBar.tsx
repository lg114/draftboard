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
  line: "线条",
};

export function SelectedElementBar({
  selectedEl,
  sw,
  imageAssets,
  onUpdate,
  onFocusField,
  onReorder,
  onDuplicate,
  onDelete,
  onClose,
}: SelectedElementBarProps) {
  return (
    <div
      key="selected-element-bar"
      className="apple-glass dock-shadow rounded-2xl px-2.5 py-1.5 flex items-center gap-2 flex-nowrap max-w-full overflow-x-auto clean-scroll text-[13px] anim-dock-swap"
    >
      <span className="px-2 py-0.5 rounded-lg bg-black/[0.06] font-semibold text-ink whitespace-nowrap shrink-0">
        {KIND_LABELS[selectedEl.kind]}
      </span>

      {selectedEl.kind === "text" && (
        <>
          <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-xl p-0.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  font_size: Math.max(10, (selectedEl.font_size ?? 18) - 2),
                })
              }
              title="减小字号"
              className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono tabular-nums text-ink font-medium">
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
              className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onUpdate(selectedEl.id, { bold: !selectedEl.bold })}
            title="加粗"
            className={`p-1.5 rounded-xl transition-colors cursor-pointer shrink-0 ${
              selectedEl.bold
                ? "bg-surface text-ink shadow-2xs ring-1 ring-black/10"
                : "text-ink-secondary hover:bg-black/[0.05]"
            }`}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center bg-black/[0.05] rounded-xl p-0.5 gap-0.5 shrink-0">
            {(["left", "center", "right"] as const).map((al) => {
              const activeAl = (selectedEl.align ?? "left") === al;
              const Icon =
                al === "left"
                  ? AlignLeft
                  : al === "center"
                  ? AlignCenter
                  : AlignRight;
              return (
                <button
                  key={al}
                  type="button"
                  onClick={() => onUpdate(selectedEl.id, { align: al })}
                  title={
                    al === "left"
                      ? "左对齐"
                      : al === "center"
                      ? "居中对齐"
                      : "右对齐"
                  }
                  className={`p-1 rounded-lg transition-colors cursor-pointer ${
                    activeAl
                      ? "bg-surface text-ink shadow-2xs"
                      : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 shrink-0">
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
                  onClick={() => onUpdate(selectedEl.id, { color: opt.token })}
                  title={opt.label}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    activeCol
                      ? "ring-2 ring-ink ring-offset-1 scale-110"
                      : "ring-1 ring-black/20 hover:scale-110"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onFocusField(`custom-el-${selectedEl.id}`)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-black/[0.05] hover:bg-black/[0.1] text-ink font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>改文案</span>
          </button>
        </>
      )}

      {selectedEl.kind === "card" && (
        <>
          <div className="flex items-center gap-1 shrink-0">
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
                  onClick={() => onUpdate(selectedEl.id, { fill: opt.token })}
                  title={opt.label}
                  className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                    activeCol
                      ? "ring-2 ring-ink ring-offset-1 scale-110"
                      : "ring-1 ring-black/20 hover:scale-110"
                  }`}
                  style={{ backgroundColor: hex }}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-xl p-0.5 shrink-0">
            <button
              type="button"
              onClick={() =>
                onUpdate(selectedEl.id, {
                  radius: Math.max(0, (selectedEl.radius ?? 12) - 4),
                })
              }
              title="减小圆角"
              className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono text-ink">
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
              className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              onUpdate(selectedEl.id, {
                border_color: selectedEl.border_color ? null : "theme:divider",
                border_width: selectedEl.border_color ? 0 : 1,
              })
            }
            className={`px-2.5 py-1 rounded-xl font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              selectedEl.border_color
                ? "bg-surface text-ink ring-1 ring-black/10"
                : "bg-black/[0.05] text-ink-secondary hover:text-ink"
            }`}
          >
            边框
          </button>
        </>
      )}

      {selectedEl.kind === "image" && (
        <>
          <div className="flex items-center bg-black/[0.05] rounded-xl p-0.5 gap-0.5 shrink-0">
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
                  onClick={() => onUpdate(selectedEl.id, { fit: opt.v })}
                  className={`px-2.5 py-1 rounded-lg font-medium cursor-pointer whitespace-nowrap ${
                    activeFit
                      ? "bg-surface text-ink shadow-2xs"
                      : "text-ink-secondary hover:text-ink"
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
              className="bg-surface border border-black/15 rounded-xl px-2 py-1 text-[13px] text-ink outline-none cursor-pointer max-w-[160px]"
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
          <div className="flex items-center gap-0.5 bg-black/[0.05] rounded-xl p-0.5 shrink-0">
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
              className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono text-ink">
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
              className="p-1 rounded-lg hover:bg-surface text-ink cursor-pointer"
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
            className="px-2.5 py-1 rounded-xl bg-black/[0.05] hover:bg-black/[0.1] text-ink font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            {selectedEl.header_fill === "theme:accent" ? "浅色表头" : "强调表头"}
          </button>
        </>
      )}

      {selectedEl.kind === "chart" && (
        <>
          <div className="flex items-center bg-black/[0.05] rounded-xl p-0.5 gap-0.5 shrink-0">
            {(
              [
                { v: "bar", l: "柱状" },
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
                  onClick={() => onUpdate(selectedEl.id, { chart_type: opt.v })}
                  className={`px-2 py-1 rounded-lg font-medium cursor-pointer whitespace-nowrap ${
                    activeCt
                      ? "bg-surface text-ink shadow-2xs"
                      : "text-ink-secondary hover:text-ink"
                  }`}
                >
                  {opt.l}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              onUpdate(selectedEl.id, {
                show_values: selectedEl.show_values === false,
              })
            }
            className={`px-2.5 py-1 rounded-xl font-medium cursor-pointer whitespace-nowrap shrink-0 ${
              selectedEl.show_values !== false
                ? "bg-surface text-ink ring-1 ring-black/10"
                : "bg-black/[0.05] text-ink-secondary hover:text-ink"
            }`}
          >
            数值标签
          </button>
        </>
      )}

      {selectedEl.kind === "line" && (
        <div className="flex items-center gap-1.5 shrink-0">
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
                onClick={() => onUpdate(selectedEl.id, { color: opt.token })}
                title={opt.label}
                className={`w-4 h-4 rounded-full cursor-pointer ${
                  activeCol
                    ? "ring-2 ring-ink ring-offset-1"
                    : "ring-1 ring-black/20"
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
            className="px-2 py-1 rounded-xl bg-black/[0.05] hover:bg-black/[0.1] text-ink font-medium cursor-pointer whitespace-nowrap"
          >
            {(selectedEl.line_width ?? 1.5) >= 2.5 ? "细线" : "粗线"}
          </button>
        </div>
      )}

      <div className="w-px h-5 bg-black/[0.08] shrink-0" />

      {onReorder && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onReorder(selectedEl.id, "front")}
            title="置于顶层"
            className="p-1.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer"
          >
            <ArrowUpToLine className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onReorder(selectedEl.id, "back")}
            title="置于底层"
            className="p-1.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer"
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
          className="p-1.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(selectedEl.id)}
          title="删除选中元素（Delete / Backspace，支持 Ctrl+Z 撤销）"
          className="p-1.5 rounded-xl text-ink-muted hover:text-danger hover:bg-danger-bg transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        title="完成选中 (Esc)"
        className="p-1.5 rounded-xl text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
