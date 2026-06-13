from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from .errors import sanitize_error_payload
from .event_bus import JobEventBus
from .job_store import JobStore
from .models import DrawingJob, JobError, JobStatus, TERMINAL_JOB_STATUSES, utc_now
from .providers.base import ProviderError, ProviderSchemaError, ProviderTimeoutError, WorkflowNodeError
from .workflows.drawing_graph import DrawingGraphRunner
from .workflows.state import DrawingWorkflowState


class WorkflowStateError(RuntimeError):
    pass


class MockDrawingWorkflowService:
    def __init__(
        self,
        store: JobStore,
        event_bus: JobEventBus,
        drawing_graph: DrawingGraphRunner,
        step_delay_seconds: float,
        *,
        enable_post_preview_precompute: bool = False,
    ) -> None:
        self._store = store
        self._event_bus = event_bus
        self._drawing_graph = drawing_graph
        self._step_delay_seconds = step_delay_seconds
        self._enable_post_preview_precompute = enable_post_preview_precompute
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._post_preview_tasks: dict[str, asyncio.Task[None]] = {}
        self._confirm_events: dict[str, asyncio.Event] = {}

    async def start_job(self, job_id: str) -> None:
        if job_id in self._tasks and not self._tasks[job_id].done():
            return

        task = asyncio.create_task(self._run(job_id), name=f"drawing-job:{job_id}")
        self._tasks[job_id] = task
        task.add_done_callback(lambda _: self._tasks.pop(job_id, None))

    async def resume_pending_jobs(self) -> None:
        jobs = await self._store.list_jobs()
        for job in jobs:
            if job.status in TERMINAL_JOB_STATUSES:
                continue
            if job.status == JobStatus.preview_ready and job.requiresConfirmation:
                self._schedule_post_preview_precompute(job.jobId)
                continue
            await self.start_job(job.jobId)

    async def shutdown(self) -> None:
        tasks = [
            task
            for task in [*self._tasks.values(), *self._post_preview_tasks.values()]
            if not task.done()
        ]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._post_preview_tasks.clear()

    async def confirm_job(
        self,
        job_id: str,
        *,
        selected_preview_asset_id: str | None = None,
        notes: str | None = None,
    ) -> DrawingJob:
        job = await self._require_job(job_id)
        if job.status != JobStatus.preview_ready or not job.requiresConfirmation:
            raise WorkflowStateError("job is not waiting for preview confirmation")

        job.requiresConfirmation = False
        job.updatedAt = utc_now()
        await self._store.save_job(job)
        await self._event_bus.publish(
            job_id,
            "job.confirmed",
            job.status,
            {
                "jobId": job.jobId,
                "previewAssetId": selected_preview_asset_id or job.previewAssetId,
                "notes": notes,
            },
        )

        if not self._has_active_task(job_id):
            await self.start_job(job_id)

        self._confirm_events.setdefault(job_id, asyncio.Event()).set()
        return job

    async def cancel_job(self, job_id: str, reason: str | None = None) -> DrawingJob:
        job = await self._require_job(job_id)
        if job.status in TERMINAL_JOB_STATUSES:
            raise WorkflowStateError("job is already in a terminal state")

        job.status = JobStatus.cancelled
        job.requiresConfirmation = False
        job.updatedAt = utc_now()
        job.completedAt = utc_now()
        await self._store.save_job(job)
        await self._event_bus.publish(
            job_id,
            "job.status_changed",
            job.status,
            {
                "jobId": job.jobId,
                "status": job.status,
                "progressPercent": job.progressPercent,
            },
        )
        await self._event_bus.publish(
            job_id,
            "job.cancelled",
            job.status,
            {
                "jobId": job.jobId,
                "reason": reason,
            },
        )

        self._confirm_events.setdefault(job_id, asyncio.Event()).set()
        task = self._tasks.get(job_id)
        if task and not task.done():
            task.cancel()
        post_preview_task = self._post_preview_tasks.get(job_id)
        if post_preview_task and not post_preview_task.done():
            post_preview_task.cancel()
        return job

    async def retry_job(
        self,
        source_job_id: str,
        *,
        from_phase: JobStatus | None = None,
        reason: str | None = None,
    ) -> DrawingJob:
        source_job = await self._require_job(source_job_id)
        if source_job.status != JobStatus.failed:
            raise WorkflowStateError("only failed jobs can be retried")

        now = utc_now()
        retry_job = DrawingJob(
            jobId=self.make_job_id(),
            status=JobStatus.queued,
            progressPercent=0,
            inputText=source_job.inputText,
            locale=source_job.locale,
            clientSessionId=source_job.clientSessionId,
            projectHint=source_job.projectHint,
            qualityProfile=source_job.qualityProfile,
            references=source_job.references,
            retryOfJobId=source_job.jobId,
            createdAt=now,
            updatedAt=now,
            simulateFailureAt=None,
        )
        await self._store.save_job(retry_job)
        await self._event_bus.publish(
            retry_job.jobId,
            "job.created",
            retry_job.status,
            {
                "jobId": retry_job.jobId,
                "retryOfJobId": source_job.jobId,
                "fromPhase": from_phase,
                "reason": reason,
                "note": "Retry restarts the current mock workflow from queued.",
            },
        )
        await self._event_bus.publish(
            retry_job.jobId,
            "job.status_changed",
            retry_job.status,
            {
                "jobId": retry_job.jobId,
                "status": retry_job.status,
                "progressPercent": retry_job.progressPercent,
                "fromPhase": from_phase,
                "reason": reason,
            },
        )
        await self.start_job(retry_job.jobId)
        return retry_job

    async def _run(self, job_id: str) -> None:
        try:
            await self._run_from_current_status(job_id)
        except asyncio.CancelledError:
            existing = await self._store.get_job(job_id)
            if existing and existing.status == JobStatus.cancelled:
                return
            raise
        except Exception as exc:
            await self._mark_failed(job_id, exc)

    async def _run_from_current_status(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        state = await self._drawing_graph.load_state(job)

        # We intentionally keep node-by-node progression in the service layer so
        # status transitions and user-visible SSE milestones remain stable. The
        # graph runner also exposes larger preconfirm/postconfirm flows, but
        # those stay reserved for a later consolidation pass once we can preserve
        # the same event granularity.
        if job.status in {JobStatus.queued, JobStatus.parsing}:
            state = await self._advance_to_intent_ready(job, state)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.intent_ready, JobStatus.prompt_ready}:
            state = await self._advance_to_prompt_ready(job, state)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.prompt_ready, JobStatus.preview_generating}:
            state = await self._advance_to_preview_ready(job, state)
            job = await self._require_active_job(job_id)

        if job.status == JobStatus.preview_ready:
            if job.requiresConfirmation:
                confirmed = await self._wait_for_confirmation(job_id)
                if not confirmed:
                    return
            await self._await_post_preview_precompute(job_id)
            job = await self._require_active_job(job_id)
            state = await self._drawing_graph.load_state(job)

        if job.status in {JobStatus.preview_ready, JobStatus.final_generating}:
            state = await self._advance_to_final_ready(job, state)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.final_ready, JobStatus.layers_generating}:
            state = await self._advance_to_layers_ready(job, state)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.layers_ready, JobStatus.playback_ready}:
            await self._advance_to_completed(job, state)

    async def _advance_to_intent_ready(self, job: DrawingJob, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if job.status == JobStatus.queued:
            await self._transition(job, JobStatus.parsing, 5)
            await self._sleep()
            job = await self._require_active_job(job.jobId)
            state = await self._drawing_graph.load_state(job)

        self._maybe_fail(job, JobStatus.parsing)
        if state.parsedIntent is None:
            state = await self._drawing_graph.run_parse_intent(state)
            await self._apply_state(job, state)
            job = await self._transition(job, JobStatus.intent_ready, 18)
            if job.status != JobStatus.intent_ready:
                return state
            await self._event_bus.publish(
                job.jobId,
                "intent.ready",
                JobStatus.intent_ready,
                state.parsedIntent.model_dump(mode="json"),
            )
        return state

    async def _advance_to_prompt_ready(self, job: DrawingJob, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if job.status == JobStatus.intent_ready:
            await self._sleep()
            job = await self._require_active_job(job.jobId)
            state = await self._drawing_graph.load_state(job)

        self._maybe_fail(job, JobStatus.prompt_ready)
        if state.visualBrief is None:
            state = await self._drawing_graph.run_build_visual_brief(state)
        if state.imagePrompt is None:
            state = await self._drawing_graph.run_build_image_prompt(state)

        await self._apply_state(job, state)
        if job.status != JobStatus.prompt_ready:
            job = await self._transition(job, JobStatus.prompt_ready, 30)
            if job.status != JobStatus.prompt_ready:
                return state
            await self._event_bus.publish(
                job.jobId,
                "prompt.ready",
                JobStatus.prompt_ready,
                {
                    "visualBrief": state.visualBrief.model_dump(mode="json"),
                    "imagePrompt": state.imagePrompt.model_dump(mode="json"),
                },
            )
        return state

    async def _advance_to_preview_ready(self, job: DrawingJob, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if job.status == JobStatus.prompt_ready:
            await self._transition(job, JobStatus.preview_generating, 42)
            await self._sleep()
            job = await self._require_active_job(job.jobId)
            state = await self._drawing_graph.load_state(job)

        self._maybe_fail(job, JobStatus.preview_generating)
        if state.previewAsset is None:
            state = await self._drawing_graph.run_generate_preview(state)
            job.previewAssetId = state.previewAsset.assetId
            job.requiresConfirmation = not self._enable_post_preview_precompute
            await self._apply_state(job, state)
            job = await self._transition(job, JobStatus.preview_ready, 55)
            if job.status != JobStatus.preview_ready:
                return state
            await self._event_bus.publish(
                job.jobId,
                "preview.ready",
                JobStatus.preview_ready,
                state.previewAsset.model_dump(mode="json"),
            )
            self._schedule_post_preview_precompute(job.jobId)
        return state

    async def _advance_to_final_ready(self, job: DrawingJob, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if job.status == JobStatus.preview_ready:
            await self._transition(job, JobStatus.final_generating, 68)
            await self._sleep()
            job = await self._require_active_job(job.jobId)
            state = await self._drawing_graph.load_state(job)

        self._maybe_fail(job, JobStatus.final_generating)
        if state.finalAsset is None:
            state = await self._drawing_graph.run_generate_final_image(state)
            job.finalAssetId = state.finalAsset.assetId
        if state.finalAsset is not None:
            job.finalAssetId = state.finalAsset.assetId
            await self._apply_state(job, state)
        if state.finalAsset is not None and job.status != JobStatus.final_ready:
            job = await self._transition(job, JobStatus.final_ready, 78)
            if job.status != JobStatus.final_ready:
                return state
            await self._event_bus.publish(
                job.jobId,
                "final.ready",
                JobStatus.final_ready,
                state.finalAsset.model_dump(mode="json"),
            )
        return state

    async def _advance_to_layers_ready(self, job: DrawingJob, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if job.status == JobStatus.final_ready:
            await self._transition(job, JobStatus.layers_generating, 84)
            await self._sleep()
            job = await self._require_active_job(job.jobId)
            state = await self._drawing_graph.load_state(job)

        self._maybe_fail(job, JobStatus.layers_generating)
        if not state.layerAssets:
            state = await self._drawing_graph.run_decompose_layers(state)
        if state.layerAssets:
            await self._apply_state(job, state)
        if state.layerAssets and job.status != JobStatus.layers_ready:
            job = await self._transition(job, JobStatus.layers_ready, 92)
            if job.status != JobStatus.layers_ready:
                return state
            await self._event_bus.publish(
                job.jobId,
                "layers.ready",
                JobStatus.layers_ready,
                {
                    "layerAssets": [asset.model_dump(mode="json") for asset in state.layerAssets],
                },
            )
        return state

    async def _advance_to_completed(self, job: DrawingJob, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if state.playbackManifest is None:
            state = await self._drawing_graph.run_build_playback_manifest(state)
            job.playbackManifestAssetId = (
                state.playbackManifestAsset.assetId if state.playbackManifestAsset is not None else None
            )
        if state.playbackManifest is not None:
            if state.playbackManifestAsset is not None:
                job.playbackManifestAssetId = state.playbackManifestAsset.assetId
            await self._apply_state(job, state)
        if state.playbackManifest is not None and job.status != JobStatus.playback_ready:
            job = await self._transition(job, JobStatus.playback_ready, 97)
            if job.status != JobStatus.playback_ready:
                return state
            await self._event_bus.publish(
                job.jobId,
                "playback.ready",
                JobStatus.playback_ready,
                state.playbackManifest.model_dump(mode="json"),
            )
            job = await self._require_active_job(job.jobId)

        if job.status != JobStatus.completed:
            job = await self._transition(job, JobStatus.completed, 100)
            if job.status != JobStatus.completed:
                return state
            await self._event_bus.publish(
                job.jobId,
                "job.completed",
                JobStatus.completed,
                {
                    "jobId": job.jobId,
                    "finalAssetId": job.finalAssetId,
                    "playbackManifest": state.playbackManifest.model_dump(mode="json"),
                },
            )
        return state

    def _schedule_post_preview_precompute(self, job_id: str) -> None:
        if not self._enable_post_preview_precompute:
            return
        task = self._post_preview_tasks.get(job_id)
        if task and not task.done():
            return
        task = asyncio.create_task(self._precompute_after_preview(job_id), name=f"drawing-job-precompute:{job_id}")
        self._post_preview_tasks[job_id] = task
        task.add_done_callback(lambda _: self._post_preview_tasks.pop(job_id, None))

    async def _await_post_preview_precompute(self, job_id: str) -> None:
        task = self._post_preview_tasks.get(job_id)
        if task and not task.done():
            await task

    async def _precompute_after_preview(self, job_id: str) -> None:
        try:
            job = await self._require_active_job(job_id)
            if job.status != JobStatus.preview_ready:
                return
            state = await self._drawing_graph.load_state(job)

            if state.finalAsset is None:
                state = await self._drawing_graph.run_generate_final_image(state)
                job = await self._require_active_job(job_id)
                if job.status != JobStatus.preview_ready:
                    return
                job.finalAssetId = state.finalAsset.assetId
                await self._apply_state(job, state)

            if not state.layerAssets:
                state = await self._drawing_graph.run_decompose_layers(state)
                job = await self._require_active_job(job_id)
                if job.status != JobStatus.preview_ready:
                    return
                await self._apply_state(job, state)

            if state.playbackManifest is None:
                state = await self._drawing_graph.run_build_playback_manifest(state)
                job = await self._require_active_job(job_id)
                if job.status != JobStatus.preview_ready:
                    return
                if state.playbackManifestAsset is not None:
                    job.playbackManifestAssetId = state.playbackManifestAsset.assetId
                await self._apply_state(job, state)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self._mark_failed(job_id, exc)

    async def _apply_state(self, job: DrawingJob, state: DrawingWorkflowState) -> None:
        current = await self._store.get_job(job.jobId)
        if current and current.status in TERMINAL_JOB_STATUSES:
            return

        job.parsedIntent = state.parsedIntent
        job.visualBrief = state.visualBrief
        job.imagePrompt = state.imagePrompt
        if state.previewAsset is not None:
            job.previewAssetId = state.previewAsset.assetId
        if state.finalAsset is not None:
            job.finalAssetId = state.finalAsset.assetId
        if state.playbackManifestAsset is not None:
            job.playbackManifestAssetId = state.playbackManifestAsset.assetId
        job.layerAssets = state.layerAssets
        job.playbackManifest = state.playbackManifest
        job.error = state.error
        job.updatedAt = utc_now()
        await self._store.save_job(job)

    async def _transition(self, job: DrawingJob, status: JobStatus, progress_percent: int) -> DrawingJob:
        current = await self._store.get_job(job.jobId)
        if current and current.status in TERMINAL_JOB_STATUSES:
            return current
        if job.status in TERMINAL_JOB_STATUSES:
            return job

        job.status = status
        job.progressPercent = max(job.progressPercent, current.progressPercent if current else 0, progress_percent)
        job.updatedAt = utc_now()
        if status in {JobStatus.completed, JobStatus.failed, JobStatus.cancelled} and job.completedAt is None:
            job.completedAt = utc_now()
        await self._store.save_job(job)
        await self._event_bus.publish(
            job.jobId,
            "job.status_changed",
            status,
            {
                "jobId": job.jobId,
                "status": status,
                "progressPercent": progress_percent,
                "requiresConfirmation": job.requiresConfirmation,
            },
        )
        return job

    async def _wait_for_confirmation(self, job_id: str) -> bool:
        gate = self._confirm_events.setdefault(job_id, asyncio.Event())
        await gate.wait()
        gate.clear()

        job = await self._require_job(job_id)
        return job.status != JobStatus.cancelled

    async def _mark_failed(self, job_id: str, exc: Exception) -> None:
        job = await self._store.get_job(job_id)
        if not job or job.status == JobStatus.cancelled:
            return

        error = self._to_job_error(job.status, exc)
        job.status = JobStatus.failed
        job.requiresConfirmation = False
        job.completedAt = utc_now()
        job.updatedAt = utc_now()
        job.error = error
        await self._store.save_job(job)
        safe_error_payload = sanitize_error_payload(error.model_dump(mode="json"))
        await self._event_bus.publish(
            job_id,
            "job.status_changed",
            JobStatus.failed,
            {
                "jobId": job.jobId,
                "status": job.status,
                "progressPercent": job.progressPercent,
                "error": safe_error_payload,
            },
        )
        await self._event_bus.publish(
            job_id,
            "job.failed",
            JobStatus.failed,
            safe_error_payload,
        )

    def _to_job_error(self, phase: JobStatus, exc: Exception) -> JobError:
        if isinstance(exc, WorkflowNodeError):
            cause = exc.cause or exc
            if isinstance(cause, ProviderTimeoutError):
                return JobError(
                    code="PROVIDER_TIMEOUT",
                    phase=phase,
                    message=str(cause),
                    retryable=True,
                    provider=cause.provider,
                    details={**cause.details, "node": exc.node_name},
                )
            if isinstance(cause, ProviderSchemaError):
                return JobError(
                    code="PROVIDER_SCHEMA_ERROR",
                    phase=phase,
                    message=str(cause),
                    retryable=True,
                    provider=cause.provider,
                    details={**cause.details, "node": exc.node_name},
                )
            if isinstance(cause, ProviderError):
                return JobError(
                    code="PROVIDER_ERROR",
                    phase=phase,
                    message=str(cause),
                    retryable=True,
                    provider=cause.provider,
                    details={**cause.details, "node": exc.node_name},
                )
            return JobError(
                code="WORKFLOW_NODE_ERROR",
                phase=phase,
                message=str(exc),
                retryable=True,
                details={"node": exc.node_name, "exceptionType": cause.__class__.__name__},
            )

        return JobError(
            code="MOCK_WORKFLOW_FAILED",
            phase=phase if phase not in TERMINAL_JOB_STATUSES else JobStatus.failed,
            message=str(exc),
            retryable=True,
            details={"exceptionType": exc.__class__.__name__},
        )

    async def _require_job(self, job_id: str) -> DrawingJob:
        job = await self._store.get_job(job_id)
        if not job:
            raise WorkflowStateError("job not found")
        return job

    async def _require_active_job(self, job_id: str) -> DrawingJob:
        job = await self._require_job(job_id)
        if job.status == JobStatus.cancelled:
            raise WorkflowStateError("job was cancelled")
        return job

    async def _sleep(self) -> None:
        await asyncio.sleep(self._step_delay_seconds)

    def _maybe_fail(self, job: DrawingJob, phase: JobStatus) -> None:
        if job.simulateFailureAt == phase:
            raise RuntimeError(f"Simulated workflow failure at phase {phase.value}.")

    @staticmethod
    def _make_id(prefix: str) -> str:
        timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        return f"{prefix}_{timestamp}_{uuid.uuid4().hex[:8]}"

    def make_job_id(self) -> str:
        return self._make_id("job")

    def _has_active_task(self, job_id: str) -> bool:
        task = self._tasks.get(job_id)
        return task is not None and not task.done()
