"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  PlugZap,
  Trash2,
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

export function LLMSettingsModal({
  open,
  settings,
  reasonBanner,
  onClose,
  onSettingsUpdated,
}: LLMSettingsModalProps) {
  const [editingId, setEditingId] = useState<string | "new">("new");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [showKey, setShowKey] = useState(false);

  const [saving, setSaving] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
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
      editingId === "new"
        ? null
        : profiles.find((p) => p.id === editingId) || null,
    [editingId, profiles]
  );

  function loadProfileIntoForm(prof: LLMProfilePublic) {
    setEditingId(prof.id);
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

  function startNewProfile(presetId = "openai") {
    const preset = presets.find((p) => p.id === presetId) || presets[0];
    setEditingId("new");
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

  // Initialize form whenever modal opens
  useEffect(() => {
    if (!open || !settings) return;
    const active = settings.profiles.find(
      (p) => p.id === settings.active_profile_id
    );
    if (active) {
      loadProfileIntoForm(active);
    } else if (settings.profiles.length > 0) {
      loadProfileIntoForm(settings.profiles[0]);
    } else {
      startNewProfile("openai");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const res = await api<LLMConnectionTestResponse>(
        "/api/settings/llm/test",
        jsonOptions("POST", {
          profile_id: editingId === "new" ? null : editingId,
          provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() || null,
          model: model.trim(),
        })
      );
      setTestResult(res);
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = await api<LLMSettingsResponse>(
        "/api/settings/llm/profiles",
        jsonOptions("POST", {
          profile_id: editingId === "new" ? null : editingId,
          name: name.trim(),
          provider,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() ? apiKey.trim() : null,
          model: model.trim(),
          activate: true,
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

  async function handleActivateProfile(targetId: string | null) {
    setSwitchingId(targetId ?? "__env__");
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
      setSwitchingId(null);
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
      aria-label="大模型配置"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal Shell */}
      <div className="relative z-10 w-full max-w-[780px] max-h-[88vh] rounded-[20px] bg-surface border border-black/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.16)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[0.07] flex items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-ink tracking-[-0.015em]">
              大模型配置
            </h2>
            <p className="text-[13px] text-ink-secondary mt-0.5">
              配置仅保存在本机，支持多组模型随时切换并即时生效。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Optional Contextual Banner (e.g. triggered from unconfigured AI action) */}
        {reasonBanner && (
          <div className="px-6 py-2.5 bg-warning-bg border-b border-warning-dot/20 text-[13px] text-warning font-medium flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-warning-dot shrink-0" />
            <span>{reasonBanner}</span>
          </div>
        )}

        {/* Body: Left Multi-Profile Rail + Right Form */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* Left Rail: Profiles Switcher */}
          <div className="w-full md:w-[244px] shrink-0 bg-surface-subtle border-b md:border-b-0 md:border-r border-black/[0.07] flex flex-col">
            <div className="p-3.5 space-y-2 flex-1 md:overflow-y-auto clean-scroll">
              <div className="px-1 text-[13px] font-semibold text-ink-secondary">
                已保存配置
              </div>

              {profiles.map((prof) => {
                const isActive =
                  settings?.source === "profile" &&
                  settings?.active_profile_id === prof.id;
                const isEditing = editingId === prof.id;
                return (
                  <div
                    key={prof.id}
                    onClick={() => loadProfileIntoForm(prof)}
                    className={`p-2.5 rounded-xl border transition-colors cursor-pointer space-y-1.5 ${
                      isEditing
                        ? "bg-surface border-ink/50 shadow-2xs"
                        : "bg-surface/60 hover:bg-surface border-black/[0.07]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-semibold text-ink truncate">
                        {prof.name}
                      </span>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success shrink-0">
                          <Check className="w-3.5 h-3.5" />
                          <span>使用中</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={switchingId === prof.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleActivateProfile(prof.id);
                          }}
                          className="text-[13px] font-medium text-ink-secondary hover:text-ink underline underline-offset-2 cursor-pointer shrink-0"
                        >
                          {switchingId === prof.id ? "切换中…" : "启用"}
                        </button>
                      )}
                    </div>
                    <div className="text-[13px] text-ink-muted truncate font-mono">
                      {prof.model}
                    </div>
                  </div>
                );
              })}

              {settings?.env_detected && (
                <div className="p-2.5 rounded-xl bg-canvas border border-black/[0.07] space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-ink truncate">
                      {settings.env_detected.name}
                    </span>
                    {settings.source === "env" ? (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success shrink-0">
                        <Check className="w-3.5 h-3.5" />
                        <span>使用中</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={switchingId === "__env__"}
                        onClick={() => void handleActivateProfile(null)}
                        className="text-[13px] font-medium text-ink-secondary hover:text-ink underline underline-offset-2 cursor-pointer shrink-0"
                      >
                        启用
                      </button>
                    )}
                  </div>
                  <div className="text-[13px] text-ink-muted truncate font-mono">
                    {settings.env_detected.model}
                  </div>
                </div>
              )}

              {profiles.length === 0 && !settings?.env_detected && (
                <div className="p-3 rounded-xl border border-dashed border-border-dashed text-[13px] text-ink-muted leading-relaxed">
                  尚未保存模型配置，在右侧填写后保存即可立即启用。
                </div>
              )}
            </div>

            <div className="p-3 border-t border-black/[0.07] shrink-0">
              <button
                type="button"
                onClick={() => startNewProfile("openai")}
                className={`w-full h-9 rounded-xl text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  editingId === "new"
                    ? "bg-surface border border-ink/50 text-ink shadow-2xs"
                    : "bg-surface hover:bg-canvas border border-black/[0.1] text-ink"
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>新增配置</span>
              </button>
            </div>
          </div>

          {/* Right Pane: Create / Edit Profile Form */}
          <form
            onSubmit={(e) => void handleSave(e)}
            className="flex-1 min-w-0 flex flex-col md:overflow-hidden"
          >
            <div className="p-6 space-y-4 flex-1 md:overflow-y-auto clean-scroll">
              {/* Provider Preset Pills */}
              <div className="space-y-1.5">
                <label className="block text-[13px] font-semibold text-ink">
                  服务商预设
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

              {/* Base URL */}
              <div className="space-y-1.5">
                <label
                  htmlFor="llm-base-url"
                  className="block text-[13px] font-semibold text-ink"
                >
                  API Base URL
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
                      已存 {editingProfile.api_key_masked}
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
                        ? "留空则继续使用已保存的密钥"
                        : activePreset?.requires_api_key
                        ? "输入 API Key…"
                        : "可选填"
                    }
                    className="w-full h-10 pl-3.5 pr-10 text-[13.5px] font-mono ui-field"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "隐藏密钥" : "显示密钥"}
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

              {/* Model Name + Suggested Chips */}
              <div className="space-y-1.5">
                <label
                  htmlFor="llm-model"
                  className="block text-[13px] font-semibold text-ink"
                >
                  模型名称
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

              {/* Feedback Banners */}
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
              <div>
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
                      <span>删除此配置</span>
                    </button>
                  ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testing || !model.trim()}
                  onClick={() => void handleTestConnection()}
                  className="h-9 px-3.5 ui-btn-outline text-[13px] inline-flex items-center gap-1.5"
                >
                  {testing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlugZap className="w-3.5 h-3.5" />
                  )}
                  <span>{testing ? "测试中…" : "测试连接"}</span>
                </button>

                <button
                  type="submit"
                  disabled={saving || !model.trim()}
                  className="h-9 px-4 ui-btn-primary text-[13px]"
                >
                  {saving ? "保存中…" : "保存并启用"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
