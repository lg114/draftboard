"""Tests for multi-profile LLM settings, API key masking, env fallback,
and unconfigured pre-flight guards on outline generation & Agent chat.
"""

import json

import pytest
from fastapi.testclient import TestClient

import draftboard.api as api
import draftboard.llm_config as llm_config
import draftboard.storage as storage_module
import draftboard.tools as tools_module


@pytest.fixture
def clean_llm_env(tmp_path, monkeypatch):
    monkeypatch.setattr(tools_module, "_storage_root", tmp_path)
    monkeypatch.setattr(storage_module, "STORAGE_ROOT", tmp_path)
    for var in (
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "OPENAI_BASE_URL",
        "DRAFTBOARD_MODEL",
        "GEMINI_MODEL",
    ):
        monkeypatch.delenv(var, raising=False)
    return tmp_path


@pytest.fixture
def client(clean_llm_env):
    with TestClient(api.app) as c:
        yield c


def test_unconfigured_state_and_preflight_guards(client: TestClient):
    # 1. Settings report unconfigured cleanly
    r = client.get("/api/settings/llm")
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is False
    assert body["source"] == "none"
    assert body["profiles"] == []
    assert len(body["presets"]) >= 4

    # 2. Seed a project with a material
    pid = "guard-proj-1"
    assert client.post("/api/projects", json={"project_id": pid}).status_code == 200
    assert (
        client.post(
            f"/api/projects/{pid}/materials",
            files={"file": ("brief.md", b"# Hello\n\nContent.\n", "text/markdown")},
        ).status_code
        == 200
    )

    # 3. Outline generation is blocked upfront with LLM_NOT_CONFIGURED
    r_out = client.post(f"/api/projects/{pid}/outline/generate")
    assert r_out.status_code == 400
    assert "LLM_NOT_CONFIGURED" in r_out.json()["detail"]

    # 4. Chat endpoint yields clean LLM_NOT_CONFIGURED SSE event without saving junk history
    r_chat = client.post(
        f"/api/projects/{pid}/chat",
        json={"message": "帮我看看这份材料"},
    )
    assert r_chat.status_code == 200
    events = [
        json.loads(block.strip()[5:].strip())
        for block in r_chat.text.split("\n\n")
        if block.strip().startswith("data:")
    ]
    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert events[0]["code"] == "LLM_NOT_CONFIGURED"
    assert client.get(f"/api/projects/{pid}/chat").json()["messages"] == []


def test_multi_profile_crud_masking_and_env_fallback(client: TestClient, monkeypatch):
    # 1. Create OpenAI profile with API key
    r1 = client.post(
        "/api/settings/llm/profiles",
        json={
            "name": "主力 OpenAI",
            "provider": "openai",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-super-secret-12345678",
            "model": "gpt-4o-mini",
            "activate": True,
        },
    )
    assert r1.status_code == 200
    s1 = r1.json()
    assert s1["configured"] is True
    assert s1["source"] == "profile"
    assert len(s1["profiles"]) == 1
    p1 = s1["profiles"][0]
    assert p1["has_api_key"] is True
    assert p1["api_key_masked"] == "sk-••••5678"
    assert "sk-super-secret-12345678" not in r1.text

    # 2. Create keyless local Ollama profile -> auto-activates
    r2 = client.post(
        "/api/settings/llm/profiles",
        json={
            "name": "本地 Ollama",
            "provider": "ollama",
            "base_url": "http://127.0.0.1:11434/v1",
            "model": "qwen2.5:14b",
            "activate": True,
        },
    )
    assert r2.status_code == 200
    s2 = r2.json()
    assert len(s2["profiles"]) == 2
    p2_id = s2["active_profile_id"]
    assert p2_id != p1["id"]
    eff = llm_config.resolve_effective_llm_config()
    assert eff.provider == "ollama"
    assert eff.model == "qwen2.5:14b"
    assert eff.base_url == "http://127.0.0.1:11434/v1"

    # 3. Switch back to OpenAI profile & update model WITHOUT re-entering key
    r_sw = client.post("/api/settings/llm/active", json={"profile_id": p1["id"]})
    assert r_sw.status_code == 200
    assert r_sw.json()["active_profile_id"] == p1["id"]

    r_upd = client.post(
        "/api/settings/llm/profiles",
        json={
            "profile_id": p1["id"],
            "name": "主力 OpenAI",
            "provider": "openai",
            "base_url": "https://api.openai.com/v1",
            "api_key": None,
            "model": "gpt-4o",
            "activate": True,
        },
    )
    assert r_upd.status_code == 200
    eff2 = llm_config.resolve_effective_llm_config()
    assert eff2.model == "gpt-4o"
    assert eff2.api_key == "sk-super-secret-12345678"  # Preserved!

    # 4. Env var fallback works when switching active_profile_id to None
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyEnvKey9999")
    r_env = client.post("/api/settings/llm/active", json={"profile_id": None})
    assert r_env.status_code == 200
    s_env = r_env.json()
    assert s_env["source"] == "env"
    assert s_env["env_detected"]["provider"] == "gemini"

    # 5. Deleting profiles cleans up cleanly
    r_del1 = client.delete(f"/api/settings/llm/profiles/{p1['id']}")
    assert r_del1.status_code == 200
    assert len(r_del1.json()["profiles"]) == 1
    r_del2 = client.delete(f"/api/settings/llm/profiles/{p2_id}")
    assert r_del2.status_code == 200
    assert r_del2.json()["profiles"] == []


def test_env_instant_model_switch_and_provider_inference(client: TestClient, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyEnvKey8888")
    monkeypatch.setenv("DRAFTBOARD_MODEL", "gemini-2.5-flash-lite")

    s0 = client.get("/api/settings/llm").json()
    assert s0["source"] == "env"
    assert s0["env_detected"]["provider"] == "gemini"
    assert s0["env_detected"]["model"] == "gemini-2.5-flash-lite"
    assert "gemini-2.5-pro" in s0["env_detected"]["models"]

    # Switch active model directly on .env provider WITHOUT creating a duplicate profile
    r_sw = client.post(
        "/api/settings/llm/active",
        json={
            "profile_id": None,
            "model": "gemini-2.5-pro",
            "models": ["gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
        },
    )
    assert r_sw.status_code == 200
    s1 = r_sw.json()
    assert s1["source"] == "env"
    assert s1["profiles"] == []
    assert s1["active_summary"]["model"] == "gemini-2.5-pro"
    eff = llm_config.resolve_effective_llm_config()
    assert eff.model == "gemini-2.5-pro"
    assert eff.api_key == "AIzaSyEnvKey8888"

    # Also test URL-based provider inference (SiliconFlow)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-sf-1234567890")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.siliconflow.cn/v1")
    s_sf = client.get("/api/settings/llm").json()
    assert s_sf["env_detected"]["provider"] == "siliconflow"


def test_fetch_provider_models_filters_and_strips_prefix(client: TestClient, monkeypatch):
    from types import SimpleNamespace

    class DummyModelsAPI:
        async def list(self):
            return SimpleNamespace(
                data=[
                    SimpleNamespace(id="models/gemini-2.5-pro"),
                    SimpleNamespace(id="models/gemini-2.5-flash"),
                    SimpleNamespace(id="models/text-embedding-004"),
                    SimpleNamespace(id="whisper-1"),
                ]
            )

    class DummyAsyncOpenAI:
        def __init__(self, **kwargs):
            self.models = DummyModelsAPI()

        async def close(self):
            pass

    monkeypatch.setattr(llm_config, "AsyncOpenAI", DummyAsyncOpenAI)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyEnvKey7777")

    r = client.post(
        "/api/settings/llm/models",
        json={"use_env": True, "provider": "gemini"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["models"] == ["gemini-2.5-flash", "gemini-2.5-pro"]


def test_new_provider_presets_inference_and_keyless_lmstudio(
    client: TestClient, monkeypatch
):
    presets = {p["id"]: p for p in client.get("/api/settings/llm").json()["presets"]}
    for pid in ("claude", "zhipu", "volcengine", "lmstudio"):
        assert pid in presets

    assert presets["claude"]["requires_api_key"] is True
    assert presets["zhipu"]["requires_api_key"] is True
    assert presets["volcengine"]["requires_api_key"] is True
    assert presets["lmstudio"]["requires_api_key"] is False

    # URL-based inference covers the new providers + host.docker.internal local ports
    assert llm_config._infer_provider_from_url("https://api.anthropic.com/v1/") == "claude"
    assert llm_config._infer_provider_from_url("https://open.bigmodel.cn/api/paas/v4/") == "zhipu"
    assert (
        llm_config._infer_provider_from_url("https://ark.cn-beijing.volces.com/api/v3")
        == "volcengine"
    )
    assert llm_config._infer_provider_from_url("http://127.0.0.1:1234/v1") == "lmstudio"
    assert (
        llm_config._infer_provider_from_url("http://host.docker.internal:1234/v1")
        == "lmstudio"
    )
    assert (
        llm_config._infer_provider_from_url("http://host.docker.internal:11434/v1")
        == "ollama"
    )

    # Keyless local LM Studio works via env fallback
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:1234/v1")
    s_env = client.get("/api/settings/llm").json()
    assert s_env["configured"] is True
    assert s_env["env_detected"]["provider"] == "lmstudio"

    # Keyless local LM Studio profile saves and activates cleanly
    r_lms = client.post(
        "/api/settings/llm/profiles",
        json={
            "name": "本地 LM Studio",
            "provider": "lmstudio",
            "base_url": "http://127.0.0.1:1234/v1",
            "model": "qwen2.5-14b-instruct",
            "activate": True,
        },
    )
    assert r_lms.status_code == 200
    eff = llm_config.resolve_effective_llm_config()
    assert eff.provider == "lmstudio"
    assert eff.model == "qwen2.5-14b-instruct"
    assert eff.base_url == "http://127.0.0.1:1234/v1"
