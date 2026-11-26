"""Offline tests for the PPT Studio Conversational Agent:
- Direct verification of all 9 PPT-native studio tools (materials, outline,
  atomic slide edit, batch edit, add/move/delete, deterministic layout
  self-check, theme switch, one-click export, single-turn version snapshot)
- SSE streaming endpoint GET/POST/DELETE /api/projects/{pid}/chat & persistence
"""

import json
from types import SimpleNamespace

import pytest
from agents.tool_context import ToolContext
from fastapi.testclient import TestClient

import draftboard.api as api
import draftboard.chat_agent as chat_agent
import draftboard.storage as storage_module
import draftboard.tools as tools_module
from draftboard.chat_agent import (
    SlideDraftInput,
    SlidePatchInput,
    StudioTurnState,
    build_studio_tools,
)


def _tool_map(state: StudioTurnState) -> dict:
    tools = build_studio_tools(state)
    out = {}
    for t in tools:
        out[t.name] = t
    return out


async def _invoke(tool, args: dict) -> str:
    raw = json.dumps(args, ensure_ascii=False)
    ctx = ToolContext(
        context=None,
        tool_name=tool.name,
        tool_call_id="call-test",
        tool_arguments=raw,
    )
    return await tool.on_invoke_tool(ctx, raw)


@pytest.fixture
def env(tmp_path, monkeypatch, font_files):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    latin, ea = font_files
    monkeypatch.setenv("DRAFTBOARD_LATIN_FONT", str(latin))
    monkeypatch.setenv("DRAFTBOARD_EA_FONT", str(ea))
    return tmp_path


@pytest.fixture
def client(env):
    with TestClient(api.app) as c:
        yield c


def _seed_project(client: TestClient, pid: str = "studio-chat-1") -> str:
    r = client.post(
        "/api/projects",
        json={"project_id": pid, "name": "未命名文稿", "auto_named": True},
    )
    assert r.status_code == 200
    mat = "# 季度架构评审\n\n核心接口延迟下降 42%，吞吐提升 2.8 倍。\n"
    r = client.post(
        f"/api/projects/{pid}/materials",
        files={"file": ("arch_notes.md", mat.encode("utf-8"), "text/markdown")},
    )
    assert r.status_code == 200
    return pid


@pytest.mark.asyncio
async def test_studio_tools_full_lifecycle_and_single_turn_snapshot(client: TestClient):
    pid = _seed_project(client)
    state = StudioTurnState(project_id=pid, active_theme_id="keynote_light", auto_fit=True)
    tmap = _tool_map(state)

    # 1. Read project materials
    mat_res = json.loads(await _invoke(tmap["read_project_materials"], {}))
    assert mat_res["material_count"] == 1
    source_id = mat_res["fragments"][0]["source_id"]

    # 2. Create full deck outline -> auto-names project & creates 1 version snapshot
    create_res = json.loads(
        await _invoke(
            tmap["create_deck_outline"],
            {
                "slides": [
                    SlideDraftInput(
                        title="2026 架构评审",
                        summary="核心接口延迟下降 42%",
                        layout="cover",
                        source_ids=[source_id],
                        evidence_status="supported",
                    ).model_dump(),
                    SlideDraftInput(
                        title="性能突破",
                        summary="延迟下降 42%\n吞吐提升 2.8 倍",
                        layout="bullets",
                        source_ids=[source_id],
                        evidence_status="supported",
                    ).model_dump(),
                    SlideDraftInput(
                        title="总结与展望",
                        summary="持续推进稳定性建设",
                        layout="closing",
                        source_ids=[],
                        evidence_status="unsupported",
                    ).model_dump(),
                ]
            },
        )
    )
    assert create_res["ok"] is True
    assert create_res["total_slides"] == 3
    v1 = create_res["outline_version"]

    # Verify auto-naming from cover title
    proj = client.get(f"/api/projects/{pid}").json()
    assert proj["name"] == "2026 架构评审"

    # 3. Single-turn multiple edits reuse ONE derived version snapshot
    turn2 = StudioTurnState(
        project_id=pid,
        before_outline_version=v1,
        active_theme_id="keynote_light",
        auto_fit=True,
    )
    tmap2 = _tool_map(turn2)

    upd = json.loads(
        await _invoke(
            tmap2["update_slide"],
            {
                "slide_number": 2,
                "speaker_notes": "这里重点强调缓存层的压测结果。",
            },
        )
    )
    assert upd["ok"] is True
    v2_first = upd["outline_version"]
    assert v2_first != v1

    batch = json.loads(
        await _invoke(
            tmap2["batch_update_slides"],
            {
                "updates": [
                    SlidePatchInput(
                        slide_number=1,
                        speaker_notes="开场交代评审范围。",
                    ).model_dump(),
                ]
            },
        )
    )
    assert batch["ok"] is True
    assert batch["outline_version"] == v2_first  # Same turn reuses same derived version

    # Add a new slide, move it, then delete it
    added = json.loads(
        await _invoke(
            tmap2["manage_slides"],
            {
                "action": "add",
                "slide": SlideDraftInput(
                    title="架构对比",
                    summary="旧架构：同步阻塞",
                    layout="two_column",
                    column_right="新架构：异步流水线",
                    source_ids=[source_id],
                ).model_dump(),
            },
        )
    )
    assert added["ok"] is True
    assert added["total_slides"] == 4
    assert added["slide_number"] == 3  # Auto-inserted before closing slide

    moved = json.loads(
        await _invoke(
            tmap2["manage_slides"],
            {"action": "move", "slide_number": 3, "target_position": 2},
        )
    )
    assert moved["ok"] is True

    # 4. Layout self-check passes cleanly on valid content
    check_ok = json.loads(await _invoke(tmap2["check_deck_layout"], {}))
    assert check_ok["ok"] is True

    # Inject huge overflowing text and verify layout self-check catches OVERFLOW
    await _invoke(
        tmap2["update_slide"],
        {
            "slide_number": 2,
            "summary": "超长测试段落 " * 260,
        },
    )
    check_fail = json.loads(await _invoke(tmap2["check_deck_layout"], {}))
    assert check_fail["ok"] is False
    assert any("OVERFLOW" in iss for iss in check_fail["issues"])

    # Fix overflow & switch theme & export
    await _invoke(
        tmap2["update_slide"],
        {"slide_number": 2, "summary": "旧架构：同步阻塞，响应偏慢"},
    )
    theme_res = json.loads(
        await _invoke(
            tmap2["set_deck_theme"],
            {"theme_id": "keynote_dark", "auto_fit": True},
        )
    )
    assert theme_res["ok"] is True

    exp_res = json.loads(await _invoke(tmap2["export_deck_now"], {}))
    assert exp_res["ok"] is True
    assert turn2.exported is True
    assert turn2.to_changes_dict()["before_outline_version"] == v1
    assert turn2.to_changes_dict()["after_outline_version"] == v2_first


def test_chat_sse_endpoint_and_persistence(client: TestClient, monkeypatch):
    pid = _seed_project(client, pid="studio-sse-1")

    # Initial chat history is empty
    r0 = client.get(f"/api/projects/{pid}/chat")
    assert r0.status_code == 200
    assert r0.json()["messages"] == []

    # Mock Runner.run_streamed to simulate tool_called -> tool_output -> text delta
    class _FakeStreamedResult:
        def __init__(self, agent):
            self._agent = agent
            self.final_output = "已为你切换为极简暗夜主题。"

        async def stream_events(self):
            # Invoke the real set_deck_theme tool so deck_updated fires!
            theme_tool = next(t for t in self._agent.tools if t.name == "set_deck_theme")
            yield SimpleNamespace(
                type="run_item_stream_event",
                name="tool_called",
                item=SimpleNamespace(raw_item=SimpleNamespace(name="set_deck_theme")),
            )
            await _invoke(theme_tool, {"theme_id": "keynote_dark"})
            yield SimpleNamespace(
                type="run_item_stream_event",
                name="tool_output",
                item=SimpleNamespace(raw_item=SimpleNamespace(name="set_deck_theme")),
            )
            for ch in ["已为你切换为", "极简暗夜主题。"]:
                yield SimpleNamespace(
                    type="raw_response_event",
                    data=SimpleNamespace(type="response.output_text.delta", delta=ch),
                )

    monkeypatch.setattr(
        chat_agent.Runner,
        "run_streamed",
        staticmethod(lambda agent, *args, **kwargs: _FakeStreamedResult(agent)),
    )

    r_post = client.post(
        f"/api/projects/{pid}/chat",
        json={
            "message": "帮我换成极简暗夜主题",
            "selected_slide_index": 0,
            "theme_id": "keynote_light",
            "auto_fit": True,
        },
    )
    assert r_post.status_code == 200
    assert "text/event-stream" in r_post.headers["content-type"]

    events = []
    for block in r_post.text.split("\n\n"):
        line = block.strip()
        if line.startswith("data:"):
            events.append(json.loads(line[5:].strip()))

    ev_types = [e["type"] for e in events]
    assert "user_saved" in ev_types
    assert "tool_start" in ev_types
    assert "tool_done" in ev_types
    assert "deck_updated" in ev_types
    assert "delta" in ev_types
    assert ev_types[-1] == "done"

    done_ev = events[-1]
    assert done_ev["message"]["content"] == "已为你切换为极简暗夜主题。"
    assert done_ev["changes"]["theme_id"] == "keynote_dark"

    # Verify history persisted to chat.json
    r_hist = client.get(f"/api/projects/{pid}/chat")
    assert r_hist.status_code == 200
    msgs = r_hist.json()["messages"]
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["changes"]["theme_id"] == "keynote_dark"

    # Verify DELETE clears chat history
    r_del = client.delete(f"/api/projects/{pid}/chat")
    assert r_del.status_code == 200
    assert client.get(f"/api/projects/{pid}/chat").json()["messages"] == []


def test_error_classification_history_filtering_tool_status_and_retry(
    client: TestClient, monkeypatch
):
    from draftboard.llm_config import classify_llm_error

    # 1. Unified error classifier maps common LLM failures to structured Chinese messages
    assert classify_llm_error(RuntimeError("Error code: 401 - invalid_api_key"))[0] == "AUTH_ERROR"
    assert classify_llm_error(RuntimeError("Error code: 404 - model not found"), "foo-1")[0] == "MODEL_NOT_FOUND"
    code_429, _, retry_429 = classify_llm_error(RuntimeError("429 Too Many Requests / rate limit"))
    assert code_429 == "RATE_LIMIT" and retry_429 is True
    assert classify_llm_error(RuntimeError("maximum context length exceeded"))[0] == "CONTEXT_TOO_LONG"
    assert classify_llm_error(TimeoutError("Request timed out"))[0] == "TIMEOUT_OR_NETWORK"

    # 2. Clean history filter strips failed (user, error_assistant) pairs
    dirty_history = [
        {"role": "user", "content": "正常提问 1"},
        {"role": "assistant", "content": "正常回答 1"},
        {"role": "user", "content": "触发报错的提问"},
        {"role": "assistant", "content": "处理失败", "is_error": True},
        {"role": "user", "content": "正常提问 2"},
        {"role": "assistant", "content": "正常回答 2"},
    ]
    clean = chat_agent._filter_clean_history(dirty_history)
    assert [m["content"] for m in clean] == [
        "正常提问 1",
        "正常回答 1",
        "正常提问 2",
        "正常回答 2",
    ]

    # 3. Tool output inspector distinguishes done / warning (layout overflow) / error
    assert chat_agent._inspect_tool_output("update_slide", "ERROR: 页码越界")[0] == "error"
    assert (
        chat_agent._inspect_tool_output(
            "check_deck_layout", json.dumps({"ok": False, "issues": ["OVERFLOW"]})
        )[0]
        == "warning"
    )
    assert (
        chat_agent._inspect_tool_output(
            "update_slide", json.dumps({"ok": True})
        )[0]
        == "done"
    )

    # 4. Mid-turn error after a partial deck edit preserves changes, notifies user,
    #    and retrying with replace_last_error=True replaces the failed turn cleanly.
    pid = _seed_project(client, pid="studio-err-1")

    class _MidTurnFailureStream:
        def __init__(self, agent):
            self._agent = agent
            self.final_output = ""

        async def stream_events(self):
            create_tool = next(
                t for t in self._agent.tools if t.name == "create_deck_outline"
            )
            yield SimpleNamespace(
                type="run_item_stream_event",
                name="tool_called",
                item=SimpleNamespace(raw_item=SimpleNamespace(name="create_deck_outline")),
            )
            out = await _invoke(
                create_tool,
                {
                    "slides": [
                        SlideDraftInput(
                            title="半途改动测试",
                            summary="内容要点",
                            layout="cover",
                            source_ids=[],
                            evidence_status="unsupported",
                        ).model_dump()
                    ]
                },
            )
            yield SimpleNamespace(
                type="run_item_stream_event",
                name="tool_output",
                item=SimpleNamespace(
                    raw_item=SimpleNamespace(name="create_deck_outline"),
                    output=out,
                ),
            )
            raise RuntimeError("429 Rate limit reached on second step")

    monkeypatch.setattr(
        chat_agent.Runner,
        "run_streamed",
        staticmethod(lambda agent, *args, **kwargs: _MidTurnFailureStream(agent)),
    )

    r_fail = client.post(
        f"/api/projects/{pid}/chat",
        json={"message": "帮我建个封面"},
    )
    assert r_fail.status_code == 200
    fail_events = [
        json.loads(b.strip()[5:].strip())
        for b in r_fail.text.split("\n\n")
        if b.strip().startswith("data:")
    ]
    err_ev = fail_events[-1]
    assert err_ev["type"] == "error"
    assert err_ev["code"] == "RATE_LIMIT"
    assert err_ev["retryable"] is True
    assert "429" in err_ev["error"]
    assert "撤回" in err_ev["error"]
    assert err_ev["message"]["changes"]["after_outline_version"] is not None
    assert err_ev["message"]["error_detail"]

    # Now retry cleanly with replace_last_error=True
    class _SuccessRetryStream:
        def __init__(self, agent):
            self.final_output = "重试成功。"

        async def stream_events(self):
            yield SimpleNamespace(
                type="raw_response_event",
                data=SimpleNamespace(type="response.output_text.delta", delta="重试成功。"),
            )

    monkeypatch.setattr(
        chat_agent.Runner,
        "run_streamed",
        staticmethod(lambda agent, *args, **kwargs: _SuccessRetryStream(agent)),
    )

    r_retry = client.post(
        f"/api/projects/{pid}/chat",
        json={"message": "帮我建个封面", "replace_last_error": True},
    )
    assert r_retry.status_code == 200
    msgs = client.get(f"/api/projects/{pid}/chat").json()["messages"]
    # Failed turn was cleanly replaced -> only 2 messages (user + success assistant)
    assert len(msgs) == 2
    assert msgs[1]["content"] == "重试成功。"
    assert not msgs[1].get("is_error")


def test_custom_palette_derivation_and_agent_tool(client):
    """Custom palette derives contrast-safe text/surfaces, preserves footer, and resets cleanly."""
    import asyncio

    from draftboard.themes import get_theme
    from draftboard.user_library import apply_brand_to_theme, _relative_luminance

    # 1. Dark cover + dark body auto-derives bright readable text
    dark_custom = apply_brand_to_theme(
        get_theme("keynote_light"),
        {
            "palette_name": "金融深海蓝金",
            "cover_bg_hex": "#0B1D3A",
            "bg_hex": "#101828",
            "accent_hex": "#D4AF37",
        },
    )
    assert dark_custom.name == "金融深海蓝金"
    assert dark_custom.cover_bg_hex == "#0B1D3A"
    assert dark_custom.bg_hex == "#101828"
    assert dark_custom.accent_hex == "#D4AF37"
    assert _relative_luminance(dark_custom.title_hex) > 0.7
    assert _relative_luminance(dark_custom.cover_title_hex) > 0.7
    assert dark_custom.chart_palette[0] == "#D4AF37"

    # 2. Light cover + light body auto-derives dark readable ink
    light_custom = apply_brand_to_theme(
        get_theme("keynote_dark"),
        {
            "cover_bg_hex": "#F7F3E9",
            "bg_hex": "#FDFBF7",
            "accent_hex": "#2E7D63",
        },
    )
    assert _relative_luminance(light_custom.title_hex) < 0.08
    assert _relative_luminance(light_custom.cover_title_hex) < 0.08

    # 3. Agent set_custom_palette preserves footer_text and set_deck_theme clears color overrides
    pid = _seed_project(client, pid="studio-palette-1")
    r_brand = client.patch(
        f"/api/projects/{pid}/brand",
        json={"footer_text": "内部机密 · 2026"},
    )
    assert r_brand.status_code == 200

    state = chat_agent.StudioTurnState(project_id=pid, active_theme_id="keynote_light")
    tools = {t.name: t for t in chat_agent.build_studio_tools(state)}
    out = asyncio.run(
        _invoke(
            tools["set_custom_palette"],
            {
                "palette_name": "深海蓝金",
                "cover_bg_hex": "#0B1D3A",
                "bg_hex": "#F8FAFC",
                "accent_hex": "#C89B3C",
            },
        )
    )
    parsed = json.loads(out)
    assert parsed["ok"] is True
    assert parsed["palette_name"] == "深海蓝金"
    assert state.to_changes_dict()["brand_updated"] is True
    assert state.to_changes_dict()["palette_name"] == "深海蓝金"

    proj = client.get(f"/api/projects/{pid}").json()
    assert proj["brand"]["cover_bg_hex"] == "#0B1D3A"
    assert proj["brand"]["bg_hex"] == "#F8FAFC"
    assert proj["brand"]["accent_hex"] == "#C89B3C"
    assert proj["brand"]["footer_text"] == "内部机密 · 2026"

    # Switching back to preset theme clears custom colors but keeps footer_text
    out_theme = asyncio.run(
        _invoke(tools["set_deck_theme"], {"theme_id": "nordic_pine"})
    )
    assert json.loads(out_theme)["ok"] is True
    proj2 = client.get(f"/api/projects/{pid}").json()
    assert proj2["theme_id"] == "nordic_pine"
    assert proj2["brand"]["cover_bg_hex"] is None
    assert proj2["brand"]["bg_hex"] is None
    assert proj2["brand"]["accent_hex"] is None
    assert proj2["brand"]["footer_text"] == "内部机密 · 2026"
