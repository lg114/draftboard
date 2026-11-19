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


class SlideLayout(str, Enum):
    COVER = "cover"
    CONTENT = "content"
    BULLETS = "bullets"
    TWO_COLUMN = "two_column"
    CLOSING = "closing"


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
    layout: Optional[SlideLayout] = Field(
        None,
        description=(
            "Requested slide layout; None lets the program apply its default "
            "rule (first item cover, last closing, others content). "
            "two_column is not derivable from an outline summary."
        ),
    )


# Layouts the program can build from a confirmed outline item.
OUTLINE_LAYOUTS = {
    SlideLayout.COVER,
    SlideLayout.CONTENT,
    SlideLayout.BULLETS,
    SlideLayout.CLOSING,
}


def validate_outline(items: list[OutlineItem], known_source_ids: set[str]) -> list[str]:
    """Program-side outline validation; returns error messages (empty = valid)."""
    errors: list[str] = []
    seen: set[str] = set()
    for item in items:
        iid = item.outline_item_id
        if iid in seen:
            errors.append(f"Duplicate outline_item_id '{iid}'.")
        seen.add(iid)
        if not item.title.strip():
            errors.append(f"Outline item '{iid}' has an empty title.")
        if not item.summary.strip():
            errors.append(f"Outline item '{iid}' has an empty summary.")
        if not item.source_ids:
            errors.append(f"Outline item '{iid}' cites no source_ids.")
        for sid in item.source_ids:
            if sid not in known_source_ids:
                errors.append(
                    f"Outline item '{iid}' cites unknown source_id '{sid}'."
                )
        if item.layout is not None and item.layout not in OUTLINE_LAYOUTS:
            errors.append(
                f"Outline item '{iid}': layout '{item.layout.value}' cannot be "
                "generated from an outline; author the IR directly instead."
            )
    return errors


class Outline(BaseModel):
    outline_version: str = Field(description="Version identifier, format v-{uuid[:8]}")
    project_id: str = Field(description="Project this outline belongs to")
    items: list[OutlineItem] = Field(description="Ordered list of outline items")
    is_confirmed: bool = Field(
        False, description="True when user has approved this outline"
    )


# Element roles allowed in the IR.  image/shape are reserved from M0 and
# not yet renderable by the exporter.
ELEMENT_TYPES = {
    "title",
    "subtitle",
    "text",
    "bullet",
    "column_left",
    "column_right",
    "conclusion",
    "image",
    "shape",
}

# Roles each layout accepts besides the mandatory title.
LAYOUT_ROLES: dict[SlideLayout, set[str]] = {
    SlideLayout.COVER: {"subtitle"},
    SlideLayout.CONTENT: {"text", "image", "shape"},
    SlideLayout.BULLETS: {"bullet"},
    SlideLayout.TWO_COLUMN: {"column_left", "column_right"},
    SlideLayout.CLOSING: {"conclusion"},
}


class SlideElement(BaseModel):
    element_id: str = Field(description="Unique element ID within the slide")
    type: str = Field(
        description=(
            "Content role: title, subtitle, text, bullet, column_left, "
            "column_right, conclusion, image, shape"
        )
    )
    content: str = Field(description="Element content (text or image reference)")
    source_id: Optional[str] = Field(
        None, description="Source fragment ID this element was drawn from"
    )


class Slide(BaseModel):
    slide_id: str = Field(description="Unique slide ID within the artifact")
    layout: SlideLayout = Field(
        SlideLayout.CONTENT, description="Fixed layout template for this slide"
    )
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


def validate_ir(artifact: Artifact) -> list[str]:
    """Check IR integrity; return a list of error messages (empty = valid).

    Rejects empty titles, duplicate slide/element IDs, unknown element
    types, and elements whose role does not belong to the slide's layout.
    """
    errors: list[str] = []
    seen_slides: set[str] = set()
    for slide in artifact.slides:
        sid = slide.slide_id
        if sid in seen_slides:
            errors.append(f"Duplicate slide_id '{sid}'.")
        seen_slides.add(sid)

        titles = [el for el in slide.elements if el.type == "title"]
        if len(titles) != 1:
            errors.append(
                f"Slide '{sid}' must have exactly one title element, "
                f"found {len(titles)}."
            )
        elif not titles[0].content.strip():
            errors.append(f"Slide '{sid}' has an empty title.")

        allowed = LAYOUT_ROLES[slide.layout] | {"title"}
        seen_elements: set[str] = set()
        for el in slide.elements:
            if el.element_id in seen_elements:
                errors.append(
                    f"Duplicate element_id '{el.element_id}' in slide '{sid}'."
                )
            seen_elements.add(el.element_id)
            if el.type not in ELEMENT_TYPES:
                errors.append(
                    f"Unknown element type '{el.type}' "
                    f"(element '{el.element_id}', slide '{sid}')."
                )
            elif el.type not in allowed:
                errors.append(
                    f"Role '{el.type}' is not allowed in layout "
                    f"'{slide.layout.value}' (element '{el.element_id}', "
                    f"slide '{sid}')."
                )

        present = {el.type for el in slide.elements}
        if slide.layout == SlideLayout.TWO_COLUMN:
            for role in ("column_left", "column_right"):
                if role not in present:
                    errors.append(f"Slide '{sid}' (two_column) is missing {role}.")
        else:
            required = {
                SlideLayout.COVER: set(),
                SlideLayout.CONTENT: {"text"},
                SlideLayout.BULLETS: {"bullet"},
                SlideLayout.CLOSING: {"conclusion"},
            }[slide.layout]
            for role in sorted(required):
                if role not in present:
                    errors.append(
                        f"Slide '{sid}' ({slide.layout.value}) is missing {role}."
                    )
    return errors


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


class ExportResult(BaseModel):
    success: bool = Field(description="True only if the file was written and checks passed")
    artifact_id: str = Field(description="Artifact that was exported")
    artifact_revision: int = Field(description="Revision that was exported")
    pptx_path: Optional[str] = Field(None, description="Written file path on success")
    slide_count: int = Field(0, description="Number of slides in the written file")
    issues: list[ValidationIssue] = Field(
        default_factory=list, description="Problems that blocked the export"
    )


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
