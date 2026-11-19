"""
Step-8 pipeline tests: outline validation, verbatim generation, export tool,
and CLI confirmation flow.  Offline — no model calls.
"""

import json
import sys

import pytest
from pptx import Presentation

import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.models import (
    Artifact,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
    SlideLayout,
)
from draftboard.storage import ProjectStorage

PROJECT_ID = "pipe-proj"


@pytest.fixture(autouse=True)
def inject_storage_root(tmp_path):
    tools_module._storage_root = tmp_path
    yield
    tools_module._storage_root = None


@pytest.fixture
def font_env(font_files, monkeypatch):
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


def _storage(tmp_path):
    return ProjectStorage(PROJECT_ID, storage_root=tmp_path)


def _read_materials(tmp_path):
    assets = tmp_path / PROJECT_ID / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    (assets / "intro.md").write_text(
        "# Intro\n\nSome material text.\n", encoding="utf-8"
    )
    return _raw(tools_module.read_materials)(project_id=PROJECT_ID)


def _item(iid="item-1", title="标题", summary="摘要内容。", layout=None,
          source_ids=None):
    return OutlineItem(
        outline_item_id=iid,
        title=title,
        summary=summary,
        source_ids=source_ids if source_ids is not None else ["intro-L1"],
        evidence_status=EvidenceStatus.SUPPORTED,
        layout=layout,
    )


def _propose(tmp_path, items):
    return _raw(tools_module.propose_outline)(
        project_id=PROJECT_ID, material_snapshot_id="snap-1", items=items
    )


def _confirm_and_generate(tmp_path, outline):
    storage = _storage(tmp_path)
    storage.confirm_outline(outline.outline_version)
    return _raw(tools_module.generate_slides)(
        project_id=PROJECT_ID,
        approved_outline_version=outline.outline_version,
        idempotency_key="",
    )


# ── source persistence & outline validation ─────────────────────────────────


def test_read_materials_persists_sources(tmp_path):
    _read_materials(tmp_path)
    assert "intro-L1" in _storage(tmp_path).load_source_ids()


def test_propose_rejects_unknown_citation(tmp_path):
    _read_materials(tmp_path)
    with pytest.raises(ValueError, match="unknown source_id 'made-up-L9'"):
        _propose(tmp_path, [_item(source_ids=["made-up-L9"])])
    assert not (_storage(tmp_path).root / "outlines").exists()


def test_propose_rejects_empty_fields(tmp_path):
    _read_materials(tmp_path)
    with pytest.raises(ValueError, match="empty title"):
        _propose(tmp_path, [_item(title="  ")])
    with pytest.raises(ValueError, match="empty summary"):
        _propose(tmp_path, [_item(summary="")])
    with pytest.raises(ValueError, match="cites no source_ids"):
        _propose(tmp_path, [_item(source_ids=[])])


def test_propose_rejects_duplicate_item_ids(tmp_path):
    _read_materials(tmp_path)
    with pytest.raises(ValueError, match="Duplicate outline_item_id"):
        _propose(tmp_path, [_item(), _item()])


def test_propose_rejects_two_column_layout(tmp_path):
    _read_materials(tmp_path)
    with pytest.raises(ValueError, match="two_column"):
        _propose(tmp_path, [_item(layout=SlideLayout.TWO_COLUMN)])


def test_propose_saves_unconfirmed_candidate(tmp_path):
    _read_materials(tmp_path)
    outline = _propose(tmp_path, [_item()])
    assert outline.is_confirmed is False
    loaded = _storage(tmp_path).load_outline(outline.outline_version)
    assert loaded == outline


# ── verbatim generation with layout mapping ─────────────────────────────────


def test_default_layout_mapping_and_verbatim_text(tmp_path):
    _read_materials(tmp_path)
    items = [
        _item("i1", title="封面标题", summary="副标题文案"),
        _item("i2", title="正文标题", summary="正文第一段。\n正文第二段。"),
        _item("i3", title="收尾标题", summary="结论文案"),
    ]
    outline = _propose(tmp_path, items)
    artifact = _confirm_and_generate(tmp_path, outline)
    assert [s.layout for s in artifact.slides] == [
        SlideLayout.COVER, SlideLayout.CONTENT, SlideLayout.CLOSING
    ]
    cover, content, closing = artifact.slides
    assert cover.elements[1].type == "subtitle"
    assert cover.elements[1].content == "副标题文案"
    assert content.elements[1].type == "text"
    assert content.elements[1].content == "正文第一段。\n正文第二段。"
    assert closing.elements[1].type == "conclusion"
    assert closing.elements[1].content == "结论文案"
    for slide, item in zip(artifact.slides, items):
        assert slide.elements[0].content == item.title


def test_single_item_becomes_cover(tmp_path):
    _read_materials(tmp_path)
    outline = _propose(tmp_path, [_item()])
    artifact = _confirm_and_generate(tmp_path, outline)
    assert artifact.slides[0].layout == SlideLayout.COVER


def test_explicit_bullets_split_verbatim(tmp_path):
    _read_materials(tmp_path)
    outline = _propose(
        tmp_path,
        [_item(summary="要点一\n要点二\n\n要点三", layout=SlideLayout.BULLETS)],
    )
    artifact = _confirm_and_generate(tmp_path, outline)
    slide = artifact.slides[0]
    assert slide.layout == SlideLayout.BULLETS
    bullets = [el for el in slide.elements if el.type == "bullet"]
    assert [b.content for b in bullets] == ["要点一", "要点二", "要点三"]


def test_generate_requires_confirmation(tmp_path):
    _read_materials(tmp_path)
    outline = _propose(tmp_path, [_item()])
    with pytest.raises(ValueError, match="not been confirmed"):
        _raw(tools_module.generate_slides)(
            project_id=PROJECT_ID,
            approved_outline_version=outline.outline_version,
        )


# ── export_deck tool ─────────────────────────────────────────────────────────


def _generated_artifact(tmp_path, summary="正常长度的摘要内容。"):
    _read_materials(tmp_path)
    outline = _propose(tmp_path, [_item(summary=summary)])
    return _confirm_and_generate(tmp_path, outline)


def test_export_deck_success_writes_file_and_report(tmp_path, font_env):
    artifact = _generated_artifact(tmp_path)
    result = _raw(tools_module.export_deck)(
        project_id=PROJECT_ID, artifact_id=artifact.artifact_id, revision=1
    )
    assert result.success is True
    assert result.slide_count == 1
    pptx = tmp_path / PROJECT_ID / "exports" / f"{artifact.artifact_id}-r1.pptx"
    assert pptx.exists()
    assert result.pptx_path == str(pptx)
    assert len(Presentation(str(pptx)).slides) == 1
    report = json.loads(
        (pptx.parent / f"{artifact.artifact_id}-r1.report.json").read_text(
            encoding="utf-8"
        )
    )
    assert report["success"] is True


def test_export_deck_overflow_returns_issues_no_file(tmp_path, font_env):
    artifact = _generated_artifact(tmp_path, summary="测" * 1000)
    result = _raw(tools_module.export_deck)(
        project_id=PROJECT_ID, artifact_id=artifact.artifact_id, revision=1
    )
    assert result.success is False
    assert result.pptx_path is None
    assert result.issues[0].code == "EXPORT_FAILED"
    msg = result.issues[0].message
    assert "OVERFLOW" in msg and "slide-001" in msg
    exports = tmp_path / PROJECT_ID / "exports"
    assert not (exports / f"{artifact.artifact_id}-r1.pptx").exists()
    report = json.loads(
        (exports / f"{artifact.artifact_id}-r1.report.json").read_text(
            encoding="utf-8"
        )
    )
    assert report["success"] is False


def test_export_deck_idempotent(tmp_path, font_env):
    artifact = _generated_artifact(tmp_path)
    fn = _raw(tools_module.export_deck)
    r1 = fn(project_id=PROJECT_ID, artifact_id=artifact.artifact_id, revision=1,
            idempotency_key="exp-key-1")
    r2 = fn(project_id=PROJECT_ID, artifact_id=artifact.artifact_id, revision=1,
            idempotency_key="exp-key-1")
    assert r1 == r2


def test_validate_artifact_includes_ir_errors(tmp_path):
    storage = _storage(tmp_path)
    artifact = Artifact(
        artifact_id="art-bad", project_id=PROJECT_ID, artifact_revision=1,
        outline_version="v-x",
        slides=[Slide(slide_id="slide-001", elements=[
            SlideElement(element_id="dup", type="title", content="T"),
            SlideElement(element_id="dup", type="text", content="B"),
        ])],
    )
    storage.save_artifact(artifact)
    report = _raw(tools_module.validate_artifact)(
        artifact_id="art-bad", revision=1
    )
    assert any(i.code == "IR_INVALID" and "Duplicate element_id" in i.message
               for i in report.issues)


# ── CLI confirmation flow ────────────────────────────────────────────────────


def _run_cli(argv, monkeypatch, tmp_path):
    from draftboard.__main__ import main

    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    monkeypatch.setattr(sys, "argv", ["draftboard"] + argv)
    with pytest.raises(SystemExit) as exc:
        main()
    return exc.value.code


def test_cli_outline_confirm_export_flow(tmp_path, font_env, monkeypatch, capsys):
    _read_materials(tmp_path)
    outline = _propose(tmp_path, [_item(), _item("i2", title="第二页")])

    code = _run_cli(["outline", PROJECT_ID, outline.outline_version],
                    monkeypatch, tmp_path)
    assert code == 0
    out = capsys.readouterr().out
    assert "DRAFT" in out and "标题" in out

    code = _run_cli(["confirm", PROJECT_ID, outline.outline_version],
                    monkeypatch, tmp_path)
    assert code == 0
    assert _storage(tmp_path).load_outline(outline.outline_version).is_confirmed

    artifact = _raw(tools_module.generate_slides)(
        project_id=PROJECT_ID, approved_outline_version=outline.outline_version
    )
    code = _run_cli(["export-deck", PROJECT_ID, artifact.artifact_id],
                    monkeypatch, tmp_path)
    assert code == 0
    assert (tmp_path / PROJECT_ID / "exports" /
            f"{artifact.artifact_id}-r1.pptx").exists()


def test_cli_export_deck_failure_exit_code(tmp_path, font_env, monkeypatch, capsys):
    artifact = _generated_artifact(tmp_path, summary="测" * 1000)
    code = _run_cli(["export-deck", PROJECT_ID, artifact.artifact_id],
                    monkeypatch, tmp_path)
    assert code == 1
    assert "OVERFLOW" in capsys.readouterr().err