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
        "id": "gemini",
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-2.5-flash",
        "requires_api_key": True,
        "suggested_models": [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.5-flash-lite",
        ],
        "api_key_url": "https://aistudio.google.com/apikey",
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4.1-mini",
        "requires_api_key": True,
        "suggested_models": ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
        "api_key_url": "https://platform.openai.com/api-keys",
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
        "requires_api_key": True,
        "suggested_models": ["deepseek-chat", "deepseek-reasoner"],
        "api_key_url": "https://platform.deepseek.com/api_keys",
    },
    {
        "id": "siliconflow",
        "name": "硅基流动",
        "base_url": "https://api.siliconflow.cn/v1",
        "default_model": "deepseek-ai/DeepSeek-V3",
        "requires_api_key": True,
        "suggested_models": [
            "deepseek-ai/DeepSeek-V3",
            "deepseek-ai/DeepSeek-R1",
            "Qwen/Qwen2.5-72B-Instruct",
        ],
        "api_key_url": "https://cloud.siliconflow.cn/account/ak",
    },
    {
        "id": "qwen",
        "name": "阿里云百炼",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus",
        "requires_api_key": True,
        "suggested_models": ["qwen-plus", "qwen-max", "qwen-turbo"],
        "api_key_url": "https://bailian.console.aliyun.com/?apiKey=1",
    },
    {
        "id": "kimi",
        "name": "月之暗面 Kimi",
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "kimi-k2-0711-preview",
        "requires_api_key": True,
        "suggested_models": [
            "kimi-k2-0711-preview",
            "moonshot-v1-32k",
            "moonshot-v1-128k",
        ],
        "api_key_url": "https://platform.moonshot.cn/console/api-keys",
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "anthropic/claude-3.7-sonnet",
        "requires_api_key": True,
        "suggested_models": [
            "anthropic/claude-3.7-sonnet",
            "google/gemini-2.5-pro",
            "openai/gpt-4.1-mini",
        ],
        "api_key_url": "https://openrouter.ai/keys",
    },
    {
        "id": "ollama",
        "name": "本地 Ollama",
        "base_url": "http://127.0.0.1:11434/v1",
        "default_model": "qwen2.5:14b",
        "requires_api_key": False,
        "suggested_models": ["qwen2.5:14b", "llama3.1:8b", "deepseek-r1:14b"],
        "api_key_url": "",
    },
    {
        "id": "custom",
        "name": "自定义兼容接口",
        "base_url": "",
        "default_model": "",
        "requires_api_key": False,
        "suggested_models": [],
        "api_key_url": "",
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


def _dedupe_models(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in items:
        m = str(raw or "").strip()
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def _read_raw_settings() -> dict[str, Any]:
    path = _settings_path()
    if not path.exists():
        return {
            "active_profile_id": None,
            "profiles": [],
            "env_model": None,
            "env_models": [],
        }
    try:
        data = load_json(path)
        if isinstance(data, dict):
            profiles = data.get("profiles")
            if not isinstance(profiles, list):
                profiles = []
            env_models = data.get("env_models")
            if not isinstance(env_models, list):
                env_models = []
            env_model = str(data.get("env_model") or "").strip() or None
            return {
                "active_profile_id": data.get("active_profile_id"),
                "profiles": [p for p in profiles if isinstance(p, dict) and p.get("id")],
                "env_model": env_model,
                "env_models": _dedupe_models([str(x) for x in env_models]),
            }
    except Exception:
        pass
    return {
        "active_profile_id": None,
        "profiles": [],
        "env_model": None,
        "env_models": [],
    }


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


def _infer_provider_from_url(base_url: str) -> str:
    low = base_url.lower()
    if "generativelanguage.googleapis.com" in low:
        return "gemini"
    if "api.deepseek.com" in low:
        return "deepseek"
    if "siliconflow.cn" in low:
        return "siliconflow"
    if "dashscope.aliyuncs.com" in low:
        return "qwen"
    if "api.moonshot.cn" in low:
        return "kimi"
    if "openrouter.ai" in low:
        return "openrouter"
    if "api.openai.com" in low:
        return "openai"
    if any(h in low for h in ("127.0.0.1", "localhost", "0.0.0.0")):
        return "ollama"
    return "custom"


def _resolve_env_config(env_model_override: Optional[str] = None) -> Optional[EffectiveLLMConfig]:
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
        raw_model = (
            os.environ.get("DRAFTBOARD_MODEL")
            or os.environ.get("GEMINI_MODEL")
            or "gemini-2.5-flash"
        ).strip()
        model_name = (env_model_override or "").strip() or raw_model
        return EffectiveLLMConfig(
            configured=True,
            source="env",
            profile_id=None,
            profile_name="Google Gemini",
            provider="gemini",
            base_url=resolved_base,
            api_key=key,
            model=model_name,
        )

    if base_url:
        inferred = _infer_provider_from_url(base_url)
        is_local = inferred == "ollama"
        if not openai_key and not is_local:
            return None
        preset = _PRESET_BY_ID.get(inferred, {})
        raw_model = (
            os.environ.get("DRAFTBOARD_MODEL")
            or str(preset.get("default_model") or "gpt-4.1-mini")
        ).strip()
        model_name = (env_model_override or "").strip() or raw_model
        disp_name = str(preset.get("name") or "环境变量默认接口")
        return EffectiveLLMConfig(
            configured=True,
            source="env",
            profile_id=None,
            profile_name=disp_name,
            provider=inferred,
            base_url=base_url,
            api_key=openai_key or "local-no-key",
            model=model_name,
        )

    if openai_key:
        raw_model = (os.environ.get("DRAFTBOARD_MODEL") or "gpt-4.1-mini").strip()
        model_name = (env_model_override or "").strip() or raw_model
        return EffectiveLLMConfig(
            configured=True,
            source="env",
            profile_id=None,
            profile_name="OpenAI",
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

    env_cfg = _resolve_env_config(env_model_override=raw.get("env_model"))
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
    raw_env_cfg = _resolve_env_config(env_model_override=None)
    eff_env_cfg = _resolve_env_config(env_model_override=raw.get("env_model"))

    public_profiles = []
    for p in profiles_raw:
        key = str(p.get("api_key") or "").strip()
        prov = str(p.get("provider") or "custom")
        cur_m = str(p.get("model") or "").strip()
        saved_ms = p.get("models")
        if isinstance(saved_ms, list) and len(saved_ms) > 0:
            pool = _dedupe_models([cur_m, *[str(x) for x in saved_ms]])
        else:
            preset_ms = _PRESET_BY_ID.get(prov, {}).get("suggested_models", [])
            pool = _dedupe_models([cur_m, *preset_ms])
        public_profiles.append(
            {
                "id": str(p["id"]),
                "name": str(p.get("name") or "未命名配置"),
                "provider": prov,
                "base_url": str(p.get("base_url") or ""),
                "model": cur_m,
                "models": pool,
                "has_api_key": bool(key),
                "api_key_masked": mask_api_key(key),
                "usable": _is_profile_usable(p),
            }
        )

    env_payload = None
    if eff_env_cfg is not None and raw_env_cfg is not None:
        preset_ms = _PRESET_BY_ID.get(eff_env_cfg.provider, {}).get("suggested_models", [])
        saved_env_ms = raw.get("env_models") or []
        env_pool = (
            _dedupe_models([eff_env_cfg.model, raw_env_cfg.model, *saved_env_ms])
            if saved_env_ms
            else _dedupe_models([eff_env_cfg.model, raw_env_cfg.model, *preset_ms])
        )
        env_payload = {
            "name": eff_env_cfg.profile_name,
            "provider": eff_env_cfg.provider,
            "model": eff_env_cfg.model,
            "default_env_model": raw_env_cfg.model,
            "models": env_pool,
            "base_url": eff_env_cfg.base_url or "",
            "has_api_key": bool(
                eff_env_cfg.api_key and eff_env_cfg.api_key != "local-no-key"
            ),
            "api_key_masked": (
                mask_api_key(eff_env_cfg.api_key)
                if (eff_env_cfg.api_key and eff_env_cfg.api_key != "local-no-key")
                else ""
            ),
        }

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
        "env_detected": env_payload,
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
    models: Optional[list[str]] = None,
    activate: bool = True,
) -> dict[str, Any]:
    """Create or update a saved LLM profile, preserving existing key if omitted."""
    clean_provider = provider.strip() if provider else "custom"
    if clean_provider not in _PRESET_BY_ID:
        clean_provider = "custom"
    preset = _PRESET_BY_ID[clean_provider]

    clean_model = (model or "").strip()
    if not clean_model:
        raise ValueError("请填写模型名称（例如 gpt-4.1-mini、gemini-2.5-flash、deepseek-chat）。")

    clean_base = (base_url or "").strip()
    if not clean_base and preset.get("base_url"):
        clean_base = str(preset["base_url"])

    clean_name = (name or "").strip() or str(preset["name"])
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
    elif existing is not None and str(existing.get("api_key") or "").strip():
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
        raise ValueError("请填写接口地址（例如 http://127.0.0.1:11434/v1）。")

    if models is not None:
        final_models = _dedupe_models([clean_model, *models])
    elif existing and isinstance(existing.get("models"), list):
        final_models = _dedupe_models([clean_model, *[str(x) for x in existing["models"]]])
    else:
        final_models = _dedupe_models([clean_model, *preset.get("suggested_models", [])])

    target_id = str(existing["id"]) if existing else f"prof-{uuid.uuid4().hex[:8]}"
    record = {
        "id": target_id,
        "name": clean_name,
        "provider": clean_provider,
        "base_url": clean_base,
        "api_key": final_key,
        "model": clean_model,
        "models": final_models,
        "updated_at": time.time(),
    }

    if existing:
        profiles = [record if p.get("id") == target_id else p for p in profiles]
    else:
        profiles.append(record)

    active_id = target_id if activate else raw.get("active_profile_id")
    _write_raw_settings(
        {
            "active_profile_id": active_id,
            "profiles": profiles,
            "env_model": raw.get("env_model"),
            "env_models": raw.get("env_models", []),
        }
    )
    return get_public_llm_settings()


def set_active_llm_profile(
    profile_id: Optional[str],
    model: Optional[str] = None,
    models: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Activate a saved profile (or env fallback when None) and optionally switch model / model pool."""
    raw = _read_raw_settings()
    profiles: list[dict[str, Any]] = list(raw.get("profiles", []))
    env_model = raw.get("env_model")
    env_models = list(raw.get("env_models") or [])
    clean_model = (model or "").strip() or None

    if profile_id is not None:
        match = next((p for p in profiles if p.get("id") == profile_id), None)
        if match is None:
            raise KeyError(f"找不到模型配置 '{profile_id}'")
        if clean_model or models is not None:
            updated = dict(match)
            target_m = clean_model or str(updated.get("model") or "").strip()
            if clean_model:
                updated["model"] = clean_model
            if models is not None:
                updated["models"] = _dedupe_models([target_m, *models])
            else:
                prev_ms = updated.get("models") if isinstance(updated.get("models"), list) else []
                updated["models"] = _dedupe_models([target_m, *[str(x) for x in prev_ms]])
            profiles = [updated if p.get("id") == profile_id else p for p in profiles]
    else:
        if clean_model:
            env_model = clean_model
        if models is not None:
            env_models = _dedupe_models(([env_model] if env_model else []) + list(models))
        elif clean_model:
            raw_env = _resolve_env_config(env_model_override=None)
            preset_ms = (
                _PRESET_BY_ID.get(raw_env.provider, {}).get("suggested_models", [])
                if raw_env
                else []
            )
            base_pool = env_models if env_models else (([raw_env.model] if raw_env else []) + list(preset_ms))
            env_models = _dedupe_models([clean_model, *base_pool])

    _write_raw_settings(
        {
            "active_profile_id": profile_id,
            "profiles": profiles,
            "env_model": env_model,
            "env_models": env_models,
        }
    )
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
    _write_raw_settings(
        {
            "active_profile_id": active_id,
            "profiles": remaining,
            "env_model": raw.get("env_model"),
            "env_models": raw.get("env_models", []),
        }
    )
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


_NON_CHAT_MODEL_FRAGMENTS = (
    "embedding",
    "tts-",
    "whisper",
    "moderation",
    "dall-e",
    "imagen",
    "veo-",
    "aqa",
    "babbage",
    "davinci",
    "rerank",
)


async def fetch_provider_models(
    *,
    profile_id: Optional[str] = None,
    use_env: bool = False,
    provider: str = "openai",
    base_url: str = "",
    api_key: Optional[str] = None,
) -> dict[str, Any]:
    """Fetch available chat model IDs from an OpenAI-compatible /models endpoint."""
    clean_provider = provider.strip() if provider else "custom"
    preset = _PRESET_BY_ID.get(clean_provider, {})
    clean_base = (base_url or "").strip() or str(preset.get("base_url") or "").strip()
    final_key = (api_key or "").strip()

    if use_env:
        env_cfg = _resolve_env_config()
        if not env_cfg:
            return {"ok": False, "error": "未检测到环境变量中的大模型凭证。", "models": []}
        clean_provider = env_cfg.provider
        preset = _PRESET_BY_ID.get(clean_provider, {})
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
            if not clean_base:
                clean_base = str(existing.get("base_url") or "").strip()

    if preset.get("requires_api_key", True) and not final_key:
        return {
            "ok": False,
            "error": f"请先填写 {preset.get('name', '该服务商')} 的 API Key 后再拉取模型列表。",
            "models": [],
        }

    effective_base = (
        None
        if (clean_provider == "openai" and clean_base == "https://api.openai.com/v1")
        else (clean_base or None)
    )
    client = AsyncOpenAI(
        api_key=final_key or "local-no-key",
        base_url=effective_base,
        max_retries=0,
        timeout=10.0,
    )
    try:
        page = await client.models.list()
        raw_ids: list[str] = []
        for item in getattr(page, "data", []) or []:
            mid = str(getattr(item, "id", "") or "").strip()
            if not mid:
                continue
            if clean_provider == "gemini" and mid.startswith("models/"):
                mid = mid[len("models/") :]
            low = mid.lower()
            if any(frag in low for frag in _NON_CHAT_MODEL_FRAGMENTS):
                continue
            raw_ids.append(mid)
        models = sorted(_dedupe_models(raw_ids))
        if not models:
            return {"ok": False, "error": "接口返回成功，但未发现可用的对话模型。", "models": []}
        return {"ok": True, "models": models}
    except Exception as exc:
        _, friendly, _ = classify_llm_error(exc, "")
        return {"ok": False, "error": friendly, "models": []}
    finally:
        try:
            await client.close()
        except Exception:
            pass
