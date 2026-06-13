from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from ..models import AssetKind, ImagePrompt, ParsedIntent, PlaybackManifest, VisualBrief
from ..workflows.state import DrawingWorkflowState


class ProviderProfile(str, Enum):
    mock = "mock"
    openai = "openai"
    dashscope = "dashscope"
    comfyui = "comfyui"
    local = "local"


@dataclass(frozen=True)
class ProviderCapabilities:
    supports_preview: bool
    supports_final: bool
    supports_layer_decomposition: bool
    supports_playback_manifest: bool


@dataclass(frozen=True)
class ProviderRuntimeInfo:
    profile: ProviderProfile
    provider_name: str
    placeholder: bool
    network_enabled: bool
    configured: bool
    capabilities: ProviderCapabilities
    safe_settings: dict[str, object]


class ProviderError(RuntimeError):
    def __init__(self, message: str, *, provider: str | None = None, details: dict | None = None) -> None:
        super().__init__(message)
        self.provider = provider
        self.details = details or {}


class ProviderTimeoutError(ProviderError):
    pass


class ProviderSchemaError(ProviderError):
    pass


class WorkflowNodeError(RuntimeError):
    def __init__(self, node_name: str, message: str, *, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.node_name = node_name
        self.cause = cause


@dataclass(frozen=True)
class GeneratedAssetSpec:
    kind: AssetKind
    role: str
    label: str
    mime_type: str
    width: int
    height: int
    order: int | None = None
    opacity: float | None = None
    blend_mode: str | None = None
    source_final_asset_id: str | None = None
    storage_path: str | None = None
    content_bytes: bytes | None = None
    file_extension: str | None = None
    metadata: dict | None = None


class IntentParserProvider(Protocol):
    async def parse_intent(self, *, job_id: str, input_text: str, locale: str) -> ParsedIntent: ...


class VisualBriefProvider(Protocol):
    async def build_visual_brief(self, state: DrawingWorkflowState) -> VisualBrief: ...


class ImagePromptProvider(Protocol):
    async def build_image_prompt(self, state: DrawingWorkflowState) -> ImagePrompt: ...


class ImageGenerationProvider(Protocol):
    async def generate_preview(self, state: DrawingWorkflowState) -> GeneratedAssetSpec: ...

    async def generate_final_image(self, state: DrawingWorkflowState) -> GeneratedAssetSpec: ...


class LayerDecompositionProvider(Protocol):
    async def decompose_layers(self, state: DrawingWorkflowState) -> list[GeneratedAssetSpec]: ...


class PlaybackManifestProvider(Protocol):
    async def build_playback_manifest(self, state: DrawingWorkflowState) -> PlaybackManifest: ...


class ProviderGateway(
    IntentParserProvider,
    VisualBriefProvider,
    ImagePromptProvider,
    ImageGenerationProvider,
    LayerDecompositionProvider,
    PlaybackManifestProvider,
    Protocol,
):
    @property
    def runtime_info(self) -> ProviderRuntimeInfo: ...
