"""
FastAPI interface over the existing Draftboard pipeline.

Every endpoint calls the same tool/storage/export functions the CLI and
agent use — there is no second generation path here. Long work (model
outline generation, slide generation + export) runs as persisted tasks.

Route handlers live under ``draftboard.routes`` grouped by domain; this
module wires lifespan, exception handlers, and router registration.
"""

from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse

import draftboard.tasks as tasks
from draftboard.routes import ALL_ROUTERS
from draftboard.routes.common import get_root
from draftboard.storage import STORAGE_ROOT

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks.sweep_interrupted(get_root())
    yield


app = FastAPI(title="Draftboard API", lifespan=lifespan)


@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(KeyError)
async def key_error_handler(request, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(tasks.TaskConflictError)
async def conflict_handler(request, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


for _router in ALL_ROUTERS:
    app.include_router(_router)

__all__ = ["STORAGE_ROOT", "app", "lifespan"]
