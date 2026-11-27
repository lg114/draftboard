"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type {
  BrandKit,
  CanvasElement,
  OutlineItem,
  OutlineLayout,
  ThemeOption,
  ThemeSwatches,
} from "../../../lib/api";
import { CustomSlideLayer } from "../CustomSlideLayer";
import { inferEffectiveLayout, normalizeEscapedNewlines } from "../layoutUtils";

export function BrandOverlay({
  pid,
  brand,
  mutedColor,
  scale,
}: {
  pid: string;
  brand: BrandKit;
  mutedColor: string;
  scale: number;
}) {
  if (!brand.footer_text && !brand.logo_asset_id) return null;
  return (
    <div
      className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 pointer-events-none"
      style={{ transform: `scale(${scale})` }}
    >
      {brand.logo_asset_id && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/projects/${encodeURIComponent(pid)}/assets/${encodeURIComponent(
            brand.logo_asset_id
          )}`}
          alt="brand logo"
          style={{
            position: "absolute",
            left: brand.logo_position === "bottom_left" ? 48 : 840,
            top: brand.logo_position === "bottom_left" ? 502 : 14,
            width: 72,
            height: 24,
            objectFit: "contain",
          }}
        />
      )}
      {brand.footer_text && (
        <div
          style={{
            position: "absolute",
            left:
              brand.logo_asset_id && brand.logo_position === "bottom_left"
                ? 128
                : 48,
            top: 506,
            fontSize: 11,
            color: mutedColor,
          }}
        >
          {brand.footer_text}
        </div>
      )}
    </div>
  );
}

export type RenderableSlideItem = {
  title: string;
  summary: string;
  layout?: OutlineLayout | string | null;
  column_right?: string | null;
  image_asset_id?: string | null;
  custom_bg?: string | null;
  custom_elements?: CanvasElement[] | null;
};

export type StandardEditableField = "title" | "summary" | "column_right";

interface StandardSlideViewProps {
  pid: string;
  item: RenderableSlideItem | OutlineItem;
  layout: OutlineLayout;
  sw: ThemeSwatches;
  scale: number;
  selectedIndex: number;
  total: number;
  brand: BrandKit | null;
  interactive?: boolean;
  onFocusField?: (fieldId: string) => void;
  onUpdateField?: (field: StandardEditableField, value: string) => void;
  initialEditField?: StandardEditableField | null;
  onClearInitialEditField?: () => void;
}

const INLINE_EDIT_RING = "#3D63DD";

function InlineStandardTextarea({
  ariaLabel,
  value,
  placeholder,
  singleLineSubmit = false,
  style,
  onChange,
  onDone,
}: {
  ariaLabel: string;
  value: string;
  placeholder?: string;
  singleLineSubmit?: boolean;
  style: React.CSSProperties;
  onChange: (nextValue: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const placeCaret = () => {
      node.focus({ preventScroll: true });
      node.setSelectionRange(node.value.length, node.value.length);
    };
    placeCaret();
    const raf = window.requestAnimationFrame(placeCaret);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
          return;
        }
        if (singleLineSubmit && e.key === "Enter" && !e.shiftKey) {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      style={{
        ...style,
        margin: 0,
        padding: "2px 6px",
        border: "none",
        borderRadius: 6,
        outline: `2px solid ${INLINE_EDIT_RING}`,
        outlineOffset: 2,
        boxShadow: "0 0 0 4px rgba(61, 99, 221, 0.16)",
        background: "rgba(61, 99, 221, 0.04)",
        resize: "none",
        boxSizing: "border-box",
        fontFamily: "inherit",
        overflow: "auto",
        caretColor: style.color || "currentColor",
        userSelect: "text",
        WebkitUserSelect: "text",
        zIndex: 25,
      }}
    />
  );
}

export function StandardSlideView({
  pid,
  item,
  layout,
  sw,
  scale,
  selectedIndex,
  total,
  brand,
  interactive = true,
  onFocusField,
  onUpdateField,
  initialEditField = null,
  onClearInitialEditField,
}: StandardSlideViewProps) {
  const [editingField, setEditingField] =
    useState<StandardEditableField | null>(initialEditField);

  useEffect(() => {
    setEditingField(null);
  }, [selectedIndex, layout, interactive]);

  useEffect(() => {
    if (interactive && onUpdateField && initialEditField) {
      setEditingField(initialEditField);
      onClearInitialEditField?.();
    }
  }, [interactive, onUpdateField, initialEditField, onClearInitialEditField]);

  const isHero = layout === "cover" || layout === "closing";
  const slideBg = isHero ? sw.cover_bg : sw.bg;
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;
  const canFocus = Boolean(interactive && onFocusField);
  const canInlineEdit = Boolean(interactive && onUpdateField);
  const slotClass = canFocus || canInlineEdit ? "clickable-slot" : undefined;

  const slotProps = (fieldId: string, field: StandardEditableField) => {
    if (!canFocus && !canInlineEdit) return {};
    return {
      title: canInlineEdit ? "点击直接在画布编辑文字" : undefined,
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        if (canInlineEdit) {
          setEditingField(field);
          return;
        }
        if (canFocus) {
          onFocusField!(fieldId);
        }
      },
      onDoubleClick: (e: React.MouseEvent) => {
        if (!canInlineEdit) return;
        e.stopPropagation();
        setEditingField(field);
      },
    };
  };

  return (
    <div
      onClick={() => {
        if (editingField) setEditingField(null);
      }}
      className={`w-[960px] h-[540px] origin-top-left absolute top-0 left-0 text-left ${
        interactive
          ? "transition-colors duration-200"
          : "pointer-events-none select-none"
      }`}
      style={{
        transform: `scale(${scale})`,
        backgroundColor: slideBg,
      }}
    >
      {layout === "cover" ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 144,
              width: 60,
              height: 3.5,
              borderRadius: 99,
              backgroundColor: sw.accent,
            }}
          />
          {canInlineEdit && editingField === "title" ? (
            <InlineStandardTextarea
              ariaLabel="编辑封面主标题"
              value={item.title || ""}
              placeholder="输入封面主标题…"
              singleLineSubmit
              onChange={(val) => onUpdateField!("title", val)}
              onDone={() => setEditingField(null)}
              style={{
                position: "absolute",
                left: 42,
                top: 170,
                width: 876,
                height: 118,
                fontSize: 44,
                lineHeight: "54px",
                fontWeight: 700,
                letterSpacing: "-0.028em",
                color: titleCol,
                textAlign: "left",
              }}
            />
          ) : (
            <div
              {...slotProps("input-title", "title")}
              className={slotClass}
              style={{
                position: "absolute",
                left: 48,
                top: 172,
                width: 864,
                fontSize: 44,
                lineHeight: "54px",
                fontWeight: 700,
                letterSpacing: "-0.028em",
                color: titleCol,
                textAlign: "left",
              }}
            >
              {item.title || "未命名标题"}
            </div>
          )}
          {canInlineEdit && editingField === "summary" ? (
            <InlineStandardTextarea
              ariaLabel="编辑封面副标题"
              value={normalizeEscapedNewlines(item.summary || "")}
              placeholder="输入封面副标题或导语…"
              onChange={(val) => onUpdateField!("summary", val)}
              onDone={() => setEditingField(null)}
              style={{
                position: "absolute",
                left: 42,
                top: 296,
                width: 832,
                height: 176,
                fontSize: 20,
                lineHeight: "31px",
                whiteSpace: "pre-wrap",
                color: bodyCol,
                textAlign: "left",
              }}
            />
          ) : (
            <div
              {...slotProps("input-summary", "summary")}
              className={slotClass}
              style={{
                position: "absolute",
                left: 48,
                top: 298,
                width: 820,
                minHeight: 38,
                fontSize: 20,
                lineHeight: "31px",
                whiteSpace: "pre-wrap",
                color: item.summary ? bodyCol : sw.muted,
                textAlign: "left",
              }}
            >
              {item.summary
                ? normalizeEscapedNewlines(item.summary)
                : interactive
                ? "（双击添加副标题）"
                : ""}
            </div>
          )}
        </>
      ) : layout === "closing" ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 452,
              top: 140,
              width: 56,
              height: 3,
              borderRadius: 99,
              backgroundColor: sw.accent,
            }}
          />
          {canInlineEdit && editingField === "title" ? (
            <InlineStandardTextarea
              ariaLabel="编辑尾页标题"
              value={item.title || ""}
              placeholder="输入尾页标题…"
              singleLineSubmit
              onChange={(val) => onUpdateField!("title", val)}
              onDone={() => setEditingField(null)}
              style={{
                position: "absolute",
                left: 42,
                top: 166,
                width: 876,
                height: 76,
                fontSize: 34,
                lineHeight: "44px",
                fontWeight: 700,
                letterSpacing: "-0.022em",
                color: titleCol,
                textAlign: "center",
              }}
            />
          ) : (
            <div
              {...slotProps("input-title", "title")}
              className={slotClass}
              style={{
                position: "absolute",
                left: 48,
                top: 168,
                width: 864,
                fontSize: 34,
                lineHeight: "44px",
                fontWeight: 700,
                letterSpacing: "-0.022em",
                color: titleCol,
                textAlign: "center",
              }}
            >
              {item.title || "谢谢聆听"}
            </div>
          )}
          {canInlineEdit && editingField === "summary" ? (
            <InlineStandardTextarea
              ariaLabel="编辑尾页结语"
              value={normalizeEscapedNewlines(item.summary || "")}
              placeholder="输入结语或行动呼吁…"
              onChange={(val) => onUpdateField!("summary", val)}
              onDone={() => setEditingField(null)}
              style={{
                position: "absolute",
                left: 42,
                top: 248,
                width: 876,
                height: 176,
                fontSize: 20,
                lineHeight: "32px",
                whiteSpace: "pre-wrap",
                color: bodyCol,
                textAlign: "center",
              }}
            />
          ) : (
            <div
              {...slotProps("input-summary", "summary")}
              className={slotClass}
              style={{
                position: "absolute",
                left: 48,
                top: 250,
                width: 864,
                minHeight: 38,
                fontSize: 20,
                lineHeight: "32px",
                whiteSpace: "pre-wrap",
                color: item.summary ? bodyCol : sw.muted,
                textAlign: "center",
              }}
            >
              {item.summary
                ? normalizeEscapedNewlines(item.summary)
                : interactive
                ? "（双击添加结语）"
                : ""}
            </div>
          )}
          <div
            style={{
              position: "absolute",
              left: 220,
              top: 444,
              width: 520,
              height: 1,
              backgroundColor: sw.divider,
            }}
          />
        </>
      ) : (
        <>
          {canInlineEdit && editingField === "title" ? (
            <InlineStandardTextarea
              ariaLabel="编辑页面标题"
              value={item.title || ""}
              placeholder="输入页面标题…"
              singleLineSubmit
              onChange={(val) => onUpdateField!("title", val)}
              onDone={() => setEditingField(null)}
              style={{
                position: "absolute",
                left: 42,
                top: 26,
                width: 876,
                height: 70,
                fontSize: 28,
                lineHeight: "36px",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: titleCol,
              }}
            />
          ) : (
            <div
              {...slotProps("input-title", "title")}
              className={slotClass}
              style={{
                position: "absolute",
                left: 48,
                top: 28,
                width: 864,
                fontSize: 28,
                lineHeight: "36px",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: titleCol,
              }}
            >
              {item.title || "未命名标题"}
            </div>
          )}
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 104,
              width: 864,
              height: 1,
              backgroundColor: sw.divider,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 103,
              width: 60,
              height: 2.5,
              borderRadius: 99,
              backgroundColor: sw.accent,
            }}
          />

          {layout === "bullets" ? (
            canInlineEdit && editingField === "summary" ? (
              <InlineStandardTextarea
                ariaLabel="编辑要点列表"
                value={normalizeEscapedNewlines(item.summary || "")}
                placeholder="每行输入一条核心要点…"
                onChange={(val) => onUpdateField!("summary", val)}
                onDone={() => setEditingField(null)}
                style={{
                  position: "absolute",
                  left: 42,
                  top: 122,
                  width: 876,
                  height: 364,
                  fontSize: 20,
                  lineHeight: "34px",
                  whiteSpace: "pre-wrap",
                  color: bodyCol,
                }}
              />
            ) : (
              <ul
                {...slotProps("input-summary", "summary")}
                className={slotClass}
                style={{
                  position: "absolute",
                  left: 48,
                  top: 124,
                  width: 864,
                  minHeight: 80,
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                }}
              >
                {(() => {
                  const lines = normalizeEscapedNewlines(item.summary || "")
                    .split("\n")
                    .map((s) => s.replace(/^[-*•·]\s+/, "").trim())
                    .filter(Boolean);
                  if (lines.length === 0) {
                    return interactive ? (
                      <li
                        style={{
                          fontSize: 20,
                          lineHeight: "29px",
                          color: sw.muted,
                        }}
                      >
                        （双击添加要点）
                      </li>
                    ) : null;
                  }
                  return lines.map((line, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 14,
                        fontSize: 20,
                        lineHeight: "29px",
                        color: bodyCol,
                      }}
                    >
                      <span
                        style={{
                          marginTop: 11,
                          width: 6.5,
                          height: 6.5,
                          borderRadius: 99,
                          backgroundColor: sw.accent,
                          flexShrink: 0,
                        }}
                      />
                      <span>{line}</span>
                    </li>
                  ));
                })()}
              </ul>
            )
          ) : layout === "two_column" ? (
            <>
              <div
                style={{
                  position: "absolute",
                  left: 48,
                  top: 120,
                  width: 412,
                  height: 1,
                  backgroundColor: sw.divider,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 500,
                  top: 120,
                  width: 412,
                  height: 1,
                  backgroundColor: sw.divider,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 480,
                  top: 126,
                  width: 1,
                  height: 350,
                  backgroundColor: sw.divider,
                }}
              />
              {canInlineEdit && editingField === "summary" ? (
                <InlineStandardTextarea
                  ariaLabel="编辑左栏内容"
                  value={normalizeEscapedNewlines(item.summary || "")}
                  placeholder="输入左栏内容…"
                  onChange={(val) => onUpdateField!("summary", val)}
                  onDone={() => setEditingField(null)}
                  style={{
                    position: "absolute",
                    left: 42,
                    top: 126,
                    width: 424,
                    height: 356,
                    fontSize: 20,
                    lineHeight: "29px",
                    whiteSpace: "pre-wrap",
                    color: bodyCol,
                  }}
                />
              ) : (
                <div
                  {...slotProps("input-summary", "summary")}
                  className={slotClass}
                  style={{
                    position: "absolute",
                    left: 48,
                    top: 128,
                    width: 412,
                    minHeight: 80,
                    fontSize: 20,
                    lineHeight: "29px",
                    whiteSpace: "pre-wrap",
                    color: item.summary ? bodyCol : sw.muted,
                  }}
                >
                  {item.summary
                    ? normalizeEscapedNewlines(item.summary)
                    : interactive
                    ? "（双击填写左栏内容）"
                    : ""}
                </div>
              )}
              {canInlineEdit && editingField === "column_right" ? (
                <InlineStandardTextarea
                  ariaLabel="编辑右栏内容"
                  value={normalizeEscapedNewlines(item.column_right || "")}
                  placeholder="输入右栏内容…"
                  onChange={(val) => onUpdateField!("column_right", val)}
                  onDone={() => setEditingField(null)}
                  style={{
                    position: "absolute",
                    left: 494,
                    top: 126,
                    width: 424,
                    height: 356,
                    fontSize: 20,
                    lineHeight: "29px",
                    whiteSpace: "pre-wrap",
                    color: bodyCol,
                  }}
                />
              ) : (
                <div
                  {...slotProps("input-col-right", "column_right")}
                  className={slotClass}
                  style={{
                    position: "absolute",
                    left: 500,
                    top: 128,
                    width: 412,
                    minHeight: 80,
                    fontSize: 20,
                    lineHeight: "29px",
                    whiteSpace: "pre-wrap",
                    color: item.column_right ? bodyCol : sw.muted,
                  }}
                >
                  {item.column_right
                    ? normalizeEscapedNewlines(item.column_right)
                    : interactive
                    ? "（双击填写右栏内容）"
                    : ""}
                </div>
              )}
            </>
          ) : layout === "text_image" ? (
            <>
              {canInlineEdit && editingField === "summary" ? (
                <InlineStandardTextarea
                  ariaLabel="编辑图文页正文"
                  value={normalizeEscapedNewlines(item.summary || "")}
                  placeholder="输入左侧说明内容…"
                  onChange={(val) => onUpdateField!("summary", val)}
                  onDone={() => setEditingField(null)}
                  style={{
                    position: "absolute",
                    left: 42,
                    top: 124,
                    width: 400,
                    height: 364,
                    fontSize: 20,
                    lineHeight: "29px",
                    whiteSpace: "pre-wrap",
                    color: bodyCol,
                  }}
                />
              ) : (
                <div
                  {...slotProps("input-summary", "summary")}
                  className={slotClass}
                  style={{
                    position: "absolute",
                    left: 48,
                    top: 126,
                    width: 388,
                    minHeight: 80,
                    fontSize: 20,
                    lineHeight: "29px",
                    whiteSpace: "pre-wrap",
                    color: item.summary ? bodyCol : sw.muted,
                  }}
                >
                  {item.summary
                    ? normalizeEscapedNewlines(item.summary)
                    : interactive
                    ? "（双击添加左侧说明）"
                    : ""}
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  left: 456,
                  top: 120,
                  width: 456,
                  height: 372,
                  backgroundColor: item.image_asset_id
                    ? "transparent"
                    : sw.surface,
                  borderRadius: item.image_asset_id ? 0 : 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {item.image_asset_id ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/projects/${encodeURIComponent(pid)}/assets/${encodeURIComponent(
                      item.image_asset_id
                    )}`}
                    alt={item.image_asset_id}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      color: sw.muted,
                      fontSize: 15,
                    }}
                  >
                    <ImageIcon className="w-8 h-8 opacity-60" />
                    {interactive && <span>请在右侧选择配图</span>}
                  </div>
                )}
              </div>
            </>
          ) : canInlineEdit && editingField === "summary" ? (
            <InlineStandardTextarea
              ariaLabel="编辑正文内容"
              value={normalizeEscapedNewlines(item.summary || "")}
              placeholder="输入本页核心内容…"
              onChange={(val) => onUpdateField!("summary", val)}
              onDone={() => setEditingField(null)}
              style={{
                position: "absolute",
                left: 42,
                top: 124,
                width: 876,
                height: 364,
                fontSize: 20,
                lineHeight: "30px",
                whiteSpace: "pre-wrap",
                color: bodyCol,
              }}
            />
          ) : (
            <div
              {...slotProps("input-summary", "summary")}
              className={slotClass}
              style={{
                position: "absolute",
                left: 48,
                top: 126,
                width: 864,
                minHeight: 80,
                fontSize: 20,
                lineHeight: "30px",
                whiteSpace: "pre-wrap",
                color: item.summary ? bodyCol : sw.muted,
              }}
            >
              {item.summary
                ? normalizeEscapedNewlines(item.summary)
                : interactive
                ? "（双击添加正文内容）"
                : ""}
            </div>
          )}
        </>
      )}

      {layout !== "cover" && brand?.logo_asset_id && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/projects/${encodeURIComponent(pid)}/assets/${encodeURIComponent(
            brand.logo_asset_id
          )}`}
          alt="brand logo"
          style={{
            position: "absolute",
            left: brand.logo_position === "bottom_left" ? 48 : 840,
            top: brand.logo_position === "bottom_left" ? 502 : 14,
            width: 72,
            height: 24,
            objectFit: "contain",
            pointerEvents: "none",
          }}
        />
      )}
      {layout !== "cover" && brand?.footer_text && (
        <div
          style={{
            position: "absolute",
            left:
              brand.logo_asset_id && brand.logo_position === "bottom_left"
                ? 128
                : 48,
            bottom: 18,
            fontSize: 11,
            color: sw.muted,
            pointerEvents: "none",
          }}
        >
          {brand.footer_text}
        </div>
      )}
      {layout !== "cover" && (
        <div
          style={{
            position: "absolute",
            right: 48,
            bottom: 18,
            fontSize: 12,
            color: sw.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {String(selectedIndex + 1).padStart(2, "0")} /{" "}
          {String(total).padStart(2, "0")}
        </div>
      )}
    </div>
  );
}

/**
 * Unified 960x540 proportional slide renderer for thumbnails, presenter previews,
 * and library cards. Renders either freeform CustomSlideLayer or StandardSlideView.
 * If `scale` is omitted, measures its own container width via ResizeObserver.
 */
export function SlideRenderer({
  pid,
  item,
  index,
  total,
  theme,
  brand = null,
  scale: fixedScale,
}: {
  pid: string;
  item: RenderableSlideItem;
  index: number;
  total: number;
  theme: ThemeOption;
  brand?: BrandKit | null;
  scale?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measuredScale, setMeasuredScale] = useState(fixedScale ?? 0.35);

  useEffect(() => {
    if (fixedScale !== undefined) return;
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setMeasuredScale(w / 960);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [fixedScale]);

  const scale = fixedScale ?? measuredScale;
  const isCustom = Boolean(
    item.custom_elements && item.custom_elements.length > 0
  );
  const layout = inferEffectiveLayout(item.layout, index, total);
  const sw = theme.swatches;

  const inner =
    isCustom && item.custom_elements ? (
      <>
        <CustomSlideLayer
          pid={pid}
          customBg={item.custom_bg}
          elements={item.custom_elements}
          theme={theme}
          scale={scale}
          interactive={false}
        />
        {brand && (
          <BrandOverlay
            pid={pid}
            brand={brand}
            mutedColor={sw.muted}
            scale={scale}
          />
        )}
      </>
    ) : (
      <StandardSlideView
        pid={pid}
        item={item}
        layout={layout}
        sw={sw}
        scale={scale}
        selectedIndex={index}
        total={total}
        brand={brand}
        interactive={false}
      />
    );

  if (fixedScale !== undefined) {
    return inner;
  }

  const isHero = layout === "cover" || layout === "closing";
  const hostBg = isCustom
    ? item.custom_bg || sw.bg
    : isHero
    ? sw.cover_bg
    : sw.bg;

  return (
    <div
      ref={hostRef}
      style={{ backgroundColor: hostBg }}
      className="w-full h-full relative overflow-hidden select-none"
    >
      {inner}
    </div>
  );
}
