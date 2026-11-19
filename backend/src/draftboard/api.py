"""
FastAPI interface over the existing Draftboard pipeline.

Every endpoint calls the same tool/storage/export functions the CLI and
agent use — there is no second generation path here.  Long work (model
outline generation, slide generation + export) runs as persisted tasks.
"""

import pathlib
import re
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import draftboard.tasks as tasks
import draftboard.tools as tools_module
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


@app.post("/api/projects")
def create_project(req: CreateProjectRequest):
    if not _PROJECT_ID_RE.fullmatch(req.project_id):
        raise HTTPException(
            400, "项目 ID 只能包含字母、数字、下划线和连字符，且以字母或数字开头"
        )
    if (_root() / req.project_id).exists():
        raise HTTPException(409, f"项目 '{req.project_id}' 已存在")
    _storage(req.project_id)
    return {"project_id": req.project_id}


@app.get("/api/projects")
def list_projects():
    root = _root()
    if not root.exists():
        return {"projects": []}
    return {
        "projects": [
            {"project_id": p.name} for p in sorted(root.iterdir()) if p.is_dir()
        ]
    }


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    _require_project(project_id)
    reports = _export_reports(project_id)
    latest_success = next(
        (
            r
            for r in reversed(reports)
            if r["success"] and r.get("pptx_path") and pathlib.Path(r["pptx_path"]).exists()
        ),
        None,
    )
    return {
        "project_id": project_id,
        "outlines": _outline_summaries(project_id),
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


# ── Generation ───────────────────────────────────────────────────────────────


class GenerateRequest(BaseModel):
    outline_version: str


@app.post("/api/projects/{project_id}/generate", status_code=202)
def generate(project_id: str, req: GenerateRequest):
    _require_project(project_id)
    outline = _storage(project_id).load_outline(req.outline_version)
    if not outline.is_confirmed:
        raise HTTPException(400, "大纲尚未确认，请先确认大纲再生成。")
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


# ── Minimal closed-loop page ─────────────────────────────────────────────────


@app.get("/")
def index():
    return FileResponse(_STATIC_DIR / "index.html")