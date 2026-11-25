"""Material upload, URL import, deletion, and image asset serving routes."""

from __future__ import annotations

import json
import pathlib
import re
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import draftboard.tools as tools_module
from draftboard.models import EvidenceStatus, SlideLayout
from draftboard.pptx_export import _resolve_image_path
from draftboard.routes.common import get_root, get_storage, require_project, unwrap_tool
from draftboard.storage import load_json

router = APIRouter()

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


class UrlMaterialRequest(BaseModel):
    url: str
    title: Optional[str] = None


@router.post("/api/projects/{project_id}/materials")
async def upload_material(project_id: str, file: UploadFile):
    require_project(project_id)
    name = pathlib.Path(file.filename or "").name
    suffix = pathlib.Path(name).suffix.lower()
    if not name or suffix not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            "只支持上传 .md / .txt / .docx / .pdf / .csv / .xlsx / .pptx / .png / .jpg 文件",
        )
    assets_dir = get_storage(project_id).root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    (assets_dir / name).write_bytes(content)
    try:
        output = unwrap_tool(tools_module.read_materials)(project_id=project_id)
    except ValueError as exc:
        (assets_dir / name).unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc
    return {
        "asset_id": pathlib.Path(name).stem,
        "source_fragments": len(output.source_fragments),
    }


@router.post("/api/projects/{project_id}/materials/url")
def import_url_material(project_id: str, req: UrlMaterialRequest):
    """Fetch a public web page and store readable Markdown text as a traceable project material."""
    require_project(project_id)
    try:
        page_title, md_body = tools_module.extract_url_to_markdown(req.url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(400, f"抓取网页失败：{exc}") from exc

    chosen_title = (req.title or "").strip() or page_title
    safe_stem = (
        re.sub(r'[\\/:*?"<>|\s]+', "_", chosen_title).strip("_")[:36]
        or f"网页_{uuid.uuid4().hex[:6]}"
    )
    assets_dir = get_storage(project_id).root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    target = assets_dir / f"{safe_stem}.md"
    if target.exists():
        safe_stem = f"{safe_stem}_{uuid.uuid4().hex[:4]}"
        target = assets_dir / f"{safe_stem}.md"
    target.write_text(md_body, encoding="utf-8")

    output = unwrap_tool(tools_module.read_materials)(project_id=project_id)
    return {
        "asset_id": safe_stem,
        "title": chosen_title,
        "source_fragments": len(output.source_fragments),
        "preview": md_body[:240],
    }


@router.delete("/api/projects/{project_id}/materials/{asset_id}")
def delete_material(project_id: str, asset_id: str):
    require_project(project_id)
    assets_dir = get_storage(project_id).root / "assets"
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

    output = unwrap_tool(tools_module.read_materials)(project_id=project_id)
    remaining_sids = {frag.source_id for frag in output.source_fragments}

    # Clean up dangling references in unconfirmed draft outlines
    storage = get_storage(project_id)
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
                    if item.custom_elements:
                        kept_els = [
                            el
                            for el in item.custom_elements
                            if not (
                                el.kind == "image" and el.image_asset_id == asset_id
                            )
                        ]
                        if len(kept_els) != len(item.custom_elements):
                            item.custom_elements = kept_els or None
                            if not kept_els:
                                item.custom_bg = None
                            changed = True
                if changed:
                    storage.save_outline(outline)
            except Exception:
                pass

    # Clean up dangling brand corner logo reference if it pointed to the deleted image
    meta_path = storage.root / "meta.json"
    if meta_path.exists():
        try:
            loaded_meta = load_json(meta_path)
            if (
                isinstance(loaded_meta, dict)
                and isinstance(loaded_meta.get("brand"), dict)
                and loaded_meta["brand"].get("logo_asset_id") == asset_id
            ):
                loaded_meta["brand"]["logo_asset_id"] = None
                if not any(
                    loaded_meta["brand"].get(k)
                    for k in ("accent_hex", "bg_hex", "footer_text", "logo_asset_id")
                ):
                    loaded_meta.pop("brand", None)
                meta_path.write_text(
                    json.dumps(loaded_meta, ensure_ascii=False), encoding="utf-8"
                )
        except Exception:
            pass

    return {
        "deleted": asset_id,
        "remaining_materials": len(output.materials),
        "source_fragments": len(output.source_fragments),
    }


@router.get("/api/projects/{project_id}/materials")
def read_materials(project_id: str):
    require_project(project_id)
    return unwrap_tool(tools_module.read_materials)(project_id=project_id).model_dump()


@router.get("/api/projects/{project_id}/assets/{asset_ref}")
def get_image_asset(project_id: str, asset_ref: str):
    require_project(project_id)
    assets_dir = get_root() / project_id / "assets"
    path = _resolve_image_path(asset_ref, assets_dir)
    if path is None:
        raise HTTPException(404, f"图片素材 '{asset_ref}' 不存在")
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(path, media_type=media_type)
