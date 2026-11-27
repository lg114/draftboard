"""Studio Agent conversational chat routes (SSE streaming + persistence)."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import draftboard.chat_agent as chat_agent
from draftboard.routes.common import require_project

router = APIRouter()


class ChatMessageRequest(BaseModel):
    message: str
    selected_slide_index: int = 0
    selected_element_ids: list[str] = Field(default_factory=list)
    theme_id: str = "keynote_light"
    auto_fit: bool = True
    replace_last_error: bool = False


@router.get("/api/projects/{project_id}/chat")
def get_chat_history(project_id: str):
    require_project(project_id)
    return {
        "project_id": project_id,
        "messages": chat_agent.load_chat_history(project_id),
    }


@router.delete("/api/projects/{project_id}/chat")
def delete_chat_history(project_id: str):
    require_project(project_id)
    chat_agent.clear_chat_history(project_id)
    return {"cleared": True}


@router.post("/api/projects/{project_id}/chat")
async def post_chat_message(project_id: str, req: ChatMessageRequest):
    require_project(project_id)
    cleaned = (req.message or "").strip()
    if not cleaned:
        raise HTTPException(400, "对话内容不能为空")

    async def _event_stream():
        async for ev in chat_agent.stream_studio_chat(
            project_id,
            cleaned,
            selected_slide_index=req.selected_slide_index,
            selected_element_ids=req.selected_element_ids,
            theme_id=req.theme_id,
            auto_fit=req.auto_fit,
            replace_last_error=req.replace_last_error,
        ):
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
