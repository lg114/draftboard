"use client";

import { useRef, useState } from "react";
import {
  ChevronDown,
  FileDown,
  FileText,
  Images,
  Presentation,
} from "lucide-react";
import { useDismiss } from "../../lib/useDismiss";
import { usePresence } from "../../lib/usePresence";

interface ExportFormatMenuProps {
  pid: string;
  label?: string;
  includePptx?: boolean;
  canDownloadRendered?: boolean;
  canDownloadNotes?: boolean;
}

export function ExportFormatMenu({
  pid,
  label = "更多格式",
  includePptx = false,
  canDownloadRendered = true,
  canDownloadNotes = true,
}: ExportFormatMenuProps) {
  const [open, setOpen] = useState(false);
  const { mounted, exiting } = usePresence(open, 130);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, () => setOpen(false), [wrapRef]);

  if (!canDownloadRendered && !canDownloadNotes && !includePptx) {
    return null;
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        className={`h-8 px-2.5 rounded-lg text-[13px] font-medium text-ui-text-secondary hover:text-ui-text transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer ${
          open
            ? "bg-ui-bg-selected text-ui-text"
            : "bg-ui-surface-input hover:bg-ui-control-hover"
        }`}
      >
        <FileDown className="w-3.5 h-3.5 text-ui-icon lg:hidden" />
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ui-icon transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {mounted && (
        <div
          role="menu"
          className={`absolute right-0 top-full mt-2 z-50 w-64 ui-popover rounded-xl p-1.5 space-y-0.5 ${
            exiting
              ? "anim-popover-down-out pointer-events-none"
              : "anim-popover-down-in"
          }`}
        >
          {includePptx && (
            <a
              role="menuitem"
              href={`/api/projects/${pid}/download`}
              download
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-ui-control-hover transition-colors"
            >
              <Presentation className="w-4 h-4 text-ui-icon shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ui-text">
                  下载旧版 PPTX
                </div>
                <div className="text-[12px] text-ui-text-muted">
                  下载最近一次成功导出的文件
                </div>
              </div>
            </a>
          )}

          {canDownloadRendered && (
            <>
              <a
                role="menuitem"
                href={`/api/projects/${pid}/download/pdf`}
                download
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-ui-control-hover transition-colors"
              >
                <FileDown className="w-4 h-4 text-ui-icon shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ui-text">
                    导出矢量 PDF
                  </div>
                  <div className="text-[12px] text-ui-text-muted">
                    适合邮件审阅与跨设备分发
                  </div>
                </div>
              </a>
              <a
                role="menuitem"
                href={`/api/projects/${pid}/download/pngs.zip`}
                download
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-ui-control-hover transition-colors"
              >
                <Images className="w-4 h-4 text-ui-icon shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ui-text">
                    导出逐页高清 PNG (ZIP)
                  </div>
                  <div className="text-[12px] text-ui-text-muted">
                    1920×1080 逐页高清图包
                  </div>
                </div>
              </a>
            </>
          )}

          {canDownloadNotes && (
            <a
              role="menuitem"
              href={`/api/projects/${pid}/download/notes.md`}
              download
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 px-3 py-2 rounded-lg hover:bg-ui-control-hover transition-colors"
            >
              <FileText className="w-4 h-4 text-ui-icon shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ui-text">
                  演讲者讲稿与出处 (MD)
                </div>
                <div className="text-[12px] text-ui-text-muted">
                  含每页大纲、口播备注与溯源引用
                </div>
              </div>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
