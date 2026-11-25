"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Minus,
  Plus,
  Square,
  Type,
} from "lucide-react";
import type {
  BrandKit,
  Material,
  OutlineLayout,
  ThemeOption,
} from "../../../lib/api";
import { usePresence } from "../../../lib/usePresence";
import { useDismiss } from "../../../lib/useDismiss";
import { LAYOUT_OPTIONS } from "../layoutUtils";
import { LayoutIcon } from "./LayoutIcon";

interface StageDockProps {
  themes: ThemeOption[];
  activeTheme: ThemeOption;
  selectedThemeId: string;
  layout: OutlineLayout;
  autoFit: boolean;
  isCustomCanvas: boolean;
  diffPreviewActive: boolean;
  compactDock: boolean;
  brand: BrandKit | null;
  imageAssets: Material[];
  addPopoverOpen: boolean;
  setAddPopoverOpen: (open: boolean | ((v: boolean) => boolean)) => void;
  onSelectTheme: (themeId: string) => void;
  onSelectLayout: (layout: OutlineLayout) => void;
  onToggleAutoFit: () => void;
  onUpdateBrand?: (brand: BrandKit) => Promise<void>;
  onQuickAddElement?: (kind: "text" | "card" | "line" | "image") => void;
}

export function StageDock({
  themes,
  activeTheme,
  selectedThemeId,
  layout,
  autoFit,
  isCustomCanvas,
  diffPreviewActive,
  compactDock,
  brand,
  imageAssets,
  addPopoverOpen,
  setAddPopoverOpen,
  onSelectTheme,
  onSelectLayout,
  onToggleAutoFit,
  onUpdateBrand,
  onQuickAddElement,
}: StageDockProps) {
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);
  const { mounted: themePopoverMounted, exiting: themePopoverExiting } =
    usePresence(themePopoverOpen, 130);
  const { mounted: addPopoverMounted, exiting: addPopoverExiting } =
    usePresence(addPopoverOpen, 130);

  const [themeTab, setThemeTab] = useState<"themes" | "brand">("themes");
  const [brandDraft, setBrandDraft] = useState<BrandKit>({});
  const [savingBrand, setSavingBrand] = useState(false);

  const sw = activeTheme.swatches;

  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themePopoverRef = useRef<HTMLDivElement | null>(null);
  const addWrapRef = useRef<HTMLDivElement | null>(null);
  useDismiss(themePopoverOpen, () => setThemePopoverOpen(false), [
    themeTriggerRef,
    themePopoverRef,
  ]);
  useDismiss(addPopoverOpen, () => setAddPopoverOpen(false), [addWrapRef]);

  useEffect(() => {
    setBrandDraft({
      accent_hex: brand?.accent_hex || "",
      bg_hex: brand?.bg_hex || "",
      footer_text: brand?.footer_text || "",
      logo_asset_id: brand?.logo_asset_id || "",
      logo_position: brand?.logo_position || "top_right",
    });
  }, [brand, themePopoverOpen]);

  return (
    <div key="standard-layout-dock" className="anim-dock-swap">
      {themePopoverMounted && (
        <div
          ref={themePopoverRef}
          className={`absolute bottom-full left-0 mb-2.5 w-[min(348px,calc(100vw-24px))] apple-glass dock-shadow rounded-2xl p-3 z-50 space-y-2.5 ${
            themePopoverExiting
              ? "anim-popover-up-out pointer-events-none"
              : "anim-popover-up-in"
          }`}
        >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5">
                <button
                  type="button"
                  onClick={() => setThemeTab("themes")}
                  className={`px-3 py-1 rounded-[9px] text-[13px] cursor-pointer transition-all ${
                    themeTab === "themes"
                      ? "bg-surface text-ink font-semibold shadow-2xs"
                      : "text-ink-secondary hover:text-ink font-medium"
                  }`}
                >
                  预设主题
                </button>
                {onUpdateBrand && (
                  <button
                    type="button"
                    onClick={() => setThemeTab("brand")}
                    className={`px-3 py-1 rounded-[9px] text-[13px] cursor-pointer transition-all ${
                      themeTab === "brand"
                        ? "bg-surface text-ink font-semibold shadow-2xs"
                        : "text-ink-secondary hover:text-ink font-medium"
                    }`}
                  >
                    品牌定制
                  </button>
                )}
              </div>
            </div>

            {themeTab === "brand" && onUpdateBrand ? (
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
                    setThemePopoverOpen(false);
                  } finally {
                    setSavingBrand(false);
                  }
                }}
                className="space-y-3 text-[13px]"
              >
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1 block">
                    <span className="text-ink-secondary font-medium">
                      品牌强调色
                    </span>
                    <div className="flex items-center gap-1.5">
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
                        className="w-8 h-8 rounded-lg border border-black/15 cursor-pointer bg-surface p-0.5"
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
                        className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-surface border border-black/15 font-mono text-[13px] text-ink outline-none"
                      />
                    </div>
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-ink-secondary font-medium">
                      画布底色
                    </span>
                    <div className="flex items-center gap-1.5">
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
                        className="w-8 h-8 rounded-lg border border-black/15 cursor-pointer bg-surface p-0.5"
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
                        className="flex-1 min-w-0 h-8 px-2 rounded-lg bg-surface border border-black/15 font-mono text-[13px] text-ink outline-none"
                      />
                    </div>
                  </label>
                </div>

                <label className="space-y-1 block">
                  <span className="text-ink-secondary font-medium">
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
                    className="w-full h-8 px-2.5 rounded-lg bg-surface border border-black/15 text-[13px] text-ink outline-none"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 block">
                    <span className="text-ink-secondary font-medium">
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
                      className="w-full h-8 px-2 rounded-lg bg-surface border border-black/15 text-[13px] text-ink outline-none"
                    >
                      <option value="">不使用 Logo</option>
                      {imageAssets.map((img) => (
                        <option key={img.asset_id} value={img.asset_id}>
                          {img.asset_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-ink-secondary font-medium">
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
                      className="w-full h-8 px-2 rounded-lg bg-surface border border-black/15 text-[13px] text-ink outline-none"
                    >
                      <option value="top_right">右上角</option>
                      <option value="bottom_left">左下角</option>
                    </select>
                  </label>
                </div>

                <div className="flex items-center justify-between pt-1">
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
                        setThemePopoverOpen(false);
                      } finally {
                        setSavingBrand(false);
                      }
                    }}
                    className="text-[13px] text-ink-secondary hover:text-ink cursor-pointer"
                  >
                    恢复主题默认
                  </button>
                  <button
                    type="submit"
                    disabled={savingBrand}
                    className="ui-btn-primary px-4 h-8 text-[13px]"
                  >
                    {savingBrand ? "保存中…" : "应用品牌"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {themes.map((th) => {
                  const active = th.id === selectedThemeId;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      onClick={() => {
                        onSelectTheme(th.id);
                        setThemePopoverOpen(false);
                      }}
                      className={`text-left p-2 rounded-xl transition-all cursor-pointer ${
                        active
                          ? "ring-2 ring-ink bg-black/[0.04]"
                          : "ring-1 ring-black/[0.08] bg-surface hover:bg-canvas"
                      }`}
                    >
                      <div
                        className="aspect-[16/9] rounded-[4px] overflow-hidden mb-1.5 p-2.5 flex flex-col justify-between border border-black/[0.08]"
                        style={{ backgroundColor: th.swatches.cover_bg }}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="w-3.5 h-[2px] rounded-full"
                            style={{ backgroundColor: th.swatches.accent }}
                          />
                          <span
                            className="w-5 h-1 rounded-full opacity-35"
                            style={{ backgroundColor: th.swatches.cover_body }}
                          />
                        </div>
                        <div className="space-y-1">
                          <div
                            className="w-11 h-1.5 rounded-full opacity-90"
                            style={{ backgroundColor: th.swatches.cover_title }}
                          />
                          <div
                            className="w-7 h-1 rounded-full opacity-45"
                            style={{ backgroundColor: th.swatches.cover_body }}
                          />
                        </div>
                      </div>
                      <div className="text-[13px] font-semibold text-ink">
                        {th.name}
                      </div>
                      <div className="text-[13px] text-ink-muted truncate">
                        {th.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
        </div>
      )}

      <div
        className={`apple-glass dock-shadow rounded-2xl px-2 py-1.5 flex items-center justify-center gap-1.5 max-w-full ${
          compactDock ? "flex-wrap" : "flex-nowrap"
        }`}
      >
        <button
          ref={themeTriggerRef}
          type="button"
          onClick={() => setThemePopoverOpen(!themePopoverOpen)}
          aria-expanded={themePopoverOpen}
          aria-haspopup="dialog"
          title={`切换主题：当前「${activeTheme.name}」`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <span
            className="w-4 h-4 rounded-full ring-1 ring-black/15 shrink-0"
            style={{
              background: `radial-gradient(circle at 35% 35%, ${sw.bg} 45%, ${sw.cover_bg} 100%)`,
            }}
          />
          {!compactDock && (
            <span className="text-[13px] font-medium text-ink">
              {activeTheme.name}
            </span>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-ink-muted shrink-0" />
        </button>

        <div className="w-px h-5 bg-black/[0.08] shrink-0" />

        <div
          className={`flex items-center bg-black/[0.06] p-[3px] rounded-xl gap-0.5 flex-nowrap shrink-0 transition-opacity ${
            isCustomCanvas ? "opacity-75 hover:opacity-100" : ""
          }`}
        >
          {LAYOUT_OPTIONS.map((opt) => {
            const active = !isCustomCanvas && layout === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelectLayout(opt.value)}
                title={
                  isCustomCanvas
                    ? `切换回「${opt.label}」标准版式（将退出自由画布，可随时撤销）`
                    : opt.label
                }
                className={`px-2.5 py-1 rounded-[9px] text-[13px] flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? "bg-surface text-ink font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.06)]"
                    : "text-ink-secondary hover:text-ink font-medium"
                }`}
              >
                <LayoutIcon layout={opt.value} />
                {!compactDock && <span>{opt.label}</span>}
              </button>
            );
          })}
        </div>

        <div className="w-px h-5 bg-black/[0.08] shrink-0" />

        <button
          type="button"
          role="switch"
          aria-checked={autoFit}
          onClick={onToggleAutoFit}
          title="文字过多时自动缩小，防止超出版面"
          className="px-2.5 py-1.5 rounded-xl hover:bg-black/[0.05] text-[13px] font-medium text-ink flex items-center gap-2 cursor-pointer transition-colors whitespace-nowrap shrink-0"
        >
          <span
            className={`w-8 h-[18px] rounded-full p-[2px] flex items-center transition-colors shrink-0 ${
              autoFit ? "bg-ink/75" : "bg-black/20"
            }`}
          >
            <span
              className={`w-3.5 h-3.5 rounded-full bg-surface shadow-xs transition-transform ${
                autoFit ? "translate-x-[14px]" : "translate-x-0"
              }`}
            />
          </span>
          {compactDock ? (
            <span className="text-ink-secondary">缩字</span>
          ) : (
            <span>自动缩字</span>
          )}
        </button>

        {isCustomCanvas && !diffPreviewActive && onQuickAddElement && (
          <>
            <div className="w-px h-5 bg-black/[0.08] shrink-0" />
            <div ref={addWrapRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setThemePopoverOpen(false);
                  setAddPopoverOpen((v) => !v);
                }}
                title="向当前自由画布添加元素"
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  addPopoverOpen
                    ? "bg-ink text-white"
                    : "text-ink hover:bg-black/[0.06]"
                }`}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                {!compactDock && <span>添加</span>}
              </button>

              {addPopoverMounted && (
                <>
                  <div
                    className={`absolute bottom-full right-0 mb-2.5 w-[176px] apple-glass dock-shadow rounded-2xl p-1.5 z-50 space-y-0.5 ${
                      addPopoverExiting
                        ? "anim-popover-up-out pointer-events-none"
                        : "anim-popover-up-in"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onQuickAddElement("text")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium text-ink hover:bg-black/[0.06] transition-colors cursor-pointer text-left"
                    >
                      <Type className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                      <span>文本框</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuickAddElement("card")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium text-ink hover:bg-black/[0.06] transition-colors cursor-pointer text-left"
                    >
                      <Square className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                      <span>卡片背景</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuickAddElement("line")}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium text-ink hover:bg-black/[0.06] transition-colors cursor-pointer text-left"
                    >
                      <Minus className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                      <span>分割线</span>
                    </button>
                    <button
                      type="button"
                      disabled={imageAssets.length === 0}
                      onClick={() => onQuickAddElement("image")}
                      title={
                        imageAssets.length === 0
                          ? "请先上传图片素材"
                          : "插入第一张已上传的图片"
                      }
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium text-ink hover:bg-black/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer text-left"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-ink-secondary shrink-0" />
                      <span>
                        {imageAssets.length > 0
                          ? "图片元素"
                          : "图片（需先上传）"}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
