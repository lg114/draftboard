"""
Unit tests for draftboard.tools (uses tmp_path, no API key required).

Dependency injection: sets draftboard.tools._storage_root = tmp_path so all
tool calls write to a temporary directory.
"""

import pathlib
import pytest

import draftboard.tools as tools_module
from draftboard.models import (
    Artifact,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
)
from draftboard.storage import ProjectStorage


PROJECT_ID = "test-proj"


@pytest.fixture(autouse=True)
def inject_storage_root(tmp_path):
    """Redirect all tool storage to tmp_path for each test."""
    tools_module._storage_root = tmp_path
    yield
    tools_module._storage_root = None


def _storage(tmp_path) -> ProjectStorage:
    return ProjectStorage(PROJECT_ID, storage_root=tmp_path)


def _make_confirmed_outline(tmp_path, version="v-testout1") -> Outline:
    storage = _storage(tmp_path)
    outline = Outline(
        outline_version=version,
        project_id=PROJECT_ID,
        items=[
            OutlineItem(
                outline_item_id="item-1",
                title="Introduction",
                summary="Overview.",
                source_ids=["intro-L1"],
                evidence_status=EvidenceStatus.SUPPORTED,
            )
        ],
        is_confirmed=True,
    )
    storage.save_outline(outline)
    return outline


def _make_artifact(tmp_path, artifact_id="art-test001", revision=1) -> Artifact:
    storage = _storage(tmp_path)
    artifact = Artifact(
        artifact_id=artifact_id,
        project_id=PROJECT_ID,
        artifact_revision=revision,
        slides=[
            Slide(
                slide_id="slide-001",
                elements=[
                    SlideElement(
                        element_id="slide-001-title",
                        type="title",
                        content="Hello",
                    ),
                    SlideElement(
                        element_id="slide-001-text",
                        type="text",
                        content="Body text.",
                    ),
                ],
            )
        ],
        outline_version="v-testout1",
    )
    storage.save_artifact(artifact)
    return artifact


# ── Helper to get the raw (unwrapped) tool function ──────────────────────────


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


# ── 1. read_materials reads md file and returns fragments ─────────────────────


def test_read_materials_markdown(tmp_path):
    assets_dir = tmp_path / PROJECT_ID / "assets"
    assets_dir.mkdir(parents=True)
    md_file = assets_dir / "notes.md"
    md_file.write_text("# Title\n\nLine 2\nLine 3\n", encoding="utf-8")

    fn = _raw(tools_module.read_materials)
    output = fn(project_id=PROJECT_ID)
    assert len(output.materials) == 1
    assert output.materials[0].asset_id == "notes"
    assert "# Title" in output.materials[0].content
    assert len(output.source_fragments) >= 1
    assert output.source_fragments[0].location.startswith("L1")


# ── 2. read_materials reads image files ──────────────────────────────────────


def test_read_materials_image(tmp_path):
    assets_dir = tmp_path / PROJECT_ID / "assets"
    assets_dir.mkdir(parents=True)
    img_file = assets_dir / "diagram.png"
    img_file.write_bytes(b"\x89PNG\r\n\x1a\n")  # minimal PNG header

    fn = _raw(tools_module.read_materials)
    output = fn(project_id=PROJECT_ID)
    assert len(output.materials) == 1
    mat = output.materials[0]
    assert "[image:" in mat.content
    assert mat.asset_id == "diagram"
    # Image fragment has no content_preview
    frag = output.source_fragments[0]
    assert frag.content_preview is None


# ── 3. generate_slides on unconfirmed outline raises ValueError ───────────────


def test_generate_slides_unconfirmed_raises(tmp_path):
    storage = _storage(tmp_path)
    outline = Outline(
        outline_version="v-unconfirm",
        project_id=PROJECT_ID,
        items=[
            OutlineItem(
                outline_item_id="i1",
                title="T",
                summary="S",
                source_ids=[],
                evidence_status=EvidenceStatus.UNSUPPORTED,
            )
        ],
        is_confirmed=False,
    )
    storage.save_outline(outline)

    with pytest.raises(ValueError, match="not been confirmed"):
        _raw(tools_module.generate_slides)(
            project_id=PROJECT_ID,
            approved_outline_version="v-unconfirm",
            template_id="default",
            idempotency_key="key-unconfirm",
        )


# ── 4. patch_slide on wrong revision raises ValueError ───────────────────────


def test_patch_slide_wrong_revision_raises(tmp_path):
    _make_artifact(tmp_path, revision=1)

    with pytest.raises((ValueError, KeyError)):
        _raw(tools_module.patch_slide)(
            artifact_id="art-test001",
            slide_id="slide-001",
            expected_revision=99,  # wrong
            operation_type="replace_text",
            element_id="slide-001-text",
            new_content="New body.",
            idempotency_key="key-wrong-rev",
        )


# ── 5. patch_slide with invalid operation_type raises ValueError ──────────────


def test_patch_slide_invalid_operation_raises(tmp_path):
    _make_artifact(tmp_path, revision=1)

    with pytest.raises(ValueError, match="Invalid operation_type"):
        _raw(tools_module.patch_slide)(
            artifact_id="art-test001",
            slide_id="slide-001",
            expected_revision=1,
            operation_type="delete_slide",  # invalid
            element_id="slide-001-text",
            new_content="x",
            idempotency_key="key-bad-op",
        )


# ── 6. validate_artifact with no title returns ERROR ─────────────────────────


def test_validate_artifact_no_title(tmp_path):
    storage = _storage(tmp_path)
    artifact = Artifact(
        artifact_id="art-notitle",
        project_id=PROJECT_ID,
        artifact_revision=1,
        slides=[
            Slide(
                slide_id="slide-001",
                elements=[
                    SlideElement(
                        element_id="slide-001-text",
                        type="text",  # no title!
                        content="Body.",
                    )
                ],
            )
        ],
        outline_version="v-x",
    )
    storage.save_artifact(artifact)

    report = _raw(tools_module.validate_artifact)(
        artifact_id="art-notitle", revision=1
    )
    assert report.has_errors is True
    assert any(i.code == "MISSING_TITLE" for i in report.issues)


# ── 7. Idempotency: same key returns same artifact_id ────────────────────────


def test_generate_slides_idempotency(tmp_path):
    _make_confirmed_outline(tmp_path)

    fn = _raw(tools_module.generate_slides)
    result1 = fn(
        project_id=PROJECT_ID,
        approved_outline_version="v-testout1",
        template_id="default",
        idempotency_key="idem-key-xyz",
    )
    result2 = fn(
        project_id=PROJECT_ID,
        approved_outline_version="v-testout1",
        template_id="default",
        idempotency_key="idem-key-xyz",
    )
    assert result1.artifact_id == result2.artifact_id
    assert result1.artifact_revision == result2.artifact_revision
