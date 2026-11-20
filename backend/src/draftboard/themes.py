"""
Presentation theme definitions for Draftboard's deterministic PPTX exporter.

The 'default' theme preserves the exact minimalist Phase-1 geometry and
zero extra decorative elements expected by the frozen regression fixtures.
Named presentation themes ('business_slate', 'dark_tech', 'warm_editorial')
add curated color hierarchies, cover/closing contrast, accent lines, and
page numbers while keeping all content boxes native and editable.
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
    bold_title: bool = True
    decorative: bool = True
    show_page_number: bool = True

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
            },
        }


THEMES: dict[str, ThemeSpec] = {
    "business_slate": ThemeSpec(
        id="business_slate",
        name="商务澄蓝",
        description="深邃靛蓝封面搭配清爽浅灰正文页，适合项目汇报、方案评审与业务复盘。",
        bg_hex="#F8FAFC",
        cover_bg_hex="#0F172A",
        title_hex="#0F172A",
        cover_title_hex="#F8FAFC",
        body_hex="#334155",
        cover_body_hex="#CBD5E1",
        accent_hex="#2563EB",
        muted_hex="#94A3B8",
        divider_hex="#E2E8F0",
    ),
    "dark_tech": ThemeSpec(
        id="dark_tech",
        name="深蓝科技",
        description="全域暗色科技底色配高对比青蓝强调线，适合技术架构分享与产品发布。",
        bg_hex="#0B1120",
        cover_bg_hex="#020617",
        title_hex="#F8FAFC",
        cover_title_hex="#FFFFFF",
        body_hex="#CBD5E1",
        cover_body_hex="#94A3B8",
        accent_hex="#38BDF8",
        muted_hex="#64748B",
        divider_hex="#1E293B",
    ),
    "warm_editorial": ThemeSpec(
        id="warm_editorial",
        name="暖纸编辑",
        description="炭黑开篇与温润米白阅读纸感，搭配琥珀金点缀，适合研究汇报与教学课件。",
        bg_hex="#FAF8F5",
        cover_bg_hex="#1C1917",
        title_hex="#1C1917",
        cover_title_hex="#FAF8F5",
        body_hex="#44403C",
        cover_body_hex="#D6D3D1",
        accent_hex="#D97706",
        muted_hex="#A8A29E",
        divider_hex="#E7E5E4",
    ),
    "default": ThemeSpec(
        id="default",
        name="极简白纸",
        description="无额外装饰元素的纯白底极简排版，便于导入企业自有母版二次加工。",
        bg_hex="#FFFFFF",
        cover_bg_hex="#FFFFFF",
        title_hex="#262626",
        cover_title_hex="#262626",
        body_hex="#262626",
        cover_body_hex="#262626",
        accent_hex="#262626",
        muted_hex="#737373",
        divider_hex="#E5E5E5",
        bold_title=False,
        decorative=False,
        show_page_number=False,
    ),
}

DEFAULT_PRESENTATION_THEME = "business_slate"


def get_theme(template_id: str | None) -> ThemeSpec:
    if not template_id:
        return THEMES["default"]
    return THEMES.get(template_id, THEMES["default"])


def list_themes() -> list[dict]:
    return [theme.to_public_dict() for theme in THEMES.values()]
