"""
Line-wrapping and height estimation (phase 1, step 5).

Character advances come from real font files via fonttools.  This is an
estimation, not a full shaping engine: no kerning, no ligatures, no complex
scripts.  Results must be paired with real-render checks in the target
environment.  Unbreakable text that cannot fit is reported as an issue,
never silently truncated.
"""

import os
import pathlib
from dataclasses import dataclass, field

from fontTools.ttLib import TTFont

# Trial value from the phase-1 plan.  Calibrated 2026-11-19 against headless
# LibreOffice 26.8 renders of the regression decks (scripts/probe_render.py):
# max occupied/required ratio 1.046, all line counts matched.  LibreOffice
# only proves its own environment; re-check in PowerPoint before trusting it.
HEIGHT_MARGIN = 0.08

# Characters that must not start a line (closing punctuation / kinsoku).
NO_LINE_START = set("。，、；：！？）］｝〉》」』】…～·‰℃") | set(",.;:!?)]}%")
# Characters that must not end a line (opening punctuation).
NO_LINE_END = set("（［｛〈《「『【") | set("([{")


def _is_ea(ch: str) -> bool:
    return ord(ch) >= 0x2E80


def _breakable(prev: str, cur: str) -> bool:
    if prev in NO_LINE_END or cur in NO_LINE_START:
        return False
    if prev in " \t-":
        return True
    return _is_ea(prev) and _is_ea(cur)


class FontMetrics:
    """Per-character advance widths read from one font file."""

    def __init__(self, path: pathlib.Path | str) -> None:
        path = pathlib.Path(path)
        if not path.exists():
            raise FileNotFoundError(
                f"Font file not found: {path}. Configure a valid font path; "
                "measurement refuses to guess without the real font."
            )
        font = TTFont(str(path), fontNumber=0, lazy=True)
        self._upem = font["head"].unitsPerEm
        self._cmap = font.getBestCmap()
        self._hmtx = font["hmtx"]
        self._units: dict[str, int] = {}

    def has_glyph(self, ch: str) -> bool:
        return ord(ch) in self._cmap

    def advance_pt(self, ch: str, size_pt: float) -> float:
        units = self._units.get(ch)
        if units is None:
            glyph = self._cmap.get(ord(ch), ".notdef")
            units = self._hmtx[glyph][0]
            self._units[ch] = units
        return units * size_pt / self._upem


@dataclass
class FontPair:
    latin: FontMetrics
    ea: FontMetrics


def _default_latin_candidates() -> list[pathlib.Path]:
    fonts_dir = pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    return [
        fonts_dir / "calibri.ttf",
        fonts_dir / "segoeui.ttf",
        fonts_dir / "arial.ttf",
        pathlib.Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]


def _default_ea_candidates() -> list[pathlib.Path]:
    """TrueType CJK candidates shared with ReportLab PDF rendering (avoids CFF OTF)."""
    fonts_dir = pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    return [
        fonts_dir / "msyh.ttc",
        fonts_dir / "simhei.ttf",
        pathlib.Path("/System/Library/Fonts/PingFang.ttc"),
        pathlib.Path("/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
        pathlib.Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
    ]


def _first_existing_or_primary(candidates: list[pathlib.Path]) -> pathlib.Path:
    for path in candidates:
        if path.is_file():
            return path
    return candidates[0]


def load_fonts(
    latin_path: str | pathlib.Path | None = None,
    ea_path: str | pathlib.Path | None = None,
) -> FontPair:
    """Resolve font files: explicit path > env override > platform TrueType default."""
    env_latin = os.environ.get("DRAFTBOARD_LATIN_FONT")
    env_ea = os.environ.get("DRAFTBOARD_EA_FONT")
    latin = (
        latin_path
        if latin_path is not None
        else (env_latin if env_latin else _first_existing_or_primary(_default_latin_candidates()))
    )
    ea = (
        ea_path
        if ea_path is not None
        else (env_ea if env_ea else _first_existing_or_primary(_default_ea_candidates()))
    )
    return FontPair(latin=FontMetrics(latin), ea=FontMetrics(ea))


@dataclass
class MeasureIssue:
    code: str
    message: str


@dataclass
class ParagraphMeasurement:
    lines: list[str]
    issues: list[MeasureIssue] = field(default_factory=list)

    @property
    def line_count(self) -> int:
        return len(self.lines)


@dataclass
class BoxMeasurement:
    paragraphs: list[ParagraphMeasurement]
    required_height_pt: float
    fits: bool

    @property
    def total_lines(self) -> int:
        return sum(p.line_count for p in self.paragraphs)

    @property
    def issues(self) -> list[MeasureIssue]:
        return [i for p in self.paragraphs for i in p.issues]


def _wrap_segment(
    seg: str, avail_pt: float, width_of
) -> tuple[list[str], list[MeasureIssue]]:
    if not seg:
        return [""], []
    issues: list[MeasureIssue] = []
    lines: list[str] = []
    start = 0
    last_break: int | None = None
    width = 0.0
    i = 0
    while i < len(seg):
        cw = width_of(seg[i])
        if i > start and _breakable(seg[i - 1], seg[i]):
            last_break = i
        if width + cw > avail_pt and i > start:
            if last_break is not None and last_break > start:
                end = last_break
            else:
                end = i
                run = seg[start:end]
                issues.append(
                    MeasureIssue(
                        code="OVERLONG_WORD",
                        message=(
                            "Unbreakable text exceeds the line width "
                            f"({avail_pt:.1f}pt): {run[:40]!r}"
                        ),
                    )
                )
            lines.append(seg[start:end])
            start = end
            width = sum(width_of(c) for c in seg[start:i])
            last_break = None
            for j in range(start + 1, i):
                if _breakable(seg[j - 1], seg[j]):
                    last_break = j
            continue
        width += cw
        i += 1
    lines.append(seg[start:])
    return lines, issues


def measure_box(
    texts: list[str],
    *,
    fonts: FontPair,
    width_pt: float,
    height_pt: float,
    size_pt: float,
    line_pt: float,
    space_after_pt: float = 0,
    pad_x_pt: float = 8,
    pad_y_pt: float = 4,
    indent_pt: float = 0,
    margin: float = HEIGHT_MARGIN,
    wrap: bool = True,
) -> BoxMeasurement:
    """Estimate wrapping and required height for one text box.

    Each entry in *texts* is one paragraph; '\\n' inside an entry is an
    explicit in-paragraph line break.  space_after is counted for every
    paragraph including the last (conservative).  An empty paragraph still
    occupies one line.

    ``wrap=False`` matches a text frame with word wrap off: each explicit
    line must fit the width by itself and is reported as OVERLONG_WORD when
    it does not.  Nothing is truncated.
    """
    avail = width_pt - 2 * pad_x_pt - indent_pt
    missing: set[str] = set()
    width_cache: dict[str, float] = {}

    def width_of(ch: str) -> float:
        w = width_cache.get(ch)
        if w is not None:
            return w
        primary = fonts.ea if _is_ea(ch) else fonts.latin
        fallback = fonts.latin if primary is fonts.ea else fonts.ea
        if primary.has_glyph(ch):
            font = primary
        elif fallback.has_glyph(ch):
            font = fallback
        else:
            font = primary
            if ch not in missing:
                missing.add(ch)
        w = font.advance_pt(ch, size_pt)
        width_cache[ch] = w
        return w

    paragraphs: list[ParagraphMeasurement] = []
    for text in texts:
        lines: list[str] = []
        issues: list[MeasureIssue] = []
        for seg in text.split("\n"):
            if wrap:
                seg_lines, seg_issues = _wrap_segment(seg, avail, width_of)
                lines.extend(seg_lines)
                issues.extend(seg_issues)
                continue
            lines.append(seg)
            if seg and sum(width_of(ch) for ch in seg) > avail:
                issues.append(
                    MeasureIssue(
                        code="OVERLONG_WORD",
                        message=(
                            "Unbreakable text exceeds the line width "
                            f"({avail:.1f}pt): {seg[:40]!r}"
                        ),
                    )
                )
        paragraphs.append(ParagraphMeasurement(lines=lines, issues=issues))

    for ch in sorted(missing):
        issue = MeasureIssue(
            code="MISSING_GLYPH",
            message=f"Character {ch!r} (U+{ord(ch):04X}) has no glyph in either font.",
        )
        paragraphs[0].issues.append(issue)

    total_lines = sum(p.line_count for p in paragraphs)
    # Conservative: space_after after every paragraph, plus vertical padding.
    required = total_lines * line_pt + space_after_pt * len(paragraphs) + 2 * pad_y_pt
    fits = required * (1 + margin) <= height_pt
    return BoxMeasurement(paragraphs=paragraphs, required_height_pt=required, fits=fits)