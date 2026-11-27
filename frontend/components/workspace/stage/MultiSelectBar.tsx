"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Copy,
  Trash2,
  X,
} from "lucide-react";
import type { AlignMode, DistributeAxis } from "./snapGuides";

interface MultiSelectBarProps {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: DistributeAxis) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

const ALIGN_BUTTONS: Array<{
  mode: AlignMode;
  label: string;
  Icon: typeof AlignStartVertical;
}> = [
  { mode: "left", label: "左对齐", Icon: AlignStartVertical },
  { mode: "centerX", label: "水平居中对齐", Icon: AlignCenterVertical },
  { mode: "right", label: "右对齐", Icon: AlignEndVertical },
  { mode: "top", label: "顶对齐", Icon: AlignStartHorizontal },
  { mode: "centerY", label: "垂直居中对齐", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "底对齐", Icon: AlignEndHorizontal },
];

export function MultiSelectBar({
  count,
  onAlign,
  onDistribute,
  onDuplicate,
  onDelete,
  onClose,
}: MultiSelectBarProps) {
  const canDistribute = count >= 3;

  return (
    <div
      key="multi-select-bar"
      className="ui-popover rounded-xl px-2.5 py-1.5 flex items-center gap-2 flex-nowrap max-w-full overflow-x-auto clean-scroll text-[12.5px] anim-dock-swap"
    >
      <span className="px-2 py-0.5 rounded-md bg-ui-bg font-medium text-ui-text-secondary whitespace-nowrap shrink-0 tabular-nums">
        已选 {count} 个
      </span>

      {/* Horizontal & Vertical Alignment */}
      <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
        {ALIGN_BUTTONS.slice(0, 3).map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onAlign(mode)}
            title={label}
            aria-label={label}
            className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
        {ALIGN_BUTTONS.slice(3).map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onAlign(mode)}
            title={label}
            aria-label={label}
            className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>

      {/* Equal Distribution (3+ elements) */}
      <div className="flex items-center bg-ui-bg rounded-lg p-0.5 gap-0.5 shrink-0">
        <button
          type="button"
          disabled={!canDistribute}
          onClick={() => onDistribute("horizontal")}
          title={
            canDistribute
              ? "水平等距分布"
              : "水平等距分布（至少选中 3 个元素）"
          }
          aria-label="水平等距分布"
          className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-control-hover disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <AlignHorizontalDistributeCenter className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={!canDistribute}
          onClick={() => onDistribute("vertical")}
          title={
            canDistribute
              ? "垂直等距分布"
              : "垂直等距分布（至少选中 3 个元素）"
          }
          aria-label="垂直等距分布"
          className="p-1.5 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-control-hover disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <AlignVerticalDistributeCenter className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="w-px h-4 bg-ui-border-subtle shrink-0" />

      {onDuplicate && (
        <button
          type="button"
          onClick={onDuplicate}
          title="批量复制 (Ctrl/⌘+D)"
          aria-label="批量复制选中元素"
          className="p-1.5 rounded-lg text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="批量删除（Delete / Backspace，支持 Ctrl+Z 撤销）"
          aria-label="批量删除选中元素"
          className="p-1.5 rounded-lg text-ui-icon hover:text-ui-danger hover:bg-ui-danger-bg transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        title="取消选中 (Esc)"
        aria-label="取消选中"
        className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
