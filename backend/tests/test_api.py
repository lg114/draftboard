"""
Offline API tests for the closed loop:
upload TXT -> outline -> confirm -> generate -> result/issues -> download.

The model step (outline_via_agent) is monkeypatched to call propose_outline
directly; every other step runs the real pipeline code with synthetic fonts.
"""

import io
import time

import pytest
from fastapi.testclient import TestClient
from pptx import Presentation

import draftboard.api as api
import draftboard.storage as storage_module
import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.models import EvidenceStatus, OutlineItem, TaskRecord, TaskStatus
from draftboard.pptx_export import export_pptx
from draftboard.storage import ProjectStorage


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


def _fake_outline_agent(project_id):
    """Stand-in for the model: read materials, propose a valid 2-item outline."""
    output = _raw(tools_module.read_materials)(project_id=project_id)
    source_id = output.source_fragments[0].source_id
    items = [
        OutlineItem(
            outline_item_id="item-1",
            title="AI 战略",
            summary="AI adoption is accelerating.",
            source_ids=[source_id],
            evidence_status=EvidenceStatus.SUPPORTED,
        ),
        OutlineItem(
            outline_item_id="item-2",
            title="总结",
            summary="Automation and cost reduction.",
            source_ids=[source_id],
            evidence_status=EvidenceStatus.SUPPORTED,
        ),
    ]
    _raw(tools_module.propose_outline)(
        project_id=project_id, material_snapshot_id="snap-test", items=items
    )


@pytest.fixture
def env(tmp_path, monkeypatch, font_files):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    return tmp_path


@pytest.fixture
def client(env, monkeypatch):
    monkeypatch.setattr(tasks, "outline_via_agent", _fake_outline_agent)
    with TestClient(api.app) as c:
        yield c


def _create(client, pid="web-proj"):
    r = client.post("/api/projects", json={"project_id": pid})
    assert r.status_code == 200
    return pid


def _upload_txt(client, pid, name="notes.txt", text=None):
    text = text or "# AI Strategy\n\nAI adoption is accelerating.\n\n- Automation\n- Cost reduction\n"
    r = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": (name, text.encode("utf-8"), "text/plain")},
    )
    assert r.status_code == 200
    return r.json()


def _wait_task(client, pid, task_id, timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        r = client.get(f"/api/projects/{pid}/tasks/{task_id}")
        assert r.status_code == 200
        task = r.json()
        if task["status"] in ("succeeded", "failed"):
            return task
        time.sleep(0.05)
    raise AssertionError(f"Task {task_id} did not finish within {timeout}s")


def _run_outline(client, pid):
    r = client.post(f"/api/projects/{pid}/outline/generate")
    assert r.status_code == 202
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "succeeded", task["error"]
    return task["result"]["outline_version"]


# ── TXT support ──────────────────────────────────────────────────────────────


def test_txt_upload_and_read(client):
    pid = _create(client)
    info = _upload_txt(client, pid)
    assert info["asset_id"] == "notes"
    assert info["source_fragments"] >= 1

    r = client.get(f"/api/projects/{pid}/materials")
    assert r.status_code == 200
    materials = r.json()["materials"]
    assert len(materials) == 1
    assert "AI adoption" in materials[0]["content"]
    assert r.json()["source_fragments"][0]["location"].startswith("L1")


def test_upload_rejects_unsupported_extension(client):
    pid = _create(client)
    r = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("deck.exe", b"MZ", "application/octet-stream")},
    )
    assert r.status_code == 400


# ── Closed loop ──────────────────────────────────────────────────────────────


def test_full_closed_loop(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)

    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    assert outline["is_confirmed"] is False
    assert len(outline["items"]) == 2

    # Generating before confirmation is rejected.
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    assert r.status_code == 400

    r = client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    assert r.status_code == 200
    assert r.json()["is_confirmed"] is True

    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    assert r.status_code == 202
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "succeeded", task["error"]
    assert task["result"]["export"]["success"] is True
    assert task["result"]["export"]["slide_count"] == 2

    report = client.get(f"/api/projects/{pid}/result").json()
    assert report["success"] is True

    r = client.get(f"/api/projects/{pid}/download")
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    assert "presentationml" in r.headers["content-type"]
    assert len(Presentation(io.BytesIO(r.content)).slides) == 2


def test_regenerate_same_outline_is_idempotent(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")

    r1 = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    t1 = _wait_task(client, pid, r1.json()["task_id"])
    r2 = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    t2 = _wait_task(client, pid, r2.json()["task_id"])
    assert t1["status"] == t2["status"] == "succeeded"
    assert t1["result"]["artifact_id"] == t2["result"]["artifact_id"]


# ── Failure reporting ────────────────────────────────────────────────────────


def test_export_failure_reports_slide_and_block(client, env, monkeypatch):
    def overflowing_agent(project_id):
        output = _raw(tools_module.read_materials)(project_id=project_id)
        source_id = output.source_fragments[0].source_id
        items = [
            OutlineItem(
                outline_item_id="i1",
                title="封面",
                summary="短摘要",
                source_ids=[source_id],
                evidence_status=EvidenceStatus.SUPPORTED,
            ),
            OutlineItem(
                outline_item_id="i2",
                title="正文",
                summary="字" * 800,  # far beyond the body box
                source_ids=[source_id],
                evidence_status=EvidenceStatus.SUPPORTED,
            ),
            OutlineItem(
                outline_item_id="i3",
                title="结尾",
                summary="谢谢",
                source_ids=[source_id],
                evidence_status=EvidenceStatus.SUPPORTED,
            ),
        ]
        _raw(tools_module.propose_outline)(
            project_id=project_id, material_snapshot_id="snap", items=items
        )

    monkeypatch.setattr(tasks, "outline_via_agent", overflowing_agent)
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")

    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "failed"
    assert "排版检查未通过" in task["error"]
    issues = task["result"]["export"]["issues"]
    assert issues[0]["code"] == "EXPORT_FAILED"
    assert "slide-002" in issues[0]["message"]

    # No file was written, so there is nothing to download.
    assert client.get(f"/api/projects/{pid}/download").status_code == 404


def test_agent_saves_no_outline_fails_clearly(client, monkeypatch):
    monkeypatch.setattr(tasks, "outline_via_agent", lambda project_id: None)
    pid = _create(client)
    _upload_txt(client, pid)
    r = client.post(f"/api/projects/{pid}/outline/generate")
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "failed"
    assert "没有保存任何大纲" in task["error"]


# ── Task guards and restart recovery ─────────────────────────────────────────


def test_duplicate_submit_is_rejected(client, monkeypatch):
    def slow_agent(project_id):
        time.sleep(0.5)
        _fake_outline_agent(project_id)

    monkeypatch.setattr(tasks, "outline_via_agent", slow_agent)
    pid = _create(client)
    _upload_txt(client, pid)
    r1 = client.post(f"/api/projects/{pid}/outline/generate")
    assert r1.status_code == 202
    r2 = client.post(f"/api/projects/{pid}/outline/generate")
    assert r2.status_code == 409
    task = _wait_task(client, pid, r1.json()["task_id"])
    assert task["status"] == "succeeded"


def test_restart_marks_interrupted_tasks_failed(client, env):
    pid = _create(client)
    record = TaskRecord(
        task_id="task-orphan01",
        project_id=pid,
        kind="generate",
        status=TaskStatus.RUNNING,
        step="排版检查并导出 PPTX",
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )
    ProjectStorage(pid, storage_root=env).save_task(record.task_id, record.model_dump())

    # A fresh app startup sweeps interrupted tasks.
    with TestClient(api.app) as c2:
        task = c2.get(f"/api/projects/{pid}/tasks/task-orphan01").json()
    assert task["status"] == "failed"
    assert "服务重启" in task["error"]


# ── Same code path as the CLI ────────────────────────────────────────────────


def test_api_download_matches_direct_export(client, env):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "succeeded"

    artifact = ProjectStorage(pid, storage_root=env).load_artifact(
        task["result"]["artifact_id"], task["result"]["artifact_revision"]
    )
    direct_path = env / "direct.pptx"
    export_pptx(artifact, direct_path)

    api_prs = Presentation(io.BytesIO(client.get(f"/api/projects/{pid}/download").content))
    direct_prs = Presentation(str(direct_path))
    assert len(api_prs.slides) == len(direct_prs.slides)
    for api_slide, direct_slide in zip(api_prs.slides, direct_prs.slides):
        api_boxes = [
            (s.left, s.top, s.width, s.height, s.text_frame.text)
            for s in api_slide.shapes if s.has_text_frame
        ]
        direct_boxes = [
            (s.left, s.top, s.width, s.height, s.text_frame.text)
            for s in direct_slide.shapes if s.has_text_frame
        ]
        assert api_boxes == direct_boxes


# ── Outline editing ──────────────────────────────────────────────────────────


def _edit_items(outline, titles=None, summaries=None, reverse=False):
    items = [
        {
            "outline_item_id": i["outline_item_id"],
            "title": i["title"],
            "summary": i["summary"],
        }
        for i in outline["items"]
    ]
    if titles:
        for item, title in zip(items, titles):
            item["title"] = title
    if summaries:
        for item, summary in zip(items, summaries):
            item["summary"] = summary
    if reverse:
        items.reverse()
    return {"items": items}


def test_edit_draft_in_place(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()

    r = client.put(
        f"/api/projects/{pid}/outlines/{version}",
        json=_edit_items(outline, titles=["新封面标题", "新结尾"], reverse=True),
    )
    assert r.status_code == 200
    saved = r.json()
    assert saved["outline_version"] == version  # draft edited in place
    assert saved["is_confirmed"] is False
    assert [i["title"] for i in saved["items"]] == ["新结尾", "新封面标题"]
    # Citations and evidence survive the edit.
    assert saved["items"][0]["source_ids"] == outline["items"][1]["source_ids"]
    assert saved["items"][0]["evidence_status"] == "supported"


def test_edit_confirmed_derives_new_draft(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "succeeded"
    old_pptx = client.get(f"/api/projects/{pid}/download").content

    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    r = client.put(
        f"/api/projects/{pid}/outlines/{version}",
        json=_edit_items(outline, titles=["改过的封面", "改过的结尾"]),
    )
    assert r.status_code == 200
    derived = r.json()
    assert derived["outline_version"] != version
    assert derived["is_confirmed"] is False

    # The confirmed version is untouched.
    original = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    assert original["is_confirmed"] is True
    assert original["items"][0]["title"] == outline["items"][0]["title"]

    # The old PPT stays downloadable and unchanged; the project reports
    # which outline version the current file was generated from.
    assert client.get(f"/api/projects/{pid}/download").content == old_pptx
    project = client.get(f"/api/projects/{pid}").json()
    assert project["generated_outline_version"] == version


def test_edit_validation_rejects_and_saves_nothing(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    url = f"/api/projects/{pid}/outlines/{version}"

    # Empty title
    r = client.put(url, json=_edit_items(outline, titles=["", "x"]))
    assert r.status_code == 400
    # Missing item (deletion not allowed)
    r = client.put(url, json={"items": _edit_items(outline)["items"][:1]})
    assert r.status_code == 400
    # Duplicate item IDs
    dup = _edit_items(outline)
    dup["items"][1]["outline_item_id"] = dup["items"][0]["outline_item_id"]
    r = client.put(url, json=dup)
    assert r.status_code == 400
    # Unknown item ID (addition not allowed)
    unknown = _edit_items(outline)
    unknown["items"][0]["outline_item_id"] = "no-such-item"
    r = client.put(url, json=unknown)
    assert r.status_code == 400

    unchanged = client.get(url).json()
    assert unchanged == outline


def test_edit_confirm_regenerate_download_loop(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    assert _wait_task(client, pid, r.json()["task_id"])["status"] == "succeeded"
    assert client.get(f"/api/projects/{pid}").json()["generated_outline_version"] == version

    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    r = client.put(
        f"/api/projects/{pid}/outlines/{version}",
        json=_edit_items(outline, titles=["修改后的标题", "结尾"]),
    )
    new_version = r.json()["outline_version"]
    assert client.get(f"/api/projects/{pid}").json()["generated_outline_version"] == version

    client.post(f"/api/projects/{pid}/outlines/{new_version}/confirm")
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": new_version})
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "succeeded", task["error"]
    assert task["result"]["artifact_id"] != ""
    assert client.get(f"/api/projects/{pid}").json()["generated_outline_version"] == new_version

    prs = Presentation(io.BytesIO(client.get(f"/api/projects/{pid}/download").content))
    first_slide_text = " ".join(
        sh.text_frame.text for sh in prs.slides[0].shapes if sh.has_text_frame
    )
    assert "修改后的标题" in first_slide_text


# ── Input validation ─────────────────────────────────────────────────────────


def test_invalid_project_id_rejected(client):
    for bad in ("../evil", "a b", "", "x" * 65):
        r = client.post("/api/projects", json={"project_id": bad})
        assert r.status_code == 400


def test_unknown_project_404(client):
    assert client.get("/api/projects/nope").status_code == 404
    assert client.get("/api/projects/nope/materials").status_code == 404


def test_index_page_served(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "Draftboard" in r.text