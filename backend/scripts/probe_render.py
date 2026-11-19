"""
Real-render calibration probe (phase 1, step 7).

Exports the fixed regression decks with real system fonts, renders them via
headless LibreOffice to PDF, and compares the actual rendered text extents
against draftboard.measure estimates.  Reports per-box line counts, occupied
height ratios, clipping, and font substitution.

Usage:
    uv run python scripts/probe_render.py

NOTE: LibreOffice results only prove the LibreOffice environment.  Final
acceptance for a PowerPoint target must happen in PowerPoint.  Keep this
script for calibration and regression; it is not the sole acceptance basis.
"""

import os
import pathlib
import subprocess
import sys
import tempfile

import pdfplumber
from pptx import Presentation
from pptx.util import Emu

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "src"))

from draftboard.measure import HEIGHT_MARGIN, load_fonts, measure_box
from draftboard.models import Artifact
from draftboard.pptx_export import (
    BULLET_INDENT_PT,
    PAD_X_PT,
    PAD_Y_PT,
    _box_for,
    _group_boxes,
    _style_for,
    export_pptx,
)

ROOT = pathlib.Path(__file__).parent.parent
# soffice.com is the console wrapper; soffice.exe is a GUI-subprocess
# launcher that can hang without ever writing output on Windows.
SOFFICE = pathlib.Path(r"C:\Program Files\LibreOffice\program\soffice.com")
DECKS = [ROOT / "examples" / "sample_deck.json"] + sorted(
    (ROOT / "tests" / "fixtures" / "decks").glob("*.json")
)
PASS_STEMS = {
    "sample_deck", "long_title", "near_full_body", "many_bullets",
    "mixed_punctuation",
}


def pt(emu) -> float:
    return Emu(emu).pt


def render_pdf(pptx_path: pathlib.Path, out_dir: pathlib.Path) -> pathlib.Path:
    profile = out_dir / "lo-profile"
    lo_tmp = out_dir / "lo-tmp"
    lo_tmp.mkdir(exist_ok=True)
    # LibreOffice's save pipeline writes temp files via %TMP%/%TEMP%; in
    # sandboxed shells those point outside the writable area and the store
    # fails with an Io Write error.  Keep them inside out_dir.
    env = dict(os.environ, TMP=str(lo_tmp), TEMP=str(lo_tmp))
    subprocess.run(
        [
            str(SOFFICE),
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--norestore",
            "--nofirststartwizard",
            "--convert-to", "pdf",
            "--outdir", str(out_dir), str(pptx_path),
        ],
        check=True, capture_output=True, timeout=180, env=env,
    )
    pdf = out_dir / (pptx_path.stem + ".pdf")
    if not pdf.exists():
        raise RuntimeError(f"LibreOffice produced no PDF for {pptx_path.name}")
    return pdf


def assign_chars(page, boxes):
    """Assign each PDF char to the nearest box above it with matching x-range.

    boxes: list of dicts with left/top/width/height.  Chars overflowing a
    box bottom still belong to that box (nearest above), while chars of a
    lower box are not stolen by the box above it.
    """
    assigned = [[] for _ in boxes]
    for c in page.chars:
        cx = (c["x0"] + c["x1"]) / 2
        best = None
        for i, b in enumerate(boxes):
            if not (b["left"] - 1 <= cx <= b["left"] + b["width"] + 1):
                continue
            if c["top"] < b["top"] - 1:
                continue
            if best is None or b["top"] > boxes[best]["top"]:
                best = i
        if best is not None:
            assigned[best].append(c)
    return assigned


def line_count(chars) -> int:
    # Bullet glyphs (OpenSymbol) sit on a different baseline; counting them
    # would double every bullet line.
    tops = sorted(
        c["top"] for c in chars if "OpenSymbol" not in c["fontname"]
    )
    lines = 0
    prev = None
    for t in tops:
        if prev is None or t - prev > 3:
            lines += 1
        prev = t
    return lines


def main() -> int:
    if not SOFFICE.exists():
        print(f"LibreOffice not found at {SOFFICE}", file=sys.stderr)
        return 2
    fonts = load_fonts()
    max_ratio = 0.0
    problems: list[str] = []
    font_names: set[str] = set()

    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        tmp = pathlib.Path(tmp)
        for deck_path in DECKS:
            if deck_path.stem not in PASS_STEMS:
                continue
            artifact = Artifact.model_validate_json(
                deck_path.read_text(encoding="utf-8")
            )
            pptx_path = tmp / (deck_path.stem + ".pptx")
            export_pptx(artifact, pptx_path, fonts=fonts)
            pdf_path = render_pdf(pptx_path, tmp)
            prs = Presentation(str(pptx_path))

            with pdfplumber.open(pdf_path) as pdf:
                for page, slide, ir_slide in zip(pdf.pages, prs.slides, artifact.slides):
                    records = []
                    for role, items in _group_boxes(ir_slide):
                        shape = next(
                            s for s in slide.shapes
                            if s.has_text_frame
                            and (pt(s.left), pt(s.top), pt(s.width), pt(s.height))
                            == _box_for(ir_slide.layout, role)
                        )
                        left, top = pt(shape.left), pt(shape.top)
                        width, height = pt(shape.width), pt(shape.height)
                        size_pt, line_pt, sa_pt = _style_for(ir_slide.layout, role)
                        contents = [c for _, c in items]
                        m = measure_box(
                            contents,
                            fonts=fonts, width_pt=width, height_pt=height,
                            size_pt=size_pt, line_pt=line_pt,
                            space_after_pt=sa_pt,
                            pad_x_pt=PAD_X_PT, pad_y_pt=PAD_Y_PT,
                            indent_pt=BULLET_INDENT_PT if role == "bullet" else 0,
                        )
                        empty_lines = sum(
                            seg == "" for t in contents for seg in t.split("\n")
                        )
                        records.append({
                            "left": left, "top": top,
                            "width": width, "height": height,
                            "m": m, "empty_lines": empty_lines,
                            "label": f"{deck_path.stem}/{ir_slide.slide_id}/{role}",
                        })
                    for rec, chars in zip(records, assign_chars(page, records)):
                        label = rec["label"]
                        m = rec["m"]
                        top, height = rec["top"], rec["height"]
                        if not chars:
                            problems.append(f"{label}: no rendered text found")
                            continue
                        for c in chars:
                            font_names.add(c["fontname"])
                        rendered_lines = line_count(chars)
                        expected_visible = m.total_lines - rec["empty_lines"]
                        text_bottom = max(c["bottom"] for c in chars)
                        occupied = (text_bottom - top) + PAD_Y_PT
                        ratio = occupied / m.required_height_pt
                        max_ratio = max(max_ratio, ratio)
                        clipped = text_bottom > top + height + 0.5
                        status = "CLIP" if clipped else "ok"
                        if clipped:
                            problems.append(f"{label}: text exceeds box bottom")
                        if rendered_lines != expected_visible:
                            problems.append(
                                f"{label}: line mismatch "
                                f"est={expected_visible} rendered={rendered_lines}"
                            )
                            status += " LINES"
                        print(
                            f"{label:42s} est_lines={expected_visible:2d} "
                            f"rendered={rendered_lines:2d} "
                            f"req={m.required_height_pt:6.1f}pt "
                            f"occupied={occupied:6.1f}pt "
                            f"ratio={ratio:.3f} {status}"
                        )

    print()
    print(f"fonts seen in PDF: {sorted(font_names)}")
    print(f"max occupied/required ratio: {max_ratio:.3f}")
    print(f"current HEIGHT_MARGIN: {HEIGHT_MARGIN} -> supported: {max_ratio <= 1 + HEIGHT_MARGIN}")
    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print(" -", p)
        return 1
    print("no clipping, all line counts match")
    return 0


if __name__ == "__main__":
    sys.exit(main())