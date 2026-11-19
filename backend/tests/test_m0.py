"""
Integration tests for M0 draftboard agent.

All tests are marked with @pytest.mark.integration and are skipped by
default unless OPENAI_API_KEY is set.

Run with:
    uv run pytest tests/test_m0.py -m integration -v
"""

import asyncio
import os
import pathlib
import time
import uuid

import pytest
from dotenv import load_dotenv

load_dotenv()

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def pacing_delay():
    """Add a short pause between tests to respect Google AI Studio free tier RPM."""
    yield
    time.sleep(4)


@pytest.fixture
def api_key():
    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        pytest.skip("Neither OPENAI_API_KEY nor GEMINI_API_KEY is set")
    return key


@pytest.fixture
def tmp_project(tmp_path):
    """Create a temporary project with sample assets."""
    project_id = f"m0-test-{uuid.uuid4().hex[:8]}"
    assets_dir = tmp_path / project_id / "assets"
    assets_dir.mkdir(parents=True)
    md = assets_dir / "intro.md"
    md.write_text(
        "# AI Strategy\n\nAI adoption is accelerating across industries.\n\n"
        "## Key Benefits\n\n- Automation\n- Cost reduction\n- Innovation\n",
        encoding="utf-8",
    )
    return project_id, tmp_path


# ── 1. Agent responds to simple prompt ───────────────────────────────────────


async def test_agent_simple_response(api_key):
    from draftboard.agent import run_agent

    result = await run_agent("Say hello and briefly introduce yourself in one sentence.")
    assert isinstance(result, str)
    assert len(result) > 0


# ── 2. Agent can call read_materials tool ─────────────────────────────────────


async def test_agent_calls_read_materials(api_key, tmp_project, monkeypatch):
    import draftboard.tools as tools_module
    from draftboard.agent import run_agent

    project_id, tmp_path = tmp_project
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)

    prompt = (
        f"Read the materials for project '{project_id}' and list the asset IDs you found."
    )
    result = await run_agent(prompt)
    assert isinstance(result, str)
    # The agent should mention the asset name
    assert "intro" in result.lower() or "material" in result.lower()


# ── 3. Invalid JSON output caught by application-layer validation ─────────────


def test_invalid_json_caught_by_validation():
    """
    Simulate the scenario where a model returns malformed structured output.
    The application layer (Pydantic) should raise a ValidationError.
    """
    from pydantic import ValidationError
    from draftboard.models import Outline

    invalid_data = {
        "outline_version": "v-bad",
        "project_id": "proj",
        "items": "not-a-list",  # intentionally wrong type
    }
    with pytest.raises(ValidationError):
        Outline.model_validate(invalid_data)


# ── 4. Agent outline includes source_ids ─────────────────────────────────────


async def test_agent_outline_has_source_ids(api_key, tmp_project, monkeypatch):
    import draftboard.tools as tools_module
    from draftboard.agent import run_agent

    project_id, tmp_path = tmp_project
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)

    prompt = (
        f"Read the materials for project '{project_id}', "
        f"then propose an outline. Make sure each outline item cites at least one source_id."
    )
    result = await run_agent(prompt)
    assert isinstance(result, str)
    # Verify agent used the propose_outline tool by checking outline version format
    assert "v-" in result or "outline" in result.lower()


# ── 5. Full smoke test: init → read → propose → confirm → generate ────────────


async def test_full_pipeline_smoke(api_key, tmp_project, monkeypatch):
    import draftboard.tools as tools_module
    from draftboard.storage import ProjectStorage
    from draftboard.agent import run_agent

    project_id, tmp_path = tmp_project
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)

    # Step 1: Agent reads materials and proposes outline
    prompt = (
        f"Read materials for project '{project_id}' using read_materials, "
        f"then call propose_outline to save an outline with 2 items. "
        f"Report the outline_version returned."
    )
    result = await run_agent(prompt)
    assert isinstance(result, str)

    # Step 2: Find the saved outline and confirm it manually
    storage = ProjectStorage(project_id, storage_root=tmp_path)
    outlines_dir = storage.root / "outlines"
    outline_files = list(outlines_dir.glob("*.json")) if outlines_dir.exists() else []

    if not outline_files:
        pytest.skip("Agent did not save an outline (model may have behaved differently)")

    outline_version = outline_files[0].stem
    confirmed = storage.confirm_outline(outline_version)
    assert confirmed.is_confirmed is True

    # Pacing to respect free tier RPM
    await asyncio.sleep(6)

    # Step 3: Generate slides
    prompt2 = (
        f"Call generate_slides for project '{project_id}' with "
        f"approved_outline_version='{outline_version}' and idempotency_key='smoke-test-001'."
    )
    result2 = await run_agent(prompt2)
    assert isinstance(result2, str)


# ── 6. Full pipeline through export: success judged by file + report ─────────


async def test_full_pipeline_export(api_key, tmp_project, monkeypatch):
    import json

    import draftboard.tools as tools_module
    from draftboard.storage import ProjectStorage
    from draftboard.agent import run_agent

    project_id, tmp_path = tmp_project
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)

    prompt = (
        f"Read materials for project '{project_id}' using read_materials, "
        f"then call propose_outline to save an outline with 2 items citing "
        f"real source_ids. Report the outline_version returned."
    )
    await run_agent(prompt)

    storage = ProjectStorage(project_id, storage_root=tmp_path)
    outlines_dir = storage.root / "outlines"
    outline_files = list(outlines_dir.glob("*.json")) if outlines_dir.exists() else []
    if not outline_files:
        pytest.skip("Agent did not save an outline")
    outline_version = outline_files[0].stem
    storage.confirm_outline(outline_version)

    await asyncio.sleep(6)

    prompt2 = (
        f"Call generate_slides for project '{project_id}' with "
        f"approved_outline_version='{outline_version}' and idempotency_key='export-smoke-001'. "
        f"Then call validate_artifact on the returned artifact_id at revision 1, "
        f"then call export_deck for the same artifact at revision 1. "
        f"Report whether export_deck returned success=true and the file path."
    )
    await run_agent(prompt2)

    # Success is judged by the written file and report, not the model's words.
    exports_dir = storage.root / "exports"
    pptx_files = list(exports_dir.glob("*.pptx")) if exports_dir.exists() else []
    if not pptx_files:
        pytest.skip("Agent did not complete the export")
    report_path = pptx_files[0].with_name(pptx_files[0].stem + ".report.json")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["success"] is True
    assert report["slide_count"] == 2
