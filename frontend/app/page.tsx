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

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
      {/* Hero Section */}
      <div className="flex items-start justify-between gap-4 border-b border-stone-200 pb-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold font-serif text-stone-900 tracking-tight">
            项目
          </h1>
          <p className="text-sm text-stone-600 font-sans">
            把素材整理成有出处的演示文稿
          </p>
        </div>

        {/* Top-Right Create Button */}
        {projects.length > 0 && (
          <button
            onClick={() => {
              setShowCreate(!showCreate);
              setError("");
            }}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 mt-1"
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

      {/* Inline Create Drawer / Form (When Toggled) */}
      {showCreate && (
        <section className="bg-stone-50 border border-stone-300 rounded-2xl p-5 shadow-xs space-y-3.5 transition-all animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
              <FolderPlus className="w-4 h-4 text-stone-600" />
              <span>创建新项目</span>
            </div>
            <button
              onClick={() => setShowCreate(false)}
              className="text-stone-400 hover:text-stone-700 text-xs transition-colors"
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
                className="flex-1 text-sm bg-white border border-stone-300 rounded-xl px-3.5 py-2 text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-500 transition-all font-sans"
              />
              <button
                type="submit"
                disabled={loading || !nameInput.trim()}
                className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {loading ? "创建中..." : "创建并进入"}
              </button>
            </div>

            {/* Auto-generated ID helper & optional customize */}
            {nameInput.trim() && (
              <div className="flex items-center justify-between text-xs text-stone-500 font-mono px-1">
                <div className="flex items-center gap-2">
                  <span>目录标识:</span>
                  {isCustomizingId ? (
                    <input
                      value={customId}
                      onChange={(e) => setCustomId(e.target.value)}
                      placeholder="自定义英文 ID"
                      className="bg-white border border-stone-300 rounded px-2 py-0.5 text-xs text-stone-800 focus:outline-none focus:border-stone-500"
                    />
                  ) : (
                    <span className="font-semibold text-stone-700 bg-stone-200/60 px-1.5 py-0.5 rounded">
                      {effectiveId || "..."}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomizingId(!isCustomizingId)}
                  className="text-stone-500 hover:text-stone-800 underline text-[11px]"
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
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <span>全部项目</span>
              <span className="text-xs font-mono text-stone-500 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded-full">
                {projects.length}
              </span>
            </div>

            {/* Filter Search */}
            {projects.length > 3 && (
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-stone-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索项目名称或 ID..."
                  className="w-full text-xs bg-white border border-stone-200 rounded-xl pl-8 pr-3 py-1.5 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-stone-400"
                />
              </div>
            )}
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredProjects.map((p) => {
              const stageColors = {
                ready: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
                confirmed: "bg-blue-50 text-blue-800 border-blue-200/80",
                outline_draft: "bg-amber-50 text-amber-800 border-amber-200/80",
                materials_ready: "bg-violet-50 text-violet-800 border-violet-200/80",
                empty: "bg-stone-100 text-stone-600 border-stone-200/80",
              }[p.stage];

              const stageIcons = {
                ready: <CheckCircle2 className="w-3 h-3 text-emerald-600" />,
                confirmed: <Layers className="w-3 h-3 text-blue-600" />,
                outline_draft: <FileText className="w-3 h-3 text-amber-600" />,
                materials_ready: <FileCode className="w-3 h-3 text-violet-600" />,
                empty: <Plus className="w-3 h-3 text-stone-400" />,
              }[p.stage];

              return (
                <div
                  key={p.project_id}
                  className="group bg-white border border-stone-200/90 hover:border-stone-400/80 hover:shadow-xs p-5 rounded-2xl transition-all flex flex-col justify-between space-y-4"
                >
                  {/* Card Header: Title + Pipeline Stage Badge */}
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/p/${p.project_id}`}
                        className="font-bold text-base text-stone-900 group-hover:text-stone-700 transition-colors line-clamp-1"
                        title={p.name}
                      >
                        {p.name}
                      </Link>

                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${stageColors}`}
                      >
                        {stageIcons}
                        <span>{p.stage_label}</span>
                      </span>
                    </div>

                    {/* Secondary identifier when name differs from ID */}
                    {p.name !== p.project_id && (
                      <p className="text-[11px] font-mono text-stone-400">
                        {p.project_id}
                      </p>
                    )}
                  </div>

                  {/* Card Middle: Pipeline Metrics */}
                  <div className="grid grid-cols-3 gap-2 py-2.5 px-3.5 bg-stone-50 border border-stone-200/60 rounded-xl text-xs">
                    <div>
                      <div className="text-[11px] text-stone-500 font-medium">
                        幻灯片
                      </div>
                      <div className="font-semibold text-stone-900 mt-0.5">
                        {p.slide_count > 0 ? `${p.slide_count} 页` : "未生成"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-stone-500 font-medium">
                        材料溯源
                      </div>
                      <div className="mt-0.5">
                        {p.slide_count === 0 ? (
                          <span className="text-stone-400">—</span>
                        ) : p.insufficient_evidence_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                            <AlertTriangle className="w-3 h-3" />
                            {p.insufficient_evidence_count} 处缺出处
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <ShieldCheck className="w-3 h-3" />
                            依据严密
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-stone-500 font-medium">
                        素材池
                      </div>
                      <div className="font-semibold text-stone-900 mt-0.5">
                        {p.materials_count > 0 ? `${p.materials_count} 份` : "空"}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Timestamp & Quick Action */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-stone-100 text-stone-500">
                    <div className="flex items-center gap-1 font-sans text-xs text-stone-500">
                      <Clock className="w-3.5 h-3.5 text-stone-400" />
                      <span>{formatRelativeTime(p.mtime)}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      {p.download_available && (
                        <a
                          href={`/api/projects/${p.project_id}/download`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] font-medium text-stone-600 hover:text-stone-900 flex items-center gap-1 transition-colors"
                          title="下载 PPTX 文件"
                        >
                          <Download className="w-3 h-3" />
                          <span>下载 PPT</span>
                        </a>
                      )}

                      <Link
                        href={`/p/${p.project_id}`}
                        className="font-medium text-stone-900 hover:text-stone-600 flex items-center gap-1 transition-colors"
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
        /* Empty State: Focused Creation Prompt */
        <section className="bg-white border border-stone-200 rounded-3xl p-8 sm:p-12 text-center max-w-xl mx-auto space-y-6 shadow-xs">
          <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center mx-auto text-stone-700">
            <Sparkles className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold font-serif text-stone-900">
              创建你的第一个演示文稿项目
            </h2>
            <p className="text-sm text-stone-500 leading-relaxed max-w-md mx-auto">
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
                className="flex-1 text-sm bg-stone-50 border border-stone-300 rounded-xl px-3.5 py-2.5 text-stone-900 placeholder-stone-400 focus:outline-none focus:border-stone-500 focus:bg-white transition-all font-sans"
              />
              <button
                type="submit"
                disabled={loading || !nameInput.trim()}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {loading ? "创建中..." : "创建并开始"}
              </button>
            </div>

            {nameInput.trim() && (
              <div className="flex items-center justify-between text-xs text-stone-500 font-mono px-1">
                <span>生成目录: {effectiveId}</span>
                <button
                  type="button"
                  onClick={() => setIsCustomizingId(!isCustomizingId)}
                  className="text-stone-500 hover:text-stone-800 underline text-[11px]"
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
                className="w-full text-xs font-mono bg-stone-50 border border-stone-300 rounded-lg px-3 py-1.5 text-stone-800 focus:outline-none focus:border-stone-500"
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

      {/* Pipeline Three-Step Guide (Solves Lower-Half Empty Feel & Guides the User) */}
      <section className="border-t border-stone-200/80 pt-8 space-y-4">
        <div className="flex items-center justify-between text-xs font-semibold text-stone-700 uppercase tracking-wider px-1">
          <span>制作流水线概览</span>
          <span className="text-stone-400 font-normal font-sans normal-case">
            严密事实核验 · 物理排版安全
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="bg-white border border-stone-200/80 rounded-2xl p-4.5 space-y-2">
            <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-700 text-xs font-bold font-mono">
              01
            </div>
            <h3 className="font-semibold text-sm text-stone-900">投入原始素材</h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              上传 Markdown 笔记、报告段落与图片。系统自动解析切片并建立事实索引与引用锚点。
            </p>
          </div>

          <div className="bg-white border border-stone-200/80 rounded-2xl p-4.5 space-y-2">
            <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-700 text-xs font-bold font-mono">
              02
            </div>
            <h3 className="font-semibold text-sm text-stone-900">大纲梳理与溯源</h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              AI 结构化提炼逐页要点，每页严格绑定原始材料来源。依据不足即时标黄预警，杜绝虚构。
            </p>
          </div>

          <div className="bg-white border border-stone-200/80 rounded-2xl p-4.5 space-y-2">
            <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-700 text-xs font-bold font-mono">
              03
            </div>
            <h3 className="font-semibold text-sm text-stone-900">物理度量与排版导出</h3>
            <p className="text-xs text-stone-500 leading-relaxed">
              通过字形物理度量引擎校验字符边界（杜绝文字重叠和溢出），一键编译为标准 16:9 PPTX。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
