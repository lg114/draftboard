"""Global settings, health, theme catalog, and reusable custom layout routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import draftboard.llm_config as llm_config
import draftboard.user_library as user_library
from draftboard.models import CanvasElement
from draftboard.themes import list_themes

router = APIRouter()


class LLMProfileUpsertRequest(BaseModel):
    profile_id: Optional[str] = None
    name: str = ""
    provider: str = "openai"
    base_url: str = ""
    api_key: Optional[str] = None
    clear_api_key: bool = False
    inherit_env_key: bool = False
    model: str
    models: Optional[list[str]] = None
    activate: bool = True


class LLMActiveProfileRequest(BaseModel):
    profile_id: Optional[str] = None
    model: Optional[str] = None
    models: Optional[list[str]] = None


class LLMConnectionTestRequest(BaseModel):
    profile_id: Optional[str] = None
    use_env: bool = False
    provider: str = "openai"
    base_url: str = ""
    api_key: Optional[str] = None
    model: str = ""


class LLMFetchModelsRequest(BaseModel):
    profile_id: Optional[str] = None
    use_env: bool = False
    provider: str = "openai"
    base_url: str = ""
    api_key: Optional[str] = None


class CreateSavedLayoutRequest(BaseModel):
    name: str
    description: Optional[str] = None
    custom_bg: Optional[str] = "theme:bg"
    elements: list[CanvasElement]


@router.get("/api/health")
def health_check():
    """Lightweight liveness probe (zero disk scanning)."""
    return {"status": "ok"}


@router.get("/api/themes")
def get_themes():
    return {"themes": list_themes()}


@router.get("/api/settings/llm")
def get_llm_settings():
    return llm_config.get_public_llm_settings()


@router.post("/api/settings/llm/profiles")
def save_llm_profile(req: LLMProfileUpsertRequest):
    try:
        return llm_config.upsert_llm_profile(
            profile_id=req.profile_id,
            name=req.name,
            provider=req.provider,
            base_url=req.base_url,
            api_key=req.api_key,
            clear_api_key=req.clear_api_key,
            inherit_env_key=req.inherit_env_key,
            model=req.model,
            models=req.models,
            activate=req.activate,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/settings/llm/active")
def activate_llm_profile(req: LLMActiveProfileRequest):
    try:
        return llm_config.set_active_llm_profile(
            req.profile_id,
            model=req.model,
            models=req.models,
        )
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/api/settings/llm/profiles/{profile_id}")
def remove_llm_profile(profile_id: str):
    try:
        return llm_config.delete_llm_profile(profile_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/api/settings/llm/test")
async def test_llm_settings(req: LLMConnectionTestRequest):
    return await llm_config.test_llm_connection(
        profile_id=req.profile_id,
        use_env=req.use_env,
        provider=req.provider,
        base_url=req.base_url,
        api_key=req.api_key,
        model=req.model,
    )


@router.post("/api/settings/llm/models")
async def list_provider_models(req: LLMFetchModelsRequest):
    return await llm_config.fetch_provider_models(
        profile_id=req.profile_id,
        use_env=req.use_env,
        provider=req.provider,
        base_url=req.base_url,
        api_key=req.api_key,
    )


@router.get("/api/layouts/custom")
def get_saved_layouts():
    return {"layouts": [p.model_dump() for p in user_library.list_saved_layouts()]}


@router.post("/api/layouts/custom")
def save_custom_layout(req: CreateSavedLayoutRequest):
    try:
        preset = user_library.create_saved_layout(
            name=req.name,
            elements=req.elements,
            custom_bg=req.custom_bg,
            description=req.description,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return preset.model_dump()


@router.delete("/api/layouts/custom/{layout_id}")
def remove_saved_layout(layout_id: str):
    if not user_library.delete_saved_layout(layout_id):
        raise HTTPException(404, "未找到该收藏版式")
    return {"deleted": layout_id}
