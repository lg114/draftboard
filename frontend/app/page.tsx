"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  CoverSlidePreview,
  FALLBACK_THEMES,
  jsonOptions,
  LLMSettingsResponse,
  Project,
  ProjectSummary,
  ThemeOption,
} from "../lib/api";
import { useDismiss } from "../lib/useDismiss";
import { BackendStatus } from "../components/BackendStatus";
import { BrandLogo } from "../components/BrandLogo";
import { LLMSettingsModal } from "../components/LLMSettingsModal";
import { SlideRenderer } from "../components/workspace/stage/StandardSlideView";
import {
  PROJECT_STAGE_STEPS,
  ProjectStageKey,
} from "../components/workspace/layoutUtils";

type StageKey = ProjectStageKey;

interface ProjectSummaryItem {
  project_id: string;
  name: string;
  theme_id: string;
  stage: StageKey;
  stage_label: string;
  slide_count: number;
  materials_count: number;
  material_names: string[];
  insufficient_evidence_count: number;
  cover_slide: CoverSlidePreview | null;
  preview_cover_url: string | null;
  download_available: boolean;
  mtime: number;
}

const STAGE_STEPS = PROJECT_STAGE_STEPS;

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "—";
  const now = Date.now();
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const sec = Math.floor((now - ms) / 1000);
  if (sec < 60) return "刚刚更新";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function isImageFilename(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function SlideCardPreview({
  project,
  theme,
}: {
  project: ProjectSummaryItem;
  theme: ThemeOption;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // Tier 1: Vector-crisp live miniature of Slide 1 via unified 960x540 renderer
  if (project.cover_slide) {
    return (
      <SlideRenderer
        pid={project.project_id}
        item={project.cover_slide}
        index={0}
        total={Math.max(1, project.slide_count)}
        theme={theme}
      />
    );
  }

  // Tier 2: Rendered cover PNG fallback when cover_slide metadata is absent
  if (project.preview_cover_url && !imgFailed) {
    return (
      <div className="w-full h-full bg-canvas relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={project.preview_cover_url}
          alt={project.name}
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover block"
        />
      </div>
    );
  }

  // Tier 3: Materials uploaded, outline not generated yet
  if (project.materials_count > 0) {
    return (
      <div className="w-full h-full bg-surface-subtle p-4 flex flex-col justify-center select-none">
        <div className="border border-dashed border-black/[0.12] rounded-xl bg-surface/70 px-4 py-3.5 space-y-2">
          <div className="text-[13px] font-medium text-ink-secondary">
            已导入素材 · 等待生成大纲
          </div>
          <div className="space-y-1.5">
            {project.material_names.slice(0, 3).map((fname) => (
              <div
                key={fname}
                className="flex items-center gap-2 text-[13px] text-ink"
              >
                {isImageFilename(fname) ? (
                  <ImageIcon className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                )}
                <span className="truncate">{fname}</span>
              </div>
            ))}
            {project.materials_count > 3 && (
              <div className="text-[13px] text-ink-secondary pl-5">
                另有 {project.materials_count - 3} 份素材
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Tier 4: Empty blank canvas
  return (
    <div className="w-full h-full bg-surface-subtle p-5 flex items-center justify-center select-none">
      <div className="w-full h-full border border-dashed border-black/[0.12] rounded-xl flex flex-col items-center justify-center gap-2">
        <div className="w-12 h-1.5 rounded-full bg-black/[0.08]" />
        <div className="w-20 h-1.5 rounded-full bg-black/[0.05]" />
        <span className="text-[13px] text-ink-secondary pt-1">空白画布</span>
      </div>
    </div>
  );
}

function ProjectCardMenu({
  project,
  onRename,
  onDelete,
}: {
  project: ProjectSummaryItem;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, () => setOpen(false), [wrapRef]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="更多操作"
        aria-expanded={open}
        aria-haspopup="menu"
        title="更多操作"
        className={`p-1 rounded-full text-ink-secondary hover:text-ink hover:bg-black/[0.06] transition-colors cursor-pointer ${
          open ? "bg-black/[0.06] text-ink" : ""
        }`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-30 w-36 apple-glass dock-shadow rounded-xl p-1 space-y-0.5 anim-popover-down-in"
        >
          {project.download_available && (
            <a
              role="menuitem"
              href={`/api/projects/${project.project_id}/download`}
              download
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ink hover:bg-black/[0.06] transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
              <span>下载 PPTX</span>
            </a>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ink hover:bg-black/[0.06] transition-colors cursor-pointer text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
            <span>重命名</span>
          </button>
          <div className="my-1 border-t border-black/[0.08]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-danger hover:bg-danger-bg transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>删除文稿</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummaryItem[]>([]);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [themes, setThemes] = useState<ThemeOption[]>(FALLBACK_THEMES);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [llmSettings, setLlmSettings] = useState<LLMSettingsResponse | null>(null);
  const [showLLMModal, setShowLLMModal] = useState(false);

  const themeMap = useMemo(() => {
    const map = new Map<string, ThemeOption>();
    for (const t of FALLBACK_THEMES) map.set(t.id, t);
    for (const t of themes) map.set(t.id, t);
    return map;
  }, [themes]);

  async function load() {
    try {
      const [data, themeRes] = await Promise.all([
        api<{ projects: ProjectSummary[] }>("/api/projects"),
        api<{ themes: ThemeOption[] }>("/api/themes").catch(() => ({
          themes: FALLBACK_THEMES,
        })),
      ]);
      if (themeRes.themes?.length) {
        setThemes(themeRes.themes);
      }

      const list: ProjectSummaryItem[] = (data.projects || [])
        .map((p) => {
          const stage: StageKey =
            p.stage && p.stage in STAGE_STEPS ? p.stage : "empty";
          return {
            project_id: p.project_id || "",
            name: p.name || p.project_id || "",
            theme_id: p.theme_id || "keynote_light",
            stage,
            stage_label: p.stage_label || STAGE_STEPS[stage].label,
            slide_count: p.slide_count || 0,
            materials_count: p.materials_count || 0,
            material_names: p.material_names || [],
            insufficient_evidence_count: p.insufficient_evidence_count || 0,
            cover_slide: p.cover_slide ?? null,
            preview_cover_url: p.preview_cover_url ?? null,
            download_available: !!p.download_available,
            mtime: p.mtime || Date.now() / 1000,
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      setProjects(list);

      const needsEnrichment = list.filter(
        (p) => p.stage === "empty" && !p.materials_count && !p.name
      );
      if (needsEnrichment.length > 0) {
        Promise.all(
          needsEnrichment.map(async (item) => {
            try {
              const full = await api<Project>(
                `/api/projects/${item.project_id}`
              );
              return {
                ...item,
                name: full.name || item.name,
                theme_id: full.theme_id || full.latest_template_id || item.theme_id,
                download_available: full.download_available,
              };
            } catch {
              return item;
            }
          })
        ).then((enriched) => {
          setProjects((prev) =>
            prev.map(
              (p) =>
                enriched.find((e) => e.project_id === p.project_id) || p
            )
          );
        });
      }
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
    api<LLMSettingsResponse>("/api/settings/llm")
      .then(setLlmSettings)
      .catch(() => {});
  }, []);

  async function handleRename(pid: string) {
    const clean = editNameValue.trim();
    if (!clean) {
      setEditingId(null);
      return;
    }
    try {
      await api(`/api/projects/${pid}`, jsonOptions("PATCH", { name: clean }));
      setProjects((prev) =>
        prev.map((p) => (p.project_id === pid ? { ...p, name: clean } : p))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditingId(null);
    }
  }

  async function handleDelete(pid: string) {
    try {
      await api(`/api/projects/${pid}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.project_id !== pid));
      setConfirmDeleteId(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleCreateDemo() {
    if (creatingDemo) return;
    setCreatingDemo(true);
    setError("");
    try {
      const res = await api<{ project_id: string }>("/api/projects/demo", {
        method: "POST",
      });
      router.push(`/p/${encodeURIComponent(res.project_id)}`);
    } catch (e) {
      setError((e as Error).message);
      setCreatingDemo(false);
    }
  }

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_id.toLowerCase().includes(q) ||
        (p.cover_slide?.title || "").toLowerCase().includes(q)
    );
  }, [projects, search]);

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      {/* Monochrome Translucent Header */}
      <header className="h-[52px] apple-glass border-b border-black/[0.07] px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="hover:opacity-85 transition-opacity shrink-0"
            title="Draftboard"
          >
            <BrandLogo className="w-7 h-7" />
          </Link>
          <span className="font-semibold text-[15px] tracking-[-0.015em] text-ink">
            Draftboard
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <BackendStatus />
          <button
            type="button"
            onClick={() => setShowLLMModal(true)}
            aria-label="模型设置"
            title={
              llmSettings?.active_summary
                ? `模型设置（当前：${llmSettings.active_summary.name} / ${llmSettings.active_summary.model}）`
                : "模型设置（尚未配置，点击前往设置）"
            }
            className="px-3 py-1.5 rounded-full text-[13px] font-medium text-ink hover:bg-black/[0.05] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Settings className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
            <span className="hidden sm:inline">模型设置</span>
            {llmSettings && !llmSettings.configured && (
              <span className="w-1.5 h-1.5 rounded-full bg-warning-dot shrink-0" />
            )}
          </button>
          {projects.length > 0 && (
            <>
              <button
                type="button"
                disabled={creatingDemo}
                onClick={() => void handleCreateDemo()}
                aria-label="体验示例"
                className="px-3 py-1.5 rounded-full text-[13px] font-medium text-ink hover:bg-black/[0.05] transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                <span className="hidden sm:inline">{creatingDemo ? "准备中…" : "体验示例"}</span>
              </button>
              <Link
                href="/p/new"
                className="ui-btn-primary px-4 py-1.5 text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建文稿</span>
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-[1120px] w-full mx-auto px-6 sm:px-8 py-10 space-y-8">
        {/* Clean Section Heading (no slogan) */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">
              文稿
            </h1>
            {projects.length > 0 && (
              <span className="text-[14px] text-ink-secondary tabular-nums">
                {projects.length}
              </span>
            )}
          </div>

          {projects.length > 3 && (
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-ink-secondary" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索文稿…"
                className="w-full text-[13.5px] bg-surface border border-black/[0.12] rounded-full pl-9 pr-4 py-1.5 text-ink placeholder:text-ink-muted hover:border-black/30 focus:outline-none focus:border-ink transition-colors"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="px-4 py-2.5 rounded-xl bg-danger-bg border border-danger/20 text-[13px] text-danger flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="text-danger/70 hover:text-danger cursor-pointer shrink-0"
            >
              关闭
            </button>
          </div>
        )}

        {/* 16:9 Document Library Grid */}
        {projects.length > 0 ? (
          filteredProjects.length > 0 ? (
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
            {filteredProjects.map((p) => {
              const theme =
                themeMap.get(p.theme_id) || FALLBACK_THEMES[0];
              const stageInfo = STAGE_STEPS[p.stage];
              const metaParts: string[] = [];
              if (p.slide_count > 0) metaParts.push(`${p.slide_count} 页`);
              metaParts.push(`${p.materials_count} 份素材`);
              metaParts.push(formatRelativeTime(p.mtime));

              return (
                <article
                  key={p.project_id}
                  className="group bg-surface rounded-[16px] border border-black/[0.1] shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-[transform,box-shadow,border-color] duration-[180ms] ease-out flex flex-col"
                >
                  {/* Top: Pure 16:9 Slide Content Preview */}
                  <Link
                    href={`/p/${p.project_id}`}
                    className="block aspect-[16/9] rounded-t-[15px] overflow-hidden border-b border-black/[0.08] relative"
                  >
                    <SlideCardPreview project={p} theme={theme} />
                  </Link>

                  {/* Bottom: Consolidated Metadata & 4-Step Progress */}
                  <div className="p-4 flex flex-col gap-3 flex-1 justify-between">
                    <div className="space-y-1.5">
                      {editingId === p.project_id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleRename(p.project_id);
                          }}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            value={editNameValue}
                            onChange={(e) => setEditNameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingId(null);
                              }
                            }}
                            autoFocus
                            className="flex-1 min-w-0 text-[14.5px] font-semibold bg-surface border border-ink rounded-lg px-2.5 py-1 text-ink outline-none"
                          />
                          <button
                            type="submit"
                            className="p-1.5 rounded-lg bg-ink text-white cursor-pointer"
                            title="保存名称"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg bg-black/[0.06] text-ink-secondary cursor-pointer"
                            title="取消 (Esc)"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : confirmDeleteId === p.project_id ? (
                        <div className="flex items-center justify-between gap-2 py-0.5 px-2 rounded-lg bg-danger-bg border border-danger/20">
                          <span className="text-[13px] font-medium text-danger truncate">
                            确认删除此文稿？
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleDelete(p.project_id)}
                              className="px-2.5 py-0.5 rounded-full bg-danger hover:bg-danger-hover text-white text-[13px] font-medium cursor-pointer"
                            >
                              删除
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 rounded-full text-ink-secondary hover:text-ink text-[13px] cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/p/${p.project_id}`}
                            className="text-[15.5px] font-semibold text-ink hover:opacity-70 transition-opacity truncate"
                          >
                            {p.name}
                          </Link>
                          <ProjectCardMenu
                            project={p}
                            onRename={() => {
                              setConfirmDeleteId(null);
                              setEditingId(p.project_id);
                              setEditNameValue(p.name);
                            }}
                            onDelete={() => {
                              setEditingId(null);
                              setConfirmDeleteId(p.project_id);
                            }}
                          />
                        </div>
                      )}

                      {/* Single consolidated high-contrast metadata line */}
                      <div className="text-[13px] text-ink-secondary tabular-nums truncate">
                        {metaParts.join(" · ")}
                        {p.insufficient_evidence_count > 0 && (
                          <span> · {p.insufficient_evidence_count} 页待补依据</span>
                        )}
                      </div>
                    </div>

                    {/* 4-Step Monochrome Workflow Progress */}
                    <div className="pt-2.5 border-t border-black/[0.06] flex items-center gap-3">
                      <div
                        className="flex items-center gap-1 flex-1"
                        aria-label={`进度 ${stageInfo.step} / 4`}
                      >
                        {[1, 2, 3, 4].map((idx) => (
                          <span
                            key={idx}
                            className={`h-[3px] flex-1 rounded-full transition-colors ${
                              idx <= stageInfo.step
                                ? "bg-ink"
                                : "bg-black/[0.11]"
                            }`}
                          />
                        ))}
                      </div>
                      <span
                        className={`text-[13px] font-medium tabular-nums shrink-0 inline-flex items-center gap-1 ${
                          stageInfo.step === 4
                            ? "text-ink"
                            : "text-ink-secondary"
                        }`}
                      >
                        {stageInfo.step === 4 && (
                          <Check className="w-3.5 h-3.5 stroke-[2.25]" />
                        )}
                        <span>
                          {stageInfo.step}/4 {p.stage_label}
                        </span>
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
          ) : (
            <section className="bg-surface rounded-2xl border border-black/[0.08] p-10 text-center space-y-3">
              <div className="text-[14.5px] font-medium text-ink">
                未找到包含「{search}」的文稿
              </div>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="ui-btn-primary px-4 py-1.5 text-[13px]"
              >
                清除搜索
              </button>
            </section>
          )
        ) : loaded ? (
          /* Clean Monochrome Empty Library State */
          <section className="bg-surface rounded-[20px] p-10 sm:p-14 border border-black/[0.08] shadow-[0_6px_24px_rgba(0,0,0,0.04)] max-w-xl mx-auto text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
                创建你的第一份演示文稿
              </h2>
              <p className="text-[14px] text-ink-secondary leading-relaxed">
                直接导入文档素材、粘贴笔记或输入一句话主题，生成可溯源大纲并导出 PPTX。
                <br />
                文稿名称会自动根据封面标题生成，随时可修改。
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/p/new"
                className="ui-btn-primary inline-flex items-center gap-1.5 h-11 px-6 text-[14px]"
              >
                <Plus className="w-4 h-4" />
                <span>新建演示文稿</span>
              </Link>
              <button
                type="button"
                disabled={creatingDemo}
                onClick={() => void handleCreateDemo()}
                className="ui-btn-outline inline-flex items-center gap-1.5 h-11 px-5 text-[14px]"
              >
                <Sparkles className="w-4 h-4" />
                <span>{creatingDemo ? "正在生成示例…" : "10 秒体验示例文稿"}</span>
              </button>
            </div>
          </section>
        ) : (
          <section
            aria-label="正在加载文稿"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-surface rounded-[16px] border border-black/[0.08] overflow-hidden animate-pulse"
              >
                <div className="aspect-[16/9] bg-surface-subtle border-b border-black/[0.06]" />
                <div className="p-4 space-y-3">
                  <div className="space-y-2">
                    <div className="h-4 w-2/3 rounded-md bg-black/[0.07]" />
                    <div className="h-3.5 w-1/2 rounded-md bg-black/[0.05]" />
                  </div>
                  <div className="pt-2.5 border-t border-black/[0.05] flex items-center gap-3">
                    <div className="h-[3px] flex-1 rounded-full bg-black/[0.08]" />
                    <div className="h-3 w-16 rounded-md bg-black/[0.06]" />
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      <LLMSettingsModal
        open={showLLMModal}
        settings={llmSettings}
        onClose={() => setShowLLMModal(false)}
        onSettingsUpdated={setLlmSettings}
      />
    </div>
  );
}
