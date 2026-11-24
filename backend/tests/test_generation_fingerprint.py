"""Deck reuse follows the frozen input fingerprint, not a short idempotency key."""

import io
import pathlib

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

import draftboard.api as api
import draftboard.storage as storage_module
import draftboard.tasks as tasks
import draftboard.tools as tools_module
from draftboard.models import EvidenceStatus, OutlineItem, SlideLayout
from draftboard.storage import ProjectStorage


def _raw(tool):
    fn = getattr(tool, "__wrapped__", None) or getattr(tool, "fn", None)
    if fn is None:
        raise RuntimeError(f"Cannot unwrap tool {tool}")
    return fn


def _png(color: tuple[int, int, int]) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color).save(buf, format="PNG")
    return buf.getvalue()


def _texts(data: bytes) -> str:
    prs = Presentation(io.BytesIO(data))
    parts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
    return "\n".join(parts)


def _pictures(data: bytes) -> list[bytes]:
    prs = Presentation(io.BytesIO(data))
    blobs = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                blobs.append(shape.image.blob)
    return blobs


@pytest.fixture
def env(tmp_path, monkeypatch, font_files):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    return tmp_path


@pytest.fixture
def client(env, monkeypatch):
    def fake(project_id, user_prompt=None):
        output = _raw(tools_module.read_materials)(project_id=project_id)
        source_id = next(
            frag.source_id
            for frag in output.source_fragments
            if not frag.source_id.endswith("-img")
        )
        image_ids = [
            mat.asset_id for mat in output.materials if mat.asset_type == "image"
        ]
        items = [
            OutlineItem(
                outline_item_id="page",
                title="配图页",
                summary="说明文字",
                source_ids=[source_id],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.TEXT_IMAGE if image_ids else SlideLayout.CONTENT,
                image_asset_id=image_ids[0] if image_ids else None,
            )
        ]
        _raw(tools_module.propose_outline)(
            project_id=project_id, material_snapshot_id="snap", items=items
        )

    monkeypatch.setattr(tasks, "outline_via_agent", fake)
    with TestClient(api.app) as test_client:
        yield test_client


def _create(client, pid="deck-fp"):
    assert client.post("/api/projects", json={"project_id": pid}).status_code == 200
    return pid


def _upload(client, pid, name, data, mime):
    response = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": (name, data, mime)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _wait(client, pid, task_id):
    import time

    for _ in range(80):
        task = client.get(f"/api/projects/{pid}/tasks/{task_id}").json()
        if task["status"] in ("succeeded", "failed"):
            return task
        time.sleep(0.05)
    raise AssertionError("task did not finish")


def _outline(client, pid):
    started = client.post(f"/api/projects/{pid}/outline/generate")
    assert started.status_code == 202
    task = _wait(client, pid, started.json()["task_id"])
    assert task["status"] == "succeeded", task.get("error")
    version = task["result"]["outline_version"]
    assert client.post(f"/api/projects/{pid}/outlines/{version}/confirm").status_code == 200
    return version


def _generate(client, pid, version, template="keynote_light", auto_fit=False):
    started = client.post(
        f"/api/projects/{pid}/generate",
        json={
            "outline_version": version,
            "template_id": template,
            "auto_fit": auto_fit,
        },
    )
    assert started.status_code == 202, started.text
    task = _wait(client, pid, started.json()["task_id"])
    return task


def _sync(client, pid, version, template="keynote_light", auto_fit=False):
    response = client.get(
        f"/api/projects/{pid}/generation-sync",
        params={
            "outline_version": version,
            "template_id": template,
            "auto_fit": auto_fit,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_footer_and_replaced_image_change_the_pptx_identical_inputs_reuse(client, env):
    pid = _create(client)
    _upload(client, pid, "notes.txt", "图文材料\n".encode(), "text/plain")
    red = _png((255, 0, 0))
    blue = _png((0, 0, 255))
    _upload(client, pid, "pic.png", red, "image/png")
    version = _outline(client, pid)

    first = _generate(client, pid, version)
    assert first["status"] == "succeeded", first.get("error")
    body1 = client.get(f"/api/projects/{pid}/download").content
    assert "BRANDFOOTER" not in _texts(body1)
    assert _sync(client, pid, version)["in_sync"] is True

    brand = client.patch(
        f"/api/projects/{pid}/brand",
        json={"footer_text": "BRANDFOOTER", "accent_hex": "#112233"},
    )
    assert brand.status_code == 200
    assert _sync(client, pid, version)["in_sync"] is False

    second = _generate(client, pid, version)
    assert second["status"] == "succeeded", second.get("error")
    body2 = client.get(f"/api/projects/{pid}/download").content
    assert body2 != body1
    assert "BRANDFOOTER" in _texts(body2)
    assert second["result"]["artifact_id"] != first["result"]["artifact_id"]
    assert _sync(client, pid, version)["in_sync"] is True

    third = _generate(client, pid, version)
    assert third["status"] == "succeeded"
    assert third["result"]["artifact_id"] == second["result"]["artifact_id"]
    assert client.get(f"/api/projects/{pid}/download").content == body2

    _upload(client, pid, "pic.png", blue, "image/png")
    assert _sync(client, pid, version)["in_sync"] is False
    fourth = _generate(client, pid, version)
    assert fourth["status"] == "succeeded", fourth.get("error")
    body4 = client.get(f"/api/projects/{pid}/download").content
    assert body4 != body2
    assert _pictures(body4) != _pictures(body2)
    assert fourth["result"]["artifact_id"] != second["result"]["artifact_id"]


def test_unreferenced_material_does_not_bust_reuse(client):
    pid = _create(client, "deck-extra")
    _upload(client, pid, "notes.txt", "只有文字\n".encode(), "text/plain")
    version = _outline(client, pid)
    first = _generate(client, pid, version)
    assert first["status"] == "succeeded", first.get("error")
    body = client.get(f"/api/projects/{pid}/download").content

    _upload(client, pid, "unused.png", _png((0, 255, 0)), "image/png")
    _upload(client, pid, "aside.txt", "没被引用\n".encode(), "text/plain")
    assert _sync(client, pid, version)["in_sync"] is True
    second = _generate(client, pid, version)
    assert second["result"]["artifact_id"] == first["result"]["artifact_id"]
    assert client.get(f"/api/projects/{pid}/download").content == body


def test_snapshot_is_not_reread_after_files_change(env):
    pid = "deck-snap"
    root = env / pid
    (root / "assets").mkdir(parents=True)
    (root / "assets" / "notes.txt").write_text("材料\n", encoding="utf-8")
    red = _png((255, 0, 0))
    blue = _png((0, 0, 255))
    (root / "assets" / "pic.png").write_bytes(red)
    (root / "meta.json").write_text(
        '{"brand": {"footer_text": "冻结页脚", "accent_hex": "#445566"}}',
        encoding="utf-8",
    )
    output = _raw(tools_module.read_materials)(project_id=pid)
    source_id = output.source_fragments[0].source_id
    outline = _raw(tools_module.propose_outline)(
        project_id=pid,
        material_snapshot_id="snap",
        items=[
            OutlineItem(
                outline_item_id="p",
                title="页",
                summary="正文",
                source_ids=[source_id],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.TEXT_IMAGE,
                image_asset_id="pic",
            )
        ],
    )
    ProjectStorage(pid, storage_root=env).confirm_outline(outline.outline_version)
    artifact = _raw(tools_module.generate_slides)(
        project_id=pid,
        approved_outline_version=outline.outline_version,
        template_id="keynote_light",
        idempotency_key="once",
        auto_fit=False,
    )
    (root / "assets" / "pic.png").write_bytes(blue)
    (root / "meta.json").write_text(
        '{"brand": {"footer_text": "后来的页脚", "accent_hex": "#000000"}}',
        encoding="utf-8",
    )
    exported = tools_module.export_deck_impl(
        project_id=pid,
        artifact_id=artifact.artifact_id,
        revision=artifact.artifact_revision,
        idempotency_key="export-once",
    )
    assert exported.success
    pptx = pathlib.Path(exported.pptx_path).read_bytes()
    assert "冻结页脚" in _texts(pptx)
    assert "后来的页脚" not in _texts(pptx)
    assert _pictures(pptx) == [red] or red in _pictures(pptx)[0]


def test_random_keys_still_share_the_fingerprint(env):
    pid = "deck-keys"
    (env / pid / "assets").mkdir(parents=True)
    (env / pid / "assets" / "notes.txt").write_text("材料\n", encoding="utf-8")
    output = _raw(tools_module.read_materials)(project_id=pid)
    outline = _raw(tools_module.propose_outline)(
        project_id=pid,
        material_snapshot_id="snap",
        items=[
            OutlineItem(
                outline_item_id="p",
                title="页",
                summary="正文",
                source_ids=[output.source_fragments[0].source_id],
                evidence_status=EvidenceStatus.SUPPORTED,
                layout=SlideLayout.CONTENT,
            )
        ],
    )
    storage = ProjectStorage(pid, storage_root=env)
    storage.confirm_outline(outline.outline_version)
    first = _raw(tools_module.generate_slides)(
        project_id=pid,
        approved_outline_version=outline.outline_version,
        template_id="keynote_light",
        idempotency_key="chat-export-aaaaaa",
    )
    exported = tools_module.export_deck_impl(
        project_id=pid,
        artifact_id=first.artifact_id,
        revision=first.artifact_revision,
        idempotency_key="export-aaaaaa",
    )
    assert exported.success
    second = _raw(tools_module.generate_slides)(
        project_id=pid,
        approved_outline_version=outline.outline_version,
        template_id="keynote_light",
        idempotency_key="chat-export-bbbbbb",
    )
    assert second.artifact_id == first.artifact_id
    again = tools_module.export_deck_impl(
        project_id=pid,
        artifact_id=second.artifact_id,
        revision=second.artifact_revision,
        idempotency_key="export-bbbbbb",
    )
    assert again.pptx_path == exported.pptx_path
    assert pathlib.Path(again.pptx_path).read_bytes() == pathlib.Path(exported.pptx_path).read_bytes()


def test_failed_regeneration_keeps_the_previous_file(client):
    pid = _create(client, "deck-fail")
    _upload(client, pid, "notes.txt", "材料\n".encode(), "text/plain")
    version = _outline(client, pid)
    first = _generate(client, pid, version)
    assert first["status"] == "succeeded", first.get("error")
    original = client.get(f"/api/projects/{pid}/download").content

    outline = client.get(f"/api/projects/{pid}/outlines/{version}").json()
    edited = client.put(
        f"/api/projects/{pid}/outlines/{version}",
        json={
            "items": [
                {
                    "outline_item_id": outline["items"][0]["outline_item_id"],
                    "title": "太长",
                    "summary": "字" * 800,
                }
            ]
        },
    )
    assert edited.status_code == 200
    new_version = edited.json()["outline_version"]
    assert client.post(f"/api/projects/{pid}/outlines/{new_version}/confirm").status_code == 200
    failed = _generate(client, pid, new_version)
    assert failed["status"] == "failed"
    assert client.get(f"/api/projects/{pid}/download").content == original
    sync = _sync(client, pid, new_version)
    assert sync["in_sync"] is False
    assert sync["export_fingerprint"]
    project = client.get(f"/api/projects/{pid}").json()
    assert project["download_available"] is True
    assert project["export_legacy"] is False


def test_legacy_artifact_is_safe(client, env):
    pid = _create(client, "deck-legacy")
    _upload(client, pid, "notes.txt", "材料\n".encode(), "text/plain")
    version = _outline(client, pid)
    task = _generate(client, pid, version)
    assert task["status"] == "succeeded", task.get("error")
    artifact_id = task["result"]["artifact_id"]
    revision = task["result"]["artifact_revision"]
    art_path = env / pid / "artifacts" / artifact_id / f"r{revision}.json"
    data = art_path.read_text(encoding="utf-8")
    art_path.write_text(data.replace('"input_fingerprint"', '"ignored_fingerprint"'), encoding="utf-8")
    snap = env / pid / "artifacts" / artifact_id / f"r{revision}.snapshot"
    if snap.exists():
        import shutil
        shutil.rmtree(snap)
    project = client.get(f"/api/projects/{pid}").json()
    assert project["export_legacy"] is True
    assert project["export_fingerprint"] is None
    assert project["download_available"] is True
    sync = _sync(client, pid, version)
    assert sync["in_sync"] is False
    assert sync["legacy_export"] is True
    exported = tools_module.export_deck_impl(
        project_id=pid, artifact_id=artifact_id, revision=revision
    )
    assert exported.success is True
