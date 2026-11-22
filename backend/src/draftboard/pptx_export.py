"""
Deterministic PPTX exporter (Step 2: Themes, Images, Speaker Notes & Auto-Fit).

All geometry is computed in points and converted to EMU only when writing.
Before writing, every text box is measured with the real font files
(draftboard.measure); any unrecoverable overflow, unbreakable word, missing
glyph, or missing image blocks the export with slide/element IDs.
Every text block is written as real, editable text (never a rendered image),
and uploaded image assets are embedded natively with aspect-ratio preservation.
"""

import pathlib
import re

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

from draftboard.measure import FontPair, load_fonts, measure_box
from draftboard.models import Artifact, SlideLayout, validate_ir
from draftboard.themes import ThemeSpec, get_theme

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
            # Editorial top-left accent bar + bottom anchoring hairline
            _add_line(pptx_slide, 48, 146, 108, 146, theme.accent_rgb, width_pt=3.5)
            _add_line(pptx_slide, 48, 458, 912, 458, theme.divider_rgb, width_pt=1.0)
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
            elif layout == SlideLayout.TEXT_IMAGE:
                _add_line(pptx_slide, 456, 118, 912, 118, theme.divider_rgb, width_pt=1.0)
                _add_line(pptx_slide, 456, 494, 912, 494, theme.divider_rgb, width_pt=1.0)

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


def _measure_and_resolve(
    artifact: Artifact,
    fonts: FontPair,
    auto_fit: bool,
    *,
    decorative: bool = False,
) -> tuple[dict[tuple[str, str], tuple[int, int, int]], list[str]]:
    resolved: dict[tuple[str, str], tuple[int, int, int]] = {}
    errors: list[str] = []

    for slide in artifact.slides:
        for role, items in _group_boxes(slide):
            if role == "image":
                continue
            x, y, w, h = _box_for(slide.layout, role, decorative=decorative)
            candidates = _style_candidates(
                slide.layout, role, auto_fit, decorative=decorative
            )
            chosen_style = None
            last_measurement = None

            for candidate in candidates:
                size_pt, line_pt, space_after_pt = candidate
                m = measure_box(
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
                last_measurement = m
                if m.fits and not m.issues:
                    chosen_style = candidate
                    break

            if chosen_style is not None:
                resolved[(slide.slide_id, role)] = chosen_style
                continue

            # Report failure on the final (smallest allowed) step
            assert last_measurement is not None
            min_size_pt = candidates[-1][0]
            for (element_id, _), para in zip(items, last_measurement.paragraphs):
                for issue in para.issues:
                    errors.append(
                        f"Slide '{slide.slide_id}', element '{element_id}': "
                        f"[{issue.code}] {issue.message}"
                    )
            if not last_measurement.fits:
                suffix = f" (even at min {min_size_pt}pt)" if auto_fit and len(candidates) > 1 else ""
                errors.append(
                    f"Slide '{slide.slide_id}', role '{role}' "
                    f"(elements: {', '.join(eid for eid, _ in items)}): "
                    f"[OVERFLOW] needs {last_measurement.required_height_pt:.1f}pt "
                    f"(+8% margin) but box height is {h}pt{suffix}."
                )

    return resolved, errors


def export_pptx(
    artifact: Artifact,
    output_path: pathlib.Path,
    fonts: FontPair | None = None,
    assets_dir: pathlib.Path | None = None,
    auto_fit: bool | None = None,
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

    theme = get_theme(artifact.template_id)

    effective_auto_fit = artifact.auto_fit if auto_fit is None else auto_fit
    resolved_styles, measure_errors = _measure_and_resolve(
        artifact, fonts, auto_fit=effective_auto_fit, decorative=theme.decorative
    )
    if measure_errors:
        raise ValueError("Layout check failed:\n" + "\n".join(measure_errors))

    prs = Presentation()
    prs.slide_width = Pt(CANVAS_W_PT)
    prs.slide_height = Pt(CANVAS_H_PT)
    blank_layout = prs.slide_layouts[6]
    total_slides = len(artifact.slides)

    for idx, slide in enumerate(artifact.slides):
        pptx_slide = prs.slides.add_slide(blank_layout)
        _apply_theme_chrome(pptx_slide, slide.layout, theme, idx, total_slides)

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
