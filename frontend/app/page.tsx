"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, jsonOptions } from "../lib/api";
import { FolderPlus, FileText, ArrowRight, Sparkles } from "lucide-react";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<string[]>([]);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const data = await api<{ projects: { project_id: string }[] }>("/api/projects");
      setProjects(data.projects.map((p) => p.project_id));
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function create(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    const trimmed = newId.trim();
    if (!trimmed) {
      setError("请输入项目名称或 ID");
      return;
    }
    setLoading(true);
    try {
      await api("/api/projects", jsonOptions("POST", { project_id: trimmed }));
      setNewId("");
      router.push(`/p/${trimmed}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      {/* Hero Intro */}
      <div className="space-y-2 border-b border-stone-200/80 pb-6">
        <div className="flex items-center gap-2 text-xs font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full w-fit border border-emerald-200/60">
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 材料创作工作台</span>
        </div>
        <h1 className="text-2xl font-bold font-serif text-stone-900 tracking-tight">
          项目与演示文稿文档库
        </h1>
        <p className="text-sm text-stone-500 leading-relaxed max-w-2xl">
          将 Markdown 笔记、材料切片与图片无缝编译为结构严密、零虚构、且经过物理字形度量校验的专业 PowerPoint 演示文稿。
        </p>
      </div>

      {/* Quick Create Card */}
      <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-stone-700">
          <FolderPlus className="w-4 h-4 text-stone-500" />
          <span>新建演示文稿工作区</span>
        </div>
        <form onSubmit={create} className="flex gap-2">
          <input
            placeholder="项目 ID (例: 2026-strategy-review)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            disabled={loading}
            className="flex-1 text-sm bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-stone-400 focus:bg-white transition-all font-mono"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {loading ? "创建中..." : "创建工作区"}
          </button>
        </form>
        {error && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-lg">{error}</div>}
      </div>

      {/* Projects List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-stone-500 uppercase tracking-wider px-1">
          <span>现有项目 ({projects.length})</span>
          <span>工作台状态</span>
        </div>

        {projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {projects.map((id) => (
              <Link
                key={id}
                href={`/p/${id}`}
                className="group bg-white border border-stone-200/80 hover:border-stone-300 hover:shadow-xs p-4 rounded-2xl transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-stone-100 group-hover:bg-emerald-50 text-stone-600 group-hover:text-emerald-700 flex items-center justify-center transition-colors">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-stone-900 truncate group-hover:text-emerald-800 transition-colors">
                      {id}
                    </div>
                    <div className="text-[11px] text-stone-400 font-mono mt-0.5">
                      /p/{id}
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-stone-300 group-hover:text-stone-700 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </Link>
            ))}
          </div>
        ) : loaded ? (
          <div className="text-center py-12 bg-white border border-dashed border-stone-200 rounded-2xl p-6 text-stone-400 space-y-2">
            <FileText className="w-8 h-8 mx-auto text-stone-300" />
            <div className="text-sm font-medium text-stone-600">暂无项目</div>
            <p className="text-xs text-stone-400">在上方输入项目 ID 创建你的第一个材料演示文稿工作区。</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
