"""
Deterministic synthetic fonts for offline tests.

Latin glyphs advance 500/1000 em, EA glyphs 1000/1000 em, so wrapping
arithmetic in tests is exact and independent of any system font.
"""

import pathlib

from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib.tables._g_l_y_f import Glyph


def _build(path: pathlib.Path, family: str, codepoints: list[int], advance: int) -> None:
    order = [".notdef"] + [f"uni{cp:04X}" for cp in codepoints]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: f"uni{cp:04X}" for cp in codepoints})
    fb.setupGlyf({g: Glyph() for g in order})
    metrics = {g: (advance, 0) for g in order}
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2(
        sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200
    )
    fb.setupPost()
    fb.save(str(path))


def build_font_files(dir_path: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    latin_cps = (
        list(range(0x20, 0x7F))
        + list(range(0xA0, 0x100))
        + list(range(0x2000, 0x2070))
    )
    ea_cps = (
        list(range(0x3000, 0x3040))
        + list(range(0x4E00, 0xA000))
        + list(range(0xFF00, 0xFFF0))
    )
    latin = dir_path / "synthetic-latin.ttf"
    ea = dir_path / "synthetic-ea.ttf"
    _build(latin, "SyntheticLatin", latin_cps, 500)
    _build(ea, "SyntheticEA", ea_cps, 1000)
    return latin, ea