"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
} from "lucide-react";
import { api, ExportReport, Preview, Project } from "../../../../lib/api";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const pid = useMemo(() => {
    const seg = pathname?.split("/").filter(Boolean)[1];
    return seg && seg !== "__placeholder__"
      ? decodeURIComponent(seg)
      : params.id;
  }, [pathname, params.id]);

  const [projectName, setProjectName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("");
  const [rendering, setRendering] = useState(false);

  const load = useCallback(async () => {
    try {
      const proj = await api<Project>(`/api/projects/${pid}`);
      setProjectName(proj.name || pid);
    } catch {
      setProjectName(pid);
    }
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview`);
      setPreview(p);
      setSelected((s) => Math.min(s, Math.max(0, p.pages.length - 1)));
      setNotice("");
    } catch (e) {
      setPreview(null);
      setNotice((e as Error).message);
    }
    try {
      const r = await api<ExportReport>(`/api/projects/${pid}/result`);
      setReport(r);
    } catch {
      setReport(null);
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!preview?.pages.length) return;
      if (e.key === "ArrowLeft") {
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "ArrowRight") {
        setSelected((s) => Math.min(preview.pages.length - 1, s + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview]);

  async function renderNow() {
    setRendering(true);
    setNotice("正在渲染逐页高清矢量预览…");
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview/render`, {
        method: "POST",
      });
      setPreview(p);
      setNotice("");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-stage text-ink">
      {/* Monochrome Translucent Cinema Top Bar */}
      <header className="h-[52px] apple-glass border-b border-black/[0.08] px-5 flex items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/p/${pid}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary hover:text-ink transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回工作台</span>
          </Link>
          <span className="text-black/20">/</span>
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[14.5px] font-semibold text-ink truncate">
              {projectName || pid}
            </span>
            <span className="text-[13px] text-ink-secondary whitespace-nowrap">
              放映预览
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {report?.success && (
            <button
              type="button"
              onClick={renderNow}
              disabled={rendering}
              className="px-3 py-1.5 rounded-full text-[13px] font-medium text-ink hover:bg-black/[0.06] transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${rendering ? "animate-spin" : ""}`}
              />
              <span>{rendering ? "渲染中…" : "重新渲染"}</span>
            </button>
          )}
          <a
            href={`/api/projects/${pid}/download/pdf`}
            download
            className="px-3.5 py-1.5 rounded-full bg-black/[0.06] hover:bg-black/[0.1] text-ink text-[13px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 PDF</span>
          </a>
          <a
            href={`/api/projects/${pid}/download`}
            download
            className="ui-btn-primary px-4 py-1.5 text-[13px] flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 PPTX</span>
          </a>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-5 sm:p-6 gap-5">
        {preview && preview.pages.length > 0 ? (
          <>
            {/* Large 16:9 Stage (crisp 3px corners matching PPTX output) */}
            <div className="w-full max-w-[1120px] relative group">
              <div className="aspect-[16/9] w-full rounded-[3px] bg-surface overflow-hidden slide-shadow flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.pages[selected]}
                  alt={`第 ${selected + 1} 页`}
                  className="w-full h-full object-contain select-none"
                />
              </div>

              <button
                type="button"
                disabled={selected === 0}
                onClick={() => setSelected((s) => Math.max(0, s - 1))}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full apple-glass dock-shadow text-ink flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer"
                aria-label="上一页"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                disabled={selected === preview.pages.length - 1}
                onClick={() =>
                  setSelected((s) => Math.min(preview.pages.length - 1, s + 1))
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full apple-glass dock-shadow text-ink flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer"
                aria-label="下一页"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Bottom Horizontal Thumbnail Filmstrip */}
            <div className="w-full max-w-[1120px] flex flex-col items-center gap-3">
              <div className="flex items-center gap-3 overflow-x-auto max-w-full pb-2 px-1 clean-scroll">
                {preview.pages.map((src, idx) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSelected(idx)}
                    className={`w-28 aspect-[16/9] rounded-[4px] bg-surface overflow-hidden shrink-0 transition-all cursor-pointer ${
                      idx === selected
                        ? "thumb-selected"
                        : "thumb-idle opacity-75 hover:opacity-100"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`第 ${idx + 1} 页`}
                      className="w-full h-full object-contain"
                    />
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-ink-secondary tabular-nums">
                <span className="font-medium text-ink">
                  第 {selected + 1} / {preview.pages.length} 页
                </span>
                <span>支持键盘 ← / → 翻页</span>
                <span>最终效果以 PowerPoint 打开为准</span>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-surface rounded-[18px] p-10 slide-shadow max-w-md w-full text-center space-y-4">
            <div className="text-[16px] font-semibold text-ink">
              {notice || "尚未生成预览"}
            </div>
            <p className="text-[13.5px] text-ink-secondary leading-relaxed">
              {report?.success
                ? "点击下方按钮立即生成逐页高清预览图与矢量 PDF。"
                : "请先回到工作台确认大纲并导出 PPTX。"}
            </p>
            {report?.success ? (
              <button
                type="button"
                onClick={renderNow}
                disabled={rendering}
                className="ui-btn-primary px-5 py-2.5 text-[13.5px]"
              >
                {rendering ? "正在渲染…" : "生成高清预览图"}
              </button>
            ) : (
              <Link
                href={`/p/${pid}`}
                className="ui-btn-primary inline-block px-5 py-2.5 text-[13.5px]"
              >
                返回工作台
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
