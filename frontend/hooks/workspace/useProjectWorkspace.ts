import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  BrandKit,
  FALLBACK_THEMES,
  jsonOptions,
  LLMSettingsResponse,
  Material,
  MaterialsResponse,
  Project,
  SourceFragment,
  ThemeOption,
} from "../../lib/api";
import { usePresence } from "../../lib/usePresence";
import {
  extractIssueSlideIndices,
  WorkspaceStage,
} from "../../components/workspace/layoutUtils";
import {
  computeActiveTheme,
  humanizeWorkspaceError,
  isOutlineReadyForAutoSave,
} from "./outlineHelpers";
import { useGenerationTask } from "./useGenerationTask";
import { useOutlineEditor } from "./useOutlineEditor";
import { useStudioChat } from "./useStudioChat";

export interface ToastState {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function useProjectWorkspace() {
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

  const getTargetPid = useCallback(
    () => createdPidRef.current || pid,
    [pid]
  );

  // Core project, materials, theme & settings state
  const [project, setProject] = useState<Project | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sourceFragments, setSourceFragments] = useState<SourceFragment[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>(FALLBACK_THEMES);
  const [selectedThemeId, setSelectedThemeId] = useState("keynote_light");
  const [autoFit, setAutoFit] = useState(true);
  const themeInitializedRef = useRef(false);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  // Toast notifications
  const [toast, setToast] = useState<ToastState | null>(null);
  const lastToastRef = useRef<ToastState | null>(null);
  if (toast) lastToastRef.current = toast;
  const { mounted: toastMounted, exiting: toastExiting } = usePresence(
    Boolean(toast),
    140
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashToast = useCallback(
    (
      text: string,
      durationMs = 2800,
      action?: { label: string; onClick: () => void }
    ) => {
      setToast({
        text,
        actionLabel: action?.label,
        onAction: action?.onClick,
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(
        () => setToast(null),
        action ? Math.max(durationMs, 4200) : durationMs
      );
    },
    []
  );

  // Panel / modal UI state
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"edit" | "chat">("chat");

  // Start with side panels collapsed on narrow windows so the stage stays usable.
  // (Run after mount to keep the statically pre-rendered markup hydration-safe.)
  useEffect(() => {
    const w = window.innerWidth;
    if (w < 1100) setRightOpen(false);
    if (w < 900) setLeftOpen(false);
  }, []);
  const [onboardingChatOpen, setOnboardingChatOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LLMSettingsResponse | null>(
    null
  );
  const [showLLMModal, setShowLLMModal] = useState(false);
  const [llmModalReason, setLlmModalReason] = useState<string | null>(null);
  const [showPreflight, setShowPreflight] = useState(false);
  const [inspectedFragment, setInspectedFragment] =
    useState<SourceFragment | null>(null);
  const [confirmClearChat, setConfirmClearChat] = useState(false);

  const clearChatConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingOutlinePromptRef = useRef<{ prompt?: string } | null>(null);
  const selectedCustomElIdRef = useRef<string | null>(null);

  const handleSelectedCustomElementChange = useCallback(
    (elId: string | null) => {
      selectedCustomElIdRef.current = elId;
    },
    []
  );

  useEffect(() => {
    api<{ themes: ThemeOption[] }>("/api/themes")
      .then((res) => {
        if (res.themes?.length) setThemes(res.themes);
      })
      .catch(() => {});
    api<LLMSettingsResponse>("/api/settings/llm")
      .then(setLlmSettings)
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

  const handleRequireLLMConfig = useCallback(
    (reason: string, pendingPrompt?: string) => {
      if (pendingPrompt !== undefined) {
        pendingOutlinePromptRef.current = { prompt: pendingPrompt };
      }
      setLlmModalReason(reason);
      setShowLLMModal(true);
    },
    []
  );

  // Domain Hook 1: Outline editing, undo/redo, auto-save, custom canvas ops
  const outlineEditor = useOutlineEditor({
    getTargetPid,
    materials,
    selectedIndex,
    setSelectedIndex,
    isGenerating,
    setProject,
    setRawError,
    flashToast,
  });

  // Ref bridge so useGenerationTask can call refresh without circular deps
  const refreshRef = useRef<(overridePid?: string) => Promise<Project | null>>(
    async () => null
  );

  // Domain Hook 2: Background tasks, polling, preview/report, export fingerprint sync
  const generation = useGenerationTask({
    pid,
    getTargetPid,
    ensureProjectId,
    project,
    setProject,
    materials,
    outline: outlineEditor.outline,
    version: outlineEditor.version,
    isStale: outlineEditor.isStale,
    selectedThemeId,
    autoFit,
    llmSettings,
    applySavedOutlineSnapshot: outlineEditor.applySavedOutlineSnapshot,
    showOutline: outlineEditor.showOutline,
    refreshRef,
    onRequireLLMConfig: (reason, pendingPrompt) => {
      pendingOutlinePromptRef.current = { prompt: pendingPrompt };
      setLlmModalReason(reason);
      setShowLLMModal(true);
    },
    isGenerating,
    setIsGenerating,
    setRawError,
    flashToast,
  });

  const refresh = useCallback(
    async (overridePid?: string) => {
      const targetPid = overridePid ?? getTargetPid();
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
          await outlineEditor.showOutline(
            outlines[0].outline_version,
            targetPid
          );
        } else {
          outlineEditor.clearOutlineState();
        }
        if (data.download_available) {
          await generation.loadPreview(targetPid);
        }
        return data;
      } catch (e) {
        setRawError((e as Error).message);
        return null;
      }
    },
    [
      getTargetPid,
      outlineEditor.showOutline,
      outlineEditor.clearOutlineState,
      generation.loadPreview,
    ]
  );
  refreshRef.current = refresh;

  const handleTransitionToStudioChat = useCallback(() => {
    setRightOpen(true);
    setRightPanelTab("chat");
    setOnboardingChatOpen(false);
  }, []);

  // Domain Hook 3: SSE streaming studio agent chat
  const chat = useStudioChat({
    getTargetPid,
    ensureProjectId,
    outline: outlineEditor.outline,
    isStale: outlineEditor.isStale,
    selectedIndex,
    selectedThemeId,
    autoFit,
    llmSettings,
    saveOutline: outlineEditor.saveOutline,
    refresh,
    showOutline: outlineEditor.showOutline,
    loadPreview: generation.loadPreview,
    onThemeChanged: setSelectedThemeId,
    onAutoFitChanged: setAutoFit,
    onRequireLLMConfig: handleRequireLLMConfig,
    onTransitionToStudioChat: handleTransitionToStudioChat,
    setRawError,
    flashToast,
  });

  // Load or reset workspace when navigating between projects
  useEffect(() => {
    if (routePid === "new") {
      generation.resetGenerationState();
      createdPidRef.current = null;
      setCreatedPid(null);
      setDraftName("");
      setProject(null);
      setMaterials([]);
      setSourceFragments([]);
      outlineEditor.clearOutlineState();
      setRawError(null);
      chat.resetChatState();
      setOnboardingChatOpen(false);
      return () => {
        generation.stopPolling();
        chat.stopChatStreaming();
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      };
    }

    (async () => {
      const data = await refresh(routePid);
      if (data) {
        const active = data.tasks.find(
          (t) => t.status === "queued" || t.status === "running"
        );
        if (active) generation.startPolling(active.task_id, routePid);
      }
      await chat.loadChatHistory(routePid);
    })();
    return () => {
      generation.stopPolling();
      chat.stopChatStreaming();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePid]);

  // Derived view models
  const activeTheme = useMemo(
    () => computeActiveTheme(themes, selectedThemeId, project?.brand),
    [themes, selectedThemeId, project?.brand]
  );

  const issueSlideIndices = useMemo(
    () => extractIssueSlideIndices(generation.issues),
    [generation.issues]
  );

  const currentSlideIssues = useMemo(() => {
    const targetTag = `slide-${String(selectedIndex + 1).padStart(3, "0")}`;
    return generation.issues.filter(
      (iss) =>
        iss.slide_id === targetTag ||
        iss.message.toLowerCase().includes(targetTag)
    );
  }, [generation.issues, selectedIndex]);

  const humanizedError = useMemo(
    () => humanizeWorkspaceError(rawError),
    [rawError]
  );

  const currentStage: WorkspaceStage = useMemo(() => {
    if (project?.download_available) return "ppt_ready";
    if (outlineEditor.outline && outlineEditor.outline.items.length > 0)
      return "outline_ready";
    if (materials.length > 0) return "has_materials_no_outline";
    return "no_materials";
  }, [project, outlineEditor.outline, materials]);

  // Project & Material actions
  const uploadFiles = useCallback(
    async (files?: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      setRawError(null);
      generation.setStatus("正在上传素材…");
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
        generation.setStatus("");
      } catch (e) {
        setRawError((e as Error).message);
        generation.setStatus("");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [ensureProjectId, flashToast, refresh, generation.setStatus]
  );

  const uploadPastedNote = useCallback(
    async (rawTitle: string, content: string) => {
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
    },
    [materials, uploadFiles]
  );

  const importUrlMaterial = useCallback(
    async (url: string, title?: string) => {
      setRawError(null);
      generation.setStatus("正在抓取网页正文…");
      try {
        const targetPid = await ensureProjectId();
        const res = await api<{ asset_id: string; title: string }>(
          `/api/projects/${targetPid}/materials/url`,
          jsonOptions("POST", { url, title: title || null })
        );
        flashToast(`已抓取网页素材「${res.title || res.asset_id}」`);
        await refresh(targetPid);
      } finally {
        generation.setStatus("");
      }
    },
    [ensureProjectId, flashToast, refresh, generation.setStatus]
  );

  const deleteMaterial = useCallback(
    async (assetId: string) => {
      const targetPid = getTargetPid();
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
    },
    [getTargetPid, flashToast, refresh]
  );

  const updateBrand = useCallback(
    async (nextBrand: BrandKit) => {
      const targetPid = getTargetPid();
      if (!targetPid || targetPid === "new") return;
      setRawError(null);
      try {
        const res = await api<{ brand?: BrandKit | null }>(
          `/api/projects/${targetPid}/brand`,
          jsonOptions("PATCH", nextBrand)
        );
        setProject((prev) =>
          prev ? { ...prev, brand: res.brand ?? null } : prev
        );
        flashToast(res.brand ? "已应用品牌定制设置" : "已恢复主题默认设置");
      } catch (e) {
        setRawError((e as Error).message);
      }
    },
    [getTargetPid, flashToast]
  );

  const renameProject = useCallback(
    async (newName: string) => {
      const clean = newName.trim();
      if (!clean) return;
      if (isDraftNew && !createdPidRef.current) {
        setDraftName(clean);
        flashToast("已更新文稿名称");
        return;
      }
      const targetPid = getTargetPid();
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
    },
    [isDraftNew, getTargetPid, flashToast]
  );

  const handleSelectTheme = useCallback(
    (themeId: string) => {
      setSelectedThemeId(themeId);
      const targetPid = getTargetPid();
      if (!targetPid || targetPid === "new") return;
      void api(
        `/api/projects/${targetPid}`,
        jsonOptions("PATCH", { theme_id: themeId })
      ).catch(() => {});
    },
    [getTargetPid]
  );

  const handleToggleChat = useCallback(() => {
    setShowMaterialsDrawer(false);
    if (outlineEditor.outline && outlineEditor.outline.items.length > 0) {
      if (rightOpen && rightPanelTab === "chat") {
        setRightPanelTab("edit");
      } else {
        setRightOpen(true);
        setRightPanelTab("chat");
      }
    } else {
      setOnboardingChatOpen((v) => !v);
    }
  }, [outlineEditor.outline, rightOpen, rightPanelTab]);

  const focusInspectorField = useCallback(
    (fieldId: string) => {
      setRightPanelTab("edit");
      if (!rightOpen) setRightOpen(true);
      setTimeout(() => {
        const el = document.getElementById(fieldId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus();
        }
      }, 30);
    },
    [rightOpen]
  );

  const flushOutlineIfReady = useCallback(async () => {
    if (
      outlineEditor.isStale &&
      isOutlineReadyForAutoSave(outlineEditor.outline)
    ) {
      return (await outlineEditor.saveOutline(true)) || undefined;
    }
    return undefined;
  }, [outlineEditor.isStale, outlineEditor.outline, outlineEditor.saveOutline]);

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
  }, [uploadFiles]);

  // Global keyboard shortcuts: Ctrl/⌘+S, Ctrl/⌘+L, Ctrl/⌘+Z/Y, ↑/↓ slide switch
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (outlineEditor.isStale) void outlineEditor.saveOutline();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        handleToggleChat();
        return;
      }
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        !outlineEditor.outline?.items.length
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          outlineEditor.handleRedo();
        } else {
          outlineEditor.handleUndo();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        outlineEditor.handleRedo();
        return;
      }
      if (selectedCustomElIdRef.current) {
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) =>
          Math.min(outlineEditor.outline!.items.length - 1, i + 1)
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    outlineEditor.outline,
    outlineEditor.isStale,
    outlineEditor.saveOutline,
    outlineEditor.handleUndo,
    outlineEditor.handleRedo,
    handleToggleChat,
  ]);

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

  return {
    pid,
    project,
    headerProject,
    materials,
    sourceFragments,
    themes,
    activeTheme,
    selectedThemeId,
    autoFit,
    setAutoFit,
    selectedIndex,
    setSelectedIndex,
    currentStage,
    issueSlideIndices,
    currentSlideIssues,
    rawError,
    setRawError,
    humanizedError,
    showErrorDetail,
    setShowErrorDetail,
    toast,
    setToast,
    lastToastRef,
    toastMounted,
    toastExiting,
    flashToast,
    showMaterialsDrawer,
    setShowMaterialsDrawer,
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    rightPanelTab,
    setRightPanelTab,
    onboardingChatOpen,
    setOnboardingChatOpen,
    llmSettings,
    setLlmSettings,
    showLLMModal,
    setShowLLMModal,
    llmModalReason,
    setLlmModalReason,
    showPreflight,
    setShowPreflight,
    inspectedFragment,
    setInspectedFragment,
    confirmClearChat,
    setConfirmClearChat,
    clearChatConfirmTimerRef,
    fileInputRef,
    pendingOutlinePromptRef,
    handleSelectedCustomElementChange,
    uploadFiles,
    uploadPastedNote,
    importUrlMaterial,
    deleteMaterial,
    updateBrand,
    renameProject,
    handleSelectTheme,
    handleToggleChat,
    focusInspectorField,
    flushOutlineIfReady,
    outlineEditor,
    generation,
    chat,
  };
}
