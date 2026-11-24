"use client";

import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Trash2, X } from "lucide-react";
import {
  api,
  BrandKit,
  CanvasElement,
  ChatDeckChanges,
  ChatHistoryResponse,
  ChatMessage,
  ChatToolStep,
  ExportReport,
  FALLBACK_THEMES,
  Issue,
  jsonOptions,
  LLMSettingsResponse,
  Material,
  MaterialsResponse,
  Outline,
  OutlineLayout,
  Preview,
  Project,
  SavedLayoutPreset,
  SlideRefineCandidate,
  SourceFragment,
  Task,
  ThemeOption,
} from "../../../lib/api";
import { LLMSettingsModal } from "../../../components/LLMSettingsModal";
import { AgentChatPanel } from "../../../components/workspace/AgentChatPanel";
import { EmptyStageOnboarding } from "../../../components/workspace/EmptyStageOnboarding";
import {
  EditableOutlineField,
  extractIssueSlideIndices,
  inferEffectiveLayout,
  LAYOUT_LABELS,
  WorkspaceStage,
} from "../../../components/workspace/layoutUtils";
import { MaterialsDrawer } from "../../../components/workspace/MaterialsDrawer";
import { PreflightModal } from "../../../components/workspace/PreflightModal";
import { SlideInspector } from "../../../components/workspace/SlideInspector";
import { SlideNavigator } from "../../../components/workspace/SlideNavigator";
import { SlideStageCanvas } from "../../../components/workspace/SlideStageCanvas";
import { SourceContextModal } from "../../../components/workspace/SourceContextModal";
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
      custom_bg: item.custom_bg ?? null,
      custom_elements: item.custom_elements ?? null,
    })),
  };
}

function isOutlineReadyForAutoSave(outline: Outline | null): boolean {
  if (!outline || outline.items.length === 0) return false;
  for (const item of outline.items) {
    if (!item.title.trim() || !item.summary.trim()) return false;
    if (item.custom_elements && item.custom_elements.length > 0) {
      continue;
    }
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
  const routePid = useMemo(() => {
    const seg = pathname?.split("/").filter(Boolean)[1];
    return seg && seg !== "__placeholder__"
      ? decodeURIComponent(seg)
      : params.id;
  }, [pathname, params.id]);

  const [createdPid, setCreatedPid] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const createdPidRef = useRef<string | null>(null);
  const createPromiseRef = useRef<Promise<string> | null>(null);

  const pid = routePid === "new" ? createdPid ?? "new" : routePid;
  const isDraftNew = pid === "new";

  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sourceFragments, setSourceFragments] = useState<SourceFragment[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>(FALLBACK_THEMES);
  const [selectedThemeId, setSelectedThemeId] = useState("keynote_light");
  const [autoFit, setAutoFit] = useState(true);
  const themeInitializedRef = useRef(false);

  const [outline, setOutline] = useState<Outline | null>(null);
  const outlineRef = useRef<Outline | null>(null);
  outlineRef.current = outline;
  const [savedOutline, setSavedOutline] = useState<Outline | null>(null);
  const [undoStack, setUndoStack] = useState<Outline[]>([]);
  const [redoStack, setRedoStack] = useState<Outline[]>([]);
  const lastCoalesceRef = useRef<{ key: string; ts: number } | null>(null);
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
  const [rightPanelTab, setRightPanelTab] = useState<"edit" | "chat">("edit");
  const [onboardingChatOpen, setOnboardingChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LLMSettingsResponse | null>(
    null
  );
  const [showLLMModal, setShowLLMModal] = useState(false);
  const [llmModalReason, setLlmModalReason] = useState<string | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [inspectedFragment, setInspectedFragment] =
    useState<SourceFragment | null>(null);
  const [savedLayouts, setSavedLayouts] = useState<SavedLayoutPreset[]>([]);
  const [diffPreviewVersion, setDiffPreviewVersion] = useState<string | null>(
    null
  );
  const [diffPreviewOutline, setDiffPreviewOutline] = useState<Outline | null>(
    null
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const pendingOutlinePromptRef = useRef<{ prompt?: string } | null>(null);

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
    api<LLMSettingsResponse>("/api/settings/llm")
      .then(setLlmSettings)
      .catch(() => {});
    api<{ layouts: SavedLayoutPreset[] }>("/api/layouts/custom")
      .then((res) => setSavedLayouts(res.layouts || []))
      .catch(() => {});
  }, []);

  const ensureProjectId = useCallback(async (): Promise<string> => {
    if (routePid !== "new") return routePid;
    if (createdPidRef.current) return createdPidRef.current;
    if (createPromiseRef.current) return createPromiseRef.current;

    const creating = (async () => {
      const cleanDraftName = draftName.trim();
      const payload = cleanDraftName
        ? { name: cleanDraftName, auto_named: false }
        : {};
      const res = await api<{ project_id: string; name: string }>(
        "/api/projects",
        jsonOptions("POST", payload)
      );
      createdPidRef.current = res.project_id;
      setCreatedPid(res.project_id);
      if (typeof window !== "undefined") {
        window.history.replaceState(
          window.history.state,
          "",
          `/p/${encodeURIComponent(res.project_id)}`
        );
      }
      return res.project_id;
    })();

    createPromiseRef.current = creating;
    try {
      return await creating;
    } finally {
      createPromiseRef.current = null;
    }
  }, [routePid, draftName]);

  const loadPreview = useCallback(
    async (overridePid?: string) => {
      const targetPid = overridePid ?? (createdPidRef.current || pid);
      if (!targetPid || targetPid === "new") return;
      try {
        const p = await api<Preview>(`/api/projects/${targetPid}/preview`);
        setPreview(p);
      } catch {
        setPreview(null);
      }
      try {
        const r = await api<ExportReport>(`/api/projects/${targetPid}/result`);
        setReport(r);
        if (r && !r.success && r.issues?.length) {
          setIssues(r.issues);
        }
      } catch {
        setReport(null);
      }
    },
    [pid]
  );

  const showOutline = useCallback(
    async (v: string, overridePid?: string) => {
      const targetPid = overridePid ?? (createdPidRef.current || pid);
      if (!targetPid || targetPid === "new") return;
      try {
        const data = await api<Outline>(
          `/api/projects/${targetPid}/outlines/${v}`
        );
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

  const refresh = useCallback(
    async (overridePid?: string) => {
      const targetPid = overridePid ?? (createdPidRef.current || pid);
      if (!targetPid || targetPid === "new") return null;
      try {
        const data = await api<Project>(`/api/projects/${targetPid}`);
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

        const mats = await api<MaterialsResponse>(
          `/api/projects/${targetPid}/materials`
        );
        setMaterials(mats.materials || []);
        setSourceFragments(mats.source_fragments || []);

        const outlines = [...data.outlines].sort((a, b) => b.mtime - a.mtime);
        if (outlines.length > 0) {
          await showOutline(outlines[0].outline_version, targetPid);
        } else {
          setOutline(null);
          setSavedOutline(null);
          setVersion("");
        }
        await loadPreview(targetPid);
        return data;
      } catch (e) {
        setRawError((e as Error).message);
        return null;
      }
    },
    [pid, showOutline, loadPreview]
  );

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
    (taskId: string, overridePid?: string) => {
      const targetPid = overridePid ?? (createdPidRef.current || pid);
      if (!targetPid || targetPid === "new") return;
      stopPolling();
      setIsGenerating(true);
      const tick = async () => {
        let task: Task;
        try {
          task = await api<Task>(
            `/api/projects/${targetPid}/tasks/${taskId}`
          );
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
          const data = await refresh(targetPid);
          if (task.status === "succeeded" && task.result?.outline_version) {
            await showOutline(task.result.outline_version, targetPid);
          }
          await loadPreview(targetPid);
          if (data) {
            const active = data.tasks.find(
              (t) => t.status === "queued" || t.status === "running"
            );
            if (active) startPolling(active.task_id, targetPid);
          }
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 1500);
    },
    [pid, refresh, reportTask, showOutline, loadPreview]
  );

  useEffect(() => {
    if (routePid === "new") {
      stopPolling();
      createdPidRef.current = null;
      setCreatedPid(null);
      setDraftName("");
      setProject(null);
      setMaterials([]);
      setSourceFragments([]);
      setOutline(null);
      setSavedOutline(null);
      setUndoStack([]);
      setRedoStack([]);
      setVersion("");
      setPreview(null);
      setReport(null);
      setRawError(null);
      setIssues([]);
      setChatMessages([]);
      setOnboardingChatOpen(false);
      return () => {
        stopPolling();
        chatAbortRef.current?.abort();
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      };
    }

    (async () => {
      const data = await refresh(routePid);
      if (data) {
        const active = data.tasks.find(
          (t) => t.status === "queued" || t.status === "running"
        );
        if (active) startPolling(active.task_id, routePid);
      }
      try {
        const hist = await api<ChatHistoryResponse>(
          `/api/projects/${routePid}/chat`
        );
        setChatMessages(hist.messages || []);
      } catch {
        setChatMessages([]);
      }
    })();
    return () => {
      stopPolling();
      chatAbortRef.current?.abort();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePid]);

  const isStale = useMemo(() => {
    if (!outline || !savedOutline) return false;
    return JSON.stringify(outline.items) !== JSON.stringify(savedOutline.items);
  }, [outline, savedOutline]);

  const activeTheme = useMemo(() => {
    const base =
      themes.find((t) => t.id === selectedThemeId) ||
      themes[0] ||
      FALLBACK_THEMES[0];
    const b = project?.brand;
    if (!b || (!b.accent_hex && !b.bg_hex)) return base;
    const nextPalette = [...(base.chart_palette || [])];
    if (b.accent_hex && nextPalette.length > 0) {
      nextPalette[0] = b.accent_hex;
    }
    return {
      ...base,
      swatches: {
        ...base.swatches,
        accent: b.accent_hex || base.swatches.accent,
        bg: b.bg_hex || base.swatches.bg,
      },
      chart_palette: nextPalette.length > 0 ? nextPalette : base.chart_palette,
    };
  }, [themes, selectedThemeId, project?.brand]);

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
      const targetPid = await ensureProjectId();
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/projects/${targetPid}/materials`, {
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
      await refresh(targetPid);
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

  async function importUrlMaterial(url: string, title?: string) {
    setRawError(null);
    setStatus("正在抓取网页正文…");
    try {
      const targetPid = await ensureProjectId();
      const res = await api<{ asset_id: string; title: string }>(
        `/api/projects/${targetPid}/materials/url`,
        jsonOptions("POST", { url, title: title || null })
      );
      flashToast(`已抓取网页素材「${res.title || res.asset_id}」`);
      await refresh(targetPid);
    } catch (e) {
      setRawError((e as Error).message);
      throw e;
    } finally {
      setStatus("");
    }
  }

  async function updateBrand(nextBrand: BrandKit) {
    const targetPid = createdPidRef.current || pid;
    if (!targetPid || targetPid === "new") return;
    setRawError(null);
    try {
      const res = await api<{ brand?: BrandKit | null }>(
        `/api/projects/${targetPid}/brand`,
        jsonOptions("PATCH", nextBrand)
      );
      setProject((prev) => (prev ? { ...prev, brand: res.brand ?? null } : prev));
      flashToast(res.brand ? "已应用品牌定制设置" : "已恢复主题默认设置");
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function saveCurrentCustomLayout(name: string) {
    const cur = outline?.items[selectedIndex];
    if (!cur?.custom_elements?.length) return;
    try {
      const created = await api<SavedLayoutPreset>(
        "/api/layouts/custom",
        jsonOptions("POST", {
          name,
          custom_bg: cur.custom_bg || "theme:bg",
          elements: cur.custom_elements,
        })
      );
      setSavedLayouts((prev) => [created, ...prev]);
      flashToast(`已收藏常用版式「${created.name}」`);
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  function applySavedLayout(preset: SavedLayoutPreset) {
    mutateOutline((prev) => {
      if (!prev.items[selectedIndex]) return null;
      const items = [...prev.items];
      const cur = items[selectedIndex];
      const clonedEls: CanvasElement[] = JSON.parse(
        JSON.stringify(preset.elements)
      );
      // Map current slide title into the largest text element so structure is reused cleanly
      const textEls = clonedEls.filter((el) => el.kind === "text");
      if (textEls.length > 0 && cur.title.trim()) {
        const largest = textEls.reduce((a, b) =>
          (b.font_size ?? 18) > (a.font_size ?? 18) ? b : a
        );
        largest.text = cur.title;
      }
      items[selectedIndex] = {
        ...cur,
        custom_bg: preset.custom_bg || "theme:bg",
        custom_elements: clonedEls,
      };
      return { ...prev, items };
    });
    flashToast(`已套用常用版式「${preset.name}」`);
  }

  async function deleteSavedLayout(layoutId: string) {
    try {
      await api(`/api/layouts/custom/${encodeURIComponent(layoutId)}`, {
        method: "DELETE",
      });
      setSavedLayouts((prev) => prev.filter((l) => l.id !== layoutId));
      flashToast("已删除收藏版式");
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function toggleDiffPreview(beforeVer: string | null) {
    if (!beforeVer) {
      setDiffPreviewVersion(null);
      setDiffPreviewOutline(null);
      return;
    }
    const targetPid = createdPidRef.current || pid;
    if (!targetPid || targetPid === "new") return;
    try {
      const oldOut = await api<Outline>(
        `/api/projects/${targetPid}/outlines/${encodeURIComponent(beforeVer)}`
      );
      setDiffPreviewVersion(beforeVer);
      setDiffPreviewOutline(oldOut);
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  // Global Ctrl+V clipboard screenshot paste anywhere in workspace
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) {
            const ext = it.type.includes("jpeg") ? "jpg" : "png";
            const d = new Date();
            const stamp = `${String(d.getHours()).padStart(2, "0")}${String(
              d.getMinutes()
            ).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
            imageFiles.push(
              new File([blob], `screenshot_${stamp}.${ext}`, { type: it.type })
            );
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void uploadFiles(imageFiles);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, routePid, draftName]);

  async function deleteMaterial(assetId: string) {
    const targetPid = createdPidRef.current || pid;
    if (!targetPid || targetPid === "new") return;
    setRawError(null);
    try {
      await api(
        `/api/projects/${targetPid}/materials/${encodeURIComponent(assetId)}`,
        { method: "DELETE" }
      );
      flashToast(`已删除素材「${assetId}」`);
      await refresh(targetPid);
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function renameProject(newName: string) {
    const clean = newName.trim();
    if (!clean) return;
    if (isDraftNew && !createdPidRef.current) {
      setDraftName(clean);
      flashToast("已更新文稿名称");
      return;
    }
    const targetPid = createdPidRef.current || pid;
    try {
      await api(
        `/api/projects/${targetPid}`,
        jsonOptions("PATCH", { name: clean })
      );
      setProject((prev) => (prev ? { ...prev, name: clean } : prev));
      flashToast("已更新文稿名称");
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function genOutline(userPrompt?: string, skipConfigGuard = false) {
    if (materials.length === 0 && !(userPrompt && userPrompt.trim())) {
      setRawError("请先上传素材文件、粘贴笔记，或输入一句话主题要求。");
      return;
    }
    if (!skipConfigGuard && llmSettings && !llmSettings.configured) {
      pendingOutlinePromptRef.current = { prompt: userPrompt };
      setLlmModalReason("请先配置大模型，保存并启用后将自动继续生成大纲。");
      setShowLLMModal(true);
      return;
    }
    setRawError(null);
    setIsGenerating(true);
    setStatus("正在解析材料并提炼大纲…");
    try {
      const targetPid = await ensureProjectId();
      const task = await api<Task>(
        `/api/projects/${targetPid}/outline/generate`,
        userPrompt && userPrompt.trim()
          ? jsonOptions("POST", { prompt: userPrompt.trim() })
          : { method: "POST" }
      );
      startPolling(task.task_id, targetPid);
    } catch (e) {
      setIsGenerating(false);
      setStatus("");
      const msg = (e as Error).message || "";
      if (msg.includes("LLM_NOT_CONFIGURED")) {
        pendingOutlinePromptRef.current = { prompt: userPrompt };
        setLlmModalReason("请先配置大模型，保存并启用后将自动继续生成大纲。");
        setShowLLMModal(true);
        return;
      }
      setRawError(msg);
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

  // ── Global Undo / Redo + Outline Editing Helpers ──────────────────────────

  const mutateOutline = useCallback(
    (
      updater: (prev: Outline) => Outline | null,
      opts?: { coalesceKey?: string }
    ) => {
      const prev = outlineRef.current;
      if (!prev) return;
      const next = updater(prev);
      if (!next || next === prev) return;

      const now = Date.now();
      const key = opts?.coalesceKey;
      const lastC = lastCoalesceRef.current;
      const shouldCoalesce =
        Boolean(key) &&
        lastC !== null &&
        lastC.key === key &&
        now - lastC.ts < 700;

      if (!shouldCoalesce) {
        const snap: Outline = JSON.parse(JSON.stringify(prev));
        setUndoStack((stack) => [...stack.slice(-39), snap]);
      }
      setRedoStack([]);
      lastCoalesceRef.current = key ? { key, ts: now } : null;
      outlineRef.current = next;
      setOutline(next);
    },
    []
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || !outline) return;
    const prevSnap = undoStack[undoStack.length - 1];
    const currentSnap: Outline = JSON.parse(JSON.stringify(outline));
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-39), currentSnap]);
    lastCoalesceRef.current = null;
    setOutline(prevSnap);
    setSelectedIndex((idx) =>
      Math.min(idx, Math.max(0, prevSnap.items.length - 1))
    );
    flashToast("已撤销");
  }, [undoStack, outline, flashToast]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0 || !outline) return;
    const nextSnap = redoStack[redoStack.length - 1];
    const currentSnap: Outline = JSON.parse(JSON.stringify(outline));
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-39), currentSnap]);
    lastCoalesceRef.current = null;
    setOutline(nextSnap);
    setSelectedIndex((idx) =>
      Math.min(idx, Math.max(0, nextSnap.items.length - 1))
    );
    flashToast("已重做");
  }, [redoStack, outline, flashToast]);

  function patchItem(
    index: number,
    patch: Partial<Record<EditableOutlineField, string>>
  ) {
    const fieldKey = Object.keys(patch).sort().join(",");
    mutateOutline(
      (prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        items[index] = { ...items[index], ...patch };
        return { ...prev, items };
      },
      { coalesceKey: `patch:${index}:${fieldKey}` }
    );
  }

  function handleSelectLayout(nextLayout: OutlineLayout) {
    const item = outline?.items[selectedIndex];
    if (!item) return;
    const wasCustom = Boolean(
      item.custom_elements && item.custom_elements.length > 0
    );
    const firstImage =
      nextLayout === "text_image" && !item.image_asset_id
        ? materials.find((m) => m.asset_type === "image")
        : undefined;
    mutateOutline((prev) => {
      if (!prev.items[selectedIndex]) return null;
      const items = [...prev.items];
      const cur = items[selectedIndex];
      items[selectedIndex] = {
        ...cur,
        layout: nextLayout,
        image_asset_id: firstImage ? firstImage.asset_id : cur.image_asset_id,
        custom_bg: null,
        custom_elements: null,
      };
      return { ...prev, items };
    });
    if (wasCustom) {
      flashToast(`已恢复为「${LAYOUT_LABELS[nextLayout] || nextLayout}」标准版式`);
    }
  }

  function updateCustomElementText(
    index: number,
    elementId: string,
    nextText: string
  ) {
    mutateOutline(
      (prev) => {
        if (!prev.items[index]) return null;
        const items = [...prev.items];
        const item = items[index];
        const elems = item.custom_elements;
        if (!elems || elems.length === 0) return null;

        const textElems = elems.filter((el) => el.kind === "text");
        let primaryHeadingId: string | null = null;
        let maxFont = -1;
        for (const el of textElems) {
          const fs = el.font_size ?? 18;
          if (fs > maxFont) {
            maxFont = fs;
            primaryHeadingId = el.id;
          }
        }

        const nextElements = elems.map((el) =>
          el.id === elementId ? { ...el, text: nextText } : el
        );
        const firstLine = nextText.trim().split(/\r?\n/)[0]?.trim() || "";
        items[index] = {
          ...item,
          custom_elements: nextElements,
          title:
            elementId === primaryHeadingId && firstLine ? firstLine : item.title,
        };
        return { ...prev, items };
      },
      { coalesceKey: `customText:${index}:${elementId}` }
    );
  }

  function updateCustomElement(
    index: number,
    elementId: string,
    patch: Partial<CanvasElement>
  ) {
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
      const items = [...prev.items];
      const item = items[index];
      const elems = item.custom_elements;
      if (!elems || elems.length === 0) return null;
      const nextElements = elems.map((el) =>
        el.id === elementId ? { ...el, ...patch } : el
      );
      items[index] = { ...item, custom_elements: nextElements };
      return { ...prev, items };
    });
  }

  function deleteCustomElement(index: number, elementId: string) {
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
      const items = [...prev.items];
      const item = items[index];
      const elems = item.custom_elements;
      if (!elems || elems.length === 0) return null;
      const nextElements = elems.filter((el) => el.id !== elementId);
      items[index] = {
        ...item,
        custom_elements: nextElements.length > 0 ? nextElements : null,
        custom_bg: nextElements.length > 0 ? item.custom_bg : null,
      };
      return { ...prev, items };
    });
    flashToast("已删除元素（可按 Ctrl+Z 撤销）");
  }

  function clearCustomLayout(index: number) {
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
      const items = [...prev.items];
      const cur = items[index];
      let nextLayout = cur.layout;
      if (
        nextLayout === "two_column" &&
        !(cur.column_right && cur.column_right.trim())
      ) {
        nextLayout = "content";
      } else if (
        nextLayout === "text_image" &&
        !(cur.image_asset_id && cur.image_asset_id.trim())
      ) {
        nextLayout = "content";
      }
      items[index] = {
        ...cur,
        layout: nextLayout,
        custom_bg: null,
        custom_elements: null,
      };
      return { ...prev, items };
    });
    flashToast("已恢复为标准版式");
  }

  function toggleSourceId(index: number, sourceId: string) {
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
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
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
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
        custom_bg: null,
        custom_elements: null,
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
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
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
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
      const items = [...prev.items];
      const item = items[index];
      const raw = item.summary.trim();
      if (!raw) return null;
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
      if (lines.length < 2) return null;
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
    mutateOutline((prev) => {
      if (!prev.items[index]) return null;
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
    const target = index + delta;
    if (!outline || target < 0 || target >= outline.items.length) return;
    reorderItem(index, target);
  }

  function reorderItem(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    mutateOutline((prev) => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.items.length ||
        toIndex < 0 ||
        toIndex >= prev.items.length
      ) {
        return null;
      }
      const items = [...prev.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { ...prev, items };
    });
    setSelectedIndex((prevIdx) => {
      if (prevIdx === fromIndex) return toIndex;
      if (fromIndex < prevIdx && prevIdx <= toIndex) return prevIdx - 1;
      if (toIndex <= prevIdx && prevIdx < fromIndex) return prevIdx + 1;
      return prevIdx;
    });
  }

  function addItem() {
    mutateOutline((prev) => {
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
    mutateOutline((prev) => {
      if (prev.items.length <= 1) return null;
      const items = prev.items.filter((_, i) => i !== index);
      setSelectedIndex(Math.max(0, Math.min(index, items.length - 1)));
      return { ...prev, items };
    });
  }

  function focusInspectorField(fieldId: string) {
    setRightPanelTab("edit");
    if (!rightOpen) setRightOpen(true);
    setTimeout(() => {
      const el = document.getElementById(fieldId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
    }, 30);
  }

  // ── PPT Studio Agent Chat (SSE Streaming + Live Sync) ────────────────────

  const handleToggleChat = useCallback(() => {
    setShowMaterialsDrawer(false);
    if (outline && outline.items.length > 0) {
      if (rightOpen && rightPanelTab === "chat") {
        setRightPanelTab("edit");
      } else {
        setRightOpen(true);
        setRightPanelTab("chat");
      }
    } else {
      setOnboardingChatOpen((v) => !v);
    }
  }, [outline, rightOpen, rightPanelTab]);

  async function applyDeckChangesFromChat(
    changes: ChatDeckChanges | null | undefined,
    targetPid: string
  ) {
    if (!changes) return;
    if (changes.theme_id) {
      setSelectedThemeId(changes.theme_id);
    }
    if (typeof changes.auto_fit === "boolean") {
      setAutoFit(changes.auto_fit);
    }
    await refresh(targetPid);
    if (changes.after_outline_version) {
      await showOutline(changes.after_outline_version, targetPid);
      if (!outline || outline.items.length === 0) {
        // Transitioned from blank onboarding to live 3-column studio: keep chat open!
        setRightOpen(true);
        setRightPanelTab("chat");
        setOnboardingChatOpen(false);
      }
    }
    if (changes.exported) {
      await loadPreview(targetPid);
      flashToast("Agent 已完成 PPTX 与 PDF 编译，可直接下载或放映");
    }
  }

  async function sendChatMessage(
    text: string,
    opts?: { replaceLastError?: boolean }
  ) {
    const clean = text.trim();
    if (!clean || isChatStreaming) return;
    if (llmSettings && !llmSettings.configured) {
      setLlmModalReason("请先配置大模型后再使用 PPT 创作 Agent 对话。");
      setShowLLMModal(true);
      return;
    }

    // Flush unsaved manual edits first so the Agent reads exact latest canvas state
    if (isStale && isOutlineReadyForAutoSave(outline)) {
      await saveOutline(true);
    }

    const tempUserId = `tmp-u-${Date.now()}`;
    const tempAsstId = `tmp-a-${Date.now()}`;
    const userMsg: ChatMessage = {
      id: tempUserId,
      role: "user",
      content: clean,
      selected_slide: selectedIndex + 1,
    };
    const asstPlaceholder: ChatMessage = {
      id: tempAsstId,
      role: "assistant",
      content: "",
      tool_steps: [],
      changes: null,
    };

    setChatMessages((prev) => [...prev, userMsg, asstPlaceholder]);
    setIsChatStreaming(true);

    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      const targetPid = await ensureProjectId();
      const res = await fetch(`/api/projects/${targetPid}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: clean,
          selected_slide_index: selectedIndex,
          theme_id: selectedThemeId,
          auto_fit: autoFit,
          replace_last_error: Boolean(opts?.replaceLastError),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = res.statusText || "对话请求失败";
        try {
          detail = (await res.json()).detail || detail;
        } catch {}
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const handleEvent = async (ev: Record<string, unknown>) => {
        const type = ev.type as string;
        if (type === "user_saved" && ev.message) {
          const savedUser = ev.message as ChatMessage;
          setChatMessages((prev) =>
            prev.map((m) => (m.id === tempUserId ? savedUser : m))
          );
        } else if (type === "delta") {
          const chunk = String(ev.delta || "");
          if (!chunk) return;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === tempAsstId ? { ...m, content: m.content + chunk } : m
            )
          );
        } else if (type === "tool_start" && ev.step) {
          const step = ev.step as ChatToolStep;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === tempAsstId
                ? { ...m, tool_steps: [...(m.tool_steps || []), step] }
                : m
            )
          );
        } else if (type === "tool_done" && ev.step) {
          const step = ev.step as ChatToolStep;
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === tempAsstId
                ? {
                    ...m,
                    tool_steps: (m.tool_steps || []).map((s) =>
                      s.id === step.id ? step : s
                    ),
                  }
                : m
            )
          );
        } else if (type === "deck_updated") {
          await applyDeckChangesFromChat(
            ev.changes as ChatDeckChanges | null,
            targetPid
          );
        } else if (type === "done" && ev.message) {
          const finalMsg = ev.message as ChatMessage;
          setChatMessages((prev) =>
            prev.map((m) => (m.id === tempAsstId ? finalMsg : m))
          );
          if (ev.changes) {
            await applyDeckChangesFromChat(
              ev.changes as ChatDeckChanges,
              targetPid
            );
          }
        } else if (type === "error") {
          if (ev.code === "LLM_NOT_CONFIGURED") {
            setChatMessages((prev) =>
              prev.filter((m) => m.id !== tempUserId && m.id !== tempAsstId)
            );
            setLlmModalReason("尚未配置大模型，请先完成配置后再继续对话。");
            setShowLLMModal(true);
            return;
          }
          const errMsg = ev.message as ChatMessage | undefined;
          if (errMsg) {
            setChatMessages((prev) =>
              prev.map((m) => (m.id === tempAsstId ? errMsg : m))
            );
            if (errMsg.changes) {
              await applyDeckChangesFromChat(errMsg.changes, targetPid);
            }
          } else {
            setChatMessages((prev) =>
              prev.map((m) =>
                m.id === tempAsstId
                  ? {
                      ...m,
                      content: String(ev.error || "处理请求时发生未知错误"),
                      is_error: true,
                      error_code: String(ev.code || "AGENT_ERROR"),
                      error_detail: ev.error_detail
                        ? String(ev.error_detail)
                        : undefined,
                      retryable:
                        typeof ev.retryable === "boolean" ? ev.retryable : true,
                    }
                  : m
              )
            );
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload) as Record<string, unknown>;
            await handleEvent(parsed);
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === tempAsstId
              ? {
                  ...m,
                  content: m.content
                    ? `${m.content}\n\n（已停止生成）`
                    : "已停止生成。",
                }
              : m
          )
        );
      } else {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === tempAsstId
              ? {
                  ...m,
                  content: `连接 Agent 失败：${(e as Error).message}`,
                  is_error: true,
                }
              : m
          )
        );
      }
    } finally {
      chatAbortRef.current = null;
      setIsChatStreaming(false);
    }
  }

  function stopChatStreaming() {
    chatAbortRef.current?.abort();
  }

  function retryChatMessage(text: string, failedAsstId: string) {
    if (isChatStreaming) return;
    const curIdx = chatMessages.findIndex((m) => m.id === failedAsstId);
    const isTrailingFailed = curIdx >= 0 && curIdx === chatMessages.length - 1;
    setChatMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === failedAsstId);
      if (idx < 0) return prev;
      const dropStart =
        idx > 0 && prev[idx - 1].role === "user" ? idx - 1 : idx;
      return [...prev.slice(0, dropStart), ...prev.slice(idx + 1)];
    });
    void sendChatMessage(text, { replaceLastError: isTrailingFailed });
  }

  async function clearChat() {
    const targetPid = createdPidRef.current || pid;
    if (!targetPid || targetPid === "new") {
      setChatMessages([]);
      return;
    }
    try {
      await api(`/api/projects/${targetPid}/chat`, { method: "DELETE" });
      setChatMessages([]);
      flashToast("已清空本项目对话记录");
    } catch (e) {
      setRawError((e as Error).message);
    }
  }

  async function revertToOutlineVersion(targetVer: string) {
    const targetPid = createdPidRef.current || pid;
    if (!targetPid || targetPid === "new") return;
    await showOutline(targetVer, targetPid);
    flashToast("已撤回到修改前的大纲版本");
  }

  // Keyboard shortcuts: Ctrl/⌘+S save, Ctrl/⌘+L toggle AI chat, Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z / Ctrl+Y redo, ↑ / ↓ switch slide
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (isStale) void saveOutline();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        handleToggleChat();
        return;
      }
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || !outline?.items.length) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
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
  }, [outline, isStale, saveOutline, handleToggleChat, handleUndo, handleRedo]);

  const currentItem = outline?.items[selectedIndex];
  const headerProject: Project | null =
    project ??
    (isDraftNew
      ? {
          project_id: "new",
          name: draftName || "未命名文稿",
          outlines: [],
          generated_outline_version: null,
          latest_report: null,
          download_available: false,
          tasks: [],
        }
      : null);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-canvas text-ink">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.pdf,.docx,.csv,.xlsx,.pptx,.png,.jpg,.jpeg"
        multiple
        onChange={(e) => void uploadFiles(e.target.files)}
        className="hidden"
      />

      <WorkspaceHeader
        pid={pid}
        project={headerProject}
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
        isChatOpen={
          Boolean(outline && outline.items.length > 0)
            ? rightOpen && rightPanelTab === "chat"
            : onboardingChatOpen
        }
        llmConfigured={llmSettings ? llmSettings.configured : true}
        activeModelLabel={
          llmSettings?.active_summary
            ? `${llmSettings.active_summary.name} · ${llmSettings.active_summary.model}`
            : ""
        }
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onToggleChat={handleToggleChat}
        onOpenLLMSettings={() => {
          setLlmModalReason(null);
          setShowLLMModal(true);
        }}
        onOpenPreflight={() => setShowPreflight(true)}
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
          onImportUrl={importUrlMaterial}
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
              <button
                type="button"
                onClick={() => {
                  setLlmModalReason(null);
                  setShowLLMModal(true);
                }}
                className="text-danger font-medium underline underline-offset-2 hover:opacity-80 cursor-pointer"
              >
                检查模型设置
              </button>
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
              onReorderItem={reorderItem}
              onDeleteItem={deleteItem}
              onAddItem={addItem}
            />
          )}

          <SlideStageCanvas
            pid={pid}
            project={project}
            outline={diffPreviewOutline || outline}
            version={version}
            isStale={isStale}
            selectedIndex={Math.min(
              selectedIndex,
              Math.max(0, (diffPreviewOutline || outline).items.length - 1)
            )}
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
            materials={materials}
            brand={project?.brand ?? null}
            diffPreviewActive={Boolean(diffPreviewOutline)}
            onExitDiffPreview={() => void toggleDiffPreview(null)}
            onRevertFromDiff={() => {
              if (diffPreviewVersion) {
                const targetVer = diffPreviewVersion;
                setDiffPreviewVersion(null);
                setDiffPreviewOutline(null);
                void revertToOutlineVersion(targetVer);
              }
            }}
            onUpdateBrand={updateBrand}
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
            onUpdateCustomElement={(elId, patch) =>
              updateCustomElement(selectedIndex, elId, patch)
            }
            onDeleteCustomElement={(elId) =>
              deleteCustomElement(selectedIndex, elId)
            }
          />

          {rightOpen && (
            <aside className="w-[344px] xl:w-[396px] shrink-0 bg-surface-subtle border-l border-black/[0.08] flex flex-col min-h-0">
              {/* Dual-Mode Right Sidebar Top Bar: Edit vs AI Chat */}
              <div className="px-4 py-2.5 border-b border-black/[0.07] bg-surface-subtle flex items-center justify-between gap-2 shrink-0">
                <div className="inline-flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5">
                  <button
                    type="button"
                    onClick={() => setRightPanelTab("edit")}
                    className={`px-3 py-1 rounded-[9px] text-[13px] transition-all cursor-pointer whitespace-nowrap ${
                      rightPanelTab === "edit"
                        ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                        : "text-ink-secondary hover:text-ink font-medium"
                    }`}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanelTab("chat")}
                    className={`px-3 py-1 rounded-[9px] text-[13px] inline-flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                      rightPanelTab === "chat"
                        ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                        : "text-ink-secondary hover:text-ink font-medium"
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI 对话</span>
                  </button>
                </div>

                {rightPanelTab === "edit" ? (
                  <div className="flex items-center gap-2 text-[13px] whitespace-nowrap truncate">
                    <span className="font-semibold text-ink">
                      第 {selectedIndex + 1} 页
                    </span>
                    <span className="text-ink-secondary">
                      {currentItem.custom_elements &&
                      currentItem.custom_elements.length > 0
                        ? "自由画布"
                        : LAYOUT_LABELS[
                            inferEffectiveLayout(
                              currentItem.layout,
                              selectedIndex,
                              outline.items.length
                            )
                          ] || "正文"}
                    </span>
                  </div>
                ) : (
                  chatMessages.length > 0 &&
                  !isChatStreaming && (
                    <button
                      type="button"
                      onClick={() => void clearChat()}
                      title="清空本项目的历史对话"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>清空</span>
                    </button>
                  )
                )}
              </div>

              {rightPanelTab === "chat" ? (
                <AgentChatPanel
                  pid={pid}
                  outline={outline}
                  selectedIndex={selectedIndex}
                  materials={materials}
                  materialsCount={materials.length}
                  themes={themes}
                  selectedThemeId={selectedThemeId}
                  autoFit={autoFit}
                  messages={chatMessages}
                  isStreaming={isChatStreaming}
                  llmConfigured={llmSettings ? llmSettings.configured : true}
                  activeModelLabel={llmSettings?.active_summary?.model || ""}
                  llmSettings={llmSettings}
                  onLLMSettingsUpdated={(next) => {
                    setLlmSettings(next);
                    if (next.active_summary) {
                      flashToast(`已切换模型：${next.active_summary.model}`);
                    }
                  }}
                  diffPreviewVersion={diffPreviewVersion}
                  onToggleDiffPreview={(ver) => void toggleDiffPreview(ver)}
                  onOpenLLMSettings={() => {
                    setLlmModalReason(null);
                    setShowLLMModal(true);
                  }}
                  onSendMessage={(msg) => void sendChatMessage(msg)}
                  onRetryMessage={retryChatMessage}
                  onStopStreaming={stopChatStreaming}
                  onJumpToSlide={setSelectedIndex}
                  onRevertVersion={(v) => void revertToOutlineVersion(v)}
                  onUploadClick={() => fileInputRef.current?.click()}
                  onDropFiles={(files) => void uploadFiles(files)}
                />
              ) : (
                <SlideInspector
                  pid={pid}
                  item={currentItem}
                  slideIndex={selectedIndex}
                  totalSlides={outline.items.length}
                  materials={materials}
                  sourceFragments={sourceFragments}
                  slideIssues={currentSlideIssues}
                  llmConfigured={llmSettings ? llmSettings.configured : true}
                  activeModelLabel={llmSettings?.active_summary?.model || ""}
                  llmSettings={llmSettings}
                  onLLMSettingsUpdated={(next) => {
                    setLlmSettings(next);
                    if (next.active_summary) {
                      flashToast(`已切换模型：${next.active_summary.model}`);
                    }
                  }}
                  onOpenLLMSettings={() => {
                    setLlmModalReason(null);
                    setShowLLMModal(true);
                  }}
                  embedded={true}
                  onUpdateField={(field, val) =>
                    patchItem(selectedIndex, { [field]: val })
                  }
                  onUpdateCustomElementText={(elId, text) =>
                    updateCustomElementText(selectedIndex, elId, text)
                  }
                  onClearCustomLayout={() => clearCustomLayout(selectedIndex)}
                  onSwitchToChat={() => setRightPanelTab("chat")}
                  onInspectFragment={setInspectedFragment}
                  savedLayouts={savedLayouts}
                  onSaveCustomLayout={saveCurrentCustomLayout}
                  onApplySavedLayout={applySavedLayout}
                  onDeleteSavedLayout={deleteSavedLayout}
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
            </aside>
          )}
        </section>
      ) : (
        <div className="flex-1 min-h-0 flex items-stretch overflow-hidden">
          <EmptyStageOnboarding
            materials={materials}
            isGenerating={isGenerating}
            llmConfigured={llmSettings ? llmSettings.configured : true}
            activeModelLabel={llmSettings?.active_summary?.model || ""}
            llmSettings={llmSettings}
            onLLMSettingsUpdated={(next) => {
              setLlmSettings(next);
              if (next.active_summary) {
                flashToast(`已切换模型：${next.active_summary.model}`);
              }
            }}
            onOpenLLMSettings={() => {
              setLlmModalReason(null);
              setShowLLMModal(true);
            }}
            onUploadClick={() => fileInputRef.current?.click()}
            onDropFiles={(files) => void uploadFiles(files)}
            onPasteNote={uploadPastedNote}
            onImportUrl={importUrlMaterial}
            onGenerateOutline={(p) => void genOutline(p)}
          />
          {onboardingChatOpen && (
            <aside className="w-[360px] xl:w-[410px] shrink-0 bg-surface-subtle border-l border-black/[0.08] flex flex-col min-h-0">
              <div className="px-4 py-2.5 border-b border-black/[0.07] bg-surface-subtle flex items-center justify-between gap-2 shrink-0">
                <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                  <Sparkles className="w-4 h-4" />
                  <span>AI 对话</span>
                </span>
                <div className="flex items-center gap-1">
                  {chatMessages.length > 0 && !isChatStreaming && (
                    <button
                      type="button"
                      onClick={() => void clearChat()}
                      title="清空本项目的历史对话"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[13px] text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>清空</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOnboardingChatOpen(false)}
                    aria-label="收起对话面板"
                    className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <AgentChatPanel
                pid={pid}
                outline={null}
                selectedIndex={0}
                materials={materials}
                materialsCount={materials.length}
                themes={themes}
                selectedThemeId={selectedThemeId}
                autoFit={autoFit}
                messages={chatMessages}
                isStreaming={isChatStreaming}
                llmConfigured={llmSettings ? llmSettings.configured : true}
                activeModelLabel={llmSettings?.active_summary?.model || ""}
                llmSettings={llmSettings}
                onLLMSettingsUpdated={(next) => {
                  setLlmSettings(next);
                  if (next.active_summary) {
                    flashToast(`已切换模型：${next.active_summary.model}`);
                  }
                }}
                onOpenLLMSettings={() => {
                  setLlmModalReason(null);
                  setShowLLMModal(true);
                }}
                onSendMessage={(msg) => void sendChatMessage(msg)}
                onRetryMessage={retryChatMessage}
                onStopStreaming={stopChatStreaming}
                onJumpToSlide={setSelectedIndex}
                onRevertVersion={(v) => void revertToOutlineVersion(v)}
                onUploadClick={() => fileInputRef.current?.click()}
                onDropFiles={(files) => void uploadFiles(files)}
              />
            </aside>
          )}
        </div>
      )}

      <SourceContextModal
        fragment={inspectedFragment}
        materials={materials}
        onClose={() => setInspectedFragment(null)}
      />

      <PreflightModal
        open={showPreflight}
        pid={pid}
        version={version}
        themeId={selectedThemeId}
        autoFit={autoFit}
        onJumpToSlide={setSelectedIndex}
        onClose={() => setShowPreflight(false)}
      />

      <LLMSettingsModal
        open={showLLMModal}
        settings={llmSettings}
        reasonBanner={llmModalReason}
        onClose={() => {
          setShowLLMModal(false);
          setLlmModalReason(null);
          pendingOutlinePromptRef.current = null;
        }}
        onSettingsUpdated={(next) => {
          setLlmSettings(next);
          if (next.configured && next.active_summary) {
            flashToast(`已启用模型：${next.active_summary.model}`);
            const pending = pendingOutlinePromptRef.current;
            if (pending) {
              pendingOutlinePromptRef.current = null;
              setLlmModalReason(null);
              void genOutline(pending.prompt, true);
            }
          }
        }}
      />
    </div>
  );
}
