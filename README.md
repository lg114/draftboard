# Draftboard

A material-driven AI presentation workbench built on source provenance, human-in-the-loop outline review, and a deterministic PPTX layout engine.

[![PyPI](https://img.shields.io/pypi/v/draftboard.svg)](https://pypi.org/project/draftboard/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Python 3.11+](<https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB.svg>)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

[English](README.md) | [简体中文](README_zh.md)

---

## Installation

### Python

```bash
# With uv installed
uvx --python 3.12 draftboard@latest serve

# Or install and run with pip (Python 3.12)
pip install draftboard
draftboard serve
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

> Set `OPENAI_API_KEY` or `GEMINI_API_KEY` as an environment variable or in `.env` (see `backend/.env.example`).

## Development & Testing

```bash
# Backend local dev server & tests (inside backend/)
uv sync
uv run draftboard serve --reload              # http://127.0.0.1:8000 (auto-reload)
uv run pytest tests/ -m "not integration" -v  # offline tests only (skips live LLM API tests; omit -m to run all)

# Frontend hot-reload dev & static bundle sync (inside frontend/)
npm install
npm run dev      # http://localhost:3000 (proxies /api/* to :8000)
npm run build    # exports & embeds UI into backend/src/draftboard/static/
```

## License

[Apache-2.0](LICENSE)
