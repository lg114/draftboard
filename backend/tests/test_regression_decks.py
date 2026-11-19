"""
Fixed-deck regression suite (phase 1, step 7).

Every code change re-runs the same frozen sample decks.  Passing decks must
export with zero content loss, in-bounds non-overlapping independent text
boxes, and deterministic geometry.  Failing decks must be rejected with the
page and block IDs.  Runs on synthetic fonts everywhere; additionally on
real system fonts where available.
"""

import pathlib

import pytest
from pptx import Presentation
from pptx.util import Pt

from draftboard.measure import load_fonts
from draftboard.models import Artifact
from draftboard.pptx_export import CANVAS_H_PT, CANVAS_W_PT, export_pptx

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "decks"
SAMPLE = pathlib.Path(__file__).parent.parent / "examples" / "sample_deck.json"

PASS_DECKS = [
    SAMPLE,
    FIXTURES / "long_title.json",
    FIXTURES / "near_full_body.json",
    FIXTURES / "many_bullets.json",
    FIXTURES / "mixed_punctuation.json",
]

# (deck, expected issue code, slide id, element id)
FAIL_DECKS = [
    (FIXTURES / "overlong_url.json", "OVERLONG_WORD", "slide-001", "ou-left"),
    (FIXTURES / "overflow_body.json", "OVERFLOW", "slide-001", "ob-text"),
    (FIXTURES / "overflow_title.json", "OVERFLOW", "slide-001", "ot-title"),
]

REAL_FONTS_EXIST = (
    pathlib.Path(r"C:\Windows\Fonts\calibri.ttf").exists()
    and pathlib.Path(r"C:\Windows\Fonts\msyh.ttc").exists()
)


def _load(path: pathlib.Path) -> Artifact:
    return Artifact.model_validate_json(path.read_text(encoding="utf-8"))


def _textboxes(slide):
    return [s for s in slide.shapes if s.has_text_frame]


def _geometry(prs):
    return [
        [
            (s.left, s.top, s.width, s.height,
             s.text_frame.text if s.has_text_frame else None)
            for s in slide.shapes
        ]
        for slide in prs.slides
    ]


# ── passing decks ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("deck_path", PASS_DECKS, ids=lambda p: p.stem)
def test_pass_deck_export_checks(deck_path, tmp_path, font_pair):
    artifact = _load(deck_path)
    out = tmp_path / "deck.pptx"
    export_pptx(artifact, out, fonts=font_pair)
    prs = Presentation(str(out))
    assert len(prs.slides) == len(artifact.slides)

    for pptx_slide, ir_slide in zip(prs.slides, artifact.slides):
        joined = "\n".join(s.text_frame.text for s in _textboxes(pptx_slide))
        for el in ir_slide.elements:
            for line in el.content.split("\n"):
                if line:
                    assert line in joined, f"Lost text from {el.element_id}"
        boxes = _textboxes(pptx_slide)
        assert boxes, "slide has no text boxes"
        for s in boxes:
            assert s.left >= 0 and s.top >= 0
            assert s.left + s.width <= Pt(CANVAS_W_PT)
            assert s.top + s.height <= Pt(CANVAS_H_PT)
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                ox = a.left < b.left + b.width and b.left < a.left + a.width
                oy = a.top < b.top + b.height and b.top < a.top + a.height
                assert not (ox and oy), f"Overlap in {ir_slide.slide_id}"
        assert not any(s.shape_type == 13 for s in pptx_slide.shapes)


@pytest.mark.parametrize("deck_path", PASS_DECKS, ids=lambda p: p.stem)
def test_pass_deck_deterministic(deck_path, tmp_path, font_pair):
    artifact = _load(deck_path)
    export_pptx(artifact, tmp_path / "a.pptx", fonts=font_pair)
    export_pptx(artifact, tmp_path / "b.pptx", fonts=font_pair)
    assert _geometry(Presentation(str(tmp_path / "a.pptx"))) == _geometry(
        Presentation(str(tmp_path / "b.pptx"))
    )


@pytest.mark.skipif(not REAL_FONTS_EXIST, reason="real Windows fonts not available")
@pytest.mark.parametrize("deck_path", PASS_DECKS, ids=lambda p: p.stem)
def test_pass_deck_real_fonts(deck_path, tmp_path):
    artifact = _load(deck_path)
    out = tmp_path / "real.pptx"
    export_pptx(artifact, out, fonts=load_fonts())
    assert len(Presentation(str(out)).slides) == len(artifact.slides)


# ── failing decks ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "deck_path,code,slide_id,element_id",
    FAIL_DECKS,
    ids=lambda p: p.stem if isinstance(p, pathlib.Path) else str(p),
)
def test_fail_deck_rejected_with_ids(deck_path, code, slide_id, element_id,
                                     tmp_path, font_pair):
    artifact = _load(deck_path)
    out = tmp_path / "fail.pptx"
    with pytest.raises(ValueError) as exc:
        export_pptx(artifact, out, fonts=font_pair)
    msg = str(exc.value)
    assert code in msg
    assert slide_id in msg
    assert element_id in msg
    assert not out.exists()


def test_missing_font_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(tmp_path / "absent.ttf"))
    with pytest.raises(FileNotFoundError, match="Font file not found"):
        export_pptx(_load(SAMPLE), tmp_path / "nofont.pptx")