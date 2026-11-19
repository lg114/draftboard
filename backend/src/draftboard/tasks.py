"""
Persisted background tasks for the Draftboard API.

Task records live in {project}/tasks/{task_id}.json so progress survives
page reloads and service restarts.  Work runs in a daemon thread; the
pipeline functions themselves are the same ones the CLI and agent use.
"""

import asyncio
import pathlib
import threading
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from draftboard.models import TaskRecord, TaskStatus
from draftboard.storage import ProjectStorage, load_json

_submit_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tasks_dir(root: pathlib.Path, project_id: str) -> pathlib.Path:
    return root / project_id / "tasks"


def _save(root: pathlib.Path, record: TaskRecord) -> None:
    storage = ProjectStorage(record.project_id, storage_root=root)
    record.updated_at = _now()
    storage.save_task(record.task_id, record.model_dump())


def load_task(root: pathlib.Path, project_id: str, task_id: str) -> TaskRecord:
    path = _tasks_dir(root, project_id) / f"{task_id}.json"
    if not path.exists():
        raise KeyError(f"Task '{task_id}' not found in project '{project_id}'")
    return TaskRecord.model_validate(load_json(path))


def list_tasks(root: pathlib.Path, project_id: str) -> list[TaskRecord]:
    tasks_dir = _tasks_dir(root, project_id)
    if not tasks_dir.exists():
        return []
    records = [
        TaskRecord.model_validate(load_json(p))
        for p in tasks_dir.glob("*.json")
    ]
    return sorted(records, key=lambda r: r.created_at)


def sweep_interrupted(root: pathlib.Path) -> int:
    """Mark queued/running tasks as failed after a service restart.

    A task thread cannot survive a restart; leaving its record as 'running'
    would show '生成中' forever.  Saved intermediates remain usable.
    """
    count = 0
    if not root.exists():
        return count
    for proj_dir in root.iterdir():
        if not proj_dir.is_dir():
            continue
        for record in list_tasks(root, proj_dir.name):
            if record.status in (TaskStatus.QUEUED, TaskStatus.RUNNING):
                record.status = TaskStatus.FAILED
                record.error = (
                    "服务重启，任务已中断。已保存的大纲和幻灯片仍然有效，可重新提交。"
                )
                _save(root, record)
                count += 1
    return count


class TaskConflictError(Exception):
    """A task of the same kind is already queued or running."""


class TaskContext:
    """Lets running work report real steps and save partial results."""

    def __init__(self, root: pathlib.Path, record: TaskRecord) -> None:
        self._root = root
        self.record = record

    def set_step(self, step: str) -> None:
        self.record.step = step
        _save(self._root, self.record)

    def set_result(self, result: dict) -> None:
        self.record.result = result
        _save(self._root, self.record)


def _execute(
    root: pathlib.Path,
    project_id: str,
    task_id: str,
    work: Callable[[TaskContext], dict],
) -> None:
    record = load_task(root, project_id, task_id)
    record.status = TaskStatus.RUNNING
    _save(root, record)
    ctx = TaskContext(root, record)
    try:
        result = work(ctx)
        record.result = result
        record.status = TaskStatus.SUCCEEDED
        record.step = "完成"
        _save(root, record)
    except Exception as e:
        record.status = TaskStatus.FAILED
        record.error = str(e)
        _save(root, record)


def submit(
    root: pathlib.Path,
    project_id: str,
    kind: str,
    work: Callable[[TaskContext], dict],
) -> TaskRecord:
    """Create a persisted task and run it in a background thread.

    Raises TaskConflictError if a task of the same kind is already active,
    so duplicate clicks never start two generations.
    """
    with _submit_lock:
        for record in list_tasks(root, project_id):
            if record.kind == kind and record.status in (
                TaskStatus.QUEUED,
                TaskStatus.RUNNING,
            ):
                raise TaskConflictError(
                    f"已有一个{kind}任务在进行中（{record.task_id}），请等待它完成。"
                )
        record = TaskRecord(
            task_id=f"task-{uuid.uuid4().hex[:8]}",
            project_id=project_id,
            kind=kind,
            created_at=_now(),
            updated_at=_now(),
        )
        _save(root, record)
    threading.Thread(
        target=_execute,
        args=(root, project_id, record.task_id, work),
        daemon=True,
    ).start()
    return record


# ── Work definitions (reuse the existing pipeline tools) ─────────────────────


def outline_via_agent(project_id: str) -> None:
    """Ask the real agent to read materials and propose an outline.

    Tests monkeypatch this function; everything downstream is shared code.
    """
    from draftboard.agent import run_agent

    prompt = (
        f"Read materials for project '{project_id}' using read_materials, "
        f"then call propose_outline to save an outline. Use one item per "
        f"slide, cite real source_ids from the materials, and keep each "
        f"summary concise. Report the outline_version returned."
    )
    asyncio.run(run_agent(prompt))


def _latest_outline_version(root: pathlib.Path, project_id: str) -> Optional[str]:
    outlines_dir = root / project_id / "outlines"
    if not outlines_dir.exists():
        return None
    files = list(outlines_dir.glob("*.json"))
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime).stem


def outline_work(root: pathlib.Path, project_id: str) -> Callable[[TaskContext], dict]:
    def work(ctx: TaskContext) -> dict:
        ctx.set_step("读取材料并生成大纲")
        outline_via_agent(project_id)
        version = _latest_outline_version(root, project_id)
        if version is None:
            raise RuntimeError("模型没有保存任何大纲，请检查材料内容后重试。")
        return {"outline_version": version}

    return work


def generate_work(
    root: pathlib.Path, project_id: str, outline_version: str
) -> Callable[[TaskContext], dict]:
    import draftboard.tools as tools_module

    def work(ctx: TaskContext) -> dict:
        ctx.set_step("从已确认大纲生成幻灯片")
        artifact = _raw(tools_module.generate_slides)(
            project_id=project_id,
            approved_outline_version=outline_version,
            idempotency_key=f"api-gen-{outline_version}",
        )
        ctx.set_step("校验幻灯片结构")
        report = _raw(tools_module.validate_artifact)(
            artifact_id=artifact.artifact_id,
            revision=artifact.artifact_revision,
        )
        ctx.set_step("排版检查并导出 PPTX")
        export = tools_module.export_deck_impl(
            project_id=project_id,
            artifact_id=artifact.artifact_id,
            revision=artifact.artifact_revision,
            idempotency_key=f"api-export-{outline_version}",
        )
        result = {
            "outline_version": outline_version,
            "artifact_id": artifact.artifact_id,
            "artifact_revision": artifact.artifact_revision,
            "validation": report.model_dump(),
            "export": export.model_dump(),
        }
        ctx.set_result(result)
        if report.has_errors:
            raise RuntimeError("幻灯片结构校验未通过，未导出文件。")
        if not export.success:
            raise RuntimeError("排版检查未通过，未生成文件。请根据问题列表调整大纲后重新生成。")
        return result

    return work


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn