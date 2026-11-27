"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ImageDown,
  Maximize2,
  Minimize2,
  RefreshCw,
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
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    if (isFullscreen) return;
    thumbRefs.current[selected]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [selected, isFullscreen]);

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
  const currentOutlineItem = outline?.items?.[selected] || null;
  const currentPageDownloadUrl = currentPageSrc
    ? `${currentPageSrc}${currentPageSrc.includes("?") ? "&" : "?"}download=1`
    : "";

  const currentNeedsRim = needsContrastHairline(
    resolveSlideBg(currentOutlineItem, selected, activeTheme),
    "#0D0D0E",
    28
  );

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
          {totalSlides > 0 && (
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              title="全屏预览 (F)"
              aria-label="全屏预览"
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
          当前预览的是上次导出的成稿，与工作台最新修改尚不一致。
        </div>
      )}

      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto lg:overflow-hidden clean-scroll px-4 sm:px-6 pb-5 pt-2">
        {totalSlides > 0 ? (
          /* ── Deck Review Stage ── */
          <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-4 anim-msg-in">
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
                </div>
              </div>
            </div>
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
