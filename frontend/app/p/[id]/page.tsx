"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  History,
  X,
  Layers,
  ChevronDown,
  Check,
  Clock,
  Maximize2,
} from "lucide-react";

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [savedOutline, setSavedOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "error" | "ok">("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showQADetails, setShowQADetails] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"" | "error" | "ok">("");

  // Slide Mirror & Preview states
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
        setSavedOutline(JSON.parse(JSON.stringify(data)));
        setVersion(v);
        setSelectedIndex(0);
      } catch (e) {
        setRawError((e as Error).message);
        setStatusKind("error");
      }
    },
    [pid]
  );

  const refresh = useCallback(async () => {
    try {
      const data = await api<Project>(`/api/projects/${pid}`);
      setProject(data);
      const mats = await api<{ materials: Material[] }>(`/api/projects/${pid}/materials`);
      setMaterials(mats.materials || []);

      const outlines = [...data.outlines].sort((a, b) => b.mtime - a.mtime);
      if (outlines.length > 0) {
        await showOutline(outlines[0].outline_version);
      } else {
        setOutline(null);
        setSavedOutline(null);
        setVersion("");
      }
      await loadPreview();
      return data;
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
      return null;
    }
  }, [pid, showOutline, loadPreview]);

  const reportTask = useCallback((task: Task) => {
    if (task.status === "failed") {
      setStatusKind("error");
      setRawError(task.error || `任务 ${task.task_id} 失败 (${task.step || "未知步骤"})`);
      setIssues(task.result?.export?.issues ?? task.result?.validation?.issues ?? []);
    } else if (task.status === "succeeded") {
      setStatusKind("ok");
      setStatus(`已成功完成：${task.step || "处理完毕"}`);
      setRawError(null);
      setIssues([]);
    } else {
      setStatusKind("");
      setStatus(`正在执行：${task.step || "处理中..."}`);
    }
  }, []);

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      setIsGenerating(true);
      const tick = async () => {
        let task: Task;
        try {
          task = await api<Task>(`/api/projects/${pid}/tasks/${taskId}`);
        } catch {
          stopPolling();
          setIsGenerating(false);
          return;
        }
        setStatus(`正在执行：${task.step || "处理中..."}`);
        if (task.status === "succeeded" || task.status === "failed") {
          stopPolling();
          setIsGenerating(false);
          reportTask(task);
          const data = await refresh();
          if (task.status === "succeeded" && task.result?.outline_version) {
            await showOutline(task.result.outline_version);
          }
          await loadPreview();
          if (data) {
            const active = data.tasks.find(
              (t) => t.status === "queued" || t.status === "running"
            );
            if (active) startPolling(active.task_id);
          }
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 1500);
    },
    [pid, refresh, reportTask, showOutline, loadPreview]
  );

  useEffect(() => {
    (async () => {
      const data = await refresh();
      if (data) {
        const active = data.tasks.find(
          (t) => t.status === "queued" || t.status === "running"
        );
        if (active) startPolling(active.task_id);
      }
    })();
    return () => stopPolling();
  }, [pid, refresh, startPolling]);

  // Track if user made edits compared to saved version
  const isStale = useMemo(() => {
    if (!outline || !savedOutline) return false;
    return JSON.stringify(outline.items) !== JSON.stringify(savedOutline.items);
  }, [outline, savedOutline]);

  // Humanized error text
  const humanizedError = useMemo(() => {
    if (!rawError) return null;
    if (
      rawError.includes("没有保存任何大纲") ||
      rawError.includes("暂无可用素材") ||
      rawError.includes("未检测到有效素材")
    ) {
      return {
        title: "大纲提炼未完成",
        desc: "项目中未检测到有效素材或素材内容过短。请先在素材池上传 Markdown 笔记或图片后再试。",
      };
    }
    if (rawError.includes("排版未通过") || rawError.includes("溢出")) {
      return {
        title: "演示文稿生成遇到排版问题",
        desc: "检测到字形度量溢出或文字截断，请查看右侧版面检查项以调整内容长度。",
      };
    }
    return {
      title: "操作未完成",
      desc: rawError,
    };
  }, [rawError]);

  // Current workflow stage
  const currentStage: "no_materials" | "has_materials_no_outline" | "outline_ready" | "ppt_ready" =
    useMemo(() => {
      if (project?.download_available) return "ppt_ready";
      if (outline && outline.items.length > 0) return "outline_ready";
      if (materials.length > 0) return "has_materials_no_outline";
      return "no_materials";
    }, [project, outline, materials]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function uploadFiles(files?: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setRawError(null);
    setStatusKind("");
    setStatus("正在上传材料...");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        await fetch(`/api/projects/${pid}/materials`, { method: "POST", body: fd });
      }
      setMsg(`成功上传 ${files.length} 份材料并完成事实切片切分`);
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 3500);
      await refresh();
      setStatus("");
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function genOutline() {
    if (materials.length === 0) {
      setRawError("项目中暂无可用素材，请先上传 Markdown 笔记或图片材料后再提炼大纲。");
      setStatusKind("error");
      return;
    }
    setRawError(null);
    setStatusKind("");
    setIsGenerating(true);
    setStatus("正在解析材料并提炼演示大纲...");
    try {
      const task = await api<Task>(`/api/projects/${pid}/outline/generate`, {
        method: "POST",
      });
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function saveOutline() {
    if (!outline) return;
    try {
      const updated = await api<Outline>(
        `/api/projects/${pid}/outlines/${outline.outline_version}`,
        jsonOptions("PUT", outline)
      );
      setOutline(updated);
      setSavedOutline(JSON.parse(JSON.stringify(updated)));
      setMsg("大纲已成功保存");
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 2500);
      await refresh();
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function confirmGenerate() {
    if (!version) return;
    setRawError(null);
    setStatusKind("");
    setIsGenerating(true);
    setStatus("正在执行字形度量并编译 PowerPoint 演示文稿...");
    try {
      const task = await api<Task>(`/api/projects/${pid}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline_version: version }),
      });
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function renderPreviewsNow() {
    setRenderingPreview(true);
    try {
      const res = await api<{ message: string; pages: number }>(
        `/api/projects/${pid}/render-preview`,
        { method: "POST" }
      );
      await loadPreview();
      setMsg(`已生成 ${res.pages} 页真机渲染截图`);
      setMsgKind("ok");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    } finally {
      setRenderingPreview(false);
    }
  }

  // Outline Editing Helpers
  function updateItem(index: number, field: "title" | "summary" | "layout", val: string) {
    if (!outline) return;
    const items = [...outline.items];
    items[index] = { ...items[index], [field]: val };
    setOutline({ ...outline, items });
  }

  function moveItem(index: number, delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!outline) return;
    const target = index + delta;
    if (target < 0 || target >= outline.items.length) return;
    const items = [...outline.items];
    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    setOutline({ ...outline, items });
    setSelectedIndex(target);
  }

  function addBlock() {
    if (!outline) return;
    const items = [
      ...outline.items,
      {
        outline_item_id: `slide_${Date.now()}`,
        title: "新幻灯片标题",
        summary: "输入该页的要点说明与陈述...",
        source_ids: [],
        evidence_status: "insufficient",
        layout: "content",
      },
    ];
    setOutline({ ...outline, items });
    setSelectedIndex(items.length - 1);
  }

  function deleteBlock(index: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!outline || outline.items.length <= 1) return;
    const items = outline.items.filter((_, i) => i !== index);
    setOutline({ ...outline, items });
    setSelectedIndex(Math.max(0, index - 1));
  }

  const currentItem = outline?.items[selectedIndex];

  // Drag and drop handlers for file upload
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void uploadFiles(e.dataTransfer.files);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.png,.jpg,.jpeg"
        multiple
        onChange={(e) => void uploadFiles(e.target.files)}
        className="hidden"
      />

      {/* Top Workspace Header Bar */}
      <div className="bg-white border border-stone-200/90 rounded-2xl px-5 py-3 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Left: Clean Breadcrumb & Project Name */}
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="text-stone-500 hover:text-stone-900 text-xs font-medium transition-colors"
          >
            项目
          </Link>
          <span className="text-stone-300">/</span>
          <span className="font-serif font-bold text-base text-stone-900 tracking-tight">
            {project?.name || pid}
          </span>
          {outline && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 border border-stone-200">
              {outline.items.length} 页
            </span>
          )}
          {isStale && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              未保存的修改
            </span>
          )}
        </div>

        {/* Center: Clean 3-Stage Pipeline Progress (Replaces disabled buttons) */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-stone-500 font-medium px-3 py-1 bg-stone-50 rounded-full border border-stone-200/60 select-none">
          <span
            className={`flex items-center gap-1 ${
              materials.length > 0 ? "text-emerald-700 font-semibold" : "text-stone-500"
            }`}
          >
            {materials.length > 0 ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />}
            <span>素材 ({materials.length})</span>
          </span>
          <span className="text-stone-300">→</span>
          <span
            className={`flex items-center gap-1 ${
              outline ? "text-emerald-700 font-semibold" : "text-stone-500"
            }`}
          >
            {outline ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />}
            <span>大纲 ({outline?.items?.length || 0}页)</span>
          </span>
          <span className="text-stone-300">→</span>
          <span
            className={`flex items-center gap-1 ${
              project?.download_available ? "text-emerald-700 font-semibold" : "text-stone-500"
            }`}
          >
            {project?.download_available ? <Check className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />}
            <span>生成 PPT</span>
          </span>
        </div>

        {/* Right: Dynamic Adaptive Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Outline Version Switcher (Only visible when versions exist) */}
          {(project?.outlines?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-xl px-2.5 py-1.5 text-stone-700">
              <History className="w-3.5 h-3.5 text-stone-500 shrink-0" />
              <select
                value={version}
                onChange={(e) => void showOutline(e.target.value)}
                className="text-xs bg-transparent focus:outline-none font-mono cursor-pointer pr-1"
                title="切换历史大纲版本"
              >
                {[...(project?.outlines ?? [])]
                  .sort((a, b) => b.mtime - a.mtime)
                  .map((o) => (
                    <option key={o.outline_version} value={o.outline_version}>
                      {o.outline_version} ({o.item_count}页 · {o.is_confirmed ? "已确认" : "草稿"})
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Material Pool Drawer Toggle */}
          <button
            onClick={() => setShowMaterialsDrawer(!showMaterialsDrawer)}
            className="px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-stone-500" />
            <span>素材池 ({materials.length})</span>
          </button>

          {/* Save Outline Button (Only active when an outline is loaded) */}
          {outline && (
            <button
              onClick={saveOutline}
              disabled={!isStale}
              className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors flex items-center gap-1.5 ${
                isStale
                  ? "bg-stone-100 hover:bg-stone-200 border-stone-300 text-stone-900 shadow-xs cursor-pointer"
                  : "bg-white border-stone-200 text-stone-400 cursor-default"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isStale ? "保存修改" : "已保存"}</span>
            </button>
          )}

          {/* Dynamic Stage-Driven Primary Action Button */}
          {currentStage === "no_materials" && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>上传素材</span>
            </button>
          )}

          {currentStage === "has_materials_no_outline" && (
            <button
              onClick={genOutline}
              disabled={isGenerating}
              className="px-4 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isGenerating ? "正在提炼..." : "生成大纲"}</span>
            </button>
          )}

          {currentStage === "outline_ready" && (
            <button
              onClick={confirmGenerate}
              disabled={isGenerating || !version}
              className="px-4 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isGenerating ? "正在生成..." : "确认大纲并生成 PPT"}</span>
            </button>
          )}

          {currentStage === "ppt_ready" && (
            <div className="flex items-center gap-2">
              <button
                onClick={confirmGenerate}
                disabled={isGenerating}
                className="px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                title="重新渲染生成 PPTX"
              >
                <RefreshCw className={`w-3 h-3 ${isGenerating ? "animate-spin" : ""}`} />
                <span>重新生成</span>
              </button>

              <a
                href={`/api/projects/${pid}/download`}
                download
                className="px-4 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载 PPTX</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Slide Materials Drawer (Collapsible) */}
      {showMaterialsDrawer && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 shadow-xs space-y-4 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
              <Upload className="w-4 h-4 text-stone-600" />
              <span>原始素材池管理 ({materials.length})</span>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer px-3 py-1.5 bg-stone-100 hover:bg-stone-200 rounded-xl text-stone-800 text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>上传材料 (.md, .txt, .png, .jpg)</span>
            </button>
          </div>

          {materials.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {materials.map((m) => (
                <div
                  key={m.asset_id}
                  className="p-3 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {m.asset_type === "image" ? (
                      <ImageIcon className="w-4 h-4 text-amber-500 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                    )}
                    <span className="truncate font-mono font-medium text-stone-800">
                      {m.asset_id}
                    </span>
                  </div>
                  <span className="text-[10px] text-stone-500 font-mono uppercase bg-white px-1.5 py-0.5 rounded border border-stone-200">
                    {m.asset_type}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-stone-400 text-xs">
              暂无上传的材料。点击右上角按钮添加 Markdown 笔记或图片。
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-stone-100 text-xs">
            <span className="text-stone-500">
              上传素材后，系统将建立不可篡改的事实索引切片，作为后续大纲与幻灯片的唯一论据。
            </span>
            {materials.length > 0 && (
              <button
                onClick={genOutline}
                disabled={isGenerating}
                className="text-emerald-700 font-semibold hover:underline flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isGenerating ? "提炼中..." : "重新提取大纲"}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Humanized Error Banner with Dismiss & Retry */}
      {humanizedError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs text-rose-900 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold text-rose-950 text-sm">
                  {humanizedError.title}
                </div>
                <div className="text-rose-800 leading-relaxed font-sans">
                  {humanizedError.desc}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {materials.length > 0 && (
                <button
                  onClick={genOutline}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  重试
                </button>
              )}
              <button
                onClick={() => {
                  setRawError(null);
                  setStatusKind("");
                }}
                className="p-1 text-rose-500 hover:text-rose-800 rounded-lg transition-colors"
                title="关闭错误提示"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Technical Details Accordion */}
          {rawError && (
            <div className="pt-2 border-t border-rose-200/60 text-[11px]">
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-rose-700 hover:text-rose-900 font-medium flex items-center gap-1"
              >
                <span>{showErrorDetails ? "收起技术日志" : "查看技术日志详情"}</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${
                    showErrorDetails ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showErrorDetails && (
                <pre className="mt-1.5 p-2 bg-rose-100/70 rounded-lg font-mono text-[10px] text-rose-900 overflow-x-auto whitespace-pre-wrap">
                  {rawError}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Progress / Step Toast */}
      {status && statusKind !== "error" && (
        <div className="px-4 py-2 rounded-xl text-xs flex items-center justify-between bg-stone-100 text-stone-700 border border-stone-200">
          <div className="flex items-center gap-2 font-mono">
            {statusKind === "ok" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <Clock className="w-4 h-4 text-stone-500 animate-spin" />
            )}
            <span>{status}</span>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {msg && (
        <div className="px-4 py-2 rounded-xl text-xs bg-emerald-50 text-emerald-800 border border-emerald-200">
          {msg}
        </div>
      )}

      {/* Main Dual-Pane Doc-to-Deck Workspace Viewport */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Outline Editor or Direct Material Dropzone (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-stone-200/90 rounded-2xl p-6 shadow-xs space-y-4 min-h-[580px] flex flex-col justify-between">
          <div className="space-y-4">
            {/* Header: Plain Naming ("大纲") */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif font-bold text-base text-stone-900">
                    大纲
                  </h2>
                  {outline && (
                    <span className="text-xs font-mono text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                      {outline.items.length} 页
                    </span>
                  )}
                </div>
                <p className="text-xs text-stone-500">
                  修改将实时反映在右侧预览中；每页均受材料事实严格约束。
                </p>
              </div>

              {outline && outline.items.length > 0 && (
                <button
                  onClick={addBlock}
                  className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加一页</span>
                </button>
              )}
            </div>

            {/* Stage 1: No Materials -> Prominent Drag-and-Drop Area */}
            {currentStage === "no_materials" && (
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`py-16 px-6 text-center rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center space-y-4 ${
                  isDragging
                    ? "border-emerald-500 bg-emerald-50/50"
                    : "border-stone-300 hover:border-stone-400 bg-stone-50/60 hover:bg-stone-50"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-white shadow-xs border border-stone-200 flex items-center justify-center text-stone-700">
                  <Upload className="w-5 h-5 text-emerald-700" />
                </div>
                <div className="space-y-1.5 max-w-sm">
                  <div className="text-sm font-semibold text-stone-900">
                    第一步：投入原始材料
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    点击选择或直接将 Markdown (.md / .txt) 笔记、数据切片或图片拖入此处。
                  </p>
                </div>
                <span className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-medium shadow-xs">
                  选择本地文件
                </span>
                <span className="text-[11px] text-stone-400">
                  系统将严格以你上传的内容为事实基准，绝不编造虚构内容。
                </span>
              </div>
            )}

            {/* Stage 2: Has Materials, No Outline -> Clear Next Step Guide */}
            {currentStage === "has_materials_no_outline" && (
              <div className="py-12 px-6 text-center rounded-2xl border border-stone-200 bg-stone-50/50 space-y-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center mx-auto text-emerald-800">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <div className="text-sm font-semibold text-stone-900">
                    已导入 {materials.length} 份材料
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">
                    原始材料已就绪，点击下方按钮让 AI 梳理结构化大纲并建立事实引用索引。
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
                  <button
                    onClick={genOutline}
                    disabled={isGenerating}
                    className="w-full sm:w-auto px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isGenerating ? "正在提炼大纲..." : "开始提炼大纲"}</span>
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full sm:w-auto px-4 py-2.5 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-medium rounded-xl transition-colors cursor-pointer"
                  >
                    + 继续上传素材
                  </button>
                </div>
              </div>
            )}

            {/* Stage 3 & 4: Sequential Block Outline Editor */}
            {outline && outline.items.length > 0 && (
              <div className="space-y-3">
                {outline.items.map((item, idx) => {
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
                          <span className="font-mono text-xs font-bold text-stone-500">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          {/* Layout Selector (Plain Chinese Labels) */}
                          <select
                            value={item.layout || "content"}
                            onChange={(e) => updateItem(idx, "layout", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] font-sans bg-white border border-stone-300 rounded-md px-1.5 py-0.5 text-stone-700 focus:outline-none"
                          >
                            <option value="cover">封面</option>
                            <option value="content">正文</option>
                            <option value="bullets">分点要点</option>
                            <option value="two_column">双栏对比</option>
                            <option value="closing">致谢尾页</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Evidence Pill */}
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                              item.evidence_status === "supported"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.evidence_status === "partial"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-stone-100 text-stone-600"
                            }`}
                          >
                            {item.evidence_status === "supported"
                              ? "依据充分"
                              : item.evidence_status === "partial"
                              ? "部分依据"
                              : "缺出处"}
                          </span>

                          {/* Reorder & Delete tools */}
                          <div
                            className="flex items-center gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              disabled={idx === 0}
                              onClick={(e) => moveItem(idx, -1, e)}
                              title="上移"
                              className="p-1 text-stone-400 hover:text-stone-700 disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              disabled={idx === outline.items.length - 1}
                              onClick={(e) => moveItem(idx, 1, e)}
                              title="下移"
                              className="p-1 text-stone-400 hover:text-stone-700 disabled:opacity-20 cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            {outline.items.length > 1 && (
                              <button
                                onClick={(e) => deleteBlock(idx, e)}
                                title="删除此页"
                                className="p-1 text-stone-400 hover:text-rose-600 cursor-pointer"
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
                        className="w-full text-xs text-stone-700 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-stone-400 focus:bg-white outline-none mt-1 py-0.5 leading-relaxed resize-none"
                      />

                      {/* Sources citation footer */}
                      <div className="mt-2 flex items-center justify-between text-[11px] text-stone-500 pt-1.5 border-t border-stone-100">
                        <span className="font-mono text-stone-500 truncate max-w-[80%]">
                          🔗 材料出处: {item.source_ids.join(", ") || "暂无具体切片编号"}
                        </span>
                        {isActive && (
                          <span className="text-emerald-700 font-medium whitespace-nowrap">
                            当前聚焦 👁
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Card Footer: Help Note */}
          <div className="pt-3 border-t border-stone-100 text-xs text-stone-400 flex items-center justify-between">
            <span>支持拖拽文本直接复制修改，自动保持事实出处追踪。</span>
            {materials.length > 0 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-stone-500 hover:text-stone-800 underline text-xs cursor-pointer"
              >
                + 添加更多材料
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Preview & QA Guard (5 cols) */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-16">
          <div className="bg-white border border-stone-200/90 rounded-2xl p-5 shadow-xs space-y-4">
            {/* Header: Plain Naming ("预览", "全屏") */}
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    outline ? "bg-emerald-500 animate-pulse" : "bg-stone-300"
                  }`}
                ></span>
                <span className="font-serif font-bold text-xs text-stone-900">
                  预览
                </span>
                <span className="text-[11px] px-2 py-0.5 bg-stone-100 text-stone-600 rounded font-mono">
                  {outline && outline.items.length > 0
                    ? `第 ${selectedIndex + 1} 页 / 共 ${outline.items.length} 页`
                    : "待排版"}
                </span>
              </div>

              {outline && outline.items.length > 0 && (
                <Link
                  href={`/p/${pid}/preview`}
                  className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>全屏</span>
                </Link>
              )}
            </div>

            {/* 16:9 Presentation Canvas (Empty State: Light dotted outline; Populated: Presentation Slide) */}
            {outline && outline.items.length > 0 ? (
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
                      <div className="text-[10px] font-mono text-emerald-400 tracking-widest uppercase mb-1">
                        {currentItem.layout || "PRESENTATION"}
                      </div>
                      <h3 className="text-sm font-bold font-serif leading-snug text-white max-w-[95%]">
                        {currentItem.title}
                      </h3>
                      <p className="text-xs text-stone-300 mt-2.5 line-clamp-4 leading-relaxed whitespace-pre-wrap font-sans">
                        {currentItem.summary}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-[9px] font-mono text-stone-400 pt-2 border-t border-stone-800">
                      <span>16:9 版面排版模拟</span>
                      <span>
                        {selectedIndex + 1} / {outline.items.length}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              /* Light Dotted Outline Canvas in Empty State (Replaces heavy pitch-black box) */
              <div className="aspect-[16/9] w-full rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/70 flex flex-col items-center justify-center p-6 text-center space-y-2">
                <div className="w-9 h-9 rounded-xl bg-white shadow-2xs border border-stone-200 flex items-center justify-center text-stone-400">
                  <Layers className="w-4 h-4 text-stone-400" />
                </div>
                <div className="text-xs font-semibold text-stone-700">
                  暂无排版预览
                </div>
                <p className="text-[11px] text-stone-500 leading-relaxed max-w-[220px]">
                  完成大纲提炼后，将在此呈现 16:9 实时排版镜面。
                </p>
              </div>
            )}

            {/* Slide Navigation Thumbnails Strip */}
            {outline && outline.items.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                {outline.items.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedIndex(i)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                      i === selectedIndex
                        ? "bg-stone-900 text-white shadow-xs"
                        : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    #{i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Real Machine Render Button */}
            {project?.download_available && (
              <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs">
                <span className="text-xs text-stone-500">
                  {preview ? "已加载真机渲染截图" : "可一键渲染高保真真机截图"}
                </span>
                <button
                  onClick={renderPreviewsNow}
                  disabled={renderingPreview}
                  className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${renderingPreview ? "animate-spin" : ""}`} />
                  <span>{renderingPreview ? "渲染中..." : "渲染真机截图"}</span>
                </button>
              </div>
            )}

            {/* 版面检查 (QA Panel) - Fixed false Safe signal */}
            <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200/90 space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-stone-800">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>版面检查</span>
                </span>

                {/* State-aware QA Badge: Never falsely green when empty! */}
                {!outline || outline.items.length === 0 ? (
                  <span className="text-xs text-stone-500 bg-stone-200/70 border border-stone-300/60 px-2 py-0.5 rounded-full font-mono">
                    等待内容
                  </span>
                ) : report && !report.success ? (
                  <span className="text-xs text-rose-800 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-full font-mono">
                    排版未通过
                  </span>
                ) : issues.length > 0 ? (
                  <span className="text-xs text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{issues.length} 处需调整</span>
                  </span>
                ) : (
                  <span className="text-xs text-emerald-800 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-700" />
                    <span>0 处溢出 (已校验)</span>
                  </span>
                )}
              </div>

              {issues.length > 0 ? (
                <ul className="space-y-1 text-rose-700 text-xs pt-1">
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
                <div className="pt-1 border-t border-stone-200/60 text-xs text-stone-500">
                  <button
                    onClick={() => setShowQADetails(!showQADetails)}
                    className="text-stone-600 hover:text-stone-900 flex items-center gap-1 text-[11px] font-medium"
                  >
                    <span>{showQADetails ? "收起度量规则" : "查看度量规则详情"}</span>
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${
                        showQADetails ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  {showQADetails && (
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-600 pt-2 font-mono">
                      <div>
                        <span className="block text-stone-400">字符物理宽度:</span>
                        <span>fontTools Advance Width</span>
                      </div>
                      <div>
                        <span className="block text-stone-400">禁则排版:</span>
                        <span className="text-emerald-700">中西文孤点行已锁</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 材料出处对照 (Plain Naming instead of No-Fabrication Guard) */}
            {currentItem && (
              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-950 space-y-1.5">
                <div className="font-semibold text-xs text-amber-900 flex items-center justify-between">
                  <span>材料出处对照</span>
                  <span className="font-mono text-[11px] text-amber-700">
                    {currentItem.source_ids.join(", ") || "无特定片段引用"}
                  </span>
                </div>
                <p className="text-xs font-mono text-amber-900/90 leading-relaxed bg-white/80 p-2.5 rounded-lg border border-amber-200/70">
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
