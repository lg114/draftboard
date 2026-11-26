"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Palette, X } from "lucide-react";
import type { BrandKit, Material, ThemeOption } from "../../lib/api";
import {
  computeActiveTheme,
  hasCustomPalette,
} from "../../hooks/workspace/outlineHelpers";
import { useModalDialog } from "../../lib/useModalDialog";

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
  const { dialogRef, handleDialogClose } = useModalDialog(open, onClose);
  const [tab, setTab] = useState<"themes" | "brand">("themes");
  const [brandDraft, setBrandDraft] = useState<BrandKit>({});
  const [savingBrand, setSavingBrand] = useState(false);

  const customActive = hasCustomPalette(brand);
  const previewTheme = useMemo(
    () => computeActiveTheme(themes, selectedThemeId, brandDraft),
    [themes, selectedThemeId, brandDraft]
  );
  const sw = previewTheme.swatches;

  useEffect(() => {
    setBrandDraft({
      palette_name: brand?.palette_name || "",
      cover_bg_hex: brand?.cover_bg_hex || "",
      bg_hex: brand?.bg_hex || "",
      accent_hex: brand?.accent_hex || "",
      surface_hex: brand?.surface_hex || "",
      footer_text: brand?.footer_text || "",
      logo_asset_id: brand?.logo_asset_id || "",
      logo_position: brand?.logo_position || "top_right",
    });
  }, [brand, open]);

  return (
    <dialog
      ref={dialogRef}
      closedby="any"
      aria-labelledby="theme-brand-title"
      onClose={handleDialogClose}
      className="ui-modal-dialog w-[min(520px,calc(100dvw-2rem))] max-h-[84dvh] rounded-2xl bg-ui-surface ring-1 ring-ui-border-subtle shadow-[0_24px_72px_rgba(0,0,0,0.72)] overflow-clip anim-modal-in"
    >
      {open && (
        <div className="w-full flex flex-col min-h-0 overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-ui-icon shrink-0" />
              <h1
                id="theme-brand-title"
                className="text-[15px] font-semibold tracking-[-0.015em] text-ui-text"
              >
                主题与品牌
              </h1>
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

          {onUpdateBrand && (
            <div className="px-5 pb-3 shrink-0">
              <div
                role="tablist"
                aria-label="主题与品牌模式"
                className="grid grid-cols-2 p-1 rounded-xl bg-ui-bg gap-1 text-[13px]"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "themes"}
                  onClick={() => setTab("themes")}
                  className={`py-1.5 rounded-lg cursor-pointer transition-colors ${
                    tab === "themes"
                      ? "bg-ui-bg-selected text-ui-text font-medium"
                      : "text-ui-text-muted hover:text-ui-text-secondary"
                  }`}
                >
                  预设主题
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "brand"}
                  onClick={() => setTab("brand")}
                  className={`py-1.5 rounded-lg cursor-pointer transition-colors ${
                    tab === "brand"
                      ? "bg-ui-bg-selected text-ui-text font-medium"
                      : "text-ui-text-muted hover:text-ui-text-secondary"
                  }`}
                >
                  自定义配色与品牌
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 px-5 pb-5 overflow-y-auto clean-scroll space-y-4">
            {tab === "brand" && onUpdateBrand ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingBrand(true);
                  try {
                    await onUpdateBrand({
                      palette_name: brandDraft.palette_name || null,
                      cover_bg_hex: brandDraft.cover_bg_hex || null,
                      bg_hex: brandDraft.bg_hex || null,
                      accent_hex: brandDraft.accent_hex || null,
                      surface_hex: brandDraft.surface_hex || null,
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
                {/* Live Contrast-Safe Dual Preview (Cover + Content) */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div
                      className="aspect-[16/9] rounded-lg p-3 flex flex-col justify-between overflow-clip"
                      style={{ backgroundColor: sw.cover_bg }}
                    >
                      <span
                        className="w-6 h-[2.5px] rounded-full"
                        style={{ backgroundColor: sw.accent }}
                      />
                      <div className="space-y-1">
                        <div
                          className="text-[12px] font-semibold leading-tight truncate"
                          style={{ color: sw.cover_title }}
                        >
                          {brandDraft.palette_name?.trim() || "封面预览"}
                        </div>
                        <div
                          className="text-[10px] leading-tight truncate opacity-85"
                          style={{ color: sw.cover_body }}
                        >
                          自动适配高对比度文字色
                        </div>
                      </div>
                    </div>

                    <div
                      className="aspect-[16/9] rounded-lg p-3 flex flex-col justify-between overflow-clip"
                      style={{ backgroundColor: sw.bg }}
                    >
                      <div
                        className="text-[11px] font-semibold leading-tight truncate"
                        style={{ color: sw.title }}
                      >
                        正文页面预览
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div
                          className="rounded p-1.5 space-y-1"
                          style={{ backgroundColor: sw.surface }}
                        >
                          <div
                            className="w-5 h-1 rounded-full"
                            style={{ backgroundColor: sw.accent }}
                          />
                          <div
                            className="w-10 h-1 rounded-full opacity-70"
                            style={{ backgroundColor: sw.body }}
                          />
                        </div>
                        <div
                          className="rounded p-1.5 space-y-1"
                          style={{ backgroundColor: sw.surface }}
                        >
                          <div
                            className="w-7 h-1 rounded-full opacity-85"
                            style={{ backgroundColor: sw.title }}
                          />
                          <div
                            className="w-8 h-1 rounded-full opacity-55"
                            style={{ backgroundColor: sw.muted }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="text-[12px] text-ui-text-muted leading-relaxed">
                    选好封面、正文与强调色，其余文字与图表配色自动按对比度推导；也可以直接让右侧 AI 助手一句话定制。
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="brand-palette-name"
                    className="block text-[12.5px] text-ui-text-secondary font-medium"
                  >
                    配色名称（选填）
                  </label>
                  <input
                    id="brand-palette-name"
                    type="text"
                    value={brandDraft.palette_name || ""}
                    onChange={(e) =>
                      setBrandDraft((d) => ({
                        ...d,
                        palette_name: e.target.value,
                      }))
                    }
                    placeholder="例如：深海蓝金、抹茶米白、暗夜紫"
                    className="ui-field bg-ui-bg w-full h-9 px-3 text-[13px]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="brand-cover-hex"
                      className="block text-[12.5px] text-ui-text-secondary font-medium"
                    >
                      封面底色
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        aria-label="选择封面底色"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(brandDraft.cover_bg_hex || "")
                            ? brandDraft.cover_bg_hex!
                            : sw.cover_bg
                        }
                        onChange={(e) =>
                          setBrandDraft((d) => ({
                            ...d,
                            cover_bg_hex: e.target.value.toUpperCase(),
                          }))
                        }
                        className="w-8 h-9 rounded-lg cursor-pointer bg-ui-bg p-0.5 shrink-0"
                      />
                      <input
                        id="brand-cover-hex"
                        type="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={brandDraft.cover_bg_hex || ""}
                        onChange={(e) =>
                          setBrandDraft((d) => ({
                            ...d,
                            cover_bg_hex: e.target.value,
                          }))
                        }
                        placeholder={sw.cover_bg}
                        className="ui-field bg-ui-bg flex-1 min-w-0 h-9 px-2 font-mono text-[12px]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="brand-bg-hex"
                      className="block text-[12.5px] text-ui-text-secondary font-medium"
                    >
                      正文底色
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        aria-label="选择正文底色"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(brandDraft.bg_hex || "")
                            ? brandDraft.bg_hex!
                            : sw.bg
                        }
                        onChange={(e) =>
                          setBrandDraft((d) => ({
                            ...d,
                            bg_hex: e.target.value.toUpperCase(),
                          }))
                        }
                        className="w-8 h-9 rounded-lg cursor-pointer bg-ui-bg p-0.5 shrink-0"
                      />
                      <input
                        id="brand-bg-hex"
                        type="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={brandDraft.bg_hex || ""}
                        onChange={(e) =>
                          setBrandDraft((d) => ({
                            ...d,
                            bg_hex: e.target.value,
                          }))
                        }
                        placeholder={sw.bg}
                        className="ui-field bg-ui-bg flex-1 min-w-0 h-9 px-2 font-mono text-[12px]"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="brand-accent-hex"
                      className="block text-[12.5px] text-ui-text-secondary font-medium"
                    >
                      主强调色
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="color"
                        aria-label="选择主强调色"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(brandDraft.accent_hex || "")
                            ? brandDraft.accent_hex!
                            : sw.accent
                        }
                        onChange={(e) =>
                          setBrandDraft((d) => ({
                            ...d,
                            accent_hex: e.target.value.toUpperCase(),
                          }))
                        }
                        className="w-8 h-9 rounded-lg cursor-pointer bg-ui-bg p-0.5 shrink-0"
                      />
                      <input
                        id="brand-accent-hex"
                        type="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={brandDraft.accent_hex || ""}
                        onChange={(e) =>
                          setBrandDraft((d) => ({
                            ...d,
                            accent_hex: e.target.value,
                          }))
                        }
                        placeholder={sw.accent}
                        className="ui-field bg-ui-bg flex-1 min-w-0 h-9 px-2 font-mono text-[12px]"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="brand-footer-text"
                    className="block text-[12.5px] text-ui-text-secondary font-medium"
                  >
                    统一页脚文案（非封面页）
                  </label>
                  <input
                    id="brand-footer-text"
                    type="text"
                    value={brandDraft.footer_text || ""}
                    onChange={(e) =>
                      setBrandDraft((d) => ({
                        ...d,
                        footer_text: e.target.value,
                      }))
                    }
                    placeholder="例如：2026 内部汇报"
                    className="ui-field bg-ui-bg w-full h-9 px-3 text-[13px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="brand-logo-asset"
                      className="block text-[12.5px] text-ui-text-secondary font-medium"
                    >
                      角落 Logo
                    </label>
                    <select
                      id="brand-logo-asset"
                      value={brandDraft.logo_asset_id || ""}
                      onChange={(e) =>
                        setBrandDraft((d) => ({
                          ...d,
                          logo_asset_id: e.target.value,
                        }))
                      }
                      className="ui-field bg-ui-bg w-full h-9 px-2.5 text-[13px]"
                    >
                      <option value="">不使用 Logo</option>
                      {imageAssets.map((img) => (
                        <option key={img.asset_id} value={img.asset_id}>
                          {img.asset_id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="brand-logo-pos"
                      className="block text-[12.5px] text-ui-text-secondary font-medium"
                    >
                      Logo 位置
                    </label>
                    <select
                      id="brand-logo-pos"
                      value={brandDraft.logo_position || "top_right"}
                      onChange={(e) =>
                        setBrandDraft((d) => ({
                          ...d,
                          logo_position: e.target.value as
                            | "top_right"
                            | "bottom_left",
                        }))
                      }
                      className="ui-field bg-ui-bg w-full h-9 px-2.5 text-[13px]"
                    >
                      <option value="top_right">右上角</option>
                      <option value="bottom_left">左下角</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    disabled={savingBrand}
                    onClick={async () => {
                      setSavingBrand(true);
                      try {
                        await onUpdateBrand({
                          palette_name: null,
                          cover_bg_hex: null,
                          bg_hex: null,
                          accent_hex: null,
                          surface_hex: null,
                          footer_text: null,
                          logo_asset_id: null,
                          logo_position: "top_right",
                        });
                        onClose();
                      } finally {
                        setSavingBrand(false);
                      }
                    }}
                    className="text-[13px] text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
                  >
                    恢复预设默认
                  </button>
                  <button
                    type="submit"
                    disabled={savingBrand}
                    className="ui-btn-primary px-4 h-9 text-[13px]"
                  >
                    {savingBrand ? "保存中…" : "应用配色与品牌"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {customActive && (
                  <div className="px-3.5 py-2.5 rounded-xl bg-ui-bg flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="text-ui-text-secondary truncate">
                      当前使用自定义配色「
                      <span className="text-ui-text font-medium">
                        {activeTheme.name}
                      </span>
                      」
                    </span>
                    {onUpdateBrand && (
                      <button
                        type="button"
                        onClick={() => setTab("brand")}
                        className="text-ui-accent-text hover:underline shrink-0 cursor-pointer"
                      >
                        去微调
                      </button>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  {themes.map((th) => {
                    const active = !customActive && th.id === selectedThemeId;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => onSelectTheme(th.id)}
                        className={`text-left p-2.5 rounded-xl transition-colors cursor-pointer ${
                          active
                            ? "bg-ui-bg-selected ring-1 ring-ui-accent"
                            : "bg-ui-bg hover:bg-ui-control-hover"
                        }`}
                      >
                        <div
                          className="aspect-[16/9] rounded-md overflow-clip mb-2 p-2.5 flex flex-col justify-between"
                          style={{ backgroundColor: th.swatches.cover_bg }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="w-4 h-[2px] rounded-full"
                              style={{ backgroundColor: th.swatches.accent }}
                            />
                            <span
                              className="w-5 h-1 rounded-full opacity-35"
                              style={{
                                backgroundColor: th.swatches.cover_body,
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <div
                              className="w-12 h-1.5 rounded-full opacity-90"
                              style={{
                                backgroundColor: th.swatches.cover_title,
                              }}
                            />
                            <div
                              className="w-8 h-1 rounded-full opacity-45"
                              style={{
                                backgroundColor: th.swatches.cover_body,
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium text-ui-text">
                            {th.name}
                          </span>
                          {active && (
                            <Check className="w-3.5 h-3.5 text-ui-accent-text shrink-0" />
                          )}
                        </div>
                        <div className="text-[12px] text-ui-text-muted truncate mt-0.5">
                          {th.description}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="px-3.5 py-3 rounded-xl bg-ui-bg flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-ui-text">
                      导出自动缩字
                    </div>
                    <div className="text-[12px] text-ui-text-muted mt-0.5">
                      导出 PPTX 时文字超框自动逐档缩字（关闭则严格锁定基准字号）
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
      )}
    </dialog>
  );
}
