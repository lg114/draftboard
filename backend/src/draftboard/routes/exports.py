"""Deck generation, background task status, multi-format downloads, and page preview routes."""

from __future__ import annotations

import io
import pathlib
import re
import zipfile
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.routes.common import (
    export_reports,
    get_root,
    get_storage,
    latest_success_report,
    outline_summaries,
    preview_dir,
    project_summary,
    require_project,
    safe_download_stem,
    unwrap_tool,
)
from draftboard.storage import load_json
from draftboard.themes import is_valid_theme, resolve_theme_id

router = APIRouter()

_LAYOUT_LABELS_CN = {
    "cover": "封面",
    "content": "正文",
    "bullets": "分点",
    "two_column": "双栏",
    "text_image": "图文",
    "closing": "尾页",
}


class GenerateRequest(BaseModel):
    outline_version: str
    template_id: str = "default"
    auto_fit: bool = False


def _content_disposition(filename: str) -> str:
    """Build an RFC 5987 UTF-8 Content-Disposition attachment header."""
    ascii_fallback = (
        re.sub(r"[^\x20-\x7e]+", "_", filename).replace('"', "'").strip(" _")
    )
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


@router.post("/api/projects/{project_id}/generate", status_code=202)
def generate(project_id: str, req: GenerateRequest):
    require_project(project_id)
    if not is_valid_theme(req.template_id):
        raise HTTPException(400, f"未知主题 '{req.template_id}'")
    resolved_theme = resolve_theme_id(req.template_id)
    storage = get_storage(project_id)
    outline = storage.load_outline(req.outline_version)
    if not outline.is_confirmed:
        raise HTTPException(
            400,
            f"大纲 '{req.outline_version}' 尚未确认，请先确认大纲后再生成 PPT",
        )
    record = tasks.submit(
        get_root(),
        project_id,
        "generate",
        tasks.generate_work(
            get_root(),
            project_id,
            req.outline_version,
            template_id=resolved_theme,
            auto_fit=req.auto_fit,
        ),
    )
    return record.model_dump()


@router.get("/api/projects/{project_id}/tasks")
def list_tasks(project_id: str):
    require_project(project_id)
    return {
        "tasks": [t.model_dump() for t in tasks.list_tasks(get_root(), project_id)]
    }


@router.get("/api/projects/{project_id}/tasks/{task_id}")
def get_task(project_id: str, task_id: str):
    require_project(project_id)
    return tasks.load_task(get_root(), project_id, task_id).model_dump()


@router.get("/api/projects/{project_id}/result")
def latest_result(project_id: str):
    require_project(project_id)
    reports = export_reports(project_id)
    if not reports:
        raise HTTPException(404, "该项目还没有导出结果")
    return reports[-1]


@router.get("/api/projects/{project_id}/download")
def download(project_id: str):
    require_project(project_id)
    stem = safe_download_stem(project_id)
    for report in reversed(export_reports(project_id)):
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


@router.get("/api/projects/{project_id}/download/pdf")
def download_pdf(project_id: str):
    require_project(project_id)
    report = latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "没有可下载的 PDF：尚未成功导出过文件")
    pdir = preview_dir(project_id, report)
    pdf_path = pdir / "deck.pdf"
    if not pdf_path.exists():
        from draftboard.render import render_preview

        render_preview(pathlib.Path(report["pptx_path"]), pdir)
    if not pdf_path.exists():
        raise HTTPException(500, "PDF 渲染未生成输出文件")
    stem = safe_download_stem(project_id)
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{stem}.pdf",
    )


@router.get("/api/projects/{project_id}/download/images")
def download_images_zip(project_id: str):
    require_project(project_id)
    report = latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "没有可下载的高清图片：尚未成功导出过文件")
    pdir = preview_dir(project_id, report)
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
    stem = safe_download_stem(project_id)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": _content_disposition(f"{stem}_高清图片.zip"),
            "Cache-Control": "no-store",
        },
    )


@router.get("/api/projects/{project_id}/download/notes")
def download_speaker_notes(project_id: str, version: Optional[str] = None):
    require_project(project_id)
    summary = project_summary(project_id)
    outlines = outline_summaries(project_id)
    if not outlines:
        raise HTTPException(404, "该项目尚未生成大纲，无法导出讲稿")

    if version and any(o["outline_version"] == version for o in outlines):
        target_ver = version
    else:
        target_ver = max(outlines, key=lambda o: o["mtime"])["outline_version"]
    outline_path = get_root() / project_id / "outlines" / f"{target_ver}.json"
    outline_data = load_json(outline_path)
    items = outline_data.get("items", [])

    mat_output = unwrap_tool(tools_module.read_materials)(project_id=project_id)
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
        custom_els = item.get("custom_elements") or []
        is_custom = isinstance(custom_els, list) and len(custom_els) > 0
        raw_layout = item.get("layout")
        if raw_layout not in _LAYOUT_LABELS_CN:
            if idx == 1:
                raw_layout = "cover"
            elif idx == total and total > 1:
                raw_layout = "closing"
            else:
                raw_layout = "content"
        layout_label = (
            "自由画布" if is_custom else _LAYOUT_LABELS_CN.get(raw_layout, "正文")
        )
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
        if is_custom:
            custom_blocks: list[str] = []
            for el in custom_els:
                if not isinstance(el, dict):
                    continue
                kind = el.get("kind")
                if kind == "text":
                    txt = (
                        (el.get("text") or "")
                        .replace("\\r\\n", "\n")
                        .replace("\\n", "\n")
                        .strip()
                    )
                    if txt and txt != title:
                        custom_blocks.append(txt)
                elif kind == "table":
                    headers = [
                        str(h).replace("|", "\\|").strip()
                        for h in (el.get("headers") or [])
                    ]
                    rows = el.get("rows") or []
                    if headers:
                        tbl_lines = [
                            "| " + " | ".join(headers) + " |",
                            "| " + " | ".join(["---"] * len(headers)) + " |",
                        ]
                        for row in rows:
                            cells = [
                                str(row[ci] if ci < len(row) else "")
                                .replace("|", "\\|")
                                .strip()
                                for ci in range(len(headers))
                            ]
                            tbl_lines.append("| " + " | ".join(cells) + " |")
                        custom_blocks.append("\n".join(tbl_lines))
                elif kind == "chart":
                    ctitle = (el.get("chart_title") or "数据图表").strip()
                    cats = el.get("chart_categories") or []
                    series = el.get("chart_series") or []
                    suffix = (el.get("value_suffix") or "").strip()
                    if cats and series:
                        c_lines = [f"- 图表「{ctitle}」："]
                        for s in series:
                            sname = str(s.get("name") or "数据").strip()
                            vals = s.get("values") or []
                            pairs = [
                                f"{cats[ci]}={vals[ci]}{suffix}"
                                for ci in range(min(len(cats), len(vals)))
                            ]
                            if pairs:
                                c_lines.append(f"  - {sname}：" + "，".join(pairs))
                        custom_blocks.append("\n".join(c_lines))
                elif kind == "diagram":
                    dtype = el.get("diagram_type") or "timeline"
                    steps = el.get("diagram_steps") or []
                    if steps:
                        heading = "时间轴" if dtype == "timeline" else "流程步骤"
                        d_lines = [f"- {heading}："]
                        for si, st in enumerate(steps, start=1):
                            if not isinstance(st, dict):
                                continue
                            lbl = str(st.get("label") or f"{si:02d}").strip()
                            stitle = str(st.get("title") or "").strip()
                            sdesc = str(st.get("desc") or "").strip()
                            if stitle:
                                item_line = f"  - **{lbl} · {stitle}**"
                                if sdesc:
                                    item_line += f"：{sdesc}"
                                d_lines.append(item_line)
                        if len(d_lines) > 1:
                            custom_blocks.append("\n".join(d_lines))
                elif kind == "image":
                    cimg = (el.get("image_asset_id") or "").strip()
                    if cimg:
                        custom_blocks.append(f"配图：`{cimg}`")
            if custom_blocks:
                lines.append("**页面内容**")
                lines.append("")
                lines.append("\n\n".join(custom_blocks))
                lines.append("")
            elif summary_text:
                lines.append("**页面内容**")
                lines.append("")
                lines.append(summary_text)
                lines.append("")
        elif summary_text:
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
    stem = safe_download_stem(project_id)
    return Response(
        content=md_bytes,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": _content_disposition(f"{stem}_讲稿.md"),
            "Cache-Control": "no-store",
        },
    )


@router.get("/api/projects/{project_id}/preview")
def get_preview(project_id: str):
    require_project(project_id)
    report = latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出，没有可预览的内容")
    pages = sorted(preview_dir(project_id, report).glob("page-*.png"))
    if not pages:
        raise HTTPException(404, "预览尚未渲染，可调用 POST preview/render 重新渲染")
    return _preview_payload(project_id, report, pages)


@router.post("/api/projects/{project_id}/preview/render")
@router.post("/api/projects/{project_id}/render-preview")
def render_preview_now(project_id: str):
    require_project(project_id)
    from draftboard.render import render_preview

    report = latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出，没有可渲染的内容")
    pages = render_preview(
        pathlib.Path(report["pptx_path"]), preview_dir(project_id, report)
    )
    return _preview_payload(project_id, report, pages)


@router.get("/api/projects/{project_id}/preview/{name}")
def preview_image(project_id: str, name: str, download: bool = False):
    require_project(project_id)
    if not re.fullmatch(r"page-\d+\.png", name):
        raise HTTPException(400, "非法的预览图片名")
    report = latest_success_report(project_id)
    if not report:
        raise HTTPException(404, "尚未成功导出")
    path = preview_dir(project_id, report) / name
    if not path.exists():
        raise HTTPException(404, "预览图片不存在")
    if download:
        page_num = int(re.search(r"\d+", name).group(0))
        stem = safe_download_stem(project_id)
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
