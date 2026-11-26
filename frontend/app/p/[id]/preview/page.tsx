"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  OutlineItem,
  Preview,
  Project,
  ThemeOption,
} from "../../../../lib/api";
import { ExportFormatMenu } from "../../../../components/workspace/ExportFormatMenu";
import { needsContrastHairline } from "../../../../components/workspace/layoutUtils";
import { SlideRenderer } from "../../../../components/workspace/stage/StandardSlideView";
import { computeActiveTheme } from "../../../../hooks/workspace/outlineHelpers";

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

function resolveSlideBg(
  item: OutlineItem | null | undefined,
  index: number,
  theme: ThemeOption
): string | null {
  if (item?.custom_bg) return item.custom_bg;
  if (index === 0 || item?.layout === "cover") {
    return theme.swatches.cover_bg || theme.swatches.bg || null;
  }
  return theme.swatches.bg || null;
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

  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
        const qs = new URLSearchParams({
          outline_version: proj.generated_outline_version,
          template_id:
            proj.theme_id || proj.latest_template_id || "keynote_light",
          auto_fit: String(Boolean(proj.latest_auto_fit)),
        });
        try {
          const sync = await api<GenerationSync>(
            `/api/projects/${encodeURIComponent(pid)}/generation-sync?${qs}`
          );
          setHistoricalExport(!sync.in_sync);
        } catch {
          setHistoricalExport(Boolean(proj.export_legacy));
        }
      } else {
        setHistoricalExport(false);
      }
      const sorted = (proj.outlines || []).toSorted(
        (a, b) => b.mtime - a.mtime
      );
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

  const totalSlides = preview?.pages.length || outline?.items.length || 0;

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, totalSlides - 1)));
  }, [totalSlides]);

  useEffect(() => {
    if (presenterMode || isFullscreen) return;
    thumbRefs.current[selected]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selected, presenterMode, isFullscreen]);

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
      setIsFullscreen((v) => !v);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
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
        !e.altKey &&
        totalSlides > 0
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
    setNotice("正在渲染逐页高清预览…");
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
    const tid =
      project?.theme_id || project?.latest_template_id || "keynote_light";
    return computeActiveTheme(themes, tid, project?.brand);
  }, [themes, project]);

  const currentPageSrc = preview?.pages?.[selected] || "";
  const nextPageSrc = preview?.pages?.[selected + 1] || "";
  const currentOutlineItem = outline?.items?.[selected] || null;
  const nextOutlineItem = outline?.items?.[selected + 1] || null;
  const currentPageDownloadUrl = currentPageSrc
    ? `${currentPageSrc}${currentPageSrc.includes("?") ? "&" : "?"}download=1`
    : "";

  const currentNeedsRim = needsContrastHairline(
    resolveSlideBg(currentOutlineItem, selected, activeTheme),
    "#0D0D0E",
    28
  );
  const nextNeedsRim = needsContrastHairline(
    resolveSlideBg(nextOutlineItem, selected + 1, activeTheme),
    "#151516",
    28
  );

  const remainingSec = targetMinutes * 60 - elapsedSec;
  const isOvertime = remainingSec < 0;

  return (
    <div className="h-dvh flex flex-col bg-ui-bg text-ui-text overflow-hidden">
      {/* Compact Single-Row Screening Room Header */}
      <header className="h-12 bg-ui-bg px-4 sm:px-5 flex items-center justify-between gap-3 shrink-0 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            href={`/p/${pid}`}
            className="inline-flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-ui-icon" />
            <span className="hidden sm:inline">返回工作台</span>
          </Link>
          <span className="hidden sm:inline text-ui-text-disabled select-none">
            /
          </span>
          <h1 className="text-[14px] font-medium tracking-[-0.01em] text-ui-text truncate">
            {project?.name || pid}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Borderless Mode Switcher */}
          {totalSlides > 0 && (
            <div
              role="group"
              aria-label="预览模式"
              className="inline-flex items-center bg-ui-surface p-0.5 rounded-lg gap-0.5"
            >
              <button
                type="button"
                aria-pressed={!presenterMode}
                title="放映视图"
                aria-label="放映视图"
                onClick={() => setPresenterMode(false)}
                className={`h-7 px-2 sm:px-2.5 rounded-md text-[12.5px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  !presenterMode
                    ? "bg-ui-bg-selected text-ui-text font-medium"
                    : "text-ui-text-muted hover:text-ui-text"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">放映</span>
              </button>
              <button
                type="button"
                aria-pressed={presenterMode}
                onClick={() => setPresenterMode(true)}
                title="切换演讲者视图 (P)"
                aria-label="演讲者视图"
                className={`h-7 px-2 sm:px-2.5 rounded-md text-[12.5px] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  presenterMode
                    ? "bg-ui-bg-selected text-ui-text font-medium"
                    : "text-ui-text-muted hover:text-ui-text"
                }`}
              >
                <Presentation className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">演讲者</span>
              </button>
            </div>
          )}

          {totalSlides > 0 && (
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title="全屏放映 (F)"
              aria-label="全屏放映"
              className="h-8 px-2 sm:px-2.5 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ui-press"
            >
              <Maximize2 className="w-3.5 h-3.5 text-ui-icon" />
              <span className="hidden md:inline">全屏</span>
            </button>
          )}

          {report?.success && (
            <button
              type="button"
              onClick={renderNow}
              disabled={rendering}
              title={rendering ? "正在重新渲染…" : "重新渲染逐页预览"}
              aria-label="重新渲染"
              className="hidden sm:inline-flex h-8 px-2 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap ui-press"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-ui-icon ${
                  rendering ? "animate-spin" : ""
                }`}
              />
              <span className="hidden xl:inline">
                {rendering ? "渲染中…" : "重新渲染"}
              </span>
            </button>
          )}

          {currentPageDownloadUrl && (
            <a
              href={currentPageDownloadUrl}
              download
              className="hidden sm:inline-flex h-8 px-2 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors items-center gap-1.5 whitespace-nowrap ui-press"
              title={`保存第 ${selected + 1} 页为高清 PNG`}
              aria-label="保存当前页图片"
            >
              <ImageDown className="w-3.5 h-3.5 text-ui-icon" />
              <span className="hidden xl:inline">存图</span>
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
              className="ui-btn-primary h-8 px-3.5 text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">下载 PPTX</span>
            </a>
          )}
        </div>
      </header>

      {historicalExport && (
        <div className="bg-ui-warning-bg px-5 py-1.5 text-center text-[12.5px] text-ui-warning shrink-0">
          当前放映的是上次导出的成稿，与工作台最新修改尚不一致。
        </div>
      )}

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden clean-scroll px-4 sm:px-6 pb-5 pt-2">
        {totalSlides > 0 ? (
          presenterMode ? (
            /* ── Dual-Zone Presenter Desk ── */
            <div
              key="view-presenter"
              className="w-full max-w-[1400px] mx-auto flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.58fr)_minmax(340px,1fr)] gap-5 lg:gap-6 items-stretch anim-msg-in"
            >
              {/* Left Zone: Current Slide Stage + Quiet Controls */}
              <div className="flex flex-col justify-center gap-4 min-h-0">
                <div
                  className={`aspect-[16/9] w-[min(100%,calc((100dvh-160px)*16/9))] mx-auto rounded-lg bg-ui-surface overflow-clip relative ${
                    currentNeedsRim ? "ring-1 ring-ui-n7" : ""
                  }`}
                >
                  <div
                    key={`pres-${selected}`}
                    className="absolute inset-0 anim-slide-settle"
                  >
                    {currentPageSrc ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={currentPageSrc}
                        alt={`第 ${selected + 1} 页`}
                        className="w-full h-full object-contain block select-none"
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

                <div className="w-[min(100%,calc((100dvh-160px)*16/9))] mx-auto flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={selected === 0}
                      onClick={() => setSelected((s) => Math.max(0, s - 1))}
                      className="ui-btn-subtle h-9 px-3.5 text-[13px] inline-flex items-center gap-1 disabled:opacity-35"
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
                  <div className="text-[13px] text-ui-text-secondary tabular-nums">
                    第 {selected + 1} / {totalSlides} 页
                  </div>
                </div>
              </div>

              {/* Right Zone: Unified Borderless Presenter Console */}
              <aside className="rounded-2xl bg-ui-surface p-5 flex flex-col gap-5 min-h-0 lg:overflow-hidden">
                {/* Pacing Timer */}
                <div className="space-y-3 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ui-text-secondary">
                      <Clock className="w-3.5 h-3.5 text-ui-icon" />
                      <span>演讲计时</span>
                    </span>
                    <div className="inline-flex items-center bg-ui-bg p-0.5 rounded-lg gap-0.5">
                      {[5, 10, 15].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTargetMinutes(m)}
                          className={`px-2 py-0.5 rounded-md text-[12px] transition-colors cursor-pointer tabular-nums ${
                            targetMinutes === m
                              ? "bg-ui-bg-selected text-ui-text font-medium"
                              : "text-ui-text-muted hover:text-ui-text"
                          }`}
                        >
                          {m}分
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[30px] font-semibold tabular-nums tracking-[-0.03em] text-ui-text leading-none">
                        {formatTimer(elapsedSec)}
                      </div>
                      <div
                        className={`text-[12.5px] mt-1.5 tabular-nums ${
                          isOvertime
                            ? "text-ui-danger font-medium"
                            : "text-ui-text-muted"
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
                        className="ui-btn-subtle h-8.5 px-3 text-[13px] inline-flex items-center gap-1.5 bg-ui-bg hover:bg-ui-control-hover"
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
                        aria-label="重置计时器"
                        className="ui-btn-subtle h-8.5 w-8.5 inline-flex items-center justify-center bg-ui-bg hover:bg-ui-control-hover"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Up Next Preview */}
                <div className="space-y-2 shrink-0">
                  <div className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="font-medium text-ui-text-secondary shrink-0">
                      下一页
                    </span>
                    {nextOutlineItem && (
                      <span className="text-ui-text-muted truncate tabular-nums">
                        第 {selected + 2} 页 {nextOutlineItem.title}
                      </span>
                    )}
                  </div>
                  {selected + 1 < totalSlides ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((s) => Math.min(totalSlides - 1, s + 1))
                      }
                      aria-label={`跳至第 ${selected + 2} 页`}
                      className={`block aspect-[16/9] w-full rounded-lg overflow-clip bg-ui-bg relative cursor-pointer transition-shadow hover:ring-1 hover:ring-ui-border/55 ${
                        nextNeedsRim ? "ring-1 ring-ui-n7" : ""
                      }`}
                    >
                      {nextPageSrc ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={nextPageSrc}
                          alt={`第 ${selected + 2} 页`}
                          className="w-full h-full object-contain block"
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
                    </button>
                  ) : (
                    <div className="py-5 rounded-xl bg-ui-bg text-center text-[12.5px] text-ui-text-muted">
                      当前已是最后一页
                    </div>
                  )}
                </div>

                {/* Speaker Notes Reader */}
                <div className="flex-1 flex flex-col min-h-[160px] gap-2.5">
                  <div className="flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[12.5px] font-medium text-ui-text-secondary">
                      演讲者备注
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setNoteFontSize((s) => Math.max(13, s - 2))
                        }
                        aria-label="减小备注字号"
                        className="h-7 px-2 rounded-md bg-ui-bg hover:bg-ui-control-hover text-[12px] text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNoteFontSize((s) => Math.min(24, s + 2))
                        }
                        aria-label="增大备注字号"
                        className="h-7 px-2 rounded-md bg-ui-bg hover:bg-ui-control-hover text-[12px] text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
                      >
                        A+
                      </button>
                    </div>
                  </div>
                  <div
                    className="flex-1 overflow-y-auto clean-scroll rounded-xl bg-ui-bg p-3.5 leading-[1.7] text-ui-text whitespace-pre-wrap"
                    style={{ fontSize: noteFontSize }}
                  >
                    {currentOutlineItem?.speaker_notes?.trim()
                      ? currentOutlineItem.speaker_notes
                      : "本页暂未填写演讲者备注，可在工作台右侧补充或让 AI 助手生成口播稿。"}
                  </div>
                </div>
              </aside>
            </div>
          ) : (
            /* ── Cinema Screening View ── */
            <div
              key="view-cinema"
              className="w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-4 anim-msg-in"
            >
              {/* Maximized Viewport-Fit 16:9 Stage */}
              <div className="w-[min(100%,calc((100dvh-204px)*16/9),1180px)] relative stage-reveal-host">
                <div
                  className={`aspect-[16/9] w-full rounded-lg bg-ui-surface overflow-clip relative ${
                    currentNeedsRim ? "ring-1 ring-ui-n7" : ""
                  }`}
                >
                  <div
                    key={`cin-${selected}`}
                    className="absolute inset-0 anim-slide-settle"
                  >
                    {currentPageSrc ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={currentPageSrc}
                        alt={`第 ${selected + 1} 页`}
                        className="w-full h-full object-contain block select-none"
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
                  className="stage-reveal-control absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full ui-popover text-ui-text flex items-center justify-center active:scale-95 disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
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
                  className="stage-reveal-control absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full ui-popover text-ui-text flex items-center justify-center active:scale-95 disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                  aria-label="下一页"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Borderless Swipeable Contact-Sheet Filmstrip */}
              <div className="w-[min(100%,1180px)] flex flex-col items-center gap-2 shrink-0">
                <div
                  role="region"
                  aria-label="幻灯片缩略图列表"
                  className="filmstrip-scroller flex items-start gap-3 overflow-x-auto max-w-full py-1.5 px-2 clean-scroll"
                >
                  {Array.from({ length: totalSlides }).map((_, idx) => {
                    const src = preview?.pages?.[idx];
                    const item = outline?.items?.[idx];
                    const isSelected = idx === selected;
                    const thumbNeedsRim = needsContrastHairline(
                      resolveSlideBg(item, idx, activeTheme),
                      "#0D0D0E",
                      28
                    );

                    return (
                      <button
                        key={idx}
                        ref={(el) => {
                          thumbRefs.current[idx] = el;
                        }}
                        type="button"
                        aria-current={isSelected ? "true" : undefined}
                        aria-label={`切换到第 ${idx + 1} 页`}
                        onClick={() => setSelected(idx)}
                        className="filmstrip-item group/thumb flex flex-col items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <div
                          className={`w-28 aspect-[16/9] rounded-md bg-ui-surface overflow-clip relative transition-[opacity,box-shadow] duration-[150ms] ease-out ${
                            isSelected
                              ? "opacity-100 ring-[1.5px] ring-ui-text/85"
                              : `opacity-55 group-hover/thumb:opacity-95 ${
                                  thumbNeedsRim ? "ring-1 ring-ui-n7" : ""
                                }`
                          }`}
                        >
                          {src ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={src}
                              alt={`第 ${idx + 1} 页`}
                              className="w-full h-full object-contain block"
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
                          className={`text-[11.5px] tabular-nums leading-none transition-colors ${
                            isSelected
                              ? "text-ui-text font-medium"
                              : "text-ui-text-muted/75 group-hover/thumb:text-ui-text-secondary"
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[12.5px] text-ui-text-muted tabular-nums">
                  <span className="text-ui-text-secondary font-medium">
                    第 {selected + 1} / {totalSlides} 页
                  </span>
                  <span className="hidden sm:inline">
                    方向键或空格翻页
                  </span>
                  <span className="hidden sm:inline">F 全屏</span>
                  <span className="hidden sm:inline">P 演讲者视图</span>
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="my-auto mx-auto bg-ui-surface rounded-2xl p-9 sm:p-11 max-w-md w-full text-center space-y-5">
            <div className="space-y-2">
              <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ui-text">
                {notice || "尚未生成成稿预览"}
              </h2>
              <p className="text-[13.5px] text-ui-text-muted leading-relaxed">
                {report?.success
                  ? "立即渲染逐页高清预览图与矢量 PDF。"
                  : "请先返回工作台生成大纲并导出 PPTX。"}
              </p>
            </div>
            {report?.success ? (
              <button
                type="button"
                onClick={renderNow}
                disabled={rendering}
                className="ui-btn-primary h-9.5 px-5 text-[13.5px]"
              >
                {rendering ? "正在渲染…" : "生成高清预览"}
              </button>
            ) : (
              <Link
                href={`/p/${pid}`}
                className="inline-flex items-center justify-center ui-btn-primary h-9.5 px-5 text-[13.5px]"
              >
                返回工作台
              </Link>
            )}
          </div>
        )}
      </main>

      {/* Distraction-Free Fullscreen Theater Overlay (F to toggle, Esc to exit) */}
      {isFullscreen && totalSlides > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center stage-reveal-host select-none"
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
          <div className="w-[min(100dvw,calc(100dvh*16/9))] aspect-[16/9] bg-black overflow-clip relative">
            <div
              key={`fs-${selected}`}
              className="absolute inset-0 anim-slide-settle"
            >
              {currentPageSrc ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={currentPageSrc}
                  alt={`第 ${selected + 1} 页`}
                  className="w-full h-full object-contain block select-none"
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

          {/* Pointer / Keyboard / Touch-Reachable Floating HUD */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="stage-reveal-control fixed bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-ui-bg/85 backdrop-blur-md text-ui-text flex items-center gap-2 text-[13px] shadow-[0_8px_28px_rgba(0,0,0,0.65)]"
          >
            <button
              type="button"
              disabled={selected === 0}
              onClick={() => setSelected((s) => Math.max(0, s - 1))}
              aria-label="上一页"
              className="p-1 rounded-full hover:bg-ui-control-hover disabled:opacity-30 cursor-pointer"
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
              className="p-1 rounded-full hover:bg-ui-control-hover disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="w-px h-3.5 bg-ui-border-subtle mx-0.5" />
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title="退出全屏 (Esc / F)"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full hover:bg-ui-control-hover cursor-pointer"
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
