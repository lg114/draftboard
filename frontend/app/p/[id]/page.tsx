"use client";

import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ExportReport,
  FALLBACK_THEMES,
  Issue,
  jsonOptions,
  Material,
  MaterialsResponse,
  Outline,
  OutlineLayout,
  Preview,
  Project,
  SlideRefineCandidate,
  SourceFragment,
  Task,
  ThemeOption,
} from "../../../lib/api";
import { EmptyStageOnboarding } from "../../../components/workspace/EmptyStageOnboarding";
import {
  EditableOutlineField,
  extractIssueSlideIndices,
  WorkspaceStage,
} from "../../../components/workspace/layoutUtils";
import { MaterialsDrawer } from "../../../components/workspace/MaterialsDrawer";
import { SlideInspector } from "../../../components/workspace/SlideInspector";
import { SlideNavigator } from "../../../components/workspace/SlideNavigator";
import { SlideStageCanvas } from "../../../components/workspace/SlideStageCanvas";
import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";

function buildOutlineEditPayload(outline: Outline) {
  return {
    items: outline.items.map((item) => ({
      outline_item_id: item.outline_item_id,
      title: item.title,
      summary: item.summary,
      layout: item.layout ?? null,
      source_ids: item.source_ids,
      column_right: item.column_right ?? null,
      image_asset_id: item.image_asset_id ?? null,
      speaker_notes: item.speaker_notes ?? null,
    })),
  };
}

function isOutlineReadyForAutoSave(outline: Outline | null): boolean {
  if (!outline || outline.items.length === 0) return false;
  for (const item of outline.items) {
    if (!item.title.trim() || !item.summary.trim()) return false;
    if (
      item.layout === "two_column" &&
      !(item.column_right && item.column_right.trim())
    ) {
      return false;
    }
    if (
      item.layout === "text_image" &&
      !(item.image_asset_id && item.image_asset_id.trim())
    ) {
      return false;
    }
  }
  return true;
}

export default function ProjectWorkspacePage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const pid = useMemo(() => {
    const seg = pathname?.split("/").filter(Boolean)[1];
    return seg && seg !== "__placeholder__"
      ? decodeURIComponent(seg)
      : params.id;
  }, [pathname, params.id]);

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sourceFragments, setSourceFragments] = useState<SourceFragment[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>(FALLBACK_THEMES);
  const [selectedThemeId, setSelectedThemeId] = useState("keynote_light");
  const [autoFit, setAutoFit] = useState(true);
  const themeInitializedRef = useRef(false);

  const [outline, setOutline] = useState<Outline | null>(null);
  const [savedOutline, setSavedOutline] = useState<Outline | null>(null);
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState("");
  const [rawError, setRawError] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [toast, setToast] = useState("");

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const flashToast = useCallback((text: string, durationMs = 2800) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), durationMs);
  }, []);

  useEffect(() => {
    api<{ themes: ThemeOption[] }>("/api/themes")
      .then((res) => {
        if (res.themes?.length) setThemes(res.themes);
      })
      .catch(() => {});
  }, []);

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
      }
    },
    [pid]
  );

  const refresh = useCallback(async () => {
    try {
      const data = await api<Project>(`/api/projects/${pid}`);
      setProject(data);
      if (!themeInitializedRef.current) {
        const initialTheme = data.theme_id || data.latest_template_id;
        if (initialTheme && initialTheme !== "default") {
          setSelectedThemeId(initialTheme);
        }
        if (typeof data.latest_auto_fit === "boolean") {
          setAutoFit(data.latest_auto_fit);
        }
        themeInitializedRef.current = true;
      }

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
      return null;
    }
  }, [pid, showOutline, loadPreview]);

  const reportTask = useCallback(
    (task: Task) => {
      if (task.status === "failed") {
        setRawError(
          task.error || `任务 ${task.task_id} 失败 (${task.step || "未知步骤"})`
        );
        setIssues(
          task.result?.export?.issues ?? task.result?.validation?.issues ?? []
        );
        setStatus("");
      } else if (task.status === "succeeded") {
        setRawError(null);
        setIssues([]);
        setStatus("");
        flashToast(
          task.kind === "outline"
            ? "大纲提炼完成"
            : "PPTX 已编译完成，可随时下载或全屏放映"
        );
      } else {
        setStatus(task.step || "正在处理…");
      }
    },
    [flashToast]
  );

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
        setStatus(task.step || "正在处理…");
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
    return () => {
      stopPolling();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [pid, refresh, startPolling]);

  const isStale = useMemo(() => {
    if (!outline || !savedOutline) return false;
    return JSON.stringify(outline.items) !== JSON.stringify(savedOutline.items);
  }, [outline, savedOutline]);

  const activeTheme = useMemo(
    () =>
      themes.find((t) => t.id === selectedThemeId) ||
      themes[0] ||
      FALLBACK_THEMES[0],
    [themes, selectedThemeId]
  );

  const issueSlideIndices = useMemo(
    () => extractIssueSlideIndices(issues),
    [issues]
  );

  const currentSlideIssues = useMemo(() => {
    const targetTag = `slide-${String(selectedIndex + 1).padStart(3, "0")}`;
    return issues.filter(
      (iss) =>
        iss.slide_id === targetTag ||
        iss.message.toLowerCase().includes(targetTag)
    );
  }, [issues, selectedIndex]);

  const humanizedError = useMemo(() => {
    if (!rawError) return null;
    if (
      rawError.includes("没有保存任何大纲") ||
      rawError.includes("暂无可用素材") ||
      rawError.includes("未检测到有效素材")
    ) {
      return "大纲提炼未完成：请确认已上传有效的 Markdown/TXT 笔记或图片材料。";
    }
    if (rawError.includes("requires non-empty column_right")) {
      return "双栏对比页缺少右栏内容，请先填写后再保存或导出。";
    }
    if (rawError.includes("requires an image_asset_id")) {
      return "左文右图页尚未选择配图，请先在右侧选择已上传的图片。";
    }
    if (rawError.includes("empty title") || rawError.includes("empty summary")) {
      return "每一页都必须包含非空的标题和正文说明。";
    }
    if (rawError.includes("MISSING_IMAGE")) {
      return "图文页引用的图片素材不存在，请重新选择配图。";
    }
    if (
      rawError.includes("排版检查未通过") ||
      rawError.includes("OVERFLOW") ||
      rawError.includes("溢出")
    ) {
      return "部分页面文字超出安全版面，请精简文字或开启「自动缩字」后重试。";
    }
    if (rawError.includes("LibreOffice")) {
      return "LibreOffice 渲染失败，已生成的 PPTX 文件仍可直接下载。";
    }
    return rawError;
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
    setStatus("正在上传素材…");
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
      flashToast(`已上传 ${files.length} 份素材`);
      await refresh();
      setStatus("");
    } catch (e) {
      setRawError((e as Error).message);
      setStatus("");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function uploadPastedNote(rawTitle: string, content: string) {
    const cleaned = content.trim();
    if (!cleaned) return;
    const baseName =
      rawTitle
        .trim()
        .replace(/[\\/:*?"<>|\s]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32) ||
      `笔记_${materials.filter((m) => m.asset_type !== "image").length + 1}`;
    const file = new File([cleaned], `${baseName}.md`, {
      type: "text/markdown;charset=utf-8",
    });
    await uploadFiles([file]);
  }

  async function deleteMaterial(assetId: string) {
    setRawError(null);
    try {
      await api(
        `/api/projects/${pid}/materials/${encodeURIComponent(assetId)}`,
        { method: "DELETE" }
      );
      flashToast(`已删除素材「${assetId}」`);
      await refresh();
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function renameProject(newName: string) {
    const clean = newName.trim();
    if (!clean) return;
    try {
      await api(`/api/projects/${pid}`, jsonOptions("PATCH", { name: clean }));
      setProject((prev) => (prev ? { ...prev, name: clean } : prev));
      flashToast("已更新文稿名称");
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function genOutline(userPrompt?: string) {
    if (materials.length === 0 && !(userPrompt && userPrompt.trim())) {
      setRawError("请先上传素材文件、粘贴笔记，或输入一句话主题要求。");
      return;
    }
    setRawError(null);
    setIsGenerating(true);
    setStatus("正在解析材料并提炼大纲…");
    try {
      const task = await api<Task>(
        `/api/projects/${pid}/outline/generate`,
        userPrompt && userPrompt.trim()
          ? jsonOptions("POST", { prompt: userPrompt.trim() })
          : { method: "POST" }
      );
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setStatus("");
      setRawError((e as Error).message);
    }
  }

  const saveOutline = useCallback(
    async (silent = false) => {
      if (!outline) return;
      setRawError(null);
      setIsSaving(true);
      try {
        const updated = await api<Outline>(
          `/api/projects/${pid}/outlines/${outline.outline_version}`,
          jsonOptions("PUT", buildOutlineEditPayload(outline))
        );
        setOutline(updated);
        setSavedOutline(JSON.parse(JSON.stringify(updated)));
        setVersion(updated.outline_version);
        if (!silent) {
          flashToast(
            updated.outline_version !== outline.outline_version
              ? `已派生新草稿 ${updated.outline_version}`
              : "已保存修改"
          );
        }
        const proj = await api<Project>(`/api/projects/${pid}`);
        setProject(proj);
      } catch (e) {
        if (!silent) {
          setRawError((e as Error).message);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [outline, pid, flashToast]
  );

  // 1.2s debounced auto-save when edits are valid (PRD F-01)
  useEffect(() => {
    if (
      !isStale ||
      isGenerating ||
      isSaving ||
      !isOutlineReadyForAutoSave(outline)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void saveOutline(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [outline, isStale, isGenerating, isSaving, saveOutline]);

  async function confirmGenerate() {
    if (!version || !outline) return;
    setRawError(null);
    setIsGenerating(true);
    setStatus("正在确认大纲并编译 PPTX…");
    let derivedNewDraft = false;
    try {
      let targetVersion = version;
      if (isStale) {
        const saved = await api<Outline>(
          `/api/projects/${pid}/outlines/${version}`,
          jsonOptions("PUT", buildOutlineEditPayload(outline))
        );
        derivedNewDraft = saved.outline_version !== version;
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
        jsonOptions("POST", {
          outline_version: targetVersion,
          template_id: selectedThemeId,
          auto_fit: autoFit,
        })
      );
      startPolling(task.task_id);
    } catch (e) {
      setIsGenerating(false);
      setStatus("");
      setRawError((e as Error).message);
      if (derivedNewDraft) {
        api<Project>(`/api/projects/${pid}`)
          .then(setProject)
          .catch(() => {});
      }
    }
  }

  // ── Outline Editing Helpers (Functional Updates) ──────────────────────────

  function patchItem(
    index: number,
    patch: Partial<Record<EditableOutlineField, string>>
  ) {
    setOutline((prev) => {
      if (!prev || !prev.items[index]) return prev;
      const items = [...prev.items];
      items[index] = { ...items[index], ...patch };
      return { ...prev, items };
    });
  }

  function handleSelectLayout(nextLayout: OutlineLayout) {
    const item = outline?.items[selectedIndex];
    if (!item) return;
    const patch: Partial<Record<EditableOutlineField, string>> = {
      layout: nextLayout,
    };
    if (nextLayout === "text_image" && !item.image_asset_id) {
      const firstImage = materials.find((m) => m.asset_type === "image");
      if (firstImage) patch.image_asset_id = firstImage.asset_id;
    }
    patchItem(selectedIndex, patch);
  }

  function toggleSourceId(index: number, sourceId: string) {
    setOutline((prev) => {
      if (!prev || !prev.items[index]) return prev;
      const items = [...prev.items];
      const item = items[index];
      const exists = item.source_ids.includes(sourceId);
      const nextIds = exists
        ? item.source_ids.filter((id) => id !== sourceId)
        : [...item.source_ids, sourceId];
      items[index] = {
        ...item,
        source_ids: nextIds,
        evidence_status:
          nextIds.length > 0
            ? item.evidence_status === "unsupported"
              ? "supported"
              : item.evidence_status
            : "unsupported",
      };
      return { ...prev, items };
    });
  }

  function applyImageToSlide(
    index: number,
    imageAssetId: string,
    sourceId?: string
  ) {
    setOutline((prev) => {
      if (!prev || !prev.items[index]) return prev;
      const items = [...prev.items];
      const item = items[index];
      const nextIds =
        sourceId && !item.source_ids.includes(sourceId)
          ? [...item.source_ids, sourceId]
          : item.source_ids;
      items[index] = {
        ...item,
        layout: "text_image",
        image_asset_id: imageAssetId,
        source_ids: nextIds,
        evidence_status:
          nextIds.length > 0 && item.evidence_status === "unsupported"
            ? "supported"
            : item.evidence_status,
      };
      return { ...prev, items };
    });
    flashToast("已切换为图文并茂版式并应用配图");
  }

  function insertExcerptToSlide(
    index: number,
    sourceId: string,
    text: string
  ) {
    const cleaned = text.trim();
    if (!cleaned) return;
    setOutline((prev) => {
      if (!prev || !prev.items[index]) return prev;
      const items = [...prev.items];
      const item = items[index];
      const nextIds = item.source_ids.includes(sourceId)
        ? item.source_ids
        : [...item.source_ids, sourceId];
      const currentSummary = item.summary.trim();
      const isPlaceholder =
        !currentSummary || currentSummary === "输入本页的核心陈述内容…";
      items[index] = {
        ...item,
        summary: isPlaceholder ? cleaned : `${currentSummary}\n${cleaned}`,
        source_ids: nextIds,
        evidence_status:
          item.evidence_status === "unsupported"
            ? "supported"
            : item.evidence_status,
      };
      return { ...prev, items };
    });
    flashToast("已填入当前幻灯片并关联素材出处");
  }

  function splitTwoColumn(index: number) {
    setOutline((prev) => {
      if (!prev || !prev.items[index]) return prev;
      const items = [...prev.items];
      const item = items[index];
      const raw = item.summary.trim();
      if (!raw) return prev;
      let lines = raw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length < 2) {
        lines = raw
          .split(/(?<=[。；;！!？?])/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (lines.length < 2) return prev;
      const mid = Math.ceil(lines.length / 2);
      const leftText = lines.slice(0, mid).join("\n");
      const rightText = lines.slice(mid).join("\n");
      const existingRight = (item.column_right || "").trim();
      items[index] = {
        ...item,
        summary: leftText,
        column_right: existingRight
          ? `${existingRight}\n${rightText}`
          : rightText,
      };
      return { ...prev, items };
    });
  }

  async function refineSlideItem(
    index: number,
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ): Promise<SlideRefineCandidate | null> {
    if (!outline || !outline.items[index] || !version) return null;
    const item = outline.items[index];
    setRawError(null);
    try {
      return await api<SlideRefineCandidate>(
        `/api/projects/${pid}/outlines/${version}/items/${encodeURIComponent(
          item.outline_item_id
        )}/refine`,
        jsonOptions("POST", {
          title: item.title,
          summary: item.summary,
          column_right: item.column_right ?? null,
          layout: item.layout ?? null,
          source_ids: item.source_ids,
          mode,
          instruction: instruction ?? null,
        })
      );
    } catch (e) {
      setRawError((e as Error).message);
      return null;
    }
  }

  function applyRefineCandidate(
    index: number,
    candidate: SlideRefineCandidate
  ) {
    setOutline((prev) => {
      if (!prev || !prev.items[index]) return prev;
      const items = [...prev.items];
      const item = items[index];
      items[index] = {
        ...item,
        title: candidate.title || item.title,
        summary: candidate.summary || item.summary,
        column_right:
          candidate.column_right !== undefined
            ? candidate.column_right
            : item.column_right,
        layout: (candidate.layout as OutlineLayout) || item.layout,
      };
      return { ...prev, items };
    });
    flashToast("已应用 AI 修改建议");
  }

  function moveItem(index: number, delta: number) {
    setOutline((prev) => {
      if (!prev) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.items.length) return prev;
      const items = [...prev.items];
      const [moved] = items.splice(index, 1);
      items.splice(target, 0, moved);
      return { ...prev, items };
    });
    setSelectedIndex((prevIdx) => {
      if (!outline) return prevIdx;
      const target = index + delta;
      return target >= 0 && target < outline.items.length ? target : prevIdx;
    });
  }

  function addItem() {
    setOutline((prev) => {
      if (!prev) return prev;
      const items = [
        ...prev.items,
        {
          outline_item_id: `slide-${Date.now().toString(36)}`,
          title: "新幻灯片标题",
          summary: "输入本页的核心陈述内容…",
          source_ids: [],
          evidence_status: "unsupported",
          layout: "content",
          column_right: null,
          image_asset_id: null,
          speaker_notes: null,
        },
      ];
      setSelectedIndex(items.length - 1);
      return { ...prev, items };
    });
  }

  function deleteItem(index: number) {
    setOutline((prev) => {
      if (!prev || prev.items.length <= 1) return prev;
      const items = prev.items.filter((_, i) => i !== index);
      setSelectedIndex(Math.max(0, Math.min(index, items.length - 1)));
      return { ...prev, items };
    });
  }

  function focusInspectorField(fieldId: string) {
    if (!rightOpen) setRightOpen(true);
    setTimeout(() => {
      document.getElementById(fieldId)?.focus();
    }, 25);
  }

  // Keyboard shortcuts: ↑ / ↓ switch slide, Ctrl/⌘ + S save outline
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isStale) void saveOutline();
        return;
      }
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || !outline?.items.length) {
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(outline.items.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [outline, isStale, saveOutline]);

  const currentItem = outline?.items[selectedIndex];

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-canvas text-ink">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.pdf,.docx,.png,.jpg,.jpeg"
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
        isSaving={isSaving}
        isGenerating={isGenerating}
        currentStage={currentStage}
        selectedThemeId={selectedThemeId}
        autoFit={autoFit}
        showMaterialsDrawer={showMaterialsDrawer}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onToggleMaterialsDrawer={() => setShowMaterialsDrawer((v) => !v)}
        onSelectVersion={(v) => void showOutline(v)}
        onSaveOutline={() => void saveOutline(false)}
        onRenameProject={renameProject}
        onUploadClick={() => fileInputRef.current?.click()}
        onGenerateOutline={() => void genOutline()}
        onConfirmGenerate={() => void confirmGenerate()}
      />

      {showMaterialsDrawer && (
        <MaterialsDrawer
          pid={pid}
          materials={materials}
          sourceFragments={sourceFragments}
          outline={outline}
          currentSlide={currentItem}
          currentSlideIndex={selectedIndex}
          isGenerating={isGenerating}
          onUploadClick={() => fileInputRef.current?.click()}
          onDropFiles={(files) => void uploadFiles(files)}
          onPasteNote={uploadPastedNote}
          onDeleteMaterial={deleteMaterial}
          onToggleSourceId={(sid) => toggleSourceId(selectedIndex, sid)}
          onInsertExcerptToSlide={(sid, text) =>
            insertExcerptToSlide(selectedIndex, sid, text)
          }
          onApplyImageToSlide={(imgId, sid) =>
            applyImageToSlide(selectedIndex, imgId, sid)
          }
          onGenerateOutline={(p) => void genOutline(p)}
          onClose={() => setShowMaterialsDrawer(false)}
        />
      )}

      {/* Calm Floating Toast */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full apple-glass dock-shadow text-[13px] font-medium text-ink whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Quiet Inline Error Strip (Apple-restrained, dismissible, expandable tech log) */}
      {humanizedError && (
        <div className="border-b border-danger/20 bg-danger-bg px-5 py-2.5 text-[13px] text-danger shrink-0">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
              <span className="font-medium truncate">{humanizedError}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-[13px]">
              {rawError && rawError !== humanizedError && (
                <button
                  type="button"
                  onClick={() => setShowErrorDetail((v) => !v)}
                  className="text-danger/80 hover:text-danger underline cursor-pointer"
                >
                  {showErrorDetail ? "收起详情" : "详情"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRawError(null);
                  setShowErrorDetail(false);
                }}
                className="text-danger/70 hover:text-danger cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
          {showErrorDetail && rawError && (
            <pre className="max-w-6xl mx-auto mt-2 p-2.5 rounded-xl bg-surface/80 text-[13px] font-mono text-danger whitespace-pre-wrap overflow-x-auto">
              {rawError}
            </pre>
          )}
        </div>
      )}

      {/* Main Content: Either Empty Onboarding OR 3-Column Keynote Studio */}
      {outline && outline.items.length > 0 && currentItem ? (
        <section className="flex-1 min-h-0 flex items-stretch overflow-hidden">
          {leftOpen && (
            <SlideNavigator
              pid={pid}
              outline={outline}
              selectedIndex={selectedIndex}
              activeTheme={activeTheme}
              issueSlideIndices={issueSlideIndices}
              onSelectIndex={setSelectedIndex}
              onMoveItem={moveItem}
              onDeleteItem={deleteItem}
              onAddItem={addItem}
            />
          )}

          <SlideStageCanvas
            pid={pid}
            project={project}
            outline={outline}
            version={version}
            isStale={isStale}
            selectedIndex={selectedIndex}
            preview={preview}
            report={report}
            issues={issues}
            issueSlideIndices={issueSlideIndices}
            themes={themes}
            activeTheme={activeTheme}
            selectedThemeId={selectedThemeId}
            autoFit={autoFit}
            statusText={status}
            isGenerating={isGenerating}
            onSelectIndex={setSelectedIndex}
            onSelectTheme={(themeId) => {
              setSelectedThemeId(themeId);
              void api(
                `/api/projects/${pid}`,
                jsonOptions("PATCH", { theme_id: themeId })
              ).catch(() => {});
            }}
            onSelectLayout={handleSelectLayout}
            onToggleAutoFit={() => setAutoFit((v) => !v)}
            onFocusField={focusInspectorField}
          />

          {rightOpen && (
            <SlideInspector
              pid={pid}
              item={currentItem}
              slideIndex={selectedIndex}
              totalSlides={outline.items.length}
              materials={materials}
              sourceFragments={sourceFragments}
              slideIssues={currentSlideIssues}
              onUpdateField={(field, val) =>
                patchItem(selectedIndex, { [field]: val })
              }
              onToggleSourceId={(sid) => toggleSourceId(selectedIndex, sid)}
              onApplyImageToSlide={(imgId, sid) =>
                applyImageToSlide(selectedIndex, imgId, sid)
              }
              onSplitTwoColumn={() => splitTwoColumn(selectedIndex)}
              onRefineSlide={(mode, inst) =>
                refineSlideItem(selectedIndex, mode, inst)
              }
              onApplyRefineCandidate={(cand) =>
                applyRefineCandidate(selectedIndex, cand)
              }
              onUploadClick={() => fileInputRef.current?.click()}
            />
          )}
        </section>
      ) : (
        <EmptyStageOnboarding
          materials={materials}
          isGenerating={isGenerating}
          onUploadClick={() => fileInputRef.current?.click()}
          onDropFiles={(files) => void uploadFiles(files)}
          onPasteNote={uploadPastedNote}
          onGenerateOutline={(p) => void genOutline(p)}
        />
      )}
    </div>
  );
}
