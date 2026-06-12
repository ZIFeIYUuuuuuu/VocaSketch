from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from ..job_store import InvalidIdentifierError
from ..models import AssetRecord

router = APIRouter(prefix="/api/v2/assets", tags=["assets"])


@router.get("/{asset_id}", response_model=AssetRecord)
async def get_asset(asset_id: str, request: Request) -> AssetRecord:
    store = request.app.state.job_store
    try:
        asset = await store.get_asset(asset_id)
    except InvalidIdentifierError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="asset not found")
    return asset
