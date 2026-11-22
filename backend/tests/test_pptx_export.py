"""
Tests for the phase-1 fixed-coordinate PPTX exporter and IR validation.
No model calls; everything runs offline.
"""

import pathlib

import pytest
from pptx import Presentation
from pptx.util import Pt

from draftboard.models import Artifact, SlideLayout, validate_ir
from draftboard.pptx_export import (
    BOX_BODY,
    BOX_COLUMN_LEFT,
    BOX_COLUMN_RIGHT,
    BOX_CONCLUSION,
    BOX_COVER_SUBTITLE,
    BOX_COVER_TITLE,
    BOX_TITLE,
    CANVAS_H_PT,
    CANVAS_W_PT,
    export_pptx,
)
from draftboard.storage import ProjectStorage

SAMPLE_PATH = pathlib.Path(__file__).parent.parent / "examples" / "sample_deck.json"


@pytest.fixture
def sample_artifact() -> Artifact:
    return Artifact.model_validate_json(SAMPLE_PATH.read_text(encoding="utf-8"))


def _shape_texts(slide) -> list[str]:
    return [s.text_frame.text for s in slide.shapes if s.has_text_frame]


def _all_text(slide) -> str:
    return "\n".join(_shape_texts(slide))


# ── IR save / load roundtrip ─────────────────────────────────────────────────


def test_sample_ir_roundtrip(sample_artifact, tmp_path):
    storage = ProjectStorage("sample", storage_root=tmp_path)
    storage.save_artifact(sample_artifact)
    loaded = storage.load_artifact("art-sample01", 1)
    assert loaded == sample_artifact
    assert [s.layout for s in loaded.slides] == [
        SlideLayout.COVER,
        SlideLayout.CONTENT,
        SlideLayout.BULLETS,
        SlideLayout.TWO_COLUMN,
        SlideLayout.CLOSING,
    ]


def test_sample_ir_is_valid(sample_artifact):
    assert validate_ir(sample_artifact) == []


# ── IR rejection cases ───────────────────────────────────────────────────────


def test_reject_empty_title(sample_artifact):
    sample_artifact.slides[1].elements[0].content = "   "
    errors = validate_ir(sample_artifact)
    assert any("empty title" in e and "slide-002" in e for e in errors)


def test_reject_missing_title(sample_artifact):
    sample_artifact.slides[1].elements.pop(0)
    errors = validate_ir(sample_artifact)
    assert any("exactly one title" in e for e in errors)


def test_reject_duplicate_slide_id(sample_artifact):
    sample_artifact.slides[1].slide_id = sample_artifact.slides[0].slide_id
    errors = validate_ir(sample_artifact)
    assert any("Duplicate slide_id" in e for e in errors)


def test_reject_duplicate_element_id(sample_artifact):
    els = sample_artifact.slides[2].elements
    els[1].element_id = els[0].element_id
    errors = validate_ir(sample_artifact)
    assert any("Duplicate element_id" in e and "slide-003" in e for e in errors)


def test_reject_unknown_element_type(sample_artifact):
    sample_artifact.slides[1].elements[1].type = "chart"
    errors = validate_ir(sample_artifact)
    assert any("Unknown element type 'chart'" in e for e in errors)


def test_reject_role_layout_mismatch(sample_artifact):
    sample_artifact.slides[1].elements[1].type = "bullet"
    errors = validate_ir(sample_artifact)
    assert any("not allowed in layout 'content'" in e for e in errors)


def test_reject_two_column_missing_side(sample_artifact):
    slide = sample_artifact.slides[3]
    slide.elements = [el for el in slide.elements if el.type != "column_right"]
    errors = validate_ir(sample_artifact)
    assert any("missing column_right" in e for e in errors)


def test_export_rejects_invalid_ir(sample_artifact, tmp_path):
    sample_artifact.slides[0].elements[0].content = ""
    out = tmp_path / "bad.pptx"
    with pytest.raises(ValueError, match="Invalid IR"):
        export_pptx(sample_artifact, out)
    assert not out.exists()


def test_export_rejects_image_element(sample_artifact, tmp_path):
    from draftboard.models import SlideElement

    sample_artifact.slides[1].elements.append(
        SlideElement(element_id="s2-img", type="image", content="diagram.png")
    )
    with pytest.raises(ValueError, match="not supported"):
        export_pptx(sample_artifact, tmp_path / "img.pptx")


def test_m0_default_layout_still_valid():
    data = {
        "artifact_id": "art-m0",
        "project_id": "p",
        "artifact_revision": 1,
        "outline_version": "v-1",
        "slides": [
            {
                "slide_id": "slide-001",
                "elements": [
                    {"element_id": "e1", "type": "title", "content": "T"},
                    {"element_id": "e2", "type": "text", "content": "Body"},
                ],
            }
        ],
    }
    artifact = Artifact.model_validate(data)
    assert artifact.slides[0].layout == SlideLayout.CONTENT
    assert validate_ir(artifact) == []


# ── Exported file checks ─────────────────────────────────────────────────────


@pytest.fixture
def exported(sample_artifact, tmp_path, font_pair) -> Presentation:
    out = tmp_path / "sample.pptx"
    export_pptx(sample_artifact, out, fonts=font_pair)
    return Presentation(str(out))


def test_canvas_size(exported):
    assert exported.slide_width == Pt(CANVAS_W_PT)
    assert exported.slide_height == Pt(CANVAS_H_PT)
    assert len(exported.slides) == 5


def test_no_content_loss(exported, sample_artifact):
    for pptx_slide, ir_slide in zip(exported.slides, sample_artifact.slides):
        joined = _all_text(pptx_slide)
        for el in ir_slide.elements:
            for line in el.content.split("\n"):
                assert line in joined, (
                    f"Lost text from {el.element_id}: {line!r}"
                )


def test_every_block_is_an_independent_textbox(exported, sample_artifact):
    # cover: title + subtitle; content: title + body; bullets: title + list;
    # two_column: title + left + right; closing: title + conclusion
    expected_boxes = [2, 2, 2, 3, 2]
    for pptx_slide, n in zip(exported.slides, expected_boxes):
        textboxes = [s for s in pptx_slide.shapes if s.has_text_frame]
        assert len(textboxes) == n
        assert all(s.shape_type is not None for s in textboxes)
        # no picture shapes anywhere
    for pptx_slide in exported.slides:
        assert not any(s.shape_type == 13 for s in pptx_slide.shapes)


def test_boxes_within_canvas_and_no_overlap(exported):
    for pptx_slide in exported.slides:
        boxes = [s for s in pptx_slide.shapes if s.has_text_frame]
        for s in boxes:
            assert s.left >= 0 and s.top >= 0
            assert s.left + s.width <= Pt(CANVAS_W_PT)
            assert s.top + s.height <= Pt(CANVAS_H_PT)
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                overlap_x = a.left < b.left + b.width and b.left < a.left + a.width
                overlap_y = a.top < b.top + b.height and b.top < a.top + a.height
                assert not (overlap_x and overlap_y), "Text boxes overlap"


def _find_box(slide, box_pt):
    x, y, w, h = box_pt
    for s in slide.shapes:
        if (s.left, s.top, s.width, s.height) == (Pt(x), Pt(y), Pt(w), Pt(h)):
            return s
    raise AssertionError(f"No shape at {box_pt}")


def test_fixed_coordinates(exported):
    slides = list(exported.slides)
    _find_box(slides[0], BOX_COVER_TITLE)
    _find_box(slides[0], BOX_COVER_SUBTITLE)
    _find_box(slides[1], BOX_TITLE)
    _find_box(slides[1], BOX_BODY)
    _find_box(slides[2], BOX_BODY)
    _find_box(slides[3], BOX_COLUMN_LEFT)
    _find_box(slides[3], BOX_COLUMN_RIGHT)
    _find_box(slides[4], BOX_CONCLUSION)


def test_font_sizes_and_line_spacing(exported):
    slides = list(exported.slides)
    cover_title = _find_box(slides[0], BOX_COVER_TITLE)
    p = cover_title.text_frame.paragraphs[0]
    assert p.runs[0].font.size == Pt(40)
    assert p.line_spacing == Pt(46)

    body = _find_box(slides[1], BOX_BODY)
    p = body.text_frame.paragraphs[0]
    assert p.runs[0].font.size == Pt(18)
    assert p.line_spacing == Pt(22)
    assert p.space_after == Pt(8)

    bullets = _find_box(slides[2], BOX_BODY)
    assert len(bullets.text_frame.paragraphs) == 3
    for p in bullets.text_frame.paragraphs:
        assert p.space_after == Pt(6)
        assert p._p.find(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}buChar"
        ) is not None


def test_dual_fonts(exported):
    body = _find_box(list(exported.slides)[1], BOX_BODY)
    run = body.text_frame.paragraphs[0].runs[0]
    assert run.font.name == "Calibri"
    rPr = run._r.find(
        "{http://schemas.openxmlformats.org/drawingml/2006/main}rPr"
    )
    ea = rPr.find("{http://schemas.openxmlformats.org/drawingml/2006/main}ea")
    assert ea is not None and ea.get("typeface") == "Microsoft YaHei"


def test_explicit_line_breaks_preserved(exported):
    subtitle = _find_box(list(exported.slides)[0], BOX_COVER_SUBTITLE)
    xml = subtitle.text_frame._txBody.xml
    assert "<a:br/>" in xml or "<a:br " in xml


def test_deterministic_layout(sample_artifact, tmp_path, font_pair):
    def geometry(path):
        export_pptx(sample_artifact, path, fonts=font_pair)
        prs = Presentation(str(path))
        return [
            [
                (s.shape_type, s.left, s.top, s.width, s.height,
                 s.text_frame.text if s.has_text_frame else None)
                for s in slide.shapes
            ]
            for slide in prs.slides
        ]

    assert geometry(tmp_path / "a.pptx") == geometry(tmp_path / "b.pptx")


def test_cli_export(sample_artifact, tmp_path, font_files, monkeypatch):
    from draftboard.__main__ import main
    import sys

    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    out = tmp_path / "cli.pptx"
    argv = ["draftboard", "export", str(SAMPLE_PATH), "-o", str(out)]
    old = sys.argv
    sys.argv = argv
    try:
        with pytest.raises(SystemExit) as exc:
            main()
    finally:
        sys.argv = old
    assert exc.value.code == 0
    assert out.exists()
    assert len(Presentation(str(out)).slides) == 5


# ── Measurement gate (phase 1, step 6 simple rules) ─────────────────────────


def test_overflow_blocks_export_with_ids(sample_artifact, tmp_path, font_pair):
    sample_artifact.slides[1].elements[1].content = "测" * 1000
    out = tmp_path / "overflow.pptx"
    with pytest.raises(ValueError) as exc:
        export_pptx(sample_artifact, out, fonts=font_pair)
    msg = str(exc.value)
    assert "OVERFLOW" in msg
    assert "slide-002" in msg and "s2-text" in msg
    assert not out.exists()


def test_overlong_word_blocks_export(sample_artifact, tmp_path, font_pair):
    url = "https://example.com/" + "a" * 100
    sample_artifact.slides[3].elements[1].content = url
    with pytest.raises(ValueError) as exc:
        export_pptx(sample_artifact, tmp_path / "url.pptx", fonts=font_pair)
    msg = str(exc.value)
    assert "OVERLONG_WORD" in msg
    assert "slide-004" in msg and "s4-left" in msg


def test_title_overflow_blocks_export(sample_artifact, tmp_path, font_pair):
    sample_artifact.slides[1].elements[0].content = "标" * 100
    with pytest.raises(ValueError, match="OVERFLOW"):
        export_pptx(sample_artifact, tmp_path / "title.pptx", fonts=font_pair)


def test_missing_font_blocks_export(sample_artifact, tmp_path, monkeypatch):
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(tmp_path / "absent.ttf"))
    with pytest.raises(FileNotFoundError, match="Font file not found"):
        export_pptx(sample_artifact, tmp_path / "nofont.pptx")


REAL_FONTS_EXIST = (
    pathlib.Path(r"C:\Windows\Fonts\calibri.ttf").exists()
    and pathlib.Path(r"C:\Windows\Fonts\msyh.ttc").exists()
)


@pytest.mark.skipif(not REAL_FONTS_EXIST, reason="real Windows fonts not available")
def test_sample_passes_with_real_fonts(sample_artifact, tmp_path):
    from draftboard.measure import load_fonts

    out = tmp_path / "real.pptx"
    export_pptx(sample_artifact, out, fonts=load_fonts())
    assert len(Presentation(str(out)).slides) == 5


# ── Step 2: Themes, Images, Speaker Notes & Controlled Auto-Fit ──────────────


@pytest.mark.parametrize(
    "theme_id", ["keynote_light", "keynote_dark", "nordic_pine", "gallery_sand"]
)
def test_named_themes_apply_chrome_and_preserve_content(
    sample_artifact, tmp_path, font_pair, theme_id
):
    from draftboard.themes import get_theme

    sample_artifact.template_id = theme_id
    sample_artifact.slides[0].speaker_notes = "开场白：介绍 Draftboard 的核心定位。"
    out = tmp_path / f"{theme_id}.pptx"
    export_pptx(sample_artifact, out, fonts=font_pair)

    prs = Presentation(str(out))
    theme = get_theme(theme_id)
    assert len(prs.slides) == 5

    # Cover slide has themed background and bold title
    cover = prs.slides[0]
    assert cover.background.fill.fore_color.rgb == theme.cover_bg_rgb
    assert cover.notes_slide.notes_text_frame.text == "开场白：介绍 Draftboard 的核心定位。"
    cover_title = _find_box(cover, BOX_COVER_TITLE)
    assert cover_title.text_frame.paragraphs[0].runs[0].font.bold is True

    # Content slide has themed background, formatted page number, and no textbox overlap
    content_slide = prs.slides[1]
    assert content_slide.background.fill.fore_color.rgb == theme.bg_rgb
    texts = _shape_texts(content_slide)
    assert any("02 / 05" in t for t in texts)
    boxes = [s for s in content_slide.shapes if s.has_text_frame]
    for i, a in enumerate(boxes):
        for b in boxes[i + 1:]:
            ox = a.left < b.left + b.width and b.left < a.left + a.width
            oy = a.top < b.top + b.height and b.top < a.top + a.height
            assert not (ox and oy)


def test_text_image_layout_embeds_native_picture(tmp_path, font_pair):
    from PIL import Image
    from draftboard.models import Slide, SlideElement
    from draftboard.pptx_export import BOX_TEXT_IMAGE_LEFT, BOX_TEXT_IMAGE_RIGHT

    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    img_file = assets_dir / "arch.png"
    Image.new("RGB", (800, 400), color=(37, 99, 235)).save(img_file)

    artifact = Artifact(
        artifact_id="art-img",
        project_id="proj-img",
        artifact_revision=1,
        outline_version="v-1",
        template_id="business_slate",
        slides=[
            Slide(
                slide_id="slide-001",
                layout=SlideLayout.TEXT_IMAGE,
                speaker_notes="结合右侧架构图讲解数据流。",
                elements=[
                    SlideElement(element_id="e1", type="title", content="系统架构总览"),
                    SlideElement(
                        element_id="e2",
                        type="text",
                        content="左侧为要点说明，右侧展示真实上传的架构图片。",
                    ),
                    SlideElement(element_id="e3", type="image", content="arch"),
                ],
            )
        ],
    )
    out = tmp_path / "with_image.pptx"
    export_pptx(artifact, out, fonts=font_pair, assets_dir=assets_dir)

    prs = Presentation(str(out))
    slide = prs.slides[0]
    pics = [s for s in slide.shapes if s.shape_type == 13]
    assert len(pics) == 1
    pic = pics[0]
    bx, by, bw, bh = BOX_TEXT_IMAGE_RIGHT
    # Aspect ratio 2:1 fitted inside 456x372 -> width=456pt, height=228pt, vertically centered
    assert pic.width == Pt(456)
    assert pic.height == Pt(228)
    assert pic.left >= Pt(bx) and pic.left + pic.width <= Pt(bx + bw)
    assert pic.top >= Pt(by) and pic.top + pic.height <= Pt(by + bh)
    # Left text box is at BOX_TEXT_IMAGE_LEFT
    _find_box(slide, BOX_TEXT_IMAGE_LEFT)
    assert slide.notes_slide.notes_text_frame.text == "结合右侧架构图讲解数据流。"


def test_missing_image_asset_blocks_export(tmp_path, font_pair):
    from draftboard.models import Slide, SlideElement

    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    artifact = Artifact(
        artifact_id="art-missing-img",
        project_id="proj-img",
        artifact_revision=1,
        outline_version="v-1",
        slides=[
            Slide(
                slide_id="slide-001",
                layout=SlideLayout.TEXT_IMAGE,
                elements=[
                    SlideElement(element_id="e1", type="title", content="缺图测试"),
                    SlideElement(element_id="e2", type="text", content="说明文字。"),
                    SlideElement(element_id="e3", type="image", content="not_found"),
                ],
            )
        ],
    )
    with pytest.raises(ValueError, match="MISSING_IMAGE"):
        export_pptx(artifact, tmp_path / "fail.pptx", fonts=font_pair, assets_dir=assets_dir)


def test_auto_fit_steps_down_and_respects_floor(sample_artifact, tmp_path, font_pair):
    # Moderate overflow at 18pt (~750 CJK chars overflows 18pt, fits comfortably at 14pt)
    sample_artifact.slides[1].elements[1].content = "测" * 750

    with pytest.raises(ValueError, match="OVERFLOW"):
        export_pptx(sample_artifact, tmp_path / "strict.pptx", fonts=font_pair, auto_fit=False)

    out = tmp_path / "autofit.pptx"
    export_pptx(sample_artifact, out, fonts=font_pair, auto_fit=True)
    prs = Presentation(str(out))
    body = _find_box(prs.slides[1], BOX_BODY)
    used_size = body.text_frame.paragraphs[0].runs[0].font.size
    assert used_size in (Pt(16), Pt(14))

    # Extreme overflow (~2000 CJK chars) still blocks at 14pt floor
    sample_artifact.slides[1].elements[1].content = "测" * 2000
    with pytest.raises(ValueError, match="min 14pt"):
        export_pptx(sample_artifact, tmp_path / "too_big.pptx", fonts=font_pair, auto_fit=True)