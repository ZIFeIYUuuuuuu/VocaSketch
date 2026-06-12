from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse

from ..assets.asset_store import AssetContentMissingError
from ..job_store import InvalidIdentifierError
from ..models import AssetRecord

router = APIRouter(prefix="/api/v2/assets", tags=["assets"])


@router.get("/{asset_id}/content")
async def get_asset_content(asset_id: str, request: Request) -> FileResponse:
    asset_store = request.app.state.asset_store
    try:
        handle = await asset_store.get_asset_content(asset_id)
    except InvalidIdentifierError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except AssetContentMissingError as exc:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=str(exc),
        ) from exc
    if not handle:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")
    return asset
