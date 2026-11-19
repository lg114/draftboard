"""
Tests for the wrapping / height estimation module.

Synthetic fonts: upem 1000, Latin advance 500, EA advance 1000.
At 18pt: one CJK char = 18pt, one ASCII char = 9pt — exact arithmetic.
"""

import pytest

from draftboard.measure import (
    FontMetrics,
    HEIGHT_MARGIN,
    load_fonts,
    measure_box,
)


def measure(texts, font_pair, **kw):
    defaults = dict(
        width_pt=864,
        height_pt=10000,
        size_pt=18,
        line_pt=22,
        space_after_pt=0,
        pad_x_pt=8,
        pad_y_pt=4,
    )
    defaults.update(kw)
    return measure_box(texts, fonts=font_pair, **defaults)


# ── wrapping arithmetic ──────────────────────────────────────────────────────


def test_cjk_wrap_exact(font_pair):
    # avail = 864 - 16 = 848pt; 47 chars = 846pt fit, 48 do not
    m = measure(["测" * 47], font_pair)
    assert m.total_lines == 1
    m = measure(["测" * 48], font_pair)
    assert m.total_lines == 2
    assert m.paragraphs[0].lines == ["测" * 47, "测"]


def test_latin_words_not_split(font_pair):
    text = "word " * 20
    m = measure([text], font_pair, width_pt=116, pad_x_pt=0)
    # avail 116pt: "word word " = 90pt fits, third word overflows
    for line in m.paragraphs[0].lines:
        for token in line.split():
            assert token == "word"
    assert m.total_lines >= 2


def test_break_after_hyphen(font_pair):
    m = measure(["abc-def-ghi"], font_pair, width_pt=45, pad_x_pt=0)
    # avail 45pt = 5 ASCII chars; breaks allowed after '-'
    assert m.paragraphs[0].lines[0].endswith("-")
    assert not any(i.code == "OVERLONG_WORD" for i in m.issues)


def test_explicit_newline_is_one_paragraph(font_pair):
    m = measure(["ab\ncd"], font_pair)
    assert len(m.paragraphs) == 1
    assert m.paragraphs[0].lines == ["ab", "cd"]


def test_empty_paragraph_occupies_one_line(font_pair):
    m = measure([""], font_pair)
    assert m.total_lines == 1
    m = measure(["a", ""], font_pair, space_after_pt=8)
    assert m.total_lines == 2
    # 2 lines * 22 + 2 paragraphs * 8 + 2 * 4 padding
    assert m.required_height_pt == 44 + 16 + 8


def test_mixed_cn_en_widths(font_pair):
    # "中文abc" = 2*18 + 3*9 = 63pt
    m = measure(["中文abc"], font_pair, width_pt=79, pad_x_pt=8)
    assert m.total_lines == 1
    m = measure(["中文abc"], font_pair, width_pt=78, pad_x_pt=8)
    assert m.total_lines == 2


# ── punctuation rules (kinsoku) ─────────────────────────────────────────────


def test_closing_punctuation_never_starts_line(font_pair):
    m = measure(["测" * 47 + "。"], font_pair)
    lines = m.paragraphs[0].lines
    assert lines == ["测" * 46, "测。"]


def test_opening_punctuation_never_ends_line(font_pair):
    m = measure(["测" * 46 + "（" + "测" * 10], font_pair)
    lines = m.paragraphs[0].lines
    assert not lines[0].endswith("（")
    assert lines[1].startswith("（")


def test_ascii_comma_not_at_line_start(font_pair):
    # avail 45pt = 5 chars; "abcd," would leave ',' alone on next line
    m = measure(["abcd,efgh"], font_pair, width_pt=45, pad_x_pt=0)
    for line in m.paragraphs[0].lines[1:]:
        assert not line.startswith(",")


# ── problem reporting ────────────────────────────────────────────────────────


def test_overlong_url_reported_not_silent(font_pair):
    url = "https://example.com/" + "a" * 100
    m = measure([url], font_pair, width_pt=116, pad_x_pt=0)
    assert any(i.code == "OVERLONG_WORD" for i in m.issues)
    # estimation still produces lines (force-break), nothing truncated
    assert "".join(m.paragraphs[0].lines) == url


def test_missing_glyph_reported(font_pair):
    m = measure(["\u0378"], font_pair)
    assert any(i.code == "MISSING_GLYPH" for i in m.issues)


def test_missing_font_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="Font file not found"):
        FontMetrics(tmp_path / "nope.ttf")
    with pytest.raises(FileNotFoundError):
        load_fonts(latin_path=tmp_path / "nope.ttf")


# ── height, margin, indent ───────────────────────────────────────────────────


def test_height_with_margin(font_pair):
    m = measure(["测" * 48], font_pair, space_after_pt=8, height_pt=65)
    # 2 lines * 22 + 8 + 8 = 60pt; 60 * 1.08 = 64.8 <= 65
    assert m.required_height_pt == 60
    assert m.fits
    m = measure(["测" * 48], font_pair, space_after_pt=8, height_pt=64)
    assert not m.fits


def test_margin_default_is_trial_value():
    assert HEIGHT_MARGIN == 0.08


def test_indent_reduces_available_width(font_pair):
    # avail = 848 - 14 = 834pt: 46 chars (828) fit, 47 (846) do not
    m = measure(["测" * 46], font_pair, indent_pt=14)
    assert m.total_lines == 1
    m = measure(["测" * 47], font_pair, indent_pt=14)
    assert m.total_lines == 2


def test_deterministic(font_pair):
    a = measure(["中英混排 mixed text。" * 5], font_pair)
    b = measure(["中英混排 mixed text。" * 5], font_pair)
    assert a == b