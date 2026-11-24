"""Brand footers and table cells are measured like the PPTX that would be written."""

import json
import sys

import pytest
from pptx import Presentation

import draftboard.generation_snapshot as generation_snapshot
import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.measure import measure_box
from draftboard.models import (
    Artifact,
    CanvasElement,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
    SlideLayout,
)
from draftboard.pptx_export import export_pptx
from draftboard.storage import ProjectStorage


def _artifact(slides, **kwargs) -> Artifact:
    return Artifact(
        artifact_id=kwargs.pop("artifact_id", "art-ft"),
        project_id=kwargs.pop("project_id", "p"),
        artifact_revision=1,
        outline_version="v-1",
        template_id="default",
        slides=slides,
        **kwargs,
    )


def _content(text: str = "正文", slide_id: str = "slide-001") -> Slide:
    return Slide(
        slide_id=slide_id,
        layout=SlideLayout.CONTENT,
        elements=[
            SlideElement(element_id=f"{slide_id}-title", type="title", content="标题"),
            SlideElement(element_id=f"{slide_id}-text", type="text", content=text),
        ],
    )


def _cover() -> Slide:
    return Slide(
        slide_id="slide-cover",
        layout=SlideLayout.COVER,
        elements=[
            SlideElement(element_id="c-title", type="title", content="封面"),
            SlideElement(element_id="c-sub", type="subtitle", content="副标题"),
        ],
    )


def _table_slide(rows, *, width=200, height=120, font=14, element_id="tbl") -> Slide:
    return Slide(
        slide_id="slide-001",
        layout=SlideLayout.CONTENT,
        elements=[
            SlideElement(element_id="t", type="title", content="表"),
            SlideElement(element_id="b", type="text", content="占位"),
        ],
        custom_elements=[
            CanvasElement(
                id=element_id,
                kind="table",
                x=48,
                y=120,
                w=width,
                h=height,
                headers=["名", "值"],
                rows=rows,
                table_font_size=font,
            )
        ],
    )


def _export(artifact, path, font_pair, brand=None):
    export_pptx(artifact, path, fonts=font_pair, brand=brand)


def test_short_footer_and_table_stay_editable(tmp_path, font_pair):
    footer = "Draftboard"
    out = tmp_path / "ok.pptx"
    _export(_artifact([_content()]), out, font_pair, brand={"footer_text": footer})
    prs = Presentation(str(out))
    frames = [
        shape.text_frame.text
        for slide in prs.slides
        for shape in slide.shapes
        if shape.has_text_frame
    ]
    assert footer in frames
    assert any(shape.has_text_frame and not shape.has_table for shape in prs.slides[0].shapes)

    table_out = tmp_path / "table.pptx"
    _export(
        _artifact([_table_slide([["甲", "12"]], width=320, height=160)]),
        table_out,
        font_pair,
    )
    prs = Presentation(str(table_out))
    tables = [shape.table for shape in prs.slides[0].shapes if shape.has_table]
    assert tables
    assert tables[0].cell(1, 0).text == "甲"
    assert tables[0].cell(1, 1).text == "12"


def test_footer_overflow_names_the_slide_and_writes_nothing(tmp_path, font_pair):
    out = tmp_path / "long.pptx"
    artifact = _artifact([_cover(), _content(slide_id="slide-002")])
    with pytest.raises(ValueError) as exc:
        _export(artifact, out, font_pair, brand={"footer_text": "测" * 80})
    message = str(exc.value)
    assert "slide-002" in message and "brand-footer" in message
    assert "slide-cover" not in message
    assert "OVERLONG_WORD" in message
    assert not out.exists()

    with pytest.raises(ValueError, match="brand-footer"):
        _export(
            _artifact([_content()]),
            tmp_path / "url.pptx",
            font_pair,
            brand={"footer_text": "https://example.com/" + ("a" * 130)},
        )
    assert not (tmp_path / "url.pptx").exists()

    wrapped = tmp_path / "newline.pptx"
    with pytest.raises(ValueError, match=r"brand-footer.*OVERFLOW|OVERFLOW.*brand-footer"):
        _export(
            _artifact([_content()]),
            wrapped,
            font_pair,
            brand={"footer_text": "页脚\n第二行"},
        )
    assert not wrapped.exists()


def test_footer_is_not_shrunk_by_auto_fit(tmp_path, font_pair):
    artifact = _artifact([_content()], auto_fit=True)
    with pytest.raises(ValueError, match="brand-footer") as exc:
        _export(artifact, tmp_path / "fit.pptx", font_pair, brand={"footer_text": "测" * 80})
    assert "min" not in str(exc.value)
    assert not (tmp_path / "fit.pptx").exists()


def test_table_cell_overflow_is_per_column_and_row(tmp_path, font_pair):
    # Latin on the synthetic font is 7pt at 14pt.  A column of 80pt leaves
    # 64pt after padding, so a 10-character token does not fit that column
    # but would fit the full 160pt table.  CJK can break, so this token must
    # not.
    wide = _table_slide([["abcdefghij", "1"]], width=160, height=80, font=14)
    with pytest.raises(ValueError) as exc:
        _export(_artifact([wide]), tmp_path / "wide.pptx", font_pair)
    message = str(exc.value)
    assert "element 'tbl', cell r2c1" in message
    assert "OVERLONG_WORD" in message
    assert not (tmp_path / "wide.pptx").exists()

    url = _table_slide(
        [["名称", "https://example.com/" + ("a" * 40)]],
        width=420,
        height=120,
        font=14,
    )
    with pytest.raises(ValueError, match=r"cell r2c2.*OVERLONG_WORD|OVERLONG_WORD.*cell r2c2"):
        _export(_artifact([url]), tmp_path / "cell-url.pptx", font_pair)

    tall = _table_slide([["甲\n乙", "1"]], width=320, height=80, font=14)
    with pytest.raises(ValueError, match=r"cell r2c1.*OVERFLOW|OVERFLOW.*cell r2c1"):
        _export(_artifact([tall]), tmp_path / "tall.pptx", font_pair)

    # Four characters sit on the padding boundary and still export.
    edge = _table_slide([["甲乙丙丁", "1"]], width=160, height=80, font=14)
    _export(_artifact([edge]), tmp_path / "edge.pptx", font_pair)
    assert (tmp_path / "edge.pptx").exists()


def test_table_auto_fit_does_not_shrink_below_the_chosen_size(tmp_path, font_pair):
    cramped = _table_slide([["abcdefghij", "1"]], width=160, height=80, font=14)
    artifact = _artifact([cramped], auto_fit=True)
    with pytest.raises(ValueError, match="cell r2c1"):
        _export(artifact, tmp_path / "no-shrink.pptx", font_pair)

    smaller = _table_slide([["abcdefghij", "1"]], width=160, height=80, font=10)
    # 10pt * 5 = 50pt, available width is 56pt, so the user's smaller size fits.
    _export(_artifact([smaller]), tmp_path / "size10.pptx", font_pair)
    prs = Presentation(str(tmp_path / "size10.pptx"))
    table = next(shape.table for shape in prs.slides[0].shapes if shape.has_table)
    assert table.cell(1, 0).text == "abcdefghij"
    run = table.cell(1, 0).text_frame.paragraphs[0].runs[0]
    assert run.font.size.pt == 10


def test_nowrap_measure_does_not_split_a_footer_line(font_pair):
    measured = measure_box(
        ["测" * 10],
        fonts=font_pair,
        width_pt=50,
        height_pt=20,
        size_pt=9,
        line_pt=12,
        pad_x_pt=0,
        pad_y_pt=0,
        wrap=False,
    )
    assert measured.paragraphs[0].line_count == 1
    assert any(issue.code == "OVERLONG_WORD" for issue in measured.issues)


def test_failed_export_keeps_the_previous_pptx(tmp_path, font_files, monkeypatch):
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    pid = "keep-prev"
    storage = ProjectStorage(pid, storage_root=tmp_path)
    (storage.root / "meta.json").write_text(
        json.dumps({"brand": {"footer_text": "短页脚"}}), encoding="utf-8"
    )
    good = _artifact([_content()], artifact_id="art-good", project_id=pid)
    storage.save_artifact(good)
    first = tools_module.export_deck_impl(pid, good.artifact_id, 1)
    assert first.success
    original = open(first.pptx_path, "rb").read()

    (storage.root / "meta.json").write_text(
        json.dumps({"brand": {"footer_text": "测" * 80}}), encoding="utf-8"
    )
    bad = _artifact([_content()], artifact_id="art-bad", project_id=pid)
    storage.save_artifact(bad)
    second = tools_module.export_deck_impl(pid, bad.artifact_id, 1)
    assert second.success is False
    assert second.pptx_path is None
    assert "brand-footer" in second.issues[0].message
    assert "slide-001" in second.issues[0].message
    assert open(first.pptx_path, "rb").read() == original
    assert not (storage.root / "exports" / "art-bad-r1.pptx").exists()


def test_cli_export_deck_uses_the_same_footer_check(tmp_path, font_files, monkeypatch, capsys):
    from draftboard.__main__ import main

    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    pid = "cli-ft"
    storage = ProjectStorage(pid, storage_root=tmp_path)
    (storage.root / "meta.json").write_text(
        json.dumps({"brand": {"footer_text": "ok"}}), encoding="utf-8"
    )
    art = _artifact([_content()], artifact_id="art-cli", project_id=pid)
    storage.save_artifact(art)
    monkeypatch.setattr(sys, "argv", ["draftboard", "export-deck", pid, art.artifact_id])
    with pytest.raises(SystemExit) as ok:
        main()
    assert ok.value.code == 0
    capsys.readouterr()
    assert (storage.root / "exports" / "art-cli-r1.pptx").exists()

    (storage.root / "meta.json").write_text(
        json.dumps({"brand": {"footer_text": "测" * 80}}), encoding="utf-8"
    )
    # The successful file is cached for this revision.  A new unfingerprinted
    # revision must be measured again instead of reusing that file.
    art.artifact_revision = 2
    art.input_fingerprint = None
    storage.save_artifact(art)
    monkeypatch.setattr(sys, "argv", ["draftboard", "export-deck", pid, art.artifact_id, "--revision", "2"])
    with pytest.raises(SystemExit) as bad:
        main()
    captured = capsys.readouterr()
    assert bad.value.code == 1
    assert "brand-footer" in captured.err
    assert not (storage.root / "exports" / "art-cli-r2.pptx").exists()
    assert (storage.root / "exports" / "art-cli-r1.pptx").exists()


def test_rule_version_changes_the_fingerprint(font_pair, monkeypatch):
    outline = Outline(
        outline_version="v-1",
        project_id="p",
        items=[
            OutlineItem(
                outline_item_id="i",
                title="标题",
                summary="正文",
                source_ids=["s"],
                evidence_status="supported",
            )
        ],
        is_confirmed=True,
    )
    monkeypatch.setattr(generation_snapshot, "EXPORT_RULE_VERSION", "1")
    old = generation_snapshot.freeze_generation_inputs(
        outline, template_id="default", auto_fit=False, brand=None, assets_dir=None
    )
    monkeypatch.setattr(generation_snapshot, "EXPORT_RULE_VERSION", "2")
    new = generation_snapshot.freeze_generation_inputs(
        outline, template_id="default", auto_fit=False, brand=None, assets_dir=None
    )
    assert old.fingerprint != new.fingerprint
    assert generation_snapshot.EXPORT_RULE_VERSION == "2"


@pytest.mark.skipif(
    not (
        __import__("pathlib").Path(r"C:\Windows\Fonts\calibri.ttf").exists()
        and __import__("pathlib").Path(r"C:\Windows\Fonts\msyh.ttc").exists()
    ),
    reason="real Windows fonts not available",
)
def test_real_fonts_reject_a_long_footer(tmp_path):
    from draftboard.measure import load_fonts

    fonts = load_fonts()
    _export(
        _artifact([_content()]),
        tmp_path / "short.pptx",
        fonts,
        brand={"footer_text": "页脚"},
    )
    assert (tmp_path / "short.pptx").exists()
    with pytest.raises(ValueError, match="brand-footer"):
        _export(
            _artifact([_content()]),
            tmp_path / "long.pptx",
            fonts,
            brand={"footer_text": "测" * 80},
        )
    assert not (tmp_path / "long.pptx").exists()
