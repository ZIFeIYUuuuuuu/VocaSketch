from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from .config import AppConfig
from .models import AssetRecord, DrawingJob, JobEvent

SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class InvalidIdentifierError(ValueError):
    pass


def validate_safe_identifier(identifier: str) -> None:
    if not SAFE_ID_PATTERN.fullmatch(identifier):
        raise InvalidIdentifierError(f"unsafe identifier: {identifier}")


class JobStore:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._job_lock = asyncio.Lock()
        self._asset_lock = asyncio.Lock()

    async def ensure_ready(self) -> None:
        await asyncio.gather(
            asyncio.to_thread(self._config.jobs_dir.mkdir, parents=True, exist_ok=True),
            asyncio.to_thread(self._config.assets_dir.mkdir, parents=True, exist_ok=True),
        )

    async def save_job(self, job: DrawingJob) -> DrawingJob:
        async with self._job_lock:
            await asyncio.to_thread(
                self._write_json,
                self._job_path(job.jobId),
                job.model_dump(mode="json"),
            )
        return job

    async def get_job(self, job_id: str) -> DrawingJob | None:
        async with self._job_lock:
            payload = await asyncio.to_thread(self._read_json, self._job_path(job_id))
        if payload is None:
            return None
        return DrawingJob.model_validate(payload)

    async def save_asset(self, asset: AssetRecord) -> AssetRecord:
        async with self._asset_lock:
            await asyncio.to_thread(
                self._write_json,
                self._asset_path(asset.assetId),
                asset.model_dump(mode="json"),
            )
        return asset

    async def get_asset(self, asset_id: str) -> AssetRecord | None:
        async with self._asset_lock:
            payload = await asyncio.to_thread(self._read_json, self._asset_path(asset_id))
        if payload is None:
            return None
        return AssetRecord.model_validate(payload)

    async def list_events(self, job_id: str) -> list[JobEvent]:
        async with self._job_lock:
            payload = await asyncio.to_thread(self._read_json, self._event_path(job_id))
        if not payload:
            return []
        return [JobEvent.model_validate(item) for item in payload]

    async def append_event(self, event: JobEvent) -> JobEvent:
        async with self._job_lock:
            existing = await asyncio.to_thread(self._read_json, self._event_path(event.jobId))
            events = existing if isinstance(existing, list) else []
            events.append(event.model_dump(mode="json"))
            await asyncio.to_thread(self._write_json, self._event_path(event.jobId), events)
        return event

    async def list_jobs(self) -> list[DrawingJob]:
        async with self._job_lock:
            job_paths = [
                path
                for path in self._config.jobs_dir.glob("*.json")
                if not path.name.endswith(".events.json")
            ]
            payloads = await asyncio.gather(
                *(asyncio.to_thread(self._read_json, path) for path in job_paths)
            )
        jobs: list[DrawingJob] = []
        for payload in payloads:
            if payload is not None:
                jobs.append(DrawingJob.model_validate(payload))
        return jobs

    def _job_path(self, job_id: str) -> Path:
        validate_safe_identifier(job_id)
        return self._config.jobs_dir / f"{job_id}.json"

    def _event_path(self, job_id: str) -> Path:
        validate_safe_identifier(job_id)
        return self._config.jobs_dir / f"{job_id}.events.json"

    def _asset_path(self, asset_id: str) -> Path:
        validate_safe_identifier(asset_id)
        return self._config.assets_dir / f"{asset_id}.json"

    @staticmethod
    def _read_json(path: Path):
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _write_json(path: Path, payload) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
