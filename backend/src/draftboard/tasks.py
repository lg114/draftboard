"""
Persisted background tasks for the Draftboard API.

Task records live in {project}/tasks/{task_id}.json so progress survives
page reloads and service restarts.  Work runs in a daemon thread; the
pipeline functions themselves are the same ones the CLI and agent use.
"""

import asyncio
import inspect
import json
import pathlib
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from draftboard.models import TaskRecord, TaskStatus
from draftboard.outline_run import commit_outline_run
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


DEFAULT_UNTITLED_NAME = "未命名文稿"


def _maybe_auto_name_project_from_outline(
    root: pathlib.Path, project_id: str, outline_version: str
) -> None:
    """Backfill project display name from slide 1 cover title when still auto-named."""
    from draftboard.storage import load_json

    p_dir = root / project_id
    meta_path = p_dir / "meta.json"
    if not meta_path.exists():
        return
    try:
        meta = load_json(meta_path)
    except Exception:
        return
    if not isinstance(meta, dict):
        return

    auto_flag = meta.get("auto_named")
    current_name = str(meta.get("name") or "").strip()
    is_still_auto = auto_flag is True or (
        auto_flag is None and current_name in ("", DEFAULT_UNTITLED_NAME)
    )
    if not is_still_auto:
        return

    outline_path = p_dir / "outlines" / f"{outline_version}.json"
    if not outline_path.exists():
        return
    try:
        outline_data = load_json(outline_path)
        items = outline_data.get("items") or []
        if not items:
            return
        raw_title = str(items[0].get("title") or "")
    except Exception:
        return

    clean_title = re.sub(
        r"\s+",
        " ",
        raw_title.replace("\\r\\n", " ").replace("\\n", " "),
    ).strip()
    if len(clean_title) > 40:
        clean_title = clean_title[:40].rstrip()
    if not clean_title or clean_title in (DEFAULT_UNTITLED_NAME, "未命名标题"):
        return

    meta["name"] = clean_title
    meta["auto_named"] = False
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")


def _build_outline_prompt(
    root: pathlib.Path, project_id: str, user_prompt: Optional[str] = None
) -> str:
    meta_path = root / project_id / "meta.json"
    display_name = ""
    is_auto_named = False
    if meta_path.exists():
        try:
            meta = load_json(meta_path)
            if isinstance(meta, dict):
                display_name = str(meta.get("name") or "").strip()
                is_auto_named = bool(meta.get("auto_named"))
        except Exception:
            pass

    if is_auto_named or display_name == DEFAULT_UNTITLED_NAME:
        display_name = ""

    title_hint = (
        f"The user's display name for this deck is '{display_name}'. "
        if display_name
        else ""
    )
    prompt = (
        f"Read materials for project_id '{project_id}' using read_materials, "
        f"then call propose_outline to save an outline. {title_hint}"
        f"Rules: match the language of the materials (or display name if materials are mostly images); "
        f"NEVER include the internal project_id slug '{project_id}' in any slide title, subtitle, or note; "
        f"avoid generic boilerplate such as 'Introduction to Project ...' or 'Welcome to the presentation.'; "
        f"give each slide substantive, concise points (prefer 3-4 newline-separated bullets or two-column comparisons where appropriate, and use text_image for uploaded images), "
        f"cite real source_ids from the materials, and only write speaker_notes when adding real presenter value. "
        f"Report the outline_version returned."
    )
    if user_prompt and user_prompt.strip():
        prompt += (
            f"\n\nUser direction / constraints (follow while still strictly "
            f"citing real source_ids and marking unsupported claims as "
            f"'unsupported' without fabricating numbers):\n{user_prompt.strip()}"
        )
    return prompt


def outline_via_agent(project_id: str, user_prompt: Optional[str] = None) -> None:
    """Ask the real agent to read materials and propose an outline.

    Tests monkeypatch this function; everything downstream is shared code.
    This function does not decide success. The caller installs an outline run
    and accepts only a version propose_outline persisted during that run.
    """
    from draftboard.agent import run_agent
    from draftboard.llm_config import classify_llm_error, resolve_effective_llm_config
    from draftboard.storage import STORAGE_ROOT
    import draftboard.tools as tools_module

    root = tools_module._storage_root or STORAGE_ROOT
    prompt = _build_outline_prompt(root, project_id, user_prompt)
    try:
        asyncio.run(run_agent(prompt))
    except Exception as exc:
        cfg = resolve_effective_llm_config()
        _, friendly, _ = classify_llm_error(exc, cfg.model)
        raise RuntimeError(f"{friendly}（原始错误：{str(exc)[:220]}）") from exc


def _call_outline_agent(project_id: str, user_prompt: Optional[str]) -> None:
    params = inspect.signature(outline_via_agent).parameters
    if user_prompt and len(params) >= 2:
        outline_via_agent(project_id, user_prompt)
    else:
        outline_via_agent(project_id)


def outline_work(
    root: pathlib.Path,
    project_id: str,
    user_prompt: Optional[str] = None,
) -> Callable[[TaskContext], dict]:
    def work(ctx: TaskContext) -> dict:
        assets_dir = root / project_id / "assets"
        materials = [f for f in assets_dir.glob("*") if f.is_file()] if assets_dir.exists() else []
        if not materials:
            raise RuntimeError("项目中暂无可用素材，请先上传文件或输入主题笔记后再生成大纲。")
        ctx.set_step("读取材料并生成大纲")
        _, version = commit_outline_run(
            lambda: _call_outline_agent(project_id, user_prompt)
        )
        _maybe_auto_name_project_from_outline(root, project_id, version)
        return {"outline_version": version}

    return work


def generate_work(
    root: pathlib.Path,
    project_id: str,
    outline_version: str,
    template_id: str = "default",
    auto_fit: bool = False,
) -> Callable[[TaskContext], dict]:
    import draftboard.tools as tools_module

    def work(ctx: TaskContext) -> dict:
        # The caller key is only an alias. generate_slides / export_deck_impl
        # reuse a deck only when the frozen input fingerprint matches and the
        # PPTX file is still present.
        key_suffix = f"{outline_version}-{template_id}-af{int(auto_fit)}"
        ctx.set_step("从已确认大纲生成幻灯片")
        artifact = _raw(tools_module.generate_slides)(
            project_id=project_id,
            approved_outline_version=outline_version,
            template_id=template_id,
            idempotency_key=f"api-gen-{key_suffix}",
            auto_fit=auto_fit,
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
            idempotency_key=f"api-export-{key_suffix}",
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
        if export.pptx_path:
            ctx.set_step("渲染逐页预览")
            import pathlib as _pathlib

            from draftboard.render import render_preview

            preview_dir = (
                root / project_id / "previews"
                / f"{artifact.artifact_id}-r{artifact.artifact_revision}"
            )
            try:
                pages = render_preview(_pathlib.Path(export.pptx_path), preview_dir)
                result["preview_pages"] = len(pages)
            except Exception as e:
                # Preview failure never invalidates the written PPTX.
                result["preview_error"] = str(e)
            ctx.set_result(result)
        return result

    return work


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn