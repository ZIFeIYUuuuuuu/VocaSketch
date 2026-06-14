from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class JobStatus(str, Enum):
    queued = "queued"
    parsing = "parsing"
    intent_ready = "intent_ready"
    prompt_ready = "prompt_ready"
    preview_generating = "preview_generating"
    preview_ready = "preview_ready"
    final_generating = "final_generating"
    final_ready = "final_ready"
    layers_generating = "layers_generating"
    layers_ready = "layers_ready"
    playback_ready = "playback_ready"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


TERMINAL_JOB_STATUSES = {
    JobStatus.completed,
    JobStatus.failed,
    JobStatus.cancelled,
}


class ParsedIntent(BaseModel):
    subject: str
    style: str
    composition: str
    constraints: list[str] = Field(default_factory=list)
    edits: list[str] = Field(default_factory=list)
    ambiguities: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.92, ge=0, le=1)


class VisualBrief(BaseModel):
    artDirection: str
    camera: str
    palette: list[str] = Field(default_factory=list)
    mood: str
    characterSpec: str
    backgroundSpec: str
    negativeConstraints: list[str] = Field(default_factory=list)


class ImagePrompt(BaseModel):
    model: str
    positivePrompt: str
    negativePrompt: str
    size: str
    guidance: str | None = None
    seed: int | None = None


class LayerAsset(BaseModel):
    assetId: str
    jobId: str
    role: str
    label: str
    mimeType: str
    width: int
    height: int
    url: str
    contentUrl: str | None = None
    byteSize: int | None = None
    checksum: str | None = None
    storagePath: str | None = None
    order: int | None = None
    opacity: float | None = Field(default=None, ge=0, le=1)
    blendMode: str | None = None
    sourceFinalAssetId: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlaybackManifestStep(BaseModel):
    stepId: str
    order: int
    role: str
    label: str
    assetId: str | None = None
    contentUrl: str | None = None
    startMs: int = Field(ge=0)
    durationMs: int = Field(gt=0)
    opacityFrom: float = Field(default=0.0, ge=0, le=1)
    opacityTo: float = Field(default=1.0, ge=0, le=1)
    blendMode: str = "normal"
    easing: str = "ease-out"
    transition: str = "fade-in"
    step: int | None = None
    phase: str | None = None
    assetRole: str | None = None


class PlaybackManifest(BaseModel):
    manifestVersion: str
    canvasSize: dict[str, int]
    durationMs: int
    steps: list[PlaybackManifestStep] = Field(default_factory=list)
    layerRefs: list[str] = Field(default_factory=list)
    finalCompositeAssetId: str | None = None
    process: dict[str, Any] | None = None


class JobError(BaseModel):
    code: str
    phase: JobStatus
    message: str
    retryable: bool
    provider: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=utc_now)


class JobEvent(BaseModel):
    eventId: str
    jobId: str
    seq: int
    type: str
    status: JobStatus
    payload: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=utc_now)


AssetKind = Literal["preview", "final", "layer", "manifest", "process_video"]


class AssetRecord(BaseModel):
    assetId: str
    jobId: str
    kind: AssetKind
    role: str
    mimeType: str
    url: str
    contentUrl: str | None = None
    byteSize: int | None = None
    checksum: str | None = None
    width: int | None = None
    height: int | None = None
    storagePath: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime = Field(default_factory=utc_now)


class DrawingJob(BaseModel):
    jobId: str
    status: JobStatus
    progressPercent: int = Field(default=0, ge=0, le=100)
    inputText: str
    locale: str = "zh-CN"
    clientSessionId: str | None = None
    projectHint: str | None = None
    qualityProfile: str = "high"
    references: list[str] = Field(default_factory=list)
    parsedIntent: ParsedIntent | None = None
    visualBrief: VisualBrief | None = None
    imagePrompt: ImagePrompt | None = None
    previewAssetId: str | None = None
    finalAssetId: str | None = None
    playbackManifestAssetId: str | None = None
    layerAssets: list[LayerAsset] = Field(default_factory=list)
    playbackManifest: PlaybackManifest | None = None
    requiresConfirmation: bool = False
    error: JobError | None = None
    retryOfJobId: str | None = None
    simulateFailureAt: JobStatus | None = None
    createdAt: datetime = Field(default_factory=utc_now)
    updatedAt: datetime = Field(default_factory=utc_now)
    completedAt: datetime | None = None


class DrawingJobCreateRequest(BaseModel):
    inputText: str = Field(min_length=1, max_length=2000)
    locale: str = Field(default="zh-CN", min_length=2, max_length=20)
    clientSessionId: str | None = Field(default=None, max_length=200)
    projectHint: str | None = Field(default=None, max_length=200)
    qualityProfile: Literal["standard", "high"] = "high"
    references: list[str] = Field(default_factory=list)
    simulateFailureAt: JobStatus | None = None


class DrawingJobResponse(DrawingJob):
    eventsUrl: str


class JobErrorSummary(BaseModel):
    code: str
    phase: JobStatus
    message: str
    retryable: bool
    provider: str | None = None


class DrawingJobSummary(BaseModel):
    jobId: str
    status: JobStatus
    progressPercent: int = Field(ge=0, le=100)
    inputText: str
    previewAssetId: str | None = None
    finalAssetId: str | None = None
    retryOfJobId: str | None = None
    error: JobErrorSummary | None = None
    createdAt: datetime
    updatedAt: datetime
    completedAt: datetime | None = None


class DrawingJobListResponse(BaseModel):
    items: list[DrawingJobSummary]
    limit: int
    status: JobStatus | None = None


class DrawingJobConfirmRequest(BaseModel):
    decision: Literal["approve"] = "approve"
    selectedPreviewAssetId: str | None = None
    notes: str | None = None


class DrawingJobCancelRequest(BaseModel):
    reason: str | None = None


class DrawingJobRetryRequest(BaseModel):
    fromPhase: JobStatus | None = None
    reason: str | None = None


class DrawingJobCreatedEnvelope(BaseModel):
    jobId: str
    status: JobStatus
    eventsUrl: str


class DrawingJobRetryResponse(BaseModel):
    jobId: str
    status: JobStatus
    eventsUrl: str
    retryOfJobId: str
