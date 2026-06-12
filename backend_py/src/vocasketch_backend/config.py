from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_data_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "data"


@dataclass(frozen=True)
class AppConfig:
    app_name: str
    app_version: str
    host: str
    port: int
    data_dir: Path
    jobs_dir: Path
    assets_dir: Path
    workflow_step_delay_seconds: float


def get_config() -> AppConfig:
    data_dir = Path(os.getenv("VOCASKETCH_BACKEND_PY_DATA_DIR", _default_data_dir()))
    step_delay = float(os.getenv("VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS", "0.35"))

    return AppConfig(
        app_name="VocaSketch Python v2 Backend",
        app_version="0.2.0",
        host=os.getenv("VOCASKETCH_BACKEND_PY_HOST", "127.0.0.1"),
        port=int(os.getenv("VOCASKETCH_BACKEND_PY_PORT", "8000")),
        data_dir=data_dir,
        jobs_dir=data_dir / "jobs",
        assets_dir=data_dir / "assets",
        workflow_step_delay_seconds=step_delay,
    )
