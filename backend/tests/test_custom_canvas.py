"""End-to-end offline tests for the Dual-Track Freeform Canvas MVP."""

from __future__ import annotations

import asyncio
import json
import pathlib

import pytest
from agents.tool_context import ToolContext
from fastapi.testclient import TestClient
from PIL import Image
from pptx import Presentation
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE

import draftboard.api as api_module
import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.chat_agent import StudioTurnState, build_studio_tools
from draftboard.models import (
    CanvasElement,
    ChartSeries,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
    SlideLayout,
    SourceFragment,
    validate_outline,
)
from draftboard.pptx_export import _measure_custom_slide, resolve_canvas_hex
from draftboard.storage import ProjectStorage
from draftboard.themes import get_theme


def _invoke_tool(tools: list, name: str, args: dict):
    tool = next(t for t in tools if t.name == name)
    raw = json.dumps(args, ensure_ascii=False)
    ctx = ToolContext(
        context=None,
        tool_name=tool.name,
        tool_call_id=f"call_{name}",
        tool_arguments=raw,
    )
    out = asyncio.run(tool.on_invoke_tool(ctx, raw))
    if isinstance(out, str):
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return out
    return out


def _seed_project(tmp_path: pathlib.Path, monkeypatch, font_files, pid: str = "custom-demo"):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    monkeypatch.setattr(api_module, "STORAGE_ROOT", tmp_path)
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    storage = ProjectStorage(pid, tmp_path)
    storage.save_sources(
        [
            SourceFragment(source_id="src-1", asset_id="notes.md", location="L1-L5", content_preview="ARR 1.2亿"),
            SourceFragment(source_id="src-2", asset_id="notes.md", location="L6-L10", content_preview="留存 118%"),
        ]
    )

    # Create a real PNG image asset in assets/
    assets_dir = storage.root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    img_path = assets_dir / "hero_chart.png"
    Image.new("RGB", (320, 200), (40, 120, 210)).save(img_path, format="PNG")

    outline = Outline(
        outline_version="v-seed0001",
        project_id=pid,
        is_confirmed=False,
        items=[
            OutlineItem(
                outline_item_id="s-1",
                title="2026 Q1 季度业务复盘",
                summary="营收增长 42%，留存率提升至 89%",
                source_ids=["src-1"],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.COVER,
            ),
            OutlineItem(
                outline_item_id="s-2",
                title="核心财务与增长指标",
                summary="ARR 达到 1.2 亿（同比 +42%），净留存 118%，获客成本下降 23%，毛利率稳定在 78%。",
                source_ids=["src-1", "src-2"],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.CONTENT,
            ),
            OutlineItem(
                outline_item_id="s-3",
                title="技术架构演进",
                summary="完成微服务拆分，平均接口耗时从 180ms 降至 45ms。",
                source_ids=["src-2"],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.CONTENT,
            ),
            OutlineItem(
                outline_item_id="s-4",
                title="下一阶段路线图",
                summary="Q2 聚焦海外扩张与企业级安全合规认证。",
                source_ids=["src-2"],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.CONTENT,
            ),
        ],
    )
    storage.save_outline(outline)
    return storage, outline


def test_resolve_canvas_hex_all_themes():
    for tid in ("keynote_light", "keynote_dark", "nordic_pine", "gallery_sand"):
        theme = get_theme(tid)
        assert resolve_canvas_hex("theme:bg", theme, "#000000") == theme.bg_hex
        assert resolve_canvas_hex("theme:cover_bg", theme, "#000000") == theme.cover_bg_hex
        assert resolve_canvas_hex("theme:surface", theme, "#000000") == theme.surface_hex
        assert resolve_canvas_hex("theme:title", theme, "#000000") == theme.title_hex
        assert resolve_canvas_hex("theme:accent", theme, "#000000") == theme.accent_hex
        assert resolve_canvas_hex("theme:divider", theme, "#000000") == theme.divider_hex
        assert resolve_canvas_hex("transparent", theme, "#FFFFFF") is None
        assert resolve_canvas_hex("none", theme, "#FFFFFF") is None
        assert resolve_canvas_hex("#12AB34", theme, "#FFFFFF") == "#12AB34"


def test_measure_custom_slide_catches_bounds_overlap_overflow(font_pair):
    fonts = font_pair

    # 1. Out-of-bounds
    s_oob = Slide(
        slide_id="s-oob",
        layout=SlideLayout.CONTENT,
        elements=[SlideElement(element_id="e1", type="title", content="OOB")],
        custom_elements=[
            CanvasElement(id="bad_card", kind="card", x=800, y=50, w=200, h=100),
        ],
    )
    resolved: dict = {}
    errors: list[str] = []
    _measure_custom_slide(s_oob, fonts, auto_fit=True, resolved=resolved, errors=errors)
    assert any("[OUT_OF_BOUNDS]" in e for e in errors)

    # 2. Text-vs-text overlap
    s_ovl = Slide(
        slide_id="s-ovl",
        layout=SlideLayout.CONTENT,
        elements=[SlideElement(element_id="e1", type="title", content="Overlap")],
        custom_elements=[
            CanvasElement(id="t1", kind="text", x=48, y=40, w=300, h=80, text="标题一", font_size=24),
            CanvasElement(id="t2", kind="text", x=100, y=80, w=300, h=80, text="重叠文本", font_size=18),
        ],
    )
    resolved, errors = {}, []
    _measure_custom_slide(s_ovl, fonts, auto_fit=True, resolved=resolved, errors=errors)
    assert any("[OVERLAP]" in e for e in errors)

    # 3. Text overflow inside tiny box
    s_ovf = Slide(
        slide_id="s-ovf",
        layout=SlideLayout.CONTENT,
        elements=[SlideElement(element_id="e1", type="title", content="Overflow")],
        custom_elements=[
            CanvasElement(
                id="tiny",
                kind="text",
                x=48,
                y=40,
                w=120,
                h=26,
                text="这是一段远远超出微小文本框高度限制的非常长非常长的测试文案内容",
                font_size=24,
            ),
        ],
    )
    resolved, errors = {}, []
    _measure_custom_slide(s_ovf, fonts, auto_fit=False, resolved=resolved, errors=errors)
    assert any("[OVERFLOW]" in e for e in errors)


def test_design_custom_slide_end_to_end_native_pptx_and_pdf(tmp_path, monkeypatch, font_files):
    storage, outline = _seed_project(tmp_path, monkeypatch, font_files, pid="bento-deck")
    state = StudioTurnState(
        project_id="bento-deck",
        active_theme_id="keynote_dark",
        auto_fit=True,
        before_outline_version=outline.outline_version,
    )
    tools = build_studio_tools(state)

    # 1. Check rhythm diagnostics first (slides 2-4 are 3 consecutive 'content' layouts)
    diag = _invoke_tool(tools, "check_deck_layout", {})
    assert diag["ok"] is True
    assert diag["rhythm_suggestions"], "Expected rhythm suggestions for 3 consecutive content slides"

    # 2. Reject colliding layout before persisting
    bad = _invoke_tool(
        tools,
        "design_custom_slide",
        {
            "slide_number": 2,
            "background": "theme:bg",
            "elements": [
                {"id": "a", "kind": "text", "x": 48, "y": 40, "w": 400, "h": 60, "text": "Title A", "font_size": 28},
                {"id": "b", "kind": "text", "x": 80, "y": 60, "w": 400, "h": 60, "text": "Title B", "font_size": 22},
            ],
        },
    )
    assert isinstance(bad, str)
    assert "ERROR:" in bad and "OVERLAP" in bad
    assert state.after_outline_version is None  # did not corrupt outline

    # 3. Design valid Apple Bento Grid with card + line + cover image + text
    bento_elements = [
        {
            "id": "hdr",
            "kind": "text",
            "x": 48,
            "y": 28,
            "w": 864,
            "h": 54,
            "text": "核心财务与增长指标",
            "font_size": 30,
            "bold": True,
            "color": "theme:title",
        },
        {
            "id": "accent_rule",
            "kind": "line",
            "x": 48,
            "y": 90,
            "w": 72,
            "h": 0,
            "color": "theme:accent",
            "line_width": 3.0,
        },
        {
            "id": "kpi_card_1",
            "kind": "card",
            "x": 48,
            "y": 116,
            "w": 416,
            "h": 176,
            "fill": "theme:surface",
            "border_color": "theme:divider",
            "border_width": 1.0,
            "radius": 16,
        },
        {
            "id": "kpi_num_1",
            "kind": "text",
            "x": 72,
            "y": 136,
            "w": 368,
            "h": 64,
            "text": "+42%",
            "font_size": 44,
            "bold": True,
            "color": "theme:accent",
        },
        {
            "id": "kpi_lbl_1",
            "kind": "text",
            "x": 72,
            "y": 212,
            "w": 368,
            "h": 58,
            "text": "ARR 达到 1.2 亿元，同比增长 42%",
            "font_size": 16,
            "color": "theme:body",
        },
        {
            "id": "kpi_card_2",
            "kind": "card",
            "x": 48,
            "y": 312,
            "w": 416,
            "h": 176,
            "fill": "theme:surface",
            "border_color": "theme:divider",
            "border_width": 1.0,
            "radius": 16,
        },
        {
            "id": "kpi_num_2",
            "kind": "text",
            "x": 72,
            "y": 332,
            "w": 368,
            "h": 64,
            "text": "118%",
            "font_size": 44,
            "bold": True,
            "color": "theme:title",
        },
        {
            "id": "kpi_lbl_2",
            "kind": "text",
            "x": 72,
            "y": 408,
            "w": 368,
            "h": 58,
            "text": "净美元留存率，获客成本下降 23%",
            "font_size": 16,
            "color": "theme:body",
        },
        {
            "id": "chart_card",
            "kind": "card",
            "x": 488,
            "y": 116,
            "w": 424,
            "h": 372,
            "fill": "theme:surface",
            "border_color": "theme:divider",
            "border_width": 1.0,
            "radius": 16,
        },
        {
            "id": "chart_img",
            "kind": "image",
            "x": 504,
            "y": 132,
            "w": 392,
            "h": 340,
            "image_asset_id": "hero_chart",
            "fit": "cover",
        },
    ]

    ok_res = _invoke_tool(
        tools,
        "design_custom_slide",
        {
            "slide_number": 2,
            "background": "theme:bg",
            "elements": bento_elements,
            "title": "核心财务与增长指标",
            "speaker_notes": "重点强调 ARR 与净留存双增长。",
        },
    )
    assert ok_res["ok"] is True
    assert ok_res["element_count"] == len(bento_elements)
    assert 2 in state.touched_slides

    # 4. Verify deck state exposes custom canvas info
    deck_state = _invoke_tool(tools, "get_deck_state", {})
    slide2 = deck_state["slides"][1]
    assert slide2["is_custom_canvas"] is True
    assert len(slide2["custom_elements"]) == len(bento_elements)

    # 5. Export PPTX + PDF + PNG preview and inspect native PowerPoint shapes!
    exp = _invoke_tool(tools, "export_deck_now", {})
    assert exp["ok"] is True
    pptx_files = list(storage.root.rglob("*.pptx"))
    assert pptx_files, "Expected exported .pptx file"
    pptx_path = pptx_files[-1]

    prs = Presentation(str(pptx_path))
    assert len(prs.slides) == 4
    s2 = prs.slides[1]
    shape_types = [sh.shape_type for sh in s2.shapes]
    assert MSO_SHAPE_TYPE.AUTO_SHAPE in shape_types  # native rounded cards
    assert MSO_SHAPE_TYPE.LINE in shape_types        # native accent rule
    assert MSO_SHAPE_TYPE.PICTURE in shape_types     # native cover-cropped image
    assert MSO_SHAPE_TYPE.TEXT_BOX in shape_types    # native editable text boxes

    # Verify PDF & PNG previews rendered cleanly (including AUTO_SHAPE cards)
    pdf_files = list(storage.root.rglob("deck.pdf"))
    png_files = [
        p
        for p in storage.root.rglob("*.png")
        if p.parent.name != "assets" and ".snapshot" not in p.as_posix()
    ]
    assert pdf_files and pdf_files[-1].stat().st_size > 1000
    assert len(png_files) == 4 and all(p.stat().st_size > 1000 for p in png_files)

    # 6. Revert slide 2 cleanly back to standard template via update_slide
    rev = _invoke_tool(
        tools,
        "update_slide",
        {"slide_number": 2, "layout": "bullets", "clear_custom_layout": True},
    )
    assert rev["ok"] is True
    deck_after = _invoke_tool(tools, "get_deck_state", {})
    assert deck_after["slides"][1]["is_custom_canvas"] is False
    assert deck_after["slides"][1]["custom_elements"] is None


def test_api_edit_outline_and_summary_preserve_custom_canvas(tmp_path, monkeypatch, font_files):
    storage, outline = _seed_project(tmp_path, monkeypatch, font_files, pid="api-custom")
    client = TestClient(api_module.app)

    # Validate that custom_elements bypasses fixed-template column_right requirement
    custom_item = OutlineItem(
        outline_item_id="c-1",
        title="自定义封面",
        summary="自由画布摘要",
        source_ids=["src-1"],
        evidence_status=EvidenceStatus.SUPPORTED,
        layout=SlideLayout.TWO_COLUMN,  # intentionally no column_right
        custom_bg="theme:cover_bg",
        custom_elements=[
            CanvasElement(
                id="hero_title",
                kind="text",
                x=60,
                y=160,
                w=840,
                h=120,
                text="自定义大标题",
                font_size=46,
                bold=True,
                color="theme:cover_title",
            )
        ],
    )
    assert validate_outline([custom_item], {"src-1"}) == []

    # PUT outline with custom_bg & custom_elements on Slide 1
    payload = {
        "items": [
            {
                "outline_item_id": "s-1",
                "title": "自定义大标题",
                "summary": "自由画布摘要",
                "layout": "cover",
                "source_ids": ["src-1"],
                "custom_bg": "theme:cover_bg",
                "custom_elements": [
                    {
                        "id": "card_bg",
                        "kind": "card",
                        "x": 48,
                        "y": 48,
                        "w": 864,
                        "h": 444,
                        "fill": "theme:surface",
                        "radius": 20,
                    },
                    {
                        "id": "hero_title",
                        "kind": "text",
                        "x": 88,
                        "y": 160,
                        "w": 780,
                        "h": 90,
                        "text": "自定义大标题",
                        "font_size": 44,
                        "bold": True,
                        "color": "theme:title",
                    },
                ],
            }
        ]
    }
    res = client.put(f"/api/projects/api-custom/outlines/{outline.outline_version}", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["items"][0]["custom_bg"] == "theme:cover_bg"
    assert len(body["items"][0]["custom_elements"]) == 2

    # GET /api/projects summary exposes cover_slide.custom_elements for homepage miniature
    proj_list = client.get("/api/projects").json()["projects"]
    mine = next(p for p in proj_list if p["project_id"] == "api-custom")
    assert mine["cover_slide"]["custom_bg"] == "theme:cover_bg"
    assert len(mine["cover_slide"]["custom_elements"]) == 2

    # GET /api/themes exposes chart_palette for all themes
    themes_resp = client.get("/api/themes").json()["themes"]
    assert all(len(t.get("chart_palette") or []) >= 4 for t in themes_resp)


def test_measure_table_and_chart_validation(font_pair):
    # 1. Table row too cramped + chart mismatched series length
    s_bad = Slide(
        slide_id="s-data-bad",
        layout=SlideLayout.CONTENT,
        elements=[SlideElement(element_id="e1", type="title", content="Bad Data")],
        custom_elements=[
            CanvasElement(
                id="cramped_tbl",
                kind="table",
                x=48,
                y=40,
                w=400,
                h=70,  # 70 / 5 rows = 14pt < 20pt
                headers=["指标", "数值"],
                rows=[["A", "1"], ["B", "2"], ["C", "3"], ["D", "4"]],
            ),
            CanvasElement(
                id="bad_chart",
                kind="chart",
                x=500,
                y=40,
                w=400,
                h=260,
                chart_type="bar",
                chart_categories=["Q1", "Q2", "Q3"],
                chart_series=[ChartSeries(name="ARR", values=[10, 20])],  # len 2 != 3
            ),
        ],
    )
    resolved, errors = {}, []
    _measure_custom_slide(s_bad, font_pair, auto_fit=True, resolved=resolved, errors=errors)
    assert any("[OVERFLOW]" in e and "cramped_tbl" in e for e in errors)
    assert any("[INVALID_CHART]" in e and "bad_chart" in e for e in errors)


def test_native_table_and_all_four_charts_export_and_pdf(tmp_path, monkeypatch, font_files):
    storage, outline = _seed_project(tmp_path, monkeypatch, font_files, pid="data-viz-deck")
    state = StudioTurnState(
        project_id="data-viz-deck",
        active_theme_id="nordic_pine",
        auto_fit=True,
        before_outline_version=outline.outline_version,
    )
    tools = build_studio_tools(state)

    # Slide 2: Native editorial table + Vertical clustered bar chart
    r2 = _invoke_tool(
        tools,
        "design_custom_slide",
        {
            "slide_number": 2,
            "background": "theme:bg",
            "title": "季度核心指标对比",
            "elements": [
                {
                    "id": "t2_hdr",
                    "kind": "text",
                    "x": 48,
                    "y": 28,
                    "w": 864,
                    "h": 48,
                    "text": "季度核心指标对比",
                    "font_size": 28,
                    "bold": True,
                    "color": "theme:title",
                },
                {
                    "id": "tbl_metrics",
                    "kind": "table",
                    "x": 48,
                    "y": 100,
                    "w": 416,
                    "h": 260,
                    "headers": ["指标", "Q4", "Q1", "环比"],
                    "rows": [
                        ["ARR（亿）", "0.85", "1.20", "+42%"],
                        ["净留存率", "112%", "118%", "+6%"],
                        ["毛利率", "76%", "78%", "+2%"],
                        ["获客成本", "1.30", "1.00", "-23%"],
                    ],
                    "header_fill": "theme:accent",
                    "header_color": "theme:cover_title",
                    "table_font_size": 13,
                },
                {
                    "id": "chart_bar",
                    "kind": "chart",
                    "x": 488,
                    "y": 100,
                    "w": 424,
                    "h": 360,
                    "chart_type": "bar",
                    "chart_title": "季度营收与毛利趋势",
                    "chart_categories": ["Q2", "Q3", "Q4", "Q1"],
                    "chart_series": [
                        {"name": "营收", "values": [62, 74, 85, 120]},
                        {"name": "毛利", "values": [46, 56, 65, 94]},
                    ],
                    "show_values": True,
                    "value_suffix": "M",
                },
            ],
        },
    )
    assert r2["ok"] is True

    # Slide 3: Horizontal bar chart + Line trend chart
    r3 = _invoke_tool(
        tools,
        "design_custom_slide",
        {
            "slide_number": 3,
            "background": "theme:bg",
            "title": "延迟优化与模块耗时",
            "elements": [
                {
                    "id": "t3_hdr",
                    "kind": "text",
                    "x": 48,
                    "y": 28,
                    "w": 864,
                    "h": 48,
                    "text": "接口性能与模块耗时",
                    "font_size": 28,
                    "bold": True,
                    "color": "theme:title",
                },
                {
                    "id": "chart_hbar",
                    "kind": "chart",
                    "x": 48,
                    "y": 104,
                    "w": 416,
                    "h": 360,
                    "chart_type": "hbar",
                    "chart_title": "各服务 P95 耗时",
                    "chart_categories": ["网关", "检索", "推理", "导出"],
                    "chart_series": [{"name": "耗时", "values": [12, 28, 45, 34]}],
                    "value_suffix": "ms",
                },
                {
                    "id": "chart_line",
                    "kind": "chart",
                    "x": 488,
                    "y": 104,
                    "w": 424,
                    "h": 360,
                    "chart_type": "line",
                    "chart_title": "平均响应耗时下降曲线",
                    "chart_categories": ["10月", "11月", "12月", "1月"],
                    "chart_series": [{"name": "平均耗时", "values": [180, 120, 72, 45]}],
                    "value_suffix": "ms",
                },
            ],
        },
    )
    assert r3["ok"] is True

    # Slide 4: Donut share chart
    r4 = _invoke_tool(
        tools,
        "design_custom_slide",
        {
            "slide_number": 4,
            "background": "theme:bg",
            "title": "区域营收结构占比",
            "elements": [
                {
                    "id": "t4_hdr",
                    "kind": "text",
                    "x": 48,
                    "y": 28,
                    "w": 864,
                    "h": 48,
                    "text": "区域营收结构占比",
                    "font_size": 28,
                    "bold": True,
                    "color": "theme:title",
                },
                {
                    "id": "chart_donut",
                    "kind": "chart",
                    "x": 220,
                    "y": 96,
                    "w": 520,
                    "h": 390,
                    "chart_type": "donut",
                    "chart_title": "2026 Q1 区域收入占比",
                    "chart_categories": ["中国区", "北美", "欧洲", "亚太"],
                    "chart_series": [{"name": "占比", "values": [48, 27, 15, 10]}],
                    "value_suffix": "%",
                },
            ],
        },
    )
    assert r4["ok"] is True

    # Export PPTX + PDF + PNG and verify native editable PowerPoint objects!
    exp = _invoke_tool(tools, "export_deck_now", {})
    assert exp["ok"] is True
    pptx_path = list(storage.root.rglob("*.pptx"))[-1]
    prs = Presentation(str(pptx_path))

    # Inspect Slide 2: native table + column clustered chart
    s2_tables = [sh.table for sh in prs.slides[1].shapes if sh.has_table]
    s2_charts = [sh.chart for sh in prs.slides[1].shapes if sh.has_chart]
    assert len(s2_tables) == 1
    assert len(s2_tables[0].rows) == 5 and len(s2_tables[0].columns) == 4
    assert s2_tables[0].cell(1, 3).text.strip() == "+42%"
    assert len(s2_charts) == 1
    assert s2_charts[0].chart_type == XL_CHART_TYPE.COLUMN_CLUSTERED
    assert len(s2_charts[0].plots[0].series) == 2

    # Inspect Slide 3: horizontal bar + line markers
    s3_types = {sh.chart.chart_type for sh in prs.slides[2].shapes if sh.has_chart}
    assert XL_CHART_TYPE.BAR_CLUSTERED in s3_types
    assert XL_CHART_TYPE.LINE_MARKERS in s3_types

    # Inspect Slide 4: doughnut chart
    s4_charts = [sh.chart for sh in prs.slides[3].shapes if sh.has_chart]
    assert len(s4_charts) == 1
    assert s4_charts[0].chart_type == XL_CHART_TYPE.DOUGHNUT

    # Verify ReportLab vector PDF & pypdfium2 PNGs all rendered cleanly
    pdf_files = list(storage.root.rglob("deck.pdf"))
    png_files = [
        p
        for p in storage.root.rglob("*.png")
        if p.parent.name != "assets" and ".snapshot" not in p.as_posix()
    ]
    assert pdf_files and pdf_files[-1].stat().st_size > 2000
    assert len(png_files) == 4 and all(p.stat().st_size > 1000 for p in png_files)
