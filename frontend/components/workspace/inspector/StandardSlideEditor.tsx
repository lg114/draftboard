"use client";

import {
  Columns2,
  Image as ImageIcon,
  Plus,
} from "lucide-react";
import type {
  Material,
  OutlineItem,
  OutlineLayout,
} from "../../../lib/api";
import { EditableOutlineField } from "../layoutUtils";
import { AutoGrowTextarea, formatAssetLabel } from "./inspectorUtils";

interface StandardSlideEditorProps {
  pid: string;
  item: OutlineItem;
  layout: OutlineLayout;
  imageAssets: Material[];
  primaryInputBase: string;
  onUpdateField: (field: EditableOutlineField, value: string) => void;
  onSplitTwoColumn: () => void;
  onUploadClick: () => void;
}

export function StandardSlideEditor({
  pid,
  item,
  layout,
  imageAssets,
  primaryInputBase,
  onUpdateField,
  onSplitTwoColumn,
  onUploadClick,
}: StandardSlideEditorProps) {

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
                      aria-pressed={selected}
                      onClick={() =>
                        onUpdateField("image_asset_id", img.asset_id)
                      }
                      title={img.asset_id}
                      className={`group rounded-xl overflow-clip p-1.5 text-left transition-colors cursor-pointer ${
                        selected
                          ? "bg-ui-bg-selected ring-1 ring-ui-accent"
                          : "bg-ui-surface hover:bg-ui-control-hover"
                      }`}
                    >
                      <div className="aspect-[16/10] rounded-lg bg-ui-bg overflow-clip flex items-center justify-center mb-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/projects/${pid}/assets/${encodeURIComponent(
                            img.asset_id
                          )}`}
                          alt={img.asset_id}
                          className="w-full h-full object-contain block"
                        />
                      </div>
                      <div
                        className={`text-[12px] truncate px-0.5 font-medium ${
                          selected ? "text-ui-text" : "text-ui-text-secondary"
                        }`}
                      >
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
                className="w-full py-5 px-3 rounded-xl bg-ui-surface hover:bg-ui-control-hover flex flex-col items-center justify-center gap-1.5 text-ui-text-muted hover:text-ui-text transition-colors cursor-pointer"
              >
                <div className="w-8 h-8 rounded-full bg-ui-bg flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <span className="text-[12.5px] font-medium">
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
    </section>
  );
}
