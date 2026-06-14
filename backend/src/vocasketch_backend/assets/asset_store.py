from __future__ import annotations

import asyncio
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from ..job_store import InvalidIdentifierError, JobStore, validate_safe_identifier
from ..models import AssetRecord, LayerAsset, PlaybackManifest
from ..providers.base import GeneratedAssetSpec


class AssetContentMissingError(FileNotFoundError):
    pass


@dataclass(frozen=True)
class AssetContentHandle:
    asset: AssetRecord
    absolute_path: Path


class AssetStore:
    def __init__(self, store: JobStore, assets_dir: Path) -> None:
        self._store = store
        self._assets_dir = assets_dir
        self._content_lock = asyncio.Lock()

    async def get_asset(self, asset_id: str) -> AssetRecord | None:
        return await self._store.get_asset(asset_id)

    async def get_asset_content(self, asset_id: str) -> AssetContentHandle | None:
        asset = await self.get_asset(asset_id)
        if asset is None:
            return None
        if not asset.storagePath:
            raise AssetContentMissingError(f"asset content is not available for {asset_id}")

        validate_safe_identifier(asset_id)
        absolute_path = self._resolve_storage_path(asset.storagePath)
        exists = await asyncio.to_thread(absolute_path.exists)
        if not exists:
            raise AssetContentMissingError(f"asset content file is missing for {asset_id}")
        return AssetContentHandle(asset=asset, absolute_path=absolute_path)

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
            contentUrl=record.contentUrl,
            byteSize=record.byteSize,
            checksum=record.checksum,
            storagePath=record.storagePath,
            order=spec.order,
            opacity=spec.opacity,
            blendMode=spec.blend_mode,
            sourceFinalAssetId=spec.source_final_asset_id,
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
            content_bytes=json.dumps(manifest.model_dump(mode="json"), ensure_ascii=False, indent=2).encode("utf-8"),
            file_extension="json",
            metadata=manifest.model_dump(mode="json"),
        )
        return await self._create_asset(job_id, spec)

    async def save_process_video(
        self,
        job_id: str,
        *,
        content_bytes: bytes,
        width: int,
        height: int,
        duration_ms: int,
        metadata: dict | None = None,
    ) -> AssetRecord:
        spec = GeneratedAssetSpec(
            kind="process_video",
            role="process_video",
            label="Drawing Process Video",
            mime_type="video/mp4",
            width=width,
            height=height,
            content_bytes=content_bytes,
            file_extension="mp4",
            metadata={
                "mode": "backend-rendered-process-video",
                "durationMs": duration_ms,
                **(metadata or {}),
            },
        )
        return await self._create_asset(job_id, spec)

    async def _create_asset(self, job_id: str, spec: GeneratedAssetSpec) -> AssetRecord:
        validate_safe_identifier(job_id)
        asset_id = self._make_asset_id()
        validate_safe_identifier(asset_id)

        content_bytes = spec.content_bytes or self._default_content_bytes(spec)
        content_url = None
        storage_path = spec.storage_path
        checksum = None
        byte_size = None

        if content_bytes is not None:
            relative_storage_path = storage_path or self._build_relative_storage_path(
                job_id=job_id,
                asset_id=asset_id,
                spec=spec,
            )
            absolute_path = self._resolve_storage_path(relative_storage_path)
            checksum = hashlib.sha256(content_bytes).hexdigest()
            byte_size = len(content_bytes)
            async with self._content_lock:
                await asyncio.to_thread(self._write_bytes_atomic, absolute_path, content_bytes)
            storage_path = relative_storage_path
            content_url = f"/api/v2/assets/{asset_id}/content"

        record = AssetRecord(
            assetId=asset_id,
            jobId=job_id,
            kind=spec.kind,
            role=spec.role,
            mimeType=spec.mime_type,
            url=f"/api/v2/assets/{asset_id}",
            contentUrl=content_url,
            byteSize=byte_size,
            checksum=checksum,
            width=spec.width,
            height=spec.height,
            storagePath=storage_path,
            metadata=spec.metadata or {},
        )
        await self._store.save_asset(record)
        return record

    def _build_relative_storage_path(self, *, job_id: str, asset_id: str, spec: GeneratedAssetSpec) -> str:
        extension = self._resolve_extension(spec)
        return f"content/{job_id}/{asset_id}.{extension}"

    def _resolve_storage_path(self, storage_path: str) -> Path:
        candidate = (self._assets_dir / storage_path).resolve()
        root = self._assets_dir.resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise InvalidIdentifierError(f"unsafe asset storage path: {storage_path}") from exc
        return candidate

    @staticmethod
    def _default_content_bytes(spec: GeneratedAssetSpec) -> bytes | None:
        if spec.mime_type == "application/json" and spec.metadata is not None:
            return json.dumps(spec.metadata, ensure_ascii=False, indent=2).encode("utf-8")
        return None

    @staticmethod
    def _resolve_extension(spec: GeneratedAssetSpec) -> str:
        if spec.file_extension:
            return spec.file_extension.lstrip(".")
        if spec.mime_type == "image/svg+xml":
            return "svg"
        if spec.mime_type == "image/png":
            return "png"
        if spec.mime_type == "image/jpeg":
            return "jpg"
        if spec.mime_type == "image/webp":
            return "webp"
        if spec.mime_type == "application/json":
            return "json"
        if spec.mime_type == "video/mp4":
            return "mp4"
        if spec.mime_type.startswith("text/"):
            return "txt"
        return "bin"

    @staticmethod
    def _write_bytes_atomic(path: Path, payload: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_name(f"{path.name}.{uuid4().hex}.tmp")
        with temp_path.open("wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)

    @staticmethod
    def _make_asset_id() -> str:
        from datetime import UTC, datetime

        timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        return f"asset_{timestamp}_{uuid4().hex[:8]}"
