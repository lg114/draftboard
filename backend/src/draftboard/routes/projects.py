"""Project CRUD, brand kit customization, and pre-export preflight audit routes."""

from __future__ import annotations

import json
import re
import shutil
import time
import uuid
from typing import Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

import draftboard.tasks as tasks
import draftboard.tools as tools_module
import draftboard.user_library as user_library
from draftboard.generation_snapshot import read_project_brand
from draftboard.measure import load_fonts
from draftboard.models import (
    Artifact,
    EvidenceStatus,
    Slide,
    SlideElement,
    SlideLayout,
)
from draftboard.pptx_export import _measure_and_resolve, _resolve_image_path
from draftboard.routes.common import (
    DEFAULT_UNTITLED_NAME,
    PROJECT_ID_RE,
    export_identity,
    export_reports,
    get_root,
    get_storage,
    latest_artifact_meta,
    latest_success_report,
    outline_summaries,
    project_summary,
    require_project,
)
from draftboard.storage import load_json
from draftboard.themes import get_theme, is_valid_theme, resolve_theme_id

router = APIRouter()


class CreateProjectRequest(BaseModel):
    project_id: Optional[str] = None
    name: Optional[str] = None
    auto_named: Optional[bool] = None


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    theme_id: Optional[str] = None


def _generate_project_id() -> str:
    root = get_root()
    for _ in range(16):
        candidate = f"deck-{uuid.uuid4().hex[:8]}"
        if not (root / candidate).exists():
            return candidate
    return f"deck-{uuid.uuid4().hex[:12]}"


@router.post("/api/projects")
def create_project(req: Optional[CreateProjectRequest] = Body(default=None)):
    req = req or CreateProjectRequest()
    explicit_id = (req.project_id or "").strip() if req.project_id is not None else ""
    if req.project_id is not None and not explicit_id:
        raise HTTPException(
            400, "项目 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头"
        )
    pid = explicit_id or _generate_project_id()
    if not PROJECT_ID_RE.fullmatch(pid):
        raise HTTPException(
            400, "项目 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头"
        )
    if (get_root() / pid).exists():
        raise HTTPException(409, f"项目 '{pid}' 已存在")
    try:
        storage = get_storage(pid)
        clean_name = (req.name or "").strip()
        if clean_name:
            display_name = clean_name
            is_auto_named = (
                bool(req.auto_named)
                if req.auto_named is not None
                else (clean_name == DEFAULT_UNTITLED_NAME)
            )
        elif not explicit_id:
            display_name = DEFAULT_UNTITLED_NAME
            is_auto_named = True if req.auto_named is None else bool(req.auto_named)
        else:
            display_name = ""
            is_auto_named = bool(req.auto_named)

        if display_name or is_auto_named:
            meta_name = display_name or DEFAULT_UNTITLED_NAME
            (storage.root / "meta.json").write_text(
                json.dumps(
                    {
                        "project_id": pid,
                        "name": meta_name,
                        "auto_named": is_auto_named,
                        "created_at": time.time(),
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            return {"project_id": pid, "name": meta_name, "auto_named": is_auto_named}
        return {"project_id": pid, "name": pid, "auto_named": False}
    except Exception as exc:
        raise HTTPException(500, f"创建项目目录失败: {exc}")


@router.get("/api/projects")
def list_projects():
    root = get_root()
    if not root.exists():
        return {"projects": []}
    pids = [p.name for p in root.iterdir() if p.is_dir()]
    return {"projects": [project_summary(pid) for pid in sorted(pids)]}


@router.get("/api/projects/{project_id}")
def get_project(project_id: str):
    require_project(project_id)
    summary = project_summary(project_id)
    reports = export_reports(project_id)
    latest_success = latest_success_report(project_id)
    art_meta = latest_artifact_meta(project_id)
    meta_path = get_root() / project_id / "meta.json"
    meta_brand = None
    if meta_path.exists():
        try:
            loaded_m = load_json(meta_path)
            if isinstance(loaded_m, dict) and isinstance(loaded_m.get("brand"), dict):
                meta_brand = loaded_m["brand"]
        except Exception:
            pass
    return {
        "project_id": project_id,
        "name": summary["name"],
        "theme_id": summary["theme_id"],
        "brand": meta_brand,
        "stage": summary["stage"],
        "stage_label": summary["stage_label"],
        "slide_count": summary["slide_count"],
        "materials_count": summary["materials_count"],
        "insufficient_evidence_count": summary["insufficient_evidence_count"],
        "outlines": outline_summaries(project_id),
        "generated_outline_version": art_meta.get("outline_version"),
        "latest_template_id": art_meta.get("template_id"),
        "latest_auto_fit": art_meta.get("auto_fit"),
        "latest_report": reports[-1] if reports else None,
        "download_available": latest_success is not None,
        **export_identity(project_id),
        "tasks": [t.model_dump() for t in tasks.list_tasks(get_root(), project_id)],
    }


@router.patch("/api/projects/{project_id}")
def update_project(project_id: str, req: UpdateProjectRequest):
    if not PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(400, "非法的项目 ID")
    require_project(project_id)
    if req.name is None and req.theme_id is None:
        raise HTTPException(400, "没有需要更新的字段")
    p_dir = get_root() / project_id
    meta_path = p_dir / "meta.json"
    meta: dict = {"project_id": project_id, "created_at": time.time()}
    if meta_path.exists():
        try:
            loaded_meta = load_json(meta_path)
            if isinstance(loaded_meta, dict):
                meta.update(loaded_meta)
        except Exception:
            pass
    if req.name is not None:
        clean_name = req.name.strip()
        if not clean_name:
            raise HTTPException(400, "项目名称不能为空")
        meta["name"] = clean_name
        meta["auto_named"] = False
    if req.theme_id is not None:
        if not is_valid_theme(req.theme_id):
            raise HTTPException(400, f"未知主题: {req.theme_id}")
        meta["theme_id"] = resolve_theme_id(req.theme_id)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {
        "project_id": project_id,
        "name": meta.get("name") or project_id,
        "theme_id": meta.get("theme_id"),
    }


@router.patch("/api/projects/{project_id}/brand")
def update_project_brand(project_id: str, req: user_library.BrandKit):
    """Save or clear per-project brand kit (accent, background, footer, corner logo)."""
    require_project(project_id)
    try:
        cleaned = req.cleaned()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    p_dir = get_root() / project_id
    meta_path = p_dir / "meta.json"
    meta: dict = {"project_id": project_id, "created_at": time.time()}
    if meta_path.exists():
        try:
            loaded_meta = load_json(meta_path)
            if isinstance(loaded_meta, dict):
                meta.update(loaded_meta)
        except Exception:
            pass

    brand_dict = cleaned.model_dump()
    if any(
        [
            brand_dict.get("accent_hex"),
            brand_dict.get("bg_hex"),
            brand_dict.get("footer_text"),
            brand_dict.get("logo_asset_id"),
        ]
    ):
        meta["brand"] = brand_dict
    else:
        meta.pop("brand", None)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"project_id": project_id, "brand": meta.get("brand")}


@router.get("/api/projects/{project_id}/preflight")
def preflight_check(
    project_id: str,
    version: Optional[str] = None,
    theme_id: str = "keynote_light",
    auto_fit: bool = True,
):
    """Comprehensive pre-export readiness audit: layout safety, provenance, media, notes, rhythm."""
    require_project(project_id)
    storage = get_storage(project_id)
    summaries = outline_summaries(project_id)
    if not summaries:
        raise HTTPException(400, "当前项目还没有大纲")
    target_ver = version or summaries[0]["outline_version"]
    outline = storage.load_outline(target_ver)
    assets_dir = storage.root / "assets"

    items = [tools_module.normalize_outline_item_text(it) for it in outline.items]
    total = len(items)
    findings: list[dict] = []

    supported_count = 0
    notes_count = 0
    eff_layouts: list[str] = []

    for idx, it in enumerate(items):
        page_no = idx + 1
        is_custom = bool(it.custom_elements)
        eff_layout = (
            "custom"
            if is_custom
            else (
                it.layout.value
                if it.layout
                else (
                    "cover"
                    if idx == 0
                    else ("closing" if idx == total - 1 and total > 1 else "content")
                )
            )
        )
        eff_layouts.append(eff_layout)

        if it.evidence_status == EvidenceStatus.SUPPORTED and it.source_ids:
            supported_count += 1
        elif it.evidence_status == EvidenceStatus.PARTIAL and it.source_ids:
            findings.append(
                {
                    "slide_index": idx,
                    "slide_number": page_no,
                    "category": "provenance",
                    "severity": "warning",
                    "message": f"第 {page_no} 页「{it.title[:22]}」仅部分引用素材依据，建议核对数据出处。",
                }
            )
        else:
            findings.append(
                {
                    "slide_index": idx,
                    "slide_number": page_no,
                    "category": "provenance",
                    "severity": "warning",
                    "message": f"第 {page_no} 页「{it.title[:22]}」尚未关联原始素材出处。",
                }
            )

        if (it.speaker_notes or "").strip():
            notes_count += 1

        if is_custom and it.custom_elements:
            for el in it.custom_elements:
                if el.kind == "image":
                    img_ref = (el.image_asset_id or "").strip()
                    if not img_ref or _resolve_image_path(img_ref, assets_dir) is None:
                        findings.append(
                            {
                                "slide_index": idx,
                                "slide_number": page_no,
                                "category": "media",
                                "severity": "error",
                                "message": f"第 {page_no} 页自由画布中的图片素材「{img_ref or '未指定'}」已缺失，请重新指定或删除该图片元素。",
                            }
                        )
        else:
            if eff_layout == "text_image":
                img_ref = (it.image_asset_id or "").strip()
                if not img_ref or _resolve_image_path(img_ref, assets_dir) is None:
                    findings.append(
                        {
                            "slide_index": idx,
                            "slide_number": page_no,
                            "category": "media",
                            "severity": "error",
                            "message": f"第 {page_no} 页图文版式缺少有效配图，请补充或切换版式。",
                        }
                    )
            if eff_layout == "two_column" and not (it.column_right or "").strip():
                findings.append(
                    {
                        "slide_index": idx,
                        "slide_number": page_no,
                        "category": "layout",
                        "severity": "error",
                        "message": f"第 {page_no} 页双栏版式缺少右栏内容。",
                    }
                )
            if len(it.summary.strip()) > 190:
                findings.append(
                    {
                        "slide_index": idx,
                        "slide_number": page_no,
                        "category": "rhythm",
                        "severity": "info",
                        "message": f"第 {page_no} 页正文偏密（{len(it.summary.strip())} 字），建议精简要点或改用卡片排版。",
                    }
                )

    brand_cfg = read_project_brand(storage.root)
    if brand_cfg and brand_cfg.get("logo_asset_id"):
        logo_ref = str(brand_cfg["logo_asset_id"]).strip()
        if logo_ref and _resolve_image_path(logo_ref, assets_dir) is None:
            findings.append(
                {
                    "slide_index": 0,
                    "slide_number": 1,
                    "category": "media",
                    "severity": "error",
                    "message": f"项目品牌角落 Logo 素材「{logo_ref}」已缺失，请在「主题 → 品牌定制」中重新选择或清除。",
                }
            )

    run_len = 1
    for i in range(1, len(eff_layouts)):
        if eff_layouts[i] == eff_layouts[i - 1] and eff_layouts[i] not in (
            "cover",
            "closing",
            "custom",
        ):
            run_len += 1
            if run_len == 3:
                findings.append(
                    {
                        "slide_index": i - 2,
                        "slide_number": i - 1,
                        "category": "rhythm",
                        "severity": "info",
                        "message": f"第 {i - 1}–{i + 1} 页连续使用相同版式，可切换版式或改用自由画布制造节奏变化。",
                    }
                )
        else:
            run_len = 1

    slides: list[Slide] = []
    for idx, it in enumerate(items):
        sid = f"slide-{idx + 1:03d}"
        layout = it.layout or (
            SlideLayout.COVER
            if idx == 0
            else (
                SlideLayout.CLOSING
                if idx == total - 1 and total > 1
                else SlideLayout.CONTENT
            )
        )
        els = [
            SlideElement(
                element_id=f"{sid}-title", type="title", content=it.title or "未命名"
            )
        ]
        if layout == SlideLayout.BULLETS:
            for bi, ln in enumerate(
                [l for l in it.summary.splitlines() if l.strip()], start=1
            ):
                els.append(
                    SlideElement(
                        element_id=f"{sid}-b{bi}", type="bullet", content=ln
                    )
                )
        elif layout == SlideLayout.TWO_COLUMN:
            els.append(
                SlideElement(
                    element_id=f"{sid}-cl", type="column_left", content=it.summary
                )
            )
            if it.column_right:
                els.append(
                    SlideElement(
                        element_id=f"{sid}-cr",
                        type="column_right",
                        content=it.column_right,
                    )
                )
        elif layout == SlideLayout.COVER:
            els.append(
                SlideElement(
                    element_id=f"{sid}-sub", type="subtitle", content=it.summary
                )
            )
        elif layout == SlideLayout.CLOSING:
            els.append(
                SlideElement(
                    element_id=f"{sid}-con", type="conclusion", content=it.summary
                )
            )
        else:
            els.append(
                SlideElement(element_id=f"{sid}-txt", type="text", content=it.summary)
            )
        slides.append(
            Slide(
                slide_id=sid,
                layout=layout,
                elements=els,
                speaker_notes=it.speaker_notes,
                custom_bg=it.custom_bg,
                custom_elements=it.custom_elements,
            )
        )

    probe_artifact = Artifact(
        artifact_id="preflight",
        project_id=project_id,
        artifact_revision=1,
        slides=slides,
        outline_version=target_ver,
        template_id=resolve_theme_id(theme_id),
        auto_fit=auto_fit,
    )
    layout_errors: list[str] = []
    try:
        theme = get_theme(probe_artifact.template_id)
        _, layout_errors = _measure_and_resolve(
            probe_artifact,
            load_fonts(),
            auto_fit=auto_fit,
            decorative=theme.decorative,
        )
    except Exception as exc:
        layout_errors = [str(exc)]

    for err in layout_errors:
        m_slide = re.search(r"slide-(\d+)", err, re.IGNORECASE)
        s_idx = (int(m_slide.group(1)) - 1) if m_slide else 0
        s_idx = max(0, min(total - 1, s_idx))
        findings.append(
            {
                "slide_index": s_idx,
                "slide_number": s_idx + 1,
                "category": "layout",
                "severity": "error",
                "message": err,
            }
        )

    error_count = sum(1 for f in findings if f["severity"] == "error")
    warning_count = sum(1 for f in findings if f["severity"] == "warning")
    info_count = sum(1 for f in findings if f["severity"] == "info")

    score = 100 - error_count * 22 - warning_count * 8 - info_count * 3
    score = max(0, min(100, score))

    return {
        "outline_version": target_ver,
        "total_slides": total,
        "ready": error_count == 0,
        "score": score,
        "summary": {
            "layout_ok": not any(f["category"] == "layout" for f in findings),
            "media_ok": not any(f["category"] == "media" for f in findings),
            "supported_slides": supported_count,
            "notes_slides": notes_count,
            "error_count": error_count,
            "warning_count": warning_count,
            "info_count": info_count,
        },
        "findings": findings,
    }


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    if not PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(400, "非法的项目 ID")
    require_project(project_id)
    p_dir = get_root() / project_id
    shutil.rmtree(p_dir)
    return {"deleted": project_id}
