"""
Presentation theme definitions for Draftboard's deterministic PPTX exporter.

Curated Apple Keynote / Swiss Editorial themes:
  - keynote_light  : Pure light canvas, graphite typography, restrained blue accent
  - keynote_dark   : Keynote obsidian dark canvas, crisp white/silver hierarchy
  - nordic_pine    : Deep pine cover, ivory content slides, sage accent
  - gallery_sand   : Warm linen paper canvas, charcoal cover, terracotta accent
  - default        : Minimalist unstyled white baseline (preserves Phase-1 fixtures)
"""

from dataclasses import dataclass
from pptx.dml.color import RGBColor


def _rgb(hex_color: str) -> RGBColor:
    h = hex_color.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


@dataclass(frozen=True)
class ThemeSpec:
    id: str
    name: str
    description: str
    bg_hex: str
    cover_bg_hex: str
    title_hex: str
    cover_title_hex: str
    body_hex: str
    cover_body_hex: str
    accent_hex: str
    muted_hex: str
    divider_hex: str
    surface_hex: str
    bold_title: bool = True
    decorative: bool = True
    show_page_number: bool = True
    left_aligned_cover: bool = True

    @property
    def bg_rgb(self) -> RGBColor:
        return _rgb(self.bg_hex)

    @property
    def cover_bg_rgb(self) -> RGBColor:
        return _rgb(self.cover_bg_hex)

    @property
    def title_rgb(self) -> RGBColor:
        return _rgb(self.title_hex)

    @property
    def cover_title_rgb(self) -> RGBColor:
        return _rgb(self.cover_title_hex)

    @property
    def body_rgb(self) -> RGBColor:
        return _rgb(self.body_hex)

    @property
    def cover_body_rgb(self) -> RGBColor:
        return _rgb(self.cover_body_hex)

    @property
    def accent_rgb(self) -> RGBColor:
        return _rgb(self.accent_hex)

    @property
    def muted_rgb(self) -> RGBColor:
        return _rgb(self.muted_hex)

    @property
    def divider_rgb(self) -> RGBColor:
        return _rgb(self.divider_hex)

    @property
    def surface_rgb(self) -> RGBColor:
        return _rgb(self.surface_hex)

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "swatches": {
                "bg": self.bg_hex,
                "cover_bg": self.cover_bg_hex,
                "title": self.title_hex,
                "cover_title": self.cover_title_hex,
                "body": self.body_hex,
                "cover_body": self.cover_body_hex,
                "accent": self.accent_hex,
                "muted": self.muted_hex,
                "divider": self.divider_hex,
                "surface": self.surface_hex,
            },
        }


THEMES: dict[str, ThemeSpec] = {
    "keynote_light": ThemeSpec(
        id="keynote_light",
        name="苹果白",
        description="纯净画布 · 极简黑字",
        bg_hex="#FBFBFD",
        cover_bg_hex="#F5F5F7",
        title_hex="#1D1D1F",
        cover_title_hex="#1D1D1F",
        body_hex="#424245",
        cover_body_hex="#424245",
        accent_hex="#0071E3",
        muted_hex="#6E6E73",
        divider_hex="#E5E5EA",
        surface_hex="#FFFFFF",
    ),
    "keynote_dark": ThemeSpec(
        id="keynote_dark",
        name="深空钛黑",
        description="发布会暗黑 · 银灰层次",
        bg_hex="#111113",
        cover_bg_hex="#000000",
        title_hex="#F5F5F7",
        cover_title_hex="#FFFFFF",
        body_hex="#A1A1A6",
        cover_body_hex="#B4B4BA",
        accent_hex="#2997FF",
        muted_hex="#8E8E93",
        divider_hex="#262629",
        surface_hex="#1C1C1F",
    ),
    "nordic_pine": ThemeSpec(
        id="nordic_pine",
        name="松柏森绿",
        description="深松封面 · 象牙正文",
        bg_hex="#FAFBF9",
        cover_bg_hex="#0F2922",
        title_hex="#10241E",
        cover_title_hex="#F4F7F5",
        body_hex="#3D4F49",
        cover_body_hex="#C2D6CF",
        accent_hex="#2E7D63",
        muted_hex="#7E948C",
        divider_hex="#E3EAE6",
        surface_hex="#F2F6F4",
    ),
    "gallery_sand": ThemeSpec(
        id="gallery_sand",
        name="美术馆暖石",
        description="亚麻纸感 · 陶土点缀",
        bg_hex="#F4F1EA",
        cover_bg_hex="#23221F",
        title_hex="#1F1E1B",
        cover_title_hex="#F4F1EA",
        body_hex="#4F4B45",
        cover_body_hex="#D4CFC4",
        accent_hex="#B4533C",
        muted_hex="#948E84",
        divider_hex="#E3DDD2",
        surface_hex="#ECE7DD",
    ),
    "default": ThemeSpec(
        id="default",
        name="极简白纸",
        description="纯净白底 · 零装饰",
        bg_hex="#FFFFFF",
        cover_bg_hex="#FFFFFF",
        title_hex="#262626",
        cover_title_hex="#262626",
        body_hex="#262626",
        cover_body_hex="#262626",
        accent_hex="#262626",
        muted_hex="#737373",
        divider_hex="#E5E5E5",
        surface_hex="#FFFFFF",
        bold_title=False,
        decorative=False,
        show_page_number=False,
        left_aligned_cover=False,
    ),
}

# Backwards-compatible aliases for earlier theme IDs saved in existing projects
THEME_ALIASES: dict[str, str] = {
    "business_slate": "keynote_light",
    "dark_tech": "keynote_dark",
    "warm_editorial": "gallery_sand",
}

DEFAULT_PRESENTATION_THEME = "keynote_light"


def is_valid_theme(template_id: str | None) -> bool:
    if not template_id:
        return False
    return template_id in THEMES or template_id in THEME_ALIASES


def resolve_theme_id(template_id: str | None) -> str:
    if not template_id:
        return "default"
    canonical = THEME_ALIASES.get(template_id, template_id)
    return canonical if canonical in THEMES else "default"


def get_theme(template_id: str | None) -> ThemeSpec:
    return THEMES[resolve_theme_id(template_id)]


def list_themes() -> list[dict]:
    """Return the 4 curated presentation themes for the studio picker."""
    curated = ("keynote_light", "keynote_dark", "nordic_pine", "gallery_sand")
    return [THEMES[tid].to_public_dict() for tid in curated]
