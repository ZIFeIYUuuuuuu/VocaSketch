from __future__ import annotations

from ..models import ImagePrompt, ParsedIntent, PlaybackManifest, VisualBrief
from ..workflows.state import DrawingWorkflowState
from .base import GeneratedAssetSpec, ProviderCapabilities, ProviderError, ProviderProfile, ProviderRuntimeInfo


class PlaceholderProviderGateway:
    def __init__(self, runtime_info: ProviderRuntimeInfo) -> None:
        self._runtime_info = runtime_info

    @property
    def runtime_info(self) -> ProviderRuntimeInfo:
        return self._runtime_info

    async def parse_intent(self, *, job_id: str, input_text: str, locale: str) -> ParsedIntent:
        raise self._not_implemented_error("parse_intent")

    async def build_visual_brief(self, state: DrawingWorkflowState) -> VisualBrief:
        raise self._not_implemented_error("build_visual_brief")

    async def build_image_prompt(self, state: DrawingWorkflowState) -> ImagePrompt:
        raise self._not_implemented_error("build_image_prompt")

    async def generate_preview(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        raise self._not_implemented_error("generate_preview")

    async def generate_final_image(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        raise self._not_implemented_error("generate_final_image")

    async def decompose_layers(self, state: DrawingWorkflowState) -> list[GeneratedAssetSpec]:
        raise self._not_implemented_error("decompose_layers")

    async def build_playback_manifest(self, state: DrawingWorkflowState) -> PlaybackManifest:
        raise self._not_implemented_error("build_playback_manifest")

    def _not_implemented_error(self, operation: str) -> ProviderError:
        return ProviderError(
            f"Provider profile '{self._runtime_info.profile.value}' is registered as a Stage 5 placeholder and does not implement '{operation}' yet.",
            provider=self._runtime_info.provider_name,
            details={
                "profile": self._runtime_info.profile.value,
                "operation": operation,
                "placeholder": True,
                "networkEnabled": self._runtime_info.network_enabled,
            },
        )


def build_placeholder_runtime_info(
    *,
    profile: ProviderProfile,
    provider_name: str,
    safe_settings: dict[str, object],
) -> ProviderRuntimeInfo:
    return ProviderRuntimeInfo(
        profile=profile,
        provider_name=provider_name,
        placeholder=True,
        network_enabled=False,
        configured=True,
        capabilities=ProviderCapabilities(
            supports_preview=False,
            supports_final=False,
            supports_layer_decomposition=False,
            supports_playback_manifest=False,
        ),
        safe_settings=safe_settings,
    )


class OpenAIProviderGateway(PlaceholderProviderGateway):
    pass


class DashScopeProviderGateway(PlaceholderProviderGateway):
    pass


class ComfyUIProviderGateway(PlaceholderProviderGateway):
    pass


class LocalProviderGateway(PlaceholderProviderGateway):
    pass
