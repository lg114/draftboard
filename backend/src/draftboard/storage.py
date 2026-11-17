"""
Local JSON file storage for Draftboard projects.
All writes are atomic (write to .tmp then rename).
Storage root: ~/.draftboard/projects/{project_id}/
"""

import json
import hashlib
import pathlib
from typing import Optional

from draftboard.models import Artifact, Outline, ValidationReport

STORAGE_ROOT = pathlib.Path.home() / ".draftboard" / "projects"


class ProjectStorage:
    """Persistent project storage backed by local JSON files."""

    def __init__(
        self,
        project_id: str,
        storage_root: Optional[pathlib.Path] = None,
    ) -> None:
        self.project_id = project_id
        self.root = (storage_root or STORAGE_ROOT) / project_id
        self.root.mkdir(parents=True, exist_ok=True)

    # ── helpers ──────────────────────────────────────────────────────────────

    def _atomic_write(self, path: pathlib.Path, data: dict) -> None:
        """Write JSON atomically via a .tmp file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    # ── outline ──────────────────────────────────────────────────────────────

    def save_outline(self, outline: Outline) -> None:
        """Persist an outline to disk."""
        path = self.root / "outlines" / f"{outline.outline_version}.json"
        self._atomic_write(path, outline.model_dump())

    def load_outline(self, outline_version: str) -> Outline:
        """Load an outline by version; raises KeyError if not found."""
        path = self.root / "outlines" / f"{outline_version}.json"
        if not path.exists():
            raise KeyError(f"Outline '{outline_version}' not found in project '{self.project_id}'")
        data = json.loads(path.read_text(encoding="utf-8"))
        return Outline.model_validate(data)

    def confirm_outline(self, outline_version: str) -> Outline:
        """Set is_confirmed=True on an outline and persist it."""
        outline = self.load_outline(outline_version)
        outline.is_confirmed = True
        self.save_outline(outline)
        return outline

    # ── artifact ─────────────────────────────────────────────────────────────

    def save_artifact(self, artifact: Artifact) -> None:
        """Persist an artifact revision to disk."""
        path = (
            self.root
            / "artifacts"
            / artifact.artifact_id
            / f"r{artifact.artifact_revision}.json"
        )
        self._atomic_write(path, artifact.model_dump())

    def load_artifact(self, artifact_id: str, revision: int) -> Artifact:
        """Load a specific artifact revision; raises KeyError if not found."""
        path = self.root / "artifacts" / artifact_id / f"r{revision}.json"
        if not path.exists():
            raise KeyError(
                f"Artifact '{artifact_id}' revision {revision} not found "
                f"in project '{self.project_id}'"
            )
        data = json.loads(path.read_text(encoding="utf-8"))
        return Artifact.model_validate(data)

    def next_revision(self, artifact_id: str) -> int:
        """Return next revision number (max existing + 1, minimum 1)."""
        artifact_dir = self.root / "artifacts" / artifact_id
        if not artifact_dir.exists():
            return 1
        revisions = []
        for f in artifact_dir.glob("r*.json"):
            stem = f.stem  # e.g. "r3"
            try:
                revisions.append(int(stem[1:]))
            except ValueError:
                pass
        return max(revisions, default=0) + 1

    # ── idempotency ───────────────────────────────────────────────────────────

    def _idem_path(self, key: str) -> pathlib.Path:
        key_hash = hashlib.sha256(key.encode()).hexdigest()[:16]
        return self.root / "idempotent" / f"{key_hash}.json"

    def save_idempotent_result(self, key: str, result: dict) -> None:
        """Cache an idempotent operation result."""
        self._atomic_write(self._idem_path(key), result)

    def load_idempotent_result(self, key: str) -> Optional[dict]:
        """Return cached idempotent result, or None if not found."""
        path = self._idem_path(key)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
