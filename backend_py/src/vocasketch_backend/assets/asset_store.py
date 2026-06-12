from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from ..job_store import JobStore
from ..models import AssetRecord, LayerAsset, PlaybackManifest
from ..providers.base import GeneratedAssetSpec


class AssetStore:
    def __init__(self, store: JobStore) -> None:
        self._store = store

    async def get_asset(self, asset_id: str) -> AssetRecord | None:
        return await self._store.get_asset(asset_id)

    async def create_preview_asset(self, job_id: str, spec: GeneratedAssetSpec) -> AssetRecord:
        return await self._create_asset(job_id, spec)

    async def create_final_asset(self, job_id: str, spec: GeneratedAssetSpec) -> AssetRecord:
        return await self._create_asset(job_id, spec)

    async def create_layer_asset(self, job_id: str, spec: GeneratedAssetSpec) -> LayerAsset:
        record = await self._create_asset(job_id, spec)
        return LayerAsset(
            assetId=record.assetId,
            jobId=record.jobId,
            role=record.role,
            label=spec.label,
            mimeType=record.mimeType,
            width=record.width or spec.width,
            height=record.height or spec.height,
            url=record.url,
            metadata=record.metadata,
        )

    async def save_playback_manifest(self, job_id: str, manifest: PlaybackManifest) -> AssetRecord:
        spec = GeneratedAssetSpec(
            kind="manifest",
            role="playback_manifest",
            label="Playback Manifest",
            mime_type="application/json",
            width=manifest.canvasSize.get("width", 0),
            height=manifest.canvasSize.get("height", 0),
            metadata=manifest.model_dump(mode="json"),
        )
        return await self._create_asset(job_id, spec)

    async def _create_asset(self, job_id: str, spec: GeneratedAssetSpec) -> AssetRecord:
        asset_id = self._make_asset_id()
        record = AssetRecord(
            assetId=asset_id,
            jobId=job_id,
            kind=spec.kind,
            role=spec.role,
            mimeType=spec.mime_type,
            url=f"/api/v2/assets/{asset_id}",
            width=spec.width,
            height=spec.height,
            storagePath=spec.storage_path,
            metadata=spec.metadata or {},
            createdAt=datetime.now(UTC),
        )
        await self._store.save_asset(record)
        return record

    @staticmethod
    def _make_asset_id() -> str:
        timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        return f"asset_{timestamp}_{uuid4().hex[:8]}"
