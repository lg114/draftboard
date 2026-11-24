"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Settings } from "lucide-react";
import { api, jsonOptions, LLMSettingsResponse } from "../lib/api";
import { usePresence } from "../lib/usePresence";
import { ProviderIcon } from "./ProviderIcon";

interface ModelQuickSwitcherProps {
  settings: LLMSettingsResponse | null;
  onSettingsUpdated?: (next: LLMSettingsResponse) => void;
  onOpenSettings: () => void;
  align?: "left" | "right";
  compact?: boolean;
}

interface ProviderModelGroup {
  key: string;
  provider: string;
  name: string;
  profileId: string | null;
  models: string[];
  isActiveSource: boolean;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    const s = (x || "").trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Cursor-style in-place model switcher for AI Chat, Slide Refine, and Onboarding.
 * - When unconfigured: clicks go straight to the full LLMSettingsModal.
 * - When configured: opens a lightweight grouped popover with official ProviderIcons
 *   to switch models in 1 click, with "管理模型设置…" at the bottom.
 */
export function ModelQuickSwitcher({
  settings,
  onSettingsUpdated,
  onOpenSettings,
  align = "left",
  compact = false,
}: ModelQuickSwitcherProps) {
  const [open, setOpen] = useState(false);
  const { mounted, exiting } = usePresence(open, 130);
  const [switching, setSwitching] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  const groups: ProviderModelGroup[] = useMemo(() => {
    if (!settings) return [];
    const list: ProviderModelGroup[] = [];
    const coveredEnvProviders = new Set<string>();

    for (const prof of settings.profiles || []) {
      if (!prof.usable) continue;
      coveredEnvProviders.add(prof.provider);
      list.push({
        key: `prof:${prof.id}`,
        provider: prof.provider,
        name: prof.name,
        profileId: prof.id,
        models: dedupe([prof.model, ...(prof.models || [])]),
        isActiveSource:
          settings.source === "profile" &&
          settings.active_profile_id === prof.id,
      });
    }

    const env = settings.env_detected;
    if (env && !coveredEnvProviders.has(env.provider)) {
      list.unshift({
        key: "env",
        provider: env.provider,
        name: env.name,
        profileId: null,
        models: dedupe([env.model, ...(env.models || [])]),
        isActiveSource: settings.source === "env",
      });
    } else if (env && settings.source === "env") {
      list.unshift({
        key: "env",
        provider: env.provider,
        name: `${env.name}（环境变量）`,
        profileId: null,
        models: dedupe([env.model, ...(env.models || [])]),
        isActiveSource: true,
      });
    }

    return list;
  }, [settings]);

  const configured = Boolean(settings?.configured && settings.active_summary);
  const activeProvider = settings?.active_summary?.provider || "custom";
  const activeModel = settings?.active_summary?.model || "";

  async function handleQuickSelect(profileId: string | null, model: string) {
    if (!onSettingsUpdated) {
      setOpen(false);
      onOpenSettings();
      return;
    }
    const token = `${profileId || "env"}:${model}`;
    setSwitching(token);
    try {
      const next = await api<LLMSettingsResponse>(
        "/api/settings/llm/active",
        jsonOptions("POST", { profile_id: profileId, model })
      );
      onSettingsUpdated(next);
      setOpen(false);
    } catch {
      setOpen(false);
      onOpenSettings();
    } finally {
      setSwitching(null);
    }
  }

  if (!configured || !onSettingsUpdated || groups.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="模型设置"
        title={
          configured
            ? `当前模型：${activeModel}，点击打开模型设置`
            : "尚未配置大模型，点击前往设置"
        }
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[13px] text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer min-w-0"
      >
        {!configured ? (
          <span className="w-1.5 h-1.5 rounded-full bg-warning-dot shrink-0" />
        ) : (
          <ProviderIcon provider={activeProvider} size="sm" />
        )}
        <span
          className={`truncate font-mono ${
            compact ? "max-w-[135px]" : "max-w-[175px]"
          }`}
        >
          {configured ? activeModel : "配置模型"}
        </span>
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative inline-flex min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="切换或管理模型"
        title={`当前模型：${activeModel}（点击快速切换）`}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[13px] text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer min-w-0"
      >
        <ProviderIcon provider={activeProvider} size="sm" />
        <span
          className={`truncate font-mono text-ink ${
            compact ? "max-w-[130px]" : "max-w-[165px]"
          }`}
        >
          {activeModel}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-ink-muted shrink-0 transition-transform duration-[160ms] ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {mounted && (
        <div
          className={`absolute bottom-full mb-1.5 z-50 w-72 apple-glass dock-shadow rounded-2xl p-1.5 space-y-1.5 ${
            align === "right" ? "right-0 origin-bottom-right" : "left-0 origin-bottom-left"
          } ${exiting ? "anim-popover-up-out pointer-events-none" : "anim-popover-up-in"}`}
        >
          <div className="max-h-64 overflow-y-auto clean-scroll space-y-2 p-0.5">
            {groups.map((grp) => (
              <div key={grp.key} className="space-y-0.5">
                <div className="px-2 py-1 flex items-center gap-1.5 text-[13px] font-semibold text-ink-secondary">
                  <ProviderIcon provider={grp.provider} size="sm" />
                  <span className="truncate">{grp.name}</span>
                </div>
                {grp.models.map((m) => {
                  const isCurrent = grp.isActiveSource && m === activeModel;
                  const token = `${grp.profileId || "env"}:${m}`;
                  return (
                    <button
                      key={token}
                      type="button"
                      disabled={Boolean(switching)}
                      onClick={() => void handleQuickSelect(grp.profileId, m)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 text-[13px] transition-colors cursor-pointer ${
                        isCurrent
                          ? "bg-surface text-ink font-semibold shadow-2xs"
                          : "text-ink-secondary hover:text-ink hover:bg-black/[0.05]"
                      }`}
                    >
                      <span className="font-mono truncate">{m}</span>
                      {isCurrent && (
                        <Check className="w-3.5 h-3.5 text-success shrink-0 anim-check-pop" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="pt-1 border-t border-black/[0.07]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-xl flex items-center gap-2 text-[13px] font-medium text-ink-secondary hover:text-ink hover:bg-black/[0.05] transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 shrink-0" />
              <span>管理服务商与模型设置…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
