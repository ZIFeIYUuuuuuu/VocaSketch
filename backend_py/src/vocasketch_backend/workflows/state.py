from __future__ import annotations

from pydantic import BaseModel, Field

from ..models import AssetRecord, DrawingJob, ImagePrompt, JobError, JobStatus, LayerAsset, ParsedIntent, PlaybackManifest, VisualBrief


class DrawingWorkflowState(BaseModel):
    jobId: str
    inputText: str
    locale: str
    parsedIntent: ParsedIntent | None = None
    visualBrief: VisualBrief | None = None
    imagePrompt: ImagePrompt | None = None
    previewAsset: AssetRecord | None = None
    finalAsset: AssetRecord | None = None
    layerAssets: list[LayerAsset] = Field(default_factory=list)
    playbackManifest: PlaybackManifest | None = None
    playbackManifestAsset: AssetRecord | None = None
    error: JobError | None = None
    status: JobStatus
    progressPercent: int = 0

    @classmethod
    def from_job(cls, job: DrawingJob, *, preview_asset: AssetRecord | None = None, final_asset: AssetRecord | None = None, playback_manifest_asset: AssetRecord | None = None) -> "DrawingWorkflowState":
        return cls(
            jobId=job.jobId,
            inputText=job.inputText,
            locale=job.locale,
            parsedIntent=job.parsedIntent,
            visualBrief=job.visualBrief,
            imagePrompt=job.imagePrompt,
            previewAsset=preview_asset,
            finalAsset=final_asset,
            layerAssets=job.layerAssets,
            playbackManifest=job.playbackManifest,
            playbackManifestAsset=playback_manifest_asset,
            error=job.error,
            status=job.status,
            progressPercent=job.progressPercent,
        )
