from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .assets.asset_store import AssetStore
from .config import get_config
from .event_bus import JobEventBus
from .job_store import JobStore
from .providers.mock import MockProviderGateway
from .routes.assets import router as assets_router
from .routes.drawing_jobs import router as drawing_jobs_router
from .workflow import MockDrawingWorkflowService
from .workflows.drawing_graph import DrawingGraphRunner


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config = get_config()
        store = JobStore(config)
        event_bus = JobEventBus(store)
        asset_store = AssetStore(store)
        provider_gateway = MockProviderGateway()
        drawing_graph = DrawingGraphRunner(
            provider_gateway,
            asset_store,
            enable_langgraph=not config.disable_langgraph,
        )
        workflow = MockDrawingWorkflowService(
            store=store,
            event_bus=event_bus,
            drawing_graph=drawing_graph,
            step_delay_seconds=config.workflow_step_delay_seconds,
        )

        await store.ensure_ready()

        app.state.config = config
        app.state.job_store = store
        app.state.asset_store = asset_store
        app.state.provider_gateway = provider_gateway
        app.state.drawing_graph = drawing_graph
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
    return app


app = create_app()
