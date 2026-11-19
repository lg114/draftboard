"""Draftboard package."""

import os
import pathlib
import sys

# Ensure backend/.venv/Lib/site-packages is present in sys.path
backend_venv_sp = (
    pathlib.Path(__file__).resolve().parent.parent.parent
    / ".venv"
    / "Lib"
    / "site-packages"
)
if backend_venv_sp.exists():
    sp_str = str(backend_venv_sp)
    if sp_str not in sys.path:
        sys.path.insert(0, sp_str)

# On Windows, pywin32 modules (win32, win32/lib, pywin32_system32) require their
# directories to be explicitly in sys.path and DLL search path if pywin32_bootstrap
# was skipped by trampolines or custom runners.
if sys.platform == "win32":
    candidates: list[pathlib.Path] = []
    for p in sys.path:
        if "site-packages" in p:
            candidates.append(pathlib.Path(p))
    if backend_venv_sp.exists() and backend_venv_sp not in candidates:
        candidates.append(backend_venv_sp)

    for sp in candidates:
        for sub in ("win32", "win32/lib", "pythonwin", "pywin32_system32"):
            target = sp / sub
            if target.exists():
                t_str = str(target)
                if t_str not in sys.path:
                    sys.path.append(t_str)
                if hasattr(os, "add_dll_directory"):
                    try:
                        os.add_dll_directory(t_str)
                    except Exception:
                        pass
