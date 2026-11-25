"""Outline generation, review, confirmation, slide refine, and sync fingerprint routes."""

from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

import draftboard.llm_config as llm_config
import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.generation_snapshot import freeze_generation_inputs, read_project_brand
from draftboard.models import (
    CanvasElement,
    EvidenceStatus,
    Outline,
    OutlineItem,
    SlideLayout,
    validate_outline,
)
from draftboard.routes.common import (
    export_identity,
    get_root,
    get_storage,
    outline_summaries,
    require_project,
    unwrap_tool,
)
from draftboard.storage import load_json

router = APIRouter()


class OutlineGenerateRequest(BaseModel):
    prompt: Optional[str] = None


class OutlineItemEdit(BaseModel):
    outline_item_id: str
    title: str
    summary: str
    layout: Optional[SlideLayout] = None
    source_ids: Optional[list[str]] = None
    column_right: Optional[str] = None
    image_asset_id: Optional[str] = None
    speaker_notes: Optional[str] = None
    custom_bg: Optional[str] = None
    custom_elements: Optional[list[CanvasElement]] = None


class OutlineEditRequest(BaseModel):
    items: list[OutlineItemEdit]


class SlideRefineRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    column_right: Optional[str] = None
    layout: Optional[str] = None
    source_ids: Optional[list[str]] = None
    mode: str = "concise"
    instruction: Optional[str] = None


@router.post("/api/projects/{project_id}/outline/generate", status_code=202)
def generate_outline(
    project_id: str,
    req: Optional[OutlineGenerateRequest] = Body(default=None),
):
    require_project(project_id)
    user_prompt = req.prompt.strip() if (req and req.prompt) else None
    assets_dir = get_root() / project_id / "assets"
    materials = (
        [f for f in assets_dir.glob("*") if f.is_file()] if assets_dir.exists() else []
    )
    if not materials and user_prompt:
        assets_dir.mkdir(parents=True, exist_ok=True)
        (assets_dir / "项目简报.md").write_text(
            f"# 项目创作简报\n\n{user_prompt}\n", encoding="utf-8"
        )
        unwrap_tool(tools_module.read_materials)(project_id=project_id)
        materials = [f for f in assets_dir.glob("*") if f.is_file()]
    if not materials:
        raise HTTPException(
            400, "项目中暂无可用素材，请先上传文件或输入主题笔记后再生成大纲"
        )
    is_default_outline_runner = (
        getattr(tasks.outline_via_agent, "__module__", "") == "draftboard.tasks"
    )
    if is_default_outline_runner and not llm_config.is_llm_configured():
        raise HTTPException(
            400,
            "LLM_NOT_CONFIGURED: 尚未配置大模型，请先点击右上角「模型设置」配置 API Key 或本地 Ollama。",
        )
    record = tasks.submit(
        get_root(),
        project_id,
        "outline",
        tasks.outline_work(get_root(), project_id, user_prompt=user_prompt),
    )
    return record.model_dump()


@router.get("/api/projects/{project_id}/outlines")
def list_outlines(project_id: str):
    require_project(project_id)
    return {"outlines": outline_summaries(project_id)}


@router.get("/api/projects/{project_id}/outlines/{version}")
def get_outline(project_id: str, version: str):
    require_project(project_id)
    outline = get_storage(project_id).load_outline(version)
    cleaned = outline.model_copy(
        update={
            "items": [
                tools_module.normalize_outline_item_text(it) for it in outline.items
            ]
        }
    )
    return cleaned.model_dump()


@router.post("/api/projects/{project_id}/outlines/{version}/confirm")
def confirm_outline(project_id: str, version: str):
    require_project(project_id)
    return get_storage(project_id).confirm_outline(version).model_dump()


@router.put("/api/projects/{project_id}/outlines/{version}")
def edit_outline(project_id: str, version: str, req: OutlineEditRequest):
    """Edit titles, summaries, layouts, notes, and page structure (add/delete/reorder).

    Editing a confirmed outline never mutates it: a new draft version is
    derived instead, so what was confirmed stays exactly what entered the
    pipeline, and the old PPTX remains valid for that version.
    """
    require_project(project_id)
    storage = get_storage(project_id)
    outline = storage.load_outline(version)
    if not req.items:
        raise HTTPException(400, "大纲至少保留一页")

    existing = {item.outline_item_id: item for item in outline.items}
    ids = [e.outline_item_id.strip() for e in req.items]
    if any(not iid for iid in ids):
        raise HTTPException(400, "大纲条目 ID 不能为空")
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "大纲条目 ID 不能重复")

    new_items: list[OutlineItem] = []
    for edit in req.items:
        iid = edit.outline_item_id.strip()
        if iid in existing:
            item = existing[iid].model_copy(deep=True)
            item.title = edit.title
            item.summary = edit.summary
            if "layout" in edit.model_fields_set:
                item.layout = edit.layout
            if "column_right" in edit.model_fields_set:
                item.column_right = edit.column_right
            if "image_asset_id" in edit.model_fields_set:
                item.image_asset_id = edit.image_asset_id
            if "speaker_notes" in edit.model_fields_set:
                item.speaker_notes = edit.speaker_notes
            if "custom_bg" in edit.model_fields_set:
                item.custom_bg = edit.custom_bg
            if "custom_elements" in edit.model_fields_set:
                item.custom_elements = edit.custom_elements
            if "source_ids" in edit.model_fields_set and edit.source_ids is not None:
                item.source_ids = edit.source_ids
                if not item.source_ids:
                    item.evidence_status = EvidenceStatus.UNSUPPORTED
                elif item.evidence_status == EvidenceStatus.UNSUPPORTED:
                    item.evidence_status = EvidenceStatus.SUPPORTED
            new_items.append(item)
        else:
            source_ids = edit.source_ids or []
            new_items.append(
                OutlineItem(
                    outline_item_id=iid,
                    title=edit.title,
                    summary=edit.summary,
                    source_ids=source_ids,
                    evidence_status=(
                        EvidenceStatus.SUPPORTED
                        if source_ids
                        else EvidenceStatus.UNSUPPORTED
                    ),
                    layout=edit.layout,
                    column_right=edit.column_right,
                    image_asset_id=edit.image_asset_id,
                    speaker_notes=edit.speaker_notes,
                    custom_bg=edit.custom_bg,
                    custom_elements=edit.custom_elements,
                )
            )

    errors = validate_outline(
        new_items,
        storage.load_source_ids(),
        allow_empty_sources_for_unsupported=True,
    )
    if errors:
        raise ValueError("Invalid outline:\n" + "\n".join(errors))

    if outline.is_confirmed:
        edited = Outline(
            outline_version=f"v-{uuid.uuid4().hex[:8]}",
            project_id=project_id,
            items=new_items,
            is_confirmed=False,
        )
    else:
        edited = outline.model_copy(deep=True)
        edited.items = new_items
    storage.save_outline(edited)
    return edited.model_dump()


@router.post("/api/projects/{project_id}/outlines/{version}/items/{item_id}/refine")
def refine_outline_item(
    project_id: str,
    version: str,
    item_id: str,
    req: SlideRefineRequest,
):
    """Generate a non-destructive AI refinement candidate (Diff preview) for one slide."""
    require_project(project_id)
    storage = get_storage(project_id)
    outline = storage.load_outline(version)
    target = next(
        (it for it in outline.items if it.outline_item_id == item_id), None
    )

    title = req.title if req.title is not None else (target.title if target else "")
    summary = (
        req.summary
        if req.summary is not None
        else (target.summary if target else "")
    )
    column_right = (
        req.column_right
        if req.column_right is not None
        else (target.column_right if target else None)
    )
    layout = (
        req.layout
        if req.layout is not None
        else (target.layout.value if (target and target.layout) else "content")
    )
    sids = (
        req.source_ids
        if req.source_ids is not None
        else (target.source_ids if target else [])
    )

    mat_out = unwrap_tool(tools_module.read_materials)(project_id=project_id)
    frag_map = {f.source_id: f for f in mat_out.source_fragments}
    mat_map = {
        m.asset_id: m.content
        for m in mat_out.materials
        if m.asset_type != "image" and m.content
    }
    excerpts: list[str] = []
    for sid in sids:
        frag = frag_map.get(sid)
        if not frag or frag.source_id.endswith("-img"):
            continue
        text = ""
        raw_mat = mat_map.get(frag.asset_id, "")
        if raw_mat:
            m_loc = re.search(r"L(\d+)-L(\d+)$", frag.location or "")
            if m_loc:
                start_ln = max(0, int(m_loc.group(1)) - 1)
                end_ln = int(m_loc.group(2))
                text = "\n".join(raw_mat.splitlines()[start_ln:end_ln]).strip()
            if not text:
                text = raw_mat[:600].strip()
        if not text and frag.content_preview:
            text = frag.content_preview.strip()
        if text and "图片素材占位" not in text:
            excerpts.append(text[:600])

    display_name = ""
    meta_path = get_root() / project_id / "meta.json"
    if meta_path.exists():
        try:
            loaded_meta = load_json(meta_path)
            if isinstance(loaded_meta, dict):
                display_name = str(loaded_meta.get("name") or "").strip()
        except Exception:
            pass

    candidate = tasks.refine_slide_item(
        project_id=project_id,
        title=title,
        summary=summary,
        column_right=column_right,
        layout=layout,
        source_excerpts=excerpts,
        mode=req.mode,
        instruction=req.instruction,
        project_name=display_name,
    )
    return {
        "outline_item_id": item_id,
        **candidate,
    }


@router.get("/api/projects/{project_id}/generation-sync")
def generation_sync(
    project_id: str,
    outline_version: str,
    template_id: str = "keynote_light",
    auto_fit: bool = False,
):
    """Compare the live inputs for this outline with the latest successful PPTX."""
    require_project(project_id)
    storage = get_storage(project_id)
    try:
        outline = storage.load_outline(outline_version)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    snapshot = freeze_generation_inputs(
        outline,
        template_id=template_id,
        auto_fit=auto_fit,
        brand=read_project_brand(storage.root),
        assets_dir=storage.root / "assets",
    )
    identity = export_identity(project_id)
    export_fp = identity["export_fingerprint"]
    return {
        "current_fingerprint": snapshot.fingerprint,
        "export_fingerprint": export_fp,
        "in_sync": bool(export_fp) and export_fp == snapshot.fingerprint,
        "legacy_export": identity["export_legacy"],
        "export_artifact_id": identity["export_artifact_id"],
    }
