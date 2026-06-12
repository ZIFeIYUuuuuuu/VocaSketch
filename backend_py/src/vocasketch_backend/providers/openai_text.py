from __future__ import annotations

from pydantic import BaseModel, ValidationError

from ..models import ImagePrompt, ParsedIntent, PlaybackManifest, VisualBrief
from ..workflows.state import DrawingWorkflowState
from .base import (
    GeneratedAssetSpec,
    ProviderCapabilities,
    ProviderError,
    ProviderGateway,
    ProviderProfile,
    ProviderRuntimeInfo,
    ProviderSchemaError,
    ProviderTimeoutError,
)
from .llm_prompts import (
    build_image_prompt_prompt,
    build_parse_intent_prompt,
    build_visual_brief_prompt,
)
from .mock import MockProviderGateway
from .transports import (
    TextGenerationRequest,
    TextGenerationTransport,
    TransportError,
    TransportTimeoutError,
)


class OpenAITextProviderGateway(ProviderGateway):
    def __init__(
        self,
        *,
        api_base_url: str,
        safe_api_base_url: str | None,
        api_key: str,
        text_model: str,
        image_model: str | None,
        timeout_seconds: float,
        text_transport: TextGenerationTransport,
        asset_provider: MockProviderGateway | None = None,
    ) -> None:
        self._api_base_url = api_base_url
        self._api_key = api_key
        self._text_model = text_model
        self._image_model = image_model
        self._timeout_seconds = timeout_seconds
        self._text_transport = text_transport
        self._asset_provider = asset_provider or MockProviderGateway()
        self._runtime_info = ProviderRuntimeInfo(
            profile=ProviderProfile.openai,
            provider_name="openai-text+mock-assets",
            placeholder=False,
            network_enabled=True,
            configured=True,
            capabilities=ProviderCapabilities(
                supports_preview=True,
                supports_final=True,
                supports_layer_decomposition=True,
                supports_playback_manifest=True,
            ),
            safe_settings={
                "apiBaseUrl": safe_api_base_url,
                "textModel": text_model,
                "imageModel": image_model,
                "timeoutSeconds": timeout_seconds,
                "mode": "live-text-mock-assets",
            },
        )

    @property
    def runtime_info(self) -> ProviderRuntimeInfo:
        return self._runtime_info

    async def parse_intent(self, *, job_id: str, input_text: str, locale: str) -> ParsedIntent:
        system_prompt, user_prompt = build_parse_intent_prompt(input_text=input_text, locale=locale)
        return await self._generate_structured_output(ParsedIntent, "ParsedIntent", system_prompt, user_prompt)

    async def build_visual_brief(self, state: DrawingWorkflowState) -> VisualBrief:
        system_prompt, user_prompt = build_visual_brief_prompt(state)
        return await self._generate_structured_output(VisualBrief, "VisualBrief", system_prompt, user_prompt)

    async def build_image_prompt(self, state: DrawingWorkflowState) -> ImagePrompt:
        system_prompt, user_prompt = build_image_prompt_prompt(state)
        return await self._generate_structured_output(ImagePrompt, "ImagePrompt", system_prompt, user_prompt)

    async def generate_preview(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        return await self._asset_provider.generate_preview(state)

    async def generate_final_image(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        return await self._asset_provider.generate_final_image(state)

    async def decompose_layers(self, state: DrawingWorkflowState) -> list[GeneratedAssetSpec]:
        return await self._asset_provider.decompose_layers(state)

    async def build_playback_manifest(self, state: DrawingWorkflowState) -> PlaybackManifest:
        return await self._asset_provider.build_playback_manifest(state)

    async def _generate_structured_output(
        self,
        model_type: type[BaseModel],
        artifact_name: str,
        system_prompt: str,
        user_prompt: str,
    ):
        request = TextGenerationRequest(
            api_base_url=self._api_base_url,
            api_key=self._api_key,
            model=self._text_model,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            timeout_seconds=self._timeout_seconds,
        )
        try:
            raw_content = await self._text_transport.generate_json(request)
        except TransportTimeoutError as exc:
            raise ProviderTimeoutError(
                f"{artifact_name} generation timed out.",
                provider=self.runtime_info.provider_name,
                details={"artifact": artifact_name},
            ) from exc
        except TransportError as exc:
            raise ProviderError(
                f"{artifact_name} generation failed.",
                provider=self.runtime_info.provider_name,
                details={"artifact": artifact_name},
            ) from exc

        try:
            return model_type.model_validate_json(raw_content)
        except ValidationError as exc:
            raise ProviderSchemaError(
                f"{artifact_name} generation returned invalid structured data.",
                provider=self.runtime_info.provider_name,
                details={
                    "artifact": artifact_name,
                    "validationError": str(exc),
                },
            ) from exc
