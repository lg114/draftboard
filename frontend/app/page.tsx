"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, X } from "lucide-react";
import { api, jsonOptions, Project } from "../lib/api";
import { BackendStatus } from "../components/BackendStatus";

interface ProjectSummaryItem {
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

const COVER_STYLES = [
  {
    bg: "#F5F5F7",
    title: "#1D1D1F",
    sub: "#6E6E73",
    accent: "#0071E3",
    tag: "PRESENTATION",
  },
  {
    bg: "#0F2922",
    title: "#F4F7F5",
    sub: "#9FB8AF",
    accent: "#2E7D63",
    tag: "DECK STUDIO",
  },
  {
    bg: "#111113",
    title: "#FFFFFF",
    sub: "#A1A1A6",
    accent: "#2997FF",
    tag: "KEYNOTE",
  },
  {
    bg: "#23221F",
    title: "#F4F1EA",
    sub: "#B8B2A6",
    accent: "#B4533C",
    tag: "EDITORIAL",
  },
];

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

  const derivedSlug = useMemo(() => slugifyName(nameInput), [nameInput]);
  const effectiveId = isCustomizingId ? customId.trim() : derivedSlug;

  async function load() {
    try {
      const data = await api<{ projects: Partial<ProjectSummaryItem>[] }>(
        "/api/projects"
      );
      const list: ProjectSummaryItem[] = (data.projects || [])
        .map((p) => ({
          project_id: p.project_id || "",
          name: p.name || p.project_id || "",
          stage: p.stage || "empty",
          stage_label: p.stage_label || "待上传素材",
          slide_count: p.slide_count || 0,
          materials_count: p.materials_count || 0,
          insufficient_evidence_count: p.insufficient_evidence_count || 0,
          download_available: !!p.download_available,
          mtime: p.mtime || Date.now() / 1000,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      setProjects(list);

      const needsEnrichment = list.filter(
        (p) => p.stage === "empty" && !p.materials_count
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

  const filteredProjects = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.project_id.toLowerCase().includes(q)
    );
  }, [projects, search]);

  return (
    <div className="min-h-screen flex flex-col bg-[#f5f5f7] text-[#1d1d1f]">
      {/* Apple Translucent Header */}
      <header className="h-[52px] apple-glass border-b border-black/[0.07] px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="w-7 h-7 rounded-[8px] bg-[#1d1d1f] text-white flex items-center justify-center font-semibold text-[13px]"
          >
            D
          </Link>
          <span className="font-semibold text-[15px] tracking-[-0.015em] text-[#1d1d1f]">
            Draftboard
          </span>
        </div>

        <div className="flex items-center gap-4">
          <BackendStatus />
          {projects.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowCreate((v) => !v);
                setError("");
              }}
              className="px-4 py-1.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,113,227,0.22)]"
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

      <main className="flex-1 max-w-[1120px] w-full mx-auto px-6 sm:px-8 py-12 space-y-10">
        {/* Clean Hero Heading */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-[#1d1d1f]">
              文稿
            </h1>
            <p className="text-[15px] text-[#6e6e73]">
              以原始材料为唯一依据，编译清晰、原生可编辑的演示文稿。
            </p>
          </div>

          {projects.length > 3 && (
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3.5 top-2.5 text-[#86868b]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索文稿…"
                className="w-full text-[13.5px] bg-white border border-black/[0.08] rounded-full pl-9 pr-4 py-1.5 text-[#1d1d1f] placeholder-[#86868b] focus:outline-none focus:border-[#0071e3] transition-colors"
              />
            </div>
          )}
        </div>

        {/* Inline Creation Sheet */}
        {showCreate && (
          <section className="bg-white rounded-2xl p-6 slide-shadow max-w-2xl space-y-4">
            <div className="text-[15px] font-semibold text-[#1d1d1f]">
              新建演示文稿
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
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
                  className="flex-1 text-[15px] bg-[#f5f5f7] focus:bg-white border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 rounded-xl px-4 py-2.5 text-[#1d1d1f] placeholder-[#86868b] outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={loading || !nameInput.trim()}
                  className="px-5 py-2.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] font-medium transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
                >
                  {loading ? "创建中…" : "创建并打开"}
                </button>
              </div>

              {nameInput.trim() && (
                <div className="flex items-center justify-between text-[12px] text-[#86868b] px-1">
                  <div className="flex items-center gap-2 font-mono">
                    <span>标识:</span>
                    {isCustomizingId ? (
                      <input
                        value={customId}
                        onChange={(e) => setCustomId(e.target.value)}
                        className="bg-[#f5f5f7] border border-black/10 rounded-lg px-2 py-0.5 text-[12px] text-[#1d1d1f] outline-none focus:border-[#0071e3]"
                      />
                    ) : (
                      <span className="text-[#424245]">{effectiveId}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCustomizingId((v) => !v)}
                    className="text-[#0071e3] hover:underline cursor-pointer"
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
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredProjects.map((p, idx) => {
              const cover = COVER_STYLES[idx % COVER_STYLES.length];
              const stageColor =
                p.stage === "ready"
                  ? "text-[#248a3d]"
                  : p.stage === "confirmed"
                  ? "text-[#0071e3]"
                  : p.stage === "outline_draft"
                  ? "text-[#b25000]"
                  : "text-[#6e6e73]";

              return (
                <div key={p.project_id} className="group space-y-3">
                  <Link
                    href={`/p/${p.project_id}`}
                    className="block aspect-[16/9] rounded-[14px] overflow-hidden slide-shadow group-hover:-translate-y-1 transition-all duration-200 p-6 flex flex-col justify-between relative"
                    style={{ backgroundColor: cover.bg }}
                  >
                    <div
                      className="text-[10px] font-semibold tracking-[0.12em]"
                      style={{ color: cover.accent }}
                    >
                      {cover.tag}
                    </div>
                    <div className="space-y-1">
                      <div
                        className="text-[18px] font-bold tracking-tight line-clamp-2 leading-snug"
                        style={{ color: cover.title }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="text-[12px] font-mono opacity-80"
                        style={{ color: cover.sub }}
                      >
                        {p.materials_count > 0
                          ? `${p.materials_count} 份素材`
                          : "尚未导入素材"}
                        {p.insufficient_evidence_count > 0
                          ? ` · ${p.insufficient_evidence_count} 处待补充`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className="w-6 h-[2.5px] rounded-full"
                        style={{ backgroundColor: cover.accent }}
                      />
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: cover.sub }}
                      >
                        {p.slide_count > 0 ? `${p.slide_count} 页` : "空白"}
                      </span>
                    </div>
                  </Link>

                  <div className="px-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/p/${p.project_id}`}
                        className="text-[15.5px] font-semibold text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors truncate"
                      >
                        {p.name}
                      </Link>
                      {p.download_available && (
                        <a
                          href={`/api/projects/${p.project_id}/download`}
                          download
                          className="text-[#86868b] hover:text-[#1d1d1f] p-1 rounded-full hover:bg-black/[0.05] transition-colors shrink-0"
                          title="下载 PPTX"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[13px] text-[#6e6e73]">
                      <span>
                        {p.slide_count > 0 ? `${p.slide_count} 页 · ` : ""}
                        {formatRelativeTime(p.mtime)}
                      </span>
                      <span className={`font-medium ${stageColor}`}>
                        {p.stage_label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        ) : loaded ? (
          /* Clean Empty Library State */
          <section className="bg-white rounded-[20px] p-10 sm:p-14 slide-shadow max-w-xl mx-auto text-center space-y-6">
            <div className="space-y-2">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f]">
                创建你的第一份演示文稿
              </h2>
              <p className="text-[14.5px] text-[#6e6e73] leading-relaxed">
                命名一个项目，拖入笔记或图片，Draftboard 将为你提炼可溯源大纲并导出原生 PPTX。
              </p>
            </div>

            <form
              onSubmit={handleCreate}
              className="space-y-3 text-left max-w-md mx-auto"
            >
              <div className="flex flex-col sm:flex-row gap-2.5">
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
                  className="flex-1 text-[15px] bg-[#f5f5f7] focus:bg-white border border-transparent focus:border-[#0071e3] focus:ring-4 focus:ring-[#0071e3]/10 rounded-xl px-4 py-2.5 text-[#1d1d1f] placeholder-[#86868b] outline-none transition-all"
                />
                <button
                  type="submit"
                  disabled={loading || !nameInput.trim()}
                  className="px-5 py-2.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[14px] font-medium transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
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
