"""
FastAPI interface over the existing Draftboard pipeline.

Every endpoint calls the same tool/storage/export functions the CLI and
agent use — there is no second generation path here.  Long work (model
outline generation, slide generation + export) runs as persisted tasks.
"""

import io
import json
import pathlib
import re
import shutil
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

import draftboard.chat_agent as chat_agent
import draftboard.llm_config as llm_config
import draftboard.tasks as tasks
import draftboard.tools as tools_module
import draftboard.user_library as user_library
from PIL import Image, ImageDraw
from draftboard.measure import load_fonts
from draftboard.models import (
    Artifact,
    CanvasElement,
    ChartSeries,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
    SlideLayout,
    validate_outline,
)
from draftboard.pptx_export import _measure_and_resolve, _resolve_image_path
from draftboard.storage import STORAGE_ROOT, ProjectStorage, load_json
from draftboard.themes import get_theme, is_valid_theme, list_themes, resolve_theme_id

load_dotenv()

_PROJECT_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
_DEFAULT_UNTITLED_NAME = "未命名文稿"
_ALLOWED_EXTENSIONS = {
    ".md",
    ".txt",
    ".docx",
    ".pdf",
    ".csv",
    ".xlsx",
    ".pptx",
    ".png",
    ".jpg",
    ".jpeg",
}
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


# ── Global LLM Settings (Multi-Profile + Connection Test) ────────────────────


class LLMProfileUpsertRequest(BaseModel):
    profile_id: Optional[str] = None
    name: str = ""
    provider: str = "openai"
    base_url: str = ""
    api_key: Optional[str] = None
    clear_api_key: bool = False
    inherit_env_key: bool = False
    model: str
    activate: bool = True


class LLMActiveProfileRequest(BaseModel):
    profile_id: Optional[str] = None


class LLMConnectionTestRequest(BaseModel):
    profile_id: Optional[str] = None
    use_env: bool = False
    provider: str = "openai"
    base_url: str = ""
    api_key: Optional[str] = None
    model: str = ""


@app.get("/api/settings/llm")
def get_llm_settings():
    return llm_config.get_public_llm_settings()


@app.post("/api/settings/llm/profiles")
def save_llm_profile(req: LLMProfileUpsertRequest):
    return llm_config.upsert_llm_profile(
        profile_id=req.profile_id,
        name=req.name,
        provider=req.provider,
        base_url=req.base_url,
        api_key=req.api_key,
        clear_api_key=req.clear_api_key,
        inherit_env_key=req.inherit_env_key,
        model=req.model,
        activate=req.activate,
    )


@app.post("/api/settings/llm/active")
def activate_llm_profile(req: LLMActiveProfileRequest):
    return llm_config.set_active_llm_profile(req.profile_id)


@app.delete("/api/settings/llm/profiles/{profile_id}")
def remove_llm_profile(profile_id: str):
    return llm_config.delete_llm_profile(profile_id)


@app.post("/api/settings/llm/test")
async def test_llm_settings(req: LLMConnectionTestRequest):
    return await llm_config.test_llm_connection(
        profile_id=req.profile_id,
        use_env=req.use_env,
        provider=req.provider,
        base_url=req.base_url,
        api_key=req.api_key,
        model=req.model,
    )


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
                    "custom_bg": first.get("custom_bg"),
                    "custom_elements": first.get("custom_elements"),
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


# ── Saved Reusable Custom Layouts ─────────────────────────────────────────────


class CreateSavedLayoutRequest(BaseModel):
    name: str
    description: Optional[str] = None
    custom_bg: Optional[str] = "theme:bg"
    elements: list[CanvasElement]


@app.get("/api/layouts/custom")
def get_saved_layouts():
    return {"layouts": [p.model_dump() for p in user_library.list_saved_layouts()]}


@app.post("/api/layouts/custom")
def save_custom_layout(req: CreateSavedLayoutRequest):
    try:
        preset = user_library.create_saved_layout(
            name=req.name,
            elements=req.elements,
            custom_bg=req.custom_bg,
            description=req.description,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return preset.model_dump()


@app.delete("/api/layouts/custom/{layout_id}")
def remove_saved_layout(layout_id: str):
    if not user_library.delete_saved_layout(layout_id):
        raise HTTPException(404, "未找到该收藏版式")
    return {"deleted": layout_id}


# ── One-Click 10-Second Interactive Demo Project ──────────────────────────────


def _generate_demo_diagram(path: pathlib.Path) -> None:
    """Create a crisp architectural diagram PNG with PIL (zero external assets)."""
    im = Image.new("RGB", (900, 560), (245, 246, 248))
    draw = ImageDraw.Draw(im)
    # 3 clean tier cards
    boxes = [
        (60, 70, 840, 190, (255, 255, 255), (0, 113, 227)),
        (60, 225, 435, 365, (255, 255, 255), (46, 125, 99)),
        (465, 225, 840, 365, (255, 255, 255), (46, 125, 99)),
        (60, 400, 840, 500, (29, 29, 31), (29, 29, 31)),
    ]
    for x1, y1, x2, y2, fill, accent in boxes:
        draw.rounded_rectangle([x1, y1, x2, y2], radius=18, fill=fill, outline=(224, 226, 232), width=2)
        draw.rounded_rectangle([x1 + 24, y1 + 24, x1 + 32, y2 - 24], radius=4, fill=accent)
        # Abstract editorial content bars inside each tier
        bar_col = (225, 228, 235) if fill != (29, 29, 31) else (90, 92, 100)
        title_col = (40, 42, 48) if fill != (29, 29, 31) else (240, 242, 245)
        draw.rounded_rectangle([x1 + 52, y1 + 32, min(x2 - 48, x1 + 260), y1 + 50], radius=6, fill=title_col)
        draw.rounded_rectangle([x1 + 52, y1 + 66, x2 - 48, y1 + 80], radius=5, fill=bar_col)
        if y2 - y1 > 110:
            draw.rounded_rectangle([x1 + 52, y1 + 94, x2 - 120, y1 + 108], radius=5, fill=bar_col)
    im.save(path, format="PNG")


@app.post("/api/projects/demo")
def create_demo_project():
    """Create a zero-LLM 10-second showcase deck demonstrating provenance, Bento KPI, native table/chart, and image slides."""
    pid = f"demo-{uuid.uuid4().hex[:6]}"
    p_dir = _root() / pid
    assets_dir = p_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    demo_name = "示例：2026 Q1 产品增长与架构复盘"
    meta = {
        "project_id": pid,
        "name": demo_name,
        "theme_id": "keynote_light",
        "auto_named": False,
        "created_at": time.time(),
        "brand": {
            "footer_text": "Draftboard 示例文稿 · 所有数据可溯源至原始素材",
            "logo_position": "top_right",
        },
    }
    (p_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    # 1. Real traceable source note
    note_md = (
        "# 2026 Q1 季度业务与架构复盘纪要\n\n"
        "## 核心业务增长\n"
        "- Q1 年度经常性收入（ARR）达到 1.20 亿元，同比增长 +42%（去年 Q4 为 0.85 亿元）。\n"
        "- 企业客户净美元留存率（NDR）提升至 118%，较上季度提升 6 个百分点。\n"
        "- 综合毛利率稳定在 78%（Q4 为 76%），获客成本（CAC）同比下降 23%。\n"
        "- 近四个季度营收走势：Q2 62M、Q3 74M、Q4 85M、Q1 120M；毛利走势：46M、56M、65M、94M。\n\n"
        "## 技术架构升级\n"
        "- 完成核心网关与检索引擎异步化重构，平均响应耗时从 180ms 降至 45ms（降低 75%）。\n"
        "- 导出编译链路切换为纯内存矢量渲染，单份 15 页 PPTX + PDF 渲染耗时压缩至 0.4 秒以内。\n"
        "- 全链路可用性达到 99.96%，支撑 12 万日活工作台会话。\n\n"
        "## Q2 重点规划\n"
        "- 推出企业级品牌包与自定义版式复用库，覆盖 50 家头部种子客户。\n"
        "- 深化多维数据表与实时图表联动能力，缩短从原始财报到汇报成稿的时间。\n"
    )
    (assets_dir / "Q1复盘纪要.md").write_text(note_md, encoding="utf-8")
    _generate_demo_diagram(assets_dir / "架构演进示意.png")

    # Index materials & fragments via the real pipeline
    mat_out = _raw(tools_module.read_materials)(project_id=pid)
    md_sids = [f.source_id for f in mat_out.source_fragments if f.asset_id == "Q1复盘纪要"]
    img_sids = [f.source_id for f in mat_out.source_fragments if f.asset_id == "架构演进示意"]
    primary_sid = md_sids[0] if md_sids else ""
    img_sid = img_sids[0] if img_sids else ""

    outline = Outline(
        outline_version=f"v-{uuid.uuid4().hex[:8]}",
        project_id=pid,
        is_confirmed=False,
        items=[
            OutlineItem(
                outline_item_id="demo-s1",
                title="2026 Q1 产品增长与架构复盘",
                summary="营收加速突破 1.2 亿 · 核心链路耗时下降 75%",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=EvidenceStatus.SUPPORTED if primary_sid else EvidenceStatus.UNSUPPORTED,
                layout=SlideLayout.COVER,
                speaker_notes="欢迎各位参加 Q1 复盘会。今天用 5 分钟快速同步本季度的业务增长结果、架构提速成果以及 Q2 路线图。",
            ),
            OutlineItem(
                outline_item_id="demo-s2",
                title="核心增长指标：营收与留存双线突破",
                summary="ARR 达 1.20 亿（+42%），净留存 118%，综合毛利率 78%，获客成本下降 23%。",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=EvidenceStatus.SUPPORTED if primary_sid else EvidenceStatus.UNSUPPORTED,
                layout=SlideLayout.CONTENT,
                speaker_notes="这页采用自由画布 3 卡片指标布局，点击画布上任意卡片或数字都可以直接拖拽、缩放和修改字号配色。",
                custom_bg="theme:bg",
                custom_elements=[
                    CanvasElement(
                        id="s2_title",
                        kind="text",
                        x=48,
                        y=28,
                        w=864,
                        h=48,
                        text="核心增长指标：营收与留存双线突破",
                        font_size=28,
                        bold=True,
                        color="theme:title",
                    ),
                    CanvasElement(
                        id="s2_rule",
                        kind="line",
                        x=48,
                        y=84,
                        w=64,
                        h=0,
                        color="theme:accent",
                        line_width=3.0,
                    ),
                    CanvasElement(
                        id="s2_card_1",
                        kind="card",
                        x=48,
                        y=112,
                        w=274,
                        h=228,
                        fill="theme:surface",
                        border_color="theme:divider",
                        border_width=1.0,
                        radius=16,
                    ),
                    CanvasElement(
                        id="s2_kpi_1",
                        kind="text",
                        x=72,
                        y=140,
                        w=226,
                        h=64,
                        text="1.20 亿",
                        font_size=42,
                        bold=True,
                        color="theme:accent",
                    ),
                    CanvasElement(
                        id="s2_lbl_1",
                        kind="text",
                        x=72,
                        y=216,
                        w=226,
                        h=96,
                        text="Q1 年度经常性收入\n同比增长 +42%，较 Q4 净增 0.35 亿",
                        font_size=15,
                        color="theme:body",
                    ),
                    CanvasElement(
                        id="s2_card_2",
                        kind="card",
                        x=343,
                        y=112,
                        w=274,
                        h=228,
                        fill="theme:surface",
                        border_color="theme:divider",
                        border_width=1.0,
                        radius=16,
                    ),
                    CanvasElement(
                        id="s2_kpi_2",
                        kind="text",
                        x=367,
                        y=140,
                        w=226,
                        h=64,
                        text="118%",
                        font_size=42,
                        bold=True,
                        color="theme:title",
                    ),
                    CanvasElement(
                        id="s2_lbl_2",
                        kind="text",
                        x=367,
                        y=216,
                        w=226,
                        h=96,
                        text="企业客户净留存率\n环比提升 6 个百分点，续费稳健",
                        font_size=15,
                        color="theme:body",
                    ),
                    CanvasElement(
                        id="s2_card_3",
                        kind="card",
                        x=638,
                        y=112,
                        w=274,
                        h=228,
                        fill="theme:surface",
                        border_color="theme:divider",
                        border_width=1.0,
                        radius=16,
                    ),
                    CanvasElement(
                        id="s2_kpi_3",
                        kind="text",
                        x=662,
                        y=140,
                        w=226,
                        h=64,
                        text="-23%",
                        font_size=42,
                        bold=True,
                        color="theme:title",
                    ),
                    CanvasElement(
                        id="s2_lbl_3",
                        kind="text",
                        x=662,
                        y=216,
                        w=226,
                        h=96,
                        text="获客成本同比下降\n综合毛利率稳定维持在 78%",
                        font_size=15,
                        color="theme:body",
                    ),
                    CanvasElement(
                        id="s2_banner",
                        kind="card",
                        x=48,
                        y=364,
                        w=864,
                        h=112,
                        fill="theme:surface",
                        border_color="theme:divider",
                        border_width=1.0,
                        radius=14,
                    ),
                    CanvasElement(
                        id="s2_note",
                        kind="text",
                        x=72,
                        y=386,
                        w=816,
                        h=72,
                        text="核心结论：在获客成本持续优化的前提下，老客增购与高毛利订阅共同驱动 Q1 营收创历史新高。",
                        font_size=17,
                        bold=True,
                        color="theme:title",
                    ),
                ],
            ),
            OutlineItem(
                outline_item_id="demo-s3",
                title="季度财务对比与增长趋势",
                summary="近四个季度营收由 62M 攀升至 120M，毛利同步升至 94M。",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=EvidenceStatus.SUPPORTED if primary_sid else EvidenceStatus.UNSUPPORTED,
                layout=SlideLayout.CONTENT,
                speaker_notes="左侧为原生可编辑对比表格，右侧为原生数据图表；点击图表可在底部属性条一键切换柱状/条形/折线/环形图。",
                custom_bg="theme:bg",
                custom_elements=[
                    CanvasElement(
                        id="s3_title",
                        kind="text",
                        x=48,
                        y=28,
                        w=864,
                        h=48,
                        text="季度财务对比与增长趋势",
                        font_size=28,
                        bold=True,
                        color="theme:title",
                    ),
                    CanvasElement(
                        id="s3_rule",
                        kind="line",
                        x=48,
                        y=84,
                        w=64,
                        h=0,
                        color="theme:accent",
                        line_width=3.0,
                    ),
                    CanvasElement(
                        id="s3_tbl",
                        kind="table",
                        x=48,
                        y=116,
                        w=404,
                        h=260,
                        headers=["核心指标", "上季 Q4", "本季 Q1", "变化"],
                        rows=[
                            ["ARR（亿）", "0.85", "1.20", "+42%"],
                            ["净留存率", "112%", "118%", "+6%"],
                            ["综合毛利率", "76%", "78%", "+2%"],
                            ["平均响应", "180ms", "45ms", "-75%"],
                        ],
                        header_fill="theme:accent",
                        header_color="theme:cover_title",
                        table_font_size=13,
                    ),
                    CanvasElement(
                        id="s3_chart",
                        kind="chart",
                        x=476,
                        y=108,
                        w=436,
                        h=368,
                        chart_type="bar",
                        chart_title="近四季营收与毛利走势（百万）",
                        chart_categories=["Q2", "Q3", "Q4", "Q1"],
                        chart_series=[
                            ChartSeries(name="营收", values=[62, 74, 85, 120]),
                            ChartSeries(name="毛利", values=[46, 56, 65, 94]),
                        ],
                        show_values=True,
                        value_suffix="M",
                    ),
                ],
            ),
            OutlineItem(
                outline_item_id="demo-s4",
                title="核心架构升级与性能跃迁",
                summary=(
                    "核心网关与检索引擎完成异步重构，平均耗时由 180ms 降至 45ms。\n"
                    "导出编译链路全面切换为内存矢量渲染，15 页成品耗时低于 0.4 秒。\n"
                    "全链路可用性达 99.96%，平稳支撑 12 万日活工作台会话。"
                ),
                source_ids=[s for s in [primary_sid, img_sid] if s],
                evidence_status=EvidenceStatus.SUPPORTED if primary_sid else EvidenceStatus.UNSUPPORTED,
                layout=SlideLayout.TEXT_IMAGE,
                image_asset_id="架构演进示意",
                speaker_notes="技术侧三大突破：响应降 75%、渲染提速至亚秒级、可用性达四个九级别。",
            ),
            OutlineItem(
                outline_item_id="demo-s5",
                title="Q2 重点规划与感谢聆听",
                summary="聚焦企业品牌包与版式复用库落地 · 冲刺 50 家头部种子客户",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=EvidenceStatus.SUPPORTED if primary_sid else EvidenceStatus.UNSUPPORTED,
                layout=SlideLayout.CLOSING,
                speaker_notes="感谢大家聆听，欢迎进入 Q&A 环节。",
            ),
        ],
    )
    _storage(pid).save_outline(outline)
    return {"project_id": pid, "name": demo_name}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    _require_project(project_id)
    summary = _project_summary(project_id)
    reports = _export_reports(project_id)
    latest_success = _latest_success_report(project_id)
    art_meta = _latest_artifact_meta(project_id)
    meta_path = _root() / project_id / "meta.json"
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


@app.patch("/api/projects/{project_id}/brand")
def update_project_brand(project_id: str, req: user_library.BrandKit):
    """Save or clear per-project brand kit (accent, background, footer, corner logo)."""
    _require_project(project_id)
    try:
        cleaned = req.cleaned()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

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


@app.get("/api/projects/{project_id}/preflight")
def preflight_check(
    project_id: str,
    version: Optional[str] = None,
    theme_id: str = "keynote_light",
    auto_fit: bool = True,
):
    """Comprehensive pre-export readiness audit: layout safety, provenance, media, notes, rhythm."""
    _require_project(project_id)
    storage = _storage(project_id)
    summaries = _outline_summaries(project_id)
    if not summaries:
        raise HTTPException(400, "当前项目还没有大纲")
    target_ver = version or summaries[0]["outline_version"]
    outline = storage.load_outline(target_ver)
    assets_dir = storage.root / "assets"

    items = [tools_module.normalize_outline_item_text(it) for it in outline.items]
    total = len(items)
    findings: list[dict] = []

    # 1. Provenance & Notes & Media checks
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
                else ("cover" if idx == 0 else ("closing" if idx == total - 1 and total > 1 else "content"))
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

        if not is_custom:
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
        else:
            for cel in it.custom_elements or []:
                if cel.kind == "image":
                    img_ref = (cel.image_asset_id or "").strip()
                    if not img_ref or _resolve_image_path(img_ref, assets_dir) is None:
                        findings.append(
                            {
                                "slide_index": idx,
                                "slide_number": page_no,
                                "category": "media",
                                "severity": "error",
                                "message": f"第 {page_no} 页自由画布图片元素 '{cel.id}' 缺失素材文件。",
                            }
                        )

    # 2. Visual rhythm: 3+ consecutive identical non-custom layouts
    run_len = 1
    for i in range(1, len(eff_layouts)):
        if eff_layouts[i] == eff_layouts[i - 1] and eff_layouts[i] not in ("cover", "closing", "custom"):
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

    # 3. Deterministic font/box layout measurement via real exporter engine
    slides: list[Slide] = []
    for idx, it in enumerate(items):
        sid = f"slide-{idx + 1:03d}"
        layout = it.layout or (
            SlideLayout.COVER if idx == 0 else (SlideLayout.CLOSING if idx == total - 1 and total > 1 else SlideLayout.CONTENT)
        )
        els = [SlideElement(element_id=f"{sid}-title", type="title", content=it.title or "未命名")]
        if layout == SlideLayout.BULLETS:
            for bi, ln in enumerate([l for l in it.summary.splitlines() if l.strip()], start=1):
                els.append(SlideElement(element_id=f"{sid}-b{bi}", type="bullet", content=ln))
        elif layout == SlideLayout.TWO_COLUMN:
            els.append(SlideElement(element_id=f"{sid}-cl", type="column_left", content=it.summary))
            if it.column_right:
                els.append(SlideElement(element_id=f"{sid}-cr", type="column_right", content=it.column_right))
        elif layout == SlideLayout.COVER:
            els.append(SlideElement(element_id=f"{sid}-sub", type="subtitle", content=it.summary))
        elif layout == SlideLayout.CLOSING:
            els.append(SlideElement(element_id=f"{sid}-con", type="conclusion", content=it.summary))
        else:
            els.append(SlideElement(element_id=f"{sid}-txt", type="text", content=it.summary))
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
            probe_artifact, load_fonts(), auto_fit=auto_fit, decorative=theme.decorative
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

    # Compute a clean 0..100 readiness score
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
            400,
            "只支持上传 .md / .txt / .docx / .pdf / .csv / .xlsx / .pptx / .png / .jpg 文件",
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


class UrlMaterialRequest(BaseModel):
    url: str
    title: Optional[str] = None


@app.post("/api/projects/{project_id}/materials/url")
def import_url_material(project_id: str, req: UrlMaterialRequest):
    """Fetch a public web page and store readable Markdown text as a traceable project material."""
    _require_project(project_id)
    try:
        page_title, md_body = tools_module.extract_url_to_markdown(req.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"抓取网页失败：{exc}") from exc

    chosen_title = (req.title or "").strip() or page_title
    safe_stem = re.sub(r'[\\/:*?"<>|\s]+', "_", chosen_title).strip("_")[:36] or f"网页_{uuid.uuid4().hex[:6]}"
    assets_dir = _storage(project_id).root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    target = assets_dir / f"{safe_stem}.md"
    if target.exists():
        safe_stem = f"{safe_stem}_{uuid.uuid4().hex[:4]}"
        target = assets_dir / f"{safe_stem}.md"
    target.write_text(md_body, encoding="utf-8")

    output = _raw(tools_module.read_materials)(project_id=project_id)
    return {
        "asset_id": safe_stem,
        "title": chosen_title,
        "source_fragments": len(output.source_fragments),
        "preview": md_body[:240],
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
    is_default_outline_runner = (
        getattr(tasks.outline_via_agent, "__module__", "") == "draftboard.tasks"
    )
    if is_default_outline_runner and not llm_config.is_llm_configured():
        raise HTTPException(
            400,
            "LLM_NOT_CONFIGURED: 尚未配置大模型，请先点击右上角「模型设置」配置 API Key 或本地 Ollama。",
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
    custom_bg: Optional[str] = None
    custom_elements: Optional[list[CanvasElement]] = None


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


_SAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|\r\n\t]+')
_LAYOUT_LABELS_CN = {
    "cover": "封面",
    "content": "正文",
    "bullets": "分点",
    "two_column": "双栏",
    "text_image": "图文",
    "closing": "尾页",
}


def _safe_download_stem(project_id: str) -> str:
    """Resolve the project's human-readable name as a safe download filename stem."""
    meta_path = _root() / project_id / "meta.json"
    raw_name = ""
    if meta_path.exists():
        try:
            loaded = load_json(meta_path)
            if isinstance(loaded, dict):
                raw_name = str(loaded.get("name") or "").strip()
        except Exception:
            pass
    cleaned = _SAFE_FILENAME_RE.sub("_", raw_name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
    if len(cleaned) > 80:
        cleaned = cleaned[:80].rstrip(" ._-")
    return cleaned or project_id


def _content_disposition(filename: str) -> str:
    """Build an RFC 5987 UTF-8 Content-Disposition attachment header."""
    ascii_fallback = re.sub(r"[^\x20-\x7e]+", "_", filename).replace('"', "'").strip(" _")
    if not ascii_fallback or ascii_fallback.startswith("."):
        suffix = pathlib.Path(filename).suffix
        ascii_fallback = f"draftboard_export{suffix}"
    return f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(filename, safe="")}'


def _format_fragment_location_cn(location: str) -> str:
    loc = (location or "").strip()
    if not loc:
        return ""
    m = re.fullmatch(r"P(\d+)\s+L(\d+)-L(\d+)", loc, re.IGNORECASE)
    if m:
        return (
            f"第 {m.group(1)} 页 第 {m.group(2)} 行"
            if m.group(2) == m.group(3)
            else f"第 {m.group(1)} 页 第 {m.group(2)}–{m.group(3)} 行"
        )
    m = re.fullmatch(r"L(\d+)-L(\d+)", loc, re.IGNORECASE)
    if m:
        return (
            f"第 {m.group(1)} 行"
            if m.group(1) == m.group(2)
            else f"第 {m.group(1)}–{m.group(2)} 行"
        )
    m = re.fullmatch(r"L(\d+)", loc, re.IGNORECASE)
    if m:
        return f"第 {m.group(1)} 行"
    m = re.fullmatch(r"P(\d+)-P(\d+)", loc, re.IGNORECASE)
    if m:
        return (
            f"第 {m.group(1)} 页"
            if m.group(1) == m.group(2)
            else f"第 {m.group(1)}–{m.group(2)} 页"
        )
    m = re.fullmatch(r"P(\d+)", loc, re.IGNORECASE)
    if m:
        return f"第 {m.group(1)} 页"
    return loc


def _clean_excerpt_md(raw: str) -> str:
    lines: list[str] = []
    for line in (raw or "").splitlines():
        cleaned = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
        cleaned = re.sub(r"^\s*>\s?", "", cleaned)
        cleaned = re.sub(r"\*\*(.+?)\*\*", r"\1", cleaned)
        cleaned = re.sub(r"__(.+?)__", r"\1", cleaned)
        cleaned = cleaned.rstrip()
        if cleaned == "" and (not lines or lines[-1] == ""):
            continue
        lines.append(cleaned)
    return "\n".join(lines).strip()


def _resolve_fragment_excerpt(frag, materials_by_id: dict[str, object]) -> str:
    mat = materials_by_id.get(frag.asset_id)
    content = getattr(mat, "content", None) if mat is not None else None
    if content and getattr(mat, "asset_type", "") != "image":
        m = re.search(r"L(\d+)-L(\d+)$", frag.location or "")
        if m:
            start = max(0, int(m.group(1)) - 1)
            end = int(m.group(2))
            sliced = "\n".join(content.splitlines()[start:end]).strip()
            if sliced:
                return _clean_excerpt_md(sliced)
        if frag.content_preview:
            return _clean_excerpt_md(frag.content_preview)
        return _clean_excerpt_md(content[:360])
    return _clean_excerpt_md(frag.content_preview or "")


@app.get("/api/projects/{project_id}/download")
def download(project_id: str):
    _require_project(project_id)
    stem = _safe_download_stem(project_id)
    for report in reversed(_export_reports(project_id)):
        path = report.get("pptx_path")
        if report["success"] and path and pathlib.Path(path).exists():
            return FileResponse(
                path,
                media_type=(
                    "application/vnd.openxmlformats-officedocument."
                    "presentationml.presentation"
                ),
                filename=f"{stem}.pptx",
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
    stem = _safe_download_stem(project_id)
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{stem}.pdf",
    )


@app.get("/api/projects/{project_id}/download/images")
def download_images_zip(project_id: str):
    _require_project(project_id)
    report = _latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "没有可下载的高清图片：尚未成功导出过文件")
    pdir = _preview_dir(project_id, report)
    pages = sorted(pdir.glob("page-*.png")) if pdir.exists() else []
    if not pages:
        from draftboard.render import render_preview

        pages = render_preview(pathlib.Path(report["pptx_path"]), pdir)
    if not pages:
        raise HTTPException(500, "高清图片渲染未生成输出文件")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for idx, page_path in enumerate(pages, start=1):
            zf.write(page_path, arcname=f"slide-{idx:02d}.png")
    stem = _safe_download_stem(project_id)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": _content_disposition(f"{stem}_高清图片.zip"),
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/projects/{project_id}/download/notes")
def download_speaker_notes(project_id: str):
    _require_project(project_id)
    summary = _project_summary(project_id)
    outlines = _outline_summaries(project_id)
    if not outlines:
        raise HTTPException(404, "该项目尚未生成大纲，无法导出讲稿")

    art_meta = _latest_artifact_meta(project_id)
    exported_ver = art_meta.get("outline_version")
    target_ver = (
        exported_ver
        if exported_ver and any(o["outline_version"] == exported_ver for o in outlines)
        else max(outlines, key=lambda o: o["mtime"])["outline_version"]
    )
    outline_path = _root() / project_id / "outlines" / f"{target_ver}.json"
    outline_data = load_json(outline_path)
    items = outline_data.get("items", [])

    mat_output = _raw(tools_module.read_materials)(project_id=project_id)
    frags_by_id = {f.source_id: f for f in mat_output.source_fragments}
    mats_by_id = {m.asset_id: m for m in mat_output.materials}

    doc_name = summary["name"] or project_id
    lines: list[str] = [
        f"# {doc_name} — 演讲者讲稿与出处核查",
        "",
        f"- 共 {len(items)} 页",
        f"- 大纲版本：`{target_ver}`",
        "",
        "---",
        "",
    ]

    total = len(items)
    for idx, item in enumerate(items, start=1):
        raw_layout = item.get("layout")
        if raw_layout not in _LAYOUT_LABELS_CN:
            if idx == 1:
                raw_layout = "cover"
            elif idx == total and total > 1:
                raw_layout = "closing"
            else:
                raw_layout = "content"
        layout_label = _LAYOUT_LABELS_CN.get(raw_layout, "正文")
        title = (item.get("title") or "未命名页面").replace("\\n", " ").strip()
        summary_text = (
            (item.get("summary") or "")
            .replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .strip()
        )
        col_right = (
            (item.get("column_right") or "")
            .replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .strip()
        )
        image_id = (item.get("image_asset_id") or "").strip()
        notes = (
            (item.get("speaker_notes") or "")
            .replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .strip()
        )
        source_ids = [s for s in (item.get("source_ids") or []) if s]

        lines.append(f"## 第 {idx} 页：{title}（{layout_label}）")
        lines.append("")
        if summary_text:
            lines.append("**页面内容**")
            lines.append("")
            lines.append(summary_text)
            if raw_layout == "two_column" and col_right:
                lines.append("")
                lines.append("**右栏对比**")
                lines.append("")
                lines.append(col_right)
            if raw_layout == "text_image" and image_id:
                lines.append("")
                lines.append(f"配图：`{image_id}`")
            lines.append("")

        lines.append("**演讲者备注**")
        lines.append("")
        lines.append(notes if notes else "（本页未填写演讲者备注）")
        lines.append("")

        lines.append("**素材出处核查**")
        lines.append("")
        if source_ids:
            for sid in source_ids:
                frag = frags_by_id.get(sid)
                if frag:
                    loc = _format_fragment_location_cn(frag.location)
                    label = f"`{frag.asset_id}` {loc}".strip()
                    excerpt = _resolve_fragment_excerpt(frag, mats_by_id)
                    lines.append(f"- {label}")
                    if excerpt:
                        excerpt_one_line = " ".join(excerpt.splitlines()).strip()
                        if len(excerpt_one_line) > 180:
                            excerpt_one_line = excerpt_one_line[:180] + "…"
                        lines.append(f"  > {excerpt_one_line}")
                else:
                    lines.append(f"- `{sid}`")
        else:
            lines.append("- 待补充素材出处")
        lines.append("")
        if idx < total:
            lines.append("---")
            lines.append("")

    md_bytes = ("\n".join(lines).rstrip() + "\n").encode("utf-8")
    stem = _safe_download_stem(project_id)
    return Response(
        content=md_bytes,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": _content_disposition(f"{stem}_讲稿.md"),
            "Cache-Control": "no-store",
        },
    )


# ── Studio Agent Chat (SSE Streaming + Per-Project Persistence) ──────────────


class ChatMessageRequest(BaseModel):
    message: str
    selected_slide_index: int = 0
    theme_id: str = "keynote_light"
    auto_fit: bool = True
    replace_last_error: bool = False


@app.get("/api/projects/{project_id}/chat")
def get_chat_history(project_id: str):
    _require_project(project_id)
    return {
        "project_id": project_id,
        "messages": chat_agent.load_chat_history(project_id),
    }


@app.delete("/api/projects/{project_id}/chat")
def delete_chat_history(project_id: str):
    _require_project(project_id)
    chat_agent.clear_chat_history(project_id)
    return {"cleared": True}


@app.post("/api/projects/{project_id}/chat")
async def post_chat_message(project_id: str, req: ChatMessageRequest):
    _require_project(project_id)
    cleaned = (req.message or "").strip()
    if not cleaned:
        raise HTTPException(400, "对话内容不能为空")

    async def _event_stream():
        async for ev in chat_agent.stream_studio_chat(
            project_id,
            cleaned,
            selected_slide_index=req.selected_slide_index,
            theme_id=req.theme_id,
            auto_fit=req.auto_fit,
            replace_last_error=req.replace_last_error,
        ):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
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
def preview_image(project_id: str, name: str, download: bool = False):
    _require_project(project_id)
    if not re.fullmatch(r"page-\d+\.png", name):
        raise HTTPException(400, "非法的预览图片名")
    report = _latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出")
    path = _preview_dir(project_id, report) / name
    if not path.exists():
        raise HTTPException(404, "预览图片不存在")
    if download:
        page_num = int(re.search(r"\d+", name).group(0))
        stem = _safe_download_stem(project_id)
        return FileResponse(
            path,
            media_type="image/png",
            filename=f"{stem}_第{page_num}页.png",
            headers={"Cache-Control": "no-store"},
        )
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