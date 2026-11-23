"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  FileText,
  Image as ImageIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  CoverSlidePreview,
  FALLBACK_THEMES,
  jsonOptions,
  Project,
  ProjectSummary,
  ThemeOption,
} from "../lib/api";
import { BackendStatus } from "../components/BackendStatus";
import { BrandLogo } from "../components/BrandLogo";
import { inferEffectiveLayout } from "../components/workspace/layoutUtils";

type StageKey = "ready" | "confirmed" | "outline_draft" | "materials_ready" | "empty";

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

const STAGE_STEPS: Record<StageKey, { step: number; label: string }> = {
  empty: { step: 0, label: "待上传素材" },
  materials_ready: { step: 1, label: "素材已导入" },
  outline_draft: { step: 2, label: "大纲待审核" },
  confirmed: { step: 3, label: "大纲已确认" },
  ready: { step: 4, label: "PPT 已就绪" },
};

function slugifyName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed.slice(0, 48);
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).substring(2, 6);
  if (ascii.length >= 2) return `${ascii.slice(0, 24)}-${suffix}`;
  const hash = Math.abs(
    trimmed.split("").reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0)
  ).toString(36);
  return `deck-${hash.slice(0, 4)}-${suffix}`;
}

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

function parseBulletLines(summary: string): string[] {
  return summary
    .split(/\n+|[；;]\s*/)
    .map((line) => line.replace(/^[-•·*\d.]+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function SlideCardPreview({
  project,
  theme,
}: {
  project: ProjectSummaryItem;
  theme: ThemeOption;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // Tier 1: Real rendered cover PNG (when exported & synced)
  if (project.preview_cover_url && !imgFailed) {
    return (
      <div className="w-full h-full bg-[#f5f5f7] relative">
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

  // Tier 2: Authentic live miniature of Slide 1 using the project's real theme
  if (project.cover_slide) {
    const slide = project.cover_slide;
    const layout = inferEffectiveLayout(slide.layout, 0, Math.max(1, project.slide_count));
    const sw = theme.swatches;
    const isHero = layout === "cover" || layout === "closing";
    const bg = isHero ? sw.cover_bg : sw.bg;
    const titleCol = isHero ? sw.cover_title : sw.title;
    const bodyCol = isHero ? sw.cover_body : sw.body;

    if (layout === "cover") {
      return (
        <div
          className="w-full h-full px-6 py-5 flex flex-col justify-between select-none"
          style={{ backgroundColor: bg }}
        >
          <div className="flex-1 flex flex-col justify-center gap-2 min-h-0">
            <div
              className="w-8 h-[2.5px] rounded-full shrink-0 mb-0.5"
              style={{ backgroundColor: sw.accent }}
            />
            <div
              className="text-[17px] font-bold tracking-[-0.02em] leading-[1.28] line-clamp-2"
              style={{ color: titleCol }}
            >
              {slide.title || "未命名封面"}
            </div>
            {slide.summary && (
              <div
                className="text-[12px] leading-[1.45] line-clamp-2"
                style={{ color: bodyCol }}
              >
                {slide.summary}
              </div>
            )}
          </div>
          <div
            className="w-full h-px shrink-0"
            style={{ backgroundColor: sw.divider }}
          />
        </div>
      );
    }

    if (layout === "closing") {
      return (
        <div
          className="w-full h-full px-6 py-5 flex flex-col items-center justify-between text-center select-none"
          style={{ backgroundColor: bg }}
        >
          <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0">
            <div
              className="w-7 h-[2px] rounded-full shrink-0"
              style={{ backgroundColor: sw.accent }}
            />
            <div
              className="text-[16px] font-bold tracking-[-0.02em] leading-[1.3] line-clamp-2"
              style={{ color: titleCol }}
            >
              {slide.title || "谢谢聆听"}
            </div>
            {slide.summary && (
              <div
                className="text-[12px] leading-[1.45] line-clamp-2"
                style={{ color: bodyCol }}
              >
                {slide.summary}
              </div>
            )}
          </div>
          <div
            className="w-2/3 h-px shrink-0"
            style={{ backgroundColor: sw.divider }}
          />
        </div>
      );
    }

    const headerBar = (
      <div className="relative pb-2">
        <div
          className="text-[13.5px] font-semibold tracking-[-0.015em] truncate"
          style={{ color: titleCol }}
        >
          {slide.title || "未命名页面"}
        </div>
        <div
          className="absolute left-0 right-0 bottom-0 h-px"
          style={{ backgroundColor: sw.divider }}
        />
        <div
          className="absolute left-0 bottom-0 w-7 h-[2px] rounded-full"
          style={{ backgroundColor: sw.accent }}
        />
      </div>
    );

    if (layout === "two_column") {
      return (
        <div
          className="w-full h-full px-5 py-4 flex flex-col gap-2.5 select-none"
          style={{ backgroundColor: bg }}
        >
          {headerBar}
          <div className="grid grid-cols-2 gap-3 flex-1 min-h-0 overflow-hidden">
            <div
              className="text-[11px] leading-[1.5] line-clamp-4 pr-2 border-r"
              style={{ color: bodyCol, borderColor: sw.divider }}
            >
              {slide.summary || "左栏内容"}
            </div>
            <div
              className="text-[11px] leading-[1.5] line-clamp-4"
              style={{ color: bodyCol }}
            >
              {slide.column_right || "右栏内容"}
            </div>
          </div>
        </div>
      );
    }

    if (layout === "text_image") {
      return (
        <div
          className="w-full h-full px-5 py-4 flex flex-col gap-2.5 select-none"
          style={{ backgroundColor: bg }}
        >
          {headerBar}
          <div className="grid grid-cols-12 gap-3 flex-1 min-h-0 items-center overflow-hidden">
            <div
              className="col-span-6 text-[11px] leading-[1.5] line-clamp-4"
              style={{ color: bodyCol }}
            >
              {slide.summary || "正文内容"}
            </div>
            <div
              className="col-span-6 h-full rounded-lg overflow-hidden flex items-center justify-center border"
              style={{ backgroundColor: sw.surface, borderColor: sw.divider }}
            >
              {slide.image_asset_id ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/projects/${project.project_id}/assets/${encodeURIComponent(
                    slide.image_asset_id
                  )}`}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-4 h-4 opacity-35" style={{ color: bodyCol }} />
              )}
            </div>
          </div>
        </div>
      );
    }

    const bullets = parseBulletLines(slide.summary);
    return (
      <div
        className="w-full h-full px-5 py-4 flex flex-col gap-2.5 select-none"
        style={{ backgroundColor: bg }}
      >
        {headerBar}
        {bullets.length > 1 ? (
          <ul className="space-y-1.5 flex-1 min-h-0 overflow-hidden">
            {bullets.map((line, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-[11px] leading-[1.45]"
                style={{ color: bodyCol }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full mt-[5px] shrink-0"
                  style={{ backgroundColor: sw.accent }}
                />
                <span className="line-clamp-1">{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="text-[11.5px] leading-[1.55] line-clamp-4 flex-1"
            style={{ color: bodyCol }}
          >
            {slide.summary || "正文内容"}
          </div>
        )}
      </div>
    );
  }

  // Tier 3: Materials uploaded, outline not generated yet
  if (project.materials_count > 0) {
    return (
      <div className="w-full h-full bg-[#f7f7f8] p-4 flex flex-col justify-center select-none">
        <div className="border border-dashed border-black/[0.12] rounded-xl bg-white/70 px-4 py-3.5 space-y-2">
          <div className="text-[11px] font-medium text-[#52525b]">
            已导入素材 · 等待生成大纲
          </div>
          <div className="space-y-1.5">
            {project.material_names.slice(0, 3).map((fname) => (
              <div
                key={fname}
                className="flex items-center gap-2 text-[12px] text-[#27272a]"
              >
                {isImageFilename(fname) ? (
                  <ImageIcon className="w-3.5 h-3.5 text-[#52525b] shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-[#52525b] shrink-0" />
                )}
                <span className="truncate">{fname}</span>
              </div>
            ))}
            {project.materials_count > 3 && (
              <div className="text-[11px] text-[#52525b] pl-5">
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
    <div className="w-full h-full bg-[#f7f7f8] p-5 flex items-center justify-center select-none">
      <div className="w-full h-full border border-dashed border-black/[0.12] rounded-xl flex flex-col items-center justify-center gap-2">
        <div className="w-12 h-1.5 rounded-full bg-black/[0.08]" />
        <div className="w-20 h-1.5 rounded-full bg-black/[0.05]" />
        <span className="text-[12px] text-[#52525b] pt-1">空白画布</span>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummaryItem[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>(FALLBACK_THEMES);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [customId, setCustomId] = useState("");
  const [isCustomizingId, setIsCustomizingId] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const derivedSlug = useMemo(() => slugifyName(nameInput), [nameInput]);
  const effectiveId = isCustomizingId ? customId.trim() : derivedSlug;

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
  }, []);

  useEffect(() => {
    if (!showCreate) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCreate(false);
        setError("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showCreate]);

  async function handleCreate(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setError("请输入文稿名称");
      return;
    }
    const finalId = effectiveId.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(finalId)) {
      setError("目录标识只能包含字母、数字、下划线和连字符，且以字母或数字开头");
      return;
    }

    setLoading(true);
    try {
      await api(
        "/api/projects",
        jsonOptions("POST", { project_id: finalId, name: trimmedName })
      );
      setNameInput("");
      setCustomId("");
      setIsCustomizingId(false);
      setShowCreate(false);
      router.push(`/p/${finalId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

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
    <div className="min-h-screen flex flex-col bg-[#f5f5f7] text-[#1d1d1f]">
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
          <span className="font-semibold text-[15px] tracking-[-0.015em] text-[#1d1d1f]">
            Draftboard
          </span>
        </div>

        <div className="flex items-center gap-3">
          <BackendStatus />
          {projects.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowCreate((v) => !v);
                setError("");
              }}
              className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                showCreate
                  ? "bg-transparent text-[#1d1d1f] ring-1 ring-black/15 hover:bg-black/[0.05]"
                  : "bg-[#1d1d1f] hover:bg-[#323236] text-white"
              }`}
            >
              {showCreate ? (
                <>
                  <X className="w-3.5 h-3.5" />
                  <span>取消</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>新建文稿</span>
                </>
              )}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-[1120px] w-full mx-auto px-6 sm:px-8 py-10 space-y-8">
        {/* Clean Section Heading (no slogan) */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[#1d1d1f]">
              文稿
            </h1>
            {projects.length > 0 && (
              <span className="text-[14px] text-[#52525b] tabular-nums">
                {projects.length}
              </span>
            )}
          </div>

          {projects.length > 3 && (
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-[#52525b]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索文稿…"
                className="w-full text-[13.5px] bg-white border border-black/[0.1] rounded-full pl-9 pr-4 py-1.5 text-[#1d1d1f] placeholder-[#71717a] focus:outline-none focus:border-[#1d1d1f] transition-colors"
              />
            </div>
          )}
        </div>

        {/* Inline Creation Sheet */}
        {showCreate && (
          <section className="bg-white rounded-2xl p-6 border border-black/[0.08] shadow-[0_6px_24px_rgba(0,0,0,0.05)] max-w-2xl space-y-4">
            <div className="text-[15px] font-semibold text-[#1d1d1f]">
              新建演示文稿
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <input
                  placeholder="输入文稿名称，例如：2026 年度技术架构评审"
                  value={nameInput}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    if (!isCustomizingId) {
                      setCustomId(slugifyName(e.target.value));
                    }
                  }}
                  disabled={loading}
                  autoFocus
                  className="flex-1 h-11 rounded-full bg-[#f5f5f7] border border-black/[0.12] px-5 text-[15px] text-[#1d1d1f] placeholder-[#71717a] outline-none transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-black/30 focus:bg-white focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.08] disabled:opacity-60"
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="submit"
                    disabled={loading || !nameInput.trim()}
                    className="h-11 px-6 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[14px] font-medium transition-colors duration-200 shrink-0 cursor-pointer disabled:bg-[#e4e4e7] disabled:text-[#52525b] disabled:cursor-not-allowed"
                  >
                    {loading ? "创建中…" : "创建并打开"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate(false);
                      setError("");
                    }}
                    className="h-11 px-3 rounded-full text-[14px] font-medium text-[#52525b] hover:text-[#1d1d1f] hover:bg-black/[0.04] transition-colors shrink-0 cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              </div>

              {nameInput.trim() && (
                <div className="flex items-center justify-between text-[12.5px] text-[#52525b] px-1">
                  <div className="flex items-center gap-2 font-mono">
                    <span>标识:</span>
                    {isCustomizingId ? (
                      <input
                        value={customId}
                        onChange={(e) => setCustomId(e.target.value)}
                        className="bg-[#f5f5f7] border border-black/15 rounded-lg px-2 py-0.5 text-[12.5px] text-[#1d1d1f] outline-none focus:border-[#1d1d1f]"
                      />
                    ) : (
                      <span className="text-[#1d1d1f]">{effectiveId}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCustomizingId((v) => !v)}
                    className="text-[#1d1d1f] underline underline-offset-2 hover:opacity-75 cursor-pointer"
                  >
                    {isCustomizingId ? "自动生成" : "自定义标识"}
                  </button>
                </div>
              )}

              {error && (
                <div className="text-[13px] text-[#d70015]">{error}</div>
              )}
            </form>
          </section>
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
                  className="group bg-white rounded-[16px] border border-black/[0.1] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_28px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col"
                >
                  {/* Top: Pure 16:9 Slide Content Preview */}
                  <Link
                    href={`/p/${p.project_id}`}
                    className="block aspect-[16/9] overflow-hidden border-b border-black/[0.08] relative"
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
                            autoFocus
                            className="flex-1 min-w-0 text-[14.5px] font-semibold bg-white border border-[#1d1d1f] rounded-lg px-2.5 py-1 text-[#1d1d1f] outline-none"
                          />
                          <button
                            type="submit"
                            className="p-1.5 rounded-lg bg-[#1d1d1f] text-white cursor-pointer"
                            title="保存名称"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded-lg bg-black/[0.06] text-[#3f3f46] cursor-pointer"
                            title="取消"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : confirmDeleteId === p.project_id ? (
                        <div className="flex items-center justify-between gap-2 py-0.5 px-2 rounded-lg bg-[#fff2f2] border border-[#ff3b30]/20">
                          <span className="text-[12.5px] font-medium text-[#c02620] truncate">
                            确认删除此文稿？
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => void handleDelete(p.project_id)}
                              className="px-2.5 py-0.5 rounded-full bg-[#d70015] text-white text-[12px] font-medium cursor-pointer"
                            >
                              删除
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-0.5 rounded-full text-[#3f3f46] hover:text-[#1d1d1f] text-[12px] cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/p/${p.project_id}`}
                            className="text-[15.5px] font-semibold text-[#1d1d1f] hover:opacity-70 transition-opacity truncate"
                          >
                            {p.name}
                          </Link>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                setEditingId(p.project_id);
                                setEditNameValue(p.name);
                              }}
                              className="text-[#52525b] hover:text-[#1d1d1f] p-1 rounded-full hover:bg-black/[0.06] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer"
                              title="重命名文稿"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setConfirmDeleteId(p.project_id);
                              }}
                              className="text-[#52525b] hover:text-[#d70015] p-1 rounded-full hover:bg-black/[0.06] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer"
                              title="删除文稿"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            {p.download_available && (
                              <a
                                href={`/api/projects/${p.project_id}/download`}
                                download
                                className="text-[#52525b] hover:text-[#1d1d1f] p-1 rounded-full hover:bg-black/[0.06] transition-colors"
                                title="下载 PPTX"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Single consolidated high-contrast metadata line */}
                      <div className="text-[13px] text-[#48484a] tabular-nums truncate">
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
                                ? "bg-[#1d1d1f]"
                                : "bg-black/[0.11]"
                            }`}
                          />
                        ))}
                      </div>
                      <span
                        className={`text-[12.5px] font-medium tabular-nums shrink-0 inline-flex items-center gap-1 ${
                          stageInfo.step === 4
                            ? "text-[#1d1d1f]"
                            : "text-[#48484a]"
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
            <section className="bg-white rounded-2xl border border-black/[0.08] p-10 text-center space-y-3">
              <div className="text-[14.5px] font-medium text-[#1d1d1f]">
                未找到包含「{search}」的文稿
              </div>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="px-4 py-1.5 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[13px] font-medium transition-colors cursor-pointer"
              >
                清除搜索
              </button>
            </section>
          )
        ) : loaded ? (
          /* Clean Monochrome Empty Library State */
          <section className="bg-white rounded-[20px] p-10 sm:p-14 border border-black/[0.08] shadow-[0_6px_24px_rgba(0,0,0,0.04)] max-w-xl mx-auto text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                创建你的第一份演示文稿
              </h2>
              <p className="text-[14px] text-[#48484a] leading-relaxed">
                命名一个项目，导入笔记或图片，生成可溯源大纲并导出 PPTX。
              </p>
            </div>

            <form
              onSubmit={handleCreate}
              className="space-y-3 text-left max-w-md mx-auto"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <input
                  placeholder="文稿名称（例如：2026 技术复盘）"
                  value={nameInput}
                  onChange={(e) => {
                    setNameInput(e.target.value);
                    if (!isCustomizingId) {
                      setCustomId(slugifyName(e.target.value));
                    }
                  }}
                  disabled={loading}
                  autoFocus
                  className="flex-1 h-11 rounded-full bg-[#f5f5f7] border border-black/[0.12] px-5 text-[15px] text-[#1d1d1f] placeholder-[#71717a] outline-none transition-[border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none hover:border-black/30 focus:bg-white focus:border-[#1d1d1f] focus:ring-4 focus:ring-black/[0.08] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={loading || !nameInput.trim()}
                  className="h-11 px-6 rounded-full bg-[#1d1d1f] hover:bg-[#323236] text-white text-[14px] font-medium transition-colors duration-200 shrink-0 cursor-pointer disabled:bg-[#e4e4e7] disabled:text-[#52525b] disabled:cursor-not-allowed"
                >
                  {loading ? "创建中…" : "开始创作"}
                </button>
              </div>
              {error && (
                <div className="text-[13px] text-[#d70015]">{error}</div>
              )}
            </form>
          </section>
        ) : null}
      </main>
    </div>
  );
}
