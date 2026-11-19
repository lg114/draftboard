"""
Fixed-coordinate PPTX exporter (phase 1).

All geometry is computed in points and converted to EMU only when writing.
Box positions and font metrics below are the initial template configuration
from the phase-1 plan; they are NOT calibrated values.  Before writing, every
text box is measured with the real font files (draftboard.measure); any
overflow or unbreakable text blocks the export with slide/element IDs.
Every content block is written as real, editable text (never a rendered
image).
"""

import pathlib

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Pt

from draftboard.measure import FontPair, load_fonts, measure_box
from draftboard.models import Artifact, SlideLayout, validate_ir

CANVAS_W_PT = 960
CANVAS_H_PT = 540

FONT_LATIN = "Calibri"
FONT_EA = "Microsoft YaHei"
TEXT_COLOR = RGBColor(0x26, 0x26, 0x26)

# (x, y, w, h) in pt
BOX_TITLE = (48, 30, 864, 72)
BOX_BODY = (48, 120, 864, 360)
BOX_COLUMN_LEFT = (48, 120, 420, 360)
BOX_COLUMN_RIGHT = (492, 120, 420, 360)
BOX_COVER_TITLE = (48, 190, 864, 92)
BOX_COVER_SUBTITLE = (48, 300, 864, 72)
BOX_CONCLUSION = (48, 180, 864, 180)

# role -> (font_size_pt, line_spacing_pt, space_after_pt)
STYLE_TITLE = (24, 29, 0)
STYLE_COVER_TITLE = (40, 46, 0)
STYLE_BODY = (18, 22, 8)
STYLE_BULLET = (18, 22, 6)

PAD_X_PT = 8
PAD_Y_PT = 4
BULLET_INDENT_PT = 14


def _box_for(layout: SlideLayout, role: str) -> tuple[int, int, int, int]:
    if role == "title":
        return BOX_COVER_TITLE if layout == SlideLayout.COVER else BOX_TITLE
    if role == "subtitle":
        return BOX_COVER_SUBTITLE
    if role == "conclusion":
        return BOX_CONCLUSION
    if role == "column_left":
        return BOX_COLUMN_LEFT
    if role == "column_right":
        return BOX_COLUMN_RIGHT
    return BOX_BODY


def _style_for(layout: SlideLayout, role: str) -> tuple[int, int, int]:
    if role == "title":
        return STYLE_COVER_TITLE if layout == SlideLayout.COVER else STYLE_TITLE
    if role == "bullet":
        return STYLE_BULLET
    return STYLE_BODY


def _set_ea_font(run) -> None:
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", FONT_EA)


def _fill_paragraph(paragraph, text: str, size_pt: int, line_pt: int) -> None:
    paragraph.line_spacing = Pt(line_pt)
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if i > 0:
            paragraph.add_line_break()
        run = paragraph.add_run()
        run.text = line
        run.font.size = Pt(size_pt)
        run.font.name = FONT_LATIN
        run.font.color.rgb = TEXT_COLOR
        _set_ea_font(run)


def _add_bullet_char(paragraph) -> None:
    pPr = paragraph._p.get_or_add_pPr()
    pPr.set("marL", str(int(Pt(BULLET_INDENT_PT))))
    pPr.set("indent", str(-int(Pt(BULLET_INDENT_PT))))
    bu_char = pPr.makeelement(qn("a:buChar"), {"char": "•"})
    pPr.append(bu_char)


def _add_textbox(pptx_slide, layout: SlideLayout, role: str,
                 texts: list[str]) -> None:
    x, y, w, h = _box_for(layout, role)
    size_pt, line_pt, space_after_pt = _style_for(layout, role)
    centered = layout in (SlideLayout.COVER, SlideLayout.CLOSING)

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
        _fill_paragraph(paragraph, text, size_pt, line_pt)
        if role == "bullet":
            _add_bullet_char(paragraph)


def _group_boxes(slide) -> list[tuple[str, list[tuple[str, str]]]]:
    """Return (role, [(element_id, content)]) per text box, in IR order."""
    groups: dict[str, list[tuple[str, str]]] = {}
    for el in slide.elements:
        groups.setdefault(el.type, []).append((el.element_id, el.content))
    return list(groups.items())


def _measure_errors(artifact: Artifact, fonts: FontPair) -> list[str]:
    errors: list[str] = []
    for slide in artifact.slides:
        for role, items in _group_boxes(slide):
            x, y, w, h = _box_for(slide.layout, role)
            size_pt, line_pt, space_after_pt = _style_for(slide.layout, role)
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
            for (element_id, _), para in zip(items, m.paragraphs):
                for issue in para.issues:
                    errors.append(
                        f"Slide '{slide.slide_id}', element '{element_id}': "
                        f"[{issue.code}] {issue.message}"
                    )
            if not m.fits:
                errors.append(
                    f"Slide '{slide.slide_id}', role '{role}' "
                    f"(elements: {', '.join(eid for eid, _ in items)}): "
                    f"[OVERFLOW] needs {m.required_height_pt:.1f}pt "
                    f"(+8% margin) but box height is {h}pt."
                )
    return errors


def export_pptx(
    artifact: Artifact,
    output_path: pathlib.Path,
    fonts: FontPair | None = None,
) -> None:
    """Validate the IR, measure every block, and write an editable PPTX.

    Raises ValueError on invalid IR, unsupported element types (image,
    shape), or any measurement issue (overflow, overlong word, missing
    glyph).  Nothing is written on failure.  No automatic page splitting,
    font shrinking, or layout switching is attempted.
    """
    errors = validate_ir(artifact)
    if errors:
        raise ValueError("Invalid IR:\n" + "\n".join(errors))
    for slide in artifact.slides:
        for el in slide.elements:
            if el.type in ("image", "shape"):
                raise ValueError(
                    f"Element type '{el.type}' is not supported by the "
                    f"exporter yet (element '{el.element_id}', "
                    f"slide '{slide.slide_id}')."
                )

    if fonts is None:
        fonts = load_fonts()
    measure_errors = _measure_errors(artifact, fonts)
    if measure_errors:
        raise ValueError("Layout check failed:\n" + "\n".join(measure_errors))

    prs = Presentation()
    prs.slide_width = Pt(CANVAS_W_PT)
    prs.slide_height = Pt(CANVAS_H_PT)
    blank_layout = prs.slide_layouts[6]

    for slide in artifact.slides:
        pptx_slide = prs.slides.add_slide(blank_layout)
        for role, items in _group_boxes(slide):
            _add_textbox(
                pptx_slide, slide.layout, role, [content for _, content in items]
            )

    output_path = pathlib.Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))