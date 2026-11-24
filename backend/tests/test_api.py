"""
Offline API tests for the closed loop:
upload TXT -> outline -> confirm -> generate -> result/issues -> download.

The model step (outline_via_agent) is monkeypatched to call propose_outline
directly; every other step runs the real pipeline code with synthetic fonts.
"""

import io
import pathlib
import shutil
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
    # Short, writable scratch dir for LibreOffice (system temp is denied
    # in the sandbox and deep pytest paths crash LO on Windows).
    scratch = pathlib.Path.cwd() / ".lo-scratch"
    scratch.mkdir(exist_ok=True)
    monkeypatch.setenv("DRAFTBOARD_LO_SCRATCH", str(scratch))
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


def test_existing_outline_does_not_mask_unsaved_run(client, env, monkeypatch):
    """A finished agent that writes no outline must not reuse an older file."""
    import os

    pid = _create(client)
    _upload_txt(client, pid)
    monkeypatch.setattr(tasks, "outline_via_agent", _fake_outline_agent)
    old = _run_outline(client, pid)
    old_path = env / pid / "outlines" / f"{old}.json"
    old_bytes = old_path.read_bytes()

    def speak_and_plant(project_id, user_prompt=None):
        planted = env / project_id / "outlines" / "v-planted1.json"
        planted.write_text(
            old_path.read_text(encoding="utf-8").replace(old, "v-planted1"),
            encoding="utf-8",
        )
        future = time.time() + 3600
        os.utime(planted, (future, future))
        return "已保存大纲 v-planted1"

    monkeypatch.setattr(tasks, "outline_via_agent", speak_and_plant)
    r = client.post(f"/api/projects/{pid}/outline/generate")
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "failed", task
    assert "没有保存任何大纲" in task["error"]
    assert "v-planted1" not in task["error"]
    assert task["result"] == {}
    assert old_path.read_bytes() == old_bytes


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


# ── Per-page preview ─────────────────────────────────────────────────────────


def test_preview_404_without_export(client):
    pid = _create(client)
    assert client.get(f"/api/projects/{pid}/preview").status_code == 404


def test_preview_rendered_from_same_generation(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    task = _wait_task(client, pid, r.json()["task_id"], timeout=120.0)
    assert task["status"] == "succeeded", task["error"]
    assert task["result"].get("preview_pages") == 2, task["result"].get("preview_error")

    preview = client.get(f"/api/projects/{pid}/preview").json()
    assert preview["artifact_id"] == task["result"]["artifact_id"]
    assert preview["artifact_revision"] == task["result"]["artifact_revision"]
    assert len(preview["pages"]) == 2

    image = client.get(preview["pages"][0])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers.get("cache-control") == "no-store"
    assert "?v=" in preview["pages"][0]
    assert image.content[:8] == b"\x89PNG\r\n\x1a\n"

    # On-demand re-render serves the same artifact/revision.
    again = client.post(f"/api/projects/{pid}/preview/render").json()
    assert again == preview


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
    # Empty items list (must keep at least one slide)
    r = client.put(url, json={"items": []})
    assert r.status_code == 400
    # Duplicate item IDs
    dup = _edit_items(outline)
    dup["items"][1]["outline_item_id"] = dup["items"][0]["outline_item_id"]
    r = client.put(url, json=dup)
    assert r.status_code == 400
    # Blank item ID
    blank_id = _edit_items(outline)
    blank_id["items"][0]["outline_item_id"] = "   "
    r = client.put(url, json=blank_id)
    assert r.status_code == 400
    # Unsupported outline layout (two_column cannot be generated from outline)
    bad_layout = _edit_items(outline)
    bad_layout["items"][0]["layout"] = "two_column"
    r = client.put(url, json=bad_layout)
    assert r.status_code == 400
    # Unknown source_id on added item
    bad_source = _edit_items(outline)
    bad_source["items"].append(
        {
            "outline_item_id": "new-1",
            "title": "新页",
            "summary": "自定义说明",
            "source_ids": ["nonexistent-L1"],
        }
    )
    r = client.put(url, json=bad_source)
    assert r.status_code == 400

    unchanged = client.get(url).json()
    assert unchanged == outline


def test_edit_add_delete_and_update_layout(client):
    pid = _create(client)
    _upload_txt(client, pid)
    version = _run_outline(client, pid)
    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    url = f"/api/projects/{pid}/outlines/{version}"

    # Add a user-authored slide (no source_ids -> marked unsupported) and change layout
    payload = _edit_items(outline)
    payload["items"][0]["layout"] = "cover"
    payload["items"][1]["layout"] = "bullets"
    payload["items"][1]["summary"] = "要点一\n要点二"
    payload["items"].append(
        {
            "outline_item_id": "manual-slide-1",
            "title": "补充说明",
            "summary": "人工新增的一页内容",
            "layout": "closing",
        }
    )
    r = client.put(url, json=payload)
    assert r.status_code == 200
    saved = r.json()
    assert len(saved["items"]) == 3
    assert [i["layout"] for i in saved["items"]] == ["cover", "bullets", "closing"]
    added = saved["items"][2]
    assert added["outline_item_id"] == "manual-slide-1"
    assert added["source_ids"] == []
    assert added["evidence_status"] == "unsupported"

    # Project summary accurately counts unsupported items
    proj = client.get(f"/api/projects/{pid}").json()
    assert proj["insufficient_evidence_count"] == 1

    # Manually binding a valid source_id upgrades evidence_status to supported
    known_sid = outline["items"][0]["source_ids"][0]
    saved["items"][2]["source_ids"] = [known_sid]
    r_bind = client.put(url, json={"items": saved["items"]})
    assert r_bind.status_code == 200
    assert r_bind.json()["items"][2]["evidence_status"] == "supported"
    assert client.get(f"/api/projects/{pid}").json()["insufficient_evidence_count"] == 0

    # Delete the middle item and verify confirm + generate succeeds
    remaining = {"items": [saved["items"][0], saved["items"][2]]}
    r = client.put(url, json=remaining)
    assert r.status_code == 200
    assert [i["outline_item_id"] for i in r.json()["items"]] == [
        outline["items"][0]["outline_item_id"],
        "manual-slide-1",
    ]

    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    r = client.post(f"/api/projects/{pid}/generate", json={"outline_version": version})
    assert r.status_code == 202
    task = _wait_task(client, pid, r.json()["task_id"])
    assert task["status"] == "succeeded", task["error"]
    assert task["result"]["export"]["slide_count"] == 2


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

    # Single-port frontend hosting serves dynamic workspace & preview routes
    r_proj = client.get("/p/demo-deck")
    assert r_proj.status_code == 200
    assert "Draftboard" in r_proj.text
    assert "__placeholder__" not in r_proj.text

    r_prev = client.get("/p/demo-deck/preview")
    assert r_prev.status_code == 200
    assert "__placeholder__" not in r_prev.text

    # Rejects path traversal or invalid project IDs
    assert client.get("/p/../evil").status_code == 404


# ── Step 2: Themes, Image Assets, Two-Column, Speaker Notes & Auto-Fit ──────


def test_list_themes(client):
    r = client.get("/api/themes")
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()["themes"]}
    assert ids == {"keynote_light", "keynote_dark", "nordic_pine", "gallery_sand"}


def test_step2_rich_layouts_theme_notes_and_image_pipeline(client):
    from PIL import Image

    pid = _create(client, "rich-deck")
    _upload_txt(client, pid)

    # Upload a real PNG image
    buf = io.BytesIO()
    Image.new("RGB", (600, 400), color=(16, 185, 129)).save(buf, format="PNG")
    r = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("diagram.png", buf.getvalue(), "image/png")},
    )
    assert r.status_code == 200
    assert r.json()["asset_id"] == "diagram"

    # Asset endpoint serves the uploaded image
    img_res = client.get(f"/api/projects/{pid}/assets/diagram")
    assert img_res.status_code == 200
    assert img_res.headers["content-type"] == "image/png"

    version = _run_outline(client, pid)
    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()

    # Edit outline to include two_column, text_image, and speaker_notes
    payload = _edit_items(outline)
    payload["items"][0]["layout"] = "cover"
    payload["items"][0]["speaker_notes"] = "封面演讲备注：欢迎各位。"
    payload["items"][1]["layout"] = "two_column"
    payload["items"][1]["summary"] = "左栏：现有方案痛点"
    payload["items"][1]["column_right"] = "右栏：Draftboard 确定性方案"
    payload["items"].append(
        {
            "outline_item_id": "img-slide",
            "title": "架构示意图",
            "summary": "右侧为系统架构图，支持原生可编辑。",
            "layout": "text_image",
            "image_asset_id": "diagram",
            "speaker_notes": "请重点看右侧流程图。",
        }
    )

    r = client.put(f"/api/projects/{pid}/outlines/{version}", json=payload)
    assert r.status_code == 200
    saved = r.json()
    assert len(saved["items"]) == 3
    assert saved["items"][1]["column_right"] == "右栏：Draftboard 确定性方案"
    assert saved["items"][2]["image_asset_id"] == "diagram"

    client.post(f"/api/projects/{pid}/outlines/{version}/confirm")
    r = client.post(
        f"/api/projects/{pid}/generate",
        json={
            "outline_version": version,
            "template_id": "nordic_pine",
            "auto_fit": True,
        },
    )
    assert r.status_code == 202
    task = _wait_task(client, pid, r.json()["task_id"], timeout=60.0)
    assert task["status"] == "succeeded", task["error"]

    proj = client.get(f"/api/projects/{pid}").json()
    assert proj["latest_template_id"] == "nordic_pine"
    assert proj["latest_auto_fit"] is True

    prs = Presentation(io.BytesIO(client.get(f"/api/projects/{pid}/download").content))
    assert len(prs.slides) == 3
    assert prs.slides[0].notes_slide.notes_text_frame.text == "封面演讲备注：欢迎各位。"
    # Slide 2 has both columns
    s2_text = "\n".join(sh.text_frame.text for sh in prs.slides[1].shapes if sh.has_text_frame)
    assert "左栏：现有方案痛点" in s2_text
    assert "右栏：Draftboard 确定性方案" in s2_text
    # Slide 3 embeds the uploaded image as a native picture shape
    assert any(sh.shape_type == 13 for sh in prs.slides[2].shapes)
    assert prs.slides[2].notes_slide.notes_text_frame.text == "请重点看右侧流程图。"

    # Dual-format export: pure-Python vector PDF works on all platforms without LibreOffice
    pdf_res = client.get(f"/api/projects/{pid}/download/pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF")


def _make_docx_bytes(paragraphs: list[str]) -> bytes:
    import zipfile

    buf = io.BytesIO()
    body_xml = "".join(
        f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs
    )
    doc_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body_xml}</w:body></w:document>"
    )
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", doc_xml)
    return buf.getvalue()


def _make_pdf_bytes() -> bytes:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument.new()
    pdf.new_page(595, 842)
    buf = io.BytesIO()
    pdf.save(buf)
    pdf.close()
    return buf.getvalue()


def test_docx_pdf_upload_material_delete_refine_and_project_crud(client):
    # 1. Empty project can generate outline directly from a 1-sentence prompt brief (PRD 2.2)
    pid = _create(client, "full-workbench")
    r_gen = client.post(
        f"/api/projects/{pid}/outline/generate",
        json={"prompt": "控制在 5 页以内，面向技术架构评审，重点提炼吞吐量提升数据"},
    )
    assert r_gen.status_code == 202
    task = _wait_task(client, pid, r_gen.json()["task_id"])
    assert task["status"] == "succeeded", task["error"]
    version = task["result"]["outline_version"]

    # 2. Upload .docx and .pdf materials (PRD F-02)
    docx_bytes = _make_docx_bytes(["第一段：系统架构延迟降低 40%。", "第二段：内存占用减少 25%。"])
    r_docx = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("arch_spec.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert r_docx.status_code == 200
    assert r_docx.json()["asset_id"] == "arch_spec"

    pdf_bytes = _make_pdf_bytes()
    r_pdf = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("report.pdf", pdf_bytes, "application/pdf")},
    )
    assert r_pdf.status_code == 200
    assert r_pdf.json()["asset_id"] == "report"

    mats = client.get(f"/api/projects/{pid}/materials").json()
    asset_ids = {m["asset_id"] for m in mats["materials"]}
    assert {"项目简报", "arch_spec", "report"}.issubset(asset_ids)
    frag_ids = {f["source_id"] for f in mats["source_fragments"]}
    assert "arch_spec-L1" in frag_ids
    assert "report-P1" in frag_ids

    # 3. Single-slide AI refinement returns non-destructive Diff candidate (PRD F-12)
    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    item_id = outline["items"][0]["outline_item_id"]

    r_ref_bullets = client.post(
        f"/api/projects/{pid}/outlines/{version}/items/{item_id}/refine",
        json={
            "title": "核心性能收益",
            "summary": "系统架构延迟降低 40%。内存占用减少 25%。吞吐量翻倍。",
            "layout": "content",
            "source_ids": ["arch_spec-L1"],
            "mode": "bullets",
        },
    )
    assert r_ref_bullets.status_code == 200
    diff_b = r_ref_bullets.json()
    assert diff_b["layout"] == "bullets"
    assert "\n" in diff_b["summary"]

    r_ref_twocol = client.post(
        f"/api/projects/{pid}/outlines/{version}/items/{item_id}/refine",
        json={
            "title": "改造前后对比",
            "summary": "旧架构：黑盒生成经常溢出。\n新架构：fontTools 确定性测量零溢出。",
            "layout": "content",
            "source_ids": ["arch_spec-L1"],
            "mode": "two_column",
        },
    )
    assert r_ref_twocol.status_code == 200
    diff_tc = r_ref_twocol.json()
    assert diff_tc["layout"] == "two_column"
    assert diff_tc["column_right"]

    # Stored outline on disk was NOT mutated by refine preview
    assert client.get(f"/api/projects/{pid}/outlines/{version}").json() == outline

    # 4. Delete material and verify cleanup (PRD F-16)
    r_del_mat = client.delete(f"/api/projects/{pid}/materials/report")
    assert r_del_mat.status_code == 200
    mats_after = client.get(f"/api/projects/{pid}/materials").json()
    assert "report" not in {m["asset_id"] for m in mats_after["materials"]}

    # 5. Rename and delete project (PRD F-01)
    r_rename = client.patch(
        f"/api/projects/{pid}", json={"name": "2026 核心架构汇报"}
    )
    assert r_rename.status_code == 200
    assert r_rename.json()["name"] == "2026 核心架构汇报"
    assert client.get(f"/api/projects/{pid}").json()["name"] == "2026 核心架构汇报"

    r_del_proj = client.delete(f"/api/projects/{pid}")
    assert r_del_proj.status_code == 200
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_project_summary_preview_and_theme_sync(client):
    pid = _create(client)
    # Initial summary defaults to keynote_light with no cover slide
    summary0 = next(
        p for p in client.get("/api/projects").json()["projects"]
        if p["project_id"] == pid
    )
    assert summary0["theme_id"] == "keynote_light"
    assert summary0["cover_slide"] is None
    assert summary0["material_names"] == []

    # Persist theme selection via PATCH
    r_theme = client.patch(f"/api/projects/{pid}", json={"theme_id": "nordic_pine"})
    assert r_theme.status_code == 200
    assert r_theme.json()["theme_id"] == "nordic_pine"
    assert client.get(f"/api/projects/{pid}").json()["theme_id"] == "nordic_pine"

    # Reject invalid theme
    assert client.patch(f"/api/projects/{pid}", json={"theme_id": "nonexistent"}).status_code == 400

    # Upload material -> material_names populated
    _upload_txt(client, pid, name="notes.txt")
    summary1 = next(
        p for p in client.get("/api/projects").json()["projects"]
        if p["project_id"] == pid
    )
    assert summary1["material_names"] == ["notes.txt"]
    assert summary1["stage"] == "materials_ready"

    # Generate outline -> cover_slide reflects real first slide content
    _run_outline(client, pid)
    summary2 = next(
        p for p in client.get("/api/projects").json()["projects"]
        if p["project_id"] == pid
    )
    assert summary2["theme_id"] == "nordic_pine"
    assert summary2["cover_slide"] is not None
    assert summary2["cover_slide"]["title"]
    assert summary2["stage"] == "outline_draft"


def test_zero_friction_project_creation_and_auto_naming(client):
    import draftboard.tasks as tasks_mod
    import draftboard.tools as tools_mod

    # 1. /p/new SPA shell is served directly without creating a project on disk
    r_new = client.get("/p/new")
    assert r_new.status_code == 200
    assert "Draftboard" in r_new.text
    assert client.get("/api/projects").json()["projects"] == []

    # 2. POST /api/projects with empty body auto-generates deck ID + untitled placeholder
    r_create = client.post("/api/projects", json={})
    assert r_create.status_code == 200
    created = r_create.json()
    pid = created["project_id"]
    assert pid.startswith("deck-")
    assert created["name"] == "未命名文稿"
    assert created["auto_named"] is True

    # 3. Auto-named placeholder must NEVER be injected into the outline AI prompt
    prompt_untitled = tasks_mod._build_outline_prompt(tools_mod._storage_root, pid)
    assert "未命名文稿" not in prompt_untitled
    assert "display name for this deck" not in prompt_untitled

    # 4. Generating an outline auto-backfills project name from slide 1 cover title
    _upload_txt(client, pid, name="q3_review.txt")
    version = _run_outline(client, pid)
    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    expected_cover_title = outline["items"][0]["title"].strip()[:40]
    proj_after = client.get(f"/api/projects/{pid}").json()
    assert proj_after["name"] == expected_cover_title
    assert proj_after["name"] != "未命名文稿"

    # 5. Manual rename sets auto_named=False and is NEVER overwritten on regeneration
    r_rename = client.patch(f"/api/projects/{pid}", json={"name": "我的手工标题"})
    assert r_rename.status_code == 200
    prompt_named = tasks_mod._build_outline_prompt(tools_mod._storage_root, pid)
    assert "我的手工标题" in prompt_named
    _run_outline(client, pid)
    assert client.get(f"/api/projects/{pid}").json()["name"] == "我的手工标题"

    # 6. Explicitly named project on creation is also never overwritten
    r_named = client.post(
        "/api/projects",
        json={"name": "预先命名的汇报", "auto_named": False},
    )
    assert r_named.status_code == 200
    pid2 = r_named.json()["project_id"]
    assert r_named.json()["auto_named"] is False
    _upload_txt(client, pid2, name="notes.txt")
    _run_outline(client, pid2)
    assert client.get(f"/api/projects/{pid2}").json()["name"] == "预先命名的汇报"
