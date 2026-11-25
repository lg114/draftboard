"use client";

import { useState } from "react";
import {
  Columns2,
  Image as ImageIcon,
  Plus,
  Sparkles,
} from "lucide-react";
import type {
  LLMSettingsResponse,
  Material,
  OutlineItem,
  OutlineLayout,
  SlideRefineCandidate,
} from "../../../lib/api";
import { ModelQuickSwitcher } from "../../ModelQuickSwitcher";
import { Collapse } from "../../ui/Collapse";
import { EditableOutlineField, LAYOUT_LABELS } from "../layoutUtils";
import { AutoGrowTextarea, formatAssetLabel } from "./inspectorUtils";

interface StandardSlideEditorProps {
  pid: string;
  item: OutlineItem;
  layout: OutlineLayout;
  imageAssets: Material[];
  primaryInputBase: string;
  refiningMode: string | null;
  refineCandidate: SlideRefineCandidate | null;
  refineNotice: string;
  llmConfigured: boolean;
  activeModelLabel: string;
  llmSettings: LLMSettingsResponse | null;
  onLLMSettingsUpdated?: (next: LLMSettingsResponse) => void;
  onOpenLLMSettings?: () => void;
  onUpdateField: (field: EditableOutlineField, value: string) => void;
  onSplitTwoColumn: () => void;
  onUploadClick: () => void;
  onTriggerRefine: (
    mode: "concise" | "bullets" | "two_column" | "custom",
    instruction?: string
  ) => Promise<void>;
  onDismissCandidate: () => void;
  onApplyCandidate: (candidate: SlideRefineCandidate) => void;
}

export function StandardSlideEditor({
  pid,
  item,
  layout,
  imageAssets,
  primaryInputBase,
  refiningMode,
  refineCandidate,
  refineNotice,
  llmConfigured,
  activeModelLabel,
  llmSettings,
  onLLMSettingsUpdated,
  onOpenLLMSettings,
  onUpdateField,
  onSplitTwoColumn,
  onUploadClick,
  onTriggerRefine,
  onDismissCandidate,
  onApplyCandidate,
}: StandardSlideEditorProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");

  const missingTitle = !item.title.trim();
  const missingSummary = !item.summary.trim();
  const missingColRight =
    layout === "two_column" && !(item.column_right && item.column_right.trim());
  const missingImage =
    layout === "text_image" &&
    !(item.image_asset_id && item.image_asset_id.trim());

  const canSplitSummary =
    item.summary.trim().split(/\r?\n|[。；;]/).filter((s) => s.trim()).length >=
    2;

  return (
    <section className="space-y-4">
      {/* Primary Title Field */}
      <div className="space-y-1.5">
        <label
          htmlFor="input-title"
          className="block text-[13px] font-semibold text-ink"
        >
          幻灯片标题
        </label>
        <input
          id="input-title"
          type="text"
          value={item.title}
          onChange={(e) => onUpdateField("title", e.target.value)}
          placeholder="输入本页主标题…"
          className={`w-full text-[18px] font-semibold tracking-[-0.02em] text-ink placeholder:text-ink-muted bg-surface rounded-xl px-3.5 py-2.5 border outline-none transition-all leading-snug ${
            missingTitle
              ? "border-danger/70 focus:border-danger"
              : "border-black/[0.12] hover:border-black/[0.22] focus:border-ink focus:ring-4 focus:ring-black/[0.06]"
          }`}
        />
        {missingTitle && (
          <p className="text-[13px] text-danger">标题不能为空</p>
        )}
      </div>

      {/* Layout-Aware Primary Body Editors */}
      {layout === "two_column" ? (
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label
              htmlFor="input-summary"
              className="block text-[13px] font-semibold text-ink"
            >
              左栏内容
            </label>
            <AutoGrowTextarea
              id="input-summary"
              value={item.summary}
              minRows={3}
              placeholder="输入左栏要点或对比项…"
              onChange={(val) => onUpdateField("summary", val)}
              className={primaryInputBase}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="input-col-right"
                className="block text-[13px] font-semibold text-ink"
              >
                右栏内容
              </label>
              {canSplitSummary && (
                <button
                  type="button"
                  onClick={onSplitTwoColumn}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-ink underline underline-offset-2 hover:opacity-70 cursor-pointer"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span>从左栏拆分后半段</span>
                </button>
              )}
            </div>
            <AutoGrowTextarea
              id="input-col-right"
              value={item.column_right || ""}
              minRows={3}
              placeholder="输入右栏对比内容…"
              onChange={(val) => onUpdateField("column_right", val)}
              className={`${primaryInputBase} ${
                missingColRight ? "!border-warning-dot/70" : ""
              }`}
            />
            {missingColRight && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p className="text-[13px] text-warning">
                  双栏版式需填写右栏内容
                </p>
                {canSplitSummary && (
                  <button
                    type="button"
                    onClick={onSplitTwoColumn}
                    className="ui-btn-outline px-2.5 py-1 text-[13px]"
                  >
                    一键拆入右栏
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : layout === "text_image" ? (
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label
              htmlFor="input-summary"
              className="block text-[13px] font-semibold text-ink"
            >
              左侧说明文案
            </label>
            <AutoGrowTextarea
              id="input-summary"
              value={item.summary}
              minRows={3}
              placeholder="输入左侧要点说明…"
              onChange={(val) => onUpdateField("summary", val)}
              className={primaryInputBase}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">
                右侧配图
              </span>
              <button
                type="button"
                onClick={onUploadClick}
                className="text-[13px] text-ink underline underline-offset-2 hover:opacity-70 font-medium cursor-pointer"
              >
                + 上传图片
              </button>
            </div>

            {imageAssets.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {imageAssets.map((img, i) => {
                  const selected = item.image_asset_id === img.asset_id;
                  return (
                    <button
                      key={`${img.asset_id}-${i}`}
                      type="button"
                      onClick={() =>
                        onUpdateField("image_asset_id", img.asset_id)
                      }
                      title={img.asset_id}
                      className={`group rounded-xl overflow-hidden bg-surface p-1.5 text-left transition-all cursor-pointer ${
                        selected
                          ? "ring-2 ring-ink/75"
                          : "ring-1 ring-black/[0.1] hover:ring-black/25"
                      }`}
                    >
                      <div className="aspect-[16/10] rounded-lg bg-canvas overflow-hidden flex items-center justify-center mb-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/projects/${pid}/assets/${encodeURIComponent(
                            img.asset_id
                          )}`}
                          alt={img.asset_id}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="text-[13px] text-ink truncate px-0.5 font-medium">
                        {formatAssetLabel(img.asset_id)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <button
                type="button"
                onClick={onUploadClick}
                className="w-full py-5 px-3 rounded-2xl border border-dashed border-border-dashed hover:border-ink bg-surface flex flex-col items-center justify-center gap-1.5 text-ink-secondary hover:text-ink transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-canvas flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium">
                  上传 PNG / JPG 配图
                </span>
              </button>
            )}

            {missingImage && (
              <p className="text-[13px] text-warning flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                <span>请选择一张项目配图后保存</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label
            htmlFor="input-summary"
            className="block text-[13px] font-semibold text-ink"
          >
            {layout === "bullets"
              ? "分点要点（每行一条）"
              : layout === "cover"
              ? "副标题 / 核心提要"
              : layout === "closing"
              ? "结语说明"
              : "正文内容"}
          </label>
          <AutoGrowTextarea
            id="input-summary"
            value={item.summary}
            minRows={layout === "bullets" ? 4 : 3}
            placeholder={
              layout === "bullets"
                ? "每行输入一条分点要点…"
                : "输入本页正文内容…"
            }
            onChange={(val) => onUpdateField("summary", val)}
            className={`${primaryInputBase} ${
              missingSummary ? "!border-danger/70" : ""
            }`}
          />
          {missingSummary && (
            <p className="text-[13px] text-danger">正文内容不能为空</p>
          )}
        </div>
      )}

      {/* Lightweight Inline AI Refine Action Strip */}
      <div className="space-y-2 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-secondary"
            title="对本页标题与正文整体改写，确认后生效"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>本页 AI 精修</span>
          </span>
          {onOpenLLMSettings &&
            (llmSettings ? (
              <ModelQuickSwitcher
                settings={llmSettings}
                onSettingsUpdated={onLLMSettingsUpdated}
                onOpenSettings={onOpenLLMSettings}
                align="right"
                compact={true}
              />
            ) : (
              <button
                type="button"
                onClick={onOpenLLMSettings}
                aria-label="模型设置"
                title={
                  llmConfigured && activeModelLabel
                    ? `当前模型：${activeModelLabel}，点击切换或修改`
                    : "尚未配置大模型，点击前往模型设置"
                }
                className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink transition-colors cursor-pointer min-w-0"
              >
                {!llmConfigured && (
                  <span className="w-1.5 h-1.5 rounded-full bg-warning-dot shrink-0" />
                )}
                <span className="truncate max-w-[160px] font-mono">
                  {llmConfigured && activeModelLabel
                    ? activeModelLabel
                    : "未配置模型"}
                </span>
              </button>
            ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={Boolean(refiningMode)}
            onClick={() => void onTriggerRefine("concise")}
            title="由 AI 整体改写本页标题与正文，确认后生效"
            className="px-3 py-1 rounded-full bg-black/[0.04] hover:bg-surface border border-transparent hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40"
          >
            {refiningMode === "concise"
              ? "处理中…"
              : layout === "cover" || layout === "closing"
              ? "润色整页"
              : "精简整页"}
          </button>
          {(layout === "content" || layout === "two_column") && (
            <button
              type="button"
              disabled={Boolean(refiningMode)}
              onClick={() => void onTriggerRefine("bullets")}
              title="将本页内容重排为分点要点"
              className="px-3 py-1 rounded-full bg-black/[0.04] hover:bg-surface border border-transparent hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {refiningMode === "bullets" ? "提炼中…" : "转分点"}
            </button>
          )}
          {(layout === "content" || layout === "bullets") && (
            <button
              type="button"
              disabled={Boolean(refiningMode)}
              onClick={() => void onTriggerRefine("two_column")}
              title="将本页内容拆分为双栏对比"
              className="px-3 py-1 rounded-full bg-black/[0.04] hover:bg-surface border border-transparent hover:border-black/25 text-ink text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-40"
            >
              {refiningMode === "two_column" ? "拆分中…" : "转双栏"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors cursor-pointer border ${
              customOpen
                ? "bg-surface border-ink/60 text-ink shadow-2xs"
                : "bg-black/[0.04] hover:bg-surface border-transparent hover:border-black/25 text-ink"
            }`}
          >
            自定义
          </button>
        </div>

        {refineNotice && (
          <div className="text-[13px] text-ink-secondary px-1">
            {refineNotice}
          </div>
        )}

        <Collapse open={customOpen}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!customInstruction.trim() || refiningMode) return;
              void onTriggerRefine("custom", customInstruction.trim());
            }}
            className="flex items-center gap-1.5 pt-0.5"
          >
            <input
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="输入整页修改要求（如：更专业简洁、突出关键数据）…"
              className="flex-1 min-w-0 text-[13px] text-ink placeholder:text-ink-muted bg-surface rounded-xl px-3 py-1.5 border border-black/[0.12] hover:border-black/25 focus:border-ink outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={!customInstruction.trim() || Boolean(refiningMode)}
              className="ui-btn-outline px-3 py-1.5 rounded-xl text-[13px] shrink-0"
            >
              {refiningMode === "custom" ? "生成中…" : "生成"}
            </button>
          </form>
        </Collapse>

        {/* Non-Destructive Diff Candidate Card */}
        {refineCandidate && (
          <div className="p-3.5 rounded-2xl bg-surface border border-ink/25 shadow-[0_4px_16px_rgba(0,0,0,0.06)] space-y-2.5 anim-msg-in">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {refineCandidate.source === "fallback"
                    ? "本地规则整理"
                    : "AI 修改建议"}
                </span>
                <span className="font-normal text-ink-muted">确认后生效</span>
              </span>
              {refineCandidate.layout && refineCandidate.layout !== layout && (
                <span className="text-[13px] font-medium text-ink bg-canvas px-2 py-0.5 rounded-full border border-black/[0.08]">
                  切为：
                  {LAYOUT_LABELS[refineCandidate.layout] ||
                    refineCandidate.layout}
                </span>
              )}
            </div>

            {refineCandidate.rationale && (
              <p className="text-[13px] text-ink-secondary leading-snug">
                {refineCandidate.rationale}
              </p>
            )}

            <div className="p-2.5 rounded-xl bg-surface-subtle border border-black/[0.07] space-y-1.5 text-[13px]">
              {refineCandidate.title !== item.title && (
                <div className="font-semibold text-ink pb-1 border-b border-black/[0.06]">
                  标题：{refineCandidate.title}
                </div>
              )}
              <div className="text-ink whitespace-pre-wrap leading-relaxed">
                {refineCandidate.summary}
              </div>
              {refineCandidate.layout === "two_column" &&
                refineCandidate.column_right && (
                  <div className="pt-1.5 border-t border-black/[0.06] text-ink whitespace-pre-wrap leading-relaxed">
                    <span className="text-[13px] font-semibold text-ink-secondary block mb-0.5">
                      右栏对比：
                    </span>
                    {refineCandidate.column_right}
                  </div>
                )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-0.5">
              <button
                type="button"
                onClick={onDismissCandidate}
                className="px-3 py-1 rounded-full text-[13px] font-medium text-ink-secondary hover:text-ink cursor-pointer"
              >
                放弃
              </button>
              <button
                type="button"
                onClick={() => onApplyCandidate(refineCandidate)}
                className="ui-btn-outline px-3.5 py-1 text-[13px]"
              >
                确认应用
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
