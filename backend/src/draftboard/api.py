"""
FastAPI interface over the existing Draftboard pipeline.

Every endpoint calls the same tool/storage/export functions the CLI and
agent use — there is no second generation path here.  Long work (model
outline generation, slide generation + export) runs as persisted tasks.
"""

import json
import pathlib
import re
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.models import (
    EvidenceStatus,
    Outline,
    OutlineItem,
    SlideLayout,
    validate_outline,
)
from draftboard.pptx_export import _resolve_image_path
from draftboard.storage import STORAGE_ROOT, ProjectStorage, load_json
from draftboard.themes import is_valid_theme, list_themes, resolve_theme_id

load_dotenv()

_PROJECT_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
_DEFAULT_UNTITLED_NAME = "未命名文稿"
_ALLOWED_EXTENSIONS = {".md", ".txt", ".docx", ".pdf", ".png", ".jpg", ".jpeg"}
_STATIC_DIR = pathlib.Path(__file__).parent / "static"
_PARENTS = pathlib.Path(__file__).resolve().parents
_FRONTEND_OUT_DIR = (
    _PARENTS[3] / "frontend" / "out" if len(_PARENTS) > 3 else None
)


def _web_dir() -> pathlib.Path:
    if _FRONTEND_OUT_DIR and (_FRONTEND_OUT_DIR / "index.html").exists():
        return _FRONTEND_OUT_DIR
    return _STATIC_DIR


def _root() -> pathlib.Path:
    return tools_module._storage_root or STORAGE_ROOT


def _storage(project_id: str) -> ProjectStorage:
    return ProjectStorage(project_id, storage_root=tools_module._storage_root)


def _require_project(project_id: str) -> None:
    if not (_root() / project_id).is_dir():
        raise HTTPException(404, f"项目 '{project_id}' 不存在")


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


def _outline_summaries(project_id: str) -> list[dict]:
    outlines_dir = _root() / project_id / "outlines"
    if not outlines_dir.exists():
        return []
    summaries = []
    for path in sorted(outlines_dir.glob("*.json")):
        data = load_json(path)
        summaries.append(
            {
                "outline_version": data["outline_version"],
                "is_confirmed": data["is_confirmed"],
                "item_count": len(data["items"]),
                "mtime": path.stat().st_mtime,
            }
        )
    return summaries


def _export_reports(project_id: str) -> list[dict]:
    exports_dir = _root() / project_id / "exports"
    if not exports_dir.exists():
        return []
    reports = []
    for path in exports_dir.glob("*.report.json"):
        data = load_json(path)
        data["_mtime"] = path.stat().st_mtime
        reports.append(data)
    return sorted(reports, key=lambda r: r["_mtime"])


def _latest_artifact_meta(project_id: str) -> dict:
    success_report = _latest_success_report(project_id)
    if success_report:
        art_path = (
            _root()
            / project_id
            / "artifacts"
            / success_report["artifact_id"]
            / f"r{success_report['artifact_revision']}.json"
        )
        if art_path.exists():
            data = load_json(art_path)
            return {
                "outline_version": data.get("outline_version"),
                "template_id": data.get("template_id"),
                "auto_fit": data.get("auto_fit"),
            }
    return {}


def _latest_success_report(project_id: str) -> Optional[dict]:
    for report in reversed(_export_reports(project_id)):
        path = report.get("pptx_path")
        if report["success"] and path and pathlib.Path(path).exists():
            return report
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks.sweep_interrupted(_root())
    yield


app = FastAPI(title="Draftboard API", lifespan=lifespan)


@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(KeyError)
async def key_error_handler(request, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(tasks.TaskConflictError)
async def conflict_handler(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


# ── Projects ─────────────────────────────────────────────────────────────────


class CreateProjectRequest(BaseModel):
    project_id: Optional[str] = None
    name: Optional[str] = None
    auto_named: Optional[bool] = None


def _generate_project_id() -> str:
    root = _root()
    for _ in range(16):
        candidate = f"deck-{uuid.uuid4().hex[:8]}"
        if not (root / candidate).exists():
            return candidate
    return f"deck-{uuid.uuid4().hex[:12]}"


def _project_summary(pid: str) -> dict:
    p_dir = _root() / pid
    meta_path = p_dir / "meta.json"
    meta: dict = {}
    if meta_path.exists():
        try:
            loaded_meta = load_json(meta_path)
            if isinstance(loaded_meta, dict):
                meta = loaded_meta
        except Exception:
            pass
    name = meta.get("name") or pid

    outlines = _outline_summaries(pid)
    reports = _export_reports(pid)
    latest_report = reports[-1] if reports else None
    latest_success = _latest_success_report(pid)
    art_meta = _latest_artifact_meta(pid)

    raw_theme = meta.get("theme_id") or art_meta.get("template_id") or "keynote_light"
    if raw_theme == "default" or not is_valid_theme(raw_theme):
        theme_id = "keynote_light"
    else:
        theme_id = resolve_theme_id(raw_theme)

    assets_dir = p_dir / "assets"
    asset_files = (
        sorted([f for f in assets_dir.glob("*") if f.is_file()], key=lambda f: f.name.lower())
        if assets_dir.exists()
        else []
    )
    materials_count = len(asset_files)
    material_names = [f.name for f in asset_files[:3]]

    slide_count = 0
    insufficient_evidence_count = 0
    is_confirmed = False
    cover_slide: Optional[dict] = None
    latest_outline_version: Optional[str] = None

    if outlines:
        latest_outline_meta = max(outlines, key=lambda o: o["mtime"])
        latest_outline_version = latest_outline_meta["outline_version"]
        is_confirmed = latest_outline_meta["is_confirmed"]
        slide_count = latest_outline_meta["item_count"]
        try:
            outline_data = load_json(p_dir / "outlines" / f"{latest_outline_version}.json")
            items = outline_data.get("items", [])
            for it in items:
                if (
                    it.get("evidence_status") in ("unsupported", "insufficient")
                    or not it.get("source_ids")
                ):
                    insufficient_evidence_count += 1
            if items:
                first = items[0]
                cover_slide = {
                    "title": (first.get("title") or "").replace("\\n", " ").strip(),
                    "summary": (first.get("summary") or "").replace("\\r\\n", "\n").replace("\\n", "\n").strip(),
                    "layout": first.get("layout"),
                    "column_right": (
                        first["column_right"].replace("\\r\\n", "\n").replace("\\n", "\n")
                        if isinstance(first.get("column_right"), str)
                        else first.get("column_right")
                    ),
                    "image_asset_id": first.get("image_asset_id"),
                }
        except Exception:
            pass
    elif latest_report:
        slide_count = latest_report.get("slide_count", 0)

    preview_cover_url: Optional[str] = None
    if latest_success:
        exported_theme = art_meta.get("template_id")
        exported_outline = art_meta.get("outline_version")
        theme_in_sync = (not exported_theme) or (resolve_theme_id(exported_theme) == theme_id)
        outline_in_sync = (not latest_outline_version) or (exported_outline == latest_outline_version)
        if theme_in_sync and outline_in_sync:
            pdir = _preview_dir(pid, latest_success)
            pages = sorted(pdir.glob("page-*.png")) if pdir.exists() else []
            if pages:
                cache_tag = f"{latest_success['artifact_id']}-r{latest_success['artifact_revision']}"
                preview_cover_url = f"/api/projects/{pid}/preview/{pages[0].name}?v={cache_tag}"

    if latest_success:
        stage = "ready"
        stage_label = "PPT 已就绪"
    elif is_confirmed:
        stage = "confirmed"
        stage_label = "大纲已确认"
    elif outlines:
        stage = "outline_draft"
        stage_label = "大纲待审核"
    elif materials_count > 0:
        stage = "materials_ready"
        stage_label = "待生成大纲"
    else:
        stage = "empty"
        stage_label = "待导入素材"

    mtime = p_dir.stat().st_mtime
    if outlines:
        mtime = max(mtime, max(o["mtime"] for o in outlines))
    if reports:
        mtime = max(mtime, max(r["_mtime"] for r in reports))

    return {
        "project_id": pid,
        "name": name,
        "theme_id": theme_id,
        "stage": stage,
        "stage_label": stage_label,
        "slide_count": slide_count,
        "materials_count": materials_count,
        "material_names": material_names,
        "insufficient_evidence_count": insufficient_evidence_count,
        "cover_slide": cover_slide,
        "preview_cover_url": preview_cover_url,
        "download_available": latest_success is not None,
        "mtime": mtime,
    }


@app.post("/api/projects")
def create_project(req: Optional[CreateProjectRequest] = Body(default=None)):
    req = req or CreateProjectRequest()
    explicit_id = (req.project_id or "").strip() if req.project_id is not None else ""
    if req.project_id is not None and not explicit_id:
        raise HTTPException(
            400, "项目 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头"
        )
    pid = explicit_id or _generate_project_id()
    if not _PROJECT_ID_RE.fullmatch(pid):
        raise HTTPException(
            400, "项目 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头"
        )
    if (_root() / pid).exists():
        raise HTTPException(409, f"项目 '{pid}' 已存在")
    try:
        storage = _storage(pid)
        clean_name = (req.name or "").strip()
        if clean_name:
            display_name = clean_name
            is_auto_named = (
                bool(req.auto_named)
                if req.auto_named is not None
                else (clean_name == _DEFAULT_UNTITLED_NAME)
            )
        elif not explicit_id:
            display_name = _DEFAULT_UNTITLED_NAME
            is_auto_named = True if req.auto_named is None else bool(req.auto_named)
        else:
            display_name = ""
            is_auto_named = bool(req.auto_named)

        if display_name or is_auto_named:
            meta_name = display_name or _DEFAULT_UNTITLED_NAME
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


@app.get("/api/projects")
def list_projects():
    root = _root()
    if not root.exists():
        return {"projects": []}
    pids = [p.name for p in root.iterdir() if p.is_dir()]
    return {
        "projects": [_project_summary(pid) for pid in sorted(pids)]
    }


@app.get("/api/themes")
def get_themes():
    return {"themes": list_themes()}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    _require_project(project_id)
    summary = _project_summary(project_id)
    reports = _export_reports(project_id)
    latest_success = _latest_success_report(project_id)
    art_meta = _latest_artifact_meta(project_id)
    return {
        "project_id": project_id,
        "name": summary["name"],
        "theme_id": summary["theme_id"],
        "stage": summary["stage"],
        "stage_label": summary["stage_label"],
        "slide_count": summary["slide_count"],
        "materials_count": summary["materials_count"],
        "insufficient_evidence_count": summary["insufficient_evidence_count"],
        "outlines": _outline_summaries(project_id),
        "generated_outline_version": art_meta.get("outline_version"),
        "latest_template_id": art_meta.get("template_id"),
        "latest_auto_fit": art_meta.get("auto_fit"),
        "latest_report": reports[-1] if reports else None,
        "download_available": latest_success is not None,
        "tasks": [t.model_dump() for t in tasks.list_tasks(_root(), project_id)],
    }


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    theme_id: Optional[str] = None


@app.patch("/api/projects/{project_id}")
def update_project(project_id: str, req: UpdateProjectRequest):
    if not _PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(400, "非法的项目 ID")
    _require_project(project_id)
    if req.name is None and req.theme_id is None:
        raise HTTPException(400, "没有需要更新的字段")
    p_dir = _root() / project_id
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


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    if not _PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(400, "非法的项目 ID")
    _require_project(project_id)
    p_dir = _root() / project_id
    shutil.rmtree(p_dir)
    return {"deleted": project_id}


# ── Materials ────────────────────────────────────────────────────────────────


@app.post("/api/projects/{project_id}/materials")
async def upload_material(project_id: str, file: UploadFile):
    _require_project(project_id)
    name = pathlib.Path(file.filename or "").name
    suffix = pathlib.Path(name).suffix.lower()
    if not name or suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            400, "只支持上传 .md / .txt / .docx / .pdf / .png / .jpg 文件"
        )
    assets_dir = _storage(project_id).root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    (assets_dir / name).write_bytes(content)
    try:
        output = _raw(tools_module.read_materials)(project_id=project_id)
    except ValueError as exc:
        (assets_dir / name).unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    return {
        "asset_id": pathlib.Path(name).stem,
        "source_fragments": len(output.source_fragments),
    }


@app.delete("/api/projects/{project_id}/materials/{asset_id}")
def delete_material(project_id: str, asset_id: str):
    _require_project(project_id)
    assets_dir = _storage(project_id).root / "assets"
    if not assets_dir.exists():
        raise HTTPException(404, f"素材 '{asset_id}' 不存在")
    matches = [
        f
        for f in assets_dir.iterdir()
        if f.is_file() and (f.stem == asset_id or f.name == asset_id)
    ]
    if not matches:
        raise HTTPException(404, f"素材 '{asset_id}' 不存在")
    for f in matches:
        f.unlink(missing_ok=True)

    output = _raw(tools_module.read_materials)(project_id=project_id)
    remaining_sids = {frag.source_id for frag in output.source_fragments}

    # Clean up dangling references in unconfirmed draft outlines
    storage = _storage(project_id)
    outlines_dir = storage.root / "outlines"
    if outlines_dir.exists():
        for opath in outlines_dir.glob("*.json"):
            try:
                outline = storage.load_outline(opath.stem)
                if outline.is_confirmed:
                    continue
                changed = False
                for item in outline.items:
                    filtered = [
                        sid for sid in item.source_ids if sid in remaining_sids
                    ]
                    if len(filtered) != len(item.source_ids):
                        item.source_ids = filtered
                        if not item.source_ids:
                            item.evidence_status = EvidenceStatus.UNSUPPORTED
                        changed = True
                    if item.image_asset_id == asset_id:
                        item.image_asset_id = None
                        if item.layout == SlideLayout.TEXT_IMAGE:
                            item.layout = SlideLayout.CONTENT
                        changed = True
                if changed:
                    storage.save_outline(outline)
            except Exception:
                pass

    return {
        "deleted": asset_id,
        "remaining_materials": len(output.materials),
        "source_fragments": len(output.source_fragments),
    }


@app.get("/api/projects/{project_id}/materials")
def read_materials(project_id: str):
    _require_project(project_id)
    return _raw(tools_module.read_materials)(project_id=project_id).model_dump()


@app.get("/api/projects/{project_id}/assets/{asset_ref}")
def get_image_asset(project_id: str, asset_ref: str):
    _require_project(project_id)
    assets_dir = _root() / project_id / "assets"
    path = _resolve_image_path(asset_ref, assets_dir)
    if path is None:
        raise HTTPException(404, f"图片素材 '{asset_ref}' 不存在")
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(path, media_type=media_type)


# ── Outlines ─────────────────────────────────────────────────────────────────


class OutlineGenerateRequest(BaseModel):
    prompt: Optional[str] = None


@app.post("/api/projects/{project_id}/outline/generate", status_code=202)
def generate_outline(
    project_id: str,
    req: Optional[OutlineGenerateRequest] = Body(default=None),
):
    _require_project(project_id)
    user_prompt = req.prompt.strip() if (req and req.prompt) else None
    assets_dir = _root() / project_id / "assets"
    materials = [f for f in assets_dir.glob("*") if f.is_file()] if assets_dir.exists() else []
    if not materials and user_prompt:
        assets_dir.mkdir(parents=True, exist_ok=True)
        (assets_dir / "项目简报.md").write_text(
            f"# 项目创作简报\n\n{user_prompt}\n", encoding="utf-8"
        )
        _raw(tools_module.read_materials)(project_id=project_id)
        materials = [f for f in assets_dir.glob("*") if f.is_file()]
    if not materials:
        raise HTTPException(
            400, "项目中暂无可用素材，请先上传文件或输入主题笔记后再生成大纲"
        )
    record = tasks.submit(
        _root(),
        project_id,
        "outline",
        tasks.outline_work(_root(), project_id, user_prompt=user_prompt),
    )
    return record.model_dump()


@app.get("/api/projects/{project_id}/outlines")
def list_outlines(project_id: str):
    _require_project(project_id)
    return {"outlines": _outline_summaries(project_id)}


@app.get("/api/projects/{project_id}/outlines/{version}")
def get_outline(project_id: str, version: str):
    _require_project(project_id)
    outline = _storage(project_id).load_outline(version)
    cleaned = outline.model_copy(
        update={
            "items": [
                tools_module.normalize_outline_item_text(it) for it in outline.items
            ]
        }
    )
    return cleaned.model_dump()


@app.post("/api/projects/{project_id}/outlines/{version}/confirm")
def confirm_outline(project_id: str, version: str):
    _require_project(project_id)
    return _storage(project_id).confirm_outline(version).model_dump()


class OutlineItemEdit(BaseModel):
    outline_item_id: str
    title: str
    summary: str
    layout: Optional[SlideLayout] = None
    source_ids: Optional[list[str]] = None
    column_right: Optional[str] = None
    image_asset_id: Optional[str] = None
    speaker_notes: Optional[str] = None


class OutlineEditRequest(BaseModel):
    items: list[OutlineItemEdit]


@app.put("/api/projects/{project_id}/outlines/{version}")
def edit_outline(project_id: str, version: str, req: OutlineEditRequest):
    """Edit titles, summaries, layouts, notes, and page structure (add/delete/reorder).

    Editing a confirmed outline never mutates it: a new draft version is
    derived instead, so what was confirmed stays exactly what entered the
    pipeline, and the old PPTX remains valid for that version.
    """
    _require_project(project_id)
    storage = _storage(project_id)
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


class SlideRefineRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    column_right: Optional[str] = None
    layout: Optional[str] = None
    source_ids: Optional[list[str]] = None
    mode: str = "concise"
    instruction: Optional[str] = None


@app.post("/api/projects/{project_id}/outlines/{version}/items/{item_id}/refine")
def refine_outline_item(
    project_id: str,
    version: str,
    item_id: str,
    req: SlideRefineRequest,
):
    """Generate a non-destructive AI refinement candidate (Diff preview) for one slide."""
    _require_project(project_id)
    storage = _storage(project_id)
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

    mat_out = _raw(tools_module.read_materials)(project_id=project_id)
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
    meta_path = _root() / project_id / "meta.json"
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


# ── Generation ───────────────────────────────────────────────────────────────


class GenerateRequest(BaseModel):
    outline_version: str
    template_id: str = "default"
    auto_fit: bool = False


@app.post("/api/projects/{project_id}/generate", status_code=202)
def generate(project_id: str, req: GenerateRequest):
    _require_project(project_id)
    if not is_valid_theme(req.template_id):
        raise HTTPException(400, f"未知主题 '{req.template_id}'")
    resolved_theme = resolve_theme_id(req.template_id)
    storage = _storage(project_id)
    outline = storage.load_outline(req.outline_version)
    if not outline.is_confirmed:
        raise HTTPException(
            400,
            f"大纲 '{req.outline_version}' 尚未确认，请先确认大纲后再生成 PPT",
        )
    record = tasks.submit(
        _root(),
        project_id,
        "generate",
        tasks.generate_work(
            _root(),
            project_id,
            req.outline_version,
            template_id=resolved_theme,
            auto_fit=req.auto_fit,
        ),
    )
    return record.model_dump()


# ── Tasks / results / download ───────────────────────────────────────────────


@app.get("/api/projects/{project_id}/tasks")
def list_tasks(project_id: str):
    _require_project(project_id)
    return {"tasks": [t.model_dump() for t in tasks.list_tasks(_root(), project_id)]}


@app.get("/api/projects/{project_id}/tasks/{task_id}")
def get_task(project_id: str, task_id: str):
    _require_project(project_id)
    return tasks.load_task(_root(), project_id, task_id).model_dump()


@app.get("/api/projects/{project_id}/result")
def latest_result(project_id: str):
    _require_project(project_id)
    reports = _export_reports(project_id)
    if not reports:
        raise HTTPException(404, "该项目还没有导出结果")
    return reports[-1]


@app.get("/api/projects/{project_id}/download")
def download(project_id: str):
    _require_project(project_id)
    for report in reversed(_export_reports(project_id)):
        path = report.get("pptx_path")
        if report["success"] and path and pathlib.Path(path).exists():
            return FileResponse(
                path,
                media_type=(
                    "application/vnd.openxmlformats-officedocument."
                    "presentationml.presentation"
                ),
                filename=f"{project_id}.pptx",
            )
    raise HTTPException(404, "没有可下载的 PPTX：尚未成功导出过文件")


@app.get("/api/projects/{project_id}/download/pdf")
def download_pdf(project_id: str):
    _require_project(project_id)
    report = _latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "没有可下载的 PDF：尚未成功导出过文件")
    pdir = _preview_dir(project_id, report)
    pdf_path = pdir / "deck.pdf"
    if not pdf_path.exists():
        from draftboard.render import render_preview

        render_preview(pathlib.Path(report["pptx_path"]), pdir)
    if not pdf_path.exists():
        raise HTTPException(500, "PDF 渲染未生成输出文件")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{project_id}.pdf",
    )


# ── Per-page preview (same artifact/revision as the download) ────────────────


def _preview_dir(project_id: str, report: dict) -> pathlib.Path:
    return (
        _root() / project_id / "previews"
        / f"{report['artifact_id']}-r{report['artifact_revision']}"
    )


def _preview_payload(project_id: str, report: dict, pages: list[pathlib.Path]) -> dict:
    cache_tag = f"{report['artifact_id']}-r{report['artifact_revision']}"
    return {
        "artifact_id": report["artifact_id"],
        "artifact_revision": report["artifact_revision"],
        "pages": [
            f"/api/projects/{project_id}/preview/{p.name}?v={cache_tag}"
            for p in pages
        ],
    }


@app.get("/api/projects/{project_id}/preview")
def get_preview(project_id: str):
    _require_project(project_id)
    report = _latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出，没有可预览的内容")
    pages = sorted(_preview_dir(project_id, report).glob("page-*.png"))
    if not pages:
        raise HTTPException(404, "预览尚未渲染，可调用 POST preview/render 重新渲染")
    return _preview_payload(project_id, report, pages)


@app.post("/api/projects/{project_id}/preview/render")
@app.post("/api/projects/{project_id}/render-preview")
def render_preview_now(project_id: str):
    _require_project(project_id)
    from draftboard.render import render_preview

    report = _latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出，没有可渲染的内容")
    pages = render_preview(
        pathlib.Path(report["pptx_path"]), _preview_dir(project_id, report)
    )
    return _preview_payload(project_id, report, pages)


@app.get("/api/projects/{project_id}/preview/{name}")
def preview_image(project_id: str, name: str):
    _require_project(project_id)
    if not re.fullmatch(r"page-\d+\.png", name):
        raise HTTPException(400, "非法的预览图片名")
    report = _latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出")
    path = _preview_dir(project_id, report) / name
    if not path.exists():
        raise HTTPException(404, "预览图片不存在")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


# ── Single-Port Frontend Hosting (Next.js static export + fallback) ──────────


@app.api_route("/", methods=["GET", "HEAD"])
def index():
    return FileResponse(_web_dir() / "index.html")


@app.get("/_next/{subpath:path}")
def next_static_assets(subpath: str):
    web_root = _web_dir().resolve()
    target = (web_root / "_next" / subpath).resolve()
    if not target.is_relative_to(web_root) or not target.is_file():
        raise HTTPException(404, "静态资源不存在")
    return FileResponse(target)


@app.api_route("/p/{rest_of_path:path}", methods=["GET", "HEAD"])
def frontend_project_routes(rest_of_path: str):
    web_root = _web_dir().resolve()
    cleaned = rest_of_path.strip("/")
    if not cleaned:
        raise HTTPException(404, "页面不存在")

    placeholder_dir = (web_root / "p" / "__placeholder__").resolve()
    if "/" not in cleaned and cleaned.endswith(".txt"):
        pid = cleaned[:-4]
        template_path = web_root / "p" / "__placeholder__.txt"
        media_type = "text/plain; charset=utf-8"
    else:
        parts = cleaned.split("/", 1)
        pid = parts[0]
        sub = parts[1] if len(parts) > 1 else ""
        if not sub:
            template_path = web_root / "p" / "__placeholder__.html"
            media_type = "text/html; charset=utf-8"
        elif sub == "preview":
            template_path = placeholder_dir / "preview.html"
            media_type = "text/html; charset=utf-8"
        else:
            template_path = (placeholder_dir / sub).resolve()
            if not template_path.is_relative_to(placeholder_dir):
                raise HTTPException(404, "页面不存在")
            media_type = (
                "text/html; charset=utf-8"
                if template_path.suffix == ".html"
                else "text/plain; charset=utf-8"
            )

    if not _PROJECT_ID_RE.fullmatch(pid):
        raise HTTPException(404, "非法的项目路径")

    if not template_path.is_file():
        fallback = web_root / "index.html"
        if fallback.is_file():
            return FileResponse(fallback)
        raise HTTPException(404, "前端页面尚未构建")

    body = template_path.read_text(encoding="utf-8").replace(
        "__placeholder__", pid
    )
    return Response(content=body, media_type=media_type)


@app.api_route("/{filename}", methods=["GET", "HEAD"])
def frontend_root_files(filename: str):
    if "/" in filename or filename.startswith("api"):
        raise HTTPException(404, "资源不存在")
    web_root = _web_dir().resolve()
    target = (web_root / filename).resolve()
    if filename == "favicon.ico" and not target.is_file():
        svg_icon = web_root / "icon.svg"
        if svg_icon.is_file():
            return FileResponse(svg_icon, media_type="image/svg+xml")
    if not target.is_relative_to(web_root) or not target.is_file():
        raise HTTPException(404, "资源不存在")
    return FileResponse(target)