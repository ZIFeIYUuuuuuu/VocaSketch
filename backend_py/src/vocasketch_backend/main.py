from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from .assets.asset_store import AssetStore
from .config import get_config
from .errors import v2_http_exception_handler, v2_validation_exception_handler
from .event_bus import JobEventBus
from .job_store import JobStore
from .providers.config import get_provider_config
from .providers.registry import create_provider_gateway
from .routes.assets import router as assets_router
from .routes.drawing_jobs import router as drawing_jobs_router
from .routes.runtime import router as runtime_router
from .workflow import MockDrawingWorkflowService
from .workflows.drawing_graph import DrawingGraphRunner


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config = get_config()
        provider_config = get_provider_config()
        store = JobStore(config)
        event_bus = JobEventBus(store)
        asset_store = AssetStore(store, config.assets_dir)
        provider_build = create_provider_gateway(provider_config)
        provider_gateway = provider_build.gateway
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
        storage_readiness = {
            "dataDir": _directory_summary(config.data_dir),
            "jobsDir": _directory_summary(config.jobs_dir),
            "assetsDir": _directory_summary(config.assets_dir),
        }

        app.state.config = config
        app.state.storage_readiness = storage_readiness
        app.state.job_store = store
        app.state.asset_store = asset_store
        app.state.provider_config = provider_config
        app.state.provider_gateway = provider_gateway
        app.state.provider_runtime_info = provider_build.runtime_info
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

    config = get_config()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(drawing_jobs_router)
    app.include_router(assets_router)
    app.include_router(runtime_router)
    app.add_exception_handler(HTTPException, v2_http_exception_handler)
    app.add_exception_handler(RequestValidationError, v2_validation_exception_handler)
    return app


app = create_app()


def _directory_summary(path: Path) -> dict[str, object]:
    return {
        "name": path.name,
        "exists": path.exists(),
        "isDirectory": path.is_dir(),
        "writable": _is_writable_directory(path),
    }


def _is_writable_directory(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    try:
        probe = path / ".startup_readiness_probe"
        with probe.open("w", encoding="utf-8") as handle:
            handle.write("ok")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False
