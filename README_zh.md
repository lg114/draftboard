# Draftboard

基于材料溯源、人在回路大纲审阅与确定性排版引擎的 AI 演示文稿创作工作台。

[![PyPI](https://img.shields.io/pypi/v/draftboard.svg)](https://pypi.org/project/draftboard/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

[English](README.md) | [简体中文](README_zh.md)

---

## 安装与启动

### Python

```bash
# 使用 uv 直接运行
uvx --python 3.12 draftboard@latest serve

# 或使用 pip 安装后启动（Python 3.12）
pip install draftboard
draftboard serve
```

启动后打开 [http://127.0.0.1:8000](http://127.0.0.1:8000)。

> 在环境变量或 `.env` 中配置 `OPENAI_API_KEY` / `GEMINI_API_KEY`（参考 `backend/.env.example`）。

## 开发与测试

```bash
# 后端本地开发服务与离线测试（在 backend/ 目录下）
uv sync
.venv/bin/draftboard serve --reload                       # macOS / Linux
.\.venv\Scripts\draftboard.exe serve --reload             # Windows

.venv/bin/pytest tests/ -m "not integration" -v           # macOS / Linux
.\.venv\Scripts\pytest.exe tests/ -m "not integration" -v # Windows

# 前端热重载开发与静态产物同步（在 frontend/ 目录下）
npm install
npm run dev      # http://localhost:3000（自动代理 /api/* 到 :8000）
npm run build    # 构建并自动同步前端产物到 backend/src/draftboard/static/
```

## 开源协议

[Apache-2.0](LICENSE)
