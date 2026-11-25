"""Single-port Next.js static export hosting routes (registered last)."""

from __future__ import annotations

import pathlib

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from draftboard.routes.common import PROJECT_ID_RE

router = APIRouter()

_PKG_DIR = pathlib.Path(__file__).resolve().parent.parent
_STATIC_DIR = _PKG_DIR / "static"
_PARENTS = _PKG_DIR.parents
_FRONTEND_OUT_DIR = (
    _PARENTS[2] / "frontend" / "out" if len(_PARENTS) > 2 else None
)


def _web_dir() -> pathlib.Path:
    if _FRONTEND_OUT_DIR and (_FRONTEND_OUT_DIR / "index.html").exists():
        return _FRONTEND_OUT_DIR
    return _STATIC_DIR


@router.api_route("/", methods=["GET", "HEAD"])
def index():
    return FileResponse(
        _web_dir() / "index.html",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/_next/{subpath:path}")
def next_static_assets(subpath: str):
    web_root = _web_dir().resolve()
    target = (web_root / "_next" / subpath).resolve()
    if not target.is_relative_to(web_root) or not target.is_file():
        raise HTTPException(404, "静态资源不存在")
    return FileResponse(target)


@router.get("/providers/{subpath:path}")
def provider_icon_assets(subpath: str):
    web_root = _web_dir().resolve()
    providers_root = (web_root / "providers").resolve()
    target = (providers_root / subpath).resolve()
    if not target.is_relative_to(providers_root) or not target.is_file():
        raise HTTPException(404, "图标资源不存在")
    return FileResponse(target)


@router.api_route("/p/{rest_of_path:path}", methods=["GET", "HEAD"])
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

    if not PROJECT_ID_RE.fullmatch(pid):
        raise HTTPException(404, "非法的项目路径")

    if not template_path.is_file():
        fallback = web_root / "index.html"
        if fallback.is_file():
            return FileResponse(fallback)
        raise HTTPException(404, "前端页面尚未构建")

    body = template_path.read_text(encoding="utf-8").replace(
        "__placeholder__", pid
    )
    return Response(
        content=body,
        media_type=media_type,
        headers={"Cache-Control": "no-cache"},
    )


@router.api_route("/{filename}", methods=["GET", "HEAD"])
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
