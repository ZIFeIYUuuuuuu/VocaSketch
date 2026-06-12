from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from ..job_store import InvalidIdentifierError
from ..models import (
    DrawingJob,
    DrawingJobCancelRequest,
    DrawingJobConfirmRequest,
    DrawingJobCreateRequest,
    DrawingJobCreatedEnvelope,
    DrawingJobResponse,
    DrawingJobRetryRequest,
    DrawingJobRetryResponse,
    JobStatus,
)
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
    payload["eventsUrl"] = f"/api/v2/drawing-jobs/{job.jobId}/events"
    return DrawingJobResponse.model_validate(payload)
