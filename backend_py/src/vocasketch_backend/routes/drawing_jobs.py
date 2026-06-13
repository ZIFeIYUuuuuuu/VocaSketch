from __future__ import annotations

import re
from collections.abc import Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse

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
from ..workflow import WorkflowStateError

router = APIRouter(prefix="/api/v2/drawing-jobs", tags=["drawing-jobs"])

_SECRET_VALUE_PATTERN = re.compile(
    r"(?i)(api[_-]?key|token|secret|authorization|password|bearer|cookie)(\s*[:=]\s*)([^\s,;&]+)"
)
_AUTHORIZATION_BEARER_PATTERN = re.compile(r"(?i)(authorization\s*[:=]\s*)bearer\s+[^\s,;&]+")
_BEARER_PATTERN = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="drawing job not found")
    return _to_response(job)


@router.get("/{job_id}/events")
async def stream_drawing_job_events(job_id: str, request: Request) -> StreamingResponse:
    store = request.app.state.job_store
    event_bus = request.app.state.event_bus
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="drawing job not found")

    return StreamingResponse(
        event_bus.stream(job_id),
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="drawing job not found")

    try:
        job = await workflow.confirm_job(
            job_id,
            selected_preview_asset_id=body.selectedPreviewAssetId,
            notes=body.notes,
        )
    except WorkflowStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _to_response(job)


@router.post("/{job_id}/cancel", response_model=DrawingJobResponse)
async def cancel_drawing_job(job_id: str, request: Request, body: DrawingJobCancelRequest) -> DrawingJobResponse:
    workflow = request.app.state.workflow
    store = request.app.state.job_store
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="drawing job not found")

    try:
        job = await workflow.cancel_job(job_id, body.reason)
    except WorkflowStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _to_response(job)


@router.post("/{job_id}/retry", response_model=DrawingJobRetryResponse, status_code=status.HTTP_202_ACCEPTED)
async def retry_drawing_job(job_id: str, request: Request, body: DrawingJobRetryRequest) -> DrawingJobRetryResponse:
    workflow = request.app.state.workflow
    store = request.app.state.job_store
    try:
        job = await store.get_job(job_id)
    except InvalidIdentifierError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="drawing job not found")

    try:
        retry_job = await workflow.retry_job(
            job_id,
            from_phase=body.fromPhase,
            reason=body.reason,
        )
    except WorkflowStateError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return DrawingJobRetryResponse(
        jobId=retry_job.jobId,
        status=retry_job.status,
        eventsUrl=f"/api/v2/drawing-jobs/{retry_job.jobId}/events",
        retryOfJobId=job_id,
    )


def _to_response(job: DrawingJob) -> DrawingJobResponse:
    payload = job.model_dump(mode="json")
    if payload.get("error"):
        payload["error"] = _sanitize_error_payload(payload["error"])
    payload["eventsUrl"] = f"/api/v2/drawing-jobs/{job.jobId}/events"
    return DrawingJobResponse.model_validate(payload)


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
        message=_redact_text(error.message),
        retryable=error.retryable,
        provider=error.provider,
    )


def _redact_text(value: str) -> str:
    redacted = _AUTHORIZATION_BEARER_PATTERN.sub(r"\1Bearer ***", value)
    redacted = _SECRET_VALUE_PATTERN.sub(r"\1\2***", redacted)
    redacted = _BEARER_PATTERN.sub("Bearer ***", redacted)
    return re.sub(r"https?://[^\s,]+", lambda match: _redact_url(match.group(0)), redacted)


def _redact_url(value: str) -> str:
    parts = urlsplit(value)
    if not parts.query:
        return value
    redacted_query = urlencode([(key, "***") for key, _ in parse_qsl(parts.query, keep_blank_values=True)])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, redacted_query, ""))


def _sanitize_error_payload(error_payload: dict) -> dict:
    sanitized = dict(error_payload)
    if isinstance(sanitized.get("message"), str):
        sanitized["message"] = _redact_text(sanitized["message"])
    if isinstance(sanitized.get("provider"), str):
        sanitized["provider"] = _redact_text(sanitized["provider"])
    sanitized["details"] = _sanitize_error_value(sanitized.get("details", {}), parent_key="details")
    return sanitized


def _sanitize_error_value(value: object, *, parent_key: str) -> object:
    if _is_sensitive_key(parent_key):
        return "***"
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, Mapping):
        sanitized: dict[str, object] = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key)
            sanitized[key] = _sanitize_error_value(raw_value, parent_key=key)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_error_value(item, parent_key=parent_key) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_error_value(item, parent_key=parent_key) for item in value]
    return value


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(
        token in lowered
        for token in (
            "key",
            "token",
            "secret",
            "authorization",
            "password",
            "bearer",
            "cookie",
        )
    )
