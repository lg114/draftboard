"use client";

import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";
import { usePresence } from "../../lib/usePresence";

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
      { keys: ["?"], desc: "打开 / 关闭此快捷键面板" },
    ],
  },
  {
    title: "自由画布元素（选中后）",
    items: [
      { keys: ["←", "→", "↑", "↓"], desc: "微调位置（1px）" },
      { keys: ["Shift", "方向键"], desc: "大步移动（10px）" },
      { keys: ["Ctrl / ⌘", "D"], desc: "复制选中元素" },
      { keys: ["Delete"], desc: "删除选中元素" },
      { keys: ["Esc"], desc: "取消选中 / 关闭弹层" },
    ],
  },
  {
    title: "放映与演讲者视图",
    items: [
      { keys: ["←", "→", "空格"], desc: "切换上一页 / 下一页" },
      { keys: ["F"], desc: "进入或退出全屏放映" },
      { keys: ["P"], desc: "切换放映 / 演讲者视图" },
    ],
  },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const { mounted, exiting } = usePresence(open, 160);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="快捷键速查"
      onClick={onClose}
      className={`fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-4 sm:p-6 ${
        exiting ? "anim-scrim-out pointer-events-none" : "anim-scrim-in"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md bg-surface rounded-2xl border border-black/[0.1] shadow-2xl overflow-hidden ${
          exiting ? "anim-modal-out" : "anim-modal-in"
        }`}
      >
        <div className="px-5 py-3.5 border-b border-black/[0.08] bg-surface-subtle flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-ink shrink-0" />
            <h2 className="text-[15px] font-semibold text-ink">快捷键速查</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭 (Esc)"
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.06] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto clean-scroll">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2">
              <div className="text-[13px] font-semibold text-ink-secondary">
                {group.title}
              </div>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.desc}
                    className="flex items-center justify-between gap-3 py-1 text-[13px]"
                  >
                    <span className="text-ink">{item.desc}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="px-1.5 py-0.5 rounded-md bg-canvas border border-black/[0.12] text-[12.5px] font-mono text-ink-secondary shadow-[0_1px_0_rgba(0,0,0,0.06)]"
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
    </div>
  );
}
