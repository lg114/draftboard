"""Offline end-to-end tests for Workbench Pillars 3-6:
- .csv / .xlsx / .pptx material ingestion & web URL HTML-to-Markdown extraction + SSRF guard
- 10-second interactive Demo Project creation, Pre-Flight Deck Audit, and native PPTX export
- Brand Kit (custom accent, background, footer text, corner logo) persisted & exported to PPTX
- Reusable Saved Custom Layouts CRUD
"""

from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pptx import Presentation
from pptx.util import Pt

import draftboard.api as api_module
import draftboard.storage as storage_module
import draftboard.tools as tools_module
import draftboard.user_library as user_library


@pytest.fixture
def env(tmp_path, monkeypatch, font_files):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    monkeypatch.setattr(api_module, "STORAGE_ROOT", tmp_path)
    monkeypatch.setattr(user_library, "_SAVED_LAYOUTS_PATH", tmp_path / "saved_layouts.json")
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    return tmp_path


@pytest.fixture
def client(env):
    with TestClient(api_module.app) as c:
        yield c


def _make_minimal_xlsx_bytes() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "xl/sharedStrings.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<si><t>季度</t></si><si><t>营收</t></si><si><t>Q1</t></si>"
            "</sst>",
        )
        zf.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="财务汇总" sheetId="1" r:id="rId1"/></sheets>'
            "</workbook>",
        )
        zf.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "xl/worksheets/sheet1.xml",
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            "<sheetData>"
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120</v></c></row>'
            "</sheetData></worksheet>",
        )
    return buf.getvalue()


def _make_minimal_pptx_bytes() -> bytes:
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[6])
    tb = s1.shapes.add_textbox(Pt(40), Pt(40), Pt(400), Pt(60))
    tb.text_frame.text = "2025 年度复盘"
    tbl = s1.shapes.add_table(2, 2, Pt(40), Pt(120), Pt(300), Pt(80)).table
    tbl.cell(0, 0).text = "区域"
    tbl.cell(0, 1).text = "增长"
    tbl.cell(1, 0).text = "华东"
    tbl.cell(1, 1).text = "+35%"
    s1.notes_slide.notes_text_frame.text = "华东表现超出预期。"
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def test_csv_xlsx_pptx_material_ingestion(client):
    pid = client.post("/api/projects", json={"name": "多格式导入测试"}).json()["project_id"]

    # 1. CSV
    csv_bytes = "指标,Q4,Q1\nARR,85,120\n留存,112%,118%\n".encode("utf-8-sig")
    r_csv = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("metrics.csv", csv_bytes, "text/csv")},
    )
    assert r_csv.status_code == 200

    # 2. XLSX
    r_xlsx = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("finance.xlsx", _make_minimal_xlsx_bytes(), "application/octet-stream")},
    )
    assert r_xlsx.status_code == 200

    # 3. PPTX
    r_pptx = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("old_deck.pptx", _make_minimal_pptx_bytes(), "application/octet-stream")},
    )
    assert r_pptx.status_code == 200

    mats = client.get(f"/api/projects/{pid}/materials").json()
    by_id = {m["asset_id"]: m["content"] for m in mats["materials"]}
    assert "| ARR | 85 | 120 |" in by_id["metrics"]
    assert "## 财务汇总" in by_id["finance"] and "| Q1 | 120 |" in by_id["finance"]
    assert "2025 年度复盘" in by_id["old_deck"]
    assert "| 华东 | +35% |" in by_id["old_deck"]
    assert "华东表现超出预期" in by_id["old_deck"]
    assert any(f["source_id"] == "old_deck-S1" for f in mats["source_fragments"])


def test_url_material_import_and_ssrf_guard(client, monkeypatch):
    pid = client.post("/api/projects", json={"name": "网页导入测试"}).json()["project_id"]

    # SSRF guard blocks localhost & non-http schemes
    assert (
        client.post(
            f"/api/projects/{pid}/materials/url",
            json={"url": "http://127.0.0.1:8000/secret"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/projects/{pid}/materials/url",
            json={"url": "file:///etc/passwd"},
        ).status_code
        == 400
    )

    # HTML parser strips script/nav cleanly
    parser = tools_module._ReadableHTMLParser()
    parser.feed(
        "<html><head><title>Q1 行业报告</title><style>body{}</style></head>"
        "<body><nav>导航忽略</nav><script>alert(1)</script>"
        "<h1>核心结论</h1><p>市场规模增长 30%。</p><ul><li>AI 工作台渗透率翻倍</li></ul></body></html>"
    )
    md = parser.get_markdown()
    assert parser.page_title == "Q1 行业报告"
    assert "核心结论" in md and "市场规模增长 30%" in md
    assert "导航忽略" not in md and "alert" not in md

    # Mocked public URL fetch succeeds and indexes traceable source fragments
    monkeypatch.setattr(
        tools_module,
        "extract_url_to_markdown",
        lambda url: ("Q1 行业报告", "# Q1 行业报告\n\n市场规模增长 30%。"),
    )
    res = client.post(
        f"/api/projects/{pid}/materials/url",
        json={"url": "https://example.com/report"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Q1 行业报告"
    assert body["source_fragments"] >= 1


def test_demo_project_preflight_and_full_export(client):
    demo = client.post("/api/projects/demo")
    assert demo.status_code == 200
    pid = demo.json()["project_id"]

    proj = client.get(f"/api/projects/{pid}").json()
    assert proj["slide_count"] == 5
    assert proj["materials_count"] == 2
    assert proj["brand"]["footer_text"]
    ver = proj["outlines"][0]["outline_version"]

    # Pre-Flight audit should pass cleanly with score 100
    pf = client.get(f"/api/projects/{pid}/preflight?version={ver}&theme_id=keynote_light").json()
    assert pf["ready"] is True
    assert pf["summary"]["layout_ok"] is True
    assert pf["summary"]["media_ok"] is True
    assert pf["summary"]["supported_slides"] == 5
    assert pf["summary"]["notes_slides"] == 5

    # Confirm & export native PPTX via real pipeline
    assert client.post(f"/api/projects/{pid}/outlines/{ver}/confirm").status_code == 200
    art = tools_module.generate_slides.on_invoke_tool  # check raw helper directly
    gen_fn = getattr(tools_module.generate_slides, "__wrapped__", None) or getattr(
        tools_module.generate_slides, "fn"
    )
    artifact = gen_fn(
        project_id=pid,
        approved_outline_version=ver,
        template_id="keynote_light",
        auto_fit=True,
    )
    exp = tools_module.export_deck_impl(
        project_id=pid,
        artifact_id=artifact.artifact_id,
        revision=artifact.artifact_revision,
    )
    assert exp.success is True and exp.pptx_path

    prs = Presentation(exp.pptx_path)
    assert len(prs.slides) == 5
    # Slide 3 has native table + native chart + demo brand footer!
    s3 = prs.slides[2]
    assert any(sh.has_table for sh in s3.shapes)
    assert any(sh.has_chart for sh in s3.shapes)
    all_s3_text = "\n".join(sh.text_frame.text for sh in s3.shapes if sh.has_text_frame)
    assert "Draftboard 示例文稿" in all_s3_text


def test_brand_kit_override_and_saved_layouts_crud(client):
    demo = client.post("/api/projects/demo").json()
    pid = demo["project_id"]

    # Upload a small logo PNG
    logo_buf = io.BytesIO()
    Image.new("RGB", (120, 40), (20, 40, 80)).save(logo_buf, format="PNG")
    up = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("acme_logo.png", logo_buf.getvalue(), "image/png")},
    )
    assert up.status_code == 200

    # Apply Brand Kit
    br = client.patch(
        f"/api/projects/{pid}/brand",
        json={
            "accent_hex": "#D946EF",
            "bg_hex": "#FFFDF7",
            "footer_text": "ACME Corp Confidential",
            "logo_asset_id": "acme_logo",
            "logo_position": "top_right",
        },
    )
    assert br.status_code == 200
    assert br.json()["brand"]["accent_hex"] == "#D946EF"

    # Export and verify brand footer + logo image embedded on non-cover slides
    proj = client.get(f"/api/projects/{pid}").json()
    ver = proj["outlines"][0]["outline_version"]
    client.post(f"/api/projects/{pid}/outlines/{ver}/confirm")
    gen_fn = getattr(tools_module.generate_slides, "__wrapped__", None) or getattr(
        tools_module.generate_slides, "fn"
    )
    artifact = gen_fn(
        project_id=pid,
        approved_outline_version=ver,
        template_id="keynote_light",
        auto_fit=True,
    )
    exp = tools_module.export_deck_impl(
        project_id=pid,
        artifact_id=artifact.artifact_id,
        revision=artifact.artifact_revision,
    )
    assert exp.success is True
    prs = Presentation(exp.pptx_path)
    s2 = prs.slides[1]
    s2_texts = "\n".join(sh.text_frame.text for sh in s2.shapes if sh.has_text_frame)
    assert "ACME Corp Confidential" in s2_texts
    assert any(sh.shape_type == 13 for sh in s2.shapes)  # PICTURE (corner logo)

    # Saved Custom Layouts CRUD
    create_lay = client.post(
        "/api/layouts/custom",
        json={
            "name": "3列指标卡模板",
            "custom_bg": "theme:bg",
            "elements": [
                {
                    "id": "hdr",
                    "kind": "text",
                    "x": 48,
                    "y": 32,
                    "w": 864,
                    "h": 48,
                    "text": "标题占位",
                    "font_size": 28,
                    "bold": True,
                    "color": "theme:title",
                }
            ],
        },
    )
    assert create_lay.status_code == 200
    lid = create_lay.json()["id"]

    listed = client.get("/api/layouts/custom").json()["layouts"]
    assert any(item["id"] == lid and item["name"] == "3列指标卡模板" for item in listed)

    deleted = client.delete(f"/api/layouts/custom/{lid}")
    assert deleted.status_code == 200
    assert not any(item["id"] == lid for item in client.get("/api/layouts/custom").json()["layouts"])


def test_preflight_catches_missing_image_in_custom_canvas(client):
    demo = client.post("/api/projects/demo")
    assert demo.status_code == 200
    pid = demo.json()["project_id"]
    proj = client.get(f"/api/projects/{pid}").json()
    ver = proj["outlines"][0]["outline_version"]
    outline = client.get(f"/api/projects/{pid}/outlines/{ver}").json()

    # Inject a broken image element into slide 2's custom canvas
    items = outline["items"]
    items[1]["custom_elements"].append(
        {
            "id": "broken_img",
            "kind": "image",
            "x": 60,
            "y": 320,
            "w": 220,
            "h": 140,
            "image_asset_id": "nonexistent_deleted.png",
        }
    )
    updated = client.put(
        f"/api/projects/{pid}/outlines/{ver}",
        json={"items": items},
    )
    assert updated.status_code == 200
    new_ver = updated.json()["outline_version"]

    pf = client.get(
        f"/api/projects/{pid}/preflight?version={new_ver}&theme_id=keynote_light"
    ).json()
    assert pf["ready"] is False
    assert pf["summary"]["media_ok"] is False
    assert any(
        f["category"] == "media"
        and f["severity"] == "error"
        and "nonexistent_deleted.png" in f["message"]
        for f in pf["findings"]
    )


def test_health_and_delete_material_cleans_brand_logo_and_custom_images(client):
    assert client.get("/api/health").json() == {"status": "ok"}

    demo = client.post("/api/projects/demo").json()
    pid = demo["project_id"]

    # Upload an image and bind it both as brand logo and as a freeform canvas image
    img = Image.new("RGB", (64, 32), (30, 80, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    up = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("brand_logo.png", buf.getvalue(), "image/png")},
    )
    assert up.status_code == 200

    assert (
        client.patch(
            f"/api/projects/{pid}/brand",
            json={"logo_asset_id": "brand_logo", "footer_text": "Keep Footer"},
        ).status_code
        == 200
    )

    proj = client.get(f"/api/projects/{pid}").json()
    ver = proj["outlines"][0]["outline_version"]
    outline = client.get(f"/api/projects/{pid}/outlines/{ver}").json()
    items = outline["items"]
    items[1]["custom_elements"].append(
        {
            "id": "custom_logo_img",
            "kind": "image",
            "x": 60,
            "y": 320,
            "w": 160,
            "h": 80,
            "image_asset_id": "brand_logo",
        }
    )
    assert (
        client.put(
            f"/api/projects/{pid}/outlines/{ver}",
            json={"items": items},
        ).status_code
        == 200
    )

    # Deleting the material must clean up both brand.logo_asset_id and custom_elements image
    del_res = client.delete(f"/api/projects/{pid}/materials/brand_logo")
    assert del_res.status_code == 200

    proj_after = client.get(f"/api/projects/{pid}").json()
    assert proj_after["brand"]["logo_asset_id"] is None
    assert proj_after["brand"]["footer_text"] == "Keep Footer"

    outline_after = client.get(f"/api/projects/{pid}/outlines/{ver}").json()
    assert not any(
        el["id"] == "custom_logo_img"
        for el in (outline_after["items"][1].get("custom_elements") or [])
    )

    # Speaker notes Markdown export should render freeform canvas tables & charts
    notes_res = client.get(f"/api/projects/{pid}/download/notes")
    assert notes_res.status_code == 200
    notes_md = notes_res.content.decode("utf-8")
    assert "（自由画布）" in notes_md
    assert "| --- |" in notes_md
    assert "图表「" in notes_md
