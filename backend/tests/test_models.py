"""
Unit tests for draftboard.models (pure Pydantic validation, no API key needed).
"""

import pytest
from pydantic import ValidationError

from draftboard.models import (
    Artifact,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
    ValidationIssue,
    ValidationLevel,
    ValidationReport,
)


def _make_item(item_id: str = "item-1") -> OutlineItem:
    return OutlineItem(
        outline_item_id=item_id,
        title="Introduction",
        summary="Overview of the project.",
        source_ids=["intro-L1"],
        evidence_status=EvidenceStatus.SUPPORTED,
    )


def _make_outline(**kwargs) -> Outline:
    defaults = dict(
        outline_version="v-abcd1234",
        project_id="proj-test",
        items=[_make_item()],
    )
    defaults.update(kwargs)
    return Outline(**defaults)


# ── 1. Outline valid construction ─────────────────────────────────────────────


def test_outline_valid_construction():
    outline = _make_outline()
    assert outline.project_id == "proj-test"
    assert outline.outline_version == "v-abcd1234"
    assert len(outline.items) == 1
    assert outline.is_confirmed is False


# ── 2. Outline confirmed ──────────────────────────────────────────────────────


def test_outline_confirmed():
    outline = _make_outline(is_confirmed=True)
    assert outline.is_confirmed is True


# ── 3. ValidationReport.has_errors ───────────────────────────────────────────


def test_validation_report_has_errors_true():
    report = ValidationReport(
        artifact_id="art-1",
        artifact_revision=1,
        issues=[
            ValidationIssue(
                level=ValidationLevel.ERROR,
                code="MISSING_TITLE",
                message="No title element.",
                slide_id="slide-001",
            )
        ],
    )
    assert report.has_errors is True


def test_validation_report_has_errors_false():
    report = ValidationReport(
        artifact_id="art-1",
        artifact_revision=1,
        issues=[
            ValidationIssue(
                level=ValidationLevel.WARNING,
                code="EMPTY_CONTENT",
                message="Empty content.",
            )
        ],
    )
    assert report.has_errors is False


def test_validation_report_no_issues():
    report = ValidationReport(artifact_id="art-1", artifact_revision=1, issues=[])
    assert report.has_errors is False


# ── 4. EvidenceStatus enum values ─────────────────────────────────────────────


def test_evidence_status_values():
    assert EvidenceStatus.SUPPORTED == "supported"
    assert EvidenceStatus.PARTIAL == "partial"
    assert EvidenceStatus.UNSUPPORTED == "unsupported"


# ── 5. SlideElement type field ────────────────────────────────────────────────


def test_slide_element_valid_types():
    for t in ("title", "text", "image", "shape"):
        el = SlideElement(element_id=f"el-{t}", type=t, content="hello")
        assert el.type == t


# ── 6. Artifact artifact_revision >= 1 ───────────────────────────────────────


def test_artifact_revision_zero_raises():
    with pytest.raises(ValidationError):
        Artifact(
            artifact_id="art-1",
            project_id="proj-test",
            artifact_revision=0,  # invalid
            slides=[],
            outline_version="v-abcd1234",
        )


def test_artifact_revision_one_valid():
    art = Artifact(
        artifact_id="art-1",
        project_id="proj-test",
        artifact_revision=1,
        slides=[],
        outline_version="v-abcd1234",
    )
    assert art.artifact_revision == 1
