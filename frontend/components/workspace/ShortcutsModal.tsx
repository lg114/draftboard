"use client";

import { Keyboard, X } from "lucide-react";
import { useModalDialog } from "../../lib/useModalDialog";

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS: {
  title: string;
  items: { keys: string[]; desc: string }[];
}[] = [
  {
    title: "工作台通用",
    items: [
      { keys: ["Ctrl / ⌘", "S"], desc: "保存当前大纲" },
      { keys: ["Ctrl / ⌘", "Z"], desc: "撤销上一步修改" },
      { keys: ["Ctrl / ⌘", "Shift", "Z"], desc: "重做修改" },
      { keys: ["Ctrl / ⌘", "L"], desc: "展开或切换至 AI 对话" },
      { keys: ["?"], desc: "打开或关闭此快捷键面板" },
    ],
  },
  {
    title: "画布缩放与平移",
    items: [
      { keys: ["Ctrl / ⌘", "滚轮"], desc: "以鼠标为中心缩放幻灯片" },
      { keys: ["Ctrl / ⌘", "+ / -"], desc: "放大或缩小画布" },
      { keys: ["Ctrl / ⌘", "0"], desc: "重置为 100% 适配画布" },
      { keys: ["空格 + 拖拽"], desc: "放大后平移画布（支持中键拖拽）" },
    ],
  },
  {
    title: "画布编辑与多选",
    items: [
      { keys: ["双击文字"], desc: "在画布内直接就地编辑文案（标准与自由画布通用）" },
      { keys: ["Shift", "点击 / 框选"], desc: "多选自由画布元素并批量移动或对齐分布" },
      { keys: ["Ctrl / ⌘", "A"], desc: "全选当前自由画布全部元素" },
      { keys: ["Alt", "拖拽"], desc: "暂时关闭智能吸附参考线以微调位置" },
      { keys: ["←", "→", "↑", "↓"], desc: "微调选中元素位置（1px，配 Shift 为 10px）" },
      { keys: ["Ctrl / ⌘", "D"], desc: "复制选中元素（支持多选批量复制）" },
      { keys: ["Delete"], desc: "删除选中元素（支持多选批量删除）" },
      { keys: ["Esc"], desc: "退出文字编辑、取消选中或关闭弹层" },
    ],
  },
  {
    title: "成稿预览",
    items: [
      { keys: ["←", "→", "空格"], desc: "切换上一页或下一页" },
      { keys: ["F"], desc: "进入或退出全屏预览" },
    ],
  },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const { dialogRef, handleDialogClose } = useModalDialog(open, onClose);

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby="shortcuts-title"
      onClose={handleDialogClose}
      className="ui-modal-dialog w-[min(460px,calc(100dvw-2rem))] max-h-[82dvh] rounded-2xl bg-ui-surface ring-1 ring-ui-border-subtle shadow-[0_24px_72px_rgba(0,0,0,0.72)] overflow-clip anim-modal-in"
    >
      {open && (
        <div className="w-full flex flex-col min-h-0 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-ui-icon shrink-0" />
              <h1
                id="shortcuts-title"
                className="text-[15px] font-semibold tracking-[-0.015em] text-ui-text"
              >
                快捷键速查
              </h1>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              title="关闭 (Esc)"
              className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 px-5 pb-5 space-y-5 overflow-y-auto clean-scroll">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title} className="space-y-2">
                <div className="text-[12px] font-medium text-ui-text-muted">
                  {group.title}
                </div>
                <div className="rounded-xl bg-ui-bg px-3.5 py-1.5 space-y-1">
                  {group.items.map((item) => (
                    <div
                      key={item.desc}
                      className="flex items-center justify-between gap-3 py-1.5 text-[13px]"
                    >
                      <span className="text-ui-text-secondary">
                        {item.desc}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className="px-1.5 py-0.5 rounded-md bg-ui-surface text-[12px] font-mono text-ui-text-secondary"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </dialog>
  );
}
