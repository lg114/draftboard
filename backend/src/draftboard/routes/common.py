"""Shared helpers and project metadata utilities for Draftboard HTTP routes."""

from __future__ import annotations

import pathlib
import re
import sys
from typing import Optional

from fastapi import HTTPException

import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.storage import ProjectStorage, load_json
from draftboard.themes import is_valid_theme, resolve_theme_id

PROJECT_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
DEFAULT_UNTITLED_NAME = "未命名文稿"
_SAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|\r\n\t]+')


def get_root() -> pathlib.Path:
    """Resolve active project storage root, honoring test monkeypatches."""
    if tools_module._storage_root is not None:
        return tools_module._storage_root
    api_mod = sys.modules.get("draftboard.api")
    if api_mod is not None:
        api_root = getattr(api_mod, "STORAGE_ROOT", None)
        if api_root is not None:
            return api_root
    return storage_module.STORAGE_ROOT


def get_storage(project_id: str) -> ProjectStorage:
    return ProjectStorage(project_id, storage_root=get_root())


def require_project(project_id: str) -> None:
    if not (get_root() / project_id).is_dir():
        raise HTTPException(404, f"项目 '{project_id}' 不存在")


def unwrap_tool(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


def outline_summaries(project_id: str) -> list[dict]:
    outlines_dir = get_root() / project_id / "outlines"
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


def export_reports(project_id: str) -> list[dict]:
    exports_dir = get_root() / project_id / "exports"
    if not exports_dir.exists():
        return []
    reports = []
    for path in exports_dir.glob("*.report.json"):
        data = load_json(path)
        data["_mtime"] = path.stat().st_mtime
        reports.append(data)
    return sorted(reports, key=lambda r: r["_mtime"])


def latest_success_report(project_id: str) -> Optional[dict]:
    for report in reversed(export_reports(project_id)):
        path = report.get("pptx_path")
        if report["success"] and path and pathlib.Path(path).exists():
            return report
    return None


def latest_artifact_meta(project_id: str) -> dict:
    success_report = latest_success_report(project_id)
    if success_report:
        art_path = (
            get_root()
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


def export_identity(project_id: str) -> dict:
    """Fingerprint of the newest successful PPTX. Legacy files stay downloadable."""
    report = latest_success_report(project_id)
    if not report:
        return {
            "export_fingerprint": None,
            "export_legacy": False,
            "export_artifact_id": None,
        }
    try:
        artifact = get_storage(project_id).load_artifact(
            report["artifact_id"], report["artifact_revision"]
        )
    except KeyError:
        return {
            "export_fingerprint": None,
            "export_legacy": False,
            "export_artifact_id": None,
        }
    fingerprint = artifact.input_fingerprint
    return {
        "export_fingerprint": fingerprint,
        "export_legacy": fingerprint is None,
        "export_artifact_id": artifact.artifact_id,
    }


def preview_dir(project_id: str, report: dict) -> pathlib.Path:
    return (
        get_root()
        / project_id
        / "previews"
        / f"{report['artifact_id']}-r{report['artifact_revision']}"
    )


def safe_download_stem(project_id: str) -> str:
    """Resolve the project's human-readable name as a safe download filename stem."""
    meta_path = get_root() / project_id / "meta.json"
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


def project_summary(pid: str) -> dict:
    p_dir = get_root() / pid
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

    outlines = outline_summaries(pid)
    reports = export_reports(pid)
    latest_report = reports[-1] if reports else None
    latest_success = latest_success_report(pid)
    art_meta = latest_artifact_meta(pid)

    raw_theme = meta.get("theme_id") or art_meta.get("template_id") or "keynote_light"
    if raw_theme == "default" or not is_valid_theme(raw_theme):
        theme_id = "keynote_light"
    else:
        theme_id = resolve_theme_id(raw_theme)

    assets_dir = p_dir / "assets"
    asset_files = (
        sorted(
            [f for f in assets_dir.glob("*") if f.is_file()],
            key=lambda f: f.name.lower(),
        )
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
            outline_data = load_json(
                p_dir / "outlines" / f"{latest_outline_version}.json"
            )
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
                    "summary": (first.get("summary") or "")
                    .replace("\\r\\n", "\n")
                    .replace("\\n", "\n")
                    .strip(),
                    "layout": first.get("layout"),
                    "column_right": (
                        first["column_right"]
                        .replace("\\r\\n", "\n")
                        .replace("\\n", "\n")
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
        theme_in_sync = (not exported_theme) or (
            resolve_theme_id(exported_theme) == theme_id
        )
        outline_in_sync = (not latest_outline_version) or (
            exported_outline == latest_outline_version
        )
        if theme_in_sync and outline_in_sync:
            pdir = preview_dir(pid, latest_success)
            pages = sorted(pdir.glob("page-*.png")) if pdir.exists() else []
            if pages:
                cache_tag = f"{latest_success['artifact_id']}-r{latest_success['artifact_revision']}"
                preview_cover_url = (
                    f"/api/projects/{pid}/preview/{pages[0].name}?v={cache_tag}"
                )

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
