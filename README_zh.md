# Draftboard

基于材料溯源、人在回路大纲审阅与确定性排版引擎的 AI 演示文稿创作工作台。

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%20%7C%203.12-3776AB.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)

[English](README.md) | [简体中文](README_zh.md)

---

## 简介

Draftboard 将原始材料（`.md` / `.txt` / `.png` / `.jpg`）通过受控编译管线转化为原生可编辑的 PowerPoint 文稿（`.pptx`）：

```text
原始材料 (.md / .txt / 图片)
  -> 来源切片 (可追溯的 SourceFragment)
  -> AI 大纲提炼 (携带证据置信度标注)
  -> 人工审阅与确认 (版本化编辑，修改已确认版本自动派生草稿)
  -> 确定性排版与字形测量 (fontTools)
  -> 原生可编辑 PPTX + LibreOffice 真机渲染预览
```

## 核心特性

- **严格溯源与零虚构**：AI 生成的大纲与要点均绑定具体 `SourceFragment` 出处，并标注 `evidence_status`（`supported` / `partial` / `unsupported`）；人工新增且未引用材料的页面明确标为 `unsupported`。
- **人在回路版本管理**：未经人工确认的大纲禁止编译生成 PPT；修改已确认版本时自动派生新草稿，不覆盖已导出的成片。
- **确定性字形度量与受控缩字**：通过 `fontTools` 读取真实字体宽度并执行中西文禁则断行；支持受控字号阶梯自适应（`18pt -> 16pt -> 14pt`），触底仍溢出或缺图时直接阻断并报告具体页码与元素。
- **多主题、富版式与演讲者备注**：内置 4 套主题（商务澄蓝、深蓝科技、暖纸编辑、极简白纸）、6 种版式（封面、正文、分点、双栏对比、支持真实图片自适应嵌入的左文右图、尾页），并原生导出 PowerPoint 演讲者备注。
- **真机预览与开源合规**：通过 LibreOffice 无头模式 + `pypdfium2` 生成逐页 PNG 预览；采用 Apache-2.0 协议，CI 自动拦截 AGPL/GPL/LGPL 及非商业许可依赖。

## 快速开始

### 环境要求

- Python 3.11 或 3.12（推荐使用 [uv](https://github.com/astral-sh/uv)）
- Node.js 18+（推荐 20+）
- LibreOffice *（可选，用于生成逐页真机渲染预览图）*

### 1. 配置环境变量

```bash
git clone https://github.com/lg114/draftboard.git
cd draftboard
cp backend/.env.example backend/.env
```

编辑 `backend/.env` 配置模型密钥（支持 OpenAI 或 Gemini 等 OpenAI 兼容接口）：

```env
# OpenAI
OPENAI_API_KEY=sk-...
DRAFTBOARD_MODEL=gpt-4o-mini

# 或使用 Google AI Studio (Gemini)
# GEMINI_API_KEY=AIzaSy...
# DRAFTBOARD_MODEL=gemini-2.5-flash
```

### 2. 启动 Web 工作台

启动后端 API 服务（`http://127.0.0.1:8000`）：

```bash
cd backend
uv sync
uv run draftboard serve --port 8000
```

另开终端启动前端界面（`http://localhost:3000`）：

```bash
cd frontend
npm install
npm run dev
```

### 3. 命令行使用（可选）

```bash
draftboard init my-demo
# 将 .md / .txt / .png / .jpg 放入 ~/.draftboard/projects/my-demo/assets/
draftboard run "读取项目 'my-demo' 的所有材料并提炼大纲"
draftboard outline my-demo v-<version>
draftboard confirm my-demo v-<version>
draftboard run "为项目 'my-demo' 生成演示文稿"
draftboard export-deck my-demo <artifact_id>
```

## 目录结构

```text
draftboard/
├── backend/
│   ├── src/draftboard/
│   │   ├── api.py          # FastAPI REST 接口与后台任务
│   │   ├── agent.py        # OpenAI Agents SDK 运行器
│   │   ├── tools.py        # 素材读取、大纲、幻灯片生成与局部修改工具
│   │   ├── models.py       # Pydantic v2 数据模型 (Outline / Slide IR / Validation)
│   │   ├── measure.py      # fontTools 字形测量与中西文禁则断行
│   │   ├── themes.py       # 内置演示主题定义
│   │   ├── pptx_export.py  # 确定性 python-pptx 导出器 (图片、备注、自动缩字)
│   │   └── render.py       # LibreOffice + pypdfium2 预览渲染器
│   └── tests/              # 离线单元测试、API 测试与样稿回归测试
└── frontend/
    ├── app/                # Next.js App Router 页面 (项目概览、工作台、全屏预览)
    ├── components/         # 模块化工作台组件
    └── lib/api.ts          # 类型化 API 客户端
```

## 开发与测试

```bash
# 后端全量离线测试（无需 API Key）
cd backend
uv run pytest tests/ -m "not integration" -v

# 依赖许可证合规门禁（拦截 AGPL / GPL / LGPL / 非商业许可）
uv run python -m piplicenses \
  --fail-on "(AGPL|Affero|GNU General Public|GPLv[23]|GNU GPL|Lesser GPL|LGPL|non-commercial|NonCommercial|CC-BY-NC)"

# 前端类型检查与生产构建
cd ../frontend
npx tsc --noEmit && npm run build
```

## 开源协议

本项目基于 [Apache-2.0 License](LICENSE) 开源，第三方依赖许可记录见 [backend/THIRD_PARTY_LICENSES.md](backend/THIRD_PARTY_LICENSES.md)。
