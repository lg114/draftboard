# Draftboard

A material-driven AI presentation workbench built on source provenance, human-in-the-loop outline review, and a deterministic PPTX layout engine.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

[English](README.md) | [简体中文](README_zh.md)

---

## Overview

Draftboard compiles raw materials (`.md`, `.txt`, `.png`, `.jpg`) into native, editable PowerPoint decks (`.pptx`) through a controlled pipeline:

```text
Materials (.md / .txt / images)
  -> Source Fragments (verifiable provenance)
  -> AI Outline Draft (with evidence tags)
  -> Human Review & Confirmation (versioned edits)
  -> Deterministic Layout & Font Measurement (fontTools)
  -> Native Editable PPTX + LibreOffice Slide Previews
```

## Key Features

- **Source Traceability**: Every AI-proposed item cites concrete `SourceFragment` records and carries an `evidence_status` (`supported` / `partial` / `unsupported`). Manually added items without citations are explicitly marked `unsupported`.
- **Human-in-the-Loop Versioning**: Outlines must be confirmed before compilation. Editing an approved outline automatically branches into a new draft without overwriting previously exported decks.
- **Deterministic Typography & Auto-Fit**: Measures actual glyph advance widths via `fontTools` with CJK/Latin line-breaking rules (Kinsoku Shori). Supports controlled font step-down (`18pt -> 16pt -> 14pt`) and fails closed on unrecoverable overflow or missing assets.
- **Themes, Rich Layouts & Speaker Notes**: Ships with 4 built-in themes (`business_slate`, `dark_tech`, `warm_editorial`, `default`), 6 slide layouts (`cover`, `content`, `bullets`, `two_column`, `text_image` with native aspect-ratio image embedding, `closing`), and PowerPoint speaker notes export.
- **Real Slide Previews & Compliance**: Renders per-page PNG previews from the exported `.pptx` via headless LibreOffice + `pypdfium2`. Apache-2.0 licensed with an automated zero-AGPL/GPL dependency gate in CI.

## Quick Start

### Prerequisites

- Python 3.11 or 3.12 with [uv](https://github.com/astral-sh/uv)
- Node.js 18+ (20+ recommended)
- LibreOffice *(optional, required for rendered slide previews)*

### 1. Configure Environment

```bash
git clone https://github.com/lg114/draftboard.git
cd draftboard
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your model provider credentials (supports OpenAI or OpenAI-compatible endpoints such as Gemini):

```env
# OpenAI
OPENAI_API_KEY=sk-...
DRAFTBOARD_MODEL=gpt-4o-mini

# Or Google AI Studio (Gemini)
# GEMINI_API_KEY=AIzaSy...
# DRAFTBOARD_MODEL=gemini-2.5-flash
```

### 2. Run the Web Workbench

Start the backend API (`http://127.0.0.1:8000`):

```bash
cd backend
uv sync
uv run draftboard serve --port 8000
```

In a second terminal, start the frontend (`http://localhost:3000`):

```bash
cd frontend
npm install
npm run dev
```

### 3. CLI Usage (Optional)

```bash
draftboard init my-demo
# Place .md / .txt / .png / .jpg files in ~/.draftboard/projects/my-demo/assets/
draftboard run "Read materials for project 'my-demo' and propose an outline"
draftboard outline my-demo v-<version>
draftboard confirm my-demo v-<version>
draftboard run "Generate slides for project 'my-demo'"
draftboard export-deck my-demo <artifact_id>
```

## Project Structure

```text
draftboard/
├── backend/
│   ├── src/draftboard/
│   │   ├── api.py          # FastAPI REST endpoints & background tasks
│   │   ├── agent.py        # OpenAI Agents SDK runner
│   │   ├── tools.py        # Material ingestion, outline, slide generation & patch tools
│   │   ├── models.py       # Pydantic v2 schemas (Outline, Slide IR, Validation)
│   │   ├── measure.py      # fontTools glyph measurement & CJK kinsoku wrapping
│   │   ├── themes.py       # Built-in presentation themes
│   │   ├── pptx_export.py  # Deterministic python-pptx exporter (images, notes, auto-fit)
│   │   └── render.py       # LibreOffice headless + pypdfium2 preview renderer
│   └── tests/              # Offline unit, API & deck regression tests
└── frontend/
    ├── app/                # Next.js App Router pages (Dashboard, Workspace, Preview)
    ├── components/         # Modular workspace UI components
    └── lib/api.ts          # Typed API client
```

## Development & Testing

```bash
# Backend offline test suite (no API key required)
cd backend
uv run pytest tests/ -m "not integration" -v

# Dependency license compliance gate (blocks AGPL/GPL/LGPL/non-commercial)
uv run python -m piplicenses \
  --fail-on "(AGPL|Affero|GNU General Public|GPLv[23]|GNU GPL|Lesser GPL|LGPL|non-commercial|NonCommercial|CC-BY-NC)"

# Frontend typecheck & production build
cd ../frontend
npx tsc --noEmit && npm run build
```

## License

Licensed under the [Apache-2.0 License](LICENSE). Third-party dependency licenses are tracked in [backend/THIRD_PARTY_LICENSES.md](backend/THIRD_PARTY_LICENSES.md).
