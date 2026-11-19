"""
Per-page preview rendering: PPTX -> PDF (LibreOffice) -> PNG (pypdfium2).

Preview images always come from the same artifact/revision as the download.
They represent the LibreOffice rendering only — PowerPoint remains the
acceptance target, and the UI must say so.
"""

import os
import pathlib
import shutil
import subprocess
import tempfile

import pypdfium2 as pdfium

_SOFFICE_WINDOWS = pathlib.Path(r"C:\Program Files\LibreOffice\program\soffice.com")


def _soffice() -> pathlib.Path:
    override = os.environ.get("DRAFTBOARD_SOFFICE")
    if override:
        return pathlib.Path(override)
    if _SOFFICE_WINDOWS.exists():
        return _SOFFICE_WINDOWS
    found = shutil.which("soffice")
    if found:
        return pathlib.Path(found)
    raise FileNotFoundError(
        "未找到 LibreOffice，无法渲染预览。PPTX 文件本身不受影响；"
        "安装 LibreOffice 或设置 DRAFTBOARD_SOFFICE 后可重试。"
    )


def render_preview(pptx_path: pathlib.Path, out_dir: pathlib.Path) -> list[pathlib.Path]:
    """Render a PPTX into per-page PNGs under out_dir.

    Returns the sorted list of page image paths.  Raises on any rendering
    failure; callers decide whether that is fatal (it never invalidates
    the already-written PPTX).
    """
    soffice = _soffice()
    out_dir.mkdir(parents=True, exist_ok=True)
    # soffice.com is the console wrapper; soffice.exe (GUI subsystem) can
    # hang without writing output.  LO's profile and save-pipeline temp
    # files nest deeply, so keep them in a short scratch directory —
    # long paths (e.g. under pytest tmp) crash LO on Windows.  TMP/TEMP
    # must also stay inside a writable area for the save pipeline.
    scratch_root = os.environ.get("DRAFTBOARD_LO_SCRATCH") or None
    with tempfile.TemporaryDirectory(prefix="lo-", dir=scratch_root) as scratch:
        scratch_path = pathlib.Path(scratch)
        lo_tmp = scratch_path / "tmp"
        lo_tmp.mkdir()
        profile = scratch_path / "profile"
        env = dict(os.environ, TMP=str(lo_tmp), TEMP=str(lo_tmp))
        subprocess.run(
            [
                str(soffice),
                f"-env:UserInstallation={profile.as_uri()}",
                "--headless",
                "--norestore",
                "--nofirststartwizard",
                "--convert-to", "pdf",
                "--outdir", str(scratch_path), str(pptx_path),
            ],
            check=True, capture_output=True, timeout=180, env=env,
        )
        pdf_path = scratch_path / (pptx_path.stem + ".pdf")
        if not pdf_path.exists():
            raise RuntimeError(f"LibreOffice 没有生成 PDF：{pptx_path.name}")

        pages: list[pathlib.Path] = []
        with pdfium.PdfDocument(str(pdf_path)) as pdf:
            for index in range(len(pdf)):
                bitmap = pdf[index].render(scale=1.5)
                page_path = out_dir / f"page-{index + 1:03d}.png"
                bitmap.to_pil().save(page_path)
                pages.append(page_path)
    return pages