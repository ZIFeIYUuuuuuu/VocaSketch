from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _getenv_first(default: str | Path, *names: str) -> str | Path:
    for name in names:
        if name in os.environ:
            return os.environ[name]
    return default


def _default_data_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "data"


@dataclass(frozen=True)
class AppConfig:
    app_name: str
    app_version: str
    host: str
    port: int
    cors_origins: tuple[str, ...]
    data_dir: Path
    jobs_dir: Path
    assets_dir: Path
    workflow_step_delay_seconds: float
    disable_langgraph: bool


def get_config() -> AppConfig:
    data_dir = Path(
        _getenv_first(
            _default_data_dir(),
            "VOCASKETCH_BACKEND_DATA_DIR",
            "VOCASKETCH_BACKEND_PY_DATA_DIR",
            "VOCASKETCH_DATA_DIR",
        )
    )
    step_delay = float(os.getenv("VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS", "0.35"))
    disable_langgraph = os.getenv("VOCASKETCH_DISABLE_LANGGRAPH", "0").strip().lower() in {"1", "true", "yes", "on"}
    cors_origins = tuple(
        origin.strip()
        for origin in os.getenv(
            "VOCASKETCH_CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if origin.strip()
    )

    return AppConfig(
        app_name="VocaSketch Python v2 Backend",
        app_version="0.2.0",
        host=str(_getenv_first("127.0.0.1", "VOCASKETCH_BACKEND_HOST", "VOCASKETCH_BACKEND_PY_HOST")),
        port=int(str(_getenv_first("8000", "VOCASKETCH_BACKEND_PORT", "VOCASKETCH_BACKEND_PY_PORT"))),
        cors_origins=cors_origins,
        data_dir=data_dir,
        jobs_dir=data_dir / "jobs",
        assets_dir=data_dir / "assets",
        workflow_step_delay_seconds=step_delay,
        disable_langgraph=disable_langgraph,
    )
