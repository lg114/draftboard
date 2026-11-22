"""
Persisted background tasks for the Draftboard API.

Task records live in {project}/tasks/{task_id}.json so progress survives
page reloads and service restarts.  Work runs in a daemon thread; the
pipeline functions themselves are the same ones the CLI and agent use.
"""

import asyncio
import inspect
import json
import os
import pathlib
import re
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


def outline_via_agent(project_id: str, user_prompt: Optional[str] = None) -> None:
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
    if user_prompt and user_prompt.strip():
        prompt += (
            f"\n\nUser direction / constraints (follow while still strictly "
            f"citing real source_ids and marking unsupported claims as "
            f"'unsupported' without fabricating numbers):\n{user_prompt.strip()}"
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
        params = inspect.signature(outline_via_agent).parameters
        if user_prompt and len(params) >= 2:
            outline_via_agent(project_id, user_prompt)
        else:
            outline_via_agent(project_id)
        version = _latest_outline_version(root, project_id)
        if version is None:
            raise RuntimeError("Agent 没有保存任何大纲，请检查素材内容格式或稍后重试。")
        return {"outline_version": version}

    return work


def _split_clauses(text: str) -> list[str]:
    raw_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(raw_lines) >= 2:
        return [re.sub(r"^[•\-\*\d\.、\s]+", "", ln).strip() for ln in raw_lines if ln.strip()]
    parts = [
        p.strip()
        for p in re.split(r"[。；;！!？?\n]+", text)
        if p and p.strip()
    ]
    return [re.sub(r"^[•\-\*\d\.、\s]+", "", p).strip() for p in parts if p.strip()]


def _deterministic_refine_slide(
    title: str,
    summary: str,
    column_right: Optional[str],
    layout: Optional[str],
    source_excerpts: list[str],
    mode: str,
    instruction: Optional[str],
) -> dict:
    """Deterministic local refinement rules (also used as offline fallback)."""
    base_title = title.strip() or "核心要点"
    if len(base_title) > 22 and mode == "concise":
        base_title = base_title[:21].rstrip("，、：: ") + "…"

    base_text = summary.strip()
    if (not base_text or base_text == "输入本页的核心陈述内容…") and source_excerpts:
        base_text = source_excerpts[0].strip()

    effective_mode = mode
    if mode == "custom" and instruction:
        inst = instruction.lower()
        if any(k in inst for k in ("双栏", "对比", "左右", "two_column")):
            effective_mode = "two_column"
        elif any(k in inst for k in ("分点", "要点", "列表", "bullet")):
            effective_mode = "bullets"
        else:
            effective_mode = "concise"

    clauses = _split_clauses(base_text)
    if not clauses and source_excerpts:
        clauses = _split_clauses(source_excerpts[0])
    if not clauses:
        clauses = [base_text or "待补充要点"]

    if effective_mode == "two_column":
        if len(clauses) == 1 and len(clauses[0]) > 16:
            mid_char = len(clauses[0]) // 2
            clauses = [clauses[0][:mid_char].strip(), clauses[0][mid_char:].strip()]
        elif len(clauses) == 1:
            clauses = [clauses[0], (column_right or "").strip() or "对比与落地成效"]
        mid = max(1, (len(clauses) + 1) // 2)
        left_lines = [c[:42] for c in clauses[:mid][:4]]
        right_lines = [c[:42] for c in clauses[mid:][:4]]
        if not right_lines:
            right_lines = [(column_right or "").strip() or clauses[-1][:42]]
        return {
            "title": base_title,
            "summary": "\n".join(left_lines),
            "column_right": "\n".join(right_lines),
            "layout": "two_column",
            "rationale": "已将核心陈述拆分为左右双栏对比结构，单栏控制在 4 行以内。",
        }

    if effective_mode == "bullets":
        bullet_lines = []
        for c in clauses[:5]:
            trimmed = c[:38].rstrip("，、") + ("…" if len(c) > 38 else "")
            if trimmed:
                bullet_lines.append(trimmed)
        return {
            "title": base_title,
            "summary": "\n".join(bullet_lines),
            "column_right": column_right,
            "layout": "bullets",
            "rationale": f"已提炼为 {len(bullet_lines)} 条独立分点要点，每条控制在单行安全宽度内。",
        }

    # Default: "concise" (anti-overflow compaction)
    concise_lines = []
    for c in clauses[:4]:
        trimmed = c[:34].rstrip("，、") + ("…" if len(c) > 34 else "")
        if trimmed:
            concise_lines.append(trimmed)
    next_right = column_right
    if layout == "two_column" and column_right:
        r_clauses = _split_clauses(column_right)
        next_right = "\n".join(
            c[:32].rstrip("，、") + ("…" if len(c) > 32 else "")
            for c in r_clauses[:4]
        )
    return {
        "title": base_title,
        "summary": "\n".join(concise_lines),
        "column_right": next_right,
        "layout": layout or "content",
        "rationale": "已精简冗余修饰并收紧单行字数，确保在 18pt 正文框内不溢出。",
    }


def refine_slide_item(
    project_id: str,
    title: str,
    summary: str,
    column_right: Optional[str] = None,
    layout: Optional[str] = None,
    source_excerpts: Optional[list[str]] = None,
    mode: str = "concise",
    instruction: Optional[str] = None,
) -> dict:
    """Produce a non-destructive refinement candidate (Diff preview) for one slide.

    Uses the configured LLM when an API key is available, and falls back to
    deterministic local rules when offline or in unit tests.
    """
    excerpts = [e for e in (source_excerpts or []) if e and e.strip()]
    has_api_key = bool(
        os.environ.get("GEMINI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    )
    if has_api_key and not os.environ.get("PYTEST_CURRENT_TEST"):
        try:
            from draftboard.agent import run_agent

            mode_desc = {
                "concise": "精简字数以防止 PPT 文本框溢出（总行数不超过 4 行，每行不超过 34 字），保留关键事实与数字",
                "bullets": "改写为 3~5 条按换行分隔的分点要点（layout 设为 'bullets'）",
                "two_column": "改写为左栏（summary）与右栏（column_right）对称的双栏对比（layout 设为 'two_column'）",
                "custom": instruction or "优化本页表达，使其更紧凑清晰",
            }.get(mode, instruction or "精简优化本页内容")

            prompt = (
                f"You are refining a single slide in project '{project_id}'. "
                f"Do NOT call any tools. Return ONLY a raw JSON object with keys: "
                f"title, summary, column_right, layout, rationale.\n"
                f"Strict rule: never fabricate numbers or facts not present in the current slide or source excerpts.\n"
                f"Current slide:\n"
                f"- title: {title}\n"
                f"- layout: {layout or 'content'}\n"
                f"- summary:\n{summary}\n"
                f"- column_right:\n{column_right or ''}\n"
                f"Bound source excerpts:\n{chr(10).join(excerpts) if excerpts else '(none)'}\n"
                f"Refinement task: {mode_desc}\n"
                f"Additional instruction: {instruction or '(none)'}"
            )
            raw_out = asyncio.run(run_agent(prompt))
            match = re.search(r"\{[\s\S]*\}", raw_out)
            if match:
                parsed = json.loads(match.group(0))
                if parsed.get("title") and parsed.get("summary"):
                    return {
                        "title": str(parsed["title"]).strip(),
                        "summary": str(parsed["summary"]).strip(),
                        "column_right": (
                            str(parsed["column_right"]).strip()
                            if parsed.get("column_right")
                            else column_right
                        ),
                        "layout": parsed.get("layout") or layout or "content",
                        "rationale": str(
                            parsed.get("rationale") or "已根据原始素材与指令生成修改建议。"
                        ),
                    }
        except Exception:
            pass

    return _deterministic_refine_slide(
        title=title,
        summary=summary,
        column_right=column_right,
        layout=layout,
        source_excerpts=excerpts,
        mode=mode,
        instruction=instruction,
    )


def generate_work(
    root: pathlib.Path,
    project_id: str,
    outline_version: str,
    template_id: str = "default",
    auto_fit: bool = False,
) -> Callable[[TaskContext], dict]:
    import draftboard.tools as tools_module

    def work(ctx: TaskContext) -> dict:
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