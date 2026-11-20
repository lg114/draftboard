"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ExportReport,
  Issue,
  jsonOptions,
  Material,
  MaterialsResponse,
  Outline,
  Preview,
  Project,
  SourceFragment,
  Task,
} from "../../../lib/api";
import { MaterialsDrawer } from "../../../components/workspace/MaterialsDrawer";
import { OutlineEditor } from "../../../components/workspace/OutlineEditor";
import { SlidePreviewPanel } from "../../../components/workspace/SlidePreviewPanel";
import { StatusBanners } from "../../../components/workspace/StatusBanners";
import {
  WorkspaceHeader,
  WorkspaceStage,
} from "../../../components/workspace/WorkspaceHeader";

function buildOutlineEditPayload(outline: Outline) {
  return {
    items: outline.items.map((item) => ({
      outline_item_id: item.outline_item_id,
      title: item.title,
      summary: item.summary,
      layout: item.layout ?? null,
      source_ids: item.source_ids,
    })),
  };
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  const pid = params.id;

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sourceFragments, setSourceFragments] = useState<SourceFragment[]>([]);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [savedOutline, setSavedOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"" | "error" | "ok">("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [msg, setMsg] = useState("");

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const flashMsg = (text: string, durationMs = 3000) => {
    setMsg(text);
    setTimeout(() => setMsg(""), durationMs);
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
      if (r && !r.success && r.issues?.length) {
        setIssues(r.issues);
      }
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
        setSelectedIndex((prev) =>
          Math.min(prev, Math.max(0, data.items.length - 1))
        );
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
      const mats = await api<MaterialsResponse>(`/api/projects/${pid}/materials`);
      setMaterials(mats.materials || []);
      setSourceFragments(mats.source_fragments || []);

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
      setRawError(
        task.error || `任务 ${task.task_id} 失败 (${task.step || "未知步骤"})`
      );
      setIssues(
        task.result?.export?.issues ?? task.result?.validation?.issues ?? []
      );
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

  const isStale = useMemo(() => {
    if (!outline || !savedOutline) return false;
    return JSON.stringify(outline.items) !== JSON.stringify(savedOutline.items);
  }, [outline, savedOutline]);

  const humanizedError = useMemo(() => {
    if (!rawError) return null;
    if (
      rawError.includes("没有保存任何大纲") ||
      rawError.includes("暂无可用素材") ||
      rawError.includes("未检测到有效素材")
    ) {
      return {
        title: "大纲提炼未完成",
        desc: "项目中未检测到有效素材或模型未能提炼出大纲。请确认已上传 Markdown/TXT 笔记或图片后再试。",
      };
    }
    if (
      rawError.includes("排版检查未通过") ||
      rawError.includes("排版未通过") ||
      rawError.includes("OVERFLOW") ||
      rawError.includes("溢出")
    ) {
      return {
        title: "演示文稿生成遇到排版问题",
        desc: "检测到字形度量溢出或超长不可断行文本，请查看右侧「版面检查」中的具体页码并精简文案后重试。",
      };
    }
    if (rawError.includes("LibreOffice") || rawError.includes("渲染预览")) {
      return {
        title: "真实排版图渲染遇到问题",
        desc: "调用本地 LibreOffice 引擎失败。已生成的 PPTX 文件不受影响，可直接点击右上角「下载 PPTX」查看。",
      };
    }
    return {
      title: "操作未完成",
      desc: rawError,
    };
  }, [rawError]);

  const currentStage: WorkspaceStage = useMemo(() => {
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
        const res = await fetch(`/api/projects/${pid}/materials`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          let detail = res.statusText;
          try {
            detail = (await res.json()).detail || detail;
          } catch {}
          throw new Error(`${file.name}: ${detail}`);
        }
      }
      flashMsg(`成功上传 ${files.length} 份材料并更新事实切片索引`, 3500);
      await refresh();
      setStatus("");
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
      setStatus("");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    setRawError(null);
    try {
      const updated = await api<Outline>(
        `/api/projects/${pid}/outlines/${outline.outline_version}`,
        jsonOptions("PUT", buildOutlineEditPayload(outline))
      );
      setOutline(updated);
      setSavedOutline(JSON.parse(JSON.stringify(updated)));
      setVersion(updated.outline_version);
      flashMsg(
        updated.outline_version !== outline.outline_version
          ? `已派生新草稿版本 ${updated.outline_version}（原确认版本已保留）`
          : "大纲已成功保存",
        3000
      );
      await refresh();
      await showOutline(updated.outline_version);
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function confirmGenerate() {
    if (!version || !outline) return;
    setRawError(null);
    setStatusKind("");
    setIsGenerating(true);
    setStatus("正在确认大纲并编译 PowerPoint 演示文稿...");
    try {
      let targetVersion = version;
      if (isStale) {
        const saved = await api<Outline>(
          `/api/projects/${pid}/outlines/${version}`,
          jsonOptions("PUT", buildOutlineEditPayload(outline))
        );
        setOutline(saved);
        setSavedOutline(JSON.parse(JSON.stringify(saved)));
        targetVersion = saved.outline_version;
        setVersion(saved.outline_version);
      }
      await api(`/api/projects/${pid}/outlines/${targetVersion}/confirm`, {
        method: "POST",
      });
      const task = await api<Task>(
        `/api/projects/${pid}/generate`,
        jsonOptions("POST", { outline_version: targetVersion })
      );
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setRawError((e as Error).message);
      setStatusKind("error");
    }
  }

  async function renderPreviewsNow() {
    setRenderingPreview(true);
    setRawError(null);
    try {
      const res = await api<Preview>(`/api/projects/${pid}/preview/render`, {
        method: "POST",
      });
      setPreview(res);
      flashMsg(`已生成 ${res.pages?.length || 0} 页高保真排版预览截图`);
    } catch (e) {
      setRawError((e as Error).message);
      setStatusKind("error");
    } finally {
      setRenderingPreview(false);
    }
  }

  // ── Outline Editing Helpers ───────────────────────────────────────────────

  function updateItem(
    index: number,
    field: "title" | "summary" | "layout",
    val: string
  ) {
    if (!outline) return;
    const items = [...outline.items];
    items[index] = { ...items[index], [field]: val };
    setOutline({ ...outline, items });
  }

  function moveItem(index: number, delta: number) {
    if (!outline) return;
    const target = index + delta;
    if (target < 0 || target >= outline.items.length) return;
    const items = [...outline.items];
    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    setOutline({ ...outline, items });
    setSelectedIndex(target);
  }

  function addItem() {
    if (!outline) return;
    const items = [
      ...outline.items,
      {
        outline_item_id: `slide-${Date.now().toString(36)}`,
        title: "新幻灯片标题",
        summary: "输入该页的要点说明与陈述...",
        source_ids: [],
        evidence_status: "unsupported",
        layout: "content",
      },
    ];
    setOutline({ ...outline, items });
    setSelectedIndex(items.length - 1);
  }

  function deleteItem(index: number) {
    if (!outline || outline.items.length <= 1) return;
    const items = outline.items.filter((_, i) => i !== index);
    setOutline({ ...outline, items });
    setSelectedIndex(Math.max(0, Math.min(index, items.length - 1)));
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.png,.jpg,.jpeg"
        multiple
        onChange={(e) => void uploadFiles(e.target.files)}
        className="hidden"
      />

      <WorkspaceHeader
        pid={pid}
        project={project}
        materialsCount={materials.length}
        outline={outline}
        version={version}
        isStale={isStale}
        isGenerating={isGenerating}
        currentStage={currentStage}
        showMaterialsDrawer={showMaterialsDrawer}
        onToggleMaterialsDrawer={() =>
          setShowMaterialsDrawer(!showMaterialsDrawer)
        }
        onSelectVersion={(v) => void showOutline(v)}
        onSaveOutline={() => void saveOutline()}
        onUploadClick={() => fileInputRef.current?.click()}
        onGenerateOutline={() => void genOutline()}
        onConfirmGenerate={() => void confirmGenerate()}
      />

      {showMaterialsDrawer && (
        <MaterialsDrawer
          materials={materials}
          fragmentsCount={sourceFragments.length}
          isGenerating={isGenerating}
          onUploadClick={() => fileInputRef.current?.click()}
          onGenerateOutline={() => void genOutline()}
        />
      )}

      <StatusBanners
        humanizedError={humanizedError}
        rawError={rawError}
        canRetryOutline={materials.length > 0 && !isGenerating}
        status={status}
        statusKind={statusKind}
        msg={msg}
        onRetryOutline={() => void genOutline()}
        onDismissError={() => {
          setRawError(null);
          setStatusKind("");
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <OutlineEditor
          currentStage={currentStage}
          materialsCount={materials.length}
          outline={outline}
          selectedIndex={selectedIndex}
          isGenerating={isGenerating}
          onSelectIndex={setSelectedIndex}
          onUploadClick={() => fileInputRef.current?.click()}
          onDropFiles={(files) => void uploadFiles(files)}
          onGenerateOutline={() => void genOutline()}
          onUpdateItem={updateItem}
          onMoveItem={moveItem}
          onAddItem={addItem}
          onDeleteItem={deleteItem}
        />

        <SlidePreviewPanel
          pid={pid}
          project={project}
          outline={outline}
          version={version}
          isStale={isStale}
          selectedIndex={selectedIndex}
          preview={preview}
          report={report}
          issues={issues}
          sourceFragments={sourceFragments}
          renderingPreview={renderingPreview}
          onSelectIndex={setSelectedIndex}
          onRenderPreviewsNow={() => void renderPreviewsNow()}
        />
      </div>
    </main>
  );
}
