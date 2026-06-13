from __future__ import annotations

from fastapi import APIRouter, Request, status
from fastapi.responses import FileResponse

from ..assets.asset_store import AssetContentMissingError
from ..errors import api_error
from ..job_store import InvalidIdentifierError
from ..models import AssetRecord

router = APIRouter(prefix="/api/v2/assets", tags=["assets"])


@router.get("/{asset_id}/content")
async def get_asset_content(asset_id: str, request: Request) -> FileResponse:
    asset_store = request.app.state.asset_store
    try:
        handle = await asset_store.get_asset_content(asset_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_ASSET_ID",
            message="invalid asset id",
            details={"assetId": asset_id, "operation": "get_asset_content"},
        ) from exc
    except AssetContentMissingError as exc:
        raise api_error(
            status_code=status.HTTP_410_GONE,
            code="ASSET_CONTENT_MISSING",
            message=str(exc),
            details={"assetId": asset_id},
        ) from exc
    if not handle:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ASSET_NOT_FOUND",
            message="asset not found",
            details={"assetId": asset_id, "operation": "get_asset_content"},
        )

    return FileResponse(
        path=handle.absolute_path,
        media_type=handle.asset.mimeType,
    )


@router.get("/{asset_id}", response_model=AssetRecord)
async def get_asset(asset_id: str, request: Request) -> AssetRecord:
    asset_store = request.app.state.asset_store
    try:
        asset = await asset_store.get_asset(asset_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_ASSET_ID",
            message="invalid asset id",
            details={"assetId": asset_id, "operation": "get_asset"},
        ) from exc
    if not asset:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ASSET_NOT_FOUND",
            message="asset not found",
            details={"assetId": asset_id, "operation": "get_asset"},
        )
    return asset
