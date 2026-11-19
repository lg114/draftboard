"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, jsonOptions, Project } from "../lib/api";
import {
  FolderPlus,
  FileText,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Plus,
  X,
  Download,
  Layers,
  Search,
  ShieldCheck,
  FileCode,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";

export interface ProjectSummaryItem {
  project_id: string;
  name: string;
  stage: "ready" | "confirmed" | "outline_draft" | "materials_ready" | "empty";
  stage_label: string;
  slide_count: number;
  materials_count: number;
  insufficient_evidence_count: number;
  download_available: boolean;
  mtime: number;
}

function slugifyName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed.slice(0, 48);
  }
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  if (ascii.length >= 2) {
    return `${ascii.slice(0, 24)}-${randomSuffix}`;
  }
  const hash = Math.abs(
    trimmed.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) | 0, 0)
  ).toString(36);
  return `deck-${hash.slice(0, 4)}-${randomSuffix}`;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return "—";
  const now = Date.now();
  const timeMs = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const diffSec = Math.floor((now - timeMs) / 1000);
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const date = new Date(timeMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummaryItem[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [customId, setCustomId] = useState("");
  const [isCustomizingId, setIsCustomizingId] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Derived slug from name
  const derivedSlug = useMemo(() => {
    return slugifyName(nameInput);
  }, [nameInput]);

  const effectiveId = isCustomizingId ? customId.trim() : derivedSlug;

  async function load() {
    try {
      const data = await api<{ projects: Partial<ProjectSummaryItem>[] }>("/api/projects");
      const list: ProjectSummaryItem[] = (data.projects || []).map((p) => ({
        project_id: p.project_id || "",
        name: p.name || p.project_id || "",
        stage: p.stage || "empty",
        stage_label: p.stage_label || "待上传素材",
        slide_count: p.slide_count || 0,
        materials_count: p.materials_count || 0,
        insufficient_evidence_count: p.insufficient_evidence_count || 0,
        download_available: !!p.download_available,
        mtime: p.mtime || Date.now() / 1000,
      }));

      setProjects(list);

      // If backend didn't compute stage details (older backend instance), enrich asynchronously
      const needsEnrichment = list.filter((p) => p.stage === "empty" && !p.materials_count);
      if (needsEnrichment.length > 0) {
        Promise.all(
          needsEnrichment.map(async (item) => {
            try {
              const full = await api<Project>(`/api/projects/${item.project_id}`);
              const outlines = full.outlines || [];
              const latest = outlines[0];
              const matRes = await api<{ materials: unknown[] }>(
                `/api/projects/${item.project_id}/materials`
              ).catch(() => ({ materials: [] }));
              const matCount = matRes.materials?.length || 0;

              let stage: ProjectSummaryItem["stage"] = "empty";
              let stageLabel = "待上传素材";
              if (full.download_available) {
                stage = "ready";
                stageLabel = "PPT 已就绪";
              } else if (latest?.is_confirmed) {
                stage = "confirmed";
                stageLabel = "大纲已确认";
              } else if (outlines.length > 0) {
                stage = "outline_draft";
                stageLabel = "大纲待审核";
              } else if (matCount > 0) {
                stage = "materials_ready";
                stageLabel = "素材已导入";
              }

              return {
                ...item,
                name: full.name || item.name,
                stage,
                stage_label: stageLabel,
                slide_count: latest?.item_count || full.latest_report?.slide_count || 0,
                materials_count: matCount,
                download_available: full.download_available,
              };
            } catch {
              return item;
            }
          })
        ).then((enriched) => {
          setProjects((prev) =>
            prev.map((p) => enriched.find((e) => e.project_id === p.project_id) || p)
          );
        });
      }
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function handleCreate(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    const trimmedName = nameInput.trim();
    if (!trimmedName) {
      setError("请输入项目名称");
      return;
    }
    const finalId = effectiveId.trim();
    if (!finalId) {
      setError("无法生成有效的项目标识，请手动指定");
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(finalId)) {
      setError("项目标识只能包含字母、数字、下划线和连字符，且以字母或数字开头");
      return;
    }

    setLoading(true);
    try {
      await api(
        "/api/projects",
        jsonOptions("POST", { project_id: finalId, name: trimmedName })
      );
      // Persist human name locally for instant fast lookup
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`draftboard_proj_name_${finalId}`, trimmedName);
        } catch {}
      }
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

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.project_id.toLowerCase().includes(q)
    );
  }, [projects, search]);

  const totalMaterials = useMemo(
    () => projects.reduce((acc, p) => acc + (p.materials_count || 0), 0),
    [projects]
  );
  const totalSlides = useMemo(
    () => projects.reduce((acc, p) => acc + (p.slide_count || 0), 0),
    [projects]
  );

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Kite Hero Greeting & Action Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2">
        <div className="space-y-1">
          <div className="text-xs font-medium text-[#6b7280]">
            工坊概览 · 事实驱动的演示文稿工坊
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#111827] tracking-tight">
            项目概览
          </h1>
          <p className="text-xs sm:text-sm text-[#4b5563]">
            严格以原始素材为唯一论据，杜绝幻觉虚构，物理度量排版。
          </p>
        </div>

        {/* Top-Right Create Button */}
        {projects.length > 0 && (
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setError("");
            }}
            className="px-4 py-2 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 self-start md:self-auto"
          >
            {showCreate ? (
              <>
                <X className="w-3.5 h-3.5" />
                <span>收起</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>新建项目</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Kite-style Horizontal Metrics Capsule */}
      {projects.length > 0 && (
        <div className="bg-white border border-[#eaecf0] rounded-2xl px-5 py-3 shadow-bento flex flex-wrap items-center gap-3 sm:gap-6 text-xs text-[#4b5563]">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-[#4f46e5]" />
            <span className="font-semibold text-[#111827]">{projects.length}</span>
            <span>个项目</span>
          </div>
          <span className="text-[#eaecf0] hidden sm:inline">|</span>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#059669]" />
            <span className="font-semibold text-[#111827]">{totalMaterials}</span>
            <span>份原始素材</span>
          </div>
          <span className="text-[#eaecf0] hidden sm:inline">|</span>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#d97706]" />
            <span className="font-semibold text-[#111827]">{totalSlides}</span>
            <span>页幻灯片</span>
          </div>
          <span className="text-[#eaecf0] hidden sm:inline">|</span>
          <div className="flex items-center gap-2 text-[#059669]">
            <ShieldCheck className="w-4 h-4 text-[#059669]" />
            <span className="font-medium">100% 原始材料严密溯源</span>
          </div>
        </div>
      )}

      {/* Inline Create Drawer / Form (Kite Bento Style) */}
      {showCreate && (
        <section className="bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-4 transition-all animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-[#f3f4f6]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#111827]">
              <FolderPlus className="w-4 h-4 text-[#4f46e5]" />
              <span>创建新项目</span>
            </div>
            <button
              onClick={() => setShowCreate(false)}
              className="text-[#9ca3af] hover:text-[#111827] text-xs transition-colors cursor-pointer"
            >
              取消
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                placeholder="项目名称 (例: 2026 年度技术复盘 / 业务增长汇报)"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  if (!isCustomizingId) {
                    setCustomId(slugifyName(e.target.value));
                  }
                }}
                disabled={loading}
                autoFocus
                className="flex-1 text-sm bg-[#f9fafb] focus:bg-white border border-[#eaecf0] rounded-xl px-3.5 py-2.5 text-[#111827] placeholder-[#9ca3af] focus:outline-none focus:border-[#4f46e5] transition-all font-sans"
              />
              <button
                type="submit"
                disabled={loading || !nameInput.trim()}
                className="px-5 py-2.5 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {loading ? "创建中..." : "创建并进入"}
              </button>
            </div>

            {/* Auto-generated ID helper & optional customize */}
            {nameInput.trim() && (
              <div className="flex items-center justify-between text-xs text-[#6b7280] font-mono px-1">
                <div className="flex items-center gap-2">
                  <span>目录标识:</span>
                  {isCustomizingId ? (
                    <input
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      placeholder="自定义英文 ID"
                      className="bg-white border border-[#eaecf0] rounded-lg px-2 py-0.5 text-xs text-[#111827] focus:outline-none focus:border-[#4f46e5]"
                    />
                  ) : (
                    <span className="font-semibold text-[#374151] bg-[#f3f4f6] border border-[#eaecf0] px-2 py-0.5 rounded-md">
                      {effectiveId || "..."}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomizingId(!isCustomizingId)}
                  className="text-[#6b7280] hover:text-[#111827] underline text-[11px] cursor-pointer"
                >
                  {isCustomizingId ? "恢复自动生成" : "自定义标识"}
                </button>
              </div>
            )}

            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">
                {error}
              </div>
            )}
          </form>
        </section>
      )}

      {/* Projects List View */}
      {projects.length > 0 ? (
        <section className="space-y-4">
          {/* List Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111827]">
              <span>全部项目</span>
              <span className="text-xs font-mono text-[#4b5563] bg-[#f3f4f6] border border-[#eaecf0] px-2 py-0.5 rounded-lg">
                {projects.length}
              </span>
            </div>

            {/* Filter Search (Kite Style Pill) */}
            {projects.length > 3 && (
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#9ca3af]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索项目名称或 ID..."
                  className="w-full text-xs bg-white border border-[#eaecf0] rounded-xl pl-8 pr-3 py-1.5 text-[#111827] placeholder-[#9ca3af] focus:outline-none focus:border-[#d1d5db] shadow-2xs"
                />
              </div>
            )}
          </div>

          {/* Bento Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredProjects.map((p) => {
              const stageColors = {
                ready: "bg-[#ecfdf5] text-[#059669] border-[#a7f3d0]",
                confirmed: "bg-[#eef2ff] text-[#4f46e5] border-[#c7d2fe]",
                outline_draft: "bg-[#fef3c7] text-[#b45309] border-[#fde68a]",
                materials_ready: "bg-[#fdf2f8] text-[#db2777] border-[#fbcfe8]",
                empty: "bg-[#f3f4f6] text-[#6b7280] border-[#eaecf0]",
              }[p.stage];

              const stageDots = {
                ready: "bg-[#10b981]",
                confirmed: "bg-[#4f46e5]",
                outline_draft: "bg-[#f59e0b]",
                materials_ready: "bg-[#f43f5e]",
                empty: "bg-[#9ca3af]",
              }[p.stage];

              return (
                <div
                  key={p.project_id}
                  className="group bg-white border border-[#eaecf0] hover:border-[#d1d5db] rounded-2xl p-5 shadow-bento hover:shadow-bento-hover transition-all flex flex-col justify-between space-y-4"
                >
                  {/* Card Header: Title + Kite Pastel Stage Pill */}
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/p/${p.project_id}`}
                        className="font-bold text-base text-[#111827] group-hover:text-[#4f46e5] transition-colors line-clamp-1 tracking-tight"
                        title={p.name}
                      >
                        {p.name}
                      </Link>

                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full border shrink-0 shadow-2xs ${stageColors}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${stageDots}`} />
                        <span>{p.stage_label}</span>
                      </span>
                    </div>

                    {/* Secondary identifier when name differs from ID */}
                    {p.name !== p.project_id && (
                      <p className="text-[11px] font-mono text-[#9ca3af]">
                        {p.project_id}
                      </p>
                    )}
                  </div>

                  {/* Card Middle: Pipeline Metrics in Kite Bento Style */}
                  <div className="grid grid-cols-3 gap-2 py-2.5 px-3.5 bg-[#f9fafb] border border-[#eaecf0] rounded-xl text-xs">
                    <div>
                      <div className="text-[11px] text-[#6b7280] font-medium">
                        幻灯片
                      </div>
                      <div className="font-semibold text-[#111827] mt-0.5">
                        {p.slide_count > 0 ? `${p.slide_count} 页` : "未生成"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[#6b7280] font-medium">
                        材料溯源
                      </div>
                      <div className="mt-0.5">
                        {p.slide_count === 0 ? (
                          <span className="text-[#9ca3af]">—</span>
                        ) : p.insufficient_evidence_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b45309]">
                            <AlertTriangle className="w-3 h-3 text-[#f59e0b]" />
                            {p.insufficient_evidence_count} 处缺出处
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#059669]">
                            <ShieldCheck className="w-3 h-3 text-[#10b981]" />
                            依据严密
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-[#6b7280] font-medium">
                        素材池
                      </div>
                      <div className="font-semibold text-[#111827] mt-0.5">
                        {p.materials_count > 0 ? `${p.materials_count} 份` : "空"}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Timestamp & Quick Action */}
                  <div className="flex items-center justify-between text-xs pt-2 border-t border-[#f3f4f6] text-[#6b7280]">
                    <div className="flex items-center gap-1.5 font-sans text-xs text-[#9ca3af]">
                      <Clock className="w-3.5 h-3.5 text-[#9ca3af]" />
                      <span>{formatRelativeTime(p.mtime)}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {p.download_available && (
                        <a
                          href={`/api/projects/${p.project_id}/download`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] font-medium text-[#4b5563] hover:text-[#111827] flex items-center gap-1 transition-colors"
                          title="下载 PPTX 文件"
                        >
                          <Download className="w-3 h-3" />
                          <span>下载 PPT</span>
                        </a>
                      )}

                      <Link
                        href={`/p/${p.project_id}`}
                        className="font-semibold text-[#111827] hover:text-[#4f46e5] flex items-center gap-1 transition-colors"
                      >
                        <span>进入工作台</span>
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : loaded ? (
        /* Empty State: Focused Creation Prompt in Kite Bento Style */
        <section className="bg-white border border-[#eaecf0] rounded-3xl p-8 sm:p-12 text-center max-w-xl mx-auto space-y-6 shadow-bento">
          <div className="w-12 h-12 bg-[#f3f4f6] rounded-2xl flex items-center justify-center mx-auto text-[#111827] border border-[#eaecf0]">
            <Sparkles className="w-6 h-6 text-[#4f46e5]" />
          </div>

          <div className="space-y-2">
            <h2 className="text-lg font-bold text-[#111827] tracking-tight">
              创建你的第一个演示文稿项目
            </h2>
            <p className="text-xs sm:text-sm text-[#6b7280] leading-relaxed max-w-md mx-auto">
              输入项目名称，导入原始材料，AI 将为你提炼严密大纲并物理排版为 PowerPoint 文稿。
            </p>
          </div>

          <form onSubmit={handleCreate} className="space-y-3 pt-2 text-left max-w-md mx-auto">
            <div className="flex gap-2">
              <input
                placeholder="项目名称 (例: 2026 年度技术复盘)"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  if (!isCustomizingId) {
                    setCustomId(slugifyName(e.target.value));
                  }
                }}
                disabled={loading}
                autoFocus
                className="flex-1 text-sm bg-[#f9fafb] border border-[#eaecf0] rounded-xl px-3.5 py-2.5 text-[#111827] placeholder-[#9ca3af] focus:outline-none focus:border-[#4f46e5] focus:bg-white transition-all font-sans"
              />
              <button
                type="submit"
                disabled={loading || !nameInput.trim()}
                className="px-5 py-2.5 bg-[#111827] hover:bg-black text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {loading ? "创建中..." : "创建并开始"}
              </button>
            </div>

            {nameInput.trim() && (
              <div className="flex items-center justify-between text-xs text-[#6b7280] font-mono px-1">
                <span>生成目录: {effectiveId}</span>
                <button
                  type="button"
                  onClick={() => setIsCustomizingId(!isCustomizingId)}
                  className="text-[#6b7280] hover:text-[#111827] underline text-[11px] cursor-pointer"
                >
                  {isCustomizingId ? "自动生成" : "自定义 ID"}
                </button>
              </div>
            )}

            {isCustomizingId && (
              <input
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder="自定义英文 ID (例如: 2026-strategy)"
                className="w-full text-xs font-mono bg-[#f9fafb] border border-[#eaecf0] rounded-lg px-3 py-1.5 text-[#111827] focus:outline-none focus:border-[#4f46e5]"
              />
            )}

            {error && (
              <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">
                {error}
              </div>
            )}
          </form>
        </section>
      ) : null}

      {/* Pipeline Three-Step Guide (Kite Bento Cards) */}
      <section className="border-t border-[#eaecf0] pt-8 space-y-4">
        <div className="flex items-center justify-between text-xs font-semibold text-[#111827] uppercase tracking-wider px-1">
          <span>制作流水线概览</span>
          <span className="text-[#6b7280] font-normal font-sans normal-case">
            严密事实核验 · 物理排版安全
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f3f4f6] border border-[#eaecf0] flex items-center justify-center text-[#111827] text-xs font-bold font-mono">
              01
            </div>
            <h3 className="font-semibold text-sm text-[#111827]">投入原始素材</h3>
            <p className="text-xs text-[#6b7280] leading-relaxed">
              上传 Markdown 笔记、报告段落与图片。系统自动解析切片并建立事实索引与引用锚点。
            </p>
          </div>

          <div className="bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f3f4f6] border border-[#eaecf0] flex items-center justify-center text-[#111827] text-xs font-bold font-mono">
              02
            </div>
            <h3 className="font-semibold text-sm text-[#111827]">大纲梳理与溯源</h3>
            <p className="text-xs text-[#6b7280] leading-relaxed">
              AI 结构化提炼逐页要点，每页严格绑定原始材料来源。依据不足即时标黄预警，杜绝虚构。
            </p>
          </div>

          <div className="bg-white border border-[#eaecf0] rounded-2xl p-5 shadow-bento space-y-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#f3f4f6] border border-[#eaecf0] flex items-center justify-center text-[#111827] text-xs font-bold font-mono">
              03
            </div>
            <h3 className="font-semibold text-sm text-[#111827]">物理度量与排版导出</h3>
            <p className="text-xs text-[#6b7280] leading-relaxed">
              通过字形物理度量引擎校验字符边界（杜绝文字重叠和溢出），一键编译为标准 16:9 PPTX。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
