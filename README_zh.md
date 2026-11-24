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
# 后端本地开发服务与测试（在 backend/ 目录下）
uv sync
uv run draftboard serve --reload              # http://127.0.0.1:8000（支持热重载）
uv run pytest tests/ -m "not integration" -v  # 仅离线单测（跳过真实大模型 API 集成测试；去掉 -m 可跑全量）

# 前端热重载开发与静态产物同步（在 frontend/ 目录下）
npm install
npm run dev      # http://localhost:3000（自动代理 /api/* 到 :8000）
npm run build    # 构建并自动同步前端产物到 backend/src/draftboard/static/
```

重新编译只有在冻结后的输入一致时才复用上一份 PPTX：大纲内容、主题、品牌、自动缩字、该文稿实际引用的图片字节，以及导出规则版本。改品牌或替换同名图片会生成新文件；没被引用的素材变化不会。工作台通过 `GET /api/projects/{id}/generation-sync` 使用同一套指纹判断是否与当前导出同步，而不是只比较大纲版本、主题和自动缩字。

## 开源协议

[Apache-2.0](LICENSE)
