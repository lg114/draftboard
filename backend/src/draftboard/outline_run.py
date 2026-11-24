"""Per-run record of outline persistence.

An outline generation run (the API task or ``draftboard run``) installs its
own record in a ContextVar before invoking the agent. ``propose_outline``
appends to that record only after this call's validation and disk write, or
when that call fails. The run's success version is taken from the record.

The record is not a process-wide list. Each run creates a new object, and a
later run cannot read an earlier run's object. Tool threads see the record
because asyncio copies the context into ``asyncio.to_thread``.
"""

from __future__ import annotations

import contextvars
import threading
from dataclasses import dataclass
from typing import Callable, Optional, TypeVar

NO_OUTLINE_SAVED = "Agent 没有保存任何大纲，请检查素材内容格式或稍后重试。"

_T = TypeVar("_T")
_current: contextvars.ContextVar[Optional["OutlineRun"]] = contextvars.ContextVar(
    "draftboard_outline_run",
    default=None,
)


@dataclass(frozen=True)
class OutlineAttempt:
    """One propose_outline call observed by the active run."""

    ok: bool
    version: Optional[str] = None
    error: Optional[BaseException] = None


class OutlineRun:
    """Mutable log private to a single generation run."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.attempts: list[OutlineAttempt] = []

    def note_success(self, version: str) -> None:
        if not version:
            raise RuntimeError("已保存的大纲缺少程序生成的版本号。")
        with self._lock:
            self.attempts.append(OutlineAttempt(ok=True, version=version))

    def note_failure(self, error: BaseException) -> None:
        with self._lock:
            self.attempts.append(OutlineAttempt(ok=False, error=error))

    def snapshot(self) -> list[OutlineAttempt]:
        with self._lock:
            return list(self.attempts)


def active_outline_run() -> Optional[OutlineRun]:
    return _current.get()


def commit_outline_run(execute: Callable[[], _T]) -> tuple[_T, str]:
    """Run ``execute`` and return ``(value, outline_version)`` for this run only.

    Succeeds only when the last ``propose_outline`` attempt in this run
    persisted a version. An earlier attempt's version, a file already on
    disk, or text returned by the model is not a result. A trailing
    validation or storage failure fails the run even if an earlier attempt
    in the same run wrote a draft. An exception from ``execute`` also fails
    the run; a draft that was already written stays on disk but is not
    reported as this run's version.
    """
    run = OutlineRun()
    token = _current.set(run)
    try:
        try:
            value = execute()
        except Exception as exc:
            _version_from_attempts(run.snapshot(), exc)
            raise AssertionError("outline run did not settle") from exc
        return value, _version_from_attempts(run.snapshot(), None)
    finally:
        _current.reset(token)


def _version_from_attempts(
    attempts: list[OutlineAttempt],
    agent_exc: Optional[BaseException],
) -> str:
    if attempts and not attempts[-1].ok:
        err = attempts[-1].error
        detail = (str(err).strip() if err else "") or (
            err.__class__.__name__ if err else "未知错误"
        )
        raise RuntimeError(f"大纲保存失败：{detail}") from (agent_exc or err)
    if agent_exc is not None:
        raise agent_exc
    if not attempts or not attempts[-1].ok or not attempts[-1].version:
        raise RuntimeError(NO_OUTLINE_SAVED)
    return attempts[-1].version
