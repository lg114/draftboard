"""Tests for enhanced export capabilities:
- PPTX & PDF metadata + PDF outline bookmarks (TOC)
- Real project name filenames across PPTX, PDF, PNG ZIP, Markdown notes, single PNG
- Per-page HD PNG ZIP archive download
- Speaker notes + provenance audit Markdown download
"""

import io
import time
import zipfile
from urllib.parse import unquote

import pypdfium2 as pdfium
import pytest
from fastapi.testclient import TestClient
from pptx import Presentation

import draftboard.api as api
import draftboard.storage as storage_module
import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.models import EvidenceStatus, OutlineItem


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


def _fake_outline_with_notes(project_id):
    output = _raw(tools_module.read_materials)(project_id=project_id)
    source_id = output.source_fragments[0].source_id
    items = [
        OutlineItem(
            outline_item_id="item-1",
            title="2026 年度技术复盘",
            summary="平台稳定性与成本效率双提升",
            source_ids=[source_id],
            evidence_status=EvidenceStatus.SUPPORTED,
            speaker_notes="开场先交代今年核心目标与三大突破。",
        ),
        OutlineItem(
            outline_item_id="item-2",
            title="核心成果与下阶段规划",
            summary="接口延迟降低 40%，自动化率达 92%。",
            source_ids=[source_id],
            evidence_status=EvidenceStatus.SUPPORTED,
            speaker_notes="重点强调延迟下降来自缓存架构改造。",
        ),
    ]
    _raw(tools_module.propose_outline)(
        project_id=project_id, material_snapshot_id="snap-export", items=items
    )


@pytest.fixture
def client(tmp_path, monkeypatch, font_files):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    monkeypatch.setattr(tasks, "outline_via_agent", _fake_outline_with_notes)
    with TestClient(api.app) as c:
        yield c


def _wait_task(client: TestClient, pid: str, task_id: str, timeout: float = 15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/projects/{pid}/tasks/{task_id}")
        assert r.status_code == 200
        body = r.json()
        if body["status"] in ("succeeded", "failed"):
            return body
        time.sleep(0.05)
    raise TimeoutError(f"Task {task_id} did not finish")


def _setup_exported_project(client: TestClient) -> str:
    pid = "deck-export-01"
    r = client.post(
        "/api/projects",
        json={"project_id": pid, "name": "2026 年度技术复盘"},
    )
    assert r.status_code == 200

    mat_text = "# 年度技术复盘\n\n接口延迟降低 40%，自动化率达 92%。\n"
    r = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("review_brief.md", mat_text.encode("utf-8"), "text/markdown")},
    )
    assert r.status_code == 200

    t_out = client.post(f"/api/projects/{pid}/outline/generate")
    assert t_out.status_code in (200, 202)
    done_out = _wait_task(client, pid, t_out.json()["task_id"])
    assert done_out["status"] == "succeeded"
    ver = done_out["result"]["outline_version"]

    r = client.post(f"/api/projects/{pid}/outlines/{ver}/confirm")
    assert r.status_code == 200

    t_gen = client.post(
        f"/api/projects/{pid}/generate",
        json={"outline_version": ver, "template_id": "keynote_light", "auto_fit": True},
    )
    assert t_gen.status_code in (200, 202)
    done_gen = _wait_task(client, pid, t_gen.json()["task_id"])
    assert done_gen["status"] == "succeeded"
    return pid


def test_export_filenames_metadata_bookmarks_zip_and_notes(client: TestClient):
    pid = _setup_exported_project(client)

    # 1. PPTX download uses real project name & embeds core properties
    r_pptx = client.get(f"/api/projects/{pid}/download")
    assert r_pptx.status_code == 200
    cd_pptx = unquote(r_pptx.headers["content-disposition"])
    assert "2026 年度技术复盘.pptx" in cd_pptx
    prs = Presentation(io.BytesIO(r_pptx.content))
    assert prs.core_properties.author == "Draftboard"
    assert prs.core_properties.title == "2026 年度技术复盘"

    # 2. PDF download uses real project name & contains outline bookmarks
    r_pdf = client.get(f"/api/projects/{pid}/download/pdf")
    assert r_pdf.status_code == 200
    cd_pdf = unquote(r_pdf.headers["content-disposition"])
    assert "2026 年度技术复盘.pdf" in cd_pdf
    with pdfium.PdfDocument(r_pdf.content) as pdf:
        assert len(pdf) == 2
        toc = list(pdf.get_toc())
        assert len(toc) == 2
        toc_titles = [
            b.get_title() if callable(getattr(b, "get_title", None)) else getattr(b, "title", "")
            for b in toc
        ]
        assert "2026 年度技术复盘" in toc_titles[0]
        assert "核心成果与下阶段规划" in toc_titles[1]

    # 3. Images ZIP archive download contains crisp per-page PNGs
    r_zip = client.get(f"/api/projects/{pid}/download/images")
    assert r_zip.status_code == 200
    assert r_zip.headers["content-type"] == "application/zip"
    cd_zip = unquote(r_zip.headers["content-disposition"])
    assert "2026 年度技术复盘_高清图片.zip" in cd_zip
    with zipfile.ZipFile(io.BytesIO(r_zip.content)) as zf:
        names = zf.namelist()
        assert names == ["slide-01.png", "slide-02.png"]
        for name in names:
            assert zf.read(name).startswith(b"\x89PNG\r\n\x1a\n")

    # 4. Single-page PNG download via ?download=1 uses real project name
    r_single = client.get(f"/api/projects/{pid}/preview/page-001.png?download=1")
    assert r_single.status_code == 200
    cd_single = unquote(r_single.headers["content-disposition"])
    assert "2026 年度技术复盘_第1页.png" in cd_single
    assert r_single.content.startswith(b"\x89PNG\r\n\x1a\n")

    # 5. Speaker notes + provenance Markdown export
    r_md = client.get(f"/api/projects/{pid}/download/notes")
    assert r_md.status_code == 200
    assert "text/markdown" in r_md.headers["content-type"]
    cd_md = unquote(r_md.headers["content-disposition"])
    assert "2026 年度技术复盘_讲稿.md" in cd_md
    md_text = r_md.content.decode("utf-8")
    assert "# 2026 年度技术复盘 — 演讲者讲稿与出处核查" in md_text
    assert "## 第 1 页：2026 年度技术复盘（封面）" in md_text
    assert "开场先交代今年核心目标与三大突破。" in md_text
    assert "重点强调延迟下降来自缓存架构改造。" in md_text
    assert "`review_brief`" in md_text
    assert "接口延迟降低 40%" in md_text
