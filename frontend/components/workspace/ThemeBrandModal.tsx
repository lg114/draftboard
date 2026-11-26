"use client";

import { useEffect, useState } from "react";
import { Check, Palette, X } from "lucide-react";
import type { BrandKit, Material, ThemeOption } from "../../lib/api";
import { usePresence } from "../../lib/usePresence";

interface ThemeBrandModalProps {
  open: boolean;
  themes: ThemeOption[];
  activeTheme: ThemeOption;
  selectedThemeId: string;
  autoFit: boolean;
  brand: BrandKit | null;
  imageAssets: Material[];
  onSelectTheme: (themeId: string) => void;
  onToggleAutoFit: () => void;
  onUpdateBrand?: (brand: BrandKit) => Promise<void>;
  onClose: () => void;
}

export function ThemeBrandModal({
  open,
  themes,
  activeTheme,
  selectedThemeId,
  autoFit,
  brand,
  imageAssets,
  onSelectTheme,
  onToggleAutoFit,
  onUpdateBrand,
  onClose,
}: ThemeBrandModalProps) {
  const { mounted, exiting } = usePresence(open, 160);
  const [tab, setTab] = useState<"themes" | "brand">("themes");
  const [brandDraft, setBrandDraft] = useState<BrandKit>({});
  const [savingBrand, setSavingBrand] = useState(false);

  const sw = activeTheme.swatches;

  useEffect(() => {
    setBrandDraft({
      accent_hex: brand?.accent_hex || "",
      bg_hex: brand?.bg_hex || "",
      footer_text: brand?.footer_text || "",
      logo_asset_id: brand?.logo_asset_id || "",
      logo_position: brand?.logo_position || "top_right",
    });
  }, [brand, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="主题与品牌设置"
      onClick={onClose}
      className={`fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4 sm:p-6 ${
        exiting ? "anim-scrim-out pointer-events-none" : "anim-scrim-in"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg bg-ui-surface rounded-xl border border-ui-border-subtle shadow-2xl overflow-hidden flex flex-col max-h-[82vh] ${
          exiting ? "anim-modal-out" : "anim-modal-in"
        }`}
      >
        <div className="px-5 py-3.5 border-b border-ui-border-subtle bg-ui-bg flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-ui-icon shrink-0" />
              <h2 className="text-[14.5px] font-semibold text-ui-text">
                主题与品牌
              </h2>
            </div>
            <div className="flex items-center gap-3 text-[13px]">
              <button
                type="button"
                onClick={() => setTab("themes")}
                className={`cursor-pointer transition-colors ${
                  tab === "themes"
                    ? "text-ui-text font-medium"
                    : "text-ui-text-muted hover:text-ui-text-secondary"
                }`}
              >
                预设主题
              </button>
              {onUpdateBrand && (
                <button
                  type="button"
                  onClick={() => setTab("brand")}
                  className={`cursor-pointer transition-colors ${
                    tab === "brand"
                      ? "text-ui-text font-medium"
                      : "text-ui-text-muted hover:text-ui-text-secondary"
                  }`}
                >
                  品牌定制
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            title="关闭 (Esc)"
            className="p-1.5 rounded-lg text-ui-icon-quiet hover:text-ui-text hover:bg-ui-control-hover cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto clean-scroll space-y-4">
          {tab === "brand" && onUpdateBrand ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSavingBrand(true);
                try {
                  await onUpdateBrand({
                    accent_hex: brandDraft.accent_hex || null,
                    bg_hex: brandDraft.bg_hex || null,
                    footer_text: brandDraft.footer_text || null,
                    logo_asset_id: brandDraft.logo_asset_id || null,
                    logo_position: brandDraft.logo_position || "top_right",
                  });
                  onClose();
                } finally {
                  setSavingBrand(false);
                }
              }}
              className="space-y-4 text-[13px]"
            >
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 block">
                  <span className="text-ui-text-secondary font-medium">
                    品牌强调色
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(brandDraft.accent_hex || "")
                          ? brandDraft.accent_hex!
                          : sw.accent
                      }
                      onChange={(e) =>
                        setBrandDraft((d) => ({
                          ...d,
                          accent_hex: e.target.value,
                        }))
                      }
                      className="w-9 h-9 rounded-lg border border-ui-border-subtle cursor-pointer bg-ui-surface-input p-0.5 shrink-0"
                    />
                    <input
                      type="text"
                      value={brandDraft.accent_hex || ""}
                      onChange={(e) =>
                        setBrandDraft((d) => ({
                          ...d,
                          accent_hex: e.target.value,
                        }))
                      }
                      placeholder={sw.accent}
                      className="ui-field flex-1 min-w-0 h-9 px-2.5 font-mono text-[13px]"
                    />
                  </div>
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-ui-text-secondary font-medium">
                    幻灯片纸面底色
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={
                        /^#[0-9a-fA-F]{6}$/.test(brandDraft.bg_hex || "")
                          ? brandDraft.bg_hex!
                          : sw.bg
                      }
                      onChange={(e) =>
                        setBrandDraft((d) => ({
                          ...d,
                          bg_hex: e.target.value,
                        }))
                      }
                      className="w-9 h-9 rounded-lg border border-ui-border-subtle cursor-pointer bg-ui-surface-input p-0.5 shrink-0"
                    />
                    <input
                      type="text"
                      value={brandDraft.bg_hex || ""}
                      onChange={(e) =>
                        setBrandDraft((d) => ({
                          ...d,
                          bg_hex: e.target.value,
                        }))
                      }
                      placeholder={sw.bg}
                      className="ui-field flex-1 min-w-0 h-9 px-2.5 font-mono text-[13px]"
                    />
                  </div>
                </label>
              </div>

              <label className="space-y-1.5 block">
                <span className="text-ui-text-secondary font-medium">
                  统一页脚文案（非封面页）
                </span>
                <input
                  type="text"
                  value={brandDraft.footer_text || ""}
                  onChange={(e) =>
                    setBrandDraft((d) => ({
                      ...d,
                      footer_text: e.target.value,
                    }))
                  }
                  placeholder="例如：2026 内部汇报 · 机密"
                  className="ui-field w-full h-9 px-3 text-[13px]"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 block">
                  <span className="text-ui-text-secondary font-medium">
                    角落 Logo
                  </span>
                  <select
                    value={brandDraft.logo_asset_id || ""}
                    onChange={(e) =>
                      setBrandDraft((d) => ({
                        ...d,
                        logo_asset_id: e.target.value,
                      }))
                    }
                    className="ui-field w-full h-9 px-2.5 text-[13px]"
                  >
                    <option value="">不使用 Logo</option>
                    {imageAssets.map((img) => (
                      <option key={img.asset_id} value={img.asset_id}>
                        {img.asset_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-ui-text-secondary font-medium">
                    Logo 位置
                  </span>
                  <select
                    value={brandDraft.logo_position || "top_right"}
                    onChange={(e) =>
                      setBrandDraft((d) => ({
                        ...d,
                        logo_position: e.target.value as
                          | "top_right"
                          | "bottom_left",
                      }))
                    }
                    className="ui-field w-full h-9 px-2.5 text-[13px]"
                  >
                    <option value="top_right">右上角</option>
                    <option value="bottom_left">左下角</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-ui-border-subtle">
                <button
                  type="button"
                  disabled={savingBrand}
                  onClick={async () => {
                    setSavingBrand(true);
                    try {
                      await onUpdateBrand({
                        accent_hex: null,
                        bg_hex: null,
                        footer_text: null,
                        logo_asset_id: null,
                        logo_position: "top_right",
                      });
                      onClose();
                    } finally {
                      setSavingBrand(false);
                    }
                  }}
                  className="text-[13px] text-ui-text-muted hover:text-ui-text cursor-pointer"
                >
                  恢复主题默认
                </button>
                <button
                  type="submit"
                  disabled={savingBrand}
                  className="ui-btn-primary px-4 h-9 text-[13px]"
                >
                  {savingBrand ? "保存中…" : "应用品牌"}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {themes.map((th) => {
                  const active = th.id === selectedThemeId;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      onClick={() => onSelectTheme(th.id)}
                      className={`text-left p-2.5 rounded-xl transition-all cursor-pointer border ${
                        active
                          ? "border-ui-accent bg-ui-bg-selected"
                          : "border-ui-border-subtle bg-ui-surface-input hover:bg-ui-control-hover"
                      }`}
                    >
                      <div
                        className="aspect-[16/9] rounded-[4px] overflow-hidden mb-2 p-2.5 flex flex-col justify-between border border-black/10"
                        style={{ backgroundColor: th.swatches.cover_bg }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="w-4 h-[2px] rounded-full"
                            style={{ backgroundColor: th.swatches.accent }}
                          />
                          <span
                            className="w-5 h-1 rounded-full opacity-35"
                            style={{ backgroundColor: th.swatches.cover_body }}
                          />
                        </div>
                        <div className="space-y-1">
                          <div
                            className="w-12 h-1.5 rounded-full opacity-90"
                            style={{ backgroundColor: th.swatches.cover_title }}
                          />
                          <div
                            className="w-8 h-1 rounded-full opacity-45"
                            style={{ backgroundColor: th.swatches.cover_body }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-ui-text">
                          {th.name}
                        </span>
                        {active && (
                          <Check className="w-3.5 h-3.5 text-ui-accent-text shrink-0" />
                        )}
                      </div>
                      <div className="text-[12.5px] text-ui-text-muted truncate mt-0.5">
                        {th.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-ui-border-subtle flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-ui-text">
                    导出自动缩字
                  </div>
                  <div className="text-[12.5px] text-ui-text-muted">
                    导出 PPTX 与交付体检时，文字超框自动逐档缩字（关闭则严格锁定基准字号）
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoFit}
                  onClick={onToggleAutoFit}
                  className={`w-9 h-5 rounded-full p-[2px] flex items-center transition-colors shrink-0 cursor-pointer ${
                    autoFit ? "bg-ui-accent" : "bg-ui-control-active"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full bg-ui-on-accent transition-transform ${
                      autoFit ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
