from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from .config import AppConfig
from .event_bus import JobEventBus
from .job_store import JobStore
from .models import (
    AssetRecord,
    DrawingJob,
    ImagePrompt,
    JobError,
    JobStatus,
    LayerAsset,
    ParsedIntent,
    PlaybackManifest,
    TERMINAL_JOB_STATUSES,
    VisualBrief,
    utc_now,
)


class WorkflowStateError(RuntimeError):
    pass


class MockDrawingWorkflowService:
    def __init__(self, config: AppConfig, store: JobStore, event_bus: JobEventBus) -> None:
        self._config = config
        self._store = store
        self._event_bus = event_bus
        self._tasks: dict[str, asyncio.Task[None]] = {}
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
                continue
            await self.start_job(job.jobId)

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
        job.progressPercent = job.progressPercent
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

        new_job_id = self.make_job_id()
        now = utc_now()
        retry_job = DrawingJob(
            jobId=new_job_id,
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
                "note": "Retry restarts the mock workflow from queued in phase two.",
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

        if job.status in {JobStatus.queued, JobStatus.parsing}:
            await self._advance_to_intent_ready(job_id)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.intent_ready, JobStatus.prompt_ready}:
            await self._advance_to_prompt_ready(job_id)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.prompt_ready, JobStatus.preview_generating}:
            await self._advance_to_preview_ready(job_id)
            job = await self._require_active_job(job_id)

        if job.status == JobStatus.preview_ready:
            if job.requiresConfirmation:
                confirmed = await self._wait_for_confirmation(job_id)
                if not confirmed:
                    return
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.preview_ready, JobStatus.final_generating}:
            await self._advance_to_final_ready(job_id)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.final_ready, JobStatus.layers_generating}:
            await self._advance_to_layers_ready(job_id)
            job = await self._require_active_job(job_id)

        if job.status in {JobStatus.layers_ready, JobStatus.playback_ready}:
            await self._advance_to_completed(job_id)

    async def _advance_to_intent_ready(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        if job.status == JobStatus.queued:
            await self._transition(job_id, JobStatus.parsing, 5, job=job)
            await self._sleep()
            job = await self._require_active_job(job_id)

        self._maybe_fail(job, JobStatus.parsing)
        if job.parsedIntent is None:
            job.parsedIntent = self._build_mock_intent(job)
            await self._transition(job_id, JobStatus.intent_ready, 18, job=job)
            await self._event_bus.publish(
                job_id,
                "intent.ready",
                JobStatus.intent_ready,
                job.parsedIntent.model_dump(mode="json"),
            )

    async def _advance_to_prompt_ready(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        if job.status == JobStatus.intent_ready:
            await self._sleep()
            job = await self._require_active_job(job_id)

        self._maybe_fail(job, JobStatus.prompt_ready)
        if job.visualBrief is None:
            job.visualBrief = self._build_mock_visual_brief(job)
        if job.imagePrompt is None:
            job.imagePrompt = self._build_mock_prompt(job)

        if job.status != JobStatus.prompt_ready:
            await self._transition(job_id, JobStatus.prompt_ready, 30, job=job)
            await self._event_bus.publish(
                job_id,
                "prompt.ready",
                JobStatus.prompt_ready,
                {
                    "visualBrief": job.visualBrief.model_dump(mode="json"),
                    "imagePrompt": job.imagePrompt.model_dump(mode="json"),
                },
            )

    async def _advance_to_preview_ready(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        if job.status == JobStatus.prompt_ready:
            await self._transition(job_id, JobStatus.preview_generating, 42, job=job)
            await self._sleep()
            job = await self._require_active_job(job_id)

        self._maybe_fail(job, JobStatus.preview_generating)
        if job.previewAssetId is None:
            preview_asset = await self._create_asset(job_id, "preview", "preview", "preview")
            job.previewAssetId = preview_asset.assetId
            job.requiresConfirmation = True
            await self._transition(job_id, JobStatus.preview_ready, 55, job=job)
            await self._event_bus.publish(
                job_id,
                "preview.ready",
                JobStatus.preview_ready,
                preview_asset.model_dump(mode="json"),
            )

    async def _advance_to_final_ready(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        if job.status == JobStatus.preview_ready:
            await self._transition(job_id, JobStatus.final_generating, 68, job=job)
            await self._sleep()
            job = await self._require_active_job(job_id)

        self._maybe_fail(job, JobStatus.final_generating)
        if job.finalAssetId is None:
            final_asset = await self._create_asset(job_id, "final", "final_image", "final")
            job.finalAssetId = final_asset.assetId
            await self._transition(job_id, JobStatus.final_ready, 78, job=job)
            await self._event_bus.publish(
                job_id,
                "final.ready",
                JobStatus.final_ready,
                final_asset.model_dump(mode="json"),
            )

    async def _advance_to_layers_ready(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        if job.status == JobStatus.final_ready:
            await self._transition(job_id, JobStatus.layers_generating, 84, job=job)
            await self._sleep()
            job = await self._require_active_job(job_id)

        self._maybe_fail(job, JobStatus.layers_generating)
        if not job.layerAssets:
            job.layerAssets = await self._create_layer_assets(job_id)
            await self._transition(job_id, JobStatus.layers_ready, 92, job=job)
            await self._event_bus.publish(
                job_id,
                "layers.ready",
                JobStatus.layers_ready,
                {
                    "layerAssets": [asset.model_dump(mode="json") for asset in job.layerAssets],
                },
            )

    async def _advance_to_completed(self, job_id: str) -> None:
        job = await self._require_active_job(job_id)
        if job.playbackManifest is None:
            job.playbackManifest = self._build_playback_manifest(job)
            await self._transition(job_id, JobStatus.playback_ready, 97, job=job)
            await self._event_bus.publish(
                job_id,
                "playback.ready",
                JobStatus.playback_ready,
                job.playbackManifest.model_dump(mode="json"),
            )
            job = await self._require_active_job(job_id)

        if job.status != JobStatus.completed:
            job.completedAt = utc_now()
            await self._transition(job_id, JobStatus.completed, 100, job=job)
            await self._event_bus.publish(
                job_id,
                "job.completed",
                JobStatus.completed,
                {
                    "jobId": job.jobId,
                    "finalAssetId": job.finalAssetId,
                    "playbackManifest": job.playbackManifest.model_dump(mode="json"),
                },
            )

    async def _transition(
        self,
        job_id: str,
        status: JobStatus,
        progress_percent: int,
        job: DrawingJob | None = None,
    ) -> DrawingJob:
        job = job or await self._require_job(job_id)
        if job.status in TERMINAL_JOB_STATUSES and status not in TERMINAL_JOB_STATUSES:
            return job

        job.status = status
        job.progressPercent = progress_percent
        job.updatedAt = utc_now()
        if status in {JobStatus.completed, JobStatus.failed, JobStatus.cancelled} and job.completedAt is None:
            job.completedAt = utc_now()
        await self._store.save_job(job)
        await self._event_bus.publish(
            job_id,
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
        if not job:
            return
        if job.status == JobStatus.cancelled:
            return

        phase = job.status if job.status not in TERMINAL_JOB_STATUSES else JobStatus.failed
        job.status = JobStatus.failed
        job.requiresConfirmation = False
        job.completedAt = utc_now()
        job.updatedAt = utc_now()
        job.error = JobError(
            code="MOCK_WORKFLOW_FAILED",
            phase=phase,
            message=str(exc),
            retryable=True,
            provider="mock-workflow",
            details={"exceptionType": exc.__class__.__name__},
        )
        await self._store.save_job(job)
        await self._event_bus.publish(
            job_id,
            "job.status_changed",
            JobStatus.failed,
            {
                "jobId": job.jobId,
                "status": job.status,
                "progressPercent": job.progressPercent,
            },
        )
        await self._event_bus.publish(
            job_id,
            "job.failed",
            JobStatus.failed,
            job.error.model_dump(mode="json"),
        )

    async def _create_asset(
        self,
        job_id: str,
        kind: str,
        role: str,
        label: str,
    ) -> AssetRecord:
        asset_id = self._make_id("asset")
        metadata = {
            "label": label,
            "width": 1024,
            "height": 1024,
            "provider": "mock-workflow",
            "note": "This is metadata only. No binary image has been generated in phase two.",
        }
        asset = AssetRecord(
            assetId=asset_id,
            jobId=job_id,
            kind=kind,  # type: ignore[arg-type]
            role=role,
            mimeType="application/json",
            url=f"/api/v2/assets/{asset_id}",
            metadata=metadata,
        )
        await self._store.save_asset(asset)
        return asset

    async def _create_layer_assets(self, job_id: str) -> list[LayerAsset]:
        roles = [
            ("sketch", "Sketch Layer"),
            ("lineart", "Line Art Layer"),
            ("flat_color", "Flat Color Layer"),
            ("shadow", "Shadow Layer"),
            ("lighting", "Lighting Layer"),
            ("details", "Details Layer"),
            ("final_composite", "Final Composite Layer"),
        ]
        assets: list[LayerAsset] = []
        for role, label in roles:
            record = await self._create_asset(job_id, "layer", role, label)
            assets.append(
                LayerAsset(
                    assetId=record.assetId,
                    jobId=job_id,
                    role=role,
                    label=label,
                    mimeType=record.mimeType,
                    width=int(record.metadata["width"]),
                    height=int(record.metadata["height"]),
                    url=record.url,
                    metadata=record.metadata,
                )
            )
        return assets

    def _build_mock_intent(self, job: DrawingJob) -> ParsedIntent:
        return ParsedIntent(
            subject="anime watercolor portrait",
            style="high-quality watercolor illustration",
            composition="half-body portrait with clean character focus",
            constraints=[
                "prioritize polish over speed",
                "preserve readable silhouette",
                "support layer-based playback",
            ],
            edits=[],
            ambiguities=[],
            confidence=0.94,
        )

    def _build_mock_visual_brief(self, job: DrawingJob) -> VisualBrief:
        return VisualBrief(
            artDirection="soft anime watercolor with polished lighting",
            camera="medium close-up, portrait orientation",
            palette=["sky blue", "rose pink", "warm ivory", "soft violet"],
            mood="dreamy and clean",
            characterSpec=f"Interpret the request as a premium illustrated character portrait based on: {job.inputText}",
            backgroundSpec="minimal watercolor backdrop with soft atmospheric contrast",
            negativeConstraints=["no rough stick-figure canvas output", "no unfinished silhouette"],
        )

    def _build_mock_prompt(self, job: DrawingJob) -> ImagePrompt:
        prompt_seed = abs(hash(job.inputText)) % 1_000_000
        return ImagePrompt(
            model="mock-preview-final-pipeline",
            positivePrompt=(
                "Best-quality anime watercolor portrait, refined facial features, layered paint workflow, "
                f"user intent: {job.inputText}"
            ),
            negativePrompt="messy lines, crude canvas doodle, unfinished paint, distorted anatomy",
            size="1024x1024",
            guidance="Preserve the feeling of a staged painting workflow that can later map to playback layers.",
            seed=prompt_seed,
        )

    def _build_playback_manifest(self, job: DrawingJob) -> PlaybackManifest:
        layer_refs = [layer.assetId for layer in job.layerAssets]
        return PlaybackManifest(
            manifestVersion="0.1.0",
            canvasSize={"width": 1024, "height": 1024},
            durationMs=6200,
            layerRefs=layer_refs,
            finalCompositeAssetId=job.finalAssetId,
            steps=[
                {"step": 1, "phase": "sketch", "assetRole": "sketch", "durationMs": 900},
                {"step": 2, "phase": "lineart", "assetRole": "lineart", "durationMs": 850},
                {"step": 3, "phase": "flat_color", "assetRole": "flat_color", "durationMs": 1000},
                {"step": 4, "phase": "shadow", "assetRole": "shadow", "durationMs": 850},
                {"step": 5, "phase": "lighting", "assetRole": "lighting", "durationMs": 800},
                {"step": 6, "phase": "details", "assetRole": "details", "durationMs": 950},
                {"step": 7, "phase": "final_composite", "assetRole": "final_composite", "durationMs": 850},
            ],
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
        await asyncio.sleep(self._config.workflow_step_delay_seconds)

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
