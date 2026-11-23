"""
Agent tools for the Draftboard workbench.
Each function is decorated with @function_tool so the OpenAI Agents SDK
can expose it to the model as a callable tool.

Dependency injection for storage root is provided via _storage_root module
variable (set in tests to redirect writes to a tmp directory).
"""

import pathlib
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from typing import Optional

import pypdfium2 as pdfium
from agents import function_tool

from draftboard.models import (
    Artifact,
    AssetType,
    EvidenceStatus,
    ExportResult,
    MaterialContent,
    OutlineItem,
    Outline,
    ReadMaterialsOutput,
    Slide,
    SlideElement,
    SlideLayout,
    SourceFragment,
    ValidationIssue,
    ValidationLevel,
    ValidationReport,
    validate_ir,
    validate_outline,
)
from draftboard.pptx_export import export_pptx
from draftboard.storage import STORAGE_ROOT, ProjectStorage

# Set to a pathlib.Path in tests to redirect storage to a temporary directory.
_storage_root: Optional[pathlib.Path] = None


def _get_storage(project_id: str) -> ProjectStorage:
    return ProjectStorage(project_id, storage_root=_storage_root)


_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _extract_docx_text(filepath: pathlib.Path) -> str:
    """Extract plain text from a .docx file using stdlib zipfile + ElementTree."""
    try:
        with zipfile.ZipFile(filepath) as zf:
            if "word/document.xml" not in zf.namelist():
                raise ValueError(f"DOCX 文件缺少 word/document.xml: {filepath.name}")
            xml_bytes = zf.read("word/document.xml")
    except zipfile.BadZipFile as exc:
        raise ValueError(f"无法解析损坏的 DOCX 文件 '{filepath.name}'") from exc

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError(f"DOCX 文档 XML 结构损坏 '{filepath.name}'") from exc

    lines: list[str] = []
    body = root.find(f"{_W_NS}body")
    container = body if body is not None else root
    for elem in container:
        if elem.tag == f"{_W_NS}p":
            para = "".join(t.text or "" for t in elem.findall(f".//{_W_NS}t")).strip()
            if para:
                lines.append(para)
        elif elem.tag == f"{_W_NS}tbl":
            for row in elem.findall(f".//{_W_NS}tr"):
                cells = []
                for cell in row.findall(f"./{_W_NS}tc"):
                    cell_text = " ".join(
                        "".join(t.text or "" for t in p.findall(f".//{_W_NS}t")).strip()
                        for p in cell.findall(f".//{_W_NS}p")
                    ).strip()
                    if cell_text:
                        cells.append(cell_text)
                if cells:
                    lines.append(" | ".join(cells))
    return "\n".join(lines)


def _extract_pdf_pages(filepath: pathlib.Path) -> list[tuple[int, str]]:
    """Extract per-page plain text from a PDF file using pypdfium2."""
    try:
        doc = pdfium.PdfDocument(str(filepath))
    except Exception as exc:
        raise ValueError(f"无法解析 PDF 文件 '{filepath.name}'（可能已损坏或受密码保护）") from exc

    pages: list[tuple[int, str]] = []
    try:
        page_count = len(doc)
        for idx in range(page_count):
            page = doc[idx]
            textpage = page.get_textpage()
            raw = textpage.get_text_range() or ""
            cleaned = "\n".join(
                line.strip() for line in raw.splitlines() if line.strip()
            )
            pages.append((idx + 1, cleaned))
    finally:
        doc.close()
    return pages


# ── Tool 1: read_materials ────────────────────────────────────────────────────


@function_tool
def read_materials(
    project_id: str,
    asset_ids: Optional[list[str]] = None,
) -> ReadMaterialsOutput:
    """Read project materials (Markdown/TXT/DOCX/PDF files and images) from disk.

    Scans ~/.draftboard/projects/{project_id}/assets/ for .md, .txt, .docx,
    .pdf, .png, and .jpg files.  Text content is returned verbatim and split
    into 50-line (or per-page) source fragments.  Images are represented as a
    stub string of the form '[image: {filename}]' – the agent must NOT
    fabricate any image analysis.

    Args:
        project_id: Identifier of the project whose assets to read.
        asset_ids: Optional list of asset filenames (without extension) to
            restrict which assets are loaded.  None means load all assets.

    Returns:
        ReadMaterialsOutput containing materials and source fragments.
    """
    storage = _get_storage(project_id)
    assets_dir = storage.root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    materials: list[MaterialContent] = []
    fragments: list[SourceFragment] = []

    # Collect candidate files
    candidate_files: list[pathlib.Path] = []
    for ext in ("*.md", "*.txt", "*.docx", "*.pdf", "*.png", "*.jpg", "*.jpeg"):
        candidate_files.extend(assets_dir.glob(ext))

    for filepath in sorted(candidate_files):
        stem = filepath.stem
        if asset_ids is not None and stem not in asset_ids:
            continue

        suffix = filepath.suffix.lower()
        if suffix in (".md", ".txt", ".docx"):
            if suffix == ".docx":
                text = _extract_docx_text(filepath)
            else:
                text = filepath.read_text(encoding="utf-8", errors="replace")
            materials.append(
                MaterialContent(
                    asset_id=stem,
                    asset_type=AssetType.MARKDOWN,
                    content=text,
                )
            )
            # Split into 50-line fragments
            lines = text.splitlines()
            chunk_size = 50
            for chunk_start in range(0, max(len(lines), 1), chunk_size):
                chunk_end = min(chunk_start + chunk_size, len(lines))
                chunk_lines = lines[chunk_start:chunk_end]
                frag_id = f"{stem}-L{chunk_start + 1}"
                fragments.append(
                    SourceFragment(
                        source_id=frag_id,
                        asset_id=stem,
                        location=f"L{chunk_start + 1}-L{chunk_end}",
                        content_preview=" ".join(chunk_lines[:3])[:200] or None,
                    )
                )
        elif suffix == ".pdf":
            pdf_pages = _extract_pdf_pages(filepath)
            combined_parts: list[str] = []
            if not pdf_pages:
                fragments.append(
                    SourceFragment(
                        source_id=f"{stem}-P1",
                        asset_id=stem,
                        location="P1",
                        content_preview="[空 PDF 文档]",
                    )
                )
            for page_num, page_text in pdf_pages:
                if page_text:
                    combined_parts.append(page_text)
                lines = page_text.splitlines()
                if len(lines) <= 50:
                    preview = (
                        " ".join(lines[:3])[:200]
                        if lines
                        else "[该页无可提取文本（可能为纯图片/扫描页）]"
                    )
                    fragments.append(
                        SourceFragment(
                            source_id=f"{stem}-P{page_num}",
                            asset_id=stem,
                            location=f"P{page_num}",
                            content_preview=preview,
                        )
                    )
                else:
                    chunk_size = 50
                    for chunk_start in range(0, len(lines), chunk_size):
                        chunk_end = min(chunk_start + chunk_size, len(lines))
                        chunk_lines = lines[chunk_start:chunk_end]
                        fragments.append(
                            SourceFragment(
                                source_id=f"{stem}-P{page_num}-L{chunk_start + 1}",
                                asset_id=stem,
                                location=f"P{page_num} L{chunk_start + 1}-L{chunk_end}",
                                content_preview=" ".join(chunk_lines[:3])[:200] or None,
                            )
                        )
            materials.append(
                MaterialContent(
                    asset_id=stem,
                    asset_type=AssetType.MARKDOWN,
                    content="\n\n".join(combined_parts),
                )
            )
        else:
            # Image file
            stub = f"[image: {filepath.name}]"
            materials.append(
                MaterialContent(
                    asset_id=stem,
                    asset_type=AssetType.IMAGE,
                    content=stub,
                )
            )
            fragments.append(
                SourceFragment(
                    source_id=f"{stem}-img",
                    asset_id=stem,
                    location=stem,
                    content_preview=None,
                )
            )

    storage.save_sources(fragments)
    return ReadMaterialsOutput(
        project_id=project_id,
        materials=materials,
        source_fragments=fragments,
    )


# ── Tool 2: propose_outline ───────────────────────────────────────────────────


def normalize_outline_item_text(item: OutlineItem) -> OutlineItem:
    """Unescape literal \\n sequences emitted by LLMs and strip duplicate bullet dashes."""
    def _unescape(text: str) -> str:
        return text.replace("\\r\\n", "\n").replace("\\n", "\n")

    def _clean_bullets(text: str) -> str:
        lines = [
            re.sub(r"^(?:[-*•·]\s+)", "", ln.strip())
            for ln in text.splitlines()
            if ln.strip()
        ]
        return "\n".join(lines)

    title = _unescape(item.title).replace("\n", " ").strip()
    summary = _unescape(item.summary).strip()
    if item.layout == SlideLayout.BULLETS:
        summary = _clean_bullets(summary)
    col_right = (
        _unescape(item.column_right).strip()
        if item.column_right is not None
        else None
    )
    notes = (
        _unescape(item.speaker_notes).strip()
        if item.speaker_notes is not None
        else None
    )
    custom_els = None
    if item.custom_elements is not None:
        custom_els = [
            el.model_copy(update={"text": _unescape(el.text)})
            if el.kind == "text" and el.text is not None
            else el
            for el in item.custom_elements
        ]
    return item.model_copy(
        update={
            "title": title or item.title,
            "summary": summary or item.summary,
            "column_right": col_right,
            "speaker_notes": notes,
            "custom_elements": custom_els,
        }
    )


@function_tool
def propose_outline(
    project_id: str,
    material_snapshot_id: str,
    items: list[OutlineItem],
) -> Outline:
    """Persist a draft outline proposed by the agent.

    The agent should populate *items* based on its analysis of the materials.
    This tool saves the outline with is_confirmed=False and returns it so the
    user can review and approve.

    Args:
        project_id: Target project identifier.
        material_snapshot_id: Identifier of the material snapshot used to
            build this outline (for traceability).
        items: List of OutlineItem objects the agent has prepared.

    Returns:
        The saved Outline with a generated outline_version.

    Raises:
        ValueError: If titles/summaries are empty, item IDs repeat, citations
            reference unknown source fragments, or a layout cannot be built
            from an outline.  Nothing is saved on failure.
    """
    storage = _get_storage(project_id)
    cleaned_items = [normalize_outline_item_text(it) for it in items]
    errors = validate_outline(cleaned_items, storage.load_source_ids())
    if errors:
        raise ValueError("Invalid outline:\n" + "\n".join(errors))
    outline_version = f"v-{uuid.uuid4().hex[:8]}"
    outline = Outline(
        outline_version=outline_version,
        project_id=project_id,
        items=cleaned_items,
        is_confirmed=False,
    )
    storage.save_outline(outline)
    return outline


# ── Tool 3: generate_slides ───────────────────────────────────────────────────


@function_tool
def generate_slides(
    project_id: str,
    approved_outline_version: str,
    template_id: str = "default",
    idempotency_key: str = "",
    auto_fit: bool = False,
) -> Artifact:
    """Generate a slide artifact from an approved outline.

    Requires the outline to be confirmed (is_confirmed=True). Checks the
    idempotency cache first; if a previous call with the same key exists its
    result is returned unchanged.

    Args:
        project_id: Target project identifier.
        approved_outline_version: Outline version that has been confirmed by
            the user.
        template_id: Slide template/theme to apply (default: "default").
        idempotency_key: Unique string; identical keys return the cached
            artifact without re-generating slides.
        auto_fit: When True, allow exporter to step font size down to floor
            (body >= 14pt, cover title >= 28pt) before blocking on overflow.

    Returns:
        The generated (or cached) Artifact.

    Raises:
        ValueError: If the outline has not been confirmed.
    """
    storage = _get_storage(project_id)

    # Idempotency check
    if idempotency_key:
        cached = storage.load_idempotent_result(idempotency_key)
        if cached is not None:
            return Artifact.model_validate(cached)

    # Load and validate outline
    outline = storage.load_outline(approved_outline_version)
    if not outline.is_confirmed:
        raise ValueError(
            f"Outline '{approved_outline_version}' has not been confirmed. "
            "Ask the user to confirm the outline before generating slides."
        )

    # Build slides verbatim from the confirmed outline.  Layout comes from
    # the confirmed item, or the program default: first cover, last closing,
    # others content.  No model rewriting happens here.
    n = len(outline.items)
    slides: list[Slide] = []
    for idx, raw_item in enumerate(outline.items):
        item = normalize_outline_item_text(raw_item)
        slide_id = f"slide-{idx + 1:03d}"
        source_id = item.source_ids[0] if item.source_ids else None
        layout = item.layout
        if layout is None:
            if idx == 0:
                layout = SlideLayout.COVER
            elif idx == n - 1:
                layout = SlideLayout.CLOSING
            else:
                layout = SlideLayout.CONTENT

        elements = [
            SlideElement(
                element_id=f"{slide_id}-title",
                type="title",
                content=item.title,
                source_id=source_id,
            )
        ]
        if layout == SlideLayout.BULLETS:
            lines = [ln for ln in item.summary.split("\n") if ln.strip()]
            for bi, line in enumerate(lines, start=1):
                elements.append(
                    SlideElement(
                        element_id=f"{slide_id}-bullet-{bi}",
                        type="bullet",
                        content=line,
                        source_id=source_id,
                    )
                )
        elif layout == SlideLayout.TWO_COLUMN:
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-column-left",
                    type="column_left",
                    content=item.summary,
                    source_id=source_id,
                )
            )
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-column-right",
                    type="column_right",
                    content=item.column_right or "",
                    source_id=source_id,
                )
            )
        elif layout == SlideLayout.TEXT_IMAGE:
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-text",
                    type="text",
                    content=item.summary,
                    source_id=source_id,
                )
            )
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-image",
                    type="image",
                    content=item.image_asset_id or "",
                    source_id=source_id,
                )
            )
        else:
            role = {
                SlideLayout.COVER: "subtitle",
                SlideLayout.CONTENT: "text",
                SlideLayout.CLOSING: "conclusion",
            }[layout]
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-{role}",
                    type=role,
                    content=item.summary,
                    source_id=source_id,
                )
            )
        slides.append(
            Slide(
                slide_id=slide_id,
                layout=layout,
                elements=elements,
                speaker_notes=item.speaker_notes,
                custom_bg=item.custom_bg,
                custom_elements=item.custom_elements,
            )
        )

    artifact_id = f"art-{uuid.uuid4().hex[:8]}"
    artifact = Artifact(
        artifact_id=artifact_id,
        project_id=project_id,
        artifact_revision=1,
        slides=slides,
        outline_version=approved_outline_version,
        template_id=template_id,
        auto_fit=auto_fit,
    )
    ir_errors = validate_ir(artifact)
    if ir_errors:
        raise ValueError("Generated IR is invalid:\n" + "\n".join(ir_errors))
    storage.save_artifact(artifact)

    if idempotency_key:
        storage.save_idempotent_result(idempotency_key, artifact.model_dump())

    return artifact


# ── Tool 4: patch_slide ───────────────────────────────────────────────────────


@function_tool
def patch_slide(
    artifact_id: str,
    slide_id: str,
    expected_revision: int,
    operation_type: str,
    element_id: str,
    new_content: str,
    idempotency_key: str = "",
) -> Artifact:
    """Apply a targeted edit to a single slide element.

    Checks the idempotency cache; if a matching cached result exists it is
    returned unchanged.  Otherwise, the artifact is loaded at
    *expected_revision*, the element is patched, and the new revision is saved.

    Supported operation_type values:
      - replace_text           – replace the text content of a text or title element
      - replace_existing_image – replace the reference of an existing image element

    Args:
        artifact_id: Artifact to patch.
        slide_id: ID of the slide containing the element.
        expected_revision: Revision the caller believes is current; rejected
            if it does not match the latest revision on disk.
        operation_type: One of replace_text or replace_existing_image.
        element_id: ID of the element to modify.
        new_content: Replacement content string.
        idempotency_key: Unique string; identical keys return the cached result.

    Returns:
        The new Artifact at the incremented revision.

    Raises:
        ValueError: On invalid operation_type or revision mismatch.
    """
    # Determine project_id from artifact storage by locating the artifact directory.
    # We need to search across all projects – but patch_slide requires knowing the
    # project_id.  To keep the tool simple, we embed project lookup via storage root.
    # In practice the agent should track project_id; we derive it here by scanning.
    storage_root = _storage_root or STORAGE_ROOT

    # Find project that owns this artifact
    project_id: Optional[str] = None
    if storage_root.exists():
        for proj_dir in storage_root.iterdir():
            art_dir = proj_dir / "artifacts" / artifact_id
            if art_dir.exists():
                project_id = proj_dir.name
                break

    if project_id is None:
        raise KeyError(f"Artifact '{artifact_id}' not found in any project.")

    storage = _get_storage(project_id)

    # Idempotency check
    if idempotency_key:
        cached = storage.load_idempotent_result(idempotency_key)
        if cached is not None:
            return Artifact.model_validate(cached)

    # Validate operation type
    allowed_ops = {"replace_text", "replace_existing_image"}
    if operation_type not in allowed_ops:
        raise ValueError(
            f"Invalid operation_type '{operation_type}'. "
            f"Must be one of: {', '.join(sorted(allowed_ops))}"
        )

    # Load artifact at expected revision
    artifact = storage.load_artifact(artifact_id, expected_revision)
    if artifact.artifact_revision != expected_revision:
        raise ValueError(
            f"Revision mismatch: expected {expected_revision}, "
            f"found {artifact.artifact_revision}."
        )

    # Locate and patch element
    patched = False
    for slide in artifact.slides:
        if slide.slide_id == slide_id:
            for element in slide.elements:
                if element.element_id == element_id:
                    element.content = new_content
                    patched = True
                    break
            break

    if not patched:
        raise KeyError(
            f"Element '{element_id}' not found in slide '{slide_id}' "
            f"of artifact '{artifact_id}'."
        )

    # Increment revision and persist
    new_revision = storage.next_revision(artifact_id)
    artifact.artifact_revision = new_revision
    storage.save_artifact(artifact)

    if idempotency_key:
        storage.save_idempotent_result(idempotency_key, artifact.model_dump())

    return artifact


# ── Tool 5: validate_artifact ─────────────────────────────────────────────────


@function_tool
def validate_artifact(artifact_id: str, revision: int) -> ValidationReport:
    """Validate a slide artifact and return a structured report.

    Checks applied:
      - Each slide must contain at least one element with type 'title' (ERROR
        if missing).
      - Any element whose content is an empty string is flagged as WARNING.

    Args:
        artifact_id: Artifact to validate.
        revision: Specific revision to validate.

    Returns:
        ValidationReport listing all issues found.
    """
    storage_root = _storage_root or STORAGE_ROOT

    project_id: Optional[str] = None
    if storage_root.exists():
        for proj_dir in storage_root.iterdir():
            art_dir = proj_dir / "artifacts" / artifact_id
            if art_dir.exists():
                project_id = proj_dir.name
                break

    if project_id is None:
        raise KeyError(f"Artifact '{artifact_id}' not found.")

    storage = _get_storage(project_id)
    artifact = storage.load_artifact(artifact_id, revision)

    issues: list[ValidationIssue] = []

    for msg in validate_ir(artifact):
        issues.append(
            ValidationIssue(
                level=ValidationLevel.ERROR,
                code="IR_INVALID",
                message=msg,
            )
        )

    for slide in artifact.slides:
        has_title = any(el.type == "title" for el in slide.elements)
        if not has_title:
            issues.append(
                ValidationIssue(
                    level=ValidationLevel.ERROR,
                    code="MISSING_TITLE",
                    message=f"Slide '{slide.slide_id}' has no title element.",
                    slide_id=slide.slide_id,
                )
            )
        for element in slide.elements:
            if element.content == "":
                issues.append(
                    ValidationIssue(
                        level=ValidationLevel.WARNING,
                        code="EMPTY_CONTENT",
                        message=(
                            f"Element '{element.element_id}' in slide "
                            f"'{slide.slide_id}' has empty content."
                        ),
                        slide_id=slide.slide_id,
                    )
                )

    return ValidationReport(
        artifact_id=artifact_id,
        artifact_revision=revision,
        issues=issues,
    )


# ── Tool 6: export_deck ───────────────────────────────────────────────────────


def export_deck_impl(
    project_id: str,
    artifact_id: str,
    revision: int,
    idempotency_key: str = "",
) -> ExportResult:
    """Export a validated artifact revision to an editable PPTX file.

    The program performs layout measurement, validation, and file writing;
    success means the file exists on disk and all checks passed — never
    trust a verbal claim of completion.  The result and any blocking issues
    are saved as a JSON report next to the file.  On failure no PPTX is
    written and the issues identify the affected slides and elements.

    Args:
        project_id: Project that owns the artifact.
        artifact_id: Artifact to export.
        revision: Revision to export.
        idempotency_key: Unique key; identical keys return the cached
            successful result without re-exporting.

    Returns:
        ExportResult with success flag, file path, and issue list.
    """
    storage = _get_storage(project_id)

    if idempotency_key:
        cached = storage.load_idempotent_result(idempotency_key)
        if cached is not None:
            return ExportResult.model_validate(cached)

    artifact = storage.load_artifact(artifact_id, revision)
    exports_dir = storage.root / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    pptx_path = exports_dir / f"{artifact_id}-r{revision}.pptx"

    try:
        export_pptx(artifact, pptx_path, assets_dir=storage.root / "assets")
    except (ValueError, FileNotFoundError) as e:
        result = ExportResult(
            success=False,
            artifact_id=artifact_id,
            artifact_revision=revision,
            issues=[
                ValidationIssue(
                    level=ValidationLevel.ERROR,
                    code="EXPORT_FAILED",
                    message=str(e),
                )
            ],
        )
        storage.save_export_report(artifact_id, revision, result.model_dump())
        return result

    result = ExportResult(
        success=True,
        artifact_id=artifact_id,
        artifact_revision=revision,
        pptx_path=str(pptx_path),
        slide_count=len(artifact.slides),
    )
    storage.save_export_report(artifact_id, revision, result.model_dump())
    if idempotency_key:
        storage.save_idempotent_result(idempotency_key, result.model_dump())
    return result


export_deck = function_tool(export_deck_impl)
