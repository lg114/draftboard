"""Project CRUD and brand kit customization routes."""

from __future__ import annotations

import json
import shutil
import time
import uuid
from typing import Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

import draftboard.tasks as tasks
import draftboard.user_library as user_library
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
from draftboard.themes import is_valid_theme, resolve_theme_id

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
    if user_library.has_any_brand_fields(brand_dict):
        meta["brand"] = brand_dict
    else:
        meta.pop("brand", None)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {"project_id": project_id, "brand": meta.get("brand")}


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    if not PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(400, "非法的项目 ID")
    require_project(project_id)
    p_dir = get_root() / project_id
    shutil.rmtree(p_dir)
    return {"deleted": project_id}
