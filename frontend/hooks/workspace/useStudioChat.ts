import { useCallback, useRef, useState } from "react";
import {
  api,
  ChatDeckChanges,
  ChatHistoryResponse,
  ChatMessage,
  ChatToolStep,
  LLMSettingsResponse,
  Outline,
  Project,
} from "../../lib/api";
import { isOutlineReadyForAutoSave } from "./outlineHelpers";
import type { FlashToastFn } from "./useOutlineEditor";

interface UseStudioChatParams {
  getTargetPid: () => string;
  ensureProjectId: () => Promise<string>;
  outline: Outline | null;
  isStale: boolean;
  selectedIndex: number;
  selectedThemeId: string;
  autoFit: boolean;
  llmSettings: LLMSettingsResponse | null;
  saveOutline: (silent?: boolean) => Promise<string | null>;
  refresh: (overridePid?: string) => Promise<Project | null>;
  showOutline: (v: string, overridePid?: string) => Promise<void>;
  loadPreview: (overridePid?: string) => Promise<void>;
  onThemeChanged: (themeId: string) => void;
  onAutoFitChanged: (autoFit: boolean) => void;
  onRequireLLMConfig: (reason: string) => void;
  onTransitionToStudioChat: () => void;
  isChatStreaming?: boolean;
  setIsChatStreaming?: (v: boolean) => void;
  setRawError: (err: string | null) => void;
  flashToast: FlashToastFn;
}

export function useStudioChat({
  getTargetPid,
  ensureProjectId,
  outline,
  isStale,
  selectedIndex,
  selectedThemeId,
  autoFit,
  llmSettings,
  saveOutline,
  refresh,
  showOutline,
  loadPreview,
  onThemeChanged,
  onAutoFitChanged,
  onRequireLLMConfig,
  onTransitionToStudioChat,
  isChatStreaming: externalStreaming,
  setIsChatStreaming: setExternalStreaming,
  setRawError,
  flashToast,
}: UseStudioChatParams) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [internalStreaming, setInternalStreaming] = useState(false);
  const isChatStreaming = externalStreaming ?? internalStreaming;
  const setIsChatStreaming = setExternalStreaming ?? setInternalStreaming;
  const chatAbortRef = useRef<AbortController | null>(null);

  const loadChatHistory = useCallback(async (projectId: string) => {
    try {
      const hist = await api<ChatHistoryResponse>(
        `/api/projects/${projectId}/chat`
      );
      setChatMessages(hist.messages || []);
    } catch {
      setChatMessages([]);
    }
  }, []);

  const abortChat = useCallback(() => {
    chatAbortRef.current?.abort();
  }, []);

  const resetChatState = useCallback(() => {
    chatAbortRef.current?.abort();
    setChatMessages([]);
  }, []);

  const applyDeckChangesFromChat = useCallback(
    async (
      changes: ChatDeckChanges | null | undefined,
      targetPid: string
    ) => {
      if (!changes) return;
      if (changes.theme_id) {
        onThemeChanged(changes.theme_id);
      }
      if (typeof changes.auto_fit === "boolean") {
        onAutoFitChanged(changes.auto_fit);
      }
      await refresh(targetPid);
      if (changes.after_outline_version) {
        await showOutline(changes.after_outline_version, targetPid);
        if (!outline || outline.items.length === 0) {
          onTransitionToStudioChat();
        }
      }
      if (changes.exported) {
        await loadPreview(targetPid);
        flashToast("Agent 已完成 PPTX 与 PDF 编译，可直接下载或预览");
      }
    },
    [
      onThemeChanged,
      onAutoFitChanged,
      refresh,
      showOutline,
      outline,
      onTransitionToStudioChat,
      loadPreview,
      flashToast,
    ]
  );

  const sendChatMessage = useCallback(
    async (text: string, opts?: { replaceLastError?: boolean }) => {
      const clean = text.trim();
      if (!clean || isChatStreaming) return;
      if (llmSettings && !llmSettings.configured) {
        onRequireLLMConfig("请先配置大模型后再使用 PPT 创作 Agent 对话。");
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
              onRequireLLMConfig("尚未配置大模型，请先完成配置后再继续对话。");
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
                          typeof ev.retryable === "boolean"
                            ? ev.retryable
                            : true,
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
    },
    [
      isChatStreaming,
      llmSettings,
      onRequireLLMConfig,
      isStale,
      outline,
      saveOutline,
      selectedIndex,
      selectedThemeId,
      autoFit,
      ensureProjectId,
      applyDeckChangesFromChat,
    ]
  );

  const retryChatMessage = useCallback(
    (text: string, failedAsstId: string) => {
      if (isChatStreaming) return;
      const curIdx = chatMessages.findIndex((m) => m.id === failedAsstId);
      const isTrailingFailed =
        curIdx >= 0 && curIdx === chatMessages.length - 1;
      setChatMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === failedAsstId);
        if (idx < 0) return prev;
        const dropStart =
          idx > 0 && prev[idx - 1].role === "user" ? idx - 1 : idx;
        return [...prev.slice(0, dropStart), ...prev.slice(idx + 1)];
      });
      void sendChatMessage(text, { replaceLastError: isTrailingFailed });
    },
    [isChatStreaming, chatMessages, sendChatMessage]
  );

  const clearChat = useCallback(async () => {
    const targetPid = getTargetPid();
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
  }, [getTargetPid, flashToast, setRawError]);

  return {
    chatMessages,
    isChatStreaming,
    loadChatHistory,
    sendChatMessage,
    stopChatStreaming: abortChat,
    retryChatMessage,
    clearChat,
    resetChatState,
  };
}
