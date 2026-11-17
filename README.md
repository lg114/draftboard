# Draftboard

> AI material creation workbench — M0: PPT generation with OpenAI Agents SDK

## Overview

Draftboard turns your Markdown notes and images into structured, editable presentations using an AI agent powered by the [OpenAI Agents SDK](https://github.com/openai/openai-agents-python).

**M0 goal**: Minimal viable agent experiment — verify real tool calling, structured output (Pydantic), idempotency, and application-layer validation.

## Architecture

```
backend/
├── src/draftboard/
│   ├── models.py      # Pydantic v2 data models
│   ├── storage.py     # Local JSON file storage (~/.draftboard/)
│   ├── tools.py       # @function_tool wrappers (read, outline, slides, patch, validate)
│   ├── agent.py       # Agent + Runner setup
│   └── __main__.py    # CLI entry point
└── tests/
    ├── test_models.py  # Pure Pydantic unit tests
    ├── test_storage.py # Storage roundtrip tests (tmp_path)
    ├── test_tools.py   # Tool unit tests (injected storage)
    └── test_m0.py      # Integration tests (requires OPENAI_API_KEY)
```

## Setup

```bash
cd backend

# Install with uv (recommended)
pip install uv
uv sync --dev

# Or with pip
pip install -e ".[dev]"
```

Copy `.env.example` to `.env` and fill in your API key:

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

## Usage

### Initialize a project

```bash
draftboard init my-project
# Creates ~/.draftboard/projects/my-project/assets/intro.md
```

### Run the agent

```bash
draftboard run "Read my materials for project 'my-project' and propose an outline"
draftboard run "Generate slides for project 'my-project'" --output result.json
```

## Tests

```bash
# Unit tests only (no API key required)
uv run pytest tests/ -m "not integration" -v

# All tests including integration (requires OPENAI_API_KEY)
uv run pytest tests/ -v
```

## Agent Tools

| Tool | Description |
|------|-------------|
| `read_materials` | Read `.md`/`.png`/`.jpg` from project assets, produce source fragments |
| `propose_outline` | Persist a draft outline (agent fills content, tool stores it) |
| `generate_slides` | Create a slide artifact from a confirmed outline |
| `patch_slide` | Targeted element-level edit with optimistic concurrency |
| `validate_artifact` | Check for missing titles, empty content, etc. |

## Design Principles

- **No fabrication**: Images return `[image: filename]` stubs only
- **Evidence tracking**: Every outline item carries `evidence_status`
- **Atomic writes**: All storage writes use `.tmp` → `rename`
- **Idempotency**: `generate_slides` and `patch_slide` accept idempotency keys
- **Dependency injection**: `tools._storage_root` overridable for tests
