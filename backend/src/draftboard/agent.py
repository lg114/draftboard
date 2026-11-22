"""
Agent definition and runner for the Draftboard workbench.
Uses the OpenAI Agents SDK (openai-agents package).
"""

import os
from typing import Any

from agents import Agent, OpenAIChatCompletionsModel, Runner
from openai import AsyncOpenAI

from draftboard.tools import (
    export_deck,
    generate_slides,
    patch_slide,
    propose_outline,
    read_materials,
    validate_artifact,
)

SYSTEM_PROMPT = """You are a presentation creation assistant for the Draftboard workbench.
Your job is to help users turn their materials (Markdown notes, documents, images) into structured, publication-grade, editable presentations.

Rules:
- Always cite source_ids when making claims about materials
- Never fabricate line numbers, numbers, metrics, or image content
- Mark evidence as 'unsupported' or 'partial' when you are not sure
- Follow the pipeline: read_materials -> propose_outline -> user confirms -> generate_slides -> validate_artifact -> export_deck
- Match the language of the source materials and project display name (if materials or project name are in Chinese, write every slide title, summary, and speaker note in natural, idiomatic Chinese unless the user explicitly asks for another language)
- Never leak internal project directory slugs/IDs (such as 'deck-xxxx-xxxx') into slide titles, subtitles, body text, or speaker notes
- Write substantive, non-generic content — NEVER use filler clichés such as "Introduction to Project ...", "Welcome to the presentation.", "Overview of ...", or restating the title verbatim as the subtitle:
  * Cover slide: distill a crisp, specific title from the actual materials; write a meaningful subtitle (core takeaway, scope, or key context — never echo the title)
  * Content slides: prefer concrete facts, key takeaways, or structured 3-4 bullet points ('bullets') or clear comparisons ('two_column') over a single vague sentence; use 'text_image' with a real uploaded image_asset_id whenever an image illustrates the slide
  * Speaker notes: provide useful talking points, transitions, or supporting detail not already printed on the slide; leave speaker_notes empty/null rather than writing generic pleasantries
- When proposing outline items, pick the most fitting layout: 'cover' (first slide), 'content', 'bullets' (newline-separated points), 'two_column' (requires column_right), 'text_image' (requires image_asset_id matching an actual uploaded image), or 'closing' (last slide)
- The outline must be confirmed by the user (via the draftboard confirm CLI command) before you generate slides; you cannot confirm it yourself
- generate_slides copies the confirmed outline verbatim; never rewrite or re-summarize confirmed content
- After generating, call validate_artifact, then export_deck
- Only report success when export_deck returns success=true with a file path; if it returns issues, relay them to the user with the slide and element IDs — never claim completion otherwise
- Only use the provided tools; do not access external URLs or run shell commands
"""


def resolve_chat_client(model: Any = None) -> tuple[AsyncOpenAI, str]:
    """Build an AsyncOpenAI client + model name from the active env config.

    Supports Google AI Studio (Gemini) via its OpenAI-compatible endpoint,
    custom OPENAI_BASE_URL gateways, and standard OpenAI keys.
    """
    gemini_key = os.environ.get("GEMINI_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("OPENAI_BASE_URL")
    explicit_model = model if isinstance(model, str) else None

    if gemini_key or (base_url and "generativelanguage.googleapis.com" in base_url):
        api_key = gemini_key or openai_key
        resolved_base = (
            base_url or "https://generativelanguage.googleapis.com/v1beta/openai/"
        )
        model_name = (
            explicit_model
            or os.environ.get("DRAFTBOARD_MODEL")
            or os.environ.get("GEMINI_MODEL")
            or "gemini-2.5-flash"
        )
        return AsyncOpenAI(api_key=api_key, base_url=resolved_base, max_retries=4), model_name

    if base_url:
        model_name = explicit_model or os.environ.get("DRAFTBOARD_MODEL", "gpt-4o-mini")
        return AsyncOpenAI(api_key=openai_key, base_url=base_url, max_retries=4), model_name

    model_name = explicit_model or os.environ.get("DRAFTBOARD_MODEL", "gpt-4o-mini")
    return AsyncOpenAI(api_key=openai_key, max_retries=4), model_name


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

    if gemini_key or base_url:
        client, model_name = resolve_chat_client(model)
        return OpenAIChatCompletionsModel(model=model_name, openai_client=client)

    return model or os.environ.get("DRAFTBOARD_MODEL", "gpt-4o-mini")


def create_agent(model: Any = None) -> Agent:
    """Create and return a configured DraftboardAgent."""
    resolved_model = resolve_model(model)
    return Agent(
        name="DraftboardAgent",
        instructions=SYSTEM_PROMPT,
        tools=[read_materials, propose_outline, generate_slides, patch_slide, validate_artifact, export_deck],
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
