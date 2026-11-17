"""
Unit tests for draftboard.storage (uses tmp_path fixture, never touches ~/.draftboard).
"""

import pytest

from draftboard.models import (
    Artifact,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
)
from draftboard.storage import ProjectStorage


# ── Fixtures ──────────────────────────────────────────────────────────────────


def make_storage(tmp_path, project_id="proj-test"):
    return ProjectStorage(project_id, storage_root=tmp_path)


def make_outline(version="v-abc12345") -> Outline:
    return Outline(
        outline_version=version,
        project_id="proj-test",
        items=[
            OutlineItem(
                outline_item_id="item-1",
                title="Intro",
                summary="Introduction section.",
                source_ids=["intro-L1"],
                evidence_status=EvidenceStatus.SUPPORTED,
            )
        ],
        is_confirmed=False,
    )


def make_artifact(artifact_id="art-abc12345", revision=1) -> Artifact:
    return Artifact(
        artifact_id=artifact_id,
        project_id="proj-test",
        artifact_revision=revision,
        slides=[
            Slide(
                slide_id="slide-001",
                elements=[
                    SlideElement(
                        element_id="slide-001-title",
                        type="title",
                        content="Hello",
                    )
                ],
            )
        ],
        outline_version="v-abc12345",
    )


# ── 1. save_outline / load_outline roundtrip ──────────────────────────────────


def test_save_and_load_outline(tmp_path):
    storage = make_storage(tmp_path)
    outline = make_outline()
    storage.save_outline(outline)
    loaded = storage.load_outline(outline.outline_version)
    assert loaded.outline_version == outline.outline_version
    assert loaded.project_id == outline.project_id
    assert len(loaded.items) == 1
    assert loaded.items[0].title == "Intro"
    assert loaded.is_confirmed is False


# ── 2. confirm_outline sets is_confirmed and persists ─────────────────────────


def test_confirm_outline(tmp_path):
    storage = make_storage(tmp_path)
    outline = make_outline()
    storage.save_outline(outline)
    confirmed = storage.confirm_outline(outline.outline_version)
    assert confirmed.is_confirmed is True
    # Reload from disk and verify persistence
    reloaded = storage.load_outline(outline.outline_version)
    assert reloaded.is_confirmed is True


# ── 3. load_outline missing raises KeyError ───────────────────────────────────


def test_load_outline_missing_raises(tmp_path):
    storage = make_storage(tmp_path)
    with pytest.raises(KeyError):
        storage.load_outline("v-nonexistent")


# ── 4. save_artifact / load_artifact roundtrip ───────────────────────────────


def test_save_and_load_artifact(tmp_path):
    storage = make_storage(tmp_path)
    artifact = make_artifact()
    storage.save_artifact(artifact)
    loaded = storage.load_artifact(artifact.artifact_id, artifact.artifact_revision)
    assert loaded.artifact_id == artifact.artifact_id
    assert loaded.artifact_revision == 1
    assert loaded.slides[0].slide_id == "slide-001"


# ── 5. next_revision ─────────────────────────────────────────────────────────


def test_next_revision_empty(tmp_path):
    storage = make_storage(tmp_path)
    assert storage.next_revision("art-new") == 1


def test_next_revision_after_save(tmp_path):
    storage = make_storage(tmp_path)
    artifact = make_artifact(revision=1)
    storage.save_artifact(artifact)
    assert storage.next_revision(artifact.artifact_id) == 2


# ── 6. Idempotent result roundtrip ───────────────────────────────────────────


def test_idempotent_save_and_load(tmp_path):
    storage = make_storage(tmp_path)
    key = "my-unique-key-abc"
    data = {"artifact_id": "art-123", "artifact_revision": 1}
    storage.save_idempotent_result(key, data)
    loaded = storage.load_idempotent_result(key)
    assert loaded == data


# ── 7. Idempotent result missing returns None ─────────────────────────────────


def test_idempotent_load_missing_returns_none(tmp_path):
    storage = make_storage(tmp_path)
    result = storage.load_idempotent_result("nonexistent-key")
    assert result is None
