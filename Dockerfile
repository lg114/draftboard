# syntax=docker/dockerfile:1

# Stage 1: Build Next.js static export
FROM node:22-slim AS frontend-builder

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npx next build

# Stage 2: Build Python virtual environment and install draftboard with embedded UI
FROM python:3.12-slim-bookworm AS backend-builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/src ./src
RUN rm -rf ./src/draftboard/static
COPY --from=frontend-builder /frontend/out ./src/draftboard/static

RUN uv sync --frozen --no-dev --no-editable \
    && /app/.venv/bin/python -c "import pathlib, draftboard; p = pathlib.Path(draftboard.__file__).parent / 'static' / 'index.html'; assert p.is_file(), f'Embedded frontend missing: {p}'"

# Stage 3: Minimal runtime image with open-source TrueType Latin + CJK fonts
FROM python:3.12-slim-bookworm AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-liberation \
        fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1000 draftboard \
    && useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin draftboard \
    && mkdir -p /data/projects \
    && chown -R draftboard:draftboard /data

WORKDIR /app
COPY --from=backend-builder --chown=draftboard:draftboard /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    DRAFTBOARD_STORAGE_ROOT=/data/projects \
    DRAFTBOARD_LATIN_FONT=/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf \
    DRAFTBOARD_LATIN_BOLD_FONT=/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf \
    DRAFTBOARD_EA_FONT=/usr/share/fonts/truetype/wqy/wqy-microhei.ttc

# Verify bundled TrueType fonts work in both fontTools measurement and ReportLab PDF/PNG rendering
RUN python -c "from draftboard.measure import load_fonts; from draftboard.render import _resolve_render_fonts; load_fonts(); f = _resolve_render_fonts(); assert f.latin != 'Helvetica' and f.ea != 'STSong-Light', f"

USER draftboard
EXPOSE 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]

CMD ["draftboard", "serve", "--host", "0.0.0.0", "--port", "8000"]
