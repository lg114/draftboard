"""
Local multi-profile LLM configuration manager for Draftboard.

Settings are stored outside git in `~/.draftboard/settings.json` (or beside
the test storage root when `_storage_root` is overridden in tests).
Resolution order:
  1. Active profile saved in settings.json
  2. Environment variables (GEMINI_API_KEY / OPENAI_API_KEY / OPENAI_BASE_URL / DRAFTBOARD_MODEL)
  3. Unconfigured (offline manual editing & PPTX/PDF export still work)
"""

from __future__ import annotations

import json
import os
import pathlib
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional

from openai import AsyncOpenAI

import draftboard.tools as tools_module
from draftboard.storage import STORAGE_ROOT, load_json


class LLMNotConfiguredError(ValueError):
    """Raised when an AI operation is invoked with no usable LLM configuration."""


def classify_llm_error(
    exc: Exception, model_name: str = ""
) -> tuple[str, str, bool]:
    """Map raw LLM / SDK exceptions into `(error_code, friendly_cn, retryable)`."""
    if isinstance(exc, LLMNotConfiguredError):
        return (
            "LLM_NOT_CONFIGURED",
            "尚未配置大模型，请先点击「模型设置」配置 API Key 或本地 Ollama。",
            False,
        )

    cls_name = type(exc).__name__
    msg = str(exc) or cls_name
    low = msg.lower()
    model_hint = f"「{model_name}」" if model_name else ""

    if "maxturnsexceeded" in cls_name.lower() or "max turns" in low:
        return (
            "MAX_TURNS",
            "本轮任务步骤过多已自动暂停，建议缩小单次修改范围或拆成两步继续。",
            False,
        )
    if (
        "401" in msg
        or "authentication" in low
        or "invalid api key" in low
        or "invalid_api_key" in low
        or "incorrect api key" in low
        or "api_key" in low
        or "api key" in low
        or "unauthorized" in low
    ):
        return (
            "AUTH_ERROR",
            "鉴权失败：当前模型的 API Key 无效或已过期，请在模型设置中检查。",
            False,
        )
    if (
        "404" in msg
        or ("model" in low and ("not found" in low or "does not exist" in low))
        or "model_not_found" in low
    ):
        return (
            "MODEL_NOT_FOUND",
            f"找不到模型{model_hint}，请在模型设置中核对模型名称或接口地址。",
            False,
        )
    if (
        "429" in msg
        or "ratelimit" in cls_name.lower()
        or "rate limit" in low
        or "rate_limit" in low
        or "quota" in low
        or "resource_exhausted" in low
        or "too many requests" in low
    ):
        return (
            "RATE_LIMIT",
            "触发模型频率或额度限制（429），可稍后点击重试或切换其他配置。",
            True,
        )
    if (
        "context_length" in low
        or "maximum context" in low
        or "context window" in low
        or "too many tokens" in low
        or "token limit" in low
        or "request too large" in low
    ):
        return (
            "CONTEXT_TOO_LONG",
            "当前对话或素材上下文超出模型长度限制，建议清空历史对话或精简素材后重试。",
            False,
        )
    if (
        "timeout" in low
        or "timed out" in low
        or "connection" in low
        or "connecterror" in cls_name.lower()
        or "apiconnectionerror" in cls_name.lower()
        or "502" in msg
        or "503" in msg
        or "504" in msg
        or "overloaded" in low
    ):
        return (
            "TIMEOUT_OR_NETWORK",
            "连接模型接口超时或网络中断，请检查接口地址与网络状态后重试。",
            True,
        )
    return (
        "AGENT_ERROR",
        f"模型调用异常：{msg[:160]}",
        True,
    )


PROVIDER_PRESETS: list[dict[str, Any]] = [
    {
        "id": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
        "requires_api_key": True,
        "suggested_models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-2.5-flash",
        "requires_api_key": True,
        "suggested_models": ["gemini-2.5-flash", "gemini-2.5-pro"],
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
        "requires_api_key": True,
        "suggested_models": ["deepseek-chat", "deepseek-reasoner"],
    },
    {
        "id": "ollama",
        "name": "本地 Ollama",
        "base_url": "http://127.0.0.1:11434/v1",
        "default_model": "qwen2.5:14b",
        "requires_api_key": False,
        "suggested_models": ["qwen2.5:14b", "llama3.1:8b", "deepseek-r1:14b"],
    },
    {
        "id": "custom",
        "name": "自定义兼容接口",
        "base_url": "",
        "default_model": "",
        "requires_api_key": False,
        "suggested_models": [],
    },
]

_PRESET_BY_ID = {p["id"]: p for p in PROVIDER_PRESETS}


@dataclass(frozen=True)
class EffectiveLLMConfig:
    configured: bool
    source: str  # "profile" | "env" | "none"
    profile_id: Optional[str] = None
    profile_name: str = ""
    provider: str = ""
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: str = ""


def _settings_path() -> pathlib.Path:
    """Resolve settings.json beside the active storage root (isolated in tests)."""
    if tools_module._storage_root is not None:
        return pathlib.Path(tools_module._storage_root) / "_settings.json"
    return STORAGE_ROOT.parent / "settings.json"


def mask_api_key(key: Optional[str]) -> str:
    raw = (key or "").strip()
    if not raw:
        return ""
    if len(raw) <= 8:
        return "••••"
    return f"{raw[:3]}••••{raw[-4:]}"


def _read_raw_settings() -> dict[str, Any]:
    path = _settings_path()
    if not path.exists():
        return {"active_profile_id": None, "profiles": []}
    try:
        data = load_json(path)
        if isinstance(data, dict):
            profiles = data.get("profiles")
            if not isinstance(profiles, list):
                profiles = []
            return {
                "active_profile_id": data.get("active_profile_id"),
                "profiles": [p for p in profiles if isinstance(p, dict) and p.get("id")],
            }
    except Exception:
        pass
    return {"active_profile_id": None, "profiles": []}


def _write_raw_settings(data: dict[str, Any]) -> None:
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    tmp.replace(path)


def _is_profile_usable(profile: dict[str, Any]) -> bool:
    model = str(profile.get("model") or "").strip()
    if not model:
        return False
    provider = str(profile.get("provider") or "custom").strip()
    api_key = str(profile.get("api_key") or "").strip()
    base_url = str(profile.get("base_url") or "").strip()
    preset = _PRESET_BY_ID.get(provider)
    if preset and preset.get("requires_api_key", True):
        return bool(api_key)
    # Ollama or custom local gateway: requires base_url (or api_key)
    return bool(base_url or api_key)


def _resolve_env_config() -> Optional[EffectiveLLMConfig]:
    gemini_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    openai_key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    base_url = (os.environ.get("OPENAI_BASE_URL") or "").strip() or None

    if gemini_key or (base_url and "generativelanguage.googleapis.com" in base_url):
        key = gemini_key or openai_key
        if not key:
            return None
        resolved_base = (
            base_url or "https://generativelanguage.googleapis.com/v1beta/openai/"
        )
        model_name = (
            os.environ.get("DRAFTBOARD_MODEL")
            or os.environ.get("GEMINI_MODEL")
            or "gemini-2.5-flash"
        ).strip()
        return EffectiveLLMConfig(
            configured=True,
            source="env",
            profile_id=None,
            profile_name="环境变量（Gemini）",
            provider="gemini",
            base_url=resolved_base,
            api_key=key,
            model=model_name,
        )

    if base_url:
        is_local = any(
            h in base_url.lower() for h in ("127.0.0.1", "localhost", "0.0.0.0")
        )
        if not openai_key and not is_local:
            return None
        model_name = (os.environ.get("DRAFTBOARD_MODEL") or "gpt-4o-mini").strip()
        return EffectiveLLMConfig(
            configured=True,
            source="env",
            profile_id=None,
            profile_name="环境变量",
            provider="ollama" if is_local else "custom",
            base_url=base_url,
            api_key=openai_key or "local-no-key",
            model=model_name,
        )

    if openai_key:
        model_name = (os.environ.get("DRAFTBOARD_MODEL") or "gpt-4o-mini").strip()
        return EffectiveLLMConfig(
            configured=True,
            source="env",
            profile_id=None,
            profile_name="环境变量（OpenAI）",
            provider="openai",
            base_url=None,
            api_key=openai_key,
            model=model_name,
        )

    return None


def resolve_effective_llm_config() -> EffectiveLLMConfig:
    """Resolve the active LLM configuration (saved profile > environment > none)."""
    raw = _read_raw_settings()
    active_id = raw.get("active_profile_id")
    profiles: list[dict[str, Any]] = raw.get("profiles", [])

    if active_id:
        selected = next((p for p in profiles if p.get("id") == active_id), None)
        if selected and _is_profile_usable(selected):
            provider = str(selected.get("provider") or "custom").strip()
            preset = _PRESET_BY_ID.get(provider, {})
            base_url = str(selected.get("base_url") or "").strip() or (
                str(preset.get("base_url") or "").strip() or None
            )
            # For standard OpenAI default URL, pass None so SDK uses its native default
            if provider == "openai" and base_url == "https://api.openai.com/v1":
                base_url = None
            api_key = str(selected.get("api_key") or "").strip() or "local-no-key"
            return EffectiveLLMConfig(
                configured=True,
                source="profile",
                profile_id=str(selected["id"]),
                profile_name=str(selected.get("name") or preset.get("name") or "自定义配置"),
                provider=provider,
                base_url=base_url,
                api_key=api_key,
                model=str(selected.get("model") or "").strip(),
            )

    env_cfg = _resolve_env_config()
    if env_cfg is not None:
        return env_cfg

    return EffectiveLLMConfig(configured=False, source="none")


def is_llm_configured() -> bool:
    return resolve_effective_llm_config().configured


def get_public_llm_settings() -> dict[str, Any]:
    """Return UI-safe LLM settings payload (API keys are strictly masked)."""
    raw = _read_raw_settings()
    profiles_raw: list[dict[str, Any]] = raw.get("profiles", [])
    effective = resolve_effective_llm_config()
    env_cfg = _resolve_env_config()

    public_profiles = []
    for p in profiles_raw:
        key = str(p.get("api_key") or "").strip()
        public_profiles.append(
            {
                "id": str(p["id"]),
                "name": str(p.get("name") or "未命名配置"),
                "provider": str(p.get("provider") or "custom"),
                "base_url": str(p.get("base_url") or ""),
                "model": str(p.get("model") or ""),
                "has_api_key": bool(key),
                "api_key_masked": mask_api_key(key),
                "usable": _is_profile_usable(p),
            }
        )

    return {
        "configured": effective.configured,
        "source": effective.source,
        "active_profile_id": effective.profile_id if effective.source == "profile" else None,
        "active_summary": (
            {
                "name": effective.profile_name,
                "provider": effective.provider,
                "model": effective.model,
                "base_url": effective.base_url or "",
                "source": effective.source,
            }
            if effective.configured
            else None
        ),
        "env_detected": (
            {
                "name": env_cfg.profile_name,
                "provider": env_cfg.provider,
                "model": env_cfg.model,
                "base_url": env_cfg.base_url or "",
                "has_api_key": bool(env_cfg.api_key and env_cfg.api_key != "local-no-key"),
                "api_key_masked": (
                    mask_api_key(env_cfg.api_key)
                    if (env_cfg.api_key and env_cfg.api_key != "local-no-key")
                    else ""
                ),
            }
            if env_cfg is not None
            else None
        ),
        "profiles": public_profiles,
        "presets": PROVIDER_PRESETS,
    }


def upsert_llm_profile(
    *,
    profile_id: Optional[str] = None,
    name: str,
    provider: str,
    base_url: str = "",
    api_key: Optional[str] = None,
    clear_api_key: bool = False,
    inherit_env_key: bool = False,
    model: str,
    activate: bool = True,
) -> dict[str, Any]:
    """Create or update a saved LLM profile, preserving existing key if omitted."""
    clean_provider = provider.strip() if provider else "custom"
    if clean_provider not in _PRESET_BY_ID:
        clean_provider = "custom"
    preset = _PRESET_BY_ID[clean_provider]

    clean_model = (model or "").strip()
    if not clean_model:
        raise ValueError("请填写模型名称（例如 gpt-4o-mini、gemini-2.5-flash、deepseek-chat）。")

    clean_base = (base_url or "").strip()
    if not clean_base and preset.get("base_url"):
        clean_base = str(preset["base_url"])

    clean_name = (name or "").strip() or f"{preset['name']} · {clean_model}"
    raw = _read_raw_settings()
    profiles: list[dict[str, Any]] = list(raw.get("profiles", []))

    existing = (
        next((p for p in profiles if p.get("id") == profile_id), None)
        if profile_id
        else None
    )

    if clear_api_key:
        final_key = ""
    elif api_key is not None and api_key.strip():
        final_key = api_key.strip()
    elif existing is not None:
        final_key = str(existing.get("api_key") or "").strip()
    elif inherit_env_key:
        env_cfg = _resolve_env_config()
        final_key = (
            str(env_cfg.api_key or "").strip()
            if (env_cfg and env_cfg.api_key and env_cfg.api_key != "local-no-key")
            else ""
        )
    else:
        final_key = ""

    if preset.get("requires_api_key", True) and not final_key:
        raise ValueError(f"{preset['name']} 需要填写有效的 API Key。")
    if not preset.get("requires_api_key", True) and not clean_base and not final_key:
        raise ValueError("请填写 API Base URL（例如 http://127.0.0.1:11434/v1）。")

    target_id = str(existing["id"]) if existing else f"prof-{uuid.uuid4().hex[:8]}"
    record = {
        "id": target_id,
        "name": clean_name,
        "provider": clean_provider,
        "base_url": clean_base,
        "api_key": final_key,
        "model": clean_model,
        "updated_at": time.time(),
    }

    if existing:
        profiles = [record if p.get("id") == target_id else p for p in profiles]
    else:
        profiles.append(record)

    active_id = target_id if activate else raw.get("active_profile_id")
    _write_raw_settings({"active_profile_id": active_id, "profiles": profiles})
    return get_public_llm_settings()


def set_active_llm_profile(profile_id: Optional[str]) -> dict[str, Any]:
    """Activate a saved profile by ID, or pass None to fall back to env vars."""
    raw = _read_raw_settings()
    profiles: list[dict[str, Any]] = raw.get("profiles", [])
    if profile_id is not None:
        match = next((p for p in profiles if p.get("id") == profile_id), None)
        if match is None:
            raise KeyError(f"找不到模型配置 '{profile_id}'")
    _write_raw_settings({"active_profile_id": profile_id, "profiles": profiles})
    return get_public_llm_settings()


def delete_llm_profile(profile_id: str) -> dict[str, Any]:
    raw = _read_raw_settings()
    profiles: list[dict[str, Any]] = raw.get("profiles", [])
    remaining = [p for p in profiles if p.get("id") != profile_id]
    if len(remaining) == len(profiles):
        raise KeyError(f"找不到模型配置 '{profile_id}'")
    active_id = raw.get("active_profile_id")
    if active_id == profile_id:
        active_id = str(remaining[0]["id"]) if remaining else None
    _write_raw_settings({"active_profile_id": active_id, "profiles": remaining})
    return get_public_llm_settings()


async def test_llm_connection(
    *,
    profile_id: Optional[str] = None,
    use_env: bool = False,
    provider: str = "openai",
    base_url: str = "",
    api_key: Optional[str] = None,
    model: str = "",
) -> dict[str, Any]:
    """Send a lightweight 1-token chat completion probe to validate credentials."""
    clean_provider = provider.strip() if provider else "custom"
    preset = _PRESET_BY_ID.get(clean_provider, {})
    clean_model = (model or "").strip()
    clean_base = (base_url or "").strip() or str(preset.get("base_url") or "").strip()
    final_key = (api_key or "").strip()

    if use_env:
        env_cfg = _resolve_env_config()
        if not env_cfg:
            return {"ok": False, "error": "未检测到环境变量中的大模型配置。"}
        clean_provider = env_cfg.provider
        preset = _PRESET_BY_ID.get(clean_provider, {})
        if not clean_model:
            clean_model = env_cfg.model
        if not clean_base:
            clean_base = env_cfg.base_url or ""
        if not final_key:
            final_key = env_cfg.api_key or ""
    elif not final_key and profile_id:
        raw = _read_raw_settings()
        existing = next(
            (p for p in raw.get("profiles", []) if p.get("id") == profile_id),
            None,
        )
        if existing:
            final_key = str(existing.get("api_key") or "").strip()
            if not clean_model:
                clean_model = str(existing.get("model") or "").strip()
            if not clean_base:
                clean_base = str(existing.get("base_url") or "").strip()

    if not clean_model:
        return {"ok": False, "error": "请先填写模型名称。"}
    if preset.get("requires_api_key", True) and not final_key:
        return {"ok": False, "error": f"{preset.get('name', '该服务商')} 需要填写 API Key。"}

    effective_base = (
        None
        if (clean_provider == "openai" and clean_base == "https://api.openai.com/v1")
        else (clean_base or None)
    )
    client = AsyncOpenAI(
        api_key=final_key or "local-no-key",
        base_url=effective_base,
        max_retries=0,
        timeout=12.0,
    )
    t0 = time.monotonic()
    try:
        resp = await client.chat.completions.create(
            model=clean_model,
            messages=[{"role": "user", "content": "Reply with OK"}],
            max_tokens=8,
            temperature=0,
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        resolved_model = getattr(resp, "model", None) or clean_model
        return {
            "ok": True,
            "latency_ms": latency_ms,
            "model": resolved_model,
        }
    except Exception as exc:
        _, friendly, _ = classify_llm_error(exc, clean_model)
        return {"ok": False, "error": friendly}
    finally:
        try:
            await client.close()
        except Exception:
            pass
