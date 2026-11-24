"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  FileDown,
  FileText,
  Images,
  Presentation,
} from "lucide-react";
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!canDownloadRendered && !canDownloadNotes && !includePptx) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`px-3 py-1.5 rounded-full text-[13px] font-medium text-ink transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer ${
          open
            ? "bg-black/[0.1]"
            : "bg-black/[0.05] hover:bg-black/[0.1]"
        }`}
      >
        <span>{label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-ink-secondary transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {mounted && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className={`absolute right-0 top-full mt-2 z-50 w-64 apple-glass dock-shadow rounded-2xl p-1.5 space-y-0.5 ${
              exiting ? "anim-popover-down-out pointer-events-none" : "anim-popover-down-in"
            }`}
          >
            {includePptx && (
              <a
                role="menuitem"
                href={`/api/projects/${pid}/download`}
                download
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 px-3 py-2 rounded-xl hover:bg-black/[0.05] transition-colors"
              >
                <Presentation className="w-4 h-4 text-ink-secondary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">
                    下载旧版 PPTX
                  </div>
                  <div className="text-[13px] text-ink-muted">
                    上一版已导出的演示文稿
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
                  className="flex items-start gap-2.5 px-3 py-2 rounded-xl hover:bg-black/[0.05] transition-colors"
                >
                  <FileDown className="w-4 h-4 text-ink-secondary shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">
                      PDF 文档
                    </div>
                    <div className="text-[13px] text-ink-muted">
                      矢量排版，含逐页目录书签
                    </div>
                  </div>
                </a>

                <a
                  role="menuitem"
                  href={`/api/projects/${pid}/download/images`}
                  download
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-xl hover:bg-black/[0.05] transition-colors"
                >
                  <Images className="w-4 h-4 text-ink-secondary shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-ink">
                      逐页高清图片
                    </div>
                    <div className="text-[13px] text-ink-muted">
                      1920×1080 PNG 打包 (.zip)
                    </div>
                  </div>
                </a>
              </>
            )}

            {canDownloadNotes && (
              <a
                role="menuitem"
                href={`/api/projects/${pid}/download/notes`}
                download
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 px-3 py-2 rounded-xl hover:bg-black/[0.05] transition-colors"
              >
                <FileText className="w-4 h-4 text-ink-secondary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">
                    演讲者讲稿与出处
                  </div>
                  <div className="text-[13px] text-ink-muted">
                    含口播备注与素材溯源 (.md)
                  </div>
                </div>
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}
