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


_PALETTE_KEYS = ("palette_name", "accent_hex", "bg_hex", "cover_bg_hex", "surface_hex")
_ALL_BRAND_KEYS = (*_PALETTE_KEYS, "footer_text", "logo_asset_id")


def _parse_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _format_rgb(r: float, g: float, b: float) -> str:
    ri = max(0, min(255, round(r)))
    gi = max(0, min(255, round(g)))
    bi = max(0, min(255, round(b)))
    return f"#{ri:02X}{gi:02X}{bi:02X}"


def _mix_hex(hex_a: str, hex_b: str, weight_b: float) -> str:
    ra, ga, ba = _parse_rgb(hex_a)
    rb, gb, bb = _parse_rgb(hex_b)
    w = max(0.0, min(1.0, weight_b))
    return _format_rgb(
        ra * (1.0 - w) + rb * w,
        ga * (1.0 - w) + gb * w,
        ba * (1.0 - w) + bb * w,
    )


def _relative_luminance(hex_color: str) -> float:
    def _lin(c: int) -> float:
        s = c / 255.0
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4

    r, g, b = _parse_rgb(hex_color)
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def has_any_brand_fields(brand: Optional[dict[str, Any]]) -> bool:
    if not brand or not isinstance(brand, dict):
        return False
    return any(bool(brand.get(k)) for k in _ALL_BRAND_KEYS)


def has_custom_palette(brand: Optional[dict[str, Any]]) -> bool:
    if not brand or not isinstance(brand, dict):
        return False
    return any(
        isinstance(brand.get(k), str) and bool(_HEX_RE.fullmatch(brand[k].strip()))
        for k in ("accent_hex", "bg_hex", "cover_bg_hex", "surface_hex")
    )


def clear_brand_palette_overrides(
    brand: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Strip custom palette color overrides while preserving logo and footer."""
    if not brand or not isinstance(brand, dict):
        return None
    next_brand = dict(brand)
    for k in _PALETTE_KEYS:
        next_brand[k] = None
    return next_brand if has_any_brand_fields(next_brand) else None


class BrandKit(BaseModel):
    palette_name: Optional[str] = Field(
        None, description="Optional custom palette display name"
    )
    accent_hex: Optional[str] = Field(
        None, description="Optional brand primary accent '#RRGGBB'"
    )
    bg_hex: Optional[str] = Field(
        None, description="Optional brand content slide background '#RRGGBB'"
    )
    cover_bg_hex: Optional[str] = Field(
        None, description="Optional brand cover/closing slide background '#RRGGBB'"
    )
    surface_hex: Optional[str] = Field(
        None, description="Optional brand card/surface fill '#RRGGBB'"
    )
    footer_text: Optional[str] = Field(
        None, description="Optional subtle bottom-left footer text"
    )
    logo_asset_id: Optional[str] = Field(
        None, description="Optional uploaded image asset_id for corner logo"
    )
    logo_position: Literal["top_right", "bottom_left"] = Field(
        "top_right", description="Corner logo placement"
    )

    def cleaned(self) -> "BrandKit":
        def _clean_hex(val: Optional[str], label: str) -> Optional[str]:
            raw = val.strip() if val else None
            if raw and not _HEX_RE.fullmatch(raw):
                raise ValueError(f"{label}必须是 6 位十六进制颜色，例如 #0071E3")
            return raw.upper() if raw else None

        palette_name = (self.palette_name or "").strip()[:24] or None
        accent = _clean_hex(self.accent_hex, "强调色")
        bg = _clean_hex(self.bg_hex, "正文背景色")
        cover_bg = _clean_hex(self.cover_bg_hex, "封面背景色")
        surface = _clean_hex(self.surface_hex, "卡片底色")
        footer = (self.footer_text or "").strip()[:80] or None
        logo = (self.logo_asset_id or "").strip() or None
        return BrandKit(
            palette_name=palette_name,
            accent_hex=accent,
            bg_hex=bg,
            cover_bg_hex=cover_bg,
            surface_hex=surface,
            footer_text=footer,
            logo_asset_id=logo,
            logo_position=self.logo_position,
        )


def apply_brand_to_theme(theme: ThemeSpec, brand: Optional[dict[str, Any]]) -> ThemeSpec:
    """Return a ThemeSpec with optional valid brand / custom palette overrides applied.

    Automatically derives contrast-safe title, body, muted, divider, surface, cover text,
    and chart palette colors whenever custom bg/cover_bg/accent colors are provided.
    """
    if not brand or not isinstance(brand, dict):
        return theme

    def _valid_hex(key: str) -> Optional[str]:
        val = (brand.get(key) or "").strip()
        return val.upper() if val and _HEX_RE.fullmatch(val) else None

    palette_name = (brand.get("palette_name") or "").strip()[:24] or None
    accent = _valid_hex("accent_hex")
    bg = _valid_hex("bg_hex")
    cover_bg = _valid_hex("cover_bg_hex")
    surface = _valid_hex("surface_hex")

    if not any((palette_name, accent, bg, cover_bg, surface)):
        return theme

    updates: dict[str, Any] = {}

    if bg:
        updates["bg_hex"] = bg
        lum_bg = _relative_luminance(bg)
        if lum_bg < 0.28:
            updates["title_hex"] = _mix_hex(bg, "#FFFFFF", 0.92)
            updates["body_hex"] = _mix_hex(bg, "#F2F4F8", 0.72)
            updates["muted_hex"] = _mix_hex(bg, "#D8DCE4", 0.48)
            updates["divider_hex"] = _mix_hex(bg, "#FFFFFF", 0.16)
            if not surface:
                updates["surface_hex"] = _mix_hex(bg, "#FFFFFF", 0.07)
        else:
            updates["title_hex"] = _mix_hex(bg, "#121316", 0.88)
            updates["body_hex"] = _mix_hex(bg, "#1C1E22", 0.72)
            updates["muted_hex"] = _mix_hex(bg, "#2A2D33", 0.46)
            updates["divider_hex"] = _mix_hex(bg, "#1A1B1E", 0.12)
            if not surface:
                updates["surface_hex"] = (
                    _mix_hex(bg, "#1A1B1E", 0.04)
                    if lum_bg > 0.95
                    else _mix_hex(bg, "#FFFFFF", 0.52)
                )

    if surface:
        updates["surface_hex"] = surface

    if cover_bg:
        updates["cover_bg_hex"] = cover_bg
        lum_cover = _relative_luminance(cover_bg)
        if lum_cover < 0.30:
            updates["cover_title_hex"] = _mix_hex(cover_bg, "#FFFFFF", 0.94)
            updates["cover_body_hex"] = _mix_hex(cover_bg, "#EFF2F7", 0.74)
        else:
            updates["cover_title_hex"] = _mix_hex(cover_bg, "#121316", 0.88)
            updates["cover_body_hex"] = _mix_hex(cover_bg, "#1F2126", 0.68)

    if accent:
        updates["accent_hex"] = accent
        eff_bg = updates.get("bg_hex", theme.bg_hex)
        eff_title = updates.get("title_hex", theme.title_hex)
        eff_muted = updates.get("muted_hex", theme.muted_hex)
        dark_bg = _relative_luminance(eff_bg) < 0.28
        tint_target = "#FFFFFF" if dark_bg else "#121316"
        soft_accent = _mix_hex(accent, "#FFFFFF" if dark_bg else eff_bg, 0.35)
        deep_accent = _mix_hex(accent, tint_target, 0.32)
        updates["chart_palette"] = (
            accent,
            eff_title,
            soft_accent,
            deep_accent,
            eff_muted,
        )

    if palette_name:
        updates["name"] = palette_name

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
