"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ImageDown,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  Play,
  Presentation,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  api,
  ExportReport,
  FALLBACK_THEMES,
  GenerationSync,
  Outline,
  Preview,
  Project,
  ThemeOption,
} from "../../../../lib/api";
import { ExportFormatMenu } from "../../../../components/workspace/ExportFormatMenu";
import { SlideRenderer } from "../../../../components/workspace/stage/StandardSlideView";

function formatTimer(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(Math.floor(sec));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${neg ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(
    2,
    "0"
  )}`;
}

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const pid = useMemo(() => {
    const seg = pathname?.split("/").filter(Boolean)[1];
    return seg && seg !== "__placeholder__"
      ? decodeURIComponent(seg)
      : params.id;
  }, [pathname, params.id]);

  const [project, setProject] = useState<Project | null>(null);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [themes, setThemes] = useState<ThemeOption[]>(FALLBACK_THEMES);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("");
  const [rendering, setRendering] = useState(false);
  const [historicalExport, setHistoricalExport] = useState(false);

  // Presenter View & Fullscreen state
  const [presenterMode, setPresenterMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [noteFontSize, setNoteFontSize] = useState(16);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [targetMinutes, setTargetMinutes] = useState<number>(10);

  const load = useCallback(async () => {
    api<{ themes: ThemeOption[] }>("/api/themes")
      .then((res) => {
        if (res.themes?.length) setThemes(res.themes);
      })
      .catch(() => {});

    let proj: Project | null = null;
    try {
      proj = await api<Project>(`/api/projects/${pid}`);
      setProject(proj);
      if (proj.generated_outline_version) {
        const params = new URLSearchParams({
          outline_version: proj.generated_outline_version,
          template_id: proj.theme_id || proj.latest_template_id || "keynote_light",
          auto_fit: String(Boolean(proj.latest_auto_fit)),
        });
        try {
          const sync = await api<GenerationSync>(
            `/api/projects/${encodeURIComponent(pid)}/generation-sync?${params}`
          );
          setHistoricalExport(!sync.in_sync);
        } catch {
          setHistoricalExport(Boolean(proj.export_legacy));
        }
      } else {
        setHistoricalExport(false);
      }
      const sorted = [...(proj.outlines || [])].sort((a, b) => b.mtime - a.mtime);
      if (sorted.length > 0) {
        const latestVer =
          proj.generated_outline_version || sorted[0].outline_version;
        const out = await api<Outline>(
          `/api/projects/${pid}/outlines/${encodeURIComponent(latestVer)}`
        );
        setOutline(out);
      }
    } catch {
      setProject(null);
    }

    if (proj?.download_available) {
      try {
        const p = await api<Preview>(`/api/projects/${pid}/preview`);
        setPreview(p);
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
    } else {
      setPreview(null);
      setReport(null);
      setNotice("");
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalSlides =
    preview?.pages.length || outline?.items.length || 0;

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, totalSlides - 1)));
  }, [totalSlides]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        return;
      }
      if (isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        setIsFullscreen(true);
      }
    } catch {
      // Fallback to viewport fullscreen theater if browser disallows native API
      setIsFullscreen((v) => !v);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape" && isFullscreen && !document.fullscreenElement) {
        setIsFullscreen(false);
        return;
      }
      if (
        e.key.toLowerCase() === "f" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        totalSlides > 0
      ) {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (
        e.key.toLowerCase() === "p" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        if (isFullscreen) {
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
          }
          setIsFullscreen(false);
        }
        setPresenterMode((v) => !v);
        return;
      }
      if (!totalSlides) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "PageDown" ||
        e.key === " "
      ) {
        e.preventDefault();
        setSelected((s) => Math.min(totalSlides - 1, s + 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setSelected(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setSelected(totalSlides - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalSlides, isFullscreen, toggleFullscreen]);

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

  const activeTheme = useMemo(() => {
    const tid = project?.theme_id || project?.latest_template_id || "keynote_light";
    const base = themes.find((t) => t.id === tid) || themes[0] || FALLBACK_THEMES[0];
    if (!project?.brand) return base;
    return {
      ...base,
      swatches: {
        ...base.swatches,
        accent: project.brand.accent_hex || base.swatches.accent,
        bg: project.brand.bg_hex || base.swatches.bg,
      },
    };
  }, [themes, project]);

  const currentPageSrc = preview?.pages?.[selected] || "";
  const nextPageSrc = preview?.pages?.[selected + 1] || "";
  const currentOutlineItem = outline?.items?.[selected] || null;
  const nextOutlineItem = outline?.items?.[selected + 1] || null;
  const currentPageDownloadUrl = currentPageSrc
    ? `${currentPageSrc}${currentPageSrc.includes("?") ? "&" : "?"}download=1`
    : "";

  const remainingSec = targetMinutes * 60 - elapsedSec;
  const isOvertime = remainingSec < 0;

  return (
    <div className="min-h-screen flex flex-col bg-ui-bg text-ui-text">
      {/* Unified Dark Cinema / Presenter Top Bar */}
      <header className="h-12 bg-ui-bg px-4 flex items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/p/${pid}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ui-text-secondary hover:text-ui-text transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回工作台</span>
          </Link>
          <span className="text-ui-border-subtle">/</span>
          <span className="text-[14px] font-semibold text-ui-text truncate">
            {project?.name || pid}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mode Toggle: Cinema vs Presenter View */}
          {totalSlides > 0 && (
            <div className="inline-flex items-center bg-ui-surface-input border border-ui-border-subtle p-0.5 rounded-lg gap-0.5">
              <button
                type="button"
                onClick={() => setPresenterMode(false)}
                className={`px-2.5 py-1 rounded-md text-[13px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  !presenterMode
                    ? "bg-ui-bg-selected text-ui-text font-medium"
                    : "text-ui-text-muted hover:text-ui-text"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>放映</span>
              </button>
              <button
                type="button"
                onClick={() => setPresenterMode(true)}
                title="切换演讲者视图 (快捷键 P)"
                className={`px-2.5 py-1 rounded-md text-[13px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  presenterMode
                    ? "bg-ui-bg-selected text-ui-text font-medium"
                    : "text-ui-text-muted hover:text-ui-text"
                }`}
              >
                <Presentation className="w-3.5 h-3.5" />
                <span>演讲者视图</span>
              </button>
            </div>
          )}

          {totalSlides > 0 && (
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title="进入全屏放映 (快捷键 F)"
              className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">全屏</span>
            </button>
          )}

          {report?.success && (
            <button
              type="button"
              onClick={renderNow}
              disabled={rendering}
              className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${rendering ? "animate-spin" : ""}`}
              />
              <span className="hidden lg:inline">{rendering ? "渲染中…" : "重新渲染"}</span>
            </button>
          )}
          {currentPageDownloadUrl && (
            <a
              href={currentPageDownloadUrl}
              download
              className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors flex items-center gap-1.5 whitespace-nowrap"
              title={`将第 ${selected + 1} 页保存为高清 PNG 图片`}
            >
              <ImageDown className="w-3.5 h-3.5" />
              <span className="hidden md:inline">保存当前页</span>
            </a>
          )}
          <ExportFormatMenu
            pid={pid}
            label="更多格式"
            canDownloadRendered={Boolean(report?.success)}
            canDownloadNotes={true}
          />
          {project?.download_available && (
            <a
              href={`/api/projects/${pid}/download`}
              download
              className="ui-btn-primary h-8 px-3.5 text-[13px] flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 PPTX</span>
            </a>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-5 sm:p-6 gap-5">
        {historicalExport && (
          <p className="text-[13px] text-ui-warning font-medium">
            正在放映的是最近一次成功导出的文件，它与当前文稿设置不一致。
          </p>
        )}
        {totalSlides > 0 ? (
          presenterMode ? (
            /* ── Dual-Pane Presenter View ── */
            <div
              key="view-presenter"
              className="w-full max-w-[1380px] flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch anim-msg-in"
            >
              {/* Left 8 cols: Current Slide + Nav Controls */}
              <div className="lg:col-span-8 flex flex-col justify-center gap-4">
                <div className="aspect-[16/9] w-full rounded-[3px] bg-white overflow-hidden slide-shadow relative">
                  <div key={`pres-${selected}`} className="absolute inset-0 anim-slide-settle">
                  {currentPageSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={currentPageSrc}
                      alt={`第 ${selected + 1} 页`}
                      className="w-full h-full object-contain select-none"
                    />
                  ) : currentOutlineItem ? (
                    <SlideRenderer
                      pid={pid}
                      item={currentOutlineItem}
                      index={selected}
                      total={totalSlides}
                      theme={activeTheme}
                      brand={project?.brand}
                    />
                  ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={selected === 0}
                      onClick={() => setSelected((s) => Math.max(0, s - 1))}
                      className="ui-btn-outline h-9 px-3.5 text-[13px] inline-flex items-center gap-1 disabled:opacity-35"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>上一页</span>
                    </button>
                    <button
                      type="button"
                      disabled={selected >= totalSlides - 1}
                      onClick={() =>
                        setSelected((s) => Math.min(totalSlides - 1, s + 1))
                      }
                      className="ui-btn-primary h-9 px-4 text-[13px] inline-flex items-center gap-1 disabled:opacity-35"
                    >
                      <span>下一页</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-[13.5px] font-semibold text-ui-text tabular-nums">
                    第 {selected + 1} / {totalSlides} 页
                  </div>
                </div>
              </div>

              {/* Right 4 cols: Next Slide + Speaker Notes + Timer */}
              <div className="lg:col-span-4 flex flex-col gap-4 min-h-0">
                {/* Timer Card */}
                <div className="p-4 rounded-xl bg-ui-surface border border-ui-border-subtle space-y-3 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ui-text-secondary">
                      <Clock className="w-4 h-4 text-ui-icon" />
                      <span>演讲计时</span>
                    </span>
                    <div className="flex items-center gap-1">
                      {[5, 10, 15].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTargetMinutes(m)}
                          className={`px-2 py-0.5 rounded-md text-[12.5px] cursor-pointer ${
                            targetMinutes === m
                              ? "bg-ui-accent text-ui-on-accent font-medium"
                              : "bg-ui-surface-input text-ui-text-muted hover:text-ui-text"
                          }`}
                        >
                          {m}分
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[28px] font-bold tabular-nums tracking-tight text-ui-text leading-none">
                        {formatTimer(elapsedSec)}
                      </div>
                      <div
                        className={`text-[13px] mt-1 tabular-nums ${
                          isOvertime ? "text-ui-danger font-semibold" : "text-ui-text-muted"
                        }`}
                      >
                        {isOvertime
                          ? `已超时 ${formatTimer(Math.abs(remainingSec))}`
                          : `距离目标剩余 ${formatTimer(remainingSec)}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTimerRunning((v) => !v)}
                        className="ui-btn-outline h-9 px-3 text-[13px] inline-flex items-center gap-1"
                      >
                        {timerRunning ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>暂停</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>开始</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTimerRunning(false);
                          setElapsedSec(0);
                        }}
                        title="重置计时器"
                        className="ui-btn-subtle p-2"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Next Slide Preview */}
                <div className="p-3.5 rounded-xl bg-ui-surface border border-ui-border-subtle space-y-2 shrink-0">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-ui-text-secondary">
                      下一页预览
                    </span>
                    {nextOutlineItem && (
                      <span className="text-ui-text-muted truncate max-w-[180px]">
                        第 {selected + 2} 页 · {nextOutlineItem.title}
                      </span>
                    )}
                  </div>
                  {selected + 1 < totalSlides ? (
                    <div className="aspect-[16/9] w-full rounded-[4px] overflow-hidden border border-ui-border-subtle bg-white">
                      {nextPageSrc ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={nextPageSrc}
                          alt={`第 ${selected + 2} 页`}
                          className="w-full h-full object-contain"
                        />
                      ) : nextOutlineItem ? (
                        <SlideRenderer
                          pid={pid}
                          item={nextOutlineItem}
                          index={selected + 1}
                          total={totalSlides}
                          theme={activeTheme}
                          brand={project?.brand}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="py-5 rounded-lg bg-ui-bg text-center text-[13px] text-ui-text-muted">
                      当前已是最后一页
                    </div>
                  )}
                </div>

                {/* Speaker Notes Reader */}
                <div className="p-4 rounded-xl bg-ui-surface border border-ui-border-subtle flex-1 flex flex-col min-h-[180px] space-y-2.5">
                  <div className="flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[13px] font-semibold text-ui-text-secondary">
                      演讲者备注
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setNoteFontSize((s) => Math.max(13, s - 2))
                        }
                        className="ui-btn-subtle px-2 py-0.5 text-[12.5px]"
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNoteFontSize((s) => Math.min(24, s + 2))
                        }
                        className="ui-btn-subtle px-2 py-0.5 text-[12.5px]"
                      >
                        A+
                      </button>
                    </div>
                  </div>
                  <div
                    className="flex-1 overflow-y-auto clean-scroll leading-relaxed text-ui-text whitespace-pre-wrap"
                    style={{ fontSize: noteFontSize }}
                  >
                    {currentOutlineItem?.speaker_notes?.trim()
                      ? currentOutlineItem.speaker_notes
                      : "本页暂未填写演讲者备注（可在工作台右侧或让 AI 助手自动生成口播稿）。"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Cinema Full-Stage View ── */
            <div key="view-cinema" className="w-full flex flex-col items-center gap-5 anim-msg-in">
              <div className="w-full max-w-[1120px] relative group">
                <div className="aspect-[16/9] w-full rounded-[3px] bg-white overflow-hidden slide-shadow flex items-center justify-center relative">
                  <div key={`cin-${selected}`} className="absolute inset-0 anim-slide-settle">
                  {currentPageSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={currentPageSrc}
                      alt={`第 ${selected + 1} 页`}
                      className="w-full h-full object-contain select-none"
                    />
                  ) : currentOutlineItem ? (
                    <SlideRenderer
                      pid={pid}
                      item={currentOutlineItem}
                      index={selected}
                      total={totalSlides}
                      theme={activeTheme}
                      brand={project?.brand}
                    />
                  ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={selected === 0}
                  onClick={() => setSelected((s) => Math.max(0, s - 1))}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full ui-popover text-ui-text flex items-center justify-center opacity-50 hover:opacity-100 group-hover:opacity-90 focus-visible:opacity-100 transition-[opacity,transform] duration-[150ms] active:scale-95 disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                  aria-label="上一页"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={selected === totalSlides - 1}
                  onClick={() =>
                    setSelected((s) => Math.min(totalSlides - 1, s + 1))
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full ui-popover text-ui-text flex items-center justify-center opacity-50 hover:opacity-100 group-hover:opacity-90 focus-visible:opacity-100 transition-[opacity,transform] duration-[150ms] active:scale-95 disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                  aria-label="下一页"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="w-full max-w-[1120px] flex flex-col items-center gap-2">
                <div className="flex items-start gap-3.5 overflow-x-auto max-w-full py-2.5 px-3 clean-scroll">
                  {Array.from({ length: totalSlides }).map((_, idx) => {
                    const src = preview?.pages?.[idx];
                    const item = outline?.items?.[idx];
                    const isSelected = idx === selected;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelected(idx)}
                        className="group/thumb flex flex-col items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <div
                          className={`w-28 aspect-[16/9] rounded-[4px] bg-white overflow-hidden relative transition-all duration-200 ${
                            isSelected
                              ? "thumb-selected -translate-y-0.5 scale-[1.03]"
                              : "thumb-idle opacity-75 group-hover/thumb:opacity-100 group-hover/thumb:-translate-y-0.5"
                          }`}
                        >
                          {src ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={src}
                              alt={`第 ${idx + 1} 页`}
                              className="w-full h-full object-contain"
                            />
                          ) : item ? (
                            <SlideRenderer
                              pid={pid}
                              item={item}
                              index={idx}
                              total={totalSlides}
                              theme={activeTheme}
                              brand={project?.brand}
                            />
                          ) : null}
                        </div>
                        <span
                          className={`h-[3px] rounded-full transition-all duration-200 ${
                            isSelected
                              ? "w-5 bg-ui-accent"
                              : "w-1.5 bg-ui-border-subtle group-hover/thumb:bg-ui-border"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-ui-text-muted tabular-nums">
                  <span className="font-medium text-ui-text">
                    第 {selected + 1} / {totalSlides} 页
                  </span>
                  <span>支持 ← / → / 空格翻页，按 F 全屏放映，按 P 切换演讲者视图</span>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="bg-ui-surface rounded-xl p-10 border border-ui-border-subtle max-w-md w-full text-center space-y-4">
            <div className="text-[16px] font-semibold text-ui-text">
              {notice || "尚未生成预览"}
            </div>
            <p className="text-[13.5px] text-ui-text-muted leading-relaxed">
              {report?.success
                ? "点击下方按钮立即生成逐页高清预览图与矢量 PDF。"
                : "请先回到工作台创建大纲或导出 PPTX。"}
            </p>
            {report?.success ? (
              <button
                type="button"
                onClick={renderNow}
                disabled={rendering}
                className="ui-btn-primary px-5 py-2 text-[13.5px]"
              >
                {rendering ? "正在渲染…" : "生成高清预览图"}
              </button>
            ) : (
              <Link
                href={`/p/${pid}`}
                className="inline-block ui-btn-primary px-5 py-2 text-[13.5px]"
              >
                返回工作台
              </Link>
            )}
          </div>
        )}
      </main>

      {/* True Distraction-Free Fullscreen Theater Overlay (F to toggle, Esc to exit) */}
      {isFullscreen && totalSlides > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center group/fs select-none"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
            if (relX < 0.25) {
              setSelected((s) => Math.max(0, s - 1));
            } else {
              setSelected((s) => Math.min(totalSlides - 1, s + 1));
            }
          }}
        >
          <div className="w-[min(100vw,calc(100vh*16/9))] aspect-[16/9] bg-surface overflow-hidden relative shadow-2xl">
            <div
              key={`fs-${selected}`}
              className="absolute inset-0 anim-slide-settle"
            >
              {currentPageSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={currentPageSrc}
                  alt={`第 ${selected + 1} 页`}
                  className="w-full h-full object-contain select-none"
                />
              ) : currentOutlineItem ? (
                <SlideRenderer
                  pid={pid}
                  item={currentOutlineItem}
                  index={selected}
                  total={totalSlides}
                  theme={activeTheme}
                  brand={project?.brand}
                />
              ) : null}
            </div>
          </div>

          {/* Hover-only subtle floating HUD at bottom center */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/65 backdrop-blur-md border border-white/15 text-white flex items-center gap-2 text-[13px] opacity-0 group-hover/fs:opacity-100 focus-within:opacity-100 transition-opacity duration-200"
          >
            <button
              type="button"
              disabled={selected === 0}
              onClick={() => setSelected((s) => Math.max(0, s - 1))}
              aria-label="上一页"
              className="p-1 rounded-full hover:bg-white/15 disabled:opacity-30 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="tabular-nums px-1 font-medium">
              {selected + 1} / {totalSlides}
            </span>
            <button
              type="button"
              disabled={selected === totalSlides - 1}
              onClick={() =>
                setSelected((s) => Math.min(totalSlides - 1, s + 1))
              }
              aria-label="下一页"
              className="p-1 rounded-full hover:bg-white/15 disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="w-px h-3.5 bg-white/20 mx-0.5" />
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title="退出全屏 (Esc / F)"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full hover:bg-white/15 cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>退出全屏</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
