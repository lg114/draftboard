"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import {
  api,
  jsonOptions,
  LLMConnectionTestResponse,
  LLMProfilePublic,
  LLMSettingsResponse,
} from "../lib/api";

interface LLMSettingsModalProps {
  open: boolean;
  settings: LLMSettingsResponse | null;
  reasonBanner?: string | null;
  onClose: () => void;
  onSettingsUpdated: (next: LLMSettingsResponse) => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LLMSettingsModal({
  open,
  settings,
  reasonBanner,
  onClose,
  onSettingsUpdated,
}: LLMSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [editingId, setEditingId] = useState<string | "env" | "new">("new");
  const [inheritEnvKey, setInheritEnvKey] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] =
    useState<LLMConnectionTestResponse | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const presets = useMemo(() => settings?.presets || [], [settings]);
  const profiles = useMemo(() => settings?.profiles || [], [settings]);
  const activePreset = useMemo(
    () => presets.find((p) => p.id === provider) || presets[0],
    [presets, provider]
  );

  const editingProfile: LLMProfilePublic | null = useMemo(
    () =>
      editingId === "new" || editingId === "env"
        ? null
        : profiles.find((p) => p.id === editingId) || null,
    [editingId, profiles]
  );

  const isViewingActiveProfile = Boolean(
    editingProfile &&
      settings?.source === "profile" &&
      settings?.active_profile_id === editingProfile.id
  );

  const isViewingActiveEnv = Boolean(
    editingId === "env" && settings?.source === "env"
  );

  function loadProfileIntoForm(prof: LLMProfilePublic) {
    setEditingId(prof.id);
    setInheritEnvKey(false);
    setName(prof.name);
    setProvider(prof.provider || "custom");
    setBaseUrl(prof.base_url || "");
    setApiKey("");
    setModel(prof.model || "");
    setShowKey(false);
    setTestResult(null);
    setError("");
    setConfirmDelete(false);
  }

  function selectEnvView() {
    setEditingId("env");
    setInheritEnvKey(false);
    setTestResult(null);
    setError("");
    setConfirmDelete(false);
  }

  function cloneEnvToEditable() {
    const env = settings?.env_detected;
    if (!env) {
      startNewProfile("openai");
      return;
    }
    setEditingId("new");
    setInheritEnvKey(Boolean(env.has_api_key));
    setProvider(env.provider || "custom");
    setBaseUrl(env.base_url || "");
    setModel(env.model || "");
    setName(env.name.replace("环境变量", "自定义"));
    setApiKey("");
    setShowKey(false);
    setTestResult(null);
    setError("");
    setConfirmDelete(false);
  }

  function startNewProfile(presetId = "openai") {
    const preset = presets.find((p) => p.id === presetId) || presets[0];
    setEditingId("new");
    setInheritEnvKey(false);
    setProvider(preset?.id || "openai");
    setBaseUrl(preset?.base_url || "");
    setModel(preset?.default_model || "");
    setName("");
    setApiKey("");
    setShowKey(false);
    setTestResult(null);
    setError("");
    setConfirmDelete(false);
  }

  // Initialize selected item whenever modal opens or settings first load
  useEffect(() => {
    if (!open || !settings) return;
    if (settings.source === "profile") {
      const active = settings.profiles.find(
        (p) => p.id === settings.active_profile_id
      );
      if (active) {
        loadProfileIntoForm(active);
        return;
      }
    }
    if (settings.source === "env" && settings.env_detected) {
      selectEnvView();
      return;
    }
    if (settings.profiles.length > 0) {
      loadProfileIntoForm(settings.profiles[0]);
    } else if (settings.env_detected) {
      selectEnvView();
    } else {
      startNewProfile("openai");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, Boolean(settings)]);

  // Focus trap + Esc close + restore focus to trigger button on close
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

  if (!open) return null;

  function handleSelectProvider(nextProvider: string) {
    setProvider(nextProvider);
    setTestResult(null);
    setError("");
    const preset = presets.find((p) => p.id === nextProvider);
    if (preset) {
      setBaseUrl(preset.base_url);
      if (preset.default_model) {
        setModel(preset.default_model);
      } else if (nextProvider === "custom") {
        setModel("");
      }
    }
  }

  async function handleTestConnection(useEnv = false) {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const res = await api<LLMConnectionTestResponse>(
        "/api/settings/llm/test",
        jsonOptions(
          "POST",
          useEnv
            ? { use_env: true }
            : {
                profile_id:
                  editingId === "new" || editingId === "env" ? null : editingId,
                use_env: inheritEnvKey && !apiKey.trim(),
                provider,
                base_url: baseUrl.trim(),
                api_key: apiKey.trim() || null,
                model: model.trim(),
              }
        )
      );
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent, activate = true) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        "/api/settings/llm/profiles",
        jsonOptions("POST", {
          profile_id:
            editingId === "new" || editingId === "env" ? null : editingId,
          name: name.trim(),
          provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() ? apiKey.trim() : null,
          inherit_env_key: inheritEnvKey && !apiKey.trim(),
          model: model.trim(),
          activate,
        })
      );
      onSettingsUpdated(next);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive(targetId: string | null) {
    setActivating(true);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        "/api/settings/llm/active",
        jsonOptions("POST", { profile_id: targetId })
      );
      onSettingsUpdated(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActivating(false);
    }
  }

  async function handleDeleteCurrent() {
    if (!editingProfile) return;
    setSaving(true);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        `/api/settings/llm/profiles/${encodeURIComponent(editingProfile.id)}`,
        { method: "DELETE" }
      );
      onSettingsUpdated(next);
      setConfirmDelete(false);
      if (next.profiles.length > 0) {
        const active =
          next.profiles.find((p) => p.id === next.active_profile_id) ||
          next.profiles[0];
        loadProfileIntoForm(active);
      } else if (next.env_detected) {
        selectEnvView();
      } else {
        startNewProfile("openai");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="模型设置"
    >
      {/* Crisp 35% dark overlay without heavy blur */}
      <div className="fixed inset-0 bg-black/35" onClick={onClose} />

      {/* Modal Shell */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-[760px] max-h-[86vh] rounded-[20px] bg-surface border border-black/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden outline-none"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.07] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-ink tracking-[-0.015em]">
              模型设置
            </h2>
            <p className="text-[13px] text-ink-secondary mt-0.5">
              配置仅保存在本机后端文件，支持多组模型随时切换并即时生效。
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

        {/* Contextual Banner (when triggered by an unconfigured AI action) */}
        {reasonBanner && (
          <div className="px-6 py-2.5 bg-warning-bg border-b border-warning-dot/20 text-[13px] text-warning font-medium flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
            <span>{reasonBanner}</span>
          </div>
        )}

        {/* Body: Left Rail + Right Inspector/Form */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* Left Rail: Select to View (Header holds the + Add button) */}
          <div className="w-full md:w-[244px] shrink-0 bg-surface-subtle border-b md:border-b-0 md:border-r border-black/[0.07] flex flex-col">
            <div className="p-3.5 space-y-2 flex-1 md:overflow-y-auto clean-scroll">
              <div className="px-1 flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink-secondary">
                  已保存配置
                </span>
                <button
                  type="button"
                  onClick={() => startNewProfile("openai")}
                  aria-label="新增配置"
                  title="新增配置"
                  className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors cursor-pointer ${
                    editingId === "new"
                      ? "bg-surface border border-ink/50 text-ink shadow-2xs"
                      : "text-ink-secondary hover:text-ink hover:bg-black/[0.06]"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {profiles.map((prof) => {
                const isActive =
                  settings?.source === "profile" &&
                  settings?.active_profile_id === prof.id;
                const isSelected = editingId === prof.id;
                return (
                  <button
                    key={prof.id}
                    type="button"
                    onClick={() => loadProfileIntoForm(prof)}
                    className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                      isSelected
                        ? "bg-surface border-ink/50 shadow-2xs"
                        : "bg-surface/60 hover:bg-surface border-black/[0.07]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-ink truncate">
                        {prof.name}
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success shrink-0">
                          <Check className="w-3.5 h-3.5" />
                          <span>使用中</span>
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-ink-muted truncate font-mono">
                      {prof.model}
                    </div>
                  </button>
                );
              })}

              {settings?.env_detected && (
                <button
                  type="button"
                  onClick={() => selectEnvView()}
                  className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                    editingId === "env"
                      ? "bg-surface border-ink/50 shadow-2xs"
                      : "bg-canvas hover:bg-surface border-black/[0.07]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-ink truncate">
                      {settings.env_detected.name}
                    </span>
                    {settings.source === "env" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success shrink-0">
                        <Check className="w-3.5 h-3.5" />
                        <span>使用中</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-ink-muted truncate font-mono">
                    {settings.env_detected.model}
                  </div>
                </button>
              )}

              {profiles.length === 0 && !settings?.env_detected && (
                <div className="p-3 rounded-xl border border-dashed border-border-dashed text-[13px] text-ink-muted leading-relaxed">
                  尚未保存模型配置，在右侧填写后保存即可立即启用。
                </div>
              )}
            </div>
          </div>

          {/* Right Pane: Read-Only Env Detail OR Create / Edit Profile Form */}
          {editingId === "env" && settings?.env_detected ? (
            <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
              <div className="p-6 space-y-5 flex-1 md:overflow-y-auto clean-scroll">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-ink">
                      {settings.env_detected.name}
                    </h3>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-canvas border border-black/[0.08] text-[13px] text-ink-secondary">
                      <Lock className="w-3 h-3" />
                      <span>来自环境变量，只读</span>
                    </span>
                  </div>
                  <p className="text-[13px] text-ink-secondary">
                    来自本机环境变量，只读。要修改，请新建配置。
                  </p>
                </div>

                {/* Borderless Read-Only Definition List */}
                <dl className="divide-y divide-black/[0.06] text-[13.5px]">
                  <div className="py-3 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                    <dt className="w-24 shrink-0 text-[13px] text-ink-muted">
                      服务商
                    </dt>
                    <dd className="text-ink font-medium">
                      {presets.find(
                        (p) => p.id === settings.env_detected?.provider
                      )?.name || settings.env_detected.provider}
                    </dd>
                  </div>

                  <div className="py-3 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                    <dt className="w-24 shrink-0 text-[13px] text-ink-muted">
                      接口地址
                    </dt>
                    <dd className="font-mono text-ink break-all">
                      {settings.env_detected.base_url ||
                        "https://api.openai.com/v1"}
                    </dd>
                  </div>

                  <div className="py-3 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                    <dt className="w-24 shrink-0 text-[13px] text-ink-muted">
                      API Key
                    </dt>
                    <dd className="font-mono text-ink">
                      {settings.env_detected.has_api_key
                        ? settings.env_detected.api_key_masked
                        : "未设置（免密钥）"}
                    </dd>
                  </div>

                  <div className="py-3 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
                    <dt className="w-24 shrink-0 text-[13px] text-ink-muted">
                      模型
                    </dt>
                    <dd className="font-mono text-ink">
                      {settings.env_detected.model}
                    </dd>
                  </div>
                </dl>

                {testResult && (
                  <div
                    className={`p-3 rounded-xl text-[13px] flex items-center gap-2 border ${
                      testResult.ok
                        ? "bg-surface-subtle border-success/30 text-success font-medium"
                        : "bg-danger-bg border-danger/25 text-danger"
                    }`}
                  >
                    {testResult.ok ? (
                      <>
                        <Check className="w-4 h-4 shrink-0" />
                        <span>
                          连接成功（{testResult.model || settings.env_detected.model}，耗时{" "}
                          {testResult.latency_ms ?? 0} ms）
                        </span>
                      </>
                    ) : (
                      <span>{testResult.error || "连接测试失败"}</span>
                    )}
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-xl bg-danger-bg border border-danger/25 text-[13px] text-danger">
                    {error}
                  </div>
                )}
              </div>

              <div className="px-6 py-3.5 border-t border-black/[0.07] bg-surface-subtle flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div>
                  {!isViewingActiveEnv && (
                    <button
                      type="button"
                      disabled={activating}
                      onClick={() => void handleSetActive(null)}
                      className="h-9 px-3.5 ui-btn-outline text-[13px]"
                    >
                      {activating ? "切换中…" : "设为当前使用"}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testing}
                    onClick={() => void handleTestConnection(true)}
                    className="h-9 px-3.5 ui-btn-outline text-[13px] inline-flex items-center gap-1.5"
                  >
                    {testing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5" />
                    )}
                    <span>{testing ? "测试中…" : "测试连接"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={cloneEnvToEditable}
                    className="h-9 px-4 ui-btn-primary text-[13px]"
                  >
                    基于此新建配置
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => void handleSave(e, true)}
              className="flex-1 min-w-0 flex flex-col md:overflow-hidden"
            >
              <div className="p-6 space-y-4 flex-1 md:overflow-y-auto clean-scroll">
                {/* Provider Selector */}
                <div className="space-y-1.5">
                  <label className="block text-[13px] font-semibold text-ink">
                    服务商
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((p) => {
                      const active = provider === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleSelectProvider(p.id)}
                          className={`px-3 py-1.5 rounded-full text-[13px] transition-all cursor-pointer border ${
                            active
                              ? "bg-surface border-ink text-ink font-semibold shadow-2xs"
                              : "bg-canvas border-transparent hover:border-black/20 text-ink-secondary hover:text-ink font-medium"
                          }`}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Profile Display Name */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="llm-profile-name"
                    className="block text-[13px] font-semibold text-ink"
                  >
                    配置名称（选填）
                  </label>
                  <input
                    id="llm-profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={`例如：主力 ${activePreset?.name || "模型"}`}
                    className="w-full h-10 px-3.5 text-[13.5px] ui-field"
                  />
                </div>

                {/* Endpoint URL */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="llm-base-url"
                    className="block text-[13px] font-semibold text-ink"
                  >
                    接口地址
                  </label>
                  <input
                    id="llm-base-url"
                    type="text"
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={
                      activePreset?.base_url || "https://api.example.com/v1"
                    }
                    className="w-full h-10 px-3.5 text-[13.5px] font-mono ui-field"
                  />
                </div>

                {/* API Key */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="llm-api-key"
                      className="block text-[13px] font-semibold text-ink"
                    >
                      API Key
                      {activePreset && !activePreset.requires_api_key && (
                        <span className="font-normal text-ink-muted ml-1.5">
                          （本地服务可留空）
                        </span>
                      )}
                    </label>
                    {editingProfile?.has_api_key && (
                      <span className="text-[13px] text-ink-muted font-mono">
                        已保存 {editingProfile.api_key_masked}
                      </span>
                    )}
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
                        editingProfile?.has_api_key
                          ? "留空则继续使用已保存密钥"
                          : inheritEnvKey &&
                            settings?.env_detected?.api_key_masked
                          ? `留空则继承环境变量密钥（${settings.env_detected.api_key_masked}）`
                          : activePreset?.requires_api_key
                          ? "输入 API Key…"
                          : "可选填"
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

                {/* Model ID + Suggested Chips */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="llm-model"
                    className="block text-[13px] font-semibold text-ink"
                  >
                    模型
                  </label>
                  <input
                    id="llm-model"
                    type="text"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={activePreset?.default_model || "例如 gpt-4o-mini"}
                    className="w-full h-10 px-3.5 text-[13.5px] font-mono ui-field"
                  />
                  {activePreset && activePreset.suggested_models.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {activePreset.suggested_models.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setModel(m);
                            setTestResult(null);
                          }}
                          className={`px-2.5 py-0.5 rounded-full text-[13px] font-mono transition-colors cursor-pointer border ${
                            model === m
                              ? "bg-surface border-ink/50 text-ink"
                              : "bg-canvas border-transparent hover:border-black/20 text-ink-secondary hover:text-ink"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Connection Test Result */}
                {testResult && (
                  <div
                    className={`p-3 rounded-xl text-[13px] flex items-center gap-2 border ${
                      testResult.ok
                        ? "bg-surface-subtle border-success/30 text-success font-medium"
                        : "bg-danger-bg border-danger/25 text-danger"
                    }`}
                  >
                    {testResult.ok ? (
                      <>
                        <Check className="w-4 h-4 shrink-0" />
                        <span>
                          连接成功（{testResult.model || model}，耗时{" "}
                          {testResult.latency_ms ?? 0} ms）
                        </span>
                      </>
                    ) : (
                      <span>{testResult.error || "连接测试失败"}</span>
                    )}
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-xl bg-danger-bg border border-danger/25 text-[13px] text-danger">
                    {error}
                  </div>
                )}
              </div>

              {/* Sticky Form Footer */}
              <div className="px-6 py-3.5 border-t border-black/[0.07] bg-surface-subtle flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  {editingProfile &&
                    (confirmDelete ? (
                      <div className="flex items-center gap-2 text-[13px]">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleDeleteCurrent()}
                          className="px-3 py-1 rounded-full bg-danger hover:bg-danger-hover text-white font-medium cursor-pointer"
                        >
                          确认删除
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
                        <span>删除</span>
                      </button>
                    ))}

                  {editingProfile && !isViewingActiveProfile && (
                    <button
                      type="button"
                      disabled={activating}
                      onClick={() => void handleSetActive(editingProfile.id)}
                      className="h-9 px-3 ui-btn-outline text-[13px]"
                    >
                      {activating ? "切换中…" : "设为当前使用"}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={testing || !model.trim()}
                    onClick={() => void handleTestConnection(false)}
                    className="h-9 px-3.5 ui-btn-outline text-[13px] inline-flex items-center gap-1.5"
                  >
                    {testing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5" />
                    )}
                    <span>{testing ? "测试中…" : "测试连接"}</span>
                  </button>

                  <button
                    type="submit"
                    disabled={saving || !model.trim()}
                    className="h-9 px-4 ui-btn-primary text-[13px]"
                  >
                    {saving
                      ? "保存中…"
                      : editingProfile
                      ? isViewingActiveProfile
                        ? "保存修改"
                        : "保存并设为当前使用"
                      : "保存并启用"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
