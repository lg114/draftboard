"use client";

import { Image as ImageIcon } from "lucide-react";
import type {
  BrandKit,
  OutlineItem,
  OutlineLayout,
  ThemeSwatches,
} from "../../../lib/api";
import { normalizeEscapedNewlines } from "../layoutUtils";

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

interface StandardSlideViewProps {
  pid: string;
  item: OutlineItem;
  layout: OutlineLayout;
  sw: ThemeSwatches;
  scale: number;
  selectedIndex: number;
  total: number;
  brand: BrandKit | null;
  onFocusField: (fieldId: string) => void;
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
  onFocusField,
}: StandardSlideViewProps) {
  const isHero = layout === "cover" || layout === "closing";
  const slideBg = isHero ? sw.cover_bg : sw.bg;
  const titleCol = isHero ? sw.cover_title : sw.title;
  const bodyCol = isHero ? sw.cover_body : sw.body;

  return (
    <div
      className="w-[960px] h-[540px] origin-top-left absolute top-0 left-0 transition-colors duration-200"
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
          <div
            onClick={() => onFocusField("input-title")}
            className="clickable-slot"
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
          <div
            onClick={() => onFocusField("input-summary")}
            className="clickable-slot"
            style={{
              position: "absolute",
              left: 48,
              top: 298,
              width: 820,
              fontSize: 20,
              lineHeight: "31px",
              whiteSpace: "pre-wrap",
              color: bodyCol,
              textAlign: "left",
            }}
          >
            {normalizeEscapedNewlines(item.summary)}
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
            onClick={() => onFocusField("input-title")}
            className="clickable-slot"
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
            onClick={() => onFocusField("input-summary")}
            className="clickable-slot"
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
            {normalizeEscapedNewlines(item.summary)}
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
            onClick={() => onFocusField("input-title")}
            className="clickable-slot"
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
            <ul
              onClick={() => onFocusField("input-summary")}
              className="clickable-slot"
              style={{
                position: "absolute",
                left: 48,
                top: 124,
                width: 864,
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {normalizeEscapedNewlines(item.summary)
                .split("\n")
                .map((s) => s.replace(/^[-*•·]\s+/, "").trim())
                .filter(Boolean)
                .map((line, i) => (
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
                ))}
            </ul>
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
              <div
                onClick={() => onFocusField("input-summary")}
                className="clickable-slot"
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
                {normalizeEscapedNewlines(item.summary)}
              </div>
              <div
                onClick={() => onFocusField("input-col-right")}
                className="clickable-slot"
                style={{
                  position: "absolute",
                  left: 500,
                  top: 128,
                  width: 412,
                  fontSize: 20,
                  lineHeight: "29px",
                  whiteSpace: "pre-wrap",
                  color: item.column_right ? bodyCol : sw.muted,
                }}
              >
                {item.column_right
                  ? normalizeEscapedNewlines(item.column_right)
                  : "（请在右侧填写右栏内容）"}
              </div>
            </>
          ) : layout === "text_image" ? (
            <>
              <div
                onClick={() => onFocusField("input-summary")}
                className="clickable-slot"
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
                {normalizeEscapedNewlines(item.summary)}
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
                    src={`/api/projects/${pid}/assets/${encodeURIComponent(
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
                    <span>请在右侧选择配图</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              onClick={() => onFocusField("input-summary")}
              className="clickable-slot"
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
              {normalizeEscapedNewlines(item.summary)}
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
