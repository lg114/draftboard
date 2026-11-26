"""
PPT Studio Conversational Agent for Draftboard.

Provides a multi-turn, tool-calling presentation agent ("Cursor for PPTs")
built on the OpenAI Agents SDK with SSE streaming, project-scoped PPT tools,
deterministic layout self-checking, single-turn undoable version snapshots,
and per-project chat persistence.
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal, Optional

from agents import Agent, Runner, function_tool
from pydantic import BaseModel, Field

import draftboard.llm_config as llm_config
import draftboard.tools as tools_module
from draftboard.agent import resolve_model
from draftboard.measure import load_fonts
from draftboard.models import (
    Artifact,
    CanvasElement,
    EvidenceStatus,
    Outline,
    OutlineItem,
    Slide,
    SlideElement,
    SlideLayout,
    validate_ir,
    validate_outline,
)
from draftboard.pptx_export import (
    _measure_and_resolve,
    _measure_custom_slide,
    _resolve_image_path,
)
from draftboard.storage import STORAGE_ROOT, ProjectStorage, load_json
from draftboard.tasks import (
    DEFAULT_UNTITLED_NAME,
    _maybe_auto_name_project_from_outline,
)
from draftboard.themes import get_theme, is_valid_theme, list_themes, resolve_theme_id
from draftboard.tools import normalize_outline_item_text
from draftboard.user_library import (
    BrandKit,
    apply_brand_to_theme,
    clear_brand_palette_overrides,
    has_any_brand_fields,
    has_custom_palette,
)


TOOL_LABELS_CN: dict[str, str] = {
    "get_deck_state": "查看当前文稿状态",
    "read_project_materials": "读取项目素材与切片",
    "create_deck_outline": "生成整套演示大纲",
    "update_slide": "更新单页幻灯片",
    "batch_update_slides": "批量更新多页幻灯片",
    "manage_slides": "调整幻灯片增删与顺序",
    "design_custom_slide": "设计自由画布排版",
    "check_deck_layout": "执行真实字体排版自检",
    "set_deck_theme": "切换主题与排版设置",
    "set_custom_palette": "定制全局配色方案",
    "export_deck_now": "编译导出 PPTX 与矢量 PDF",
}

STUDIO_AGENT_INSTRUCTIONS = """你是 Draftboard 的专属 PPT 创作 Agent，定位类似“做 PPT 的 Cursor / Claude Code”。
你不仅能和用户自然对话，还能直接调用工具观察项目素材、读取与修改幻灯片大纲、增删调整页序、**使用双轨自由画布自由排版**、切换主题、运行真实排版自检，并在用户要求时编译导出 PPTX / PDF。

工作原则：
1. **先看再改，实事求是**：
   - 开始修改或回答关于文稿/素材的问题前，按需调用 `get_deck_state` 和 `read_project_materials` 获取真实内容，不要猜测。
   - 严守 Draftboard 事实护栏：**绝不编造数字、指标、引用或图片内容**。凡是来自素材的事实，必须填写来自 `read_project_materials` 的真实 `source_ids`；若用户要求的内容在素材中缺乏依据，明确坦诚告知缺口，并将对应页面标记为 `evidence_status="unsupported"`（`source_ids=[]`），绝不伪造数据。
2. **双轨排版策略（所说即能改）**：
   - **标准模板轨道**（`create_deck_outline` / `update_slide` / `batch_update_slides` / `manage_slides`）：适合快速构建常规页面，包含 `cover / content / bullets / two_column / text_image / closing`。
   - **自由画布轨道**（`design_custom_slide`）：当用户不满意固定模板，或需要**便当盒多卡片（Bento Grid）、大数字指标卡（KPI）、多维对比表格（`table`）、数据可视化图表（`chart`：柱状图 `bar` / 条形图 `hbar` / 折线图 `line` / 环形图 `donut`）、横向流程时间轴、左图右文/半屏出血大图、居中金句、章节过渡页、或任意自定义字号/对齐/配色**时，直接用 `design_custom_slide` 在 `960×540` pt 画布上用 6 种原生可编辑元素（`card`、`line`、`image`、`text`、`table`、`chart`）精准构图！
   - 自由画布设计规范：
     * 画布固定 `960×540` pt，常规留白建议 `48` pt（安全内容区 `x=48..912, y=36..504`）；
     * **绘制顺序（Z-order）**：先放背景色块和 `card`，再放 `line`、`image`、`table`、`chart`，最后放前景 `text`；
     * **优先使用主题语义色**（`theme:bg`、`theme:cover_bg`、`theme:surface`、`theme:title`、`theme:cover_title`、`theme:body`、`theme:cover_body`、`theme:accent`、`theme:muted`、`theme:divider`），确保切换全局主题时自动换肤；表格和图表默认自动继承当前主题配色，仅在用户点名特定颜色时使用 `#RRGGBB`；
     * 表格与图表数据**必须 100% 源自项目素材真实数字**，严禁编造或补齐不存在的数据；图表需保证每组 `chart_series.values` 长度与 `chart_categories` 严格一致；表格每行高度至少留足 `24–36` pt；
     * 严禁让任意 `text` / `table` / `chart` 框互相重叠或超出 `960×540` 边界；若工具返回 `[OVERFLOW]` / `[OVERLAP]` / `[OUT_OF_BOUNDS]` / `[INVALID_TABLE]` / `[INVALID_CHART]`，立刻调整坐标、行高或数据后重试直至通过。
   - 给用户提排版建议时，只推荐工作台**真正支持且能直接代改**的方案；用户问“怎么改好看”时，给出清晰方案并顺手询问是否由你直接代改；用户说“帮我改好看 / 照你说的改”就直接动手改完！
3. **改完主动自检排版**：
   - 凡是新建大纲或较大幅度改动文字后，主动调用一次 `check_deck_layout` 检查是否超框及全稿节奏。
   - 如果自检报 `[OVERFLOW]` 或 `[OVERLAP]`，主动精简文案或微调尺寸再测一次，争取交付时全部页面排版安全。
4. **导出需尊重用户意图**：
   - 仅当用户明确提出“导出 / 生成 PPTX / 编译一下”时，才调用 `export_deck_now`。平时改完画布会自动实时刷新，简明汇报改动即可。
5. **简洁、专业、面向用户的自然表达**：
   - 默认使用与用户和素材一致的语言（通常为自然流畅的简体中文）。
   - 提及具体页面时请使用「第 N 页」格式（例如「第 2 页」），前端会自动渲染为可点击的跳转标签。
   - **绝不向用户暴露任何内部技术标识**：回复正文中一律使用自然的产品中文名称（例如说「苹果白」「深空钛黑」「松柏森绿」「美术馆暖石」「自由画布」「自定义配色」「卡片」「分割线」「对比表格」「柱状图」「双栏版式」），严禁出现内部工具函数名（如 `design_custom_slide`、`get_deck_state`、`set_deck_theme`、`set_custom_palette`、`check_deck_layout`、`export_deck_now`）、主题英文 ID（如 `keynote_light`、`keynote_dark`、`nordic_pine`、`gallery_sand`）、元素/版式英文枚举名（如 `card`、`line`、`chart`、`table`、`two_column`、`text_image`）以及 `project_id` / `outline_item_id`（这些英文标识仅在调用工具参数时使用）。
   - Draftboard 预设主题固定为 4 套：**苹果白**（纯净画布）、**深空钛黑**（暗黑发布会）、**松柏森绿**（深松封面 + 象牙正文）、**美术馆暖石**（亚麻纸感 + 陶土点缀）。
   - **如果用户 4 套预设都不喜欢，或提出任意专属风格/色系**（如「金融蓝金」「日系抹茶米白」「暗黑紫霓虹」「柔和莫兰迪」「医疗青白」等），**直接调用 `set_custom_palette` 为整套文稿定制全局配色**（指定封面底色、正文底色和主强调色即可，系统会自动按对比度推导出安全的标题色、正文色、卡片面色与图表色板，全套页面实时生效），不必把每页都改写为自由画布；若仅需单页突破全局风格，再用自由画布单独设计该页。
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _raw(tool: Any) -> Any:
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    return fn if fn is not None else tool


def _root() -> pathlib.Path:
    return tools_module._storage_root or STORAGE_ROOT


def _project_dir(project_id: str) -> pathlib.Path:
    return _root() / project_id


def _chat_path(project_id: str) -> pathlib.Path:
    return _project_dir(project_id) / "chat.json"


# ── Chat History Persistence ──────────────────────────────────────────────────


def load_chat_history(project_id: str) -> list[dict[str, Any]]:
    path = _chat_path(project_id)
    if not path.exists():
        return []
    try:
        data = load_json(path)
        if isinstance(data, dict) and isinstance(data.get("messages"), list):
            return data["messages"]
    except Exception:
        pass
    return []


def save_chat_history(project_id: str, messages: list[dict[str, Any]]) -> None:
    p_dir = _project_dir(project_id)
    p_dir.mkdir(parents=True, exist_ok=True)
    # Keep the latest 100 messages to prevent unbounded file growth
    trimmed = messages[-100:]
    payload = {
        "project_id": project_id,
        "updated_at": _now_iso(),
        "messages": trimmed,
    }
    _chat_path(project_id).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_chat_history(project_id: str) -> None:
    path = _chat_path(project_id)
    if path.exists():
        path.unlink(missing_ok=True)


# ── Tool Input Schemas (Strict Pydantic for OpenAI + Gemini compatibility) ────


LayoutLiteral = Literal[
    "cover", "content", "bullets", "two_column", "text_image", "closing"
]
EvidenceLiteral = Literal["supported", "partial", "unsupported"]


class SlideDraftInput(BaseModel):
    title: str = Field(description="幻灯片标题，简明有力")
    summary: str = Field(
        description="正文/副标题/左栏内容；当 layout='bullets' 时每行一条要点，不要带前缀横杠"
    )
    layout: LayoutLiteral = Field(
        default="content",
        description="版式：cover / content / bullets / two_column / text_image / closing",
    )
    source_ids: list[str] = Field(
        default_factory=list,
        description="来自 read_project_materials 的真实 source_id 列表；无依据时留空 []",
    )
    evidence_status: EvidenceLiteral = Field(
        default="supported",
        description="依据状态：supported / partial / unsupported",
    )
    column_right: Optional[str] = Field(
        default=None,
        description="仅 layout='two_column' 时必填的右栏内容",
    )
    image_asset_id: Optional[str] = Field(
        default=None,
        description="仅 layout='text_image' 时必填的已上传图片 asset_id",
    )
    speaker_notes: Optional[str] = Field(
        default=None,
        description="可选的演讲者口播备注",
    )


class SlidePatchInput(BaseModel):
    slide_number: int = Field(description="要修改的页码（从 1 开始）")
    title: Optional[str] = Field(default=None, description="新标题（不改则留空）")
    summary: Optional[str] = Field(default=None, description="新正文/要点/左栏（不改则留空）")
    layout: Optional[LayoutLiteral] = Field(default=None, description="新版式（不改则留空）")
    column_right: Optional[str] = Field(default=None, description="新右栏内容（双栏版式）")
    image_asset_id: Optional[str] = Field(default=None, description="新配图 asset_id（图文版式）")
    speaker_notes: Optional[str] = Field(default=None, description="新演讲者备注")
    source_ids: Optional[list[str]] = Field(default=None, description="新素材引用 source_id 列表")
    evidence_status: Optional[EvidenceLiteral] = Field(
        default=None, description="新依据状态"
    )


# ── Turn State (Tracks Single-Turn Version Snapshot & Live Changes) ───────────


@dataclass
class StudioTurnState:
    project_id: str
    selected_slide_index: int = 0  # 0-based
    active_theme_id: str = "keynote_light"
    auto_fit: bool = True
    before_outline_version: Optional[str] = None
    after_outline_version: Optional[str] = None
    touched_slides: set[int] = field(default_factory=set)  # 1-based slide numbers
    theme_changed_to: Optional[str] = None
    brand_changed: bool = False
    palette_name_changed_to: Optional[str] = None
    auto_fit_changed_to: Optional[bool] = None
    exported: bool = False
    layout_checked_ok: Optional[bool] = None
    last_tool_summaries: dict[str, str] = field(default_factory=dict)

    def current_outline_version(self) -> Optional[str]:
        return self.after_outline_version or self.before_outline_version

    def has_changes(self) -> bool:
        return bool(
            self.after_outline_version
            or self.theme_changed_to
            or self.brand_changed
            or self.auto_fit_changed_to is not None
            or self.exported
        )

    def to_changes_dict(self) -> Optional[dict[str, Any]]:
        if not self.has_changes():
            return None
        return {
            "before_outline_version": self.before_outline_version,
            "after_outline_version": self.after_outline_version,
            "touched_slides": sorted(self.touched_slides),
            "theme_id": self.theme_changed_to,
            "brand_updated": self.brand_changed or None,
            "palette_name": self.palette_name_changed_to,
            "auto_fit": self.auto_fit_changed_to,
            "exported": self.exported,
            "layout_checked_ok": self.layout_checked_ok,
        }


# ── Internal Helpers for Storage & Layout Checking ────────────────────────────


def _load_meta(project_id: str) -> dict[str, Any]:
    meta_path = _project_dir(project_id) / "meta.json"
    if meta_path.exists():
        try:
            loaded = load_json(meta_path)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    return {"project_id": project_id, "name": project_id}


def _save_meta(project_id: str, meta: dict[str, Any]) -> None:
    p_dir = _project_dir(project_id)
    p_dir.mkdir(parents=True, exist_ok=True)
    (p_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False),
        encoding="utf-8",
    )


def _latest_outline_version(project_id: str) -> Optional[str]:
    outlines_dir = _project_dir(project_id) / "outlines"
    if not outlines_dir.exists():
        return None
    files = list(outlines_dir.glob("*.json"))
    if not files:
        return None
    latest = max(files, key=lambda p: p.stat().st_mtime)
    return latest.stem


def _load_outline(project_id: str, version: Optional[str]) -> Optional[Outline]:
    if not version:
        return None
    storage = ProjectStorage(project_id, storage_root=_root())
    try:
        return storage.load_outline(version)
    except Exception:
        return None


def _persist_turn_outline(state: StudioTurnState, items: list[OutlineItem]) -> Outline:
    """Persist outline changes into a single derived draft version per agent turn."""
    storage = ProjectStorage(state.project_id, storage_root=_root())
    cleaned = [normalize_outline_item_text(it) for it in items]

    if not state.after_outline_version:
        state.after_outline_version = f"v-{uuid.uuid4().hex[:8]}"

    outline = Outline(
        outline_version=state.after_outline_version,
        project_id=state.project_id,
        items=cleaned,
        is_confirmed=False,
    )
    storage.save_outline(outline)
    _maybe_auto_name_project_from_outline(
        _root(), state.project_id, outline.outline_version
    )
    return outline


def _list_uploaded_images(project_id: str) -> list[str]:
    assets_dir = _project_dir(project_id) / "assets"
    if not assets_dir.exists():
        return []
    out: list[str] = []
    for ext in ("*.png", "*.jpg", "*.jpeg"):
        for f in sorted(assets_dir.glob(ext)):
            out.append(f.stem)
    return sorted(set(out))


def _sanitize_draft_item(
    draft: SlideDraftInput,
    known_sids: set[str],
    uploaded_images: list[str],
    existing_id: Optional[str] = None,
) -> tuple[Optional[OutlineItem], Optional[str]]:
    """Validate and sanitize a SlideDraftInput into an OutlineItem."""
    title = (draft.title or "").strip()
    summary = (draft.summary or "").strip()
    if not title:
        return None, "标题不能为空。"
    if not summary:
        return None, "正文/副标题内容不能为空。"

    layout = SlideLayout(draft.layout)
    col_right = (draft.column_right or "").strip() or None
    img_id = (draft.image_asset_id or "").strip() or None
    notes = (draft.speaker_notes or "").strip() or None

    if layout == SlideLayout.TWO_COLUMN and not col_right:
        return None, "版式 'two_column' 必须填写非空的 column_right（右栏内容）。"

    if layout == SlideLayout.TEXT_IMAGE:
        if not uploaded_images:
            return (
                None,
                "项目尚未上传任何图片，不能使用 'text_image' 版式，请改用 'content'、'bullets' 或 'two_column'。",
            )
        if not img_id:
            return (
                None,
                f"版式 'text_image' 必须指定已上传图片的 image_asset_id，当前可用图片：{uploaded_images}。",
            )
        # Allow stem or filename match
        assets_dir = None
        if img_id not in uploaded_images:
            stem = pathlib.Path(img_id).stem
            if stem in uploaded_images:
                img_id = stem
            else:
                return (
                    None,
                    f"图片 '{img_id}' 不存在，当前项目可用图片：{uploaded_images}。",
                )
        _ = assets_dir

    valid_sids = [s for s in dict.fromkeys(draft.source_ids) if s in known_sids]
    if valid_sids:
        status = (
            EvidenceStatus.PARTIAL
            if draft.evidence_status == "partial"
            else EvidenceStatus.SUPPORTED
        )
    else:
        status = EvidenceStatus.UNSUPPORTED

    item = OutlineItem(
        outline_item_id=existing_id or f"slide-{uuid.uuid4().hex[:6]}",
        title=title,
        summary=summary,
        source_ids=valid_sids,
        evidence_status=status,
        layout=layout,
        column_right=col_right,
        image_asset_id=img_id,
        speaker_notes=notes,
    )
    return normalize_outline_item_text(item), None


def _build_in_memory_artifact(
    outline: Outline, theme_id: str, auto_fit: bool
) -> Artifact:
    """Build an in-memory Artifact from an Outline for deterministic layout dry-run."""
    n = len(outline.items)
    slides: list[Slide] = []
    for idx, raw_item in enumerate(outline.items):
        item = normalize_outline_item_text(raw_item)
        slide_id = f"slide-{idx + 1:03d}"
        source_id = item.source_ids[0] if item.source_ids else None
        layout = item.layout
        if layout is None:
            if idx == 0:
                layout = SlideLayout.COVER
            elif idx == n - 1 and n > 1:
                layout = SlideLayout.CLOSING
            else:
                layout = SlideLayout.CONTENT

        elements = [
            SlideElement(
                element_id=f"{slide_id}-title",
                type="title",
                content=item.title,
                source_id=source_id,
            )
        ]
        if layout == SlideLayout.BULLETS:
            lines = [ln for ln in item.summary.split("\n") if ln.strip()]
            for bi, line in enumerate(lines, start=1):
                elements.append(
                    SlideElement(
                        element_id=f"{slide_id}-bullet-{bi}",
                        type="bullet",
                        content=line,
                        source_id=source_id,
                    )
                )
        elif layout == SlideLayout.TWO_COLUMN:
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-column-left",
                    type="column_left",
                    content=item.summary,
                    source_id=source_id,
                )
            )
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-column-right",
                    type="column_right",
                    content=item.column_right or "",
                    source_id=source_id,
                )
            )
        elif layout == SlideLayout.TEXT_IMAGE:
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-text",
                    type="text",
                    content=item.summary,
                    source_id=source_id,
                )
            )
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-image",
                    type="image",
                    content=item.image_asset_id or "",
                    source_id=source_id,
                )
            )
        else:
            role = {
                SlideLayout.COVER: "subtitle",
                SlideLayout.CONTENT: "text",
                SlideLayout.CLOSING: "conclusion",
            }[layout]
            elements.append(
                SlideElement(
                    element_id=f"{slide_id}-{role}",
                    type=role,
                    content=item.summary,
                    source_id=source_id,
                )
            )

        slides.append(
            Slide(
                slide_id=slide_id,
                layout=layout,
                elements=elements,
                speaker_notes=item.speaker_notes,
                custom_bg=item.custom_bg,
                custom_elements=item.custom_elements,
            )
        )

    return Artifact(
        artifact_id="art-dryrun",
        project_id=outline.project_id,
        artifact_revision=1,
        slides=slides,
        outline_version=outline.outline_version,
        template_id=resolve_theme_id(theme_id),
        auto_fit=auto_fit,
    )


# ── Project-Scoped PPT Agent Tool Factory ─────────────────────────────────────


def build_studio_tools(state: StudioTurnState) -> list[Any]:
    """Create the project-bound toolset for a single Studio Agent turn."""

    @function_tool
    def get_deck_state() -> str:
        """获取当前演示文稿的完整状态，包括名称、主题、页数、当前选中页码以及每一页的标题、正文、版式、配图、备注与素材依据。"""
        meta = _load_meta(state.project_id)
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        images = _list_uploaded_images(state.project_id)
        slides_info = []
        if outline:
            total = len(outline.items)
            for idx, it in enumerate(outline.items):
                eff_layout = (
                    it.layout.value
                    if it.layout
                    else ("cover" if idx == 0 else ("closing" if idx == total - 1 and total > 1 else "content"))
                )
                slides_info.append(
                    {
                        "slide_number": idx + 1,
                        "is_current_selected": idx == state.selected_slide_index,
                        "layout": eff_layout,
                        "title": it.title,
                        "summary": it.summary,
                        "column_right": it.column_right,
                        "image_asset_id": it.image_asset_id,
                        "speaker_notes": it.speaker_notes,
                        "source_ids": it.source_ids,
                        "evidence_status": it.evidence_status.value,
                        "is_custom_canvas": bool(it.custom_elements),
                        "custom_bg": it.custom_bg,
                        "custom_elements": (
                            [el.model_dump(exclude_none=True) for el in it.custom_elements]
                            if it.custom_elements
                            else None
                        ),
                    }
                )
        raw_brand = meta.get("brand") if isinstance(meta.get("brand"), dict) else None
        theme_spec = apply_brand_to_theme(get_theme(state.active_theme_id), raw_brand)
        summary_msg = f"共 {len(slides_info)} 页，主题「{theme_spec.name}」"
        state.last_tool_summaries["get_deck_state"] = summary_msg
        return json.dumps(
            {
                "project_name": meta.get("name") or state.project_id,
                "theme_id": state.active_theme_id,
                "theme_name": theme_spec.name,
                "custom_palette_active": has_custom_palette(raw_brand),
                "custom_palette": (
                    {
                        "palette_name": raw_brand.get("palette_name"),
                        "cover_bg_hex": raw_brand.get("cover_bg_hex"),
                        "bg_hex": raw_brand.get("bg_hex"),
                        "accent_hex": raw_brand.get("accent_hex"),
                        "surface_hex": raw_brand.get("surface_hex"),
                    }
                    if has_custom_palette(raw_brand) and raw_brand
                    else None
                ),
                "auto_fit": state.auto_fit,
                "selected_slide_number": state.selected_slide_index + 1,
                "total_slides": len(slides_info),
                "uploaded_images": images,
                "outline_confirmed": bool(outline and outline.is_confirmed),
                "slides": slides_info,
            },
            ensure_ascii=False,
        )

    @function_tool
    def read_project_materials(query: Optional[str] = None) -> str:
        """读取项目已上传的全部文档素材、文本切片（含真实 source_id）与图片列表。可传 query 按关键词优先筛选相关切片。"""
        out = _raw(tools_module.read_materials)(project_id=state.project_id)
        mats_by_id = {m.asset_id: m for m in out.materials}
        images = [m.asset_id for m in out.materials if m.asset_type.value == "image"]

        frags_payload = []
        q = (query or "").strip().lower()
        for frag in out.source_fragments:
            mat = mats_by_id.get(frag.asset_id)
            excerpt = frag.content_preview or ""
            if mat and mat.asset_type.value != "image" and mat.content:
                m = re.search(r"L(\d+)-L(\d+)$", frag.location or "")
                if m:
                    s_idx = max(0, int(m.group(1)) - 1)
                    e_idx = int(m.group(2))
                    sliced = "\n".join(mat.content.splitlines()[s_idx:e_idx]).strip()
                    if sliced:
                        excerpt = sliced
                elif not excerpt:
                    excerpt = mat.content[:600]
            if len(excerpt) > 800:
                excerpt = excerpt[:800] + "…"
            entry = {
                "source_id": frag.source_id,
                "asset_id": frag.asset_id,
                "location": frag.location,
                "content": excerpt,
            }
            if not q or q in frag.asset_id.lower() or q in excerpt.lower():
                frags_payload.append(entry)

        # If query filtered everything out, return all fragments so model isn't blind
        if q and not frags_payload:
            for frag in out.source_fragments[:20]:
                frags_payload.append(
                    {
                        "source_id": frag.source_id,
                        "asset_id": frag.asset_id,
                        "location": frag.location,
                        "content": (frag.content_preview or "")[:500],
                    }
                )

        state.last_tool_summaries["read_project_materials"] = (
            f"{len(out.materials)} 份素材、{len(out.source_fragments)} 处切片"
        )
        return json.dumps(
            {
                "material_count": len(out.materials),
                "uploaded_images": images,
                "fragments": frags_payload[:30],
            },
            ensure_ascii=False,
        )

    @function_tool
    def create_deck_outline(slides: list[SlideDraftInput]) -> str:
        """从零创建或整体替换当前项目的完整幻灯片大纲，并立即刷新工作台画布。"""
        if not slides:
            return "ERROR: slides 不能为空，请至少提供 1 页幻灯片。"
        # Ensure sources.json is fresh
        mat_out = _raw(tools_module.read_materials)(project_id=state.project_id)
        known_sids = {f.source_id for f in mat_out.source_fragments}
        uploaded_images = _list_uploaded_images(state.project_id)

        built_items: list[OutlineItem] = []
        for idx, draft in enumerate(slides, start=1):
            item, err = _sanitize_draft_item(draft, known_sids, uploaded_images)
            if err or item is None:
                return f"ERROR: 第 {idx} 页校验失败：{err}"
            built_items.append(item)

        errors = validate_outline(
            built_items, known_sids, allow_empty_sources_for_unsupported=True
        )
        if errors:
            return "ERROR: 大纲校验失败：\n" + "\n".join(errors)

        outline = _persist_turn_outline(state, built_items)
        state.touched_slides.update(range(1, len(built_items) + 1))
        state.last_tool_summaries["create_deck_outline"] = (
            f"已生成 {len(built_items)} 页大纲"
        )
        return json.dumps(
            {
                "ok": True,
                "outline_version": outline.outline_version,
                "total_slides": len(built_items),
            },
            ensure_ascii=False,
        )

    @function_tool
    def update_slide(
        slide_number: int,
        title: Optional[str] = None,
        summary: Optional[str] = None,
        layout: Optional[LayoutLiteral] = None,
        column_right: Optional[str] = None,
        image_asset_id: Optional[str] = None,
        speaker_notes: Optional[str] = None,
        source_ids: Optional[list[str]] = None,
        evidence_status: Optional[EvidenceLiteral] = None,
        clear_custom_layout: bool = False,
    ) -> str:
        """精准更新指定页码（从 1 开始）的局部或全部字段；若需将自由画布还原为标准版式，传 clear_custom_layout=True。"""
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        if not outline or not outline.items:
            return "ERROR: 当前项目还没有大纲，请先使用 create_deck_outline 创建大纲。"
        if slide_number < 1 or slide_number > len(outline.items):
            return f"ERROR: 页码 {slide_number} 越界，当前共有 {len(outline.items)} 页。"

        mat_out = _raw(tools_module.read_materials)(project_id=state.project_id)
        known_sids = {f.source_id for f in mat_out.source_fragments}
        uploaded_images = _list_uploaded_images(state.project_id)

        idx = slide_number - 1
        cur = outline.items[idx]
        merged_layout = layout or (
            cur.layout.value
            if cur.layout
            else ("cover" if idx == 0 else ("closing" if idx == len(outline.items) - 1 and len(outline.items) > 1 else "content"))
        )
        merged_draft = SlideDraftInput(
            title=title if title is not None else cur.title,
            summary=summary if summary is not None else cur.summary,
            layout=merged_layout,  # type: ignore[arg-type]
            column_right=(
                column_right if column_right is not None else cur.column_right
            ),
            image_asset_id=(
                image_asset_id if image_asset_id is not None else cur.image_asset_id
            ),
            speaker_notes=(
                speaker_notes if speaker_notes is not None else cur.speaker_notes
            ),
            source_ids=source_ids if source_ids is not None else cur.source_ids,
            evidence_status=(
                evidence_status
                if evidence_status is not None
                else cur.evidence_status.value  # type: ignore[arg-type]
            ),
        )
        updated_item, err = _sanitize_draft_item(
            merged_draft, known_sids, uploaded_images, existing_id=cur.outline_item_id
        )
        if err or updated_item is None:
            return f"ERROR: 第 {slide_number} 页更新失败：{err}"

        # Preserve custom canvas unless explicitly cleared or switching to a different standard layout
        keep_custom = (
            not clear_custom_layout
            and layout is None
            and cur.custom_elements is not None
        )
        if keep_custom:
            updated_item = updated_item.model_copy(
                update={
                    "custom_bg": cur.custom_bg,
                    "custom_elements": cur.custom_elements,
                }
            )

        new_items = list(outline.items)
        new_items[idx] = updated_item
        saved = _persist_turn_outline(state, new_items)
        state.touched_slides.add(slide_number)
        state.last_tool_summaries["update_slide"] = f"已更新第 {slide_number} 页"
        return json.dumps(
            {
                "ok": True,
                "slide_number": slide_number,
                "outline_version": saved.outline_version,
                "title": updated_item.title,
            },
            ensure_ascii=False,
        )

    @function_tool
    def batch_update_slides(updates: list[SlidePatchInput]) -> str:
        """一次批量更新多页幻灯片（适合全稿润色、统一口吻、批量补齐演讲者备注等）。"""
        if not updates:
            return "ERROR: updates 不能为空。"
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        if not outline or not outline.items:
            return "ERROR: 当前项目还没有大纲，请先使用 create_deck_outline 创建大纲。"

        mat_out = _raw(tools_module.read_materials)(project_id=state.project_id)
        known_sids = {f.source_id for f in mat_out.source_fragments}
        uploaded_images = _list_uploaded_images(state.project_id)

        new_items = list(outline.items)
        touched_now: list[int] = []
        for patch in updates:
            sn = patch.slide_number
            if sn < 1 or sn > len(new_items):
                return f"ERROR: 页码 {sn} 越界，当前共有 {len(new_items)} 页。"
            idx = sn - 1
            cur = new_items[idx]
            merged_layout = patch.layout or (
                cur.layout.value
                if cur.layout
                else ("cover" if idx == 0 else ("closing" if idx == len(new_items) - 1 and len(new_items) > 1 else "content"))
            )
            merged = SlideDraftInput(
                title=patch.title if patch.title is not None else cur.title,
                summary=patch.summary if patch.summary is not None else cur.summary,
                layout=merged_layout,  # type: ignore[arg-type]
                column_right=(
                    patch.column_right
                    if patch.column_right is not None
                    else cur.column_right
                ),
                image_asset_id=(
                    patch.image_asset_id
                    if patch.image_asset_id is not None
                    else cur.image_asset_id
                ),
                speaker_notes=(
                    patch.speaker_notes
                    if patch.speaker_notes is not None
                    else cur.speaker_notes
                ),
                source_ids=(
                    patch.source_ids if patch.source_ids is not None else cur.source_ids
                ),
                evidence_status=(
                    patch.evidence_status
                    if patch.evidence_status is not None
                    else cur.evidence_status.value  # type: ignore[arg-type]
                ),
            )
            updated_item, err = _sanitize_draft_item(
                merged, known_sids, uploaded_images, existing_id=cur.outline_item_id
            )
            if err or updated_item is None:
                return f"ERROR: 第 {sn} 页更新失败：{err}"
            if patch.layout is None and cur.custom_elements is not None:
                updated_item = updated_item.model_copy(
                    update={
                        "custom_bg": cur.custom_bg,
                        "custom_elements": cur.custom_elements,
                    }
                )
            new_items[idx] = updated_item
            touched_now.append(sn)

        saved = _persist_turn_outline(state, new_items)
        state.touched_slides.update(touched_now)
        state.last_tool_summaries["batch_update_slides"] = (
            f"已批量更新 {len(set(touched_now))} 页"
        )
        return json.dumps(
            {
                "ok": True,
                "outline_version": saved.outline_version,
                "updated_slides": sorted(set(touched_now)),
            },
            ensure_ascii=False,
        )

    @function_tool
    def manage_slides(
        action: Literal["add", "delete", "move"],
        slide_number: Optional[int] = None,
        target_position: Optional[int] = None,
        slide: Optional[SlideDraftInput] = None,
    ) -> str:
        """增删或移动幻灯片：action='add' 新增一页（需传 slide，可选 target_position）；action='delete' 删除 slide_number；action='move' 将 slide_number 移动到 target_position（均从 1 开始）。"""
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        if not outline or not outline.items:
            return "ERROR: 当前项目还没有大纲，请先使用 create_deck_outline 创建大纲。"

        items = list(outline.items)
        if action == "add":
            if slide is None:
                return "ERROR: action='add' 时必须提供 slide 参数。"
            mat_out = _raw(tools_module.read_materials)(project_id=state.project_id)
            known_sids = {f.source_id for f in mat_out.source_fragments}
            uploaded_images = _list_uploaded_images(state.project_id)
            new_item, err = _sanitize_draft_item(slide, known_sids, uploaded_images)
            if err or new_item is None:
                return f"ERROR: 新增幻灯片失败：{err}"
            if target_position is None:
                # Insert before closing slide if last slide is closing
                last_layout = items[-1].layout
                pos = len(items) - 1 if (len(items) > 1 and last_layout == SlideLayout.CLOSING) else len(items)
            else:
                pos = max(0, min(len(items), target_position - 1))
            items.insert(pos, new_item)
            saved = _persist_turn_outline(state, items)
            inserted_num = pos + 1
            state.touched_slides.add(inserted_num)
            state.last_tool_summaries["manage_slides"] = f"已新增第 {inserted_num} 页"
            return json.dumps(
                {
                    "ok": True,
                    "action": "add",
                    "slide_number": inserted_num,
                    "total_slides": len(items),
                    "outline_version": saved.outline_version,
                },
                ensure_ascii=False,
            )

        if action == "delete":
            if slide_number is None or slide_number < 1 or slide_number > len(items):
                return f"ERROR: 请提供有效页码 slide_number（1–{len(items)}）。"
            if len(items) <= 1:
                return "ERROR: 文稿至少保留 1 页幻灯片，无法删除最后一页。"
            removed = items.pop(slide_number - 1)
            saved = _persist_turn_outline(state, items)
            state.touched_slides.add(min(slide_number, len(items)))
            state.last_tool_summaries["manage_slides"] = f"已删除第 {slide_number} 页"
            return json.dumps(
                {
                    "ok": True,
                    "action": "delete",
                    "removed_title": removed.title,
                    "total_slides": len(items),
                    "outline_version": saved.outline_version,
                },
                ensure_ascii=False,
            )

        # action == "move"
        if (
            slide_number is None
            or target_position is None
            or slide_number < 1
            or slide_number > len(items)
            or target_position < 1
            or target_position > len(items)
        ):
            return f"ERROR: move 需要有效的 slide_number 和 target_position（1–{len(items)}）。"
        moved = items.pop(slide_number - 1)
        items.insert(target_position - 1, moved)
        saved = _persist_turn_outline(state, items)
        state.touched_slides.add(target_position)
        state.last_tool_summaries["manage_slides"] = (
            f"已将第 {slide_number} 页移至第 {target_position} 页"
        )
        return json.dumps(
            {
                "ok": True,
                "action": "move",
                "from": slide_number,
                "to": target_position,
                "outline_version": saved.outline_version,
            },
            ensure_ascii=False,
        )

    @function_tool
    def design_custom_slide(
        slide_number: int,
        elements: list[CanvasElement],
        background: Optional[str] = "theme:bg",
        title: Optional[str] = None,
        summary: Optional[str] = None,
        speaker_notes: Optional[str] = None,
        source_ids: Optional[list[str]] = None,
        evidence_status: Optional[EvidenceLiteral] = None,
    ) -> str:
        """为指定页码（从 1 开始）设计自由画布排版（960x540 pt 坐标系）。支持 6 种原生可编辑元素：card（圆角矩形卡片）、line（线条）、image（已上传图片）、text（文本框）、table（原生可编辑表格：headers + rows）、chart（原生可编辑数据图表：chart_type=bar/hbar/line/donut + chart_categories + chart_series）。优先使用 theme:* 语义色以兼容全局换肤。保存前会自动执行越界、表格/图表校验、文本溢出与元素碰撞检测。"""
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        if not outline or not outline.items:
            return "ERROR: 当前项目还没有大纲，请先使用 create_deck_outline 创建大纲。"
        if slide_number < 1 or slide_number > len(outline.items):
            return f"ERROR: 页码 {slide_number} 越界，当前共有 {len(outline.items)} 页。"
        if not elements:
            return "ERROR: elements 不能为空，请至少提供 1 个画布元素。"

        # Ensure unique IDs & unescape text
        seen_ids: set[str] = set()
        cleaned_elements: list[CanvasElement] = []
        assets_dir = _project_dir(state.project_id) / "assets"
        uploaded_images = _list_uploaded_images(state.project_id)

        for idx_el, raw_el in enumerate(elements, start=1):
            eid = (raw_el.id or f"el-{idx_el}").strip()
            if eid in seen_ids:
                eid = f"{eid}-{idx_el}"
            seen_ids.add(eid)

            if raw_el.kind == "image":
                img_ref = (raw_el.image_asset_id or "").strip()
                if not img_ref or _resolve_image_path(img_ref, assets_dir) is None:
                    return (
                        f"ERROR: 元素 '{eid}' 引用的图片 '{img_ref}' 不存在，"
                        f"当前项目可用图片：{uploaded_images}。"
                    )
                cleaned_elements.append(
                    raw_el.model_copy(update={"id": eid, "image_asset_id": pathlib.Path(img_ref).stem})
                )
            elif raw_el.kind == "text":
                clean_txt = (raw_el.text or "").replace("\\r\\n", "\n").replace("\\n", "\n")
                cleaned_elements.append(
                    raw_el.model_copy(update={"id": eid, "text": clean_txt})
                )
            else:
                cleaned_elements.append(raw_el.model_copy(update={"id": eid}))

        # Run real deterministic bounds + overflow + text-overlap measurement BEFORE saving
        idx = slide_number - 1
        cur = outline.items[idx]
        probe_slide = Slide(
            slide_id=f"slide-{slide_number:03d}",
            layout=cur.layout or SlideLayout.CONTENT,
            elements=[
                SlideElement(
                    element_id=f"slide-{slide_number:03d}-title",
                    type="title",
                    content=title or cur.title,
                )
            ],
            custom_bg=background or "theme:bg",
            custom_elements=cleaned_elements,
        )
        measure_errors: list[str] = []
        _measure_custom_slide(
            probe_slide, load_fonts(), state.auto_fit, {}, measure_errors
        )
        if measure_errors:
            return (
                "ERROR: 自由画布排版未通过自检，请调整坐标、框高或字号后重试：\n"
                + "\n".join(measure_errors)
            )

        mat_out = _raw(tools_module.read_materials)(project_id=state.project_id)
        known_sids = {f.source_id for f in mat_out.source_fragments}
        next_sids = (
            [s for s in dict.fromkeys(source_ids) if s in known_sids]
            if source_ids is not None
            else cur.source_ids
        )
        if next_sids:
            next_status = (
                EvidenceStatus.PARTIAL
                if evidence_status == "partial"
                else EvidenceStatus.SUPPORTED
            )
        else:
            next_status = EvidenceStatus.UNSUPPORTED

        # Derive readable title/summary fallback from text elements if not explicitly passed
        text_els = [el for el in cleaned_elements if el.kind == "text" and (el.text or "").strip()]
        derived_title = title
        if not derived_title and text_els:
            largest = max(text_els, key=lambda e: int(e.font_size or 18))
            first_ln = (largest.text or "").splitlines()[0].strip()
            if first_ln:
                derived_title = first_ln[:60]

        updated_item = cur.model_copy(
            update={
                "title": (derived_title or cur.title).strip(),
                "summary": (summary if summary is not None else cur.summary).strip() or cur.summary,
                "speaker_notes": (
                    speaker_notes.strip() if speaker_notes is not None else cur.speaker_notes
                ),
                "source_ids": next_sids,
                "evidence_status": next_status,
                "custom_bg": background or "theme:bg",
                "custom_elements": cleaned_elements,
            }
        )
        new_items = list(outline.items)
        new_items[idx] = updated_item
        saved = _persist_turn_outline(state, new_items)
        state.touched_slides.add(slide_number)
        state.layout_checked_ok = True
        state.last_tool_summaries["design_custom_slide"] = (
            f"已自由排版第 {slide_number} 页（{len(cleaned_elements)} 个元素）"
        )
        return json.dumps(
            {
                "ok": True,
                "slide_number": slide_number,
                "element_count": len(cleaned_elements),
                "outline_version": saved.outline_version,
            },
            ensure_ascii=False,
        )

    @function_tool
    def check_deck_layout() -> str:
        """使用真实字体测量引擎对当前大纲执行排版安全检查（检测文字溢出、自定义画布重叠/越界、缺失配图），同时输出全稿视觉节奏诊断建议。"""
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        if not outline or not outline.items:
            return "ERROR: 当前项目还没有大纲可供检查。"

        artifact = _build_in_memory_artifact(
            outline, state.active_theme_id, state.auto_fit
        )
        issues: list[str] = list(validate_ir(artifact))

        assets_dir = _project_dir(state.project_id) / "assets"
        for idx, slide in enumerate(artifact.slides, start=1):
            if slide.custom_elements:
                for cel in slide.custom_elements:
                    if cel.kind == "image":
                        if _resolve_image_path(cel.image_asset_id or "", assets_dir) is None:
                            issues.append(
                                f"第 {idx} 页自由画布元素 '{cel.id}' 找不到配图 '{cel.image_asset_id}'。"
                            )
                continue
            for el in slide.elements:
                if el.type == "image":
                    if _resolve_image_path(el.content, assets_dir) is None:
                        issues.append(
                            f"第 {idx} 页缺少或找不到配图 '{el.content}'。"
                        )

        theme = get_theme(artifact.template_id)
        fonts = load_fonts()
        _, measure_errors = _measure_and_resolve(
            artifact, fonts, auto_fit=state.auto_fit, decorative=theme.decorative
        )
        issues.extend(measure_errors)

        # Lightweight deterministic visual rhythm diagnostics
        rhythm_notes: list[str] = []
        total = len(outline.items)
        eff_layouts: list[str] = []
        for idx, it in enumerate(outline.items, start=1):
            if it.custom_elements:
                eff_layouts.append("custom")
            else:
                lv = (
                    it.layout.value
                    if it.layout
                    else ("cover" if idx == 1 else ("closing" if idx == total and total > 1 else "content"))
                )
                eff_layouts.append(lv)
                if len(it.summary.strip()) > 190:
                    rhythm_notes.append(
                        f"第 {idx} 页文字偏密（{len(it.summary.strip())} 字），可精简要点、拆页或改用卡片自由排版。"
                    )
                if lv == "bullets":
                    bc = len([ln for ln in it.summary.splitlines() if ln.strip()])
                    if bc > 5:
                        rhythm_notes.append(
                            f"第 {idx} 页分点较多（{bc} 条），建议精简至 3–4 条或拆分为双栏/多卡片。"
                        )
                if lv in ("content", "bullets") and len(re.findall(r"\d+(?:\.\d+)?\s*[%倍×xX]", it.summary)) >= 2:
                    rhythm_notes.append(
                        f"第 {idx} 页包含多个量化指标，适合用自由画布改造成大数字指标卡提升视觉冲击力。"
                    )

        # Detect 3+ consecutive identical non-custom layouts
        run_len = 1
        for i in range(1, len(eff_layouts)):
            if eff_layouts[i] == eff_layouts[i - 1] and eff_layouts[i] not in ("cover", "closing", "custom"):
                run_len += 1
                if run_len == 3:
                    rhythm_notes.append(
                        f"第 {i - 1}–{i + 1} 页连续使用相同版式（{eff_layouts[i]}），可调整其中一页版式或用自由画布制造节奏变化。"
                    )
            else:
                run_len = 1

        if not issues:
            state.layout_checked_ok = True
            state.last_tool_summaries["check_deck_layout"] = (
                f"全部 {total} 页排版安全"
            )
            return json.dumps(
                {
                    "ok": True,
                    "total_slides": total,
                    "message": f"全部 {total} 页排版安全，无文字溢出或重叠问题。",
                    "rhythm_suggestions": rhythm_notes,
                },
                ensure_ascii=False,
            )

        state.layout_checked_ok = False
        state.last_tool_summaries["check_deck_layout"] = f"发现 {len(issues)} 处排版问题"
        return json.dumps(
            {"ok": False, "issues": issues, "rhythm_suggestions": rhythm_notes},
            ensure_ascii=False,
        )

    @function_tool
    def set_deck_theme(
        theme_id: Optional[
            Literal["keynote_light", "keynote_dark", "nordic_pine", "gallery_sand"]
        ] = None,
        auto_fit: Optional[bool] = None,
    ) -> str:
        """切换当前文稿的演示主题（keynote_light 苹果白 / keynote_dark 深空钛黑 / nordic_pine 松柏森绿 / gallery_sand 美术馆暖石）或开启/关闭导出自动缩字。"""
        if theme_id is None and auto_fit is None:
            return "ERROR: 请至少指定 theme_id 或 auto_fit。"
        meta = _load_meta(state.project_id)
        changes = []
        if theme_id is not None:
            if not is_valid_theme(theme_id):
                valid_names = [f"{t['id']}({t['name']})" for t in list_themes()]
                return f"ERROR: 不支持的主题 '{theme_id}'，可选：{', '.join(valid_names)}"
            resolved = resolve_theme_id(theme_id)
            meta["theme_id"] = resolved
            if has_custom_palette(meta.get("brand")):
                next_brand = clear_brand_palette_overrides(meta.get("brand"))
                if next_brand:
                    meta["brand"] = next_brand
                else:
                    meta.pop("brand", None)
                state.brand_changed = True
                state.palette_name_changed_to = None
            _save_meta(state.project_id, meta)
            state.active_theme_id = resolved
            state.theme_changed_to = resolved
            t_name = next((t["name"] for t in list_themes() if t["id"] == resolved), resolved)
            changes.append(f"主题切换为「{t_name}」")
        if auto_fit is not None:
            state.auto_fit = auto_fit
            state.auto_fit_changed_to = auto_fit
            changes.append("已开启自动缩字" if auto_fit else "已关闭自动缩字")
        summary = "，".join(changes)
        state.last_tool_summaries["set_deck_theme"] = summary
        return json.dumps({"ok": True, "summary": summary}, ensure_ascii=False)

    @function_tool
    def set_custom_palette(
        palette_name: Optional[str] = None,
        cover_bg_hex: Optional[str] = None,
        bg_hex: Optional[str] = None,
        accent_hex: Optional[str] = None,
        surface_hex: Optional[str] = None,
        reset_to_preset: bool = False,
    ) -> str:
        """为整套文稿定制全局自定义配色（当用户 4 套预设都不喜欢或指定了任意风格色系时使用）。只需提供和谐的封面底色 cover_bg_hex、正文底色 bg_hex 和强调色 accent_hex（均为 #RRGGBB），系统会自动按对比度推导安全的标题色、正文色、分割线、卡片底色与图表色板；传入 reset_to_preset=True 可清除自定义配色并恢复当前预设主题。"""
        meta = _load_meta(state.project_id)
        existing_brand = meta.get("brand") if isinstance(meta.get("brand"), dict) else {}

        if reset_to_preset:
            next_brand = clear_brand_palette_overrides(existing_brand)
            if next_brand:
                meta["brand"] = next_brand
            else:
                meta.pop("brand", None)
            _save_meta(state.project_id, meta)
            state.brand_changed = True
            state.palette_name_changed_to = None
            base_name = get_theme(state.active_theme_id).name
            summary = f"已恢复预设主题「{base_name}」"
            state.last_tool_summaries["set_custom_palette"] = summary
            return json.dumps({"ok": True, "summary": summary}, ensure_ascii=False)

        if not any((palette_name, cover_bg_hex, bg_hex, accent_hex, surface_hex)):
            return "ERROR: 请至少提供一个颜色参数（如 cover_bg_hex、bg_hex 或 accent_hex）。"

        merged_payload = {
            "palette_name": (
                palette_name
                if palette_name is not None
                else existing_brand.get("palette_name")
            ),
            "cover_bg_hex": (
                cover_bg_hex
                if cover_bg_hex is not None
                else existing_brand.get("cover_bg_hex")
            ),
            "bg_hex": bg_hex if bg_hex is not None else existing_brand.get("bg_hex"),
            "accent_hex": (
                accent_hex
                if accent_hex is not None
                else existing_brand.get("accent_hex")
            ),
            "surface_hex": (
                surface_hex
                if surface_hex is not None
                else existing_brand.get("surface_hex")
            ),
            "footer_text": existing_brand.get("footer_text"),
            "logo_asset_id": existing_brand.get("logo_asset_id"),
            "logo_position": existing_brand.get("logo_position") or "top_right",
        }
        try:
            cleaned = BrandKit.model_validate(merged_payload).cleaned()
        except Exception as exc:
            return f"ERROR: 颜色格式无效（需使用 6 位十六进制如 #1B365D）：{exc}"

        brand_dict = cleaned.model_dump()
        if has_any_brand_fields(brand_dict):
            meta["brand"] = brand_dict
        else:
            meta.pop("brand", None)
        _save_meta(state.project_id, meta)

        resolved_theme = apply_brand_to_theme(
            get_theme(state.active_theme_id), meta.get("brand")
        )
        display_name = cleaned.palette_name or "自定义配色"
        state.brand_changed = True
        state.palette_name_changed_to = display_name
        summary = f"已应用「{display_name}」全局配色"
        state.last_tool_summaries["set_custom_palette"] = summary
        return json.dumps(
            {
                "ok": True,
                "summary": summary,
                "palette_name": display_name,
                "resolved_swatches": resolved_theme.to_public_dict()["swatches"],
            },
            ensure_ascii=False,
        )

    @function_tool
    def export_deck_now() -> str:
        """确认当前大纲并编译导出 PPTX、矢量 PDF 与高清预览图。仅在用户明确要求导出/生成成品时调用。"""
        ver = state.current_outline_version()
        outline = _load_outline(state.project_id, ver)
        if not outline or not outline.items:
            return "ERROR: 当前还没有大纲，无法导出。"

        storage = ProjectStorage(state.project_id, storage_root=_root())
        if not outline.is_confirmed:
            outline = outline.model_copy(update={"is_confirmed": True})
            storage.save_outline(outline)

        idem_key = f"chat-export-{outline.outline_version}-{state.active_theme_id}-{int(state.auto_fit)}-{uuid.uuid4().hex[:6]}"
        artifact = _raw(tools_module.generate_slides)(
            project_id=state.project_id,
            approved_outline_version=outline.outline_version,
            template_id=state.active_theme_id,
            idempotency_key=idem_key,
            auto_fit=state.auto_fit,
        )
        validation = _raw(tools_module.validate_artifact)(
            artifact_id=artifact.artifact_id,
            revision=artifact.artifact_revision,
        )
        blocking = [iss for iss in validation.issues if str(iss.level.value).lower() == "error"]
        if blocking:
            msgs = [f"{iss.slide_id or ''}: {iss.message}" for iss in blocking]
            return json.dumps({"ok": False, "issues": msgs}, ensure_ascii=False)

        export_res = tools_module.export_deck_impl(
            project_id=state.project_id,
            artifact_id=artifact.artifact_id,
            revision=artifact.artifact_revision,
            idempotency_key=f"export-{idem_key}",
        )
        if not export_res.success or not export_res.pptx_path:
            msgs = [f"{iss.slide_id or ''}: {iss.message}" for iss in export_res.issues]
            return json.dumps({"ok": False, "issues": msgs}, ensure_ascii=False)

        from draftboard.render import render_preview

        preview_dir = (
            _project_dir(state.project_id)
            / "previews"
            / f"{artifact.artifact_id}-r{artifact.artifact_revision}"
        )
        render_preview(pathlib.Path(export_res.pptx_path), preview_dir)
        state.exported = True
        state.layout_checked_ok = True
        state.last_tool_summaries["export_deck_now"] = (
            f"已编译 {len(outline.items)} 页 PPTX 与 PDF"
        )
        return json.dumps(
            {
                "ok": True,
                "slide_count": len(outline.items),
                "download_pptx": f"/api/projects/{state.project_id}/download",
                "download_pdf": f"/api/projects/{state.project_id}/download/pdf",
            },
            ensure_ascii=False,
        )

    return [
        get_deck_state,
        read_project_materials,
        create_deck_outline,
        update_slide,
        batch_update_slides,
        manage_slides,
        design_custom_slide,
        check_deck_layout,
        set_deck_theme,
        set_custom_palette,
        export_deck_now,
    ]


# ── Prompt Construction & Streaming Runner ────────────────────────────────────


def _filter_clean_history(history: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Strip error assistant turns and their paired failed user messages from LLM context."""
    cleaned: list[dict[str, str]] = []
    n = len(history)
    i = 0
    while i < n:
        msg = history[i]
        role = msg.get("role")
        if msg.get("is_error"):
            i += 1
            continue
        if (
            role == "user"
            and i + 1 < n
            and history[i + 1].get("role") == "assistant"
            and history[i + 1].get("is_error")
        ):
            i += 2
            continue
        content = str(msg.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            cleaned.append({"role": role, "content": content})
        i += 1
    return cleaned[-12:]


def _drop_trailing_failed_turn(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove the trailing failed (user, error_assistant) turn when retrying."""
    trimmed = list(history)
    if trimmed and trimmed[-1].get("role") == "assistant" and trimmed[-1].get("is_error"):
        trimmed.pop()
        if trimmed and trimmed[-1].get("role") == "user":
            trimmed.pop()
    return trimmed


def _inspect_tool_output(tool_name: str, output: Any) -> tuple[str, str]:
    """Classify a tool's raw output into `(status, fallback_summary)`."""
    if not isinstance(output, str):
        return "done", ""
    trimmed = output.strip()
    if trimmed.startswith("ERROR:"):
        reason = trimmed[6:].strip()
        return "error", (reason[:56] + "…") if len(reason) > 56 else reason
    if trimmed.startswith("{"):
        try:
            parsed = json.loads(trimmed)
            if isinstance(parsed, dict) and parsed.get("ok") is False:
                issues = parsed.get("issues") or []
                if tool_name == "check_deck_layout":
                    label = (
                        f"发现 {len(issues)} 处排版问题"
                        if issues
                        else "检测到排版问题"
                    )
                    return "warning", label
                first = str(issues[0]).strip() if issues else "执行未通过"
                return "error", (first[:56] + "…") if len(first) > 56 else first
        except Exception:
            pass
    return "done", ""


def _build_turn_input(
    project_id: str,
    user_message: str,
    history: list[dict[str, Any]],
    state: StudioTurnState,
) -> list[dict[str, str]]:
    """Build multi-turn conversation messages with fresh live deck context."""
    meta = _load_meta(project_id)
    proj_name = meta.get("name") or DEFAULT_UNTITLED_NAME
    outline = _load_outline(project_id, state.before_outline_version)
    total = len(outline.items) if outline else 0
    cur_slide_hint = "暂无大纲"
    if outline and 0 <= state.selected_slide_index < total:
        cur_it = outline.items[state.selected_slide_index]
        cur_slide_hint = f"第 {state.selected_slide_index + 1} 页「{cur_it.title}」"

    raw_brand = meta.get("brand") if isinstance(meta.get("brand"), dict) else None
    active_theme_spec = apply_brand_to_theme(
        get_theme(state.active_theme_id), raw_brand
    )
    theme_hint = (
        f"自定义配色「{active_theme_spec.name}」（封面 {active_theme_spec.cover_bg_hex} / 正文 {active_theme_spec.bg_hex} / 强调 {active_theme_spec.accent_hex}）"
        if has_custom_palette(raw_brand)
        else f"主题 {active_theme_spec.name}（{state.active_theme_id}）"
    )
    context_header = (
        f"[当前工作台上下文：文稿名「{proj_name}」| 共 {total} 页 | "
        f"当前选中 {cur_slide_hint} | {theme_hint} | "
        f"自动缩字 {'开' if state.auto_fit else '关'}]"
    )

    items = _filter_clean_history(history)
    items.append({"role": "user", "content": f"{context_header}\n\n{user_message.strip()}"})
    return items


async def stream_studio_chat(
    project_id: str,
    user_message: str,
    *,
    selected_slide_index: int = 0,
    theme_id: str = "keynote_light",
    auto_fit: bool = True,
    replace_last_error: bool = False,
    model: Any = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run one streaming PPT Studio Agent turn and yield structured SSE event dicts."""
    is_real_runner = getattr(Runner.run_streamed, "__module__", "").startswith("agents")
    if model is None and is_real_runner and not llm_config.is_llm_configured():
        yield {
            "type": "error",
            "code": "LLM_NOT_CONFIGURED",
            "error": "尚未配置大模型，请先点击「模型设置」配置 API Key 或本地 Ollama。",
            "retryable": False,
        }
        return

    raw_history = load_chat_history(project_id)
    history = (
        _drop_trailing_failed_turn(raw_history)
        if replace_last_error
        else raw_history
    )
    before_ver = _latest_outline_version(project_id)

    state = StudioTurnState(
        project_id=project_id,
        selected_slide_index=max(0, selected_slide_index),
        active_theme_id=resolve_theme_id(theme_id) if is_valid_theme(theme_id) else "keynote_light",
        auto_fit=auto_fit,
        before_outline_version=before_ver,
    )

    user_msg_record: dict[str, Any] = {
        "id": f"msg-{uuid.uuid4().hex[:10]}",
        "role": "user",
        "content": user_message.strip(),
        "created_at": _now_iso(),
        "selected_slide": state.selected_slide_index + 1,
    }
    yield {"type": "user_saved", "message": user_msg_record}

    tools = build_studio_tools(state)
    agent = Agent(
        name="DraftboardStudioAgent",
        instructions=STUDIO_AGENT_INSTRUCTIONS,
        tools=tools,
        model=resolve_model(model),
    )
    turn_input = _build_turn_input(project_id, user_message, history, state)

    tool_steps: list[dict[str, Any]] = []
    pending_tool_ids: list[str] = []
    text_chunks: list[str] = []

    active_cfg = llm_config.resolve_effective_llm_config()
    active_model_name = (
        model if isinstance(model, str) and model.strip() else active_cfg.model
    )

    max_attempts = 2 if is_real_runner else 1
    last_exc: Optional[Exception] = None

    for attempt in range(max_attempts):
        try:
            streamed = Runner.run_streamed(agent, turn_input, max_turns=12)
            async for event in streamed.stream_events():
                ev_type = getattr(event, "type", "")
                if ev_type == "raw_response_event":
                    data = getattr(event, "data", None)
                    if getattr(data, "type", None) == "response.output_text.delta":
                        delta = getattr(data, "delta", "")
                        if delta:
                            text_chunks.append(delta)
                            yield {"type": "delta", "delta": delta}
                elif ev_type == "run_item_stream_event":
                    ev_name = getattr(event, "name", "")
                    item = getattr(event, "item", None)
                    if ev_name == "tool_called":
                        raw = getattr(item, "raw_item", None)
                        t_name = str(getattr(raw, "name", "") or "tool")
                        step_id = f"step-{uuid.uuid4().hex[:8]}"
                        step = {
                            "id": step_id,
                            "name": t_name,
                            "label": TOOL_LABELS_CN.get(t_name, t_name),
                            "status": "running",
                            "summary": "",
                        }
                        tool_steps.append(step)
                        pending_tool_ids.append(step_id)
                        yield {"type": "tool_start", "step": step}
                    elif ev_name == "tool_output":
                        step_id = pending_tool_ids.pop(0) if pending_tool_ids else None
                        matched = next(
                            (s for s in tool_steps if s["id"] == step_id),
                            tool_steps[-1] if tool_steps else None,
                        )
                        if matched is not None:
                            out_val = getattr(item, "output", None)
                            step_status, err_summary = _inspect_tool_output(
                                matched["name"], out_val
                            )
                            matched["status"] = step_status
                            matched["summary"] = (
                                err_summary
                                if step_status != "done" and err_summary
                                else state.last_tool_summaries.get(matched["name"], "")
                            )
                            yield {"type": "tool_done", "step": matched}
                        if state.has_changes():
                            yield {
                                "type": "deck_updated",
                                "changes": state.to_changes_dict(),
                            }

            final_text = "".join(text_chunks).strip()
            if not final_text and getattr(streamed, "final_output", None):
                final_text = str(streamed.final_output).strip()
                if final_text:
                    yield {"type": "delta", "delta": final_text}

            for st in tool_steps:
                if st["status"] == "running":
                    st["status"] = "done"

            assistant_msg_record: dict[str, Any] = {
                "id": f"msg-{uuid.uuid4().hex[:10]}",
                "role": "assistant",
                "content": final_text or "已完成处理。",
                "created_at": _now_iso(),
                "tool_steps": tool_steps,
                "changes": state.to_changes_dict(),
            }
            save_chat_history(project_id, [*history, user_msg_record, assistant_msg_record])
            yield {
                "type": "done",
                "message": assistant_msg_record,
                "changes": state.to_changes_dict(),
            }
            return
        except Exception as exc:
            last_exc = exc
            code, _, retryable = llm_config.classify_llm_error(exc, active_model_name)
            can_retry_silently = (
                attempt + 1 < max_attempts
                and retryable
                and code in ("RATE_LIMIT", "TIMEOUT_OR_NETWORK")
                and not text_chunks
                and not state.has_changes()
            )
            if can_retry_silently:
                tool_steps.clear()
                pending_tool_ids.clear()
                await asyncio.sleep(1.5)
                continue
            break

    assert last_exc is not None
    error_code, friendly_msg, retryable = llm_config.classify_llm_error(
        last_exc, active_model_name
    )
    raw_detail = str(last_exc).strip()[:600]
    changes_dict = state.to_changes_dict()

    if changes_dict and changes_dict.get("after_outline_version"):
        touched = changes_dict.get("touched_slides") or []
        if touched:
            pages_str = "、".join(str(p) for p in touched[:4])
            suffix = f" 等 {len(touched)} 页" if len(touched) > 4 else ""
            friendly_msg += f"\n\n注意：报错前已对第 {pages_str} 页{suffix}生效了部分修改，可在下方一键撤回。"
        else:
            friendly_msg += "\n\n注意：报错前已生成了部分修改，可在下方一键撤回。"

    error_record: dict[str, Any] = {
        "id": f"msg-{uuid.uuid4().hex[:10]}",
        "role": "assistant",
        "content": friendly_msg,
        "created_at": _now_iso(),
        "tool_steps": [
            {**s, "status": "error" if s["status"] == "running" else s["status"]}
            for s in tool_steps
        ],
        "changes": changes_dict,
        "is_error": True,
        "error_code": error_code,
        "error_detail": raw_detail if raw_detail and raw_detail != friendly_msg else "",
        "retryable": retryable,
    }
    save_chat_history(project_id, [*history, user_msg_record, error_record])
    yield {
        "type": "error",
        "code": error_code,
        "error": friendly_msg,
        "error_detail": error_record["error_detail"],
        "retryable": retryable,
        "message": error_record,
    }
