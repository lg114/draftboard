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
  const dialogRef = useRef<HTMLDialogElement | null>(null);

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

  // Sync native <dialog> modal state with `open` prop
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Light-dismiss fallback for browsers without <dialog closedby="any">
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
    };

    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("pointerup", onPointerUp);
    return () => {
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, [open]);

  // Initialize active entry when modal opens
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

  // Keep modelPool & selectedModel synced when settings update in-place
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

  const filteredFetchedModels = useMemo(() => {
    if (!fetchedModels) return [];
    const q = fetchedSearch.trim().toLowerCase();
    if (!q) return fetchedModels;
    return fetchedModels.filter((m) => m.toLowerCase().includes(q));
  }, [fetchedModels, fetchedSearch]);

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
          use_env:
            useEnv || (currentEntry.envBacked && !prof && !apiKey.trim()),
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

  const openNewCustom = () =>
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
    });

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby="llm-settings-title"
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = "";
        }
        if (open) onClose();
      }}
      className="ui-modal-dialog w-[min(860px,calc(100dvw-2rem))] h-[min(640px,88dvh)] rounded-2xl bg-ui-surface ring-1 ring-ui-border-subtle shadow-[0_24px_72px_rgba(0,0,0,0.72)] overflow-clip anim-modal-in"
    >
      {open && (
        <div className="w-full h-full flex flex-col md:flex-row overflow-hidden">
          {/* Left Rail: Quiet Borderless Dark Provider Navigation */}
          <aside className="w-full md:w-[238px] shrink-0 bg-ui-bg flex flex-col min-h-0">
            <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h1
                  id="llm-settings-title"
                  className="text-[15px] font-semibold tracking-[-0.015em] text-ui-text"
                >
                  模型设置
                </h1>
                <p className="text-[12px] text-ui-text-muted mt-0.5">
                  密钥仅保存在本机
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭模型设置"
                title="关闭 (Esc)"
                className="md:hidden p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mobile: Compact Horizontal Provider Strip */}
            <nav
              aria-label="模型服务商列表"
              className="md:hidden flex items-center gap-1.5 px-4 pb-3 overflow-x-auto clean-scroll shrink-0"
            >
              {[...configuredEntries, ...unconfiguredEntries].map((entry) => {
                const selected = currentEntry.key === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    onClick={() => hydrateFormFromEntry(entry)}
                    className={`h-8 px-2.5 rounded-lg text-[12.5px] inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
                      selected
                        ? "bg-ui-bg-selected text-ui-text font-medium"
                        : "bg-ui-surface text-ui-text-secondary hover:text-ui-text"
                    }`}
                  >
                    <ProviderIcon
                      provider={entry.provider}
                      size="sm"
                      muted={!selected && !entry.configured}
                    />
                    <span className="whitespace-nowrap">{entry.title}</span>
                    {entry.active && (
                      <span className="w-1.5 h-1.5 rounded-full bg-ui-success shrink-0" />
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={openNewCustom}
                className={`h-8 px-2.5 rounded-lg text-[12.5px] inline-flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                  selectedKey === "new-custom"
                    ? "bg-ui-bg-selected text-ui-text font-medium"
                    : "bg-ui-surface text-ui-text-muted hover:text-ui-text"
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>自定义</span>
              </button>
            </nav>

            {/* Desktop: Vertical Tonal Provider Rail */}
            <nav
              aria-label="模型服务商列表"
              className="hidden md:flex flex-col flex-1 min-h-0 px-2.5 pb-4 overflow-y-auto clean-scroll space-y-4"
            >
              {configuredEntries.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2.5 pb-1 text-[11.5px] font-medium text-ui-text-muted">
                    已配置
                  </div>
                  {configuredEntries.map((entry) => {
                    const selected = currentEntry.key === entry.key;
                    return (
                      <button
                        key={entry.key}
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        onClick={() => hydrateFormFromEntry(entry)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer flex items-center gap-2.5 ${
                          selected
                            ? "bg-ui-bg-selected text-ui-text"
                            : "hover:bg-ui-bg-hover text-ui-text-secondary hover:text-ui-text"
                        }`}
                      >
                        <ProviderIcon provider={entry.provider} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-[13px] font-medium text-ui-text truncate">
                              {entry.title}
                            </span>
                            {entry.active ? (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-ui-success shrink-0"
                                title="当前使用中"
                              />
                            ) : (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-ui-text-disabled shrink-0"
                                title="已就绪"
                              />
                            )}
                          </div>
                          <div className="text-[11.5px] text-ui-text-muted font-mono truncate mt-0.5">
                            {entry.activeModel}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-0.5">
                <div className="px-2.5 pb-1 text-[11.5px] font-medium text-ui-text-muted">
                  {configuredEntries.length > 0 ? "其他服务商" : "选择服务商"}
                </div>
                {unconfiguredEntries.map((entry) => {
                  const selected = currentEntry.key === entry.key;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => hydrateFormFromEntry(entry)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-2.5 ${
                        selected
                          ? "bg-ui-bg-selected text-ui-text font-medium"
                          : "hover:bg-ui-bg-hover text-ui-text-secondary hover:text-ui-text"
                      }`}
                    >
                      <ProviderIcon
                        provider={entry.provider}
                        size="md"
                        muted={!selected}
                      />
                      <span className="text-[13px] truncate">
                        {entry.title}
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  aria-current={
                    selectedKey === "new-custom" ? "true" : undefined
                  }
                  onClick={openNewCustom}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-2.5 mt-1 ${
                    selectedKey === "new-custom"
                      ? "bg-ui-bg-selected text-ui-text font-medium"
                      : "hover:bg-ui-bg-hover text-ui-text-muted hover:text-ui-text"
                  }`}
                >
                  <span className="w-7 h-7 rounded-lg bg-ui-surface inline-flex items-center justify-center shrink-0 text-ui-icon">
                    <Plus className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-[13px] truncate">自定义兼容接口</span>
                </button>
              </div>
            </nav>
          </aside>

          {/* Right Pane: Borderless Provider Inspector + Model Pool */}
          <form
            onSubmit={(e) => void handleSaveCredentials(e)}
            className="flex-1 min-w-0 min-h-0 bg-ui-surface flex flex-col overflow-hidden"
          >
            {reasonBanner && (
              <div className="px-6 py-2.5 bg-ui-warning-bg text-[12.5px] text-ui-warning font-medium flex items-center gap-2 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
                <span>{reasonBanner}</span>
              </div>
            )}

            {/* Inspector Scroll Body */}
            <div className="flex-1 min-h-0 overflow-y-auto clean-scroll px-5 sm:px-6 pt-5 pb-6 space-y-5">
              {/* Provider Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <ProviderIcon provider={currentEntry.provider} size="lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-semibold tracking-[-0.015em] text-ui-text">
                        {currentEntry.title}
                      </h2>
                      {currentEntry.active ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ui-success">
                          <span className="w-1.5 h-1.5 rounded-full bg-ui-success" />
                          <span>使用中</span>
                        </span>
                      ) : currentEntry.configured && !hasUnsavedCreds ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handleInstantSwitchModel(
                              selectedModel || modelPool[0] || ""
                            )
                          }
                          className="h-6.5 px-2.5 rounded-md bg-ui-bg hover:bg-ui-control-hover text-[12px] font-medium text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer"
                        >
                          设为当前
                        </button>
                      ) : null}
                      {currentEntry.envBacked && !prof && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-ui-bg text-[11.5px] text-ui-text-muted">
                          <Sparkles className="w-3 h-3 text-ui-icon" />
                          <span>环境变量</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] text-ui-text-muted mt-1 leading-relaxed">
                      {currentEntry.provider === "ollama"
                        ? "连接本机运行的 Ollama 服务，免 API Key 离线调用开源模型。"
                        : currentEntry.provider === "lmstudio"
                        ? "连接本机运行的 LM Studio 本地服务，免 API Key 离线调用开源模型。"
                        : currentEntry.provider === "volcengine"
                        ? "配置火山方舟 API Key，可使用官方模型 ID 或推理接入点（ep-...）。"
                        : currentEntry.provider === "custom"
                        ? "接入兼容 OpenAI Chat Completions 协议的自建网关或中转服务。"
                        : `配置一次 API Key，即可自由管理并切换 ${currentEntry.title} 旗下模型。`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void handleTestConnection()}
                    className="h-8 px-3 rounded-lg bg-ui-bg hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-ui-icon" />
                    )}
                    <span>{testing ? "检测中…" : "测试连接"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭模型设置"
                    title="关闭 (Esc)"
                    className="hidden md:inline-flex p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Inline Test Connection Banner */}
              {testResult && (
                <div
                  role="status"
                  className={`px-3.5 py-2.5 rounded-xl text-[13px] flex items-center justify-between gap-2 ${
                    testResult.ok
                      ? "bg-ui-success-bg text-ui-success font-medium"
                      : "bg-ui-danger-bg text-ui-danger"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {testResult.ok && <Check className="w-4 h-4 shrink-0" />}
                    <span className="break-words">
                      {testResult.ok
                        ? `连接正常，模型 ${
                            testResult.model || selectedModel
                          } 响应耗时 ${testResult.latency_ms ?? 0} ms`
                        : testResult.error || "连接测试未通过"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTestResult(null)}
                    aria-label="关闭提示"
                    className="text-ui-icon hover:text-ui-text cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {error && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 rounded-xl bg-ui-danger-bg text-[13px] text-ui-danger"
                >
                  {error}
                </div>
              )}

              {/* Credentials Section */}
              <div className="space-y-3.5">
                {currentEntry.provider === "custom" && (
                  <div className="space-y-1.5">
                    <label
                      htmlFor="llm-custom-name"
                      className="block text-[12.5px] font-medium text-ui-text-secondary"
                    >
                      服务名称
                    </label>
                    <input
                      id="llm-custom-name"
                      name="custom_name"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="例如：公司内网网关 / OpenAI 中转"
                      className="ui-field bg-ui-bg w-full h-9.5 px-3 text-[13.5px]"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="llm-api-key"
                      className="text-[12.5px] font-medium text-ui-text-secondary"
                    >
                      API Key
                      {preset && !preset.requires_api_key && (
                        <span className="font-normal text-ui-text-muted ml-1">
                          （选填）
                        </span>
                      )}
                    </label>
                    {preset?.api_key_url ? (
                      <a
                        href={preset.api_key_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-ui-accent-text hover:underline"
                      >
                        <span>获取 API Key</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </div>

                  <div className="relative">
                    <input
                      id="llm-api-key"
                      name="api_key"
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={
                        prof?.has_api_key
                          ? `已保存 (${prof.api_key_masked})，输入新值可替换`
                          : currentEntry.envBacked && envDetected?.has_api_key
                          ? `已读取环境变量 (${envDetected.api_key_masked})，输入新值可覆盖`
                          : preset?.requires_api_key
                          ? `粘贴 ${currentEntry.title} 的 API Key`
                          : "本地或免密网关可留空"
                      }
                      className="ui-field bg-ui-bg w-full h-9.5 pl-3 pr-10 text-[13px] font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      aria-pressed={showKey}
                      aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                      title={showKey ? "隐藏 API Key" : "显示 API Key"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-ui-icon hover:text-ui-text cursor-pointer"
                    >
                      {showKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {editingProxyUrl ||
                currentEntry.provider === "custom" ||
                isLocalProvider(currentEntry.provider) ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="llm-base-url"
                        className="text-[12.5px] font-medium text-ui-text-secondary"
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
                            className="text-[12px] text-ui-accent-text hover:underline cursor-pointer"
                          >
                            恢复官方默认
                          </button>
                        )}
                    </div>
                    <input
                      id="llm-base-url"
                      name="base_url"
                      type="url"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={
                        defaultPresetUrl || "https://api.example.com/v1"
                      }
                      className="ui-field bg-ui-bg w-full h-9.5 px-3 text-[13px] font-mono"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-ui-bg text-[12.5px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-ui-text-muted shrink-0">
                        接口地址
                      </span>
                      <span
                        className="font-mono text-ui-text-secondary truncate"
                        title={baseUrl || defaultPresetUrl}
                      >
                        {extractHost(baseUrl || defaultPresetUrl)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingProxyUrl(true)}
                      className="text-ui-accent-text text-[12px] font-medium hover:underline cursor-pointer shrink-0"
                    >
                      自定义代理
                    </button>
                  </div>
                )}
              </div>

              {/* Models Pool Section */}
              <div className="space-y-2.5 pt-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ui-text-secondary">
                    可用模型
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={fetchingModels}
                      onClick={() => void handleFetchRemoteModels()}
                      title="调用服务商 /models 接口拉取模型列表"
                      className="h-7 px-2.5 rounded-md text-[12px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 text-ui-icon ${
                          fetchingModels ? "animate-spin" : ""
                        }`}
                      />
                      <span>{fetchingModels ? "获取中…" : "从接口获取"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingModelOpen((v) => !v)}
                      className="h-7 px-2.5 rounded-md text-[12px] font-medium text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 text-ui-icon" />
                      <span>手动添加</span>
                    </button>
                  </div>
                </div>

                {addingModelOpen && (
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-ui-bg">
                    <input
                      type="text"
                      aria-label="输入模型 ID"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (
                            e.nativeEvent.isComposing ||
                            e.nativeEvent.keyCode === 229
                          ) {
                            return;
                          }
                          e.preventDefault();
                          handleAddModelToPool(newModelInput);
                        }
                      }}
                      placeholder="输入精确的模型 ID，例如 gemini-2.5-pro"
                      className="ui-field bg-ui-surface flex-1 min-w-0 h-8 px-2.5 text-[12.5px] font-mono"
                      autoFocus
                    />
                    <button
                      type="button"
                      disabled={!newModelInput.trim()}
                      onClick={() => handleAddModelToPool(newModelInput)}
                      className="h-8 px-3 ui-btn-primary text-[12.5px] shrink-0"
                    >
                      添加
                    </button>
                  </div>
                )}

                {fetchedModels && (
                  <div className="p-3 rounded-xl bg-ui-bg space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-ui-text-secondary">
                        发现 {fetchedModels.length} 个模型，点击加入列表
                      </span>
                      <button
                        type="button"
                        onClick={() => setFetchedModels(null)}
                        className="text-[12px] text-ui-text-muted hover:text-ui-text cursor-pointer"
                      >
                        收起
                      </button>
                    </div>
                    {fetchedModels.length > 6 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-ui-icon absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          aria-label="筛选远程模型"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={fetchedSearch}
                          onChange={(e) => setFetchedSearch(e.target.value)}
                          placeholder="筛选模型名称"
                          className="ui-field bg-ui-surface w-full h-8 pl-8 pr-3 text-[12.5px] font-mono"
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
                            className={`px-2 py-1 rounded-md text-[12px] font-mono transition-colors cursor-pointer inline-flex items-center gap-1 ${
                              inPool
                                ? "bg-ui-bg-selected text-ui-text font-medium"
                                : "bg-ui-surface hover:bg-ui-control-hover text-ui-text-secondary hover:text-ui-text"
                            }`}
                          >
                            {inPool ? (
                              <Check className="w-3 h-3 text-ui-success" />
                            ) : (
                              <Plus className="w-3 h-3 text-ui-icon" />
                            )}
                            <span>{mid}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {modelPool.length > 0 ? (
                  <div className="rounded-xl bg-ui-bg p-1.5 space-y-0.5">
                    {modelPool.map((m) => {
                      const isGlobalActive =
                        currentEntry.active &&
                        !hasUnsavedCreds &&
                        m === activeGlobalModel;
                      const isPendingDefault = selectedModel === m;

                      return (
                        <div
                          key={m}
                          className={`px-3 py-2 rounded-lg flex items-center justify-between gap-3 transition-colors ${
                            isGlobalActive
                              ? "bg-ui-surface"
                              : "hover:bg-ui-surface/70"
                          }`}
                        >
                          <span className="font-mono text-[13px] text-ui-text truncate">
                            {m}
                          </span>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isGlobalActive ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ui-success px-1.5">
                                <Check className="w-3.5 h-3.5" />
                                <span>使用中</span>
                              </span>
                            ) : currentEntry.configured && !hasUnsavedCreds ? (
                              <button
                                type="button"
                                disabled={switchingModel === m}
                                onClick={() => void handleInstantSwitchModel(m)}
                                className="h-7 px-2.5 rounded-md bg-ui-surface hover:bg-ui-control-hover text-[12px] font-medium text-ui-text-secondary hover:text-ui-text transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {switchingModel === m ? "切换中…" : "设为当前"}
                              </button>
                            ) : isPendingDefault ? (
                              <span className="px-2 py-0.5 rounded-md bg-ui-bg-selected text-[12px] font-medium text-ui-text">
                                默认启用
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedModel(m)}
                                className="h-7 px-2.5 rounded-md hover:bg-ui-control-hover text-[12px] text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
                              >
                                选为默认
                              </button>
                            )}

                            {modelPool.length > 1 && !isGlobalActive && (
                              <button
                                type="button"
                                onClick={() => handleRemoveModelFromPool(m)}
                                title="从列表移除"
                                aria-label={`移除模型 ${m}`}
                                className="p-1 rounded-md text-ui-icon-quiet hover:text-ui-danger hover:bg-ui-danger-bg transition-colors cursor-pointer"
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
                  <div className="p-5 rounded-xl bg-ui-bg text-[12.5px] text-ui-text-muted text-center">
                    点击「从接口获取」自动拉取可用模型，或「手动添加」输入模型 ID。
                  </div>
                )}
              </div>
            </div>

            {/* Quiet Bottom Action Bar */}
            <div className="px-5 sm:px-6 py-3.5 bg-ui-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {prof ? (
                  confirmDelete ? (
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleDeleteProfile()}
                        className="h-7.5 px-3 rounded-lg bg-ui-danger text-ui-bg font-medium hover:brightness-110 cursor-pointer"
                      >
                        {currentEntry.envBacked ? "确认恢复默认" : "确认删除"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="h-7.5 px-2.5 rounded-lg text-ui-text-muted hover:text-ui-text hover:bg-ui-control-hover cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1.5 text-[12.5px] text-ui-text-muted hover:text-ui-danger transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        {currentEntry.envBacked
                          ? "清除覆盖"
                          : "删除此配置"}
                      </span>
                    </button>
                  )
                ) : (
                  <span className="text-[12px] text-ui-text-muted truncate">
                    {currentEntry.configured && !hasUnsavedCreds
                      ? "点选任意模型可立即切换"
                      : preset && !preset.requires_api_key
                      ? "确认接口地址后保存即可启用"
                      : "填写 API Key 后保存即可启用"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!currentEntry.configured || hasUnsavedCreds ? (
                  <button
                    type="submit"
                    disabled={saving || !canSubmitSave}
                    className="h-8.5 px-4 ui-btn-primary text-[13px]"
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
                    className="h-8.5 px-4 rounded-lg bg-ui-bg hover:bg-ui-control-hover text-[13px] font-medium text-ui-text transition-colors cursor-pointer"
                  >
                    完成
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}
    </dialog>
  );
}
