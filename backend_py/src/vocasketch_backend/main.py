from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_config
from .event_bus import JobEventBus
from .job_store import JobStore
from .routes.assets import router as assets_router
from .routes.drawing_jobs import router as drawing_jobs_router
from .workflow import MockDrawingWorkflowService


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()
    store = JobStore(config)
    event_bus = JobEventBus(store)
    workflow = MockDrawingWorkflowService(config, store, event_bus)

    await store.ensure_ready()

    app.state.config = config
    app.state.job_store = store
    app.state.event_bus = event_bus
    app.state.workflow = workflow
    await workflow.resume_pending_jobs()
    yield


app = FastAPI(
    title="VocaSketch Python v2 Backend",
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(drawing_jobs_router)
app.include_router(assets_router)
