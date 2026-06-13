from __future__ import annotations

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import StreamingResponse

from ..assets.asset_store import AssetContentMissingError
from ..errors import api_error, redact_text, sanitize_error_payload
from ..job_store import InvalidIdentifierError
from ..models import (
    DrawingJob,
    DrawingJobCancelRequest,
    DrawingJobConfirmRequest,
    DrawingJobCreateRequest,
    DrawingJobCreatedEnvelope,
    DrawingJobListResponse,
    DrawingJobResponse,
    DrawingJobRetryRequest,
    DrawingJobRetryResponse,
    DrawingJobSummary,
    JobError,
    JobErrorSummary,
    JobStatus,
)
from ..providers.process_playback import enrich_manifest_with_process
from ..workflow import WorkflowStateError

router = APIRouter(prefix="/api/v2/drawing-jobs", tags=["drawing-jobs"])


@router.post("", response_model=DrawingJobCreatedEnvelope, status_code=status.HTTP_202_ACCEPTED)
async def create_drawing_job(request: Request, body: DrawingJobCreateRequest) -> DrawingJobCreatedEnvelope:
    workflow = request.app.state.workflow
    store = request.app.state.job_store
    event_bus = request.app.state.event_bus

    job = DrawingJob(
        jobId=workflow.make_job_id(),
        status=JobStatus.queued,
        progressPercent=0,
        inputText=body.inputText,
        locale=body.locale,
        clientSessionId=body.clientSessionId,
        projectHint=body.projectHint,
        qualityProfile=body.qualityProfile,
        references=body.references,
        simulateFailureAt=body.simulateFailureAt,
    )
    await store.save_job(job)
    await event_bus.publish(
        job.jobId,
        "job.created",
        job.status,
        {
            "jobId": job.jobId,
            "status": job.status,
        },
    )
    await event_bus.publish(
        job.jobId,
        "job.status_changed",
        job.status,
        {
            "jobId": job.jobId,
            "status": job.status,
            "progressPercent": job.progressPercent,
            "requiresConfirmation": job.requiresConfirmation,
        },
    )
    await workflow.start_job(job.jobId)
    return DrawingJobCreatedEnvelope(
        jobId=job.jobId,
        status=job.status,
        eventsUrl=f"/api/v2/drawing-jobs/{job.jobId}/events",
    )


@router.get("", response_model=DrawingJobListResponse)
async def list_drawing_jobs(
    request: Request,
    limit: int = Query(default=10, ge=1, le=50),
    status_filter: JobStatus | None = Query(default=None, alias="status"),
) -> DrawingJobListResponse:
    store = request.app.state.job_store
    jobs = await store.list_jobs()
    if status_filter is not None:
        jobs = [job for job in jobs if job.status == status_filter]

    jobs.sort(key=lambda job: job.updatedAt, reverse=True)
    summaries = [_to_summary(job) for job in jobs[:limit]]
    return DrawingJobListResponse(items=summaries, limit=limit, status=status_filter)


@router.get("/{job_id}", response_model=DrawingJobResponse)
async def get_drawing_job(job_id: str, request: Request) -> DrawingJobResponse:
    store = request.app.state.job_store
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_JOB_ID",
            message="invalid drawing job id",
            details={"jobId": job_id},
        ) from exc
    if not job:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="JOB_NOT_FOUND",
            message="drawing job not found",
            details={"jobId": job_id},
        )
    job = await _maybe_refresh_playback_process(request, job)
    return _to_response(job)


@router.get("/{job_id}/events")
async def stream_drawing_job_events(
    job_id: str,
    request: Request,
    after_seq: str | None = Query(default=None, alias="afterSeq"),
    since_seq: str | None = Query(default=None, alias="sinceSeq"),
) -> StreamingResponse:
    store = request.app.state.job_store
    event_bus = request.app.state.event_bus
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_JOB_ID",
            message="invalid drawing job id",
            details={"jobId": job_id, "operation": "stream_events"},
        ) from exc
    if not job:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="JOB_NOT_FOUND",
            message="drawing job not found",
            details={"jobId": job_id, "operation": "stream_events"},
        )

    event_after_seq = _parse_event_after_seq(after_seq=after_seq, since_seq=since_seq)
    return StreamingResponse(
        event_bus.stream(job_id, after_seq=event_after_seq),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{job_id}/confirm", response_model=DrawingJobResponse)
async def confirm_drawing_job(job_id: str, request: Request, body: DrawingJobConfirmRequest) -> DrawingJobResponse:
    workflow = request.app.state.workflow
    store = request.app.state.job_store
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_JOB_ID",
            message="invalid drawing job id",
            details={"jobId": job_id, "operation": "confirm"},
        ) from exc
    if not job:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="JOB_NOT_FOUND",
            message="drawing job not found",
            details={"jobId": job_id, "operation": "confirm"},
        )

    try:
        job = await workflow.confirm_job(
            job_id,
            selected_preview_asset_id=body.selectedPreviewAssetId,
            notes=body.notes,
        )
    except WorkflowStateError as exc:
        raise api_error(
            status_code=status.HTTP_409_CONFLICT,
            code="WORKFLOW_STATE_CONFLICT",
            message=str(exc),
            details={"jobId": job_id, "operation": "confirm"},
        ) from exc
    return _to_response(job)


@router.post("/{job_id}/cancel", response_model=DrawingJobResponse)
async def cancel_drawing_job(job_id: str, request: Request, body: DrawingJobCancelRequest) -> DrawingJobResponse:
    workflow = request.app.state.workflow
    store = request.app.state.job_store
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_JOB_ID",
            message="invalid drawing job id",
            details={"jobId": job_id, "operation": "cancel"},
        ) from exc
    if not job:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="JOB_NOT_FOUND",
            message="drawing job not found",
            details={"jobId": job_id, "operation": "cancel"},
        )

    try:
        job = await workflow.cancel_job(job_id, body.reason)
    except WorkflowStateError as exc:
        raise api_error(
            status_code=status.HTTP_409_CONFLICT,
            code="WORKFLOW_STATE_CONFLICT",
            message=str(exc),
            details={"jobId": job_id, "operation": "cancel"},
        ) from exc
    return _to_response(job)


@router.post("/{job_id}/retry", response_model=DrawingJobRetryResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_drawing_job(job_id: str, request: Request, body: DrawingJobRetryRequest) -> DrawingJobRetryResponse:
    workflow = request.app.state.workflow
    store = request.app.state.job_store
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_JOB_ID",
            message="invalid drawing job id",
            details={"jobId": job_id, "operation": "retry"},
        ) from exc
    if not job:
        raise api_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="JOB_NOT_FOUND",
            message="drawing job not found",
            details={"jobId": job_id, "operation": "retry"},
        )

    try:
        retry_job = await workflow.retry_job(
            job_id,
            from_phase=body.fromPhase,
            reason=body.reason,
        )
    except WorkflowStateError as exc:
        raise api_error(
            status_code=status.HTTP_409_CONFLICT,
            code="WORKFLOW_STATE_CONFLICT",
            message=str(exc),
            details={"jobId": job_id, "operation": "retry"},
        ) from exc

    return DrawingJobRetryResponse(
        jobId=retry_job.jobId,
        status=retry_job.status,
        eventsUrl=f"/api/v2/drawing-jobs/{retry_job.jobId}/events",
        retryOfJobId=job_id,
    )


def _to_response(job: DrawingJob) -> DrawingJobResponse:
    payload = job.model_dump(mode="json")
    if payload.get("error"):
        payload["error"] = sanitize_error_payload(payload["error"])
    payload["eventsUrl"] = f"/api/v2/drawing-jobs/{job.jobId}/events"
    return DrawingJobResponse.model_validate(payload)


async def _maybe_refresh_playback_process(request: Request, job: DrawingJob) -> DrawingJob:
    if job.playbackManifest is None or not job.finalAssetId:
        return job

    asset_store = request.app.state.asset_store
    final_asset = await asset_store.get_asset(job.finalAssetId)
    if final_asset is None:
        return job

    preview_asset = None
    if job.previewAssetId:
        preview_asset = await asset_store.get_asset(job.previewAssetId)

    final_content_path = await _optional_asset_content_path(asset_store, job.finalAssetId)
    preview_content_path = (
        await _optional_asset_content_path(asset_store, job.previewAssetId)
        if job.previewAssetId
        else None
    )

    refreshed = enrich_manifest_with_process(
        job.playbackManifest,
        preview_asset=preview_asset,
        final_asset=final_asset,
        preview_content_path=preview_content_path,
        final_content_path=final_content_path,
    )
    if refreshed is job.playbackManifest:
        return job

    manifest_asset = await asset_store.save_playback_manifest(job.jobId, refreshed)
    updated_job = job.model_copy(
        update={
            "playbackManifest": refreshed,
            "playbackManifestAssetId": manifest_asset.assetId,
        }
    )
    await request.app.state.job_store.save_job(updated_job)
    return updated_job


async def _optional_asset_content_path(asset_store, asset_id: str | None):
    if not asset_id:
        return None
    try:
        handle = await asset_store.get_asset_content(asset_id)
    except (AssetContentMissingError, InvalidIdentifierError):
        return None
    return handle.absolute_path if handle else None


def _parse_event_after_seq(*, after_seq: str | None, since_seq: str | None) -> int:
    raw_value = after_seq if after_seq is not None else since_seq
    if raw_value is None or raw_value == "":
        return 0
    try:
        parsed = int(raw_value)
    except ValueError as exc:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_EVENT_SEQUENCE",
            message="afterSeq/sinceSeq must be a non-negative integer",
            details={"afterSeq": after_seq, "sinceSeq": since_seq},
        ) from exc
    if parsed < 0:
        raise api_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_EVENT_SEQUENCE",
            message="afterSeq/sinceSeq must be a non-negative integer",
            details={"afterSeq": after_seq, "sinceSeq": since_seq},
        )
    return parsed


def _to_summary(job: DrawingJob) -> DrawingJobSummary:
    return DrawingJobSummary(
        jobId=job.jobId,
        status=job.status,
        progressPercent=job.progressPercent,
        inputText=job.inputText,
        previewAssetId=job.previewAssetId,
        finalAssetId=job.finalAssetId,
        retryOfJobId=job.retryOfJobId,
        error=_to_error_summary(job.error),
        createdAt=job.createdAt,
        updatedAt=job.updatedAt,
        completedAt=job.completedAt,
    )


def _to_error_summary(error: JobError | None) -> JobErrorSummary | None:
    if error is None:
        return None
    return JobErrorSummary(
        code=error.code,
        phase=error.phase,
        message=redact_text(error.message),
        retryable=error.retryable,
        provider=error.provider,
    )
