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
  Outline,
  OutlineItem,
  Preview,
  Project,
  ThemeOption,
} from "../../../../lib/api";
import { AutoScaledCustomSlide } from "../../../../components/workspace/CustomSlideLayer";
import { ExportFormatMenu } from "../../../../components/workspace/ExportFormatMenu";
import {
  inferEffectiveLayout,
  normalizeEscapedNewlines,
} from "../../../../components/workspace/layoutUtils";

function LiveSlidePreviewBox({
  pid,
  item,
  index,
  total,
  theme,
}: {
  pid: string;
  item: OutlineItem;
  index: number;
  total: number;
  theme: ThemeOption;
}) {
  if (item.custom_elements && item.custom_elements.length > 0) {
    return (
      <AutoScaledCustomSlide
        pid={pid}
        customBg={item.custom_bg}
        elements={item.custom_elements}
        theme={theme}
      />
    );
  }
  const sw = theme.swatches;
  const layout = inferEffectiveLayout(item.layout, index, total);
  const isHero = layout === "cover" || layout === "closing";
  const bg = isHero ? sw.cover_bg : sw.bg;
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;

  return (
    <div
      className="w-full h-full p-8 flex flex-col justify-center gap-3 select-none"
      style={{ backgroundColor: bg }}
    >
      <div
        className="w-10 h-[3px] rounded-full"
        style={{ backgroundColor: sw.accent }}
      />
      <div
        className="text-[24px] font-bold leading-snug"
        style={{ color: titleCol }}
      >
        {item.title || "未命名"}
      </div>
      <div
        className="text-[15px] leading-relaxed whitespace-pre-wrap line-clamp-6"
        style={{ color: bodyCol }}
      >
        {normalizeEscapedNewlines(item.summary || "")}
      </div>
    </div>
  );
}

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

  // Presenter View state
  const [presenterMode, setPresenterMode] = useState(false);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "p") {
        setPresenterMode((v) => !v);
        return;
      }
      if (!totalSlides) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setSelected((s) => Math.min(totalSlides - 1, s + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalSlides]);

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
    <div className="min-h-screen flex flex-col bg-stage text-ink">
      {/* Monochrome Translucent Cinema / Presenter Top Bar */}
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
          <span className="text-[14.5px] font-semibold text-ink truncate">
            {project?.name || pid}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mode Toggle: Cinema vs Presenter View */}
          {totalSlides > 0 && (
            <div className="inline-flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5">
              <button
                type="button"
                onClick={() => setPresenterMode(false)}
                className={`px-2.5 py-1 rounded-[9px] text-[13px] inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                  !presenterMode
                    ? "bg-surface text-ink font-semibold shadow-2xs"
                    : "text-ink-secondary hover:text-ink font-medium"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>放映</span>
              </button>
              <button
                type="button"
                onClick={() => setPresenterMode(true)}
                title="切换演讲者视图 (快捷键 P)"
                className={`px-2.5 py-1 rounded-[9px] text-[13px] inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                  presenterMode
                    ? "bg-surface text-ink font-semibold shadow-2xs"
                    : "text-ink-secondary hover:text-ink font-medium"
                }`}
              >
                <Presentation className="w-3.5 h-3.5" />
                <span>演讲者视图</span>
              </button>
            </div>
          )}

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
              <span className="hidden lg:inline">{rendering ? "渲染中…" : "重新渲染"}</span>
            </button>
          )}
          {currentPageDownloadUrl && (
            <a
              href={currentPageDownloadUrl}
              download
              className="px-3 py-1.5 rounded-full text-[13px] font-medium text-ink hover:bg-black/[0.06] transition-colors flex items-center gap-1.5 whitespace-nowrap"
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
              className="ui-btn-primary px-4 py-1.5 text-[13px] flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 PPTX</span>
            </a>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-5 sm:p-6 gap-5">
        {totalSlides > 0 ? (
          presenterMode ? (
            /* ── Dual-Pane Presenter View ── */
            <div className="w-full max-w-[1380px] flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Left 8 cols: Current Slide + Nav Controls */}
              <div className="lg:col-span-8 flex flex-col justify-center gap-4">
                <div className="aspect-[16/9] w-full rounded-[4px] bg-surface overflow-hidden slide-shadow relative">
                  {currentPageSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={currentPageSrc}
                      alt={`第 ${selected + 1} 页`}
                      className="w-full h-full object-contain select-none"
                    />
                  ) : currentOutlineItem ? (
                    <LiveSlidePreviewBox
                      pid={pid}
                      item={currentOutlineItem}
                      index={selected}
                      total={totalSlides}
                      theme={activeTheme}
                    />
                  ) : null}
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
                  <div className="text-[13.5px] font-semibold text-ink tabular-nums">
                    第 {selected + 1} / {totalSlides} 页
                  </div>
                </div>
              </div>

              {/* Right 4 cols: Next Slide + Speaker Notes + Timer */}
              <div className="lg:col-span-4 flex flex-col gap-4 min-h-0">
                {/* Timer Card */}
                <div className="p-4 rounded-2xl bg-surface border border-black/[0.08] space-y-3 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-secondary">
                      <Clock className="w-4 h-4" />
                      <span>演讲计时</span>
                    </span>
                    <div className="flex items-center gap-1">
                      {[5, 10, 15].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTargetMinutes(m)}
                          className={`px-2 py-0.5 rounded-md text-[13px] cursor-pointer ${
                            targetMinutes === m
                              ? "bg-ink text-white font-medium"
                              : "bg-canvas text-ink-secondary hover:text-ink"
                          }`}
                        >
                          {m}分
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[28px] font-bold tabular-nums tracking-tight text-ink leading-none">
                        {formatTimer(elapsedSec)}
                      </div>
                      <div
                        className={`text-[13px] mt-1 tabular-nums ${
                          isOvertime ? "text-danger font-semibold" : "text-ink-secondary"
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
                        className="p-2 rounded-xl bg-canvas hover:bg-black/[0.06] text-ink-secondary hover:text-ink cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Next Slide Preview */}
                <div className="p-3.5 rounded-2xl bg-surface border border-black/[0.08] space-y-2 shrink-0">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-ink-secondary">
                      下一页预览
                    </span>
                    {nextOutlineItem && (
                      <span className="text-ink-muted truncate max-w-[180px]">
                        第 {selected + 2} 页 · {nextOutlineItem.title}
                      </span>
                    )}
                  </div>
                  {selected + 1 < totalSlides ? (
                    <div className="aspect-[16/9] w-full rounded-[4px] overflow-hidden border border-black/[0.08] bg-canvas">
                      {nextPageSrc ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={nextPageSrc}
                          alt={`第 ${selected + 2} 页`}
                          className="w-full h-full object-contain"
                        />
                      ) : nextOutlineItem ? (
                        <LiveSlidePreviewBox
                          pid={pid}
                          item={nextOutlineItem}
                          index={selected + 1}
                          total={totalSlides}
                          theme={activeTheme}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="py-5 rounded-xl bg-canvas text-center text-[13px] text-ink-muted">
                      当前已是最后一页
                    </div>
                  )}
                </div>

                {/* Speaker Notes Reader */}
                <div className="p-4 rounded-2xl bg-surface border border-black/[0.08] flex-1 flex flex-col min-h-[180px] space-y-2.5">
                  <div className="flex items-center justify-between gap-2 shrink-0">
                    <span className="text-[13px] font-semibold text-ink-secondary">
                      演讲者备注
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setNoteFontSize((s) => Math.max(13, s - 2))
                        }
                        className="px-2 py-0.5 rounded-md bg-canvas hover:bg-black/[0.06] text-[13px] text-ink cursor-pointer"
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNoteFontSize((s) => Math.min(24, s + 2))
                        }
                        className="px-2 py-0.5 rounded-md bg-canvas hover:bg-black/[0.06] text-[13px] text-ink cursor-pointer"
                      >
                        A+
                      </button>
                    </div>
                  </div>
                  <div
                    className="flex-1 overflow-y-auto clean-scroll leading-relaxed text-ink whitespace-pre-wrap"
                    style={{ fontSize: noteFontSize }}
                  >
                    {currentOutlineItem?.speaker_notes?.trim()
                      ? currentOutlineItem.speaker_notes
                      : "本页暂未填写演讲者备注（可在工作台右侧或让 AI 按汇报时长自动生成口播稿）。"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Cinema Full-Stage View ── */
            <>
              <div className="w-full max-w-[1120px] relative group">
                <div className="aspect-[16/9] w-full rounded-[3px] bg-surface overflow-hidden slide-shadow flex items-center justify-center relative">
                  {currentPageSrc ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={currentPageSrc}
                      alt={`第 ${selected + 1} 页`}
                      className="w-full h-full object-contain select-none"
                    />
                  ) : currentOutlineItem ? (
                    <LiveSlidePreviewBox
                      pid={pid}
                      item={currentOutlineItem}
                      index={selected}
                      total={totalSlides}
                      theme={activeTheme}
                    />
                  ) : null}
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
                  disabled={selected === totalSlides - 1}
                  onClick={() =>
                    setSelected((s) => Math.min(totalSlides - 1, s + 1))
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full apple-glass dock-shadow text-ink flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 cursor-pointer"
                  aria-label="下一页"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="w-full max-w-[1120px] flex flex-col items-center gap-3">
                <div className="flex items-center gap-3 overflow-x-auto max-w-full pb-2 px-1 clean-scroll">
                  {Array.from({ length: totalSlides }).map((_, idx) => {
                    const src = preview?.pages?.[idx];
                    const item = outline?.items?.[idx];
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelected(idx)}
                        className={`w-28 aspect-[16/9] rounded-[4px] bg-surface overflow-hidden shrink-0 transition-all cursor-pointer relative ${
                          idx === selected
                            ? "thumb-selected"
                            : "thumb-idle opacity-75 hover:opacity-100"
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
                          <LiveSlidePreviewBox
                            pid={pid}
                            item={item}
                            index={idx}
                            total={totalSlides}
                            theme={activeTheme}
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-ink-secondary tabular-nums">
                  <span className="font-medium text-ink">
                    第 {selected + 1} / {totalSlides} 页
                  </span>
                  <span>支持 ← / → / 空格翻页，按 P 切换演讲者视图</span>
                </div>
              </div>
            </>
          )
        ) : (
          <div className="bg-surface rounded-[18px] p-10 slide-shadow max-w-md w-full text-center space-y-4">
            <div className="text-[16px] font-semibold text-ink">
              {notice || "尚未生成预览"}
            </div>
            <p className="text-[13.5px] text-ink-secondary leading-relaxed">
              {report?.success
                ? "点击下方按钮立即生成逐页高清预览图与矢量 PDF。"
                : "请先回到工作台创建大纲或导出 PPTX。"}
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
                className="inline-block ui-btn-primary px-5 py-2.5 text-[13.5px]"
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
