"""
Data models for the Draftboard workbench.
All Pydantic v2 models with field descriptions for schema clarity.
"""

from enum import Enum
from pydantic import BaseModel, Field
from typing import Literal, Optional


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
    TEXT_IMAGE = "text_image"
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


class ChartSeries(BaseModel):
    name: str = Field(description="Series display name")
    values: list[float] = Field(
        description="Numeric values aligned 1-to-1 with chart_categories"
    )
    color: Optional[str] = Field(
        None,
        description="Optional series color ('theme:accent', 'theme:title', or '#RRGGBB')",
    )


class CanvasElement(BaseModel):
    """Native editable freeform canvas primitive in 960x540 pt coordinates."""

    id: str = Field(description="Unique element ID within the slide")
    kind: Literal["text", "card", "line", "image", "table", "chart"] = Field(
        description="Primitive kind: text, card (rounded rect), line, image, table, or chart"
    )
    x: float = Field(description="Left coordinate in pt (0..960)")
    y: float = Field(description="Top coordinate in pt (0..540)")
    w: float = Field(description="Width in pt (for line: delta X)")
    h: float = Field(description="Height in pt (for line: delta Y)")

    # Text fields (kind='text')
    text: Optional[str] = Field(None, description="Text content")
    font_size: Optional[int] = Field(
        None, ge=10, le=72, description="Font size in pt (10..72)"
    )
    bold: Optional[bool] = Field(None, description="Bold weight for text")
    color: Optional[str] = Field(
        None,
        description="Text or line color: semantic 'theme:*' token or '#RRGGBB'",
    )
    align: Optional[Literal["left", "center", "right"]] = Field(
        None, description="Horizontal alignment for text"
    )
    line_height: Optional[float] = Field(
        None, description="Optional line spacing in pt"
    )

    # Card fields (kind='card')
    fill: Optional[str] = Field(
        None, description="Card fill color: 'theme:*', '#RRGGBB', or 'transparent'"
    )
    border_color: Optional[str] = Field(
        None, description="Optional card border color: 'theme:*' or '#RRGGBB'"
    )
    border_width: Optional[float] = Field(
        None, ge=0, le=8, description="Card border width in pt"
    )
    radius: Optional[float] = Field(
        None, ge=0, le=48, description="Card corner radius in pt"
    )

    # Line fields (kind='line')
    line_width: Optional[float] = Field(
        None, ge=0.5, le=12, description="Stroke width in pt for lines"
    )

    # Image fields (kind='image')
    image_asset_id: Optional[str] = Field(
        None, description="Uploaded project image asset_id"
    )
    fit: Optional[Literal["contain", "cover"]] = Field(
        None, description="Image fit mode: contain or cover (center-cropped)"
    )

    # Table fields (kind='table')
    headers: Optional[list[str]] = Field(
        None, description="Column headers for table (1..8 columns)"
    )
    rows: Optional[list[list[str]]] = Field(
        None, description="Data rows for table (1..12 rows, each matching header count)"
    )
    header_fill: Optional[str] = Field(
        None, description="Header row background ('theme:surface', 'theme:accent', or '#RRGGBB')"
    )
    header_color: Optional[str] = Field(
        None, description="Header text color ('theme:title', '#FFFFFF', etc.)"
    )
    cell_color: Optional[str] = Field(
        None, description="Body cell text color (default 'theme:body')"
    )
    stripe_fill: Optional[str] = Field(
        None, description="Alternating row subtle tint (default 'theme:surface' or 'transparent')"
    )
    table_font_size: Optional[int] = Field(
        None, ge=10, le=20, description="Table cell font size in pt (default 14)"
    )

    # Chart fields (kind='chart')
    chart_type: Optional[Literal["bar", "hbar", "line", "donut"]] = Field(
        None, description="Chart type: bar (vertical column), hbar (horizontal bar), line, or donut"
    )
    chart_title: Optional[str] = Field(
        None, description="Optional concise title inside the chart box"
    )
    chart_categories: Optional[list[str]] = Field(
        None, description="Category axis / slice labels (1..12 items)"
    )
    chart_series: Optional[list[ChartSeries]] = Field(
        None, description="1..5 numeric data series (donut uses first series)"
    )
    show_values: Optional[bool] = Field(
        None, description="Show data value labels on bars/points/slices (default True)"
    )
    value_suffix: Optional[str] = Field(
        None, description="Optional unit suffix for data labels, e.g. '%', '亿', 'ms'"
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
            "two_column requires column_right; text_image requires image_asset_id."
        ),
    )
    column_right: Optional[str] = Field(
        None,
        description="Right-column content when layout is two_column",
    )
    image_asset_id: Optional[str] = Field(
        None,
        description="Uploaded image asset ID (or filename) when layout is text_image",
    )
    speaker_notes: Optional[str] = Field(
        None,
        description="Optional presenter talking points exported to PPTX notes",
    )
    custom_bg: Optional[str] = Field(
        None,
        description="Optional freeform slide background ('theme:*' or '#RRGGBB')",
    )
    custom_elements: Optional[list[CanvasElement]] = Field(
        None,
        description="Optional freeform 960x540 native canvas elements overriding fixed template",
    )


# Layouts the program can build from a confirmed outline item.
OUTLINE_LAYOUTS = {
    SlideLayout.COVER,
    SlideLayout.CONTENT,
    SlideLayout.BULLETS,
    SlideLayout.TWO_COLUMN,
    SlideLayout.TEXT_IMAGE,
    SlideLayout.CLOSING,
}


def validate_outline(
    items: list[OutlineItem],
    known_source_ids: set[str],
    *,
    allow_empty_sources_for_unsupported: bool = False,
) -> list[str]:
    """Program-side outline validation; returns error messages (empty = valid)."""
    errors: list[str] = []
    if not items:
        return ["Outline must contain at least one item."]
    seen: set[str] = set()
    for item in items:
        iid = item.outline_item_id
        if not iid.strip():
            errors.append("Outline item has an empty outline_item_id.")
        if iid in seen:
            errors.append(f"Duplicate outline_item_id '{iid}'.")
        seen.add(iid)
        if not item.title.strip():
            errors.append(f"Outline item '{iid}' has an empty title.")
        if not item.summary.strip():
            errors.append(f"Outline item '{iid}' has an empty summary.")
        if not item.source_ids:
            if not (
                allow_empty_sources_for_unsupported
                and item.evidence_status == EvidenceStatus.UNSUPPORTED
            ):
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
        if not item.custom_elements:
            if item.layout == SlideLayout.TWO_COLUMN and not (
                item.column_right and item.column_right.strip()
            ):
                errors.append(
                    f"Outline item '{iid}': layout 'two_column' requires non-empty "
                    "column_right content."
                )
            if item.layout == SlideLayout.TEXT_IMAGE and not (
                item.image_asset_id and item.image_asset_id.strip()
            ):
                errors.append(
                    f"Outline item '{iid}': layout 'text_image' requires an "
                    "image_asset_id from uploaded project images."
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
    SlideLayout.TEXT_IMAGE: {"text", "bullet", "image"},
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
    speaker_notes: Optional[str] = Field(
        None, description="Optional presenter notes written to the PPTX notes slide"
    )
    custom_bg: Optional[str] = Field(
        None, description="Optional freeform slide background ('theme:*' or '#RRGGBB')"
    )
    custom_elements: Optional[list[CanvasElement]] = Field(
        None, description="Optional freeform 960x540 native canvas elements"
    )


class Artifact(BaseModel):
    artifact_id: str = Field(description="Unique artifact identifier")
    project_id: str = Field(description="Project this artifact belongs to")
    artifact_revision: int = Field(ge=1, description="Revision number, starts at 1")
    slides: list[Slide] = Field(description="Ordered list of slides")
    outline_version: str = Field(
        description="Outline version this artifact was generated from"
    )
    template_id: str = Field("default", description="Slide template/theme identifier")
    auto_fit: bool = Field(
        False,
        description="When True, step font size down to floor before failing on overflow",
    )
    input_fingerprint: Optional[str] = Field(
        None,
        description="SHA-256 of the frozen generation inputs. Absent on legacy artifacts.",
    )
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
        elif slide.layout == SlideLayout.TEXT_IMAGE:
            if "image" not in present:
                errors.append(f"Slide '{sid}' (text_image) is missing image.")
            if not (present & {"text", "bullet"}):
                errors.append(
                    f"Slide '{sid}' (text_image) is missing text or bullet content."
                )
            for el in slide.elements:
                if el.type == "image" and not el.content.strip():
                    errors.append(
                        f"Slide '{sid}' image element '{el.element_id}' has empty content."
                    )
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
    input_fingerprint: Optional[str] = Field(
        None,
        description="Fingerprint of the frozen inputs this file was built from.",
    )


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class TaskRecord(BaseModel):
    task_id: str = Field(description="Unique task identifier")
    project_id: str = Field(description="Project the task belongs to")
    kind: str = Field(description="Task kind: 'outline' or 'generate'")
    status: TaskStatus = Field(TaskStatus.QUEUED, description="Current task status")
    step: str = Field("", description="Human-readable label of the current real step")
    error: Optional[str] = Field(None, description="Failure reason, if failed")
    result: dict = Field(
        default_factory=dict,
        description="References to saved intermediate/final products",
    )
    created_at: str = Field(description="ISO timestamp of submission")
    updated_at: str = Field(description="ISO timestamp of last status change")


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
