"""
FastAPI interface over the existing Draftboard pipeline.

Every endpoint calls the same tool/storage/export functions the CLI and
agent use — there is no second generation path here.  Long work (model
outline generation, slide generation + export) runs as persisted tasks.
"""

import pathlib
import re
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.models import Outline, validate_outline
from draftboard.storage import STORAGE_ROOT, ProjectStorage, load_json

load_dotenv()

_PROJECT_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
_ALLOWED_EXTENSIONS = {".md", ".txt", ".png", ".jpg", ".jpeg"}
_STATIC_DIR = pathlib.Path(__file__).parent / "static"


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


def _latest_artifact_outline_version(project_id: str) -> Optional[str]:
    artifact_files = list((_root() / project_id / "artifacts").glob("*/r*.json"))
    if not artifact_files:
        return None
    latest = max(artifact_files, key=lambda p: p.stat().st_mtime)
    return load_json(latest).get("outline_version")


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
    project_id: str
    name: Optional[str] = None


def _project_summary(pid: str) -> dict:
    p_dir = _root() / pid
    meta_path = p_dir / "meta.json"
    name = pid
    if meta_path.exists():
        try:
            name = load_json(meta_path).get("name") or pid
        except Exception:
            pass

    outlines = _outline_summaries(pid)
    reports = _export_reports(pid)
    latest_report = reports[-1] if reports else None
    latest_success = _latest_success_report(pid)

    assets_dir = p_dir / "assets"
    materials_count = len([f for f in assets_dir.glob("*") if f.is_file()]) if assets_dir.exists() else 0

    slide_count = 0
    insufficient_evidence_count = 0
    is_confirmed = False

    if outlines:
        latest_outline_meta = max(outlines, key=lambda o: o["mtime"])
        is_confirmed = latest_outline_meta["is_confirmed"]
        slide_count = latest_outline_meta["item_count"]
        try:
            outline_data = load_json(p_dir / "outlines" / f"{latest_outline_meta['outline_version']}.json")
            for it in outline_data.get("items", []):
                if it.get("evidence_status") == "insufficient" or not it.get("source_ids"):
                    insufficient_evidence_count += 1
        except Exception:
            pass
    elif latest_report:
        slide_count = latest_report.get("slide_count", 0)

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
        stage_label = "素材已导入"
    else:
        stage = "empty"
        stage_label = "待上传素材"

    mtime = p_dir.stat().st_mtime
    if outlines:
        mtime = max(mtime, max(o["mtime"] for o in outlines))
    if reports:
        mtime = max(mtime, max(r["_mtime"] for r in reports))

    return {
        "project_id": pid,
        "name": name,
        "stage": stage,
        "stage_label": stage_label,
        "slide_count": slide_count,
        "materials_count": materials_count,
        "insufficient_evidence_count": insufficient_evidence_count,
        "download_available": latest_success is not None,
        "mtime": mtime,
    }


@app.post("/api/projects")
def create_project(req: CreateProjectRequest):
    if not _PROJECT_ID_RE.fullmatch(req.project_id):
        raise HTTPException(
            400, "项目 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头"
        )
    if (_root() / req.project_id).exists():
        raise HTTPException(409, f"项目 '{req.project_id}' 已存在")
    try:
        storage = _storage(req.project_id)
        if req.name:
            import json, time
            (storage.root / "meta.json").write_text(
                json.dumps({"project_id": req.project_id, "name": req.name, "created_at": time.time()}, ensure_ascii=False),
                encoding="utf-8"
            )
        return {"project_id": req.project_id, "name": req.name or req.project_id}
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


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    _require_project(project_id)
    summary = _project_summary(project_id)
    reports = _export_reports(project_id)
    latest_success = _latest_success_report(project_id)
    return {
        "project_id": project_id,
        "name": summary["name"],
        "stage": summary["stage"],
        "stage_label": summary["stage_label"],
        "slide_count": summary["slide_count"],
        "materials_count": summary["materials_count"],
        "insufficient_evidence_count": summary["insufficient_evidence_count"],
        "outlines": _outline_summaries(project_id),
        "generated_outline_version": _latest_artifact_outline_version(project_id),
        "latest_report": reports[-1] if reports else None,
        "download_available": latest_success is not None,
        "tasks": [t.model_dump() for t in tasks.list_tasks(_root(), project_id)],
    }


# ── Materials ────────────────────────────────────────────────────────────────


@app.post("/api/projects/{project_id}/materials")
async def upload_material(project_id: str, file: UploadFile):
    _require_project(project_id)
    name = pathlib.Path(file.filename or "").name
    suffix = pathlib.Path(name).suffix.lower()
    if not name or suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(400, "只支持上传 .md / .txt / .png / .jpg 文件")
    assets_dir = _storage(project_id).root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    (assets_dir / name).write_bytes(content)
    output = _raw(tools_module.read_materials)(project_id=project_id)
    return {
        "asset_id": pathlib.Path(name).stem,
        "source_fragments": len(output.source_fragments),
    }


@app.get("/api/projects/{project_id}/materials")
def read_materials(project_id: str):
    _require_project(project_id)
    return _raw(tools_module.read_materials)(project_id=project_id).model_dump()


# ── Outlines ─────────────────────────────────────────────────────────────────


@app.post("/api/projects/{project_id}/outline/generate", status_code=202)
def generate_outline(project_id: str):
    _require_project(project_id)
    assets_dir = _root() / project_id / "assets"
    materials = [f for f in assets_dir.glob("*") if f.is_file()] if assets_dir.exists() else []
    if not materials:
        raise HTTPException(400, "项目中暂无可用素材，请先上传 Markdown 笔记或图片后再生成大纲")
    record = tasks.submit(
        _root(), project_id, "outline", tasks.outline_work(_root(), project_id)
    )
    return record.model_dump()


@app.get("/api/projects/{project_id}/outlines")
def list_outlines(project_id: str):
    _require_project(project_id)
    return {"outlines": _outline_summaries(project_id)}


@app.get("/api/projects/{project_id}/outlines/{version}")
def get_outline(project_id: str, version: str):
    _require_project(project_id)
    return _storage(project_id).load_outline(version).model_dump()


@app.post("/api/projects/{project_id}/outlines/{version}/confirm")
def confirm_outline(project_id: str, version: str):
    _require_project(project_id)
    return _storage(project_id).confirm_outline(version).model_dump()


class OutlineItemEdit(BaseModel):
    outline_item_id: str
    title: str
    summary: str


class OutlineEditRequest(BaseModel):
    items: list[OutlineItemEdit]


@app.put("/api/projects/{project_id}/outlines/{version}")
def edit_outline(project_id: str, version: str, req: OutlineEditRequest):
    """Edit titles/summaries and page order of an outline.

    Editing a confirmed outline never mutates it: a new draft version is
    derived instead, so what was confirmed stays exactly what entered the
    pipeline, and the old PPTX remains valid for that version.
    """
    _require_project(project_id)
    storage = _storage(project_id)
    outline = storage.load_outline(version)
    existing = {item.outline_item_id: item for item in outline.items}
    ids = [e.outline_item_id for e in req.items]
    if len(ids) != len(set(ids)) or set(ids) != set(existing):
        raise HTTPException(
            400, "编辑必须恰好覆盖原有全部条目：不能新增、删除或重复条目"
        )
    new_items = []
    for edit in req.items:
        item = existing[edit.outline_item_id].model_copy(deep=True)
        item.title = edit.title
        item.summary = edit.summary
        new_items.append(item)
    errors = validate_outline(new_items, storage.load_source_ids())
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


# ── Generation ───────────────────────────────────────────────────────────────


class GenerateRequest(BaseModel):
    outline_version: str


@app.post("/api/projects/{project_id}/generate", status_code=202)
def generate(project_id: str, req: GenerateRequest):
    _require_project(project_id)
    storage = _storage(project_id)
    outline = storage.load_outline(req.outline_version)
    if not outline.is_confirmed:
        outline = storage.confirm_outline(req.outline_version)
    record = tasks.submit(
        _root(),
        project_id,
        "generate",
        tasks.generate_work(_root(), project_id, req.outline_version),
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


# ── Per-page preview (same artifact/revision as the download) ────────────────


def _preview_dir(project_id: str, report: dict) -> pathlib.Path:
    return (
        _root() / project_id / "previews"
        / f"{report['artifact_id']}-r{report['artifact_revision']}"
    )


def _preview_payload(project_id: str, report: dict, pages: list[pathlib.Path]) -> dict:
    return {
        "artifact_id": report["artifact_id"],
        "artifact_revision": report["artifact_revision"],
        "pages": [f"/api/projects/{project_id}/preview/{p.name}" for p in pages],
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
    return FileResponse(path, media_type="image/png")


# ── Minimal closed-loop page ─────────────────────────────────────────────────


@app.get("/")
def index():
    return FileResponse(_STATIC_DIR / "index.html")