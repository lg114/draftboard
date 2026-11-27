import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  api,
  ExportReport,
  GenerationSync,
  Issue,
  jsonOptions,
  LLMSettingsResponse,
  Material,
  Outline,
  Preview,
  Project,
  Task,
} from "../../lib/api";
import { buildOutlineEditPayload } from "./outlineHelpers";
import type { FlashToastFn } from "./useOutlineEditor";

interface UseGenerationTaskParams {
  pid: string;
  getTargetPid: () => string;
  ensureProjectId: () => Promise<string>;
  project: Project | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  materials: Material[];
  outline: Outline | null;
  version: string;
  isStale: boolean;
  selectedThemeId: string;
  autoFit: boolean;
  llmSettings: LLMSettingsResponse | null;
  applySavedOutlineSnapshot: (saved: Outline) => void;
  showOutline: (v: string, overridePid?: string) => Promise<void>;
  refreshRef: MutableRefObject<(overridePid?: string) => Promise<Project | null>>;
  onRequireLLMConfig: (reason: string, pendingPrompt?: string) => void;
  isGenerating: boolean;
  setIsGenerating: Dispatch<SetStateAction<boolean>>;
  setRawError: (err: string | null) => void;
  flashToast: FlashToastFn;
}

export function useGenerationTask({
  pid,
  getTargetPid,
  ensureProjectId,
  project,
  setProject,
  materials,
  outline,
  version,
  isStale,
  selectedThemeId,
  autoFit,
  llmSettings,
  applySavedOutlineSnapshot,
  showOutline,
  refreshRef,
  onRequireLLMConfig,
  isGenerating,
  setIsGenerating,
  setRawError,
  flashToast,
}: UseGenerationTaskParams) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [status, setStatus] = useState("");
  const [generationSync, setGenerationSync] = useState<GenerationSync | null>(
    null
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const resetGenerationState = useCallback(() => {
    stopPolling();
    setPreview(null);
    setReport(null);
    setIssues([]);
    setStatus("");
    setIsGenerating(false);
    setGenerationSync(null);
  }, [stopPolling]);

  const loadPreview = useCallback(
    async (overridePid?: string) => {
      const targetPid = overridePid ?? getTargetPid();
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
    [getTargetPid]
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
            : "PPTX 已编译完成，可随时下载或预览"
        );
      } else {
        setStatus(task.step || "正在处理…");
      }
    },
    [flashToast, setRawError]
  );

  const startPolling = useCallback(
    (taskId: string, overridePid?: string) => {
      const targetPid = overridePid ?? getTargetPid();
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
          const data = await refreshRef.current(targetPid);
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
    [getTargetPid, stopPolling, reportTask, refreshRef, showOutline, loadPreview]
  );

  // Sync export fingerprint whenever frozen generation inputs change
  useEffect(() => {
    const targetPid = getTargetPid();
    if (!targetPid || targetPid === "new" || !version) {
      setGenerationSync(null);
      return;
    }
    let cancelled = false;
    setGenerationSync(null);
    const params = new URLSearchParams({
      outline_version: version,
      template_id: selectedThemeId,
      auto_fit: String(autoFit),
    });
    api<GenerationSync>(
      `/api/projects/${encodeURIComponent(targetPid)}/generation-sync?${params}`
    )
      .then((data) => {
        if (!cancelled) setGenerationSync(data);
      })
      .catch(() => {
        if (!cancelled) setGenerationSync(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    pid,
    getTargetPid,
    version,
    selectedThemeId,
    autoFit,
    project?.brand,
    project?.export_fingerprint,
    materials,
  ]);

  const exportInSync =
    !isStale &&
    generationSync?.in_sync === true &&
    Boolean(generationSync.current_fingerprint) &&
    generationSync.current_fingerprint === generationSync.export_fingerprint;

  const genOutline = useCallback(
    async (userPrompt?: string, skipConfigGuard = false) => {
      if (materials.length === 0 && !(userPrompt && userPrompt.trim())) {
        setRawError("请先上传素材文件、粘贴笔记，或输入一句话主题要求。");
        return;
      }
      if (!skipConfigGuard && llmSettings && !llmSettings.configured) {
        onRequireLLMConfig(
          "请先配置大模型，保存并启用后将自动继续生成大纲。",
          userPrompt
        );
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
          onRequireLLMConfig(
            "请先配置大模型，保存并启用后将自动继续生成大纲。",
            userPrompt
          );
          return;
        }
        setRawError(msg);
      }
    },
    [
      materials.length,
      llmSettings,
      onRequireLLMConfig,
      setRawError,
      ensureProjectId,
      startPolling,
    ]
  );

  const confirmGenerate = useCallback(async () => {
    const targetPid = getTargetPid();
    if (!version || !outline || !targetPid || targetPid === "new") return;
    setRawError(null);
    setIsGenerating(true);
    setStatus("正在确认大纲并编译 PPTX…");
    let derivedNewDraft = false;
    try {
      let targetVersion = version;
      if (isStale) {
        const saved = await api<Outline>(
          `/api/projects/${targetPid}/outlines/${version}`,
          jsonOptions("PUT", buildOutlineEditPayload(outline))
        );
        derivedNewDraft = saved.outline_version !== version;
        applySavedOutlineSnapshot(saved);
        targetVersion = saved.outline_version;
      }
      await api(
        `/api/projects/${targetPid}/outlines/${targetVersion}/confirm`,
        { method: "POST" }
      );
      const task = await api<Task>(
        `/api/projects/${targetPid}/generate`,
        jsonOptions("POST", {
          outline_version: targetVersion,
          template_id: selectedThemeId,
          auto_fit: autoFit,
        })
      );
      startPolling(task.task_id, targetPid);
    } catch (e) {
      setIsGenerating(false);
      setStatus("");
      setRawError((e as Error).message);
      if (derivedNewDraft) {
        api<Project>(`/api/projects/${targetPid}`)
          .then(setProject)
          .catch(() => {});
      }
    }
  }, [
    getTargetPid,
    version,
    outline,
    isStale,
    selectedThemeId,
    autoFit,
    applySavedOutlineSnapshot,
    startPolling,
    setRawError,
    setProject,
  ]);

  return {
    preview,
    report,
    issues,
    setIssues,
    status,
    setStatus,
    isGenerating,
    generationSync,
    exportInSync,
    stopPolling,
    startPolling,
    loadPreview,
    resetGenerationState,
    genOutline,
    confirmGenerate,
  };
}
