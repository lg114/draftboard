"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import {
  api,
  jsonOptions,
  LLMConnectionTestResponse,
  LLMFetchModelsResponse,
  LLMProfilePublic,
  LLMProviderPreset,
  LLMSettingsResponse,
} from "../lib/api";
import { usePresence } from "../lib/usePresence";
import { ProviderIcon } from "./ProviderIcon";

interface LLMSettingsModalProps {
  open: boolean;
  settings: LLMSettingsResponse | null;
  reasonBanner?: string | null;
  onClose: () => void;
  onSettingsUpdated: (next: LLMSettingsResponse) => void;
}

interface SidebarEntry {
  key: string; // e.g. "preset:gemini", "profile:prof-123", "new-custom"
  provider: string;
  title: string;
  preset: LLMProviderPreset | null;
  profile: LLMProfilePublic | null;
  envBacked: boolean;
  configured: boolean;
  active: boolean;
  activeModel: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function dedupeModels(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const clean = (item || "").trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isLocalProvider(provider: string): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

export function LLMSettingsModal({
  open,
  settings,
  reasonBanner,
  onClose,
  onSettingsUpdated,
}: LLMSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [selectedKey, setSelectedKey] = useState<string>("preset:gemini");
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [editingProxyUrl, setEditingProxyUrl] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelPool, setModelPool] = useState<string[]>([]);

  // Inline model add & remote model fetch states
  const [addingModelOpen, setAddingModelOpen] = useState(false);
  const [newModelInput, setNewModelInput] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[] | null>(null);
  const [fetchedSearch, setFetchedSearch] = useState("");

  // Action states
  const [saving, setSaving] = useState(false);
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] =
    useState<LLMConnectionTestResponse | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const presets = useMemo(() => settings?.presets || [], [settings]);
  const profiles = useMemo(() => settings?.profiles || [], [settings]);
  const envDetected = settings?.env_detected || null;

  // Build unified Provider-First sidebar entries
  const sidebarEntries: SidebarEntry[] = useMemo(() => {
    const entries: SidebarEntry[] = [];
    const consumedProfileIds = new Set<string>();

    for (const preset of presets) {
      if (preset.id === "custom") continue;
      const matchingProfiles = profiles.filter((p) => p.provider === preset.id);
      const primaryProfile = matchingProfiles[0] || null;
      if (primaryProfile) consumedProfileIds.add(primaryProfile.id);

      const envMatches = Boolean(
        envDetected && envDetected.provider === preset.id
      );
      const configured = Boolean(primaryProfile?.usable || envMatches);
      const activeByProfile = Boolean(
        primaryProfile &&
          settings?.source === "profile" &&
          settings.active_profile_id === primaryProfile.id
      );
      const activeByEnv = Boolean(settings?.source === "env" && envMatches);
      const active = activeByProfile || activeByEnv;

      const activeModel = activeByEnv
        ? envDetected?.model || preset.default_model
        : primaryProfile?.model ||
          (envMatches ? envDetected?.model || "" : "") ||
          preset.default_model;

      entries.push({
        key: `preset:${preset.id}`,
        provider: preset.id,
        title: preset.name,
        preset,
        profile: primaryProfile,
        envBacked: envMatches,
        configured,
        active,
        activeModel,
      });

      // Preserve any extra legacy profiles of the same provider so nothing is lost
      for (const extra of matchingProfiles.slice(1)) {
        consumedProfileIds.add(extra.id);
        entries.push({
          key: `profile:${extra.id}`,
          provider: extra.provider,
          title: extra.name,
          preset,
          profile: extra,
          envBacked: false,
          configured: extra.usable,
          active:
            settings?.source === "profile" &&
            settings.active_profile_id === extra.id,
          activeModel: extra.model,
        });
      }
    }

    // Custom gateway from .env (if OPENAI_BASE_URL is an unknown custom host)
    if (envDetected && envDetected.provider === "custom") {
      entries.push({
        key: "env:custom",
        provider: "custom",
        title: envDetected.name || "环境变量默认接口",
        preset: presets.find((p) => p.id === "custom") || null,
        profile: null,
        envBacked: true,
        configured: true,
        active: settings?.source === "env",
        activeModel: envDetected.model,
      });
    }

    // Saved custom profiles
    const customPreset = presets.find((p) => p.id === "custom") || null;
    for (const prof of profiles) {
      if (consumedProfileIds.has(prof.id)) continue;
      entries.push({
        key: `profile:${prof.id}`,
        provider: prof.provider || "custom",
        title: prof.name || "自定义兼容接口",
        preset: customPreset,
        profile: prof,
        envBacked: false,
        configured: prof.usable,
        active:
          settings?.source === "profile" &&
          settings.active_profile_id === prof.id,
        activeModel: prof.model,
      });
    }

    return entries;
  }, [presets, profiles, envDetected, settings]);

  const configuredEntries = useMemo(
    () => sidebarEntries.filter((e) => e.configured),
    [sidebarEntries]
  );
  const unconfiguredEntries = useMemo(
    () => sidebarEntries.filter((e) => !e.configured),
    [sidebarEntries]
  );

  const currentEntry: SidebarEntry = useMemo(() => {
    if (selectedKey === "new-custom") {
      const customPreset = presets.find((p) => p.id === "custom") || null;
      return {
        key: "new-custom",
        provider: "custom",
        title: "自定义兼容接口",
        preset: customPreset,
        profile: null,
        envBacked: false,
        configured: false,
        active: false,
        activeModel: "",
      };
    }
    return (
      sidebarEntries.find((e) => e.key === selectedKey) ||
      configuredEntries[0] ||
      sidebarEntries[0] || {
        key: "preset:gemini",
        provider: "gemini",
        title: "Google Gemini",
        preset: null,
        profile: null,
        envBacked: false,
        configured: false,
        active: false,
        activeModel: "gemini-2.5-flash",
      }
    );
  }, [selectedKey, sidebarEntries, configuredEntries, presets]);

  function hydrateFormFromEntry(entry: SidebarEntry) {
    setSelectedKey(entry.key);
    const prof = entry.profile;
    const preset = entry.preset;
    const defaultUrl = preset?.base_url || "";

    if (entry.key === "new-custom") {
      setCustomName("");
      setBaseUrl("");
      setEditingProxyUrl(true);
      setApiKey("");
      setShowKey(false);
      setSelectedModel("");
      setModelPool([]);
    } else if (prof) {
      setCustomName(prof.name || entry.title);
      const profUrl = prof.base_url || defaultUrl;
      setBaseUrl(profUrl);
      setEditingProxyUrl(
        entry.provider === "custom" ||
          isLocalProvider(entry.provider) ||
          Boolean(defaultUrl && profUrl && profUrl !== defaultUrl)
      );
      setApiKey("");
      setShowKey(false);
      const pool = dedupeModels([
        prof.model,
        ...(prof.models || []),
        ...(preset?.suggested_models || []),
      ]);
      setSelectedModel(prof.model || pool[0] || "");
      setModelPool(pool);
    } else if (entry.envBacked && envDetected) {
      setCustomName(entry.title);
      const envUrl = envDetected.base_url || defaultUrl;
      setBaseUrl(envUrl);
      setEditingProxyUrl(
        entry.provider === "custom" ||
          isLocalProvider(entry.provider) ||
          Boolean(defaultUrl && envUrl && envUrl !== defaultUrl)
      );
      setApiKey("");
      setShowKey(false);
      const pool = dedupeModels([
        envDetected.model,
        ...(envDetected.models || []),
        ...(preset?.suggested_models || []),
      ]);
      setSelectedModel(envDetected.model || pool[0] || "");
      setModelPool(pool);
    } else {
      setCustomName(entry.title);
      setBaseUrl(defaultUrl);
      setEditingProxyUrl(
        entry.provider === "custom" || isLocalProvider(entry.provider)
      );
      setApiKey("");
      setShowKey(false);
      const pool = dedupeModels([
        preset?.default_model || "",
        ...(preset?.suggested_models || []),
      ]);
      setSelectedModel(preset?.default_model || pool[0] || "");
      setModelPool(pool);
    }

    setAddingModelOpen(false);
    setNewModelInput("");
    setFetchedModels(null);
    setFetchedSearch("");
    setTestResult(null);
    setError("");
    setConfirmDelete(false);
  }

  // Initialize active entry only when modal opens
  useEffect(() => {
    if (!open || !settings) return;
    const activeEntry =
      sidebarEntries.find((e) => e.active) ||
      configuredEntries[0] ||
      sidebarEntries[0];
    if (activeEntry) {
      hydrateFormFromEntry(activeEntry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, Boolean(settings)]);

  // Keep modelPool & selectedModel synced when settings update in-place (e.g. clicking "设为当前使用")
  useEffect(() => {
    if (!open || !settings || selectedKey === "new-custom") return;
    const updated = sidebarEntries.find((e) => e.key === selectedKey);
    if (!updated) return;
    if (updated.profile) {
      setSelectedModel(updated.profile.model);
      setModelPool((prev) =>
        dedupeModels([
          updated.profile!.model,
          ...(updated.profile!.models || []),
          ...prev,
        ])
      );
    } else if (updated.envBacked && settings.env_detected) {
      setSelectedModel(settings.env_detected.model);
      setModelPool((prev) =>
        dedupeModels([
          settings.env_detected!.model,
          ...(settings.env_detected!.models || []),
          ...prev,
        ])
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Focus trap + Esc close + restore focus on close
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      const container = modalRef.current;
      if (!container) return;
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first || container).focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const container = modalRef.current;
        if (!container) return;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            !container.contains(document.activeElement)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (
            document.activeElement === last ||
            !container.contains(document.activeElement)
          ) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  const filteredFetchedModels = useMemo(() => {
    if (!fetchedModels) return [];
    const q = fetchedSearch.trim().toLowerCase();
    if (!q) return fetchedModels;
    return fetchedModels.filter((m) => m.toLowerCase().includes(q));
  }, [fetchedModels, fetchedSearch]);

  const { mounted, exiting } = usePresence(open, 140);

  if (!mounted) return null;

  const prof = currentEntry.profile;
  const preset = currentEntry.preset;
  const defaultPresetUrl = preset?.base_url || "";
  const initialUrl = prof
    ? prof.base_url || defaultPresetUrl
    : currentEntry.envBacked && envDetected
    ? envDetected.base_url || defaultPresetUrl
    : defaultPresetUrl;
  const initialName = prof ? prof.name : currentEntry.title;

  const hasUnsavedCreds =
    Boolean(apiKey.trim()) ||
    baseUrl.trim() !== initialUrl.trim() ||
    (currentEntry.provider === "custom" &&
      customName.trim() !== initialName.trim());

  const activeGlobalModel = settings?.active_summary?.model || "";

  async function handleTestConnection(targetModel?: string) {
    const probeModel = (
      targetModel ||
      selectedModel ||
      modelPool[0] ||
      preset?.default_model ||
      ""
    ).trim();
    if (!probeModel) {
      setError("请先添加或选择一个要测试的模型名称。");
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const useEnv =
        currentEntry.envBacked && !prof && !apiKey.trim() && !hasUnsavedCreds;
      const res = await api<LLMConnectionTestResponse>(
        "/api/settings/llm/test",
        jsonOptions("POST", {
          profile_id: prof?.id || null,
          use_env: useEnv || (currentEntry.envBacked && !prof && !apiKey.trim()),
          provider: currentEntry.provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() || null,
          model: probeModel,
        })
      );
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleFetchRemoteModels() {
    setFetchingModels(true);
    setError("");
    try {
      const res = await api<LLMFetchModelsResponse>(
        "/api/settings/llm/models",
        jsonOptions("POST", {
          profile_id: prof?.id || null,
          use_env: currentEntry.envBacked && !prof && !apiKey.trim(),
          provider: currentEntry.provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() || null,
        })
      );
      if (!res.ok) {
        setError(res.error || "未能拉取模型列表，请检查 API Key 与接口地址。");
        setFetchedModels(null);
      } else {
        setFetchedModels(res.models || []);
        setFetchedSearch("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleInstantSwitchModel(
    targetModel: string,
    nextPoolOverride?: string[]
  ) {
    const cleanM = targetModel.trim();
    if (!cleanM) return;
    const nextPool = dedupeModels(nextPoolOverride || [cleanM, ...modelPool]);
    setModelPool(nextPool);
    setSelectedModel(cleanM);

    // If unconfigured or user typed unsaved credentials, just select locally until Save
    if (!currentEntry.configured || hasUnsavedCreds) {
      return;
    }

    setSwitchingModel(cleanM);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        "/api/settings/llm/active",
        jsonOptions("POST", {
          profile_id: prof ? prof.id : null,
          model: cleanM,
          models: nextPool,
        })
      );
      onSettingsUpdated(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSwitchingModel(null);
    }
  }

  async function persistPoolOnly(nextPool: string[]) {
    setModelPool(nextPool);
    if (!currentEntry.configured || hasUnsavedCreds) return;
    try {
      if (prof) {
        const next = await api<LLMSettingsResponse>(
          "/api/settings/llm/profiles",
          jsonOptions("POST", {
            profile_id: prof.id,
            name: prof.name,
            provider: prof.provider,
            base_url: prof.base_url,
            api_key: null,
            model: nextPool.includes(prof.model) ? prof.model : nextPool[0],
            models: nextPool,
            activate: currentEntry.active,
          })
        );
        onSettingsUpdated(next);
      } else if (currentEntry.envBacked && currentEntry.active) {
        const curEnvM = envDetected?.model || nextPool[0];
        const next = await api<LLMSettingsResponse>(
          "/api/settings/llm/active",
          jsonOptions("POST", {
            profile_id: null,
            model: nextPool.includes(curEnvM) ? curEnvM : nextPool[0],
            models: nextPool,
          })
        );
        onSettingsUpdated(next);
      }
    } catch {
      // Non-blocking pool persistence
    }
  }

  function handleAddModelToPool(rawId: string) {
    const clean = rawId.trim();
    if (!clean) return;
    const nextPool = dedupeModels([...modelPool, clean]);
    setNewModelInput("");
    setAddingModelOpen(false);
    if (!selectedModel) setSelectedModel(clean);
    void persistPoolOnly(nextPool);
  }

  function handleRemoveModelFromPool(targetId: string) {
    if (modelPool.length <= 1) return;
    const nextPool = modelPool.filter((m) => m !== targetId);
    if (selectedModel === targetId) {
      setSelectedModel(nextPool[0] || "");
    }
    void persistPoolOnly(nextPool);
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    const targetModel = (
      selectedModel ||
      modelPool[0] ||
      preset?.default_model ||
      newModelInput ||
      ""
    ).trim();
    if (!targetModel) {
      setError("请至少添加或填写一个模型名称（例如 gemini-2.5-flash）。");
      return;
    }
    const finalPool = dedupeModels([targetModel, ...modelPool]);

    setSaving(true);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        "/api/settings/llm/profiles",
        jsonOptions("POST", {
          profile_id: prof?.id || null,
          name:
            currentEntry.provider === "custom"
              ? customName.trim() || "自定义兼容接口"
              : currentEntry.title,
          provider: currentEntry.provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() ? apiKey.trim() : null,
          inherit_env_key: currentEntry.envBacked && !prof && !apiKey.trim(),
          model: targetModel,
          models: finalPool,
          activate: true,
        })
      );
      setApiKey("");
      onSettingsUpdated(next);
      // If saving a brand-new custom profile, select the newly created profile entry
      if (selectedKey === "new-custom" && next.active_profile_id) {
        setSelectedKey(`profile:${next.active_profile_id}`);
      }
      if (reasonBanner) {
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProfile() {
    if (!prof) return;
    setSaving(true);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        `/api/settings/llm/profiles/${encodeURIComponent(prof.id)}`,
        { method: "DELETE" }
      );
      setConfirmDelete(false);
      onSettingsUpdated(next);
      if (currentEntry.key.startsWith("profile:")) {
        setSelectedKey(`preset:${next.presets[0]?.id || "gemini"}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canSubmitSave = Boolean(
    (selectedModel.trim() || modelPool.length > 0 || newModelInput.trim()) &&
      (prof?.has_api_key ||
        (currentEntry.envBacked && envDetected?.has_api_key) ||
        apiKey.trim() ||
        (preset && !preset.requires_api_key && baseUrl.trim()))
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="模型设置"
    >
      {/* Crisp 35% dark overlay */}
      <div
        className={`fixed inset-0 bg-black/35 ${
          exiting ? "anim-scrim-out pointer-events-none" : "anim-scrim-in"
        }`}
        onClick={onClose}
      />

      {/* Modal Shell */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`relative z-10 w-full max-w-[820px] h-[min(640px,86vh)] rounded-[20px] bg-surface border border-black/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden outline-none ${
          exiting ? "anim-modal-out pointer-events-none" : "anim-modal-in"
        }`}
      >
        {/* Top Modal Header */}
        <div className="px-6 py-4 border-b border-black/[0.07] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-ink tracking-[-0.015em]">
              模型与服务商设置
            </h2>
            <p className="text-[13px] text-ink-secondary mt-0.5">
              密钥仅加密权限保存在本机后端文件，一家服务商配置一次即可随时秒切多个模型。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭模型设置"
            title="关闭 (Esc)"
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contextual Pre-Flight Guard Banner */}
        {reasonBanner && (
          <div className="px-6 py-2.5 bg-warning-bg border-b border-warning-dot/20 text-[13px] text-warning font-medium flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
            <span>{reasonBanner}</span>
          </div>
        )}

        {/* Main Split Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* Left Rail: Provider-First Navigation */}
          <div className="w-full md:w-[248px] shrink-0 bg-surface-subtle border-b md:border-b-0 md:border-r border-black/[0.07] flex flex-col min-h-0">
            <div className="p-3 space-y-4 flex-1 md:overflow-y-auto clean-scroll">
              {configuredEntries.length > 0 && (
                <div className="space-y-1.5">
                  <div className="px-2 text-[13px] font-semibold text-ink-secondary">
                    已配置
                  </div>
                  {configuredEntries.map((entry) => {
                    const selected = currentEntry.key === entry.key;
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        onClick={() => hydrateFormFromEntry(entry)}
                        className={`w-full text-left px-2.5 py-2 rounded-xl border transition-all cursor-pointer flex items-center gap-2.5 ${
                          selected
                            ? "bg-surface border-ink/50 shadow-2xs"
                            : "bg-surface/65 hover:bg-surface border-black/[0.07]"
                        }`}
                      >
                        <ProviderIcon provider={entry.provider} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[13.5px] font-semibold text-ink truncate">
                              {entry.title}
                            </span>
                            {entry.active ? (
                              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success shrink-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                                <span>使用中</span>
                              </span>
                            ) : (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-black/20 shrink-0"
                                title="已就绪"
                              />
                            )}
                          </div>
                          <div className="text-[13px] text-ink-muted font-mono truncate">
                            {entry.activeModel}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1">
                <div className="px-2 text-[13px] font-semibold text-ink-secondary">
                  {configuredEntries.length > 0 ? "添加服务商" : "选择服务商"}
                </div>
                {unconfiguredEntries.map((entry) => {
                  const selected = currentEntry.key === entry.key;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => hydrateFormFromEntry(entry)}
                      className={`w-full text-left px-2.5 py-2 rounded-xl border transition-all cursor-pointer flex items-center gap-2.5 ${
                        selected
                          ? "bg-surface border-ink/50 shadow-2xs text-ink font-semibold"
                          : "border-transparent hover:bg-surface/80 text-ink-secondary hover:text-ink font-medium"
                      }`}
                    >
                      <ProviderIcon
                        provider={entry.provider}
                        size="md"
                        muted={!selected}
                      />
                      <span className="text-[13.5px] truncate">
                        {entry.title}
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() =>
                    hydrateFormFromEntry({
                      key: "new-custom",
                      provider: "custom",
                      title: "自定义兼容接口",
                      preset: presets.find((p) => p.id === "custom") || null,
                      profile: null,
                      envBacked: false,
                      configured: false,
                      active: false,
                      activeModel: "",
                    })
                  }
                  className={`w-full text-left px-2.5 py-2 rounded-xl border transition-all cursor-pointer flex items-center gap-2.5 mt-1 ${
                    selectedKey === "new-custom"
                      ? "bg-surface border-ink/50 shadow-2xs text-ink font-semibold"
                      : "border-dashed border-black/[0.12] hover:border-black/25 hover:bg-surface/70 text-ink-secondary hover:text-ink font-medium"
                  }`}
                >
                  <span className="w-7 h-7 rounded-lg bg-surface border border-black/[0.08] inline-flex items-center justify-center shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[13px] truncate">
                    添加自定义兼容接口
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Pane: Provider Inspector + Model Pool */}
          <form
            onSubmit={(e) => void handleSaveCredentials(e)}
            className="flex-1 min-w-0 flex flex-col md:overflow-hidden"
          >
            <div className="p-6 space-y-5 flex-1 md:overflow-y-auto clean-scroll">
              {/* Provider Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-black/[0.06]">
                <div className="flex items-center gap-3 min-w-0">
                  <ProviderIcon provider={currentEntry.provider} size="lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[16px] font-semibold text-ink">
                        {currentEntry.title}
                      </h3>
                      {currentEntry.active ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-subtle border border-success/30 text-[13px] font-medium text-success">
                          <Check className="w-3.5 h-3.5" />
                          <span>当前使用中</span>
                        </span>
                      ) : currentEntry.configured && !hasUnsavedCreds ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handleInstantSwitchModel(
                              selectedModel || modelPool[0] || ""
                            )
                          }
                          className="px-2.5 py-0.5 rounded-full ui-btn-outline text-[13px]"
                        >
                          设为当前使用
                        </button>
                      ) : null}
                      {currentEntry.envBacked && !prof && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-canvas border border-black/[0.08] text-[13px] text-ink-secondary">
                          <Sparkles className="w-3 h-3" />
                          <span>已读取本机环境变量</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-ink-secondary mt-0.5">
                      {currentEntry.provider === "ollama"
                        ? "连接本机运行的 Ollama 服务，免 API Key 离线调用开源模型。"
                        : currentEntry.provider === "lmstudio"
                        ? "连接本机运行的 LM Studio 本地服务，免 API Key 离线调用开源模型。"
                        : currentEntry.provider === "volcengine"
                        ? "配置一次火山方舟 API Key，可使用官方模型 ID 或在下方添加推理接入点（ep-...）。"
                        : currentEntry.provider === "custom"
                        ? "接入任意兼容 OpenAI Chat Completions 协议的网关、OneAPI 或企业中转服务。"
                        : `配置一次 API Key，即可在下方自由添加和秒切 ${currentEntry.title} 旗下模型。`}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={testing}
                  onClick={() => void handleTestConnection()}
                  className="h-9 px-3.5 ui-btn-outline text-[13px] inline-flex items-center gap-1.5 shrink-0"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Wifi className="w-3.5 h-3.5" />
                  )}
                  <span>{testing ? "检测中…" : "测试连接"}</span>
                </button>
              </div>

              {/* Inline Test Connection Banner */}
              {testResult && (
                <div
                  className={`px-3.5 py-2.5 rounded-xl text-[13px] flex items-center justify-between gap-2 border ${
                    testResult.ok
                      ? "bg-surface-subtle border-success/30 text-success font-medium"
                      : "bg-danger-bg border-danger/25 text-danger"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {testResult.ok && <Check className="w-4 h-4 shrink-0" />}
                    <span className="break-words">
                      {testResult.ok
                        ? `连接畅通 · 模型 ${testResult.model || selectedModel} 响应耗时 ${
                            testResult.latency_ms ?? 0
                          } ms`
                        : testResult.error || "连接测试未通过"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTestResult(null)}
                    className="text-ink-muted hover:text-ink cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {error && (
                <div className="px-3.5 py-2.5 rounded-xl bg-danger-bg border border-danger/25 text-[13px] text-danger">
                  {error}
                </div>
              )}

              {/* Custom Display Name (only for Custom endpoints) */}
              {currentEntry.provider === "custom" && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="llm-custom-name"
                    className="block text-[13px] font-semibold text-ink"
                  >
                    服务名称
                  </label>
                  <input
                    id="llm-custom-name"
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="例如：公司内网网关 / OpenAI 中转"
                    className="w-full h-10 px-3.5 text-[13.5px] ui-field"
                  />
                </div>
              )}

              {/* Credentials Block: API Key + Smart Base URL */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="llm-api-key"
                      className="text-[13px] font-semibold text-ink"
                    >
                      API Key
                      {preset && !preset.requires_api_key && (
                        <span className="font-normal text-ink-muted ml-1.5">
                          （可选填）
                        </span>
                      )}
                    </label>
                    {preset?.api_key_url ? (
                      <a
                        href={preset.api_key_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary hover:text-ink transition-colors"
                      >
                        <span>获取 API Key</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </div>

                  <div className="relative">
                    <input
                      id="llm-api-key"
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={
                        prof?.has_api_key
                          ? `已保存密钥 (${prof.api_key_masked})，输入新值可替换`
                          : currentEntry.envBacked && envDetected?.has_api_key
                          ? `默认读取环境变量 (${envDetected.api_key_masked})，输入新值可覆盖`
                          : preset?.requires_api_key
                          ? `粘贴 ${currentEntry.title} 的 API Key…`
                          : "本地或免密网关可留空"
                      }
                      className="w-full h-10 pl-3.5 pr-10 text-[13.5px] font-mono ui-field"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                      title={showKey ? "隐藏 API Key" : "显示 API Key"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink cursor-pointer"
                    >
                      {showKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Smart Collapsible Base URL (eliminates ugly broken URLs for standard presets) */}
                {editingProxyUrl ||
                currentEntry.provider === "custom" ||
                isLocalProvider(currentEntry.provider) ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="llm-base-url"
                        className="text-[13px] font-semibold text-ink"
                      >
                        接口地址
                      </label>
                      {defaultPresetUrl &&
                        !isLocalProvider(currentEntry.provider) && (
                          <button
                            type="button"
                            onClick={() => {
                              setBaseUrl(defaultPresetUrl);
                              setEditingProxyUrl(false);
                              setTestResult(null);
                            }}
                            className="text-[13px] text-ink-secondary hover:text-ink cursor-pointer"
                          >
                            恢复官方默认
                          </button>
                        )}
                    </div>
                    <input
                      id="llm-base-url"
                      type="text"
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={
                        defaultPresetUrl || "https://api.example.com/v1"
                      }
                      className="w-full h-10 px-3.5 text-[13.5px] font-mono ui-field"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-canvas border border-black/[0.06] text-[13px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-ink-muted shrink-0">接口地址</span>
                      <span
                        className="font-mono text-ink-secondary truncate"
                        title={baseUrl || defaultPresetUrl}
                      >
                        官方默认（{extractHost(baseUrl || defaultPresetUrl)}）
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingProxyUrl(true)}
                      className="text-ink font-medium hover:underline cursor-pointer shrink-0"
                    >
                      自定义代理
                    </button>
                  </div>
                )}
              </div>

              {/* Models Pool Block */}
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-ink">
                    可用模型
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={fetchingModels}
                      onClick={() => void handleFetchRemoteModels()}
                      title="实时调用服务商 /models 接口获取当前账号支持的模型"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-canvas hover:bg-black/[0.06] border border-black/[0.08] text-[13px] font-medium text-ink transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          fetchingModels ? "animate-spin" : ""
                        }`}
                      />
                      <span>{fetchingModels ? "获取中…" : "从接口获取"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingModelOpen((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-canvas hover:bg-black/[0.06] border border-black/[0.08] text-[13px] font-medium text-ink transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>手动添加</span>
                    </button>
                  </div>
                </div>

                {/* Inline Manual Add Input */}
                {addingModelOpen && (
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-canvas border border-black/[0.08]">
                    <input
                      type="text"
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddModelToPool(newModelInput);
                        }
                      }}
                      placeholder="输入精确的模型 ID（如 gemini-2.5-pro、deepseek-reasoner）…"
                      className="flex-1 min-w-0 h-9 px-3 text-[13px] font-mono ui-field bg-surface"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={!newModelInput.trim()}
                      onClick={() => handleAddModelToPool(newModelInput)}
                      className="h-9 px-3.5 ui-btn-primary text-[13px] shrink-0"
                    >
                      添加
                    </button>
                  </div>
                )}

                {/* Remote Fetched Models Picker */}
                {fetchedModels && (
                  <div className="p-3 rounded-xl bg-canvas border border-black/[0.09] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-ink">
                        已从接口发现 {fetchedModels.length} 个模型（点击加入列表）
                      </span>
                      <button
                        type="button"
                        onClick={() => setFetchedModels(null)}
                        className="text-[13px] text-ink-secondary hover:text-ink cursor-pointer"
                      >
                        收起
                      </button>
                    </div>
                    {fetchedModels.length > 6 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={fetchedSearch}
                          onChange={(e) => setFetchedSearch(e.target.value)}
                          placeholder="搜索模型名称…"
                          className="w-full h-8 pl-8 pr-3 text-[13px] font-mono ui-field bg-surface"
                        />
                      </div>
                    )}
                    <div className="max-h-36 overflow-y-auto clean-scroll flex flex-wrap gap-1.5">
                      {filteredFetchedModels.map((mid) => {
                        const inPool = modelPool.includes(mid);
                        return (
                          <button
                            key={mid}
                            type="button"
                            onClick={() => {
                              if (!inPool) handleAddModelToPool(mid);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[13px] font-mono border transition-colors cursor-pointer inline-flex items-center gap-1 ${
                              inPool
                                ? "bg-surface border-ink/30 text-ink font-medium"
                                : "bg-surface/80 hover:bg-surface border-black/[0.08] text-ink-secondary hover:text-ink"
                            }`}
                          >
                            {inPool ? (
                              <Check className="w-3 h-3 text-success" />
                            ) : (
                              <Plus className="w-3 h-3" />
                            )}
                            <span>{mid}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Saved / Suggested Model Pool Rows */}
                {modelPool.length > 0 ? (
                  <div className="rounded-xl border border-black/[0.08] bg-surface divide-y divide-black/[0.06] overflow-hidden">
                    {modelPool.map((m) => {
                      const isGlobalActive =
                        currentEntry.active &&
                        !hasUnsavedCreds &&
                        m === activeGlobalModel;
                      const isPendingDefault = selectedModel === m;

                      return (
                        <div
                          key={m}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-surface-subtle/60 transition-colors"
                        >
                          <span className="font-mono text-[13.5px] text-ink truncate">
                            {m}
                          </span>

                          <div className="flex items-center gap-2 shrink-0">
                            {isGlobalActive ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-subtle text-[13px] font-medium text-success">
                                <Check className="w-3.5 h-3.5" />
                                <span>当前使用</span>
                              </span>
                            ) : currentEntry.configured && !hasUnsavedCreds ? (
                              <button
                                type="button"
                                disabled={switchingModel === m}
                                onClick={() => void handleInstantSwitchModel(m)}
                                className="px-2.5 py-1 rounded-lg bg-canvas hover:bg-black/[0.08] text-[13px] font-medium text-ink transition-colors cursor-pointer"
                              >
                                {switchingModel === m
                                  ? "切换中…"
                                  : "设为当前使用"}
                              </button>
                            ) : isPendingDefault ? (
                              <span className="px-2.5 py-0.5 rounded-full bg-canvas text-[13px] font-medium text-ink">
                                默认启用
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedModel(m)}
                                className="px-2.5 py-1 rounded-lg hover:bg-canvas text-[13px] text-ink-secondary hover:text-ink cursor-pointer"
                              >
                                选为默认
                              </button>
                            )}

                            {modelPool.length > 1 && !isGlobalActive && (
                              <button
                                type="button"
                                onClick={() => handleRemoveModelFromPool(m)}
                                title="从列表移除此模型"
                                className="p-1 rounded-md text-ink-muted hover:text-danger transition-colors cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-border-dashed text-[13px] text-ink-muted text-center">
                    点击上方「从接口获取」自动拉取可用模型，或点击「手动添加」输入模型 ID。
                  </div>
                )}
              </div>
            </div>

            {/* Sticky Bottom Footer */}
            <div className="px-6 py-3.5 border-t border-black/[0.07] bg-surface-subtle flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                {prof ? (
                  confirmDelete ? (
                    <div className="flex items-center gap-2 text-[13px]">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleDeleteProfile()}
                        className="px-3 py-1 rounded-full bg-danger hover:bg-danger-hover text-white font-medium cursor-pointer"
                      >
                        {currentEntry.envBacked ? "确认恢复默认" : "确认删除"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="text-ink-secondary hover:text-ink cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-danger transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {currentEntry.envBacked
                          ? "清除覆盖（恢复环境变量）"
                          : "删除此服务商配置"}
                      </span>
                    </button>
                  )
                ) : (
                  <span className="text-[13px] text-ink-muted">
                    {currentEntry.configured && !hasUnsavedCreds
                      ? "点选上方任意模型即可立即切换生效"
                      : preset && !preset.requires_api_key
                      ? "确认接口地址与模型后保存即可启用"
                      : "填写 API Key 后保存即可启用"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!currentEntry.configured || hasUnsavedCreds ? (
                  <button
                    type="submit"
                    disabled={saving || !canSubmitSave}
                    className="h-9 px-5 ui-btn-primary text-[13px]"
                  >
                    {saving
                      ? "保存中…"
                      : currentEntry.configured
                      ? "保存修改"
                      : "保存并启用"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 px-5 ui-btn-outline text-[13px]"
                  >
                    完成
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
