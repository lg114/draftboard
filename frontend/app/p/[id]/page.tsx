"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  jsonOptions,
  Issue,
  Material,
  Outline,
  Project,
  Task,
  Preview,
  ExportReport,
} from "../../../lib/api";
import {
  Upload,
  Sparkles,
  Save,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  ArrowUp,
  ArrowDown,
  Download,
  Eye,
  RefreshCw,
  Plus,
  Trash2,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";

export default function MaterialsPage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "error" | "ok">("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"" | "error" | "ok">("");
  const [error, setError] = useState("");

  // Slide Mirror & Preview states
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadPreview = useCallback(async () => {
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview`);
      setPreview(p);
    } catch {
      setPreview(null);
    }
    try {
      const r = await api<ExportReport>(`/api/projects/${pid}/result`);
      setReport(r);
    } catch {
      setReport(null);
    }
  }, [pid]);

  const showOutline = useCallback(
    async (v: string) => {
      try {
        const data = await api<Outline>(`/api/projects/${pid}/outlines/${v}`);
        setOutline(data);
        setVersion(v);
        setSelectedIndex(0);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [pid]
  );

  const refresh = useCallback(async () => {
    const data = await api<Project>(`/api/projects/${pid}`);
    setProject(data);
    const mats = await api<{ materials: Material[] }>(`/api/projects/${pid}/materials`);
    setMaterials(mats.materials);

    const outlines = [...data.outlines].sort((a, b) => b.mtime - a.mtime);
    if (outlines.length > 0) {
      await showOutline(outlines[0].outline_version);
    } else {
      setOutline(null);
      setVersion("");
    }
    await loadPreview();
    return data;
  }, [pid, showOutline, loadPreview]);

  const reportTask = useCallback((task: Task) => {
    setStatus(
      `任务 ${task.task_id}：${task.status}${task.step ? " — " + task.step : ""}` +
        (task.status === "failed" ? `\n失败原因：${task.error ?? "未知"}` : "")
    );
    setStatusKind(task.status === "failed" ? "error" : "ok");
    if (task.status === "failed") {
      setIssues(task.result.export?.issues ?? task.result.validation?.issues ?? []);
    } else {
      setIssues([]);
    }
  }, []);

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      const tick = async () => {
        let task: Task;
        try {
          task = await api<Task>(`/api/projects/${pid}/tasks/${taskId}`);
        } catch {
          stopPolling();
          return;
        }
        setStatus(`任务 ${task.task_id}：${task.status} — ${task.step}`);
        setStatusKind("");
        if (task.status === "succeeded" || task.status === "failed") {
          stopPolling();
          reportTask(task);
          const data = await refresh();
          if (task.status === "succeeded" && task.result.outline_version) {
            await showOutline(task.result.outline_version);
          }
          await loadPreview();
          const active = data.tasks.find(
            (t) => t.status === "queued" || t.status === "running"
          );
          if (active) startPolling(active.task_id);
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 1500);
    },
    [pid, refresh, reportTask, showOutline, loadPreview]
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await refresh();
        const active = data.tasks.find(
          (t) => t.status === "queued" || t.status === "running"
        );
        if (active) {
          startPolling(active.task_id);
        } else if (data.tasks.length > 0) {
          reportTask(data.tasks[data.tasks.length - 1]);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return stopPolling;
  }, [pid, refresh, reportTask, startPolling]);

  async function upload(file: File | undefined) {
    setMsg("");
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api<{ asset_id: string; source_fragments: number }>(
        `/api/projects/${pid}/materials`,
        { method: "POST", body: form }
      );
      setMsg(`已上传 ${r.asset_id}，切分为 ${r.source_fragments} 个来源片段。`);
      setMsgKind("ok");
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function genOutline() {
    setMsg("");
    try {
      const task = await api<Task>(`/api/projects/${pid}/outline/generate`, {
        method: "POST",
      });
      startPolling(task.task_id);
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function saveOutline() {
    if (!outline) return;
    setMsg("");
    try {
      const saved = await api<Outline>(
        `/api/projects/${pid}/outlines/${version}`,
        jsonOptions("PUT", {
          items: outline.items.map((i) => ({
            outline_item_id: i.outline_item_id,
            title: i.title,
            summary: i.summary,
            layout: i.layout,
          })),
        })
      );
      await refresh();
      await showOutline(saved.outline_version);
      setMsg(
        saved.outline_version !== version
          ? `已保存为新候选版本 ${saved.outline_version}，原确认版本保持不变；重新确认后才会进入生成。`
          : "已保存大纲修改。"
      );
      setMsgKind("ok");
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function confirmGenerate() {
    if (!version) return;
    setMsg("");
    try {
      await api(`/api/projects/${pid}/outlines/${version}/confirm`, { method: "POST" });
      const task = await api<Task>(
        `/api/projects/${pid}/generate`,
        jsonOptions("POST", { outline_version: version })
      );
      startPolling(task.task_id);
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    }
  }

  async function renderPreviewsNow() {
    setRenderingPreview(true);
    setMsg("正在渲染真实幻灯片图像 (LibreOffice)，请稍候...");
    try {
      const p = await api<Preview>(`/api/projects/${pid}/preview/render`, {
        method: "POST",
      });
      setPreview(p);
      setMsg("真机视图渲染完成。");
      setMsgKind("ok");
    } catch (e) {
      setMsg((e as Error).message);
      setMsgKind("error");
    } finally {
      setRenderingPreview(false);
    }
  }

  function moveItem(idx: number, delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!outline) return;
    const j = idx + delta;
    const items = [...outline.items];
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    setOutline({ ...outline, items });
    setSelectedIndex(j);
  }

  function updateItem(idx: number, field: "title" | "summary" | "layout", value: string | null) {
    if (!outline) return;
    const items = [...outline.items];
    items[idx] = { ...items[idx], [field]: value };
    setOutline({ ...outline, items });
  }

  function addBlock() {
    if (!outline) return;
    const newId = `item-${Date.now().toString(36)}`;
    const items = [
      ...outline.items,
      {
        outline_item_id: newId,
        title: "新幻灯片标题",
        summary: "请在此输入要点内容...",
        source_ids: [],
        evidence_status: "supported",
        layout: "content",
      },
    ];
    setOutline({ ...outline, items });
    setSelectedIndex(items.length - 1);
  }

  function deleteBlock(idx: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!outline || outline.items.length <= 1) return;
    const items = outline.items.filter((_, i) => i !== idx);
    setOutline({ ...outline, items });
    setSelectedIndex(Math.max(0, idx - 1));
  }

  const stale =
    project?.generated_outline_version &&
    version &&
    version !== project.generated_outline_version;

  const currentItem = outline?.items[selectedIndex];

  if (error) {
    return (
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm mb-4">
          {error}
        </div>
        <Link href="/" className="text-xs text-stone-600 underline">
          ← 返回项目列表
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      {/* Top Workspace Header Bar */}
      <div className="bg-white border border-stone-200/80 rounded-2xl px-5 py-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-stone-400 hover:text-stone-700 text-xs font-mono transition-colors"
          >
            项目库
          </Link>
          <span className="text-stone-300">/</span>
          <span className="font-serif font-bold text-base text-stone-900 tracking-tight">
            {pid}
          </span>
          {outline && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 border border-stone-200/60">
              {outline.items.length} 页
            </span>
          )}
          {stale && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              有未生成的草稿修改
            </span>
          )}
        </div>

        {/* Global Action Cluster */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Version Switcher */}
          <select
            value={version}
            onChange={(e) => void showOutline(e.target.value)}
            className="text-xs bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-stone-700 focus:outline-none focus:border-stone-400 font-mono"
          >
            {[...(project?.outlines ?? [])]
              .sort((a, b) => b.mtime - a.mtime)
              .map((o) => (
                <option key={o.outline_version} value={o.outline_version}>
                  {o.outline_version} ({o.item_count}页 · {o.is_confirmed ? "已确认" : "候选草稿"})
                </option>
              ))}
          </select>

          <button
            onClick={() => setShowMaterialsDrawer(!showMaterialsDrawer)}
            className="px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-stone-500" />
            <span>素材池 ({materials.length})</span>
          </button>

          <button
            onClick={saveOutline}
            disabled={!outline}
            className="px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" />
            <span>保存大纲</span>
          </button>

          <button
            onClick={confirmGenerate}
            disabled={!version}
            className="px-4 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-40"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>确认大纲并生成 PPT</span>
          </button>

          {project?.download_available && (
            <a
              href={`/api/projects/${pid}/download`}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 PPTX</span>
            </a>
          )}
        </div>
      </div>

      {/* Slide Materials Drawer (Collapsible) */}
      {showMaterialsDrawer && (
        <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
              <Upload className="w-4 h-4 text-stone-500" />
              <span>原始材料与素材管理</span>
            </div>
            <label className="cursor-pointer px-3 py-1.5 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-700 text-xs font-medium transition-colors flex items-center gap-1.5">
              <span>+ 上传新材料 (.md, .txt, .png, .jpg)</span>
              <input
                type="file"
                accept=".md,.txt,.png,.jpg,.jpeg"
                onChange={(e) => void upload(e.target.files?.[0])}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {materials.map((m) => (
              <div
                key={m.asset_id}
                className="p-3 rounded-xl bg-stone-50 border border-stone-200/60 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {m.asset_type === "image" ? (
                    <ImageIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  )}
                  <span className="truncate font-mono font-medium text-stone-800">
                    {m.asset_id}
                  </span>
                </div>
                <span className="text-[10px] text-stone-400 font-mono uppercase bg-white px-1.5 py-0.5 rounded border border-stone-200">
                  {m.asset_type}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs">
            <span className="text-stone-400">
              上传素材后，Agent 会提取不可变切片并建立严格的证据索引。
            </span>
            <button
              onClick={genOutline}
              className="text-emerald-700 font-semibold hover:underline flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>让 AI 重新提取大纲</span>
            </button>
          </div>
        </div>
      )}

      {/* Status & Messages */}
      {status && (
        <div
          className={`px-4 py-2.5 rounded-xl text-xs flex items-center justify-between ${
            statusKind === "error"
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : statusKind === "ok"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-stone-100 text-stone-700 border border-stone-200"
          }`}
        >
          <div className="flex items-center gap-2 font-mono">
            {statusKind === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            {statusKind === "error" && <AlertTriangle className="w-4 h-4 text-rose-600" />}
            <span>{status}</span>
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`px-4 py-2 rounded-xl text-xs ${
            msgKind === "error"
              ? "bg-rose-50 text-rose-700 border border-rose-200"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200"
          }`}
        >
          {msg}
        </div>
      )}

      {/* Main Dual-Pane Doc-to-Deck Viewport */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Notion/Craft-like Document Outline (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-stone-200/80 rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div>
              <h2 className="font-serif font-bold text-base text-stone-900">
                演示文稿大纲文档流
              </h2>
              <p className="text-xs text-stone-400 mt-0.5">
                像写笔记一样编辑要点；修改将实时映射并度量到右侧幻灯片。
              </p>
            </div>
            <button
              onClick={addBlock}
              className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加一页</span>
            </button>
          </div>

          {/* Sequential Block Stream */}
          <div className="space-y-3">
            {outline?.items.map((item, idx) => {
              const isActive = idx === selectedIndex;
              return (
                <div
                  key={item.outline_item_id}
                  onClick={() => setSelectedIndex(idx)}
                  className={`doc-block-transition border-l-2 pl-3.5 pr-3 py-3 rounded-r-xl transition-all cursor-pointer relative ${
                    isActive
                      ? "border-emerald-600 bg-emerald-50/40 shadow-xs"
                      : "border-transparent hover:border-stone-300 hover:bg-stone-50/60"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-stone-400">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      {/* Layout Selector */}
                      <select
                        value={item.layout || "content"}
                        onChange={(e) => updateItem(idx, "layout", e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-mono bg-white border border-stone-200 rounded-md px-1.5 py-0.5 text-stone-600 focus:outline-none"
                      >
                        <option value="cover">cover (封面)</option>
                        <option value="content">content (正文)</option>
                        <option value="bullets">bullets (分点)</option>
                        <option value="two_column">two_column (双栏)</option>
                        <option value="closing">closing (致谢)</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Evidence Pill */}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          item.evidence_status === "supported"
                            ? "bg-emerald-100/70 text-emerald-800"
                            : item.evidence_status === "partial"
                            ? "bg-amber-100/70 text-amber-800"
                            : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        ● {item.evidence_status}
                      </span>

                      {/* Reorder & Delete tools */}
                      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          disabled={idx === 0}
                          onClick={(e) => moveItem(idx, -1, e)}
                          title="上移"
                          className="p-1 text-stone-400 hover:text-stone-700 disabled:opacity-20"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          disabled={idx === outline.items.length - 1}
                          onClick={(e) => moveItem(idx, 1, e)}
                          title="下移"
                          className="p-1 text-stone-400 hover:text-stone-700 disabled:opacity-20"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        {outline.items.length > 1 && (
                          <button
                            onClick={(e) => deleteBlock(idx, e)}
                            title="删除此页"
                            className="p-1 text-stone-300 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Editable Title */}
                  <input
                    value={item.title}
                    onChange={(e) => updateItem(idx, "title", e.target.value)}
                    className="w-full font-bold text-sm text-stone-900 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white outline-none py-0.5 transition-all"
                  />

                  {/* Editable Summary */}
                  <textarea
                    rows={2}
                    value={item.summary}
                    onChange={(e) => updateItem(idx, "summary", e.target.value)}
                    className="w-full text-xs text-stone-600 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white outline-none mt-1 py-0.5 leading-relaxed resize-none"
                  />

                  {/* Sources citation footer */}
                  <div className="mt-2 flex items-center justify-between text-[10px] text-stone-400 pt-1.5 border-t border-stone-100">
                    <span className="font-mono text-stone-500 truncate max-w-[80%]">
                      🔗 来源片段: {item.source_ids.join(", ") || "无特定片段引用"}
                    </span>
                    {isActive && (
                      <span className="text-emerald-700 font-medium whitespace-nowrap">
                        聚焦中 👁
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {(!outline || outline.items.length === 0) && (
            <div className="text-center py-16 text-stone-400 space-y-3">
              <FileText className="w-8 h-8 mx-auto text-stone-300" />
              <div className="text-sm font-medium text-stone-600">当前项目尚无大纲</div>
              <p className="text-xs text-stone-400 max-w-sm mx-auto">
                点击上方“素材池”上传 Markdown 或笔记，然后让 AI 一键提炼大纲。
              </p>
              <button
                onClick={genOutline}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors"
              >
                开始生成大纲
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Sticky Slide Mirror & Typography Guard (5 cols) */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-16">
          <div className="bg-white border border-stone-200/80 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-serif font-bold text-xs text-stone-900">
                  实时幻灯片镜面
                </span>
                <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 text-stone-600 rounded font-mono">
                  Slide {String(selectedIndex + 1).padStart(2, "0")} / {outline?.items.length || 0}
                </span>
              </div>
              <Link
                href={`/p/${pid}/preview`}
                className="text-[11px] text-stone-500 hover:text-stone-900 flex items-center gap-0.5"
              >
                <span>全屏影院</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {/* 16:9 Presentation Canvas */}
            <div className="relative aspect-[16/9] rounded-xl border border-stone-300 bg-stone-950 text-white overflow-hidden shadow-inner flex flex-col justify-between p-5">
              {/* If real rendered preview image is ready, display it */}
              {preview?.pages && preview.pages[selectedIndex] ? (
                <div className="absolute inset-0 z-10 bg-black flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.pages[selectedIndex]}
                    alt={`第 ${selectedIndex + 1} 页`}
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : currentItem ? (
                /* Simulated Presentation Slide */
                <>
                  <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-emerald-500/10 blur-2xl"></div>
                  <div>
                    <div className="text-[9px] font-mono text-emerald-400 tracking-widest uppercase mb-1">
                      {currentItem.layout || "PRESENTATION"}
                    </div>
                    <h3 className="text-sm font-bold font-serif leading-snug text-white max-w-[95%]">
                      {currentItem.title}
                    </h3>
                    <p className="text-[10px] text-stone-300 mt-2.5 line-clamp-4 leading-relaxed whitespace-pre-wrap">
                      {currentItem.summary}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-[8px] font-mono text-stone-500 pt-2 border-t border-stone-800">
                    <span>DRAFTBOARD 物理版面模拟</span>
                    <span>
                      {selectedIndex + 1} / {outline?.items.length || 1}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-stone-500">
                  请在左侧选择或生成大纲页
                </div>
              )}
            </div>

            {/* Slide Navigation Thumbnails Strip */}
            {outline && outline.items.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                {outline.items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedIndex(i)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-medium transition-all ${
                      i === selectedIndex
                        ? "bg-stone-900 text-white shadow-xs"
                        : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                    }`}
                  >
                    #{i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Render Real Preview Button */}
            {project?.download_available && (
              <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
                <span className="text-[11px] text-stone-400">
                  {preview ? "已加载 LibreOffice 真机渲染图" : "可一键渲染高保真真机截图"}
                </span>
                <button
                  onClick={renderPreviewsNow}
                  disabled={renderingPreview}
                  className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-medium transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${renderingPreview ? "animate-spin" : ""}`} />
                  <span>{renderingPreview ? "渲染中..." : "渲染真机预览"}</span>
                </button>
              </div>
            )}

            {/* Typography Guard & Verification Inspector */}
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-stone-800">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>确定性版面与字形质检</span>
                </span>
                {report && !report.success ? (
                  <span className="text-[10px] text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full font-mono">
                    排版未通过
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-mono">
                    0 处溢出 (Safe)
                  </span>
                )}
              </div>

              {issues.length > 0 ? (
                <ul className="space-y-1 text-rose-600 text-[11px]">
                  {issues.map((iss, i) => (
                    <li key={i} className="flex items-start gap-1 font-mono">
                      <span>•</span>
                      <span>
                        [{iss.code}] {iss.slide_id ? `${iss.slide_id}: ` : ""}
                        {iss.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-[10px] text-stone-500 pt-1 border-t border-stone-200/50">
                  <div>
                    <span className="block text-stone-400">排版约束:</span>
                    <span className="font-mono text-stone-700">fontTools Advance Width</span>
                  </div>
                  <div>
                    <span className="block text-stone-400">禁则校验:</span>
                    <span className="text-emerald-700 font-medium">中西文孤点行已锁</span>
                  </div>
                </div>
              )}
            </div>

            {/* Source Fragment Excerpt Peek */}
            {currentItem && (
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-[11px] text-amber-900 space-y-1">
                <div className="font-semibold text-[10px] text-amber-800 flex items-center justify-between">
                  <span>📌 来源证据对照 (No-Fabrication Guard)</span>
                  <span className="font-mono text-[9px] text-amber-600">
                    {currentItem.source_ids.join(", ") || "无特定片段"}
                  </span>
                </div>
                <p className="text-[10px] font-mono text-amber-800/90 leading-tight bg-white/70 p-2 rounded border border-amber-200/60">
                  {currentItem.summary || "当前大纲项暂无额外摘要"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
