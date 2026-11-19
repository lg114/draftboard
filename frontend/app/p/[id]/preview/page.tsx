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
      <div className="bg-white border border-[#e5e7eb] rounded-2xl px-5 py-3.5 shadow-bento flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/p/${pid}`}
            className="text-[#6b7280] hover:text-[#111827] text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回工作台</span>
          </Link>
          <span className="text-[#d1d5db]">/</span>
          <span className="font-bold text-base text-[#111827] tracking-tight">
            {pid} · 幻灯片演示影院
          </span>
          {preview && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-lg bg-[#f3f4f6] text-[#4b5563] border border-[#eaecf0]">
              {preview.pages.length} 页演示文稿
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-xl border border-[#eaecf0] hover:bg-[#f9fafb] text-[#374151] text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
          >
            <RefreshCw className="w-3 h-3 text-[#6b7280]" />
            <span>刷新</span>
          </button>

          <a
            href={`/api/projects/${pid}/download`}
            className="px-3.5 py-1.5 rounded-xl bg-[#111827] hover:bg-black text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>下载 PPTX</span>
          </a>
        </div>
      </div>

      {/* Quality Issues Alert */}
      {report && !report.success && (
        <div className="p-4 rounded-2xl bg-[#fdf2f8] border border-[#fbcfe8] space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#db2777]">
            <AlertCircle className="w-4 h-4 text-[#db2777]" />
            <span>最近一次排版几何质检未通过：</span>
          </div>
          <ul className="space-y-1 text-xs text-[#db2777] font-mono pl-6">
            {report.issues.map((i, n) => (
              <li key={n} className="list-disc">
                [{i.code}] {i.slide_id ? `${i.slide_id}: ` : ""}
                {i.message}
              </li>
            ))}
          </ul>
          <div className="text-[11px] text-[#db2777] pt-1">
            请回到 <Link href={`/p/${pid}`} className="underline font-semibold">大纲文档</Link> 调整字数或段落后重新生成。
          </div>
        </div>
      )}

      {/* Stage Theater Layout */}
      {preview && preview.pages.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Main Stage (9 cols) */}
          <div className="lg:col-span-9 bg-white border border-[#e5e7eb] rounded-2xl p-5 shadow-bento space-y-3">
            <div className="flex items-center justify-between text-xs text-[#6b7280] pb-3 border-b border-[#f3f4f6] font-mono">
              <span className="flex items-center gap-1.5 text-[#111827] font-medium font-sans">
                <FileCheck className="w-4 h-4 text-[#059669]" />
                <span>真机环境渲染视口 (LibreOffice)</span>
              </span>
              <span>
                第 {selected + 1} / {preview.pages.length} 页 (支持键盘 ← / → 翻页)
              </span>
            </div>

            {/* Slide Large Canvas */}
            <div className="relative aspect-[16/9] rounded-xl bg-white overflow-hidden shadow-sm border border-[#e5e7eb] group flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.pages[selected]}
                alt={`第 ${selected + 1} 页大图`}
                className="w-full h-full object-contain select-none"
              />

              {/* Prev / Next Stage Buttons */}
              <button
                disabled={selected === 0}
                onClick={() => setSelected((s) => Math.max(0, s - 1))}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#111827]/30 hover:bg-[#111827]/60 text-white backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                disabled={selected === preview.pages.length - 1}
                onClick={() => setSelected((s) => Math.min(preview.pages.length - 1, s + 1))}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#111827]/30 hover:bg-[#111827]/60 text-white backdrop-blur-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>

            <div className="text-[11px] text-[#9ca3af] text-center font-mono pt-1">
              {preview.artifact_id} r{preview.artifact_revision} · 最终效果以 PowerPoint 打开为准
            </div>
          </div>

          {/* Thumbnails Sidebar (3 cols) */}
          <div className="lg:col-span-3 bg-white border border-[#e5e7eb] rounded-2xl p-4 shadow-bento space-y-2.5 max-h-[700px] overflow-y-auto custom-scrollbar">
            <div className="text-xs font-semibold text-[#111827] uppercase tracking-wider mb-2">
              幻灯片列表 ({preview.pages.length})
            </div>

            {preview.pages.map((src, idx) => (
              <button
                key={src}
                onClick={() => setSelected(idx)}
                className={`w-full p-2 rounded-xl border text-left transition-all cursor-pointer ${
                  idx === selected
                    ? "border-[#4f46e5] bg-[#eef2ff]/50 shadow-2xs"
                    : "border-[#eaecf0] hover:border-[#d1d5db] bg-[#f9fafb]"
                }`}
              >
                <div className="aspect-[16/9] rounded-lg bg-white overflow-hidden mb-1.5 border border-[#eaecf0] flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`第 ${idx + 1} 页`} className="w-full h-full object-contain" />
                </div>
                <div className="flex items-center justify-between px-1 text-[11px] font-mono text-[#4b5563]">
                  <span>Slide {String(idx + 1).padStart(2, "0")}</span>
                  {idx === selected && (
                    <span className="text-[#4f46e5] font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />
                      <span>当前</span>
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Empty / Render Call to Action */
        <div className="text-center py-16 bg-white border-2 border-dashed border-[#eaecf0] rounded-2xl p-8 space-y-4 shadow-bento">
          <div className="text-sm font-semibold text-[#111827]">
            {notice || "尚未生成真机预览图像"}
          </div>
          <p className="text-xs text-[#6b7280] max-w-md mx-auto">
            {report?.success
              ? "可直接点击下方按钮由本地 LibreOffice 渲染逐页高清预览截图。"
              : "请先回到材料与大纲页面生成 PPTX 文档。"}
          </p>
          {report?.success && (
            <button
              onClick={renderNow}
              disabled={rendering}
              className="px-4 py-2 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              {rendering ? "正在调用 LibreOffice 渲染中..." : "渲染幻灯片真机截图"}
            </button>
          )}
          {!report && (
            <Link
              href={`/p/${pid}`}
              className="inline-block px-4 py-2 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors"
            >
              去生成一份 PPT
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
