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
          className="block text-[12.5px] font-medium text-ui-text-muted"
        >
          幻灯片标题
        </label>
        <input
          id="input-title"
          type="text"
          value={item.title}
          onChange={(e) => onUpdateField("title", e.target.value)}
          placeholder="输入本页主标题…"
          className={`ui-field w-full text-[15px] font-semibold tracking-[-0.015em] px-3 py-2 leading-snug ${
            missingTitle ? "!border-ui-danger" : ""
          }`}
        />
        {missingTitle && (
          <p className="text-[12.5px] text-ui-danger">标题不能为空</p>
        )}
      </div>

      {/* Layout-Aware Primary Body Editors */}
      {layout === "two_column" ? (
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <label
              htmlFor="input-summary"
              className="block text-[12.5px] font-medium text-ui-text-muted"
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
                className="block text-[12.5px] font-medium text-ui-text-muted"
              >
                右栏内容
              </label>
              {canSplitSummary && (
                <button
                  type="button"
                  onClick={onSplitTwoColumn}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ui-accent-text hover:underline cursor-pointer"
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
                missingColRight ? "!border-ui-warning" : ""
              }`}
            />
            {missingColRight && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p className="text-[12.5px] text-ui-warning">
                  双栏版式需填写右栏内容
                </p>
                {canSplitSummary && (
                  <button
                    type="button"
                    onClick={onSplitTwoColumn}
                    className="ui-btn-subtle px-2.5 py-1 text-[12.5px]"
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
              className="block text-[12.5px] font-medium text-ui-text-muted"
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
              <span className="text-[12.5px] font-medium text-ui-text-muted">
                右侧配图
              </span>
              <button
                type="button"
                onClick={onUploadClick}
                className="text-[12.5px] text-ui-accent-text hover:underline font-medium cursor-pointer"
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
                      className={`group rounded-lg overflow-hidden bg-ui-surface-input p-1.5 text-left transition-all cursor-pointer border ${
                        selected
                          ? "border-ui-accent bg-ui-bg-selected"
                          : "border-ui-border-subtle hover:border-ui-border"
                      }`}
                    >
                      <div className="aspect-[16/10] rounded bg-ui-bg overflow-hidden flex items-center justify-center mb-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/projects/${pid}/assets/${encodeURIComponent(
                            img.asset_id
                          )}`}
                          alt={img.asset_id}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="text-[12.5px] text-ui-text-secondary truncate px-0.5 font-medium">
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
                className="w-full py-5 px-3 rounded-xl border border-dashed border-ui-border-subtle hover:border-ui-border bg-ui-surface-input flex flex-col items-center justify-center gap-1.5 text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-ui-bg-selected flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <span className="text-[13px] font-medium">
                  上传 PNG / JPG 配图
                </span>
              </button>
            )}

            {missingImage && (
              <p className="text-[12.5px] text-ui-warning flex items-center gap-1">
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
            className="block text-[12.5px] font-medium text-ui-text-muted"
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
              missingSummary ? "!border-ui-danger" : ""
            }`}
          />
          {missingSummary && (
            <p className="text-[12.5px] text-ui-danger">正文内容不能为空</p>
          )}
        </div>
      )}

      {/* Lightweight Inline AI Refine Action Strip */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ui-text-muted"
            title="对本页标题与正文整体改写，确认后生效"
          >
            <Sparkles className="w-3.5 h-3.5 text-ui-icon" />
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
                className="inline-flex items-center gap-1.5 text-[12.5px] text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer min-w-0"
              >
                {!llmConfigured && (
                  <span className="w-1.5 h-1.5 rounded-full bg-ui-warning shrink-0" />
                )}
                <span className="truncate max-w-[140px] font-mono">
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
            className="ui-btn-subtle px-2.5 py-1 text-[12.5px]"
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
              className="ui-btn-subtle px-2.5 py-1 text-[12.5px]"
            >
              {refiningMode === "bullets" ? "提炼中…" : "转分点"}
            </button>
          )}
          {(layout === "content" || layout === "bullets") && (
            <button
              type="button"
              disabled={Boolean(refiningMode)}
              onClick={() => void onTriggerRefine("two_column")}
              className="ui-btn-subtle px-2.5 py-1 text-[12.5px]"
            >
              {refiningMode === "two_column" ? "拆分中…" : "转双栏"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-[12.5px] font-medium transition-colors cursor-pointer ${
              customOpen
                ? "bg-ui-bg-selected ring-1 ring-ui-accent text-ui-text"
                : "bg-ui-surface-input text-ui-text-secondary hover:text-ui-text hover:bg-ui-control-hover"
            }`}
          >
            自定义
          </button>
        </div>

        {refineNotice && (
          <div className="text-[12.5px] text-ui-text-muted px-0.5">
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
              placeholder="输入改写要求（如：更简洁、突出数据）…"
              className="ui-field flex-1 min-w-0 text-[13px] px-2.5 py-1.5"
            />
            <button
              type="submit"
              disabled={!customInstruction.trim() || Boolean(refiningMode)}
              className="ui-btn-primary px-3 py-1.5 text-[12.5px] shrink-0"
            >
              {refiningMode === "custom" ? "生成中…" : "生成"}
            </button>
          </form>
        </Collapse>

        {/* Non-Destructive Diff Candidate Card */}
        {refineCandidate && (
          <div className="p-3 rounded-xl bg-ui-surface border border-ui-accent/50 space-y-2.5 anim-msg-in">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-ui-text flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-ui-accent-text shrink-0" />
                <span>
                  {refineCandidate.source === "fallback"
                    ? "本地规则整理"
                    : "AI 修改建议"}
                </span>
              </span>
              {refineCandidate.layout && refineCandidate.layout !== layout && (
                <span className="text-[12px] text-ui-accent-text bg-ui-surface-input px-2 py-0.5 rounded border border-ui-border-subtle">
                  切为：
                  {LAYOUT_LABELS[refineCandidate.layout] ||
                    refineCandidate.layout}
                </span>
              )}
            </div>

            {refineCandidate.rationale && (
              <p className="text-[12.5px] text-ui-text-muted leading-snug">
                {refineCandidate.rationale}
              </p>
            )}

            <div className="p-2.5 rounded-lg bg-ui-bg border border-ui-border-subtle space-y-1.5 text-[13px]">
              {refineCandidate.title !== item.title && (
                <div className="font-semibold text-ui-text pb-1 border-b border-ui-border-subtle">
                  标题：{refineCandidate.title}
                </div>
              )}
              <div className="text-ui-text-secondary whitespace-pre-wrap leading-relaxed">
                {refineCandidate.summary}
              </div>
              {refineCandidate.layout === "two_column" &&
                refineCandidate.column_right && (
                  <div className="pt-1.5 border-t border-ui-border-subtle text-ui-text-secondary whitespace-pre-wrap leading-relaxed">
                    <span className="text-[12px] font-semibold text-ui-text-muted block mb-0.5">
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
                className="px-2.5 py-1 rounded-md text-[12.5px] text-ui-text-muted hover:text-ui-text cursor-pointer"
              >
                放弃
              </button>
              <button
                type="button"
                onClick={() => onApplyCandidate(refineCandidate)}
                className="ui-btn-primary px-3 py-1 text-[12.5px]"
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
