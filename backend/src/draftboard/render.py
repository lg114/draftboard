"""
Pure-Python vector PDF & per-page PNG preview renderer:
  PPTX (python-pptx) -> Vector PDF (ReportLab) -> HD PNG (pypdfium2).

Zero external software dependencies (no LibreOffice required): runs in ~100ms
identically across Windows, macOS, Linux, and CI, while preserving selectable,
searchable vector text and embedded images from the exact exported PPTX.
"""

from __future__ import annotations

import hashlib
import io
import math
import os
import pathlib
import re
from dataclasses import dataclass
from typing import Optional

import pypdfium2 as pdfium
from pptx import Presentation
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE, MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from reportlab.lib.colors import Color
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

from draftboard.measure import NO_LINE_END, NO_LINE_START, _is_ea

_CID_CJK_FALLBACK = "STSong-Light"


@dataclass(frozen=True)
class _RenderFonts:
    latin: str
    latin_bold: str
    ea: str
    ea_bold: str


_FONT_CACHE: dict[tuple[str, str, str, str], _RenderFonts] = {}


def _font_reg_name(prefix: str, path: pathlib.Path) -> str:
    digest = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:10]
    return f"{prefix}_{digest}"


def _try_register_ttf(prefix: str, path: pathlib.Path, subfont_index: int = 0) -> Optional[str]:
    if not path.is_file():
        return None
    name = _font_reg_name(prefix, path)
    if name in pdfmetrics.getRegisteredFontNames():
        return name
    try:
        if path.suffix.lower() == ".ttc":
            pdfmetrics.registerFont(TTFont(name, str(path), subfontIndex=subfont_index))
        else:
            pdfmetrics.registerFont(TTFont(name, str(path)))
        return name
    except Exception:
        return None


def _ensure_cid_fallback() -> str:
    if _CID_CJK_FALLBACK not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(_CID_CJK_FALLBACK))
    return _CID_CJK_FALLBACK


def _infer_bold_sibling(regular_path: pathlib.Path) -> Optional[pathlib.Path]:
    """Find a matching bold TrueType font alongside *regular_path* if one exists."""
    parent = regular_path.parent
    stem = regular_path.stem
    suffix = regular_path.suffix
    candidates: list[pathlib.Path] = []
    if re.search(r"-Regular$", stem, re.IGNORECASE):
        candidates.append(parent / f"{re.sub(r'-Regular$', '-Bold', stem, flags=re.IGNORECASE)}{suffix}")
    if re.search(r"Regular$", stem, re.IGNORECASE):
        candidates.append(parent / f"{re.sub(r'Regular$', 'Bold', stem, flags=re.IGNORECASE)}{suffix}")
    candidates.extend(
        [
            parent / f"{stem}-Bold{suffix}",
            parent / f"{stem} Bold{suffix}",
            parent / f"{stem}bd{suffix}",
            parent / f"{stem}b{suffix}",
        ]
    )
    for cand in candidates:
        if cand != regular_path and cand.is_file():
            return cand
    return None


def _resolve_render_fonts() -> _RenderFonts:
    env_latin = os.environ.get("DRAFTBOARD_LATIN_FONT", "").strip()
    env_latin_bold = os.environ.get("DRAFTBOARD_LATIN_BOLD_FONT", "").strip()
    env_ea = os.environ.get("DRAFTBOARD_EA_FONT", "").strip()
    env_ea_bold = os.environ.get("DRAFTBOARD_EA_BOLD_FONT", "").strip()
    cache_key = (env_latin, env_latin_bold, env_ea, env_ea_bold)
    if cache_key in _FONT_CACHE:
        return _FONT_CACHE[cache_key]

    win_fonts = pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"

    latin_candidates = [
        *([] if not env_latin else [pathlib.Path(env_latin)]),
        win_fonts / "calibri.ttf",
        win_fonts / "segoeui.ttf",
        win_fonts / "arial.ttf",
        pathlib.Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    latin_bold_defaults = [
        win_fonts / "calibrib.ttf",
        win_fonts / "segoeuib.ttf",
        win_fonts / "arialbd.ttf",
        pathlib.Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ]
    # TrueType CJK candidates come first so ReportLab embeds real outlines
    # instead of failing on CFF-based OpenType collections and falling back to CID.
    ea_candidates = [
        *([] if not env_ea else [pathlib.Path(env_ea)]),
        win_fonts / "msyh.ttc",
        win_fonts / "simhei.ttf",
        pathlib.Path("/System/Library/Fonts/PingFang.ttc"),
        pathlib.Path("/System/Library/Fonts/STHeiti Light.ttc"),
        pathlib.Path("/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
        pathlib.Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"),
        pathlib.Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        pathlib.Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    ]
    ea_bold_defaults = [
        win_fonts / "msyhbd.ttc",
        pathlib.Path("/usr/share/fonts/truetype/noto/NotoSansSC-Bold.ttf"),
        pathlib.Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc"),
        pathlib.Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"),
    ]

    latin_name = "Helvetica"
    latin_path: Optional[pathlib.Path] = None
    for cand in latin_candidates:
        if not cand.is_file():
            continue
        reg = _try_register_ttf("DBLatin", cand)
        if reg:
            latin_name = reg
            latin_path = cand
            break

    latin_bold_name = "Helvetica-Bold" if latin_name == "Helvetica" else latin_name
    latin_bold_candidates: list[pathlib.Path] = []
    if env_latin_bold:
        latin_bold_candidates.append(pathlib.Path(env_latin_bold))
    if latin_path:
        sibling = _infer_bold_sibling(latin_path)
        if sibling:
            latin_bold_candidates.append(sibling)
    if not env_latin:
        latin_bold_candidates.extend(latin_bold_defaults)
    for cand in latin_bold_candidates:
        reg = _try_register_ttf("DBLatinBold", cand)
        if reg:
            latin_bold_name = reg
            break

    ea_name = _ensure_cid_fallback()
    ea_path: Optional[pathlib.Path] = None
    for cand in ea_candidates:
        if not cand.is_file():
            continue
        reg = _try_register_ttf("DBEA", cand, subfont_index=0)
        if reg:
            ea_name = reg
            ea_path = cand
            break

    ea_bold_name = ea_name
    ea_bold_candidates: list[pathlib.Path] = []
    if env_ea_bold:
        ea_bold_candidates.append(pathlib.Path(env_ea_bold))
    if ea_path:
        sibling = _infer_bold_sibling(ea_path)
        if sibling:
            ea_bold_candidates.append(sibling)
    if not env_ea:
        ea_bold_candidates.extend(ea_bold_defaults)
    for cand in ea_bold_candidates:
        if not cand.is_file():
            continue
        reg = _try_register_ttf("DBEABold", cand, subfont_index=0)
        if reg:
            ea_bold_name = reg
            break

    resolved = _RenderFonts(
        latin=latin_name,
        latin_bold=latin_bold_name,
        ea=ea_name,
        ea_bold=ea_bold_name,
    )
    _FONT_CACHE[cache_key] = resolved
    return resolved


def _rgb_to_color(rgb_obj, default: Color = Color(0.15, 0.15, 0.15)) -> Color:
    if rgb_obj is None:
        return default
    try:
        hex_str = str(rgb_obj).lstrip("#")
        if len(hex_str) == 6:
            return Color(
                int(hex_str[0:2], 16) / 255.0,
                int(hex_str[2:4], 16) / 255.0,
                int(hex_str[4:6], 16) / 255.0,
            )
    except Exception:
        pass
    return default


def _split_script_runs(text: str, fonts: _RenderFonts, bold: bool) -> list[tuple[str, str]]:
    """Split text into contiguous (font_name, chunk) runs for Latin vs CJK."""
    if not text:
        return []
    latin_f = fonts.latin_bold if bold else fonts.latin
    ea_f = fonts.ea_bold if bold else fonts.ea
    runs: list[tuple[str, str]] = []
    cur_font = ea_f if _is_ea(text[0]) else latin_f
    buf = [text[0]]
    for ch in text[1:]:
        f = ea_f if _is_ea(ch) else latin_f
        if f == cur_font:
            buf.append(ch)
        else:
            runs.append((cur_font, "".join(buf)))
            cur_font = f
            buf = [ch]
    runs.append((cur_font, "".join(buf)))
    return runs


def _measure_dual_width(text: str, size_pt: float, fonts: _RenderFonts, bold: bool) -> float:
    total = 0.0
    for font_name, chunk in _split_script_runs(text, fonts, bold):
        total += pdfmetrics.stringWidth(chunk, font_name, size_pt)
    return total


def _wrap_line(
    text: str,
    max_w: float,
    size_pt: float,
    fonts: _RenderFonts,
    bold: bool,
) -> list[str]:
    if not text:
        return [""]
    if max_w <= 0 or _measure_dual_width(text, size_pt, fonts, bold) <= max_w:
        return [text]

    lines: list[str] = []
    remaining = text
    while remaining:
        if _measure_dual_width(remaining, size_pt, fonts, bold) <= max_w:
            lines.append(remaining)
            break

        # Find longest prefix that fits max_w
        width = 0.0
        fit_idx = 0
        latin_f = fonts.latin_bold if bold else fonts.latin
        ea_f = fonts.ea_bold if bold else fonts.ea
        for i, ch in enumerate(remaining):
            f = ea_f if _is_ea(ch) else latin_f
            cw = pdfmetrics.stringWidth(ch, f, size_pt)
            if width + cw > max_w and i > 0:
                break
            width += cw
            fit_idx = i + 1

        if fit_idx >= len(remaining):
            lines.append(remaining)
            break

        # Walk back for a natural break point (word boundary / CJK / kinsoku)
        break_idx = fit_idx
        for idx in range(fit_idx, 0, -1):
            prev_ch = remaining[idx - 1]
            next_ch = remaining[idx]
            if prev_ch in NO_LINE_END or next_ch in NO_LINE_START:
                continue
            if prev_ch in " \t-" or (_is_ea(prev_ch) and _is_ea(next_ch)) or _is_ea(prev_ch) != _is_ea(next_ch):
                break_idx = idx
                break
        if break_idx <= 0:
            break_idx = max(1, fit_idx)

        lines.append(remaining[:break_idx].rstrip())
        remaining = remaining[break_idx:].lstrip()
    return lines or [""]


def _draw_dual_text(
    c: rl_canvas.Canvas,
    x: float,
    y_baseline: float,
    text: str,
    size_pt: float,
    fonts: _RenderFonts,
    bold: bool,
    color: Color,
) -> None:
    if not text:
        return
    c.setFillColor(color)
    cur_x = x
    for font_name, chunk in _split_script_runs(text, fonts, bold):
        c.setFont(font_name, size_pt)
        c.drawString(cur_x, y_baseline, chunk)
        cur_x += pdfmetrics.stringWidth(chunk, font_name, size_pt)


def _paragraph_bullet_info(paragraph) -> tuple[bool, Optional[Color], float]:
    pPr = paragraph._p.find(qn("a:pPr"))
    if pPr is None:
        return False, None, 0.0
    bu_char = pPr.find(qn("a:buChar"))
    if bu_char is None:
        return False, None, 0.0
    bullet_color: Optional[Color] = None
    bu_clr = pPr.find(qn("a:buClr"))
    if bu_clr is not None:
        srgb = bu_clr.find(qn("a:srgbClr"))
        if srgb is not None and srgb.get("val"):
            bullet_color = _rgb_to_color(srgb.get("val"))
    indent_pt = 14.0
    mar_l = pPr.get("marL")
    if mar_l:
        try:
            indent_pt = int(mar_l) / 12700.0
        except Exception:
            pass
    return True, bullet_color, indent_pt


def _fmt_chart_num(val: float, suffix: str = "") -> str:
    if abs(val - round(val)) < 1e-6:
        s = str(int(round(val)))
    elif abs(val) >= 100:
        s = f"{val:.1f}".rstrip("0").rstrip(".")
    else:
        s = f"{val:.2f}".rstrip("0").rstrip(".")
    return f"{s}{suffix}"


def _extract_border_style(tcPr, tag: str) -> tuple[Optional[Color], float]:
    if tcPr is None:
        return None, 0.0
    ln = tcPr.find(qn(tag))
    if ln is None or ln.find(qn("a:noFill")) is not None:
        return None, 0.0
    solid = ln.find(qn("a:solidFill"))
    if solid is None:
        return None, 0.0
    srgb = solid.find(qn("a:srgbClr"))
    if srgb is None or not srgb.get("val"):
        return None, 0.0
    w_emu = int(ln.get("w") or "9525")
    return _rgb_to_color(srgb.get("val")), max(0.25, w_emu / 12700.0)


def _render_pptx_table(
    c: rl_canvas.Canvas,
    shape,
    slide_h: float,
    fonts: _RenderFonts,
) -> None:
    """Render a native python-pptx table into crisp ReportLab vector cells & text."""
    try:
        tbl = shape.table
        bx = float(shape.left.pt)
        by = float(shape.top.pt)
        bw = float(shape.width.pt)
        bh = float(shape.height.pt)
        n_rows = len(tbl.rows)
        n_cols = len(tbl.columns)
        if n_rows == 0 or n_cols == 0:
            return

        col_widths = [float(col.width.pt) for col in tbl.columns]
        total_cw = sum(col_widths) or bw
        col_widths = [w * (bw / total_cw) for w in col_widths]

        row_heights = [float(row.height.pt) for row in tbl.rows]
        total_rh = sum(row_heights) or bh
        row_heights = [h * (bh / total_rh) for h in row_heights]

        cur_y = by
        for r_idx in range(n_rows):
            rh = row_heights[r_idx]
            cur_x = bx
            for c_idx in range(n_cols):
                cw = col_widths[c_idx]
                cell = tbl.cell(r_idx, c_idx)

                # Fill
                try:
                    if cell.fill.type == 1 and cell.fill.fore_color and cell.fill.fore_color.rgb:
                        c.saveState()
                        c.setFillColor(_rgb_to_color(cell.fill.fore_color.rgb))
                        c.rect(cur_x, slide_h - cur_y - rh, cw, rh, stroke=0, fill=1)
                        c.restoreState()
                except Exception:
                    pass

                # Borders (top & bottom hairlines)
                tcPr = cell._tc.find(qn("a:tcPr"))
                top_col, top_w = _extract_border_style(tcPr, "a:lnT")
                if top_col is not None and top_w > 0:
                    c.saveState()
                    c.setStrokeColor(top_col)
                    c.setLineWidth(top_w)
                    c.line(cur_x, slide_h - cur_y, cur_x + cw, slide_h - cur_y)
                    c.restoreState()

                bot_col, bot_w = _extract_border_style(tcPr, "a:lnB")
                if bot_col is not None and bot_w > 0:
                    c.saveState()
                    c.setStrokeColor(bot_col)
                    c.setLineWidth(bot_w)
                    c.line(cur_x, slide_h - cur_y - rh, cur_x + cw, slide_h - cur_y - rh)
                    c.restoreState()

                # Text
                tf = cell.text_frame
                raw_txt = (tf.text or "").replace("\x0b", "\n").strip()
                if raw_txt:
                    pad_l = float(cell.margin_left.pt) if cell.margin_left else 8.0
                    pad_r = float(cell.margin_right.pt) if cell.margin_right else 8.0
                    p0 = tf.paragraphs[0]
                    size_pt = 13.0
                    bold = False
                    txt_col = Color(0.2, 0.2, 0.22)
                    for run in p0.runs:
                        if run.font.size:
                            size_pt = float(run.font.size.pt)
                        if run.font.bold:
                            bold = True
                        try:
                            if run.font.color and run.font.color.rgb:
                                txt_col = _rgb_to_color(run.font.color.rgb, txt_col)
                        except Exception:
                            pass
                        break

                    avail_w = max(8.0, cw - pad_l - pad_r)
                    wrapped = _wrap_line(raw_txt.splitlines()[0], avail_w, size_pt, fonts, bold)
                    line_h = size_pt * 1.2
                    max_lines = max(1, int((rh - 4) // line_h))
                    vis_lines = wrapped[:max_lines]
                    block_h = len(vis_lines) * line_h
                    start_y = cur_y + max(2.0, (rh - block_h) / 2.0)

                    for li, ln_txt in enumerate(vis_lines):
                        lw = _measure_dual_width(ln_txt, size_pt, fonts, bold)
                        if p0.alignment == PP_ALIGN.RIGHT:
                            tx = cur_x + cw - pad_r - lw
                        elif p0.alignment == PP_ALIGN.CENTER:
                            tx = cur_x + (cw - lw) / 2.0
                        else:
                            tx = cur_x + pad_l
                        y_base = slide_h - (start_y + li * line_h + size_pt * 0.82)
                        _draw_dual_text(c, tx, y_base, ln_txt, size_pt, fonts, bold, txt_col)

                cur_x += cw
            cur_y += rh
    except Exception:
        pass


def _render_pptx_chart(
    c: rl_canvas.Canvas,
    shape,
    slide_h: float,
    fonts: _RenderFonts,
) -> None:
    """Render a native python-pptx chart cleanly as ReportLab vector graphics."""
    try:
        chart = shape.chart
        bx = float(shape.left.pt)
        by = float(shape.top.pt)
        bw = float(shape.width.pt)
        bh = float(shape.height.pt)

        plot = chart.plots[0]
        categories = [str(cat) for cat in plot.categories]
        if not categories or not plot.series:
            return

        default_palette = [
            Color(0.0, 0.443, 0.890),
            Color(0.114, 0.114, 0.122),
            Color(0.204, 0.659, 0.325),
            Color(0.902, 0.494, 0.133),
            Color(0.557, 0.557, 0.576),
        ]

        # Extract theme text & divider colors from chart properties
        title_col = Color(0.12, 0.12, 0.14)
        muted_col = Color(0.45, 0.45, 0.48)
        grid_col = Color(0.86, 0.86, 0.89)
        body_col = Color(0.25, 0.25, 0.28)
        chart_title = ""

        try:
            if chart.has_title and chart.chart_title and chart.chart_title.has_text_frame:
                chart_title = (chart.chart_title.text_frame.text or "").strip()
                for run in chart.chart_title.text_frame.paragraphs[0].runs:
                    if run.font.color and run.font.color.rgb:
                        title_col = _rgb_to_color(run.font.color.rgb, title_col)
                        break
        except Exception:
            pass

        try:
            if chart.chart_type != XL_CHART_TYPE.DOUGHNUT:
                if chart.category_axis.tick_labels.font.color.rgb:
                    muted_col = _rgb_to_color(chart.category_axis.tick_labels.font.color.rgb, muted_col)
                if chart.value_axis.major_gridlines.format.line.color.rgb:
                    grid_col = _rgb_to_color(chart.value_axis.major_gridlines.format.line.color.rgb, grid_col)
        except Exception:
            pass

        show_values = True
        value_suffix = ""
        try:
            show_values = bool(plot.has_data_labels)
            if show_values and plot.data_labels:
                if plot.data_labels.font.color.rgb:
                    body_col = _rgb_to_color(plot.data_labels.font.color.rgb, body_col)
                nf = plot.data_labels.number_format or ""
                m_suf = re.search(r'"([^"]+)"', nf)
                if m_suf:
                    value_suffix = m_suf.group(1)
        except Exception:
            pass

        series_data: list[tuple[str, list[float], Color, list[Color]]] = []
        for s_idx, s in enumerate(plot.series):
            s_col = default_palette[s_idx % len(default_palette)]
            try:
                if chart.chart_type in (XL_CHART_TYPE.LINE, XL_CHART_TYPE.LINE_MARKERS):
                    if s.format.line.color and s.format.line.color.rgb:
                        s_col = _rgb_to_color(s.format.line.color.rgb, s_col)
                else:
                    if s.format.fill.type == 1 and s.format.fill.fore_color.rgb:
                        s_col = _rgb_to_color(s.format.fill.fore_color.rgb, s_col)
            except Exception:
                pass

            pt_cols: list[Color] = []
            if chart.chart_type in (XL_CHART_TYPE.DOUGHNUT, XL_CHART_TYPE.PIE):
                for pt_i in range(len(categories)):
                    pc = default_palette[pt_i % len(default_palette)]
                    try:
                        pt = s.points[pt_i]
                        if pt.format.fill.type == 1 and pt.format.fill.fore_color.rgb:
                            pc = _rgb_to_color(pt.format.fill.fore_color.rgb, pc)
                    except Exception:
                        pass
                    pt_cols.append(pc)
            vals = [float(v) if v is not None else 0.0 for v in s.values]
            series_data.append((str(s.name or f"Series {s_idx + 1}"), vals, s_col, pt_cols))

        # Layout bands inside (bx, by, bw, bh)
        top_pad = 26.0 if chart_title else 10.0
        show_legend = len(series_data) > 1 or chart.chart_type in (
            XL_CHART_TYPE.DOUGHNUT,
            XL_CHART_TYPE.PIE,
        )
        bot_legend_h = 22.0 if show_legend else 4.0

        if chart_title:
            _draw_dual_text(
                c,
                bx + 4,
                slide_h - (by + 16),
                chart_title,
                13.5,
                fonts,
                True,
                title_col,
            )

        # ── Donut / Pie Chart ──
        if chart.chart_type in (XL_CHART_TYPE.DOUGHNUT, XL_CHART_TYPE.PIE):
            _, vals, _, pt_cols = series_data[0]
            total_v = sum(max(0.0, v) for v in vals) or 1.0
            area_h = max(40.0, bh - top_pad - bot_legend_h - 8.0)
            outer_r = min(bw * 0.36, area_h * 0.46)
            inner_r = outer_r * (0.56 if chart.chart_type == XL_CHART_TYPE.DOUGHNUT else 0.0)
            cx = bx + bw * 0.5
            cy_top = by + top_pad + area_h * 0.5
            cy_pdf = slide_h - cy_top

            angle_deg = 90.0  # start at 12 o'clock, sweep clockwise
            for idx_v, val in enumerate(vals):
                v = max(0.0, val)
                sweep = (v / total_v) * 360.0
                if sweep <= 0.1:
                    continue
                col = pt_cols[idx_v] if idx_v < len(pt_cols) else default_palette[idx_v % len(default_palette)]
                steps = max(8, int(math.ceil(sweep / 6.0)))
                p = c.beginPath()
                a0 = math.radians(angle_deg)
                p.moveTo(cx + outer_r * math.cos(a0), cy_pdf + outer_r * math.sin(a0))
                for st in range(1, steps + 1):
                    ang = math.radians(angle_deg - sweep * (st / steps))
                    p.lineTo(cx + outer_r * math.cos(ang), cy_pdf + outer_r * math.sin(ang))
                if inner_r > 1.0:
                    for st in range(steps, -1, -1):
                        ang = math.radians(angle_deg - sweep * (st / steps))
                        p.lineTo(cx + inner_r * math.cos(ang), cy_pdf + inner_r * math.sin(ang))
                else:
                    p.lineTo(cx, cy_pdf)
                p.close()
                c.saveState()
                c.setFillColor(col)
                c.drawPath(p, stroke=0, fill=1)
                c.restoreState()

                if show_values and sweep >= 18.0:
                    mid_rad = math.radians(angle_deg - sweep / 2.0)
                    lr = outer_r + 14.0
                    lbl = _fmt_chart_num(v, value_suffix)
                    lw = _measure_dual_width(lbl, 9.5, fonts, True)
                    lx = cx + lr * math.cos(mid_rad) - lw / 2.0
                    ly = cy_pdf + lr * math.sin(mid_rad) - 3.5
                    _draw_dual_text(c, lx, ly, lbl, 9.5, fonts, True, body_col)
                angle_deg -= sweep

            # Bottom legend for donut categories
            if show_legend:
                leg_items = [
                    (categories[i], pt_cols[i] if i < len(pt_cols) else default_palette[i % len(default_palette)])
                    for i in range(len(categories))
                ]
                _draw_chart_legend(c, bx, by + bh - 14, bw, slide_h, leg_items, fonts, muted_col)
            return

        # ── Horizontal Bar Chart ──
        if chart.chart_type == XL_CHART_TYPE.BAR_CLUSTERED:
            max_val = max((max(vals) for _, vals, _, _ in series_data if vals), default=1.0)
            max_val = max(max_val, 1e-6)
            label_w = min(bw * 0.34, max(54.0, max(_measure_dual_width(cat, 10.0, fonts, False) for cat in categories) + 12.0))
            right_pad = 38.0 if show_values else 12.0
            px = bx + label_w
            pw = max(40.0, bw - label_w - right_pad)
            py = by + top_pad
            ph = max(40.0, bh - top_pad - bot_legend_h - 8.0)

            n_cat = len(categories)
            n_ser = len(series_data)
            slot_h = ph / max(1, n_cat)
            group_h = slot_h * 0.68
            bar_h = max(4.0, group_h / max(1, n_ser) - (2.0 if n_ser > 1 else 0.0))

            # Subtle vertical baseline
            c.saveState()
            c.setStrokeColor(grid_col)
            c.setLineWidth(0.75)
            c.line(px, slide_h - py, px, slide_h - (py + ph))
            c.restoreState()

            for ci, cat in enumerate(categories):
                slot_top = py + ci * slot_h
                lbl_w = _measure_dual_width(cat, 10.0, fonts, False)
                _draw_dual_text(
                    c,
                    px - 8.0 - min(lbl_w, label_w - 10.0),
                    slide_h - (slot_top + slot_h / 2.0 + 3.5),
                    cat,
                    10.0,
                    fonts,
                    False,
                    muted_col,
                )
                g_top = slot_top + (slot_h - group_h) / 2.0
                for si, (_, vals, scol, _) in enumerate(series_data):
                    v = max(0.0, vals[ci]) if ci < len(vals) else 0.0
                    bar_w = (v / max_val) * pw
                    by_bar = g_top + si * (bar_h + 2.0)
                    c.saveState()
                    c.setFillColor(scol)
                    c.roundRect(px, slide_h - by_bar - bar_h, max(1.5, bar_w), bar_h, min(3.0, bar_h / 2.5), stroke=0, fill=1)
                    c.restoreState()
                    if show_values:
                        lbl = _fmt_chart_num(v, value_suffix)
                        _draw_dual_text(
                            c,
                            px + bar_w + 5.0,
                            slide_h - (by_bar + bar_h / 2.0 + 3.2),
                            lbl,
                            9.5,
                            fonts,
                            True,
                            body_col,
                        )

            if show_legend:
                leg_items = [(name, scol) for name, _, scol, _ in series_data]
                _draw_chart_legend(c, bx, by + bh - 14, bw, slide_h, leg_items, fonts, muted_col)
            return

        # ── Vertical Column (`bar`), Stacked Column (`stacked_bar`), or Line (`line`) Chart ──
        is_stacked = chart.chart_type == XL_CHART_TYPE.COLUMN_STACKED
        n_cat = len(categories)
        n_ser = len(series_data)
        if is_stacked:
            pos_sums = [
                sum(max(0.0, vals[ci]) for _, vals, _, _ in series_data if ci < len(vals))
                for ci in range(n_cat)
            ]
            neg_sums = [
                sum(min(0.0, vals[ci]) for _, vals, _, _ in series_data if ci < len(vals))
                for ci in range(n_cat)
            ]
            raw_max = max(pos_sums, default=1.0)
            min_val = min(0.0, min(neg_sums, default=0.0))
        else:
            all_vals = [v for _, vals, _, _ in series_data for v in vals]
            raw_max = max(all_vals, default=1.0)
            min_val = min(0.0, min(all_vals, default=0.0))
        max_val = max(raw_max * 1.12, 1e-6)
        span = max(max_val - min_val, 1e-6)

        y_axis_w = 34.0
        x_label_h = 20.0
        px = bx + y_axis_w
        pw = max(40.0, bw - y_axis_w - 10.0)
        py = by + top_pad + 8.0
        ph = max(40.0, bh - top_pad - 8.0 - x_label_h - bot_legend_h)

        # 4 horizontal hairline gridlines + Y ticks
        ticks = 4
        for ti in range(ticks + 1):
            frac = ti / ticks
            gy = py + ph * (1.0 - frac)
            c.saveState()
            c.setStrokeColor(grid_col)
            c.setLineWidth(0.75 if ti == 0 else 0.5)
            c.line(px, slide_h - gy, px + pw, slide_h - gy)
            c.restoreState()
            tv = min_val + span * frac
            tlbl = _fmt_chart_num(tv, "")
            tw = _measure_dual_width(tlbl, 8.5, fonts, False)
            _draw_dual_text(c, px - 6.0 - tw, slide_h - (gy + 3.0), tlbl, 8.5, fonts, False, muted_col)

        slot_w = pw / max(1, n_cat)

        # X-axis category labels
        for ci, cat in enumerate(categories):
            cx = px + (ci + 0.5) * slot_w
            cw_lbl = _measure_dual_width(cat, 9.5, fonts, False)
            _draw_dual_text(
                c,
                cx - cw_lbl / 2.0,
                slide_h - (py + ph + 14.0),
                cat,
                9.5,
                fonts,
                False,
                muted_col,
            )

        if chart.chart_type in (XL_CHART_TYPE.LINE, XL_CHART_TYPE.LINE_MARKERS):
            for _, vals, scol, _ in series_data:
                pts: list[tuple[float, float, float]] = []
                for ci in range(n_cat):
                    v = vals[ci] if ci < len(vals) else 0.0
                    cx = px + (ci + 0.5) * slot_w
                    cy = py + ph * (1.0 - (v - min_val) / span)
                    pts.append((cx, cy, v))
                c.saveState()
                c.setStrokeColor(scol)
                c.setLineWidth(2.2)
                for i in range(len(pts) - 1):
                    c.line(pts[i][0], slide_h - pts[i][1], pts[i + 1][0], slide_h - pts[i + 1][1])
                c.setFillColor(scol)
                for cx, cy, _ in pts:
                    c.circle(cx, slide_h - cy, 3.5, stroke=0, fill=1)
                c.restoreState()
                if show_values:
                    for cx, cy, v in pts:
                        lbl = _fmt_chart_num(v, value_suffix)
                        lw = _measure_dual_width(lbl, 9.0, fonts, True)
                        _draw_dual_text(c, cx - lw / 2.0, slide_h - (cy - 7.0), lbl, 9.0, fonts, True, body_col)
        elif is_stacked:
            bar_w = min(slot_w * 0.56, 68.0)
            for ci in range(n_cat):
                bx_bar = px + (ci + 0.5) * slot_w - bar_w / 2.0
                cum_pos = 0.0
                cum_neg = 0.0
                pos_indices = [
                    si
                    for si, (_, vals, _, _) in enumerate(series_data)
                    if (vals[ci] if ci < len(vals) else 0.0) > 0.0
                ]
                top_pos_si = pos_indices[-1] if pos_indices else -1
                for si, (_, vals, scol, _) in enumerate(series_data):
                    v = vals[ci] if ci < len(vals) else 0.0
                    if abs(v) < 1e-9:
                        continue
                    if v >= 0.0:
                        y_bot = py + ph * (1.0 - (cum_pos - min_val) / span)
                        cum_pos += v
                        y_top = py + ph * (1.0 - (cum_pos - min_val) / span)
                    else:
                        y_top = py + ph * (1.0 - (cum_neg - min_val) / span)
                        cum_neg += v
                        y_bot = py + ph * (1.0 - (cum_neg - min_val) / span)
                    seg_h = max(1.5, abs(y_bot - y_top))
                    seg_top = min(y_top, y_bot)
                    c.saveState()
                    c.setFillColor(scol)
                    if si == top_pos_si and seg_h >= 6.0:
                        c.roundRect(
                            bx_bar,
                            slide_h - seg_top - seg_h,
                            bar_w,
                            seg_h,
                            min(3.0, bar_w / 4.0),
                            stroke=0,
                            fill=1,
                        )
                        # Square off the bottom corners so segments stack flush
                        c.rect(
                            bx_bar,
                            slide_h - seg_top - seg_h,
                            bar_w,
                            min(3.5, seg_h / 2.0),
                            stroke=0,
                            fill=1,
                        )
                    else:
                        c.rect(
                            bx_bar,
                            slide_h - seg_top - seg_h,
                            bar_w,
                            seg_h,
                            stroke=0,
                            fill=1,
                        )
                    c.restoreState()
                    if show_values and seg_h >= 15.0:
                        lum = 0.2126 * scol.red + 0.7152 * scol.green + 0.0722 * scol.blue
                        lbl_col = Color(1.0, 1.0, 1.0) if lum < 0.62 else Color(0.10, 0.10, 0.12)
                        lbl = _fmt_chart_num(v, value_suffix)
                        lw = _measure_dual_width(lbl, 8.8, fonts, True)
                        if lw <= bar_w + 6.0:
                            _draw_dual_text(
                                c,
                                bx_bar + (bar_w - lw) / 2.0,
                                slide_h - (seg_top + seg_h / 2.0 + 3.0),
                                lbl,
                                8.8,
                                fonts,
                                True,
                                lbl_col,
                            )
        else:
            group_w = min(slot_w * 0.64, 56.0 * n_ser)
            bar_w = max(6.0, (group_w - max(0, n_ser - 1) * 3.0) / max(1, n_ser))
            base_y = py + ph * (1.0 - (0.0 - min_val) / span)
            for ci in range(n_cat):
                g_left = px + (ci + 0.5) * slot_w - group_w / 2.0
                for si, (_, vals, scol, _) in enumerate(series_data):
                    v = vals[ci] if ci < len(vals) else 0.0
                    top_y = py + ph * (1.0 - (v - min_val) / span)
                    bx_bar = g_left + si * (bar_w + 3.0)
                    bh_bar = max(1.5, abs(base_y - top_y))
                    bar_top = min(top_y, base_y)
                    c.saveState()
                    c.setFillColor(scol)
                    c.roundRect(bx_bar, slide_h - bar_top - bh_bar, bar_w, bh_bar, min(3.0, bar_w / 3.0), stroke=0, fill=1)
                    c.restoreState()
                    if show_values:
                        lbl = _fmt_chart_num(v, value_suffix)
                        lw = _measure_dual_width(lbl, 9.0, fonts, True)
                        _draw_dual_text(
                            c,
                            bx_bar + (bar_w - lw) / 2.0,
                            slide_h - (bar_top - 4.5),
                            lbl,
                            9.0,
                            fonts,
                            True,
                            body_col,
                        )

        if show_legend:
            leg_items = [(name, scol) for name, _, scol, _ in series_data]
            _draw_chart_legend(c, bx, by + bh - 14, bw, slide_h, leg_items, fonts, muted_col)
    except Exception:
        pass


def _draw_chart_legend(
    c: rl_canvas.Canvas,
    bx: float,
    top_y: float,
    bw: float,
    slide_h: float,
    items: list[tuple[str, Color]],
    fonts: _RenderFonts,
    text_col: Color,
) -> None:
    widths = [12.0 + _measure_dual_width(lbl, 9.0, fonts, False) for lbl, _ in items]
    gap = 14.0
    total_w = sum(widths) + gap * max(0, len(items) - 1)
    cur_x = bx + max(4.0, (bw - total_w) / 2.0)
    for (lbl, col), iw in zip(items, widths):
        c.saveState()
        c.setFillColor(col)
        c.roundRect(cur_x, slide_h - (top_y + 7.5), 7.5, 7.5, 2.0, stroke=0, fill=1)
        c.restoreState()
        _draw_dual_text(c, cur_x + 11.0, slide_h - (top_y + 7.0), lbl, 9.0, fonts, False, text_col)
        cur_x += iw + gap


def _extract_slide_title(slide) -> str:
    """Extract the primary visible title text from a PPTX slide for PDF bookmarks."""
    for shape in slide.shapes:
        if not shape.has_text_frame:
            continue
        try:
            top_pt = float(shape.top.pt)
        except Exception:
            top_pt = 0.0
        text = (shape.text_frame.text or "").replace("\x0b", "\n").strip()
        if not text:
            continue
        # Skip bottom-right page numbers (e.g. "02 / 05")
        if top_pt >= 490.0 and re.fullmatch(r"\d+\s*/\s*\d+", text):
            continue
        first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        if first_line:
            compact = " ".join(first_line.split())
            return compact[:60] + ("…" if len(compact) > 60 else "")
    return ""


def _render_pptx_to_pdf(pptx_path: pathlib.Path, pdf_path: pathlib.Path) -> int:
    """Render a Draftboard PPTX directly into a vector PDF via ReportLab."""
    prs = Presentation(str(pptx_path))
    slide_w = float(prs.slide_width.pt)
    slide_h = float(prs.slide_height.pt)
    fonts = _resolve_render_fonts()

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    c = rl_canvas.Canvas(str(pdf_path), pagesize=(slide_w, slide_h))
    first_title = _extract_slide_title(prs.slides[0]) if len(prs.slides) > 0 else ""
    doc_title = (
        (prs.core_properties.title or "").strip()
        or first_title
        or pptx_path.stem
    )
    c.setTitle(doc_title)
    c.setAuthor((prs.core_properties.author or "").strip() or "Draftboard")
    c.setSubject("Generated by Draftboard")

    for slide_idx, slide in enumerate(prs.slides, start=1):
        bookmark_key = f"slide-{slide_idx}"
        slide_title = _extract_slide_title(slide)
        bookmark_label = (
            f"{slide_idx:02d}. {slide_title}" if slide_title else f"第 {slide_idx} 页"
        )
        c.bookmarkPage(bookmark_key)
        c.addOutlineEntry(bookmark_label, bookmark_key, level=0)

        # 1. Background fill
        bg_color = Color(1.0, 1.0, 1.0)
        try:
            fill = slide.background.fill
            if fill.type == 1 and fill.fore_color and fill.fore_color.rgb:
                bg_color = _rgb_to_color(fill.fore_color.rgb, bg_color)
        except Exception:
            pass
        c.setFillColor(bg_color)
        c.rect(0, 0, slide_w, slide_h, stroke=0, fill=1)

        # 2. Shapes in exact Z-order
        for shape in slide.shapes:
            # Connector / decorative line
            if shape.shape_type == MSO_SHAPE_TYPE.LINE or hasattr(shape, "begin_x"):
                try:
                    x1 = float(shape.begin_x.pt)
                    y1 = float(shape.begin_y.pt)
                    x2 = float(shape.end_x.pt)
                    y2 = float(shape.end_y.pt)
                    lw = float(shape.line.width.pt) if shape.line.width else 1.0
                    lc = _rgb_to_color(
                        shape.line.color.rgb if shape.line.color else None,
                        Color(0.85, 0.85, 0.87),
                    )
                    c.saveState()
                    c.setStrokeColor(lc)
                    c.setLineWidth(lw)
                    c.setLineCap(1)
                    c.line(x1, slide_h - y1, x2, slide_h - y2)
                    c.restoreState()
                except Exception:
                    pass
                continue

            # Embedded picture
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                try:
                    img_reader = ImageReader(io.BytesIO(shape.image.blob))
                    bx = float(shape.left.pt)
                    by = float(shape.top.pt)
                    bw = float(shape.width.pt)
                    bh = float(shape.height.pt)
                    c.drawImage(
                        img_reader,
                        bx,
                        slide_h - by - bh,
                        width=bw,
                        height=bh,
                        mask="auto",
                    )
                except Exception:
                    pass
                continue

            # AutoShape (rounded rectangle / card primitive from custom freeform slides)
            if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE:
                try:
                    bx = float(shape.left.pt)
                    by = float(shape.top.pt)
                    bw = float(shape.width.pt)
                    bh = float(shape.height.pt)

                    has_fill = False
                    fill_col = None
                    try:
                        if shape.fill.type == 1 and shape.fill.fore_color and shape.fill.fore_color.rgb:
                            fill_col = _rgb_to_color(shape.fill.fore_color.rgb)
                            has_fill = True
                    except Exception:
                        pass

                    has_stroke = False
                    stroke_col = None
                    stroke_w = 1.0
                    try:
                        if (
                            shape.line.fill.type == 1
                            and shape.line.color
                            and shape.line.color.rgb
                        ):
                            stroke_col = _rgb_to_color(shape.line.color.rgb)
                            stroke_w = float(shape.line.width.pt) if shape.line.width else 1.0
                            has_stroke = stroke_w > 0
                    except Exception:
                        pass

                    radius_pt = 0.0
                    try:
                        if (
                            shape.auto_shape_type == MSO_SHAPE.ROUNDED_RECTANGLE
                            and len(shape.adjustments) > 0
                        ):
                            radius_pt = max(0.0, float(shape.adjustments[0]) * min(bw, bh))
                    except Exception:
                        pass

                    if has_fill or has_stroke:
                        c.saveState()
                        if has_fill and fill_col is not None:
                            c.setFillColor(fill_col)
                        if has_stroke and stroke_col is not None:
                            c.setStrokeColor(stroke_col)
                            c.setLineWidth(stroke_w)
                        auto_type = None
                        try:
                            auto_type = shape.auto_shape_type
                        except Exception:
                            pass
                        if auto_type == MSO_SHAPE.OVAL:
                            c.ellipse(
                                bx,
                                slide_h - by - bh,
                                bx + bw,
                                slide_h - by,
                                stroke=1 if has_stroke else 0,
                                fill=1 if has_fill else 0,
                            )
                        elif auto_type == MSO_SHAPE.RIGHT_ARROW:
                            head_w = min(bw * 0.52, bh * 0.85)
                            shaft_h = bh * 0.36
                            mid_y = slide_h - (by + bh / 2.0)
                            top_y = slide_h - by
                            bot_y = slide_h - (by + bh)
                            shaft_x = bx + bw - head_w
                            p = c.beginPath()
                            p.moveTo(bx, mid_y + shaft_h / 2.0)
                            p.lineTo(shaft_x, mid_y + shaft_h / 2.0)
                            p.lineTo(shaft_x, top_y)
                            p.lineTo(bx + bw, mid_y)
                            p.lineTo(shaft_x, bot_y)
                            p.lineTo(shaft_x, mid_y - shaft_h / 2.0)
                            p.lineTo(bx, mid_y - shaft_h / 2.0)
                            p.close()
                            c.drawPath(
                                p,
                                stroke=1 if has_stroke else 0,
                                fill=1 if has_fill else 0,
                            )
                        elif radius_pt > 0.1:
                            c.roundRect(
                                bx,
                                slide_h - by - bh,
                                bw,
                                bh,
                                radius_pt,
                                stroke=1 if has_stroke else 0,
                                fill=1 if has_fill else 0,
                            )
                        else:
                            c.rect(
                                bx,
                                slide_h - by - bh,
                                bw,
                                bh,
                                stroke=1 if has_stroke else 0,
                                fill=1 if has_fill else 0,
                            )
                        c.restoreState()
                except Exception:
                    pass
                # Only continue if the AutoShape has no text content inside
                if not shape.has_text_frame or not (shape.text_frame.text or "").strip():
                    continue

            # Native PowerPoint table
            if shape.has_table:
                _render_pptx_table(c, shape, slide_h, fonts)
                continue

            # Native PowerPoint chart
            if shape.has_chart:
                _render_pptx_chart(c, shape, slide_h, fonts)
                continue

            # Textbox
            if shape.has_text_frame:
                bx = float(shape.left.pt)
                by = float(shape.top.pt)
                bw = float(shape.width.pt)
                bh = float(shape.height.pt)
                tf = shape.text_frame
                ml = float(tf.margin_left.pt) if tf.margin_left is not None else 0.0
                mr = float(tf.margin_right.pt) if tf.margin_right is not None else 0.0
                mt = float(tf.margin_top.pt) if tf.margin_top is not None else 0.0

                cursor_y = by + mt
                box_bottom = by + bh

                for para in tf.paragraphs:
                    first_run = para.runs[0] if para.runs else None
                    size_pt = (
                        float(first_run.font.size.pt)
                        if (first_run and first_run.font.size)
                        else 18.0
                    )
                    bold = bool(first_run and first_run.font.bold)
                    text_color = _rgb_to_color(
                        first_run.font.color.rgb
                        if (first_run and first_run.font.color and first_run.font.color.type == 1)
                        else None,
                        Color(0.15, 0.15, 0.15),
                    )
                    if para.line_spacing is not None and hasattr(para.line_spacing, "pt"):
                        line_pt = float(para.line_spacing.pt)
                    elif isinstance(para.line_spacing, (int, float)):
                        line_pt = size_pt * float(para.line_spacing)
                    else:
                        line_pt = size_pt * 1.25
                    space_after = (
                        float(para.space_after.pt)
                        if (para.space_after is not None and hasattr(para.space_after, "pt"))
                        else 0.0
                    )
                    is_bullet, bullet_color, indent_pt = _paragraph_bullet_info(para)

                    raw_text = para.text or ""
                    # python-pptx represents <a:br/> soft line breaks as vertical tab (\x0b)
                    hard_lines = re.split(r"[\n\x0b]+", raw_text)
                    avail_w = max(10.0, bw - ml - mr - (indent_pt if is_bullet else 0.0))

                    wrapped_all: list[str] = []
                    for hl in hard_lines:
                        if tf.word_wrap is False:
                            wrapped_all.append(hl)
                        else:
                            wrapped_all.extend(_wrap_line(hl, avail_w, size_pt, fonts, bold))

                    for line_idx, line_str in enumerate(wrapped_all):
                        if cursor_y + size_pt * 0.4 > box_bottom + 4:
                            break
                        y_baseline = slide_h - (cursor_y + size_pt * 0.86)
                        text_left = bx + ml + (indent_pt if is_bullet else 0.0)
                        line_w = _measure_dual_width(line_str, size_pt, fonts, bold)

                        if para.alignment == PP_ALIGN.CENTER:
                            draw_x = bx + ml + max(0.0, (bw - ml - mr - line_w) / 2.0)
                        elif para.alignment == PP_ALIGN.RIGHT:
                            draw_x = bx + bw - mr - line_w
                        else:
                            draw_x = text_left

                        if is_bullet and line_idx == 0 and line_str.strip():
                            dot_color = bullet_color or text_color
                            dot_r = max(2.2, size_pt * 0.16)
                            dot_cx = bx + ml + dot_r + 1.5
                            dot_cy = y_baseline + size_pt * 0.32
                            c.setFillColor(dot_color)
                            c.circle(dot_cx, dot_cy, dot_r, stroke=0, fill=1)

                        _draw_dual_text(
                            c, draw_x, y_baseline, line_str, size_pt, fonts, bold, text_color
                        )
                        cursor_y += line_pt

                    cursor_y += space_after

        c.showPage()

    if len(prs.slides) > 0:
        c.showOutline()
    c.save()
    return len(prs.slides)


def render_preview(pptx_path: pathlib.Path, out_dir: pathlib.Path) -> list[pathlib.Path]:
    """Render a PPTX into a vector PDF (`deck.pdf`) and per-page HD PNGs under `out_dir`.

    Uses pure-Python ReportLab + pypdfium2 with zero external binary dependencies.
    Returns the sorted list of generated page image paths.
    """
    pptx_path = pathlib.Path(pptx_path)
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pdf_path = out_dir / "deck.pdf"
    _render_pptx_to_pdf(pptx_path, pdf_path)

    # Remove stale PNGs if page count decreased
    for old in out_dir.glob("page-*.png"):
        old.unlink(missing_ok=True)

    pages: list[pathlib.Path] = []
    with pdfium.PdfDocument(str(pdf_path)) as pdf:
        for index in range(len(pdf)):
            # 960x540pt at scale=2.0 -> crisp 1920x1080 HD preview PNG
            bitmap = pdf[index].render(scale=2.0)
            page_path = out_dir / f"page-{index + 1:03d}.png"
            bitmap.to_pil().save(page_path)
            pages.append(page_path)
    return pages
