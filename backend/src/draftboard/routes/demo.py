"""One-click zero-LLM 10-second interactive demo project route."""

from __future__ import annotations

import json
import pathlib
import time
import uuid

from fastapi import APIRouter
from PIL import Image, ImageDraw

import draftboard.tools as tools_module
from draftboard.models import (
    CanvasElement,
    ChartSeries,
    EvidenceStatus,
    Outline,
    OutlineItem,
    SlideLayout,
)
from draftboard.routes.common import get_root, get_storage, unwrap_tool

router = APIRouter()


def _generate_demo_diagram(path: pathlib.Path) -> None:
    """Create a crisp architectural diagram PNG with PIL (zero external assets)."""
    im = Image.new("RGB", (900, 560), (245, 246, 248))
    draw = ImageDraw.Draw(im)
    boxes = [
        (60, 70, 840, 190, (255, 255, 255), (0, 113, 227)),
        (60, 225, 435, 365, (255, 255, 255), (46, 125, 99)),
        (465, 225, 840, 365, (255, 255, 255), (46, 125, 99)),
        (60, 400, 840, 500, (29, 29, 31), (29, 29, 31)),
    ]
    for x1, y1, x2, y2, fill, accent in boxes:
        draw.rounded_rectangle(
            [x1, y1, x2, y2], radius=18, fill=fill, outline=(224, 226, 232), width=2
        )
        draw.rounded_rectangle(
            [x1 + 24, y1 + 24, x1 + 32, y2 - 24], radius=4, fill=accent
        )
        bar_col = (225, 228, 235) if fill != (29, 29, 31) else (90, 92, 100)
        title_col = (40, 42, 48) if fill != (29, 29, 31) else (240, 242, 245)
        draw.rounded_rectangle(
            [x1 + 52, y1 + 32, min(x2 - 48, x1 + 260), y1 + 50],
            radius=6,
            fill=title_col,
        )
        draw.rounded_rectangle(
            [x1 + 52, y1 + 66, x2 - 48, y1 + 80], radius=5, fill=bar_col
        )
        if y2 - y1 > 110:
            draw.rounded_rectangle(
                [x1 + 52, y1 + 94, x2 - 120, y1 + 108], radius=5, fill=bar_col
            )
    im.save(path, format="PNG")


@router.post("/api/projects/demo")
def create_demo_project():
    """Create a zero-LLM 10-second showcase deck demonstrating provenance, Bento KPI, native table/chart, and image slides."""
    pid = f"demo-{uuid.uuid4().hex[:6]}"
    p_dir = get_root() / pid
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
    (p_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False), encoding="utf-8"
    )

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

    mat_out = unwrap_tool(tools_module.read_materials)(project_id=pid)
    md_sids = [
        f.source_id for f in mat_out.source_fragments if f.asset_id == "Q1复盘纪要"
    ]
    img_sids = [
        f.source_id for f in mat_out.source_fragments if f.asset_id == "架构演进示意"
    ]
    primary_sid = md_sids[0] if md_sids else ""
    img_sid = img_sids[0] if img_sids else ""

    outline = Outline(
        outline_version=f"v-{uuid.uuid4().hex[:8]}",
        project_id=pid,
        is_confirmed=True,
        items=[
            OutlineItem(
                outline_item_id="demo-s1",
                title="2026 Q1 产品增长与架构复盘",
                summary="营收加速突破 1.2 亿 · 核心链路耗时下降 75%",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=(
                    EvidenceStatus.SUPPORTED
                    if primary_sid
                    else EvidenceStatus.UNSUPPORTED
                ),
                layout=SlideLayout.COVER,
                speaker_notes="欢迎各位参加 Q1 复盘会。今天用 5 分钟快速同步本季度的业务增长结果、架构提速成果以及 Q2 路线图。",
            ),
            OutlineItem(
                outline_item_id="demo-s2",
                title="核心增长指标：营收与留存双线突破",
                summary="ARR 达 1.20 亿（+42%），净留存 118%，综合毛利率 78%，获客成本下降 23%。",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=(
                    EvidenceStatus.SUPPORTED
                    if primary_sid
                    else EvidenceStatus.UNSUPPORTED
                ),
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
                evidence_status=(
                    EvidenceStatus.SUPPORTED
                    if primary_sid
                    else EvidenceStatus.UNSUPPORTED
                ),
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
                evidence_status=(
                    EvidenceStatus.SUPPORTED
                    if primary_sid
                    else EvidenceStatus.UNSUPPORTED
                ),
                layout=SlideLayout.TEXT_IMAGE,
                image_asset_id="架构演进示意",
                speaker_notes="技术侧三大突破：响应降 75%、渲染提速至亚秒级、可用性达四个九级别。",
            ),
            OutlineItem(
                outline_item_id="demo-s5",
                title="Q2 重点规划与感谢聆听",
                summary="聚焦企业品牌包与版式复用库落地 · 冲刺 50 家头部种子客户",
                source_ids=[s for s in [primary_sid] if s],
                evidence_status=(
                    EvidenceStatus.SUPPORTED
                    if primary_sid
                    else EvidenceStatus.UNSUPPORTED
                ),
                layout=SlideLayout.CLOSING,
                speaker_notes="感谢大家聆听，欢迎进入 Q&A 环节。",
            ),
        ],
    )
    get_storage(pid).save_outline(outline)
    return {"project_id": pid, "name": demo_name}
