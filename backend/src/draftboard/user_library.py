"""User brand kit customization and reusable custom canvas layout presets.

Stored beside the active Draftboard storage root (`STORAGE_ROOT.parent / "saved_layouts.json"`,
defaulting to `~/.draftboard/saved_layouts.json`, overridable in tests).
Per-project brand overrides are stored in each project's meta.json under `brand`.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.models import CanvasElement
from draftboard.themes import ThemeSpec

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_SAVED_LAYOUTS_PATH: Optional[pathlib.Path] = None


def _layouts_path() -> pathlib.Path:
    if _SAVED_LAYOUTS_PATH is not None:
        return _SAVED_LAYOUTS_PATH
    if tools_module._storage_root is not None:
        return pathlib.Path(tools_module._storage_root) / "_saved_layouts.json"
    return storage_module.STORAGE_ROOT.parent / "saved_layouts.json"


class BrandKit(BaseModel):
    accent_hex: Optional[str] = Field(None, description="Optional brand primary accent '#RRGGBB'")
    bg_hex: Optional[str] = Field(None, description="Optional brand slide background '#RRGGBB'")
    footer_text: Optional[str] = Field(None, description="Optional subtle bottom-left footer text")
    logo_asset_id: Optional[str] = Field(None, description="Optional uploaded image asset_id for corner logo")
    logo_position: Literal["top_right", "bottom_left"] = Field(
        "top_right", description="Corner logo placement"
    )

    def cleaned(self) -> "BrandKit":
        accent = self.accent_hex.strip() if self.accent_hex else None
        if accent and not _HEX_RE.fullmatch(accent):
            raise ValueError("品牌强调色必须是 6 位十六进制颜色，例如 #0071E3")
        bg = self.bg_hex.strip() if self.bg_hex else None
        if bg and not _HEX_RE.fullmatch(bg):
            raise ValueError("品牌背景色必须是 6 位十六进制颜色，例如 #FBFBFD")
        footer = (self.footer_text or "").strip()[:80] or None
        logo = (self.logo_asset_id or "").strip() or None
        return BrandKit(
            accent_hex=accent.upper() if accent else None,
            bg_hex=bg.upper() if bg else None,
            footer_text=footer,
            logo_asset_id=logo,
            logo_position=self.logo_position,
        )


def apply_brand_to_theme(theme: ThemeSpec, brand: Optional[dict[str, Any]]) -> ThemeSpec:
    """Return a ThemeSpec with optional valid brand accent/bg overrides applied."""
    if not brand or not isinstance(brand, dict):
        return theme
    updates: dict[str, Any] = {}
    accent = (brand.get("accent_hex") or "").strip()
    if accent and _HEX_RE.fullmatch(accent):
        updates["accent_hex"] = accent
        pal = list(theme.chart_palette)
        if pal:
            pal[0] = accent
        updates["chart_palette"] = tuple(pal)
    bg = (brand.get("bg_hex") or "").strip()
    if bg and _HEX_RE.fullmatch(bg):
        updates["bg_hex"] = bg
    if not updates:
        return theme
    return dataclasses.replace(theme, **updates)


class SavedLayoutPreset(BaseModel):
    id: str = Field(description="Unique preset ID")
    name: str = Field(description="User-facing layout name")
    description: Optional[str] = Field(None, description="Optional short description")
    custom_bg: Optional[str] = Field("theme:bg", description="Background token or hex")
    elements: list[CanvasElement] = Field(description="Canvas elements composing the preset")
    created_at: str = Field(description="ISO timestamp")


def _load_raw_layouts() -> list[dict[str, Any]]:
    path = _layouts_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("layouts"), list):
            return data["layouts"]
    except Exception:
        pass
    return []


def _save_raw_layouts(layouts: list[dict[str, Any]]) -> None:
    path = _layouts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps({"layouts": layouts}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


def list_saved_layouts() -> list[SavedLayoutPreset]:
    out: list[SavedLayoutPreset] = []
    for raw in _load_raw_layouts():
        try:
            out.append(SavedLayoutPreset.model_validate(raw))
        except Exception:
            continue
    return out


def create_saved_layout(
    name: str,
    elements: list[CanvasElement],
    *,
    custom_bg: Optional[str] = "theme:bg",
    description: Optional[str] = None,
) -> SavedLayoutPreset:
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("版式名称不能为空")
    if not elements:
        raise ValueError("至少需要 1 个自由画布元素才能收藏版式")
    preset = SavedLayoutPreset(
        id=f"lay-{uuid.uuid4().hex[:8]}",
        name=clean_name[:40],
        description=(description or "").strip()[:80] or None,
        custom_bg=custom_bg or "theme:bg",
        elements=elements,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    existing = _load_raw_layouts()
    existing.insert(0, preset.model_dump())
    _save_raw_layouts(existing[:30])
    return preset


def delete_saved_layout(layout_id: str) -> bool:
    existing = _load_raw_layouts()
    kept = [item for item in existing if item.get("id") != layout_id]
    if len(kept) == len(existing):
        return False
    _save_raw_layouts(kept)
    return True
