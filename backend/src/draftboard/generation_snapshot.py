"""Frozen inputs for one deck compilation.

The fingerprint covers only values that change the PPTX: normalized outline
content, resolved theme, brand, auto_fit, the bytes of referenced images, and
the export-rule version. Unreferenced uploads, file paths, mtimes, clocks, and
random ids are not part of the key.

Bytes are read once, when the snapshot is built. Later export reads those
copies, not the live asset files.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
from dataclasses import dataclass
from typing import Optional

from draftboard.models import CanvasElement, Outline, OutlineItem
from draftboard.pptx_export import _resolve_image_path
from draftboard.themes import resolve_theme_id

# Bump when theme definitions, exporter layout, or pre-write checks change
# what a given input is allowed to produce.  "2" rejects brand footers and
# table cells that overflow the box actually written into the PPTX; cached
# fingerprints from "1" must not skip that check.
EXPORT_RULE_VERSION = "2"

_FP_PREFIX = "fp:"


@dataclass(frozen=True)
class GenerationSnapshot:
    outline: Outline
    template_id: str
    auto_fit: bool
    brand: Optional[dict]
    image_blobs: dict[str, bytes]
    fingerprint: str


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_element(element: CanvasElement) -> dict:
    return element.model_dump(mode="json")


def _canonical_items(items: list[OutlineItem]) -> list[dict]:
    payload = []
    for item in items:
        elements = item.custom_elements or None
        payload.append(
            {
                "title": item.title,
                "summary": item.summary,
                "layout": item.layout.value if item.layout else None,
                "column_right": item.column_right,
                "image_asset_id": item.image_asset_id,
                "speaker_notes": item.speaker_notes,
                "custom_bg": item.custom_bg,
                "custom_elements": (
                    [_canonical_element(el) for el in elements] if elements else None
                ),
            }
        )
    return payload


def canonical_brand(brand: Optional[dict], logo_sha256: Optional[str]) -> Optional[dict]:
    """Brand fields that actually change the deck, in a stable form."""
    if not brand or not isinstance(brand, dict):
        return None
    from draftboard.user_library import _HEX_RE

    def _valid(key: str) -> str:
        raw = (brand.get(key) or "").strip()
        return raw.upper() if _HEX_RE.fullmatch(raw) else ""

    accent = _valid("accent_hex")
    bg = _valid("bg_hex")
    cover_bg = _valid("cover_bg_hex")
    surface = _valid("surface_hex")
    footer = (brand.get("footer_text") or "").strip() or None
    logo = (brand.get("logo_asset_id") or "").strip() or None
    position = brand.get("logo_position") or "top_right"
    if position not in ("top_right", "bottom_left"):
        position = "top_right"
    if not any((accent, bg, cover_bg, surface, footer, logo)):
        return None
    out = {
        "accent_hex": accent or None,
        "bg_hex": bg or None,
        "footer_text": footer,
        "logo_asset_id": logo,
        "logo_position": position,
        "logo_sha256": logo_sha256 if logo else None,
    }
    if cover_bg:
        out["cover_bg_hex"] = cover_bg
    if surface:
        out["surface_hex"] = surface
    return out


def read_project_brand(project_dir: pathlib.Path) -> Optional[dict]:
    meta_path = project_dir / "meta.json"
    if not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(meta, dict):
        return None
    brand = meta.get("brand")
    return brand if isinstance(brand, dict) else None


def _image_refs(outline: Outline, brand: Optional[dict]) -> list[str]:
    refs: list[str] = []
    for item in outline.items:
        if item.image_asset_id and item.image_asset_id.strip():
            refs.append(item.image_asset_id.strip())
        for element in item.custom_elements or []:
            if element.kind == "image" and element.image_asset_id:
                ref = element.image_asset_id.strip()
                if ref:
                    refs.append(ref)
    logo = (brand or {}).get("logo_asset_id")
    if isinstance(logo, str) and logo.strip():
        refs.append(logo.strip())
    seen: set[str] = set()
    ordered: list[str] = []
    for ref in refs:
        if ref not in seen:
            seen.add(ref)
            ordered.append(ref)
    return ordered


def freeze_generation_inputs(
    outline: Outline,
    *,
    template_id: str,
    auto_fit: bool,
    brand: Optional[dict],
    assets_dir: Optional[pathlib.Path],
) -> GenerationSnapshot:
    """Copy the outline and referenced image bytes, then hash them."""
    from draftboard.tools import normalize_outline_item_text

    items = [normalize_outline_item_text(item) for item in outline.items]
    frozen_outline = outline.model_copy(update={"items": items})
    refs = _image_refs(frozen_outline, brand)
    blobs: dict[str, bytes] = {}
    digests: list[dict] = []
    logo_sha = None
    logo_ref = None
    if isinstance((brand or {}).get("logo_asset_id"), str):
        logo_ref = brand["logo_asset_id"].strip() or None  # type: ignore[index]
    for ref in refs:
        path = _resolve_image_path(ref, assets_dir) if assets_dir else None
        if path is None:
            digests.append({"ref": ref, "sha256": None})
            continue
        data = path.read_bytes()
        digest = _sha256(data)
        blobs[path.name] = data
        digests.append({"ref": ref, "sha256": digest})
        if ref == logo_ref:
            logo_sha = digest
    canon_brand = canonical_brand(brand, logo_sha)
    payload = {
        "export_rule_version": EXPORT_RULE_VERSION,
        "template_id": resolve_theme_id(template_id),
        "auto_fit": bool(auto_fit),
        "outline_items": _canonical_items(frozen_outline.items),
        "brand": canon_brand,
        "images": digests,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    fingerprint = _sha256(raw.encode("utf-8"))
    return GenerationSnapshot(
        outline=frozen_outline,
        template_id=payload["template_id"],
        auto_fit=bool(auto_fit),
        brand=canon_brand,
        image_blobs=blobs,
        fingerprint=fingerprint,
    )


def snapshot_dir(project_dir: pathlib.Path, artifact_id: str, revision: int) -> pathlib.Path:
    return project_dir / "artifacts" / artifact_id / f"r{revision}.snapshot"


def write_snapshot(
    project_dir: pathlib.Path,
    artifact_id: str,
    revision: int,
    snapshot: GenerationSnapshot,
) -> None:
    base = snapshot_dir(project_dir, artifact_id, revision)
    image_dir = base / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    for name, data in snapshot.image_blobs.items():
        (image_dir / name).write_bytes(data)
    (base / "inputs.json").write_text(
        json.dumps(
            {
                "fingerprint": snapshot.fingerprint,
                "template_id": snapshot.template_id,
                "auto_fit": snapshot.auto_fit,
                "brand": snapshot.brand,
                "export_rule_version": EXPORT_RULE_VERSION,
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def load_snapshot_sources(
    project_dir: pathlib.Path,
    artifact_id: str,
    revision: int,
    fingerprint: Optional[str],
) -> Optional[tuple[pathlib.Path, Optional[dict]]]:
    """Return ``(image_dir, brand)`` for a fingerprinted artifact.

    ``None`` means the artifact is legacy and has no snapshot. A fingerprint
    without its snapshot is an error: export must not fall back to live files.
    """
    if not fingerprint:
        return None
    base = snapshot_dir(project_dir, artifact_id, revision)
    meta_path = base / "inputs.json"
    if not meta_path.is_file():
        raise FileNotFoundError(
            f"产物 {artifact_id} r{revision} 的生成快照缺失，请重新生成。"
        )
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    if data.get("fingerprint") != fingerprint:
        raise ValueError(
            f"产物 {artifact_id} r{revision} 的快照指纹与记录不一致。"
        )
    return base / "images", data.get("brand")


def fingerprint_cache_key(fingerprint: str) -> str:
    return f"{_FP_PREFIX}{fingerprint}"
