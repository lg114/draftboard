"""
Deterministic PPTX exporter (Step 2: Themes, Images, Speaker Notes & Auto-Fit).

All geometry is computed in points and converted to EMU only when writing.
Before writing, every text box is measured with the real font files
(draftboard.measure); any unrecoverable overflow, unbreakable word, missing
glyph, or missing image blocks the export with slide/element IDs.
Every text block is written as real, editable text (never a rendered image),
and uploaded image assets are embedded natively with aspect-ratio preservation.
"""

import io
import pathlib
import re
from typing import Optional

from PIL import Image, ImageOps
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_DATA_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Pt

from draftboard.measure import FontPair, load_fonts, measure_box
from draftboard.models import Artifact, CanvasElement, Slide, SlideLayout, validate_ir
from draftboard.themes import ThemeSpec, get_theme
from draftboard.user_library import apply_brand_to_theme

CANVAS_W_PT = 960
CANVAS_H_PT = 540

FONT_LATIN = "Calibri"
FONT_EA = "Microsoft YaHei"
TEXT_COLOR = RGBColor(0x26, 0x26, 0x26)

# (x, y, w, h) in pt
BOX_TITLE = (48, 28, 864, 72)
BOX_BODY = (48, 122, 864, 364)
BOX_COLUMN_LEFT = (48, 126, 412, 358)
BOX_COLUMN_RIGHT = (500, 126, 412, 358)
BOX_TEXT_IMAGE_LEFT = (48, 124, 388, 360)
BOX_TEXT_IMAGE_RIGHT = (456, 120, 456, 372)
BOX_COVER_TITLE = (48, 172, 864, 114)
BOX_COVER_SUBTITLE = (48, 298, 820, 96)
BOX_CLOSING_TITLE = (48, 168, 864, 72)
BOX_CONCLUSION = (48, 250, 864, 176)
BOX_PAGE_NUMBER = (840, 504, 72, 22)

# Phase-1 baseline styles (preserved for `default` unstyled theme)
STYLE_TITLE = (24, 29, 0)
STYLE_COVER_TITLE = (40, 46, 0)
STYLE_BODY = (18, 22, 8)
STYLE_BULLET = (18, 22, 6)

# Curated studio theme styles (richer hierarchy, auto-fit safe)
STUDIO_TITLE = (28, 36, 0)
STUDIO_COVER_TITLE = (44, 52, 0)
STUDIO_COVER_SUBTITLE = (20, 30, 8)
STUDIO_CLOSING_TITLE = (34, 42, 0)
STUDIO_BODY = (20, 28, 10)
STUDIO_BULLET = (20, 28, 8)

# Controlled auto-fit step-down ladders (PRD 8.4: body >= 14pt, title >= 24pt)
AUTO_FIT_COVER_TITLE = [(40, 46, 0), (34, 40, 0), (28, 34, 0)]
AUTO_FIT_TITLE = [(24, 29, 0)]
AUTO_FIT_BODY = [(18, 22, 8), (16, 20, 6), (14, 18, 5)]
AUTO_FIT_BULLET = [(18, 22, 6), (16, 20, 5), (14, 18, 4)]

STUDIO_AUTO_FIT_COVER_TITLE = [(44, 52, 0), (38, 45, 0), (32, 38, 0), (28, 34, 0)]
STUDIO_AUTO_FIT_COVER_SUBTITLE = [(20, 30, 8), (18, 26, 6), (16, 22, 5)]
STUDIO_AUTO_FIT_CLOSING_TITLE = [(34, 42, 0), (28, 35, 0), (24, 30, 0)]
STUDIO_AUTO_FIT_TITLE = [(28, 36, 0), (24, 30, 0)]
STUDIO_AUTO_FIT_BODY = [(20, 28, 10), (18, 25, 8), (16, 22, 6), (14, 18, 5)]
STUDIO_AUTO_FIT_BULLET = [(20, 28, 8), (18, 24, 6), (16, 21, 5), (14, 18, 4)]

PAD_X_PT = 8
PAD_Y_PT = 4
BULLET_INDENT_PT = 14

# Brand footer is one nowrap line.  Geometry is shared by measurement and write.
FOOTER_SIZE_PT = 9
FOOTER_LINE_PT = 12
FOOTER_WIDTH_PT = 520
FOOTER_HEIGHT_PT = 20
FOOTER_Y_PT = 505
FOOTER_X_PT = 48
FOOTER_X_BESIDE_LOGO_PT = 128

# Table cells use the same padding and type size the exporter writes.
TABLE_PAD_X_PT = 8
TABLE_PAD_Y_PT = 4

_IMAGE_STUB_RE = re.compile(r"^\[image:\s*(.+?)\s*\]$", re.IGNORECASE)
_IMAGE_EXTS = (".png", ".jpg", ".jpeg")


def _box_for(
    layout: SlideLayout, role: str, *, decorative: bool = False
) -> tuple[int, int, int, int]:
    if role == "title":
        if layout == SlideLayout.COVER:
            return BOX_COVER_TITLE
        if layout == SlideLayout.CLOSING and decorative:
            return BOX_CLOSING_TITLE
        return BOX_TITLE
    if role == "subtitle":
        return BOX_COVER_SUBTITLE
    if role == "conclusion":
        return BOX_CONCLUSION
    if role == "column_left":
        return BOX_COLUMN_LEFT
    if role == "column_right":
        return BOX_COLUMN_RIGHT
    if layout == SlideLayout.TEXT_IMAGE:
        if role == "image":
            return BOX_TEXT_IMAGE_RIGHT
        return BOX_TEXT_IMAGE_LEFT
    return BOX_BODY


def _style_for(
    layout: SlideLayout, role: str, *, decorative: bool = False
) -> tuple[int, int, int]:
    if decorative:
        if role == "title":
            if layout == SlideLayout.COVER:
                return STUDIO_COVER_TITLE
            if layout == SlideLayout.CLOSING:
                return STUDIO_CLOSING_TITLE
            return STUDIO_TITLE
        if role == "subtitle":
            return STUDIO_COVER_SUBTITLE
        if role == "bullet":
            return STUDIO_BULLET
        return STUDIO_BODY

    if role == "title":
        return STYLE_COVER_TITLE if layout == SlideLayout.COVER else STYLE_TITLE
    if role == "bullet":
        return STYLE_BULLET
    return STYLE_BODY


def _style_candidates(
    layout: SlideLayout, role: str, auto_fit: bool, *, decorative: bool = False
) -> list[tuple[int, int, int]]:
    if not auto_fit:
        return [_style_for(layout, role, decorative=decorative)]
    if decorative:
        if role == "title":
            if layout == SlideLayout.COVER:
                return STUDIO_AUTO_FIT_COVER_TITLE
            if layout == SlideLayout.CLOSING:
                return STUDIO_AUTO_FIT_CLOSING_TITLE
            return STUDIO_AUTO_FIT_TITLE
        if role == "subtitle":
            return STUDIO_AUTO_FIT_COVER_SUBTITLE
        if role == "bullet":
            return STUDIO_AUTO_FIT_BULLET
        return STUDIO_AUTO_FIT_BODY
    if role == "title":
        return AUTO_FIT_COVER_TITLE if layout == SlideLayout.COVER else AUTO_FIT_TITLE
    if role == "bullet":
        return AUTO_FIT_BULLET
    return AUTO_FIT_BODY


def _resolve_image_path(
    ref: str, assets_dir: pathlib.Path | None
) -> pathlib.Path | None:
    """Resolve an image reference (filename, asset stem, or [image: name] stub)."""
    cleaned = ref.strip()
    m = _IMAGE_STUB_RE.match(cleaned)
    if m:
        cleaned = m.group(1).strip()
    if not cleaned:
        return None

    direct = pathlib.Path(cleaned)
    if direct.is_absolute() and direct.is_file():
        return direct

    if assets_dir is None or not assets_dir.is_dir():
        return None

    # Prevent path traversal; only match direct filenames/stems inside assets_dir.
    safe_name = pathlib.Path(cleaned).name
    if not safe_name or safe_name != cleaned:
        return None

    exact = assets_dir / safe_name
    if exact.is_file() and exact.suffix.lower() in _IMAGE_EXTS:
        return exact

    for ext in _IMAGE_EXTS:
        candidate = assets_dir / f"{safe_name}{ext}"
        if candidate.is_file():
            return candidate
    return None


def _set_ea_font(run) -> None:
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", FONT_EA)


def _fill_paragraph(
    paragraph,
    text: str,
    size_pt: int,
    line_pt: int,
    color_rgb: RGBColor,
    bold: bool = False,
) -> None:
    paragraph.line_spacing = Pt(line_pt)
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if i > 0:
            paragraph.add_line_break()
        run = paragraph.add_run()
        run.text = line
        run.font.size = Pt(size_pt)
        run.font.name = FONT_LATIN
        run.font.color.rgb = color_rgb
        if bold:
            run.font.bold = True
        _set_ea_font(run)


def _add_bullet_char(paragraph, accent_hex: str | None = None) -> None:
    pPr = paragraph._p.get_or_add_pPr()
    pPr.set("marL", str(int(Pt(BULLET_INDENT_PT))))
    pPr.set("indent", str(-int(Pt(BULLET_INDENT_PT))))
    if accent_hex:
        bu_clr = pPr.makeelement(qn("a:buClr"), {})
        srgb = pPr.makeelement(qn("a:srgbClr"), {"val": accent_hex.lstrip("#").upper()})
        bu_clr.append(srgb)
        pPr.append(bu_clr)
    bu_char = pPr.makeelement(qn("a:buChar"), {"char": "•"})
    pPr.append(bu_char)


def _add_line(
    pptx_slide,
    x1_pt: float,
    y1_pt: float,
    x2_pt: float,
    y2_pt: float,
    color_rgb: RGBColor,
    width_pt: float = 1.5,
) -> None:
    """Add a crisp, shadow-free connector line (has_text_frame is False)."""
    line = pptx_slide.shapes.add_connector(
        MSO_CONNECTOR.STRAIGHT, Pt(x1_pt), Pt(y1_pt), Pt(x2_pt), Pt(y2_pt)
    )
    line.line.color.rgb = color_rgb
    line.line.width = Pt(width_pt)
    line.shadow.inherit = False
    # Strip default theme effectRef shadow on connector style if present
    style_el = line._element.find(qn("p:style"))
    if style_el is not None:
        effect_ref = style_el.find(qn("a:effectRef"))
        if effect_ref is not None:
            effect_ref.set("idx", "0")


def _apply_theme_chrome(
    pptx_slide,
    layout: SlideLayout,
    theme: ThemeSpec,
    slide_index: int,
    total_slides: int,
) -> None:
    """Apply restrained Apple Keynote / editorial background, hairlines, and page numbers."""
    is_hero = layout in (SlideLayout.COVER, SlideLayout.CLOSING)

    if theme.id != "default":
        bg_fill = pptx_slide.background.fill
        bg_fill.solid()
        bg_fill.fore_color.rgb = theme.cover_bg_rgb if is_hero else theme.bg_rgb

    if theme.decorative:
        if layout == SlideLayout.COVER:
            # Clean Keynote editorial top-left accent bar
            _add_line(pptx_slide, 48, 146, 108, 146, theme.accent_rgb, width_pt=3.5)
        elif layout == SlideLayout.CLOSING:
            # Centered minimal accent rule above closing title + bottom hairline
            _add_line(pptx_slide, 452, 140, 508, 140, theme.accent_rgb, width_pt=3.0)
            _add_line(pptx_slide, 220, 444, 740, 444, theme.divider_rgb, width_pt=1.0)
        else:
            # Full-width hairline with crisp left accent segment under title
            _add_line(pptx_slide, 48, 104, 912, 104, theme.divider_rgb, width_pt=1.0)
            _add_line(pptx_slide, 48, 104, 108, 104, theme.accent_rgb, width_pt=2.5)
            if layout == SlideLayout.TWO_COLUMN:
                _add_line(pptx_slide, 480, 126, 480, 476, theme.divider_rgb, width_pt=1.0)
                _add_line(pptx_slide, 48, 120, 460, 120, theme.divider_rgb, width_pt=1.0)
                _add_line(pptx_slide, 500, 120, 912, 120, theme.divider_rgb, width_pt=1.0)

    if theme.show_page_number and layout != SlideLayout.COVER:
        x, y, w, h = BOX_PAGE_NUMBER
        box = pptx_slide.shapes.add_textbox(Pt(x), Pt(y), Pt(w), Pt(h))
        tf = box.text_frame
        tf.word_wrap = False
        tf.auto_size = MSO_AUTO_SIZE.NONE
        tf.margin_left = Pt(0)
        tf.margin_right = Pt(0)
        tf.margin_top = Pt(0)
        tf.margin_bottom = Pt(0)
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.RIGHT
        run = p.add_run()
        run.text = f"{slide_index + 1:02d} / {total_slides:02d}"
        run.font.size = Pt(10)
        run.font.name = FONT_LATIN
        run.font.color.rgb = theme.muted_rgb
        _set_ea_font(run)


def _text_color_for(layout: SlideLayout, role: str, theme: ThemeSpec) -> RGBColor:
    is_hero = layout in (SlideLayout.COVER, SlideLayout.CLOSING)
    if role == "title":
        return theme.cover_title_rgb if is_hero else theme.title_rgb
    return theme.cover_body_rgb if is_hero else theme.body_rgb


def _add_textbox(
    pptx_slide,
    layout: SlideLayout,
    role: str,
    texts: list[str],
    style: tuple[int, int, int],
    theme: ThemeSpec,
) -> None:
    x, y, w, h = _box_for(layout, role, decorative=theme.decorative)
    size_pt, line_pt, space_after_pt = style
    if layout == SlideLayout.COVER:
        centered = not theme.left_aligned_cover
    else:
        centered = layout == SlideLayout.CLOSING
    color_rgb = _text_color_for(layout, role, theme)
    is_bold = role == "title" and theme.bold_title

    box = pptx_slide.shapes.add_textbox(Pt(x), Pt(y), Pt(w), Pt(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.vertical_anchor = MSO_ANCHOR.TOP
    tf.margin_left = Pt(PAD_X_PT)
    tf.margin_right = Pt(PAD_X_PT)
    tf.margin_top = Pt(PAD_Y_PT)
    tf.margin_bottom = Pt(PAD_Y_PT)

    for i, text in enumerate(texts):
        paragraph = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        paragraph.alignment = PP_ALIGN.CENTER if centered else PP_ALIGN.LEFT
        paragraph.space_after = Pt(space_after_pt)
        _fill_paragraph(paragraph, text, size_pt, line_pt, color_rgb, bold=is_bold)
        if role == "bullet":
            _add_bullet_char(
                paragraph,
                accent_hex=theme.accent_hex if theme.decorative else None,
            )


def _add_picture_contain(
    pptx_slide,
    img_path: pathlib.Path,
    box_pt: tuple[int, int, int, int],
) -> None:
    """Place an image inside box_pt preserving its aspect ratio (contain)."""
    bx, by, bw, bh = box_pt
    with Image.open(img_path) as im:
        img_w, img_h = im.size
    if img_w <= 0 or img_h <= 0:
        raise ValueError(f"Image '{img_path.name}' has invalid dimensions.")
    scale = min(bw / img_w, bh / img_h)
    draw_w = round(img_w * scale, 6)
    draw_h = round(img_h * scale, 6)
    left = bx + (bw - draw_w) / 2.0
    top = by + (bh - draw_h) / 2.0
    pptx_slide.shapes.add_picture(
        str(img_path), Pt(left), Pt(top), width=Pt(draw_w), height=Pt(draw_h)
    )


def _group_boxes(slide) -> list[tuple[str, list[tuple[str, str]]]]:
    """Return (role, [(element_id, content)]) per box, in IR order."""
    groups: dict[str, list[tuple[str, str]]] = {}
    for el in slide.elements:
        groups.setdefault(el.type, []).append((el.element_id, el.content))
    return list(groups.items())


_HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")
CUSTOM_PAD_X_PT = 4
CUSTOM_PAD_Y_PT = 2


def resolve_canvas_hex(
    spec: Optional[str], theme: ThemeSpec, fallback_hex: str
) -> Optional[str]:
    """Resolve a 'theme:*' semantic color token or '#RRGGBB' hex to '#RRGGBB' (or None for transparent)."""
    raw = (spec or "").strip()
    if not raw:
        return fallback_hex
    low = raw.lower()
    if low in ("transparent", "none"):
        return None
    theme_map = {
        "theme:bg": theme.bg_hex,
        "theme:cover_bg": theme.cover_bg_hex,
        "theme:surface": theme.surface_hex,
        "theme:title": theme.title_hex,
        "theme:cover_title": theme.cover_title_hex,
        "theme:body": theme.body_hex,
        "theme:cover_body": theme.cover_body_hex,
        "theme:accent": theme.accent_hex,
        "theme:muted": theme.muted_hex,
        "theme:divider": theme.divider_hex,
    }
    if low in theme_map:
        return theme_map[low]
    m = _HEX_COLOR_RE.fullmatch(raw)
    if m:
        return f"#{m.group(1).upper()}"
    return fallback_hex


def _hex_to_rgb(hex_str: str) -> RGBColor:
    h = hex_str.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _measure_custom_slide(
    slide: Slide,
    fonts: FontPair,
    auto_fit: bool,
    resolved: dict[tuple[str, str], tuple[int, int, int]],
    errors: list[str],
) -> None:
    """Validate bounds, text overflow, and text-vs-text overlap on a freeform custom slide."""
    elements = slide.custom_elements or []
    text_boxes: list[tuple[str, float, float, float, float]] = []

    for el in elements:
        if el.kind == "line":
            x2 = el.x + el.w
            y2 = el.y + el.h
            if (
                el.x < -2
                or el.y < -2
                or el.x > CANVAS_W_PT + 2
                or el.y > CANVAS_H_PT + 2
                or x2 < -2
                or y2 < -2
                or x2 > CANVAS_W_PT + 2
                or y2 > CANVAS_H_PT + 2
            ):
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[OUT_OF_BOUNDS] Line endpoints ({el.x:.0f},{el.y:.0f})-({x2:.0f},{y2:.0f}) exceed 960x540 canvas."
                )
            continue

        if el.w <= 0 or el.h <= 0:
            errors.append(
                f"Slide '{slide.slide_id}', element '{el.id}': "
                f"[OUT_OF_BOUNDS] Width and height must be positive (got {el.w}x{el.h})."
            )
            continue

        if (
            el.x < -2
            or el.y < -2
            or el.x + el.w > CANVAS_W_PT + 2
            or el.y + el.h > CANVAS_H_PT + 2
        ):
            errors.append(
                f"Slide '{slide.slide_id}', element '{el.id}': "
                f"[OUT_OF_BOUNDS] Box ({el.x:.0f},{el.y:.0f},{el.w:.0f}x{el.h:.0f}) exceeds 960x540 canvas."
            )
            continue

        if el.kind == "text":
            text_boxes.append((el.id, el.x, el.y, el.x + el.w, el.y + el.h))
            content = (el.text or "").strip()
            base_size = int(el.font_size or 18)
            base_line = int(round(el.line_height or (base_size * 1.35)))
            if not content:
                resolved[(slide.slide_id, f"custom:{el.id}")] = (base_size, base_line, 0)
                continue

            if auto_fit:
                candidates = []
                for step in (0, 2, 4):
                    sz = max(12, base_size - step)
                    ln = max(sz + 3, int(round(sz * (base_line / max(1, base_size)))))
                    pair = (sz, ln, 0)
                    if pair not in candidates:
                        candidates.append(pair)
            else:
                candidates = [(base_size, base_line, 0)]

            chosen = None
            last_m = None
            for cand in candidates:
                sz, ln, sp = cand
                m = measure_box(
                    [content],
                    fonts=fonts,
                    width_pt=el.w,
                    height_pt=el.h,
                    size_pt=sz,
                    line_pt=ln,
                    space_after_pt=sp,
                    pad_x_pt=CUSTOM_PAD_X_PT,
                    pad_y_pt=CUSTOM_PAD_Y_PT,
                )
                last_m = m
                if m.fits and not m.issues:
                    chosen = cand
                    break

            if chosen is not None:
                resolved[(slide.slide_id, f"custom:{el.id}")] = chosen
            else:
                assert last_m is not None
                for para in last_m.paragraphs:
                    for iss in para.issues:
                        errors.append(
                            f"Slide '{slide.slide_id}', element '{el.id}': "
                            f"[{iss.code}] {iss.message}"
                        )
                if not last_m.fits:
                    errors.append(
                        f"Slide '{slide.slide_id}', element '{el.id}': "
                        f"[OVERFLOW] needs {last_m.required_height_pt:.1f}pt "
                        f"(+8% margin) but box height is {el.h:.0f}pt."
                    )

        elif el.kind == "table":
            headers = el.headers or []
            rows = el.rows or []
            if not headers and not rows:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    "[INVALID_TABLE] Table requires non-empty headers or rows."
                )
                continue
            col_count = len(headers) if headers else max((len(r) for r in rows), default=0)
            if col_count < 1 or col_count > 8:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[INVALID_TABLE] Column count must be 1..8 (got {col_count})."
                )
                continue
            total_rows = (1 if headers else 0) + len(rows)
            if total_rows > 13:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[OVERFLOW] Table has {total_rows} rows (max 13 including header)."
                )
                continue
            if el.w < 160 or el.h < 60:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[OVERFLOW] Table box {el.w:.0f}x{el.h:.0f}pt is too small (min 160x60pt)."
                )
                continue
            row_h = el.h / max(1, total_rows)
            if row_h < 20:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[OVERFLOW] Table row height {row_h:.1f}pt is too cramped for {total_rows} rows (need >=20pt/row; increase height h or reduce rows)."
                )
                continue
            _measure_table_cells(slide, el, fonts, errors)
            text_boxes.append((el.id, el.x, el.y, el.x + el.w, el.y + el.h))

        elif el.kind == "chart":
            cats = el.chart_categories or []
            series_list = el.chart_series or []
            if el.chart_type not in ("bar", "hbar", "line", "donut"):
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[INVALID_CHART] chart_type must be one of bar/hbar/line/donut (got {el.chart_type!r})."
                )
                continue
            if not cats or len(cats) > 12:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[INVALID_CHART] chart_categories must have 1..12 items (got {len(cats)})."
                )
                continue
            if not series_list or len(series_list) > 5:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[INVALID_CHART] chart_series must have 1..5 series (got {len(series_list)})."
                )
                continue
            bad_len = False
            for s in series_list:
                if len(s.values) != len(cats):
                    errors.append(
                        f"Slide '{slide.slide_id}', element '{el.id}': "
                        f"[INVALID_CHART] Series '{s.name}' has {len(s.values)} values, expected {len(cats)} to match chart_categories."
                    )
                    bad_len = True
            if bad_len:
                continue
            if el.w < 180 or el.h < 120:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}': "
                    f"[OVERFLOW] Chart box {el.w:.0f}x{el.h:.0f}pt is too small (min 180x120pt)."
                )
                continue
            text_boxes.append((el.id, el.x, el.y, el.x + el.w, el.y + el.h))

    # Check pairwise content-vs-content overlap (text/table/chart with 2pt tolerance)
    for i in range(len(text_boxes)):
        id_a, ax1, ay1, ax2, ay2 = text_boxes[i]
        for j in range(i + 1, len(text_boxes)):
            id_b, bx1, by1, bx2, by2 = text_boxes[j]
            if (ax1 + 2 < bx2 - 2) and (ax2 - 2 > bx1 + 2) and (ay1 + 2 < by2 - 2) and (ay2 - 2 > by1 + 2):
                errors.append(
                    f"Slide '{slide.slide_id}': [OVERLAP] Content elements '{id_a}' and '{id_b}' overlap."
                )


def _export_custom_slide(
    pptx_slide,
    slide: Slide,
    theme: ThemeSpec,
    resolved_styles: dict[tuple[str, str], tuple[int, int, int]],
    resolved_images: dict[tuple[str, str], pathlib.Path],
) -> None:
    """Write native editable PPTX shapes for a freeform custom slide."""
    bg_hex = resolve_canvas_hex(slide.custom_bg, theme, theme.bg_hex) or theme.bg_hex
    bg_fill = pptx_slide.background.fill
    bg_fill.solid()
    bg_fill.fore_color.rgb = _hex_to_rgb(bg_hex)

    for el in slide.custom_elements or []:
        if el.kind == "card":
            radius = float(el.radius if el.radius is not None else 12.0)
            shape_type = (
                MSO_SHAPE.ROUNDED_RECTANGLE if radius > 0 else MSO_SHAPE.RECTANGLE
            )
            shape = pptx_slide.shapes.add_shape(
                shape_type, Pt(el.x), Pt(el.y), Pt(el.w), Pt(el.h)
            )
            shape.shadow.inherit = False
            style_el = shape._element.find(qn("p:style"))
            if style_el is not None:
                effect_ref = style_el.find(qn("a:effectRef"))
                if effect_ref is not None:
                    effect_ref.set("idx", "0")
            if radius > 0 and min(el.w, el.h) > 0:
                try:
                    shape.adjustments[0] = min(0.5, radius / min(el.w, el.h))
                except Exception:
                    pass
            fill_hex = resolve_canvas_hex(el.fill, theme, theme.surface_hex)
            if fill_hex:
                shape.fill.solid()
                shape.fill.fore_color.rgb = _hex_to_rgb(fill_hex)
            else:
                shape.fill.background()
            border_hex = (
                resolve_canvas_hex(el.border_color, theme, theme.divider_hex)
                if el.border_color
                else None
            )
            bw = float(el.border_width if el.border_width is not None else (1.0 if border_hex else 0.0))
            if border_hex and bw > 0:
                shape.line.color.rgb = _hex_to_rgb(border_hex)
                shape.line.width = Pt(bw)
            else:
                shape.line.fill.background()

        elif el.kind == "line":
            col_hex = resolve_canvas_hex(el.color, theme, theme.divider_hex) or theme.divider_hex
            lw = float(el.line_width if el.line_width is not None else 1.5)
            _add_line(
                pptx_slide,
                el.x,
                el.y,
                el.x + el.w,
                el.y + el.h,
                _hex_to_rgb(col_hex),
                width_pt=lw,
            )

        elif el.kind == "image":
            img_path = resolved_images.get((slide.slide_id, f"custom:{el.id}"))
            if not img_path:
                continue
            if el.fit == "cover":
                with Image.open(img_path) as im:
                    rgb_im = im.convert("RGBA") if im.mode in ("RGBA", "P") else im.convert("RGB")
                    tw = max(2, int(round(el.w * 2)))
                    th = max(2, int(round(el.h * 2)))
                    cropped = ImageOps.fit(rgb_im, (tw, th), method=Image.Resampling.LANCZOS)
                    buf = io.BytesIO()
                    cropped.save(buf, format="PNG")
                    buf.seek(0)
                    pptx_slide.shapes.add_picture(
                        buf, Pt(el.x), Pt(el.y), width=Pt(el.w), height=Pt(el.h)
                    )
            else:
                _add_picture_contain(pptx_slide, img_path, (el.x, el.y, el.w, el.h))

        elif el.kind == "text":
            content = el.text or ""
            size_pt, line_pt, _ = resolved_styles.get(
                (slide.slide_id, f"custom:{el.id}"),
                (int(el.font_size or 18), int(round((el.font_size or 18) * 1.35)), 0),
            )
            col_hex = resolve_canvas_hex(el.color, theme, theme.body_hex) or theme.body_hex
            box = pptx_slide.shapes.add_textbox(Pt(el.x), Pt(el.y), Pt(el.w), Pt(el.h))
            tf = box.text_frame
            tf.word_wrap = True
            tf.auto_size = MSO_AUTO_SIZE.NONE
            tf.vertical_anchor = MSO_ANCHOR.TOP
            tf.margin_left = Pt(CUSTOM_PAD_X_PT)
            tf.margin_right = Pt(CUSTOM_PAD_X_PT)
            tf.margin_top = Pt(CUSTOM_PAD_Y_PT)
            tf.margin_bottom = Pt(CUSTOM_PAD_Y_PT)

            p = tf.paragraphs[0]
            if el.align == "center":
                p.alignment = PP_ALIGN.CENTER
            elif el.align == "right":
                p.alignment = PP_ALIGN.RIGHT
            else:
                p.alignment = PP_ALIGN.LEFT

            _fill_paragraph(
                p,
                content,
                size_pt,
                line_pt,
                _hex_to_rgb(col_hex),
                bold=bool(el.bold),
            )

        elif el.kind == "table":
            _export_custom_table(pptx_slide, el, theme, bg_hex)

        elif el.kind == "chart":
            _export_custom_chart(pptx_slide, el, theme)


def _set_table_cell_borders(
    cell,
    border_hex: str,
    *,
    bottom_pt: float = 0.75,
    top_pt: float = 0.0,
) -> None:
    """Apply clean Swiss editorial horizontal hairlines and suppress vertical clutter."""
    tcPr = cell._tc.get_or_add_tcPr()
    for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
        existing = tcPr.find(qn(tag))
        if existing is not None:
            tcPr.remove(existing)

    hex_val = border_hex.lstrip("#").upper()

    def _make_ln(tag_name: str, width_pt: float) -> OxmlElement:
        ln = OxmlElement(tag_name)
        if width_pt <= 0:
            ln.append(OxmlElement("a:noFill"))
        else:
            ln.set("w", str(int(Pt(width_pt))))
            ln.set("cap", "flat")
            solid = OxmlElement("a:solidFill")
            srgb = OxmlElement("a:srgbClr")
            srgb.set("val", hex_val)
            solid.append(srgb)
            ln.append(solid)
        return ln

    tcPr.append(_make_ln("a:lnL", 0))
    tcPr.append(_make_ln("a:lnR", 0))
    tcPr.append(_make_ln("a:lnT", top_pt))
    tcPr.append(_make_ln("a:lnB", bottom_pt))


def _table_grid(el: CanvasElement) -> tuple[list[tuple[bool, list[str]]], int]:
    """Cell text exactly as written: stripped, padded to the column count.

    Returns ``(rows, col_count)``.  Rows are ``(is_header, cells)``.  There
    is no cell merge.
    """
    headers = list(el.headers or [])
    body_rows = [list(r) for r in (el.rows or [])]
    col_count = len(headers) if headers else max((len(r) for r in body_rows), default=0)
    rows: list[tuple[bool, list[str]]] = []
    if col_count < 1:
        return rows, 0
    if headers:
        rows.append(
            (True, [str(v or "").strip() for v in (headers + [""] * col_count)[:col_count]])
        )
    for row in body_rows:
        rows.append(
            (False, [str(v or "").strip() for v in (row + [""] * col_count)[:col_count]])
        )
    return rows, col_count


def _table_type_size(font_size: int) -> tuple[int, int]:
    """Font size and line spacing used when a table cell is written."""
    line_pt = max(font_size + 3, int(round(font_size * 1.25)))
    return font_size, line_pt


def _measure_table_cells(slide: Slide, el: CanvasElement, fonts: FontPair, errors: list[str]) -> None:
    """Measure each cell in its own column, not across the whole table."""
    rows, col_count = _table_grid(el)
    if col_count < 1 or not rows:
        return
    col_w = el.w / col_count
    row_h = el.h / len(rows)
    size_pt, line_pt = _table_type_size(int(el.table_font_size or 14))
    for r_idx, (_, cells) in enumerate(rows):
        for c_idx, text in enumerate(cells):
            measured = measure_box(
                [text],
                fonts=fonts,
                width_pt=col_w,
                height_pt=row_h,
                size_pt=size_pt,
                line_pt=line_pt,
                space_after_pt=0,
                pad_x_pt=TABLE_PAD_X_PT,
                pad_y_pt=TABLE_PAD_Y_PT,
            )
            loc = f"r{r_idx + 1}c{c_idx + 1}"
            for para in measured.paragraphs:
                for issue in para.issues:
                    errors.append(
                        f"Slide '{slide.slide_id}', element '{el.id}', cell {loc}: "
                        f"[{issue.code}] {issue.message}"
                    )
            if not measured.fits:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{el.id}', cell {loc}: "
                    f"[OVERFLOW] needs {measured.required_height_pt:.1f}pt "
                    f"(+8% margin) but row height is {row_h:.1f}pt."
                )


def _footer_applies(slide: Slide) -> bool:
    return not (slide.layout == SlideLayout.COVER and not slide.custom_elements)


def _measure_brand_footer(
    slide: Slide,
    fonts: FontPair,
    brand: dict | None,
    errors: list[str],
) -> None:
    """Measure the single nowrap footer line against the box that is written."""
    if not brand or not isinstance(brand, dict) or not _footer_applies(slide):
        return
    footer_text = (brand.get("footer_text") or "").strip()
    if not footer_text:
        return
    measured = measure_box(
        [footer_text],
        fonts=fonts,
        width_pt=FOOTER_WIDTH_PT,
        height_pt=FOOTER_HEIGHT_PT,
        size_pt=FOOTER_SIZE_PT,
        line_pt=FOOTER_LINE_PT,
        space_after_pt=0,
        pad_x_pt=0,
        pad_y_pt=0,
        wrap=False,
    )
    for para in measured.paragraphs:
        for issue in para.issues:
            errors.append(
                f"Slide '{slide.slide_id}', element 'brand-footer': "
                f"[{issue.code}] {issue.message}"
            )
    if not measured.fits:
        errors.append(
            f"Slide '{slide.slide_id}', element 'brand-footer': "
            f"[OVERFLOW] needs {measured.required_height_pt:.1f}pt "
            f"(+8% margin) but box height is {FOOTER_HEIGHT_PT}pt."
        )


def _export_custom_table(
    pptx_slide,
    el: CanvasElement,
    theme: ThemeSpec,
    slide_bg_hex: str,
) -> None:
    """Write a native editable PowerPoint table with editorial theme styling."""
    headers = list(el.headers or [])
    rows, col_count = _table_grid(el)
    if col_count < 1 or not rows:
        return
    all_rows = rows
    row_count = len(all_rows)

    graphic = pptx_slide.shapes.add_table(
        row_count, col_count, Pt(el.x), Pt(el.y), Pt(el.w), Pt(el.h)
    )
    tbl = graphic.table

    # Neutralize default PowerPoint blue banded theme style
    tblPr = tbl._tbl.tblPr
    if tblPr is not None:
        tblPr.set("firstRow", "0")
        tblPr.set("bandRow", "0")

    col_w = Pt(el.w / col_count)
    for col in tbl.columns:
        col.width = col_w
    row_h = Pt(el.h / row_count)
    for row in tbl.rows:
        row.height = row_h

    font_size, line_pt = _table_type_size(int(el.table_font_size or 14))
    header_fill_hex = resolve_canvas_hex(el.header_fill, theme, theme.surface_hex) or theme.surface_hex
    header_col_hex = resolve_canvas_hex(el.header_color, theme, theme.title_hex) or theme.title_hex
    cell_col_hex = resolve_canvas_hex(el.cell_color, theme, theme.body_hex) or theme.body_hex
    stripe_hex = resolve_canvas_hex(el.stripe_fill, theme, theme.surface_hex)
    divider_hex = theme.divider_hex

    for r_idx, (is_header, cells_text) in enumerate(all_rows):
        for c_idx, raw_val in enumerate(cells_text):
            cell = tbl.cell(r_idx, c_idx)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = Pt(TABLE_PAD_X_PT)
            cell.margin_right = Pt(TABLE_PAD_X_PT)
            cell.margin_top = Pt(TABLE_PAD_Y_PT)
            cell.margin_bottom = Pt(TABLE_PAD_Y_PT)

            if is_header:
                cell.fill.solid()
                cell.fill.fore_color.rgb = _hex_to_rgb(header_fill_hex)
                _set_table_cell_borders(cell, divider_hex, bottom_pt=1.25, top_pt=0.75)
                text_hex = header_col_hex
                is_bold = True
            else:
                data_idx = r_idx - (1 if headers else 0)
                fill_hex = stripe_hex if (data_idx % 2 == 1 and stripe_hex) else slide_bg_hex
                cell.fill.solid()
                cell.fill.fore_color.rgb = _hex_to_rgb(fill_hex)
                _set_table_cell_borders(cell, divider_hex, bottom_pt=0.75, top_pt=0.0)
                text_hex = cell_col_hex
                is_bold = c_idx == 0 and col_count >= 2

            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            # Right-align pure numeric columns (after first label column)
            val_str = str(raw_val or "").strip()
            is_numeric = c_idx > 0 and bool(
                re.fullmatch(r"[+\-¥$€£]?\d[\d,.]*\s*[%倍×xX亿万kKmMbBms]*", val_str)
            )
            p.alignment = PP_ALIGN.RIGHT if is_numeric else PP_ALIGN.LEFT
            _fill_paragraph(
                p,
                val_str,
                font_size,
                line_pt,
                _hex_to_rgb(text_hex),
                bold=is_bold,
            )


def _export_custom_chart(
    pptx_slide,
    el: CanvasElement,
    theme: ThemeSpec,
) -> None:
    """Write a native editable PowerPoint chart with embedded Excel data & theme colors."""
    cats = list(el.chart_categories or [])
    series_list = list(el.chart_series or [])
    if not cats or not series_list:
        return

    chart_type_map = {
        "bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
        "hbar": XL_CHART_TYPE.BAR_CLUSTERED,
        "line": XL_CHART_TYPE.LINE_MARKERS,
        "donut": XL_CHART_TYPE.DOUGHNUT,
    }
    xl_type = chart_type_map.get(el.chart_type or "bar", XL_CHART_TYPE.COLUMN_CLUSTERED)

    chart_data = CategoryChartData()
    chart_data.categories = cats
    effective_series = series_list[:1] if el.chart_type == "donut" else series_list
    for s in effective_series:
        chart_data.add_series(s.name, [float(v) for v in s.values])

    graphic = pptx_slide.shapes.add_chart(
        xl_type, Pt(el.x), Pt(el.y), Pt(el.w), Pt(el.h), chart_data
    )
    chart = graphic.chart
    palette = theme.chart_palette

    # Title
    if el.chart_title and el.chart_title.strip():
        chart.has_title = True
        title_tf = chart.chart_title.text_frame
        title_tf.clear()
        p = title_tf.paragraphs[0]
        _fill_paragraph(
            p, el.chart_title.strip(), 14, 18, theme.title_rgb, bold=True
        )
    else:
        chart.has_title = False

    # Legend
    show_legend = len(effective_series) > 1 or el.chart_type == "donut"
    chart.has_legend = show_legend
    if show_legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
        chart.legend.font.size = Pt(10)
        chart.legend.font.name = FONT_LATIN
        chart.legend.font.color.rgb = theme.muted_rgb

    # Series & point coloring
    plot = chart.plots[0]
    for s_idx, (s_model, pptx_series) in enumerate(zip(effective_series, plot.series)):
        fallback_hex = palette[s_idx % len(palette)]
        s_hex = resolve_canvas_hex(s_model.color, theme, fallback_hex) or fallback_hex
        s_rgb = _hex_to_rgb(s_hex)

        if el.chart_type == "donut":
            for pt_idx in range(len(cats)):
                pt_hex = palette[pt_idx % len(palette)]
                pt = pptx_series.points[pt_idx]
                pt.format.fill.solid()
                pt.format.fill.fore_color.rgb = _hex_to_rgb(pt_hex)
        elif el.chart_type == "line":
            pptx_series.format.line.color.rgb = s_rgb
            pptx_series.format.line.width = Pt(2.5)
            pptx_series.smooth = False
        else:
            pptx_series.format.fill.solid()
            pptx_series.format.fill.fore_color.rgb = s_rgb

    # Data labels
    show_vals = True if el.show_values is None else bool(el.show_values)
    plot.has_data_labels = show_vals
    if show_vals:
        dl = plot.data_labels
        dl.font.size = Pt(10)
        dl.font.name = FONT_LATIN
        dl.font.color.rgb = theme.body_rgb
        suffix = (el.value_suffix or "").strip()
        if suffix:
            safe_suffix = suffix.replace('"', "")
            dl.number_format = f'0.##"{safe_suffix}"'
        if el.chart_type in ("bar", "hbar"):
            try:
                dl.position = XL_DATA_LABEL_POSITION.OUTSIDE_END
            except Exception:
                pass

    # Clean axes for cartesian charts
    if el.chart_type in ("bar", "hbar", "line"):
        try:
            cat_axis = chart.category_axis
            cat_axis.tick_labels.font.size = Pt(10)
            cat_axis.tick_labels.font.name = FONT_LATIN
            cat_axis.tick_labels.font.color.rgb = theme.muted_rgb
            cat_axis.format.line.color.rgb = theme.divider_rgb
        except Exception:
            pass
        try:
            val_axis = chart.value_axis
            val_axis.tick_labels.font.size = Pt(9)
            val_axis.tick_labels.font.name = FONT_LATIN
            val_axis.tick_labels.font.color.rgb = theme.muted_rgb
            val_axis.has_major_gridlines = True
            val_axis.major_gridlines.format.line.color.rgb = theme.divider_rgb
            val_axis.format.line.fill.background()
        except Exception:
            pass


def _measure_and_resolve(
    artifact: Artifact,
    fonts: FontPair,
    auto_fit: bool,
    *,
    decorative: bool = False,
    brand: dict | None = None,
) -> tuple[dict[tuple[str, str], tuple[int, int, int]], list[str]]:
    resolved: dict[tuple[str, str], tuple[int, int, int]] = {}
    errors: list[str] = []

    for slide in artifact.slides:
        if slide.custom_elements:
            _measure_custom_slide(slide, fonts, auto_fit, resolved, errors)
        else:
            _measure_fixed_slide(slide, fonts, auto_fit, decorative, resolved, errors)
        _measure_brand_footer(slide, fonts, brand, errors)

    return resolved, errors


def _measure_fixed_slide(
    slide: Slide,
    fonts: FontPair,
    auto_fit: bool,
    decorative: bool,
    resolved: dict[tuple[str, str], tuple[int, int, int]],
    errors: list[str],
) -> None:
    for role, items in _group_boxes(slide):
        if role == "image":
            continue
        _x, _y, w, h = _box_for(slide.layout, role, decorative=decorative)
        candidates = _style_candidates(slide.layout, role, auto_fit, decorative=decorative)
        chosen_style = None
        last_measurement = None

        for candidate in candidates:
            size_pt, line_pt, space_after_pt = candidate
            measured = measure_box(
                [content for _, content in items],
                fonts=fonts,
                width_pt=w,
                height_pt=h,
                size_pt=size_pt,
                line_pt=line_pt,
                space_after_pt=space_after_pt,
                pad_x_pt=PAD_X_PT,
                pad_y_pt=PAD_Y_PT,
                indent_pt=BULLET_INDENT_PT if role == "bullet" else 0,
            )
            last_measurement = measured
            if measured.fits and not measured.issues:
                chosen_style = candidate
                break

        if chosen_style is not None:
            resolved[(slide.slide_id, role)] = chosen_style
            continue

        assert last_measurement is not None
        min_size_pt = candidates[-1][0]
        for (element_id, _), para in zip(items, last_measurement.paragraphs):
            for issue in para.issues:
                errors.append(
                    f"Slide '{slide.slide_id}', element '{element_id}': "
                    f"[{issue.code}] {issue.message}"
                )
        if not last_measurement.fits:
            suffix = (
                f" (even at min {min_size_pt}pt)" if auto_fit and len(candidates) > 1 else ""
            )
            errors.append(
                f"Slide '{slide.slide_id}', role '{role}' "
                f"(elements: {', '.join(eid for eid, _ in items)}): "
                f"[OVERFLOW] needs {last_measurement.required_height_pt:.1f}pt "
                f"(+8% margin) but box height is {h}pt{suffix}."
            )


def _apply_brand_overlay(
    pptx_slide,
    slide: Slide,
    theme: ThemeSpec,
    brand: dict | None,
    assets_dir: pathlib.Path | None,
) -> None:
    """Apply optional project brand footer text and corner logo on non-cover slides."""
    if not brand or not isinstance(brand, dict) or not _footer_applies(slide):
        return

    footer_text = (brand.get("footer_text") or "").strip()
    logo_id = (brand.get("logo_asset_id") or "").strip()
    logo_pos = brand.get("logo_position") or "top_right"

    logo_path = _resolve_image_path(logo_id, assets_dir) if logo_id else None
    if logo_path is not None:
        if logo_pos == "bottom_left":
            _add_picture_contain(pptx_slide, logo_path, (48, 502, 72, 24))
        else:
            _add_picture_contain(pptx_slide, logo_path, (840, 14, 72, 24))

    if footer_text:
        fx = (
            FOOTER_X_BESIDE_LOGO_PT
            if (logo_path is not None and logo_pos == "bottom_left")
            else FOOTER_X_PT
        )
        box = pptx_slide.shapes.add_textbox(
            Pt(fx), Pt(FOOTER_Y_PT), Pt(FOOTER_WIDTH_PT), Pt(FOOTER_HEIGHT_PT)
        )
        tf = box.text_frame
        tf.word_wrap = False
        tf.auto_size = MSO_AUTO_SIZE.NONE
        tf.margin_left = Pt(0)
        tf.margin_right = Pt(0)
        tf.margin_top = Pt(0)
        tf.margin_bottom = Pt(0)
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.LEFT
        _fill_paragraph(
            p, footer_text, FOOTER_SIZE_PT, FOOTER_LINE_PT, theme.muted_rgb, bold=False
        )


def export_pptx(
    artifact: Artifact,
    output_path: pathlib.Path,
    fonts: FontPair | None = None,
    assets_dir: pathlib.Path | None = None,
    auto_fit: bool | None = None,
    brand: dict | None = None,
) -> None:
    """Validate the IR, measure every block, resolve images, and write PPTX.

    Raises ValueError on invalid IR, unsupported element types (shape, or
    unresolved image), or any measurement issue (overflow, overlong word,
    missing glyph).  Nothing is written on failure.
    """
    errors = validate_ir(artifact)
    if errors:
        raise ValueError("Invalid IR:\n" + "\n".join(errors))

    resolved_images: dict[tuple[str, str], pathlib.Path] = {}
    for slide in artifact.slides:
        if slide.custom_elements:
            for cel in slide.custom_elements:
                if cel.kind == "image":
                    img_ref = (cel.image_asset_id or "").strip()
                    img_path = _resolve_image_path(img_ref, assets_dir) if img_ref else None
                    if img_path is None:
                        raise ValueError(
                            f"Slide '{slide.slide_id}', element '{cel.id}': "
                            f"[MISSING_IMAGE] Image asset '{img_ref}' not found."
                        )
                    resolved_images[(slide.slide_id, f"custom:{cel.id}")] = img_path
            continue
        for el in slide.elements:
            if el.type == "shape":
                raise ValueError(
                    f"Element type 'shape' is not supported by the "
                    f"exporter yet (element '{el.element_id}', "
                    f"slide '{slide.slide_id}')."
                )
            if el.type == "image":
                img_path = _resolve_image_path(el.content, assets_dir)
                if img_path is None:
                    if assets_dir is None:
                        raise ValueError(
                            f"Element type 'image' is not supported without "
                            f"assets_dir (element '{el.element_id}', "
                            f"slide '{slide.slide_id}')."
                        )
                    raise ValueError(
                        f"Slide '{slide.slide_id}', element '{el.element_id}': "
                        f"[MISSING_IMAGE] Image asset '{el.content}' not found."
                    )
                resolved_images[(slide.slide_id, el.element_id)] = img_path

    if fonts is None:
        fonts = load_fonts()

    theme = apply_brand_to_theme(get_theme(artifact.template_id), brand)

    effective_auto_fit = artifact.auto_fit if auto_fit is None else auto_fit
    resolved_styles, measure_errors = _measure_and_resolve(
        artifact,
        fonts,
        auto_fit=effective_auto_fit,
        decorative=theme.decorative,
        brand=brand,
    )
    if measure_errors:
        raise ValueError("Layout check failed:\n" + "\n".join(measure_errors))

    prs = Presentation()
    prs.slide_width = Pt(CANVAS_W_PT)
    prs.slide_height = Pt(CANVAS_H_PT)
    prs.core_properties.author = "Draftboard"
    deck_title = ""
    for slide in artifact.slides:
        for el in slide.elements:
            if el.type == "title" and el.content.strip():
                deck_title = " ".join(el.content.split())
                break
        if deck_title:
            break
    prs.core_properties.title = deck_title or artifact.artifact_id
    blank_layout = prs.slide_layouts[6]
    total_slides = len(artifact.slides)

    for idx, slide in enumerate(artifact.slides):
        pptx_slide = prs.slides.add_slide(blank_layout)
        if slide.custom_elements:
            _export_custom_slide(
                pptx_slide, slide, theme, resolved_styles, resolved_images
            )
            _apply_brand_overlay(pptx_slide, slide, theme, brand, assets_dir)
        else:
            _apply_theme_chrome(pptx_slide, slide.layout, theme, idx, total_slides)
            _apply_brand_overlay(pptx_slide, slide, theme, brand, assets_dir)

            for role, items in _group_boxes(slide):
                if role == "image":
                    # Embed the first image element in this slide's image slot
                    el_id, _ = items[0]
                    img_path = resolved_images[(slide.slide_id, el_id)]
                    _add_picture_contain(
                        pptx_slide, img_path, _box_for(slide.layout, "image")
                    )
                else:
                    style = resolved_styles[(slide.slide_id, role)]
                    _add_textbox(
                        pptx_slide,
                        slide.layout,
                        role,
                        [content for _, content in items],
                        style,
                        theme,
                    )

        if slide.speaker_notes and slide.speaker_notes.strip():
            notes_slide = pptx_slide.notes_slide
            notes_slide.notes_text_frame.text = slide.speaker_notes.strip()

    output_path = pathlib.Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
