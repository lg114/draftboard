"""Domain-scoped FastAPI routers for the Draftboard HTTP API."""

from draftboard.routes import (
    chat,
    demo,
    exports,
    frontend,
    materials,
    outlines,
    projects,
    settings,
)

# Order matters: `demo` before `projects` (static path before `{project_id}`),
# and `frontend` last so its root catch-all never shadows `/api/*` routes.
ALL_ROUTERS = (
    settings.router,
    demo.router,
    projects.router,
    materials.router,
    outlines.router,
    exports.router,
    chat.router,
    frontend.router,
)

__all__ = ["ALL_ROUTERS"]
