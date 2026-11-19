"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ExportReport, Preview } from "../../../../lib/api";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  AlertCircle,
  FileCheck,
} from "lucide-react";

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview`);
      setPreview(p);
      setSelected((s) => Math.min(s, Math.max(0, p.pages.length - 1)));
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

  // Keyboard navigation (← and →)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!preview?.pages.length) return;
      if (e.key === "ArrowLeft") {
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "ArrowRight") {
        setSelected((s) => Math.min(preview.pages.length - 1, s + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [preview]);

  async function renderNow() {
    setRendering(true);
    setNotice("正在调用 LibreOffice 无头引擎渲染各页幻灯片，通常需要十余秒...");
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
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Top Header */}
      <div className="bg-white border border-stone-200/80 rounded-2xl px-5 py-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/p/${pid}`}
            className="text-stone-500 hover:text-stone-900 text-xs font-medium flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回大纲文档</span>
          </Link>
          <span className="text-stone-300">/</span>
          <span className="font-serif font-bold text-base text-stone-900 tracking-tight">
            {pid} · 幻灯片演示影院
          </span>
          {preview && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 border border-stone-200/60">
              {preview.pages.length} 页演示文稿
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3 text-stone-500" />
            <span>刷新</span>
          </button>

          <a
            href={`/api/projects/${pid}/download`}
            className="px-3.5 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 PPTX</span>
          </a>
        </div>
      </div>

      {/* Quality Issues Alert */}
      {report && !report.success && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <span>最近一次排版几何质检未通过：</span>
          </div>
          <ul className="space-y-1 text-xs text-rose-700 font-mono pl-6">
            {report.issues.map((i, n) => (
              <li key={n} className="list-disc">
                [{i.code}] {i.slide_id ? `${i.slide_id}: ` : ""}
                {i.message}
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-rose-600 pt-1">
            请回到 <Link href={`/p/${pid}`} className="underline font-semibold">大纲文档</Link> 调整字数或段落后重新生成。
          </div>
        </div>
      )}

      {/* Stage Theater Layout */}
      {preview && preview.pages.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Main Stage (9 cols) */}
          <div className="lg:col-span-9 bg-white border border-stone-200/80 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between text-xs text-stone-500 pb-2 border-b border-stone-100 font-mono">
              <span className="flex items-center gap-1.5 text-stone-800 font-medium font-sans">
                <FileCheck className="w-4 h-4 text-emerald-600" />
                <span>真机环境渲染视口 (LibreOffice)</span>
              </span>
              <span>
                第 {selected + 1} / {preview.pages.length} 页 (支持键盘 ← / → 翻页)
              </span>
            </div>

            {/* Slide Large Canvas */}
            <div className="relative aspect-[16/9] rounded-xl bg-black overflow-hidden shadow-lg border border-stone-800 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.pages[selected]}
                alt={`第 ${selected + 1} 页大图`}
                className="w-full h-full object-contain"
              />

              {/* Prev / Next Stage Buttons */}
              <button
                disabled={selected === 0}
                onClick={() => setSelected((s) => Math.max(0, s - 1))}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                disabled={selected === preview.pages.length - 1}
                onClick={() => setSelected((s) => Math.min(preview.pages.length - 1, s + 1))}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            <div className="text-[11px] text-stone-400 text-center font-mono pt-1">
              {preview.artifact_id} r{preview.artifact_revision} · 最终效果以 PowerPoint 打开为准
            </div>
          </div>

          {/* Thumbnails Sidebar (3 cols) */}
          <div className="lg:col-span-3 bg-white border border-stone-200/80 rounded-2xl p-4 shadow-xs space-y-2.5 max-h-[700px] overflow-y-auto custom-scrollbar">
            <div className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
              幻灯片列表 ({preview.pages.length})
            </div>

            {preview.pages.map((src, idx) => (
              <button
                key={src}
                onClick={() => setSelected(idx)}
                className={`w-full p-1.5 rounded-xl border text-left transition-all ${
                  idx === selected
                    ? "border-emerald-600 bg-emerald-50/50 shadow-xs"
                    : "border-stone-200 hover:border-stone-300 bg-stone-50/50"
                }`}
              >
                <div className="aspect-[16/9] rounded-lg bg-black overflow-hidden mb-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`第 ${idx + 1} 页`} className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center justify-between px-1 text-[11px] font-mono text-stone-600">
                  <span>Slide {String(idx + 1).padStart(2, "0")}</span>
                  {idx === selected && <span className="text-emerald-700 font-bold">● 当前</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Empty / Render Call to Action */
        <div className="text-center py-16 bg-white border border-dashed border-stone-200 rounded-2xl p-8 space-y-4">
          <div className="text-sm font-medium text-stone-700">
            {notice || "尚未生成真机预览图像"}
          </div>
          <p className="text-xs text-stone-400 max-w-md mx-auto">
            {report?.success
              ? "可直接点击下方按钮由本地 LibreOffice 渲染逐页高清预览截图。"
              : "请先回到材料与大纲页面生成 PPTX 文档。"}
          </p>
          {report?.success && (
            <button
              onClick={renderNow}
              disabled={rendering}
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors disabled:opacity-50"
            >
              {rendering ? "正在调用 LibreOffice 渲染中..." : "渲染幻灯片真机截图"}
            </button>
          )}
          {!report && (
            <Link
              href={`/p/${pid}`}
              className="inline-block px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors"
            >
              去生成一份 PPT
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
