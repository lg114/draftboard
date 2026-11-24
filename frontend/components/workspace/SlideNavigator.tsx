"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Image as ImageIcon } from "lucide-react";
import type { BrandKit, Outline, OutlineItem, ThemeOption } from "../../lib/api";
import { CustomSlideLayer } from "./CustomSlideLayer";
import { inferEffectiveLayout, normalizeEscapedNewlines } from "./layoutUtils";

interface SlideNavigatorProps {
  pid: string;
  outline: Outline;
  selectedIndex: number;
  activeTheme: ThemeOption;
  brand?: BrandKit | null;
  issueSlideIndices: Set<number>;
  onSelectIndex: (idx: number) => void;
  onMoveItem: (idx: number, delta: number) => void;
  onReorderItem?: (fromIdx: number, toIdx: number) => void;
  onDuplicateItem?: (idx: number) => void;
  onDeleteItem: (idx: number) => void;
  onAddItem: () => void;
}

/**
 * True 960x540 proportional slide thumbnail renderer matching the main stage
 * and presenter filmstrip 1:1 (including all 6 standard layouts, custom canvas
 * elements, and optional brand logo/footer overlay).
 */
function ProportionalSlideThumb({
  pid,
  item,
  index,
  total,
  theme,
  brand,
  scale,
}: {
  pid: string;
  item: OutlineItem;
  index: number;
  total: number;
  theme: ThemeOption;
  brand?: BrandKit | null;
  scale: number;
}) {
  const sw = theme.swatches;
  const isCustomCanvas = Boolean(
    item.custom_elements && item.custom_elements.length > 0
  );
  const layout = inferEffectiveLayout(item.layout, index, total);
  const isHero = layout === "cover" || layout === "closing";
  const slideBg = isHero ? sw.cover_bg : sw.bg;
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;
  const cleanSummary = normalizeEscapedNewlines(item.summary || "");
  const cleanColRight = normalizeEscapedNewlines(item.column_right || "");

  const brandOverlay =
    brand && (brand.footer_text || brand.logo_asset_id) ? (
      <>
        {brand.logo_asset_id && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/projects/${encodeURIComponent(pid)}/assets/${encodeURIComponent(
              brand.logo_asset_id
            )}`}
            alt=""
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
              color: sw.muted,
            }}
          >
            {brand.footer_text}
          </div>
        )}
      </>
    ) : null;

  if (isCustomCanvas && item.custom_elements) {
    return (
      <>
        <CustomSlideLayer
          pid={pid}
          customBg={item.custom_bg}
          elements={item.custom_elements}
          theme={theme}
          scale={scale}
          interactive={false}
        />
        {brandOverlay && (
          <div
            className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 pointer-events-none"
            style={{ transform: `scale(${scale})` }}
          >
            {brandOverlay}
          </div>
        )}
      </>
    );
  }

  return (
    <div
      className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 pointer-events-none select-none"
      style={{ transform: `scale(${scale})`, backgroundColor: slideBg }}
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
          <div
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
            }}
          >
            {item.title || "未命名标题"}
          </div>
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 298,
              width: 820,
              fontSize: 20,
              lineHeight: "31px",
              whiteSpace: "pre-wrap",
              color: bodyCol,
            }}
          >
            {cleanSummary}
          </div>
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
          <div
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
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 250,
              width: 864,
              fontSize: 20,
              lineHeight: "32px",
              whiteSpace: "pre-wrap",
              color: bodyCol,
              textAlign: "center",
            }}
          >
            {cleanSummary}
          </div>
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
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 28,
              width: 864,
              fontSize: 26,
              lineHeight: "34px",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: titleCol,
            }}
          >
            {item.title || "未命名标题"}
          </div>
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 102,
              width: 864,
              height: 1,
              backgroundColor: sw.divider,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 48,
              top: 101.5,
              width: 44,
              height: 2,
              borderRadius: 99,
              backgroundColor: sw.accent,
            }}
          />

          {layout === "bullets" ? (
            <ul
              style={{
                position: "absolute",
                left: 48,
                top: 126,
                width: 864,
                fontSize: 20,
                lineHeight: "31px",
                color: bodyCol,
                listStyle: "none",
                margin: 0,
                padding: 0,
              }}
            >
              {cleanSummary
                .split("\n")
                .map((l) => l.replace(/^[-*•·]\s+/, "").trim())
                .filter(Boolean)
                .slice(0, 6)
                .map((line, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "99px",
                        backgroundColor: sw.accent,
                        marginTop: 12,
                        flexShrink: 0,
                      }}
                    />
                    <span>{line}</span>
                  </li>
                ))}
            </ul>
          ) : layout === "two_column" ? (
            <>
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
              <div
                style={{
                  position: "absolute",
                  left: 48,
                  top: 128,
                  width: 412,
                  fontSize: 20,
                  lineHeight: "29px",
                  whiteSpace: "pre-wrap",
                  color: bodyCol,
                }}
              >
                {cleanSummary}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 500,
                  top: 128,
                  width: 412,
                  fontSize: 20,
                  lineHeight: "29px",
                  whiteSpace: "pre-wrap",
                  color: bodyCol,
                }}
              >
                {cleanColRight}
              </div>
            </>
          ) : layout === "text_image" ? (
            <>
              <div
                style={{
                  position: "absolute",
                  left: 48,
                  top: 126,
                  width: 388,
                  fontSize: 20,
                  lineHeight: "29px",
                  whiteSpace: "pre-wrap",
                  color: bodyCol,
                }}
              >
                {cleanSummary}
              </div>
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
                    src={`/api/projects/${encodeURIComponent(
                      pid
                    )}/assets/${encodeURIComponent(item.image_asset_id)}`}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <ImageIcon
                    className="w-10 h-10 opacity-40"
                    style={{ color: sw.muted }}
                  />
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                position: "absolute",
                left: 48,
                top: 126,
                width: 864,
                fontSize: 20,
                lineHeight: "30px",
                whiteSpace: "pre-wrap",
                color: bodyCol,
              }}
            >
              {cleanSummary}
            </div>
          )}
        </>
      )}

      {brandOverlay}

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
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(total).padStart(2, "0")}
        </div>
      )}
    </div>
  );
}

export function SlideNavigator({
  pid,
  outline,
  selectedIndex,
  activeTheme,
  brand = null,
  issueSlideIndices,
  onSelectIndex,
  onMoveItem,
  onReorderItem,
  onDuplicateItem,
  onDeleteItem,
  onAddItem,
}: SlideNavigatorProps) {
  const sw = activeTheme.swatches;
  const total = outline.items.length;
  const firstThumbRef = useRef<HTMLDivElement | null>(null);
  const [thumbScale, setThumbScale] = useState(0.18);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: "before" | "after";
  } | null>(null);

  useEffect(() => {
    const el = firstThumbRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setThumbScale(w / 960);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [total]);

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || !onReorderItem) {
      setDragIdx(null);
      setDropTarget(null);
      return;
    }
    const pos = dropTarget?.position ?? "before";
    let dest = pos === "after" ? targetIdx + 1 : targetIdx;
    if (dragIdx < dest) dest -= 1;
    dest = Math.max(0, Math.min(total - 1, dest));
    if (dest !== dragIdx) {
      onReorderItem(dragIdx, dest);
    }
    setDragIdx(null);
    setDropTarget(null);
  };

  return (
    <aside className="w-[180px] xl:w-[224px] shrink-0 bg-canvas border-r border-black/[0.08] flex flex-col min-h-0">
      <div className="flex-1 px-3 py-3.5 space-y-3 overflow-y-auto clean-scroll">
        {outline.items.map((item, idx) => {
          const active = idx === selectedIndex;
          const layout = inferEffectiveLayout(item.layout, idx, total);
          const isHero = layout === "cover" || layout === "closing";
          const bg = isHero ? sw.cover_bg : sw.bg;
          const hasError = issueSlideIndices.has(idx);
          const needsEvidence = item.evidence_status !== "supported";
          const isDragging = dragIdx === idx;
          const showBeforeLine =
            dragIdx !== null &&
            dragIdx !== idx &&
            dropTarget?.index === idx &&
            dropTarget.position === "before";
          const showAfterLine =
            dragIdx !== null &&
            dragIdx !== idx &&
            dropTarget?.index === idx &&
            dropTarget.position === "after";

          return (
            <div
              key={item.outline_item_id}
              draggable={total > 1 && Boolean(onReorderItem)}
              onDragStart={(e) => {
                setDragIdx(idx);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(idx));
              }}
              onDragOver={(e) => {
                if (dragIdx === null || dragIdx === idx) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const pos =
                  e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                setDropTarget((prev) =>
                  prev?.index === idx && prev.position === pos
                    ? prev
                    : { index: idx, position: pos }
                );
              }}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={() => {
                setDragIdx(null);
                setDropTarget(null);
              }}
              onClick={() => onSelectIndex(idx)}
              title={total > 1 ? "点击切换页面，或拖拽调整页序" : undefined}
              className={`w-full flex items-start gap-2 group relative transition-opacity ${
                total > 1 && onReorderItem
                  ? "cursor-grab active:cursor-grabbing"
                  : "cursor-pointer"
              } ${isDragging ? "opacity-40" : "opacity-100"}`}
            >
              {showBeforeLine && (
                <div className="absolute -top-2 left-5 right-0 h-[2px] rounded-full bg-ink pointer-events-none z-20" />
              )}
              {showAfterLine && (
                <div className="absolute -bottom-2 left-5 right-0 h-[2px] rounded-full bg-ink pointer-events-none z-20" />
              )}
              <span
                className={`w-4 text-right pt-0.5 text-[13px] tabular-nums shrink-0 ${
                  active
                    ? "text-ink font-semibold"
                    : "text-ink-muted font-medium"
                }`}
              >
                {idx + 1}
              </span>

              <div className="flex-1 min-w-0 relative">
                <div
                  ref={idx === 0 ? firstThumbRef : undefined}
                  className={`aspect-[16/9] w-full rounded-[5px] overflow-hidden relative transition-[box-shadow,transform,opacity] duration-[160ms] ease-out ${
                    active
                      ? "thumb-selected"
                      : "thumb-idle group-hover:brightness-[0.98]"
                  }`}
                  style={{ backgroundColor: bg }}
                >
                  {(hasError || needsEvidence) && (
                    <span
                      className={`absolute top-1.5 right-1.5 z-10 w-1.5 h-1.5 rounded-full ring-2 ring-white/80 group-hover:opacity-0 transition-opacity ${
                        hasError ? "bg-danger" : "bg-warning-dot"
                      }`}
                      title={hasError ? "该页存在排版或校验问题" : "待补充出处"}
                    />
                  )}
                  <ProportionalSlideThumb
                    pid={pid}
                    item={item}
                    index={idx}
                    total={total}
                    theme={activeTheme}
                    brand={brand}
                    scale={thumbScale}
                  />
                </div>

                {/* Hover-only translucent micro controls */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 apple-glass rounded-md px-1 py-0.5 shadow-sm border border-black/10"
                >
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => onMoveItem(idx, -1)}
                    title="上移"
                    className="px-1 py-0.5 text-ink hover:bg-black/[0.06] rounded disabled:opacity-25 cursor-pointer text-[10px] leading-none"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === total - 1}
                    onClick={() => onMoveItem(idx, 1)}
                    title="下移"
                    className="px-1 py-0.5 text-ink hover:bg-black/[0.06] rounded disabled:opacity-25 cursor-pointer text-[10px] leading-none"
                  >
                    ↓
                  </button>
                  {onDuplicateItem && (
                    <button
                      type="button"
                      onClick={() => onDuplicateItem(idx)}
                      title="复制此页"
                      className="p-0.5 text-ink-secondary hover:text-ink hover:bg-black/[0.06] rounded cursor-pointer transition-colors"
                    >
                      <Copy className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {total > 1 && (
                    <>
                      <span className="w-px h-3 bg-black/15 mx-0.5" />
                      <button
                        type="button"
                        onClick={() => onDeleteItem(idx)}
                        title="删除此页（可立即撤销）"
                        className="px-1 py-0.5 text-ink-muted hover:text-danger hover:bg-danger-bg rounded cursor-pointer text-[10px] leading-none transition-colors"
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-black/[0.07]">
        <button
          type="button"
          onClick={onAddItem}
          className="w-full py-2 rounded-[10px] bg-surface hover:bg-black/[0.02] text-[13px] font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05),0_0_0_1px_rgba(0,0,0,0.08)] transition-all cursor-pointer whitespace-nowrap"
        >
          + 新建幻灯片
        </button>
      </div>
    </aside>
  );
}
