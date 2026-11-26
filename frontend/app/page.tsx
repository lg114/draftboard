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
  needsContrastHairline,
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
  if (sec < 60) return "刚刚";
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

function resolveCoverBg(
  project: ProjectSummaryItem,
  theme: ThemeOption
): string | null {
  if (project.cover_slide) {
    return (
      project.cover_slide.custom_bg ||
      theme.swatches.cover_bg ||
      theme.swatches.bg ||
      null
    );
  }
  return null;
}

function SlideCardPreview({
  project,
  theme,
  surface = "grid",
}: {
  project: ProjectSummaryItem;
  theme: ThemeOption;
  surface?: "hero" | "grid";
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
      <div className="w-full h-full bg-ui-surface relative">
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

  const canvasTone = surface === "hero" ? "bg-ui-bg" : "bg-ui-surface";

  // Tier 3: Materials uploaded, outline not generated yet
  if (project.materials_count > 0) {
    return (
      <div
        className={`w-full h-full ${canvasTone} p-5 flex flex-col justify-between select-none`}
      >
        <div className="space-y-2">
          {project.material_names.slice(0, 3).map((fname) => (
            <div
              key={fname}
              className="flex items-center gap-2 text-[13px] text-ui-text-secondary"
            >
              {isImageFilename(fname) ? (
                <ImageIcon className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-ui-icon shrink-0" />
              )}
              <span className="truncate">{fname}</span>
            </div>
          ))}
          {project.materials_count > 3 && (
            <div className="text-[12px] text-ui-text-muted pl-5.5">
              另有 {project.materials_count - 3} 份材料
            </div>
          )}
        </div>
        <div className="text-[12px] text-ui-text-muted">
          已导入 {project.materials_count} 份材料，等待生成大纲
        </div>
      </div>
    );
  }

  // Tier 4: Empty blank canvas
  return (
    <div
      className={`w-full h-full ${canvasTone} p-6 flex flex-col justify-between select-none`}
    >
      <div className="space-y-2.5 pt-2">
        <div className="w-2/5 h-2 rounded-full bg-ui-bg-selected" />
        <div className="w-3/5 h-1.5 rounded-full bg-ui-control-active/80" />
      </div>
      <div className="text-[12px] text-ui-text-muted">空白画布</div>
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
        className={`p-1 rounded-md text-ui-icon hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer ${
          open ? "bg-ui-control-hover text-ui-text" : ""
        }`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 z-30 w-36 ui-popover rounded-xl p-1 space-y-0.5 anim-popover-down-in"
        >
          {project.download_available && (
            <a
              role="menuitem"
              href={`/api/projects/${project.project_id}/download`}
              download
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-ui-icon shrink-0" />
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
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer text-left"
          >
            <Pencil className="w-3.5 h-3.5 text-ui-icon shrink-0" />
            <span>重命名</span>
          </button>
          <div className="my-1 border-t border-ui-border-subtle" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-ui-danger hover:bg-ui-danger-bg transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" />
            <span>删除文稿</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectTitleRow({
  project,
  variant = "grid",
  isEditing,
  isConfirmingDelete,
  editNameValue,
  onEditNameChange,
  onSubmitRename,
  onCancelRename,
  onStartRename,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  project: ProjectSummaryItem;
  variant?: "hero" | "grid";
  isEditing: boolean;
  isConfirmingDelete: boolean;
  editNameValue: string;
  onEditNameChange: (val: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onStartRename: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmitRename();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={editNameValue}
          onChange={(e) => onEditNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancelRename();
            }
          }}
          autoFocus
          className={`ui-field flex-1 min-w-0 font-medium px-2.5 py-1 ${
            variant === "hero" ? "text-[16px]" : "text-[14px]"
          }`}
        />
        <button
          type="submit"
          className="ui-btn-primary p-1.5"
          title="保存名称"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onCancelRename}
          className="ui-btn-subtle p-1.5"
          title="取消 (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

  if (isConfirmingDelete) {
    return (
      <div className="flex items-center justify-between gap-2 py-1 px-2.5 rounded-lg bg-ui-danger-bg">
        <span className="text-[12.5px] font-medium text-ui-danger truncate">
          确认删除此文稿？
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onConfirmDelete}
            className="px-2.5 py-0.5 rounded bg-ui-danger text-ui-bg text-[12.5px] font-medium hover:brightness-110 cursor-pointer"
          >
            删除
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            className="px-2 py-0.5 rounded text-ui-text-secondary hover:text-ui-text text-[12.5px] cursor-pointer"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2">
      <Link
        href={`/p/${project.project_id}`}
        className={
          variant === "hero"
            ? "text-[21px] sm:text-[23px] font-semibold tracking-[-0.025em] leading-[1.3] text-ui-text hover:text-white transition-colors line-clamp-2 min-w-0"
            : "text-[14.5px] font-medium tracking-[-0.01em] text-ui-text hover:text-white transition-colors truncate min-w-0 pt-0.5"
        }
      >
        {project.name}
      </Link>
      <ProjectCardMenu
        project={project}
        onRename={onStartRename}
        onDelete={onRequestDelete}
      />
    </div>
  );
}

function StageStatusIndicator({
  project,
}: {
  project: ProjectSummaryItem;
}) {
  const stageInfo = STAGE_STEPS[project.stage];
  const isReady = project.stage === "ready";
  const dotClass = isReady
    ? "bg-ui-success"
    : stageInfo.step >= 2
      ? "bg-ui-accent"
      : "bg-ui-icon-quiet";

  return (
    <span
      className={`inline-flex items-center gap-1.5 shrink-0 ${
        isReady ? "text-ui-success" : "text-ui-text-muted"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      <span>{project.stage_label}</span>
    </span>
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
  const [llmSettings, setLlmSettings] = useState<LLMSettingsResponse | null>(
    null
  );
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
                theme_id:
                  full.theme_id || full.latest_template_id || item.theme_id,
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

  const trimmedSearch = search.trim();
  const hasSearch = trimmedSearch.length > 0;

  const filteredProjects = useMemo(() => {
    if (!trimmedSearch) return projects;
    const q = trimmedSearch.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_id.toLowerCase().includes(q) ||
        (p.cover_slide?.title || "").toLowerCase().includes(q)
    );
  }, [projects, trimmedSearch]);

  const featuredProject = !hasSearch && projects.length > 0 ? projects[0] : null;
  const gridProjects = hasSearch
    ? filteredProjects
    : projects.length > 1
      ? projects.slice(1)
      : [];

  return (
    <div className="h-dvh overflow-y-auto clean-scroll clean-scroll-stable flex flex-col bg-ui-bg text-ui-text">
      {/* Compact Single-Row Workbench Header */}
      <header className="h-12 bg-ui-bg/92 backdrop-blur-md px-5 flex items-center justify-between gap-4 sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="hover:opacity-85 transition-opacity shrink-0"
            title="Draftboard"
          >
            <BrandLogo className="w-6 h-6" />
          </Link>
          <span className="font-semibold text-[14.5px] tracking-[-0.015em] text-ui-text">
            Draftboard
          </span>
        </div>

        <div className="flex items-center gap-2">
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
            className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Settings className="w-3.5 h-3.5 text-ui-icon shrink-0" />
            <span className="hidden sm:inline">模型设置</span>
            {llmSettings && !llmSettings.configured && (
              <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
            )}
          </button>
          {projects.length > 0 && (
            <>
              <button
                type="button"
                disabled={creatingDemo}
                onClick={() => void handleCreateDemo()}
                aria-label="体验示例"
                className="px-2.5 py-1.5 rounded-md text-[13px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-bg-hover transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                <span className="hidden sm:inline">
                  {creatingDemo ? "准备中…" : "体验示例"}
                </span>
              </button>
              <Link
                href="/p/new"
                className="ui-btn-primary h-8 px-3.5 text-[13px] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新建文稿</span>
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-[1160px] w-full mx-auto px-6 sm:px-8 pt-6 pb-16 space-y-10">
        {error && (
          <div className="px-4 py-2.5 rounded-xl bg-ui-danger-bg text-[13px] text-ui-danger flex items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="text-ui-danger/80 hover:text-ui-danger cursor-pointer shrink-0"
            >
              关闭
            </button>
          </div>
        )}

        {projects.length > 0 ? (
          <>
            {/* Focal Stage: Most Recently Edited Deck (hidden during active search) */}
            {featuredProject && (() => {
              const theme =
                themeMap.get(featuredProject.theme_id) || FALLBACK_THEMES[0];
              const coverBg = resolveCoverBg(featuredProject, theme);
              const needsRim = needsContrastHairline(coverBg, "#151516", 28);

              return (
                <section
                  aria-label="最近编辑的文稿"
                  className="bg-ui-surface rounded-2xl p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-6 lg:gap-8 items-center"
                >
                  <Link
                    href={`/p/${featuredProject.project_id}`}
                    className={`block aspect-[16/9] rounded-xl overflow-clip relative transition-shadow duration-[150ms] ease-out hover:ring-1 hover:ring-ui-border/55 ${
                      needsRim ? "ring-1 ring-ui-n7" : ""
                    }`}
                  >
                    <SlideCardPreview
                      project={featuredProject}
                      theme={theme}
                      surface="hero"
                    />
                  </Link>

                  <div className="flex flex-col justify-between gap-6 min-w-0">
                    <div className="space-y-3.5">
                      <ProjectTitleRow
                        project={featuredProject}
                        variant="hero"
                        isEditing={editingId === featuredProject.project_id}
                        isConfirmingDelete={
                          confirmDeleteId === featuredProject.project_id
                        }
                        editNameValue={editNameValue}
                        onEditNameChange={setEditNameValue}
                        onSubmitRename={() =>
                          void handleRename(featuredProject.project_id)
                        }
                        onCancelRename={() => setEditingId(null)}
                        onStartRename={() => {
                          setConfirmDeleteId(null);
                          setEditingId(featuredProject.project_id);
                          setEditNameValue(featuredProject.name);
                        }}
                        onRequestDelete={() => {
                          setEditingId(null);
                          setConfirmDeleteId(featuredProject.project_id);
                        }}
                        onConfirmDelete={() =>
                          void handleDelete(featuredProject.project_id)
                        }
                        onCancelDelete={() => setConfirmDeleteId(null)}
                      />

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ui-text-muted tabular-nums">
                        <StageStatusIndicator project={featuredProject} />
                        {featuredProject.slide_count > 0 && (
                          <span>{featuredProject.slide_count} 页</span>
                        )}
                        <span>{featuredProject.materials_count} 份材料</span>
                        <span>
                          更新于 {formatRelativeTime(featuredProject.mtime)}
                        </span>
                      </div>

                      {featuredProject.insufficient_evidence_count > 0 && (
                        <div className="text-[12.5px] text-ui-warning">
                          {featuredProject.insufficient_evidence_count} 页待补充依据
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        href={`/p/${featuredProject.project_id}`}
                        className="ui-btn-primary h-9 px-4 text-[13.5px] inline-flex items-center gap-1.5"
                      >
                        <span>继续编辑</span>
                      </Link>
                      {featuredProject.download_available && (
                        <a
                          href={`/api/projects/${featuredProject.project_id}/download`}
                          download
                          className="ui-btn-subtle h-9 px-3.5 text-[13px] inline-flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5 text-ui-icon shrink-0" />
                          <span>下载 PPTX</span>
                        </a>
                      )}
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Contact-Sheet Library Bar & Grid */}
            {(projects.length > 1 || hasSearch) && (
              <section className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-baseline gap-2.5">
                    <h1 className="text-[16px] font-medium tracking-[-0.015em] text-ui-text">
                      {hasSearch ? "搜索结果" : "更多文稿"}
                    </h1>
                    <span className="text-[13px] text-ui-text-muted tabular-nums">
                      {gridProjects.length}
                    </span>
                  </div>

                  {projects.length > 3 && (
                    <div className="relative w-full sm:w-64">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ui-icon pointer-events-none" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索文稿"
                        aria-label="搜索文稿"
                        className="ui-field w-full h-8.5 text-[13px] pl-8.5 pr-8"
                      />
                      {hasSearch && (
                        <button
                          type="button"
                          onClick={() => setSearch("")}
                          aria-label="清除搜索"
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-ui-icon hover:text-ui-text cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {gridProjects.length > 0 ? (
                  <div className="deck-contact-grid">
                    {gridProjects.map((p) => {
                      const theme =
                        themeMap.get(p.theme_id) || FALLBACK_THEMES[0];
                      const coverBg = resolveCoverBg(p, theme);
                      const needsRim = needsContrastHairline(
                        coverBg,
                        "#0D0D0E",
                        28
                      );

                      return (
                        <article
                          key={p.project_id}
                          className="deck-contact-item group min-w-0"
                        >
                          {/* Track 1: Borderless 16:9 Slide Print */}
                          <Link
                            href={`/p/${p.project_id}`}
                            className={`block aspect-[16/9] rounded-lg overflow-clip relative transition-shadow duration-[150ms] ease-out group-hover:ring-1 group-hover:ring-ui-border/55 ${
                              needsRim ? "ring-1 ring-ui-n7" : ""
                            }`}
                          >
                            <SlideCardPreview
                              project={p}
                              theme={theme}
                              surface="grid"
                            />
                          </Link>

                          {/* Track 2: Quiet Caption & Spatial Metadata */}
                          <div className="flex flex-col gap-1.5 min-w-0">
                            <ProjectTitleRow
                              project={p}
                              variant="grid"
                              isEditing={editingId === p.project_id}
                              isConfirmingDelete={
                                confirmDeleteId === p.project_id
                              }
                              editNameValue={editNameValue}
                              onEditNameChange={setEditNameValue}
                              onSubmitRename={() =>
                                void handleRename(p.project_id)
                              }
                              onCancelRename={() => setEditingId(null)}
                              onStartRename={() => {
                                setConfirmDeleteId(null);
                                setEditingId(p.project_id);
                                setEditNameValue(p.name);
                              }}
                              onRequestDelete={() => {
                                setEditingId(null);
                                setConfirmDeleteId(p.project_id);
                              }}
                              onConfirmDelete={() =>
                                void handleDelete(p.project_id)
                              }
                              onCancelDelete={() => setConfirmDeleteId(null)}
                            />

                            <div className="flex items-center justify-between gap-3 text-[12.5px] text-ui-text-muted tabular-nums">
                              <div className="flex items-center gap-2.5 min-w-0 truncate">
                                <StageStatusIndicator project={p} />
                                {p.slide_count > 0 && (
                                  <span className="shrink-0">
                                    {p.slide_count} 页
                                  </span>
                                )}
                                {p.insufficient_evidence_count > 0 && (
                                  <span className="text-ui-warning truncate">
                                    {p.insufficient_evidence_count} 页待补依据
                                  </span>
                                )}
                              </div>
                              <span className="shrink-0">
                                {formatRelativeTime(p.mtime)}
                              </span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bg-ui-surface rounded-2xl p-10 text-center space-y-3">
                    <div className="text-[14px] font-medium text-ui-text">
                      未找到包含「{trimmedSearch}」的文稿
                    </div>
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="ui-btn-subtle h-8.5 px-4 text-[13px]"
                    >
                      清除搜索
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        ) : loaded ? (
          <section className="bg-ui-surface rounded-2xl p-10 sm:p-14 max-w-xl mx-auto mt-10 text-center space-y-6">
            <div className="space-y-2.5">
              <h1 className="text-[21px] font-semibold tracking-[-0.025em] text-ui-text">
                开始你的第一份演示文稿
              </h1>
              <p className="text-[13.5px] text-ui-text-muted leading-relaxed">
                导入文档材料、粘贴笔记或输入主题，生成结构化大纲并导出 PPTX。
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/p/new"
                className="ui-btn-primary inline-flex items-center gap-1.5 h-9.5 px-5 text-[13.5px]"
              >
                <Plus className="w-4 h-4" />
                <span>新建文稿</span>
              </Link>
              <button
                type="button"
                disabled={creatingDemo}
                onClick={() => void handleCreateDemo()}
                className="ui-btn-subtle inline-flex items-center gap-1.5 h-9.5 px-5 text-[13.5px]"
              >
                <Sparkles className="w-4 h-4 text-ui-icon" />
                <span>{creatingDemo ? "准备中…" : "体验示例"}</span>
              </button>
            </div>
          </section>
        ) : (
          <div aria-label="正在加载文稿" className="space-y-10 animate-pulse">
            <div className="bg-ui-surface rounded-2xl p-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-8 items-center">
              <div className="aspect-[16/9] rounded-xl bg-ui-bg" />
              <div className="space-y-4">
                <div className="h-6 w-3/4 rounded bg-ui-bg-selected" />
                <div className="h-4 w-1/2 rounded bg-ui-surface-input" />
                <div className="flex gap-2.5 pt-2">
                  <div className="h-9 w-24 rounded-lg bg-ui-bg-selected" />
                  <div className="h-9 w-24 rounded-lg bg-ui-surface-input" />
                </div>
              </div>
            </div>
            <div className="deck-contact-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="deck-contact-item">
                  <div className="aspect-[16/9] rounded-lg bg-ui-surface" />
                  <div className="space-y-2">
                    <div className="h-4 w-2/3 rounded bg-ui-bg-selected" />
                    <div className="h-3.5 w-1/2 rounded bg-ui-surface" />
                  </div>
                </div>
              ))}
            </div>
          </div>
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
