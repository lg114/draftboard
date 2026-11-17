"""
Agent definition and runner for the Draftboard workbench.
Uses the OpenAI Agents SDK (openai-agents package).
"""

import os
from typing import Any

from agents import Agent, OpenAIChatCompletionsModel, Runner
from openai import AsyncOpenAI

from draftboard.tools import (
    generate_slides,
    patch_slide,
    propose_outline,
    read_materials,
    validate_artifact,
)

SYSTEM_PROMPT = """You are a presentation creation assistant for the Draftboard workbench.
Your job is to help users turn their materials (Markdown notes, images) into structured, editable presentations.

Rules:
- Always cite source_ids when making claims about materials
- Never fabricate line numbers or image content
- Mark evidence as 'unsupported' or 'partial' when you are not sure
- Outline must be confirmed by the user before you can generate slides
- Only use the provided tools; do not access external URLs or run shell commands
"""


def resolve_model(model: Any = None) -> Any:
    """Resolve model string or OpenAIChatCompletionsModel instance.

    Supports Google AI Studio (Gemini) via its OpenAI-compatible endpoint:
    https://generativelanguage.googleapis.com/v1beta/openai/
    """
    if model is not None and not isinstance(model, str):
        return model

    gemini_key = os.environ.get("GEMINI_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_URL")

    # If GEMINI_API_KEY is provided or base_url points to googleapis:
    if gemini_key or (base_url and "generativelanguage.googleapis.com" in base_url):
        api_key = gemini_key or openai_key
        base_url = base_url or "https://generativelanguage.googleapis.com/v1beta/openai/"
        model_name = (
            model
            or os.environ.get("DRAFTBOARD_MODEL")
            or os.environ.get("GEMINI_MODEL")
            or "gemini-2.5-flash"
        )
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, max_retries=5)
        return OpenAIChatCompletionsModel(model=model_name, openai_client=client)

    # Standard custom base_url
    if base_url:
        client = AsyncOpenAI(api_key=openai_key, base_url=base_url, max_retries=5)
        model_name = model or os.environ.get("DRAFTBOARD_MODEL", "gpt-4o-mini")
        return OpenAIChatCompletionsModel(model=model_name, openai_client=client)

    return model or os.environ.get("DRAFTBOARD_MODEL", "gpt-4o-mini")


def create_agent(model: Any = None) -> Agent:
    """Create and return a configured DraftboardAgent."""
    resolved_model = resolve_model(model)
    return Agent(
        name="DraftboardAgent",
        instructions=SYSTEM_PROMPT,
        tools=[read_materials, propose_outline, generate_slides, patch_slide, validate_artifact],
        model=resolved_model,
    )


async def run_agent(prompt: str, model: Any = None) -> str:
    """Run the agent with a single prompt and return the final text output.

    Automatically retries with backoff if a rate limit (429) is encountered,
    which is common when using free tier API keys.
    """
    import asyncio
    from openai import RateLimitError

    agent = create_agent(model)
    max_attempts = 4
    for attempt in range(max_attempts):
        try:
            result = await Runner.run(agent, prompt)
            return result.final_output
        except RateLimitError:
            if attempt == max_attempts - 1:
                raise
            wait_time = 12 * (attempt + 1)
            print(f"\n[RateLimit 429] Free-tier RPM window saturated. Waiting {wait_time}s before retry {attempt + 2}/{max_attempts}...")
            await asyncio.sleep(wait_time)
