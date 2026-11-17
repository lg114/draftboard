"""
Data models for the Draftboard workbench.
All Pydantic v2 models with field descriptions for schema clarity.
"""

from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional


class EvidenceStatus(str, Enum):
    SUPPORTED = "supported"
    PARTIAL = "partial"
    UNSUPPORTED = "unsupported"


class AssetType(str, Enum):
    MARKDOWN = "markdown"
    IMAGE = "image"


class SourceFragment(BaseModel):
    source_id: str = Field(description="Unique source fragment ID")
    asset_id: str = Field(description="Asset this fragment comes from")
    location: str = Field(
        description="Line range (Markdown) or asset ID (image), never fabricated"
    )
    content_preview: Optional[str] = Field(
        None, description="Short preview text, None for images"
    )


class OutlineItem(BaseModel):
    outline_item_id: str = Field(description="Unique ID for this outline item")
    title: str = Field(description="Title of the slide/section")
    summary: str = Field(
        description="Summary must NOT upgrade unsupported evidence to fact"
    )
    source_ids: list[str] = Field(description="List of source fragment IDs cited")
    evidence_status: EvidenceStatus = Field(
        description="Evidence quality: supported, partial, or unsupported"
    )


class Outline(BaseModel):
    outline_version: str = Field(description="Version identifier, format v-{uuid[:8]}")
    project_id: str = Field(description="Project this outline belongs to")
    items: list[OutlineItem] = Field(description="Ordered list of outline items")
    is_confirmed: bool = Field(
        False, description="True when user has approved this outline"
    )


class SlideElement(BaseModel):
    element_id: str = Field(description="Unique element ID within the slide")
    type: str = Field(description="One of: title, text, image, shape")
    content: str = Field(description="Element content (text or image reference)")
    source_id: Optional[str] = Field(
        None, description="Source fragment ID this element was drawn from"
    )


class Slide(BaseModel):
    slide_id: str = Field(description="Unique slide ID within the artifact")
    elements: list[SlideElement] = Field(description="Elements composing this slide")


class Artifact(BaseModel):
    artifact_id: str = Field(description="Unique artifact identifier")
    project_id: str = Field(description="Project this artifact belongs to")
    artifact_revision: int = Field(ge=1, description="Revision number, starts at 1")
    slides: list[Slide] = Field(description="Ordered list of slides")
    outline_version: str = Field(
        description="Outline version this artifact was generated from"
    )
    template_id: str = Field("default", description="Slide template identifier")
    schema_version: str = Field("1.0", description="Artifact schema version")


class ValidationLevel(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class ValidationIssue(BaseModel):
    level: ValidationLevel = Field(description="Severity of the issue")
    code: str = Field(description="Machine-readable issue code")
    message: str = Field(description="Human-readable description")
    slide_id: Optional[str] = Field(None, description="Affected slide ID, if any")


class ValidationReport(BaseModel):
    artifact_id: str = Field(description="Artifact that was validated")
    artifact_revision: int = Field(description="Revision that was validated")
    issues: list[ValidationIssue] = Field(description="All validation issues found")

    @property
    def has_errors(self) -> bool:
        """Return True if any issue has ERROR level."""
        return any(i.level == ValidationLevel.ERROR for i in self.issues)


# ── Tool input / output schemas ──────────────────────────────────────────────


class ReadMaterialsInput(BaseModel):
    project_id: str = Field(description="Project to read assets from")
    asset_ids: Optional[list[str]] = Field(
        None, description="Specific asset IDs to read; None means read all"
    )


class MaterialContent(BaseModel):
    asset_id: str = Field(description="Asset identifier (filename without extension)")
    asset_type: AssetType = Field(description="Type of asset")
    content: str = Field(
        description=(
            "Text content for markdown; "
            "description stub for images (not fabricated analysis)"
        )
    )


class ReadMaterialsOutput(BaseModel):
    project_id: str = Field(description="Project ID")
    materials: list[MaterialContent] = Field(description="All loaded material contents")
    source_fragments: list[SourceFragment] = Field(
        description="All derived source fragments"
    )


class ProposeOutlineInput(BaseModel):
    project_id: str = Field(description="Target project")
    material_snapshot_id: str = Field(
        description="Identifier for the material snapshot used"
    )


class GenerateSlidesInput(BaseModel):
    project_id: str = Field(description="Target project")
    approved_outline_version: str = Field(
        description="Version of the confirmed outline"
    )
    template_id: str = Field("default", description="Slide template to apply")
    idempotency_key: str = Field(
        description="Unique key; identical keys return the cached result"
    )


class PatchSlideInput(BaseModel):
    artifact_id: str = Field(description="Artifact to patch")
    slide_id: str = Field(description="Slide to patch")
    expected_revision: int = Field(
        description="Current revision; must match or the patch is rejected"
    )
    operation_type: str = Field(
        description="One of: replace_text, replace_existing_image"
    )
    element_id: str = Field(description="Element to modify")
    new_content: str = Field(description="Replacement content")
    idempotency_key: str = Field(
        description="Unique key; identical keys return the cached result"
    )
