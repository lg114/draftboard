"""Outline-run success is the version propose_outline persisted in that run.

Uses a fake agent and a temporary storage root. No live model calls.
"""

import asyncio
import json
import os
import sys
import threading
import time

import pytest

import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.models import EvidenceStatus, OutlineItem, TaskRecord, TaskStatus
from draftboard.outline_run import NO_OUTLINE_SAVED, active_outline_run, commit_outline_run
from draftboard.storage import ProjectStorage
from draftboard.tasks import TaskContext, outline_via_agent, outline_work


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    return tmp_path


def _prepare(root, project_id="deck-run"):
    assets = root / project_id / "assets"
    assets.mkdir(parents=True)
    (assets / "notes.txt").write_text("材料里的一句事实。\n", encoding="utf-8")
    output = _raw(tools_module.read_materials)(project_id=project_id)
    return output.source_fragments[0].source_id


def _item(source_id, item_id="i1", title="标题", summary="摘要"):
    return OutlineItem(
        outline_item_id=item_id,
        title=title,
        summary=summary,
        source_ids=[source_id],
        evidence_status=EvidenceStatus.SUPPORTED,
    )


def _propose(project_id, source_id, **kwargs):
    return _raw(tools_module.propose_outline)(
        project_id=project_id,
        material_snapshot_id="snap",
        items=[_item(source_id, **kwargs)],
    )


def _run_task(root, project_id, agent):
    del agent  # The caller monkeypatches outline_via_agent; this only builds the task.
    record = TaskRecord(
        task_id=f"task-{project_id}",
        project_id=project_id,
        kind="outline",
        status=TaskStatus.RUNNING,
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )
    ctx = TaskContext(root, record)
    return outline_work(root, project_id)(ctx)


def _outline_bytes(root, project_id, version):
    return (root / project_id / "outlines" / f"{version}.json").read_bytes()


def test_no_save_with_existing_outline_fails_and_keeps_it(root, monkeypatch):
    project_id = "deck-old"
    source_id = _prepare(root, project_id)
    old = _propose(project_id, source_id, item_id="old", title="旧标题")
    old_bytes = _outline_bytes(root, project_id, old.outline_version)

    def agent(project_id, user_prompt=None):
        planted = root / project_id / "outlines" / "v-planted1.json"
        planted.write_text(
            old.model_dump_json(),
            encoding="utf-8",
        )
        future = time.time() + 3600
        os.utime(planted, (future, future))
        return "已生成大纲 v-planted1"

    monkeypatch.setattr("draftboard.tasks.outline_via_agent", agent)
    with pytest.raises(RuntimeError, match=NO_OUTLINE_SAVED):
        _run_task(root, project_id, agent)
    assert _outline_bytes(root, project_id, old.outline_version) == old_bytes
    assert active_outline_run() is None


def test_saved_run_returns_program_version_not_model_text(root, monkeypatch):
    project_id = "deck-new"
    source_id = _prepare(root, project_id)
    found = {}

    def agent(project_id, user_prompt=None):
        outline = _propose(project_id, source_id, item_id="new", title="新标题")
        found["version"] = outline.outline_version
        return "口头版本 v-spoken-not-real"

    monkeypatch.setattr("draftboard.tasks.outline_via_agent", agent)
    result = _run_task(root, project_id, agent)
    assert result["outline_version"] == found["version"]
    assert result["outline_version"] != "v-spoken-not-real"
    saved = ProjectStorage(project_id, storage_root=root).load_outline(found["version"])
    assert saved.items[0].title == "新标题"


def test_validation_and_storage_failures_fail_the_run(root, monkeypatch):
    project_id = "deck-fail"
    source_id = _prepare(root, project_id)
    old = _propose(project_id, source_id, item_id="keep", title="保留")
    old_bytes = _outline_bytes(root, project_id, old.outline_version)
    before = sorted(p.name for p in (root / project_id / "outlines").glob("*.json"))

    def invalid(project_id, user_prompt=None):
        try:
            _raw(tools_module.propose_outline)(
                project_id=project_id,
                material_snapshot_id="snap",
                items=[_item(source_id, title=" ")],
            )
        except ValueError:
            return "校验失败但我声称已经保存"
        raise AssertionError("invalid outline was accepted")

    monkeypatch.setattr("draftboard.tasks.outline_via_agent", invalid)
    with pytest.raises(RuntimeError, match="大纲保存失败") as exc:
        _run_task(root, project_id, invalid)
    assert "empty title" in str(exc.value)
    assert _outline_bytes(root, project_id, old.outline_version) == old_bytes
    assert sorted(p.name for p in (root / project_id / "outlines").glob("*.json")) == before

    def disk_fail(project_id, user_prompt=None):
        real = ProjectStorage.save_outline

        def boom(self, outline):
            raise OSError("disk write failed")

        monkeypatch.setattr(ProjectStorage, "save_outline", boom)
        try:
            _propose(project_id, source_id, item_id="nope", title="写不进去")
        finally:
            monkeypatch.setattr(ProjectStorage, "save_outline", real)
        return "写盘失败但任务应失败"

    monkeypatch.setattr("draftboard.tasks.outline_via_agent", disk_fail)
    with pytest.raises(RuntimeError, match="disk write failed"):
        _run_task(root, project_id, disk_fail)
    assert _outline_bytes(root, project_id, old.outline_version) == old_bytes
    assert sorted(p.name for p in (root / project_id / "outlines").glob("*.json")) == before


def test_multiple_calls_use_the_last_attempt(root):
    project_id = "deck-multi"
    source_id = _prepare(root, project_id)

    def failed_then_saved():
        try:
            _raw(tools_module.propose_outline)(
                project_id=project_id,
                material_snapshot_id="snap",
                items=[_item(source_id, title=" ")],
            )
        except ValueError:
            pass
        first = _propose(project_id, source_id, item_id="a", title="第一稿")
        second = _propose(project_id, source_id, item_id="b", title="第二稿")
        return first, second

    _, version = commit_outline_run(failed_then_saved)
    saved = ProjectStorage(project_id, storage_root=root).load_outline(version)
    assert saved.items[0].title == "第二稿"

    kept = {}

    def saved_then_failed():
        outline = _propose(
            project_id, source_id, item_id="c", title="草稿还在但不是本轮结果"
        )
        kept["version"] = outline.outline_version
        try:
            _raw(tools_module.propose_outline)(
                project_id=project_id,
                material_snapshot_id="snap",
                items=[_item(source_id, item_id="d", title=" ")],
            )
        except ValueError:
            return "最后一次失败"

    with pytest.raises(RuntimeError, match="大纲保存失败"):
        commit_outline_run(saved_then_failed)
    still = ProjectStorage(project_id, storage_root=root).load_outline(kept["version"])
    assert still.items[0].title == "草稿还在但不是本轮结果"


def test_last_success_is_exact_program_version(root):
    project_id = "deck-last"
    source_id = _prepare(root, project_id)
    seen = {}

    def execute():
        seen["first"] = _propose(project_id, source_id, item_id="a", title="第一稿")
        seen["second"] = _propose(project_id, source_id, item_id="b", title="第二稿")
        rogue = root / project_id / "outlines" / "v-newer.json"
        rogue.write_text("{}", encoding="utf-8")
        future = time.time() + 3600
        os.utime(rogue, (future, future))
        return "请使用 v-newer"

    _, version = commit_outline_run(execute)
    assert version == seen["second"].outline_version
    assert version != seen["first"].outline_version
    assert version != "v-newer"


def test_two_runs_do_not_share_results(root, monkeypatch):
    source_a = _prepare(root, "proj-a")
    source_b = _prepare(root, "proj-b")
    barrier = threading.Barrier(2)
    saved = {}

    def agent(project_id, user_prompt=None):
        barrier.wait(timeout=5)
        if project_id == "proj-b":
            return "proj-b 没有调用保存"
        outline = _propose(project_id, source_a, item_id="a", title="只要 A")
        saved[project_id] = outline.outline_version
        return "A 完成"

    monkeypatch.setattr("draftboard.tasks.outline_via_agent", agent)
    errors = {}
    results = {}

    def run(project_id):
        try:
            results[project_id] = _run_task(root, project_id, agent)["outline_version"]
        except Exception as exc:
            errors[project_id] = exc

    threads = [
        threading.Thread(target=run, args=(pid,)) for pid in ("proj-a", "proj-b")
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
    assert not any(thread.is_alive() for thread in threads)

    assert results["proj-a"] == saved["proj-a"]
    assert "没有保存任何大纲" in str(errors["proj-b"])
    assert saved["proj-a"] not in str(errors["proj-b"])
    assert _outline_bytes(root, "proj-a", saved["proj-a"])
    assert not (root / "proj-b" / "outlines").exists() or not list(
        (root / "proj-b" / "outlines").glob("v-*.json")
    )

    # A second run on proj-a that saves its own outline must not be handed A's previous version
    # unless propose_outline actually persisted it during the second run.
    def only_b(project_id, user_prompt=None):
        outline = _propose(project_id, source_b, item_id="b", title="只要 B")
        saved["proj-b"] = outline.outline_version
        return "B 完成"

    monkeypatch.setattr("draftboard.tasks.outline_via_agent", only_b)
    second = _run_task(root, "proj-b", only_b)
    assert second["outline_version"] == saved["proj-b"]
    assert second["outline_version"] != saved["proj-a"]


def test_nested_run_on_another_thread_is_independent(root):
    source_a = _prepare(root, "outer")
    source_b = _prepare(root, "inner")
    seen = {}

    def execute():
        def inner():
            def inner_execute():
                outline = _propose("inner", source_b, item_id="in", title="内层")
                seen["inner"] = outline.outline_version
                return "inner spoken v-nope"
            _, version = commit_outline_run(inner_execute)
            seen["inner_returned"] = version

        thread = threading.Thread(target=inner)
        thread.start()
        outline = _propose("outer", source_a, item_id="out", title="外层")
        seen["outer"] = outline.outline_version
        thread.join(timeout=5)
        assert not thread.is_alive()
        return "outer spoken v-also-nope"

    _, outer_version = commit_outline_run(execute)
    assert outer_version == seen["outer"]
    assert seen["inner_returned"] == seen["inner"]
    assert outer_version != seen["inner_returned"]


def test_tool_thread_records_only_this_run(root):
    project_id = "deck-thread"
    source_id = _prepare(root, project_id)
    seen = {}

    def execute():
        def save():
            outline = _propose(project_id, source_id, item_id="t", title="线程里保存")
            seen["version"] = outline.outline_version

        asyncio.run(asyncio.to_thread(save))
        return "v-spoken"

    _, version = commit_outline_run(execute)
    assert version == seen["version"]
    assert active_outline_run() is None


def test_agent_exception_after_save_is_not_success(root):
    project_id = "deck-crash"
    source_id = _prepare(root, project_id)

    def execute():
        _propose(project_id, source_id, item_id="c", title="已写入但本轮崩溃")
        raise RuntimeError("agent crashed after save")

    with pytest.raises(RuntimeError, match="agent crashed after save"):
        commit_outline_run(execute)
    files = list((root / project_id / "outlines").glob("*.json"))
    assert len(files) == 1
    assert active_outline_run() is None


def _cli(argv, monkeypatch, root):
    from draftboard.__main__ import main

    monkeypatch.setattr(tools_module, "_storage_root", root)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", root)
    monkeypatch.setattr(sys, "argv", ["draftboard", *argv])
    with pytest.raises(SystemExit) as exc:
        main()
    return exc.value.code


def test_cli_exit_status_matches_outline_run(root, monkeypatch, capsys, tmp_path):
    project_id = "deck-cli"
    source_id = _prepare(root, project_id)
    seen = {}

    async def save_run(prompt, model=None):
        outline = _propose(project_id, source_id, item_id="cli", title="命令行稿")
        seen["version"] = outline.outline_version
        return "模型说版本是 v-spoken-not-real"

    monkeypatch.setattr("draftboard.agent.run_agent", save_run)
    output = tmp_path / "run.json"
    code = _cli(["run", "生成大纲", "-o", str(output)], monkeypatch, root)
    captured = capsys.readouterr()
    assert code == 0
    assert f"outline_version={seen['version']}" in captured.out
    assert "v-spoken-not-real" in captured.out  # model text is still printed
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["outline_version"] == seen["version"]
    assert payload["outline_version"] != "v-spoken-not-real"
    old_bytes = _outline_bytes(root, project_id, seen["version"])

    async def silent_run(prompt, model=None):
        return f"沿用 {seen['version']}"

    monkeypatch.setattr("draftboard.agent.run_agent", silent_run)
    missing = tmp_path / "not-written.json"
    code = _cli(["run", "再生成一次", "-o", str(missing)], monkeypatch, root)
    captured = capsys.readouterr()
    assert code == 1
    assert NO_OUTLINE_SAVED in captured.err
    assert "outline_version=" not in captured.out
    assert not missing.exists()
    assert _outline_bytes(root, project_id, seen["version"]) == old_bytes


def test_cli_validation_failure_exits_nonzero(root, monkeypatch, capsys):
    project_id = "deck-cli-bad"
    source_id = _prepare(root, project_id)

    async def bad_run(prompt, model=None):
        try:
            _raw(tools_module.propose_outline)(
                project_id=project_id,
                material_snapshot_id="snap",
                items=[_item(source_id, title=" ")],
            )
        except ValueError:
            return "已经好了"
        raise AssertionError("invalid outline was accepted")

    monkeypatch.setattr("draftboard.agent.run_agent", bad_run)
    code = _cli(["run", "生成大纲"], monkeypatch, root)
    captured = capsys.readouterr()
    assert code == 1
    assert "大纲保存失败" in captured.err
    assert "empty title" in captured.err
    assert not (root / project_id / "outlines").exists()
