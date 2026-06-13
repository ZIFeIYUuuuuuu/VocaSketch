from __future__ import annotations

from collections.abc import Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, ValidationError

from ..models import AssetKind, ImagePrompt, ParsedIntent, PlaybackManifest, VisualBrief
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
    ImageGenerationRequest,
    ImageGenerationResult,
    ImageGenerationTransport,
    LayerDecompositionRequest,
    LayerDecompositionResult,
    LayerDecompositionTransport,
    TextGenerationRequest,
    TextGenerationTransport,
    TransportError,
    TransportSchemaError,
    TransportTimeoutError,
)

REQUIRED_LAYER_ROLES = ("sketch", "lineart", "flat_color", "shadow", "lighting", "details")


class OpenAITextProviderGateway(ProviderGateway):
    def __init__(
        self,
        *,
        api_base_url: str,
        safe_api_base_url: str | None,
        api_key: str,
        text_model: str,
        image_model: str | None,
        layer_model: str | None,
        timeout_seconds: float,
        text_transport: TextGenerationTransport,
        image_transport: ImageGenerationTransport | None = None,
        layer_transport: LayerDecompositionTransport | None = None,
        asset_provider: MockProviderGateway | None = None,
    ) -> None:
        self._api_base_url = api_base_url
        self._api_key = api_key
        self._text_model = text_model
        self._image_model = image_model
        self._layer_model = layer_model
        self._timeout_seconds = timeout_seconds
        self._text_transport = text_transport
        self._image_transport = image_transport
        self._layer_transport = layer_transport
        self._asset_provider = asset_provider or MockProviderGateway()
        mode = _runtime_mode(
            image_enabled=image_model is not None and image_transport is not None,
            layer_enabled=layer_model is not None and layer_transport is not None,
        )
        self._runtime_info = ProviderRuntimeInfo(
            profile=ProviderProfile.openai,
            provider_name="openai-mixed-provider",
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
                "layerModel": layer_model,
                "timeoutSeconds": timeout_seconds,
                "mode": mode,
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
        if self._can_generate_live_images():
            return await self._generate_image_asset(state, mode="preview")
        return await self._asset_provider.generate_preview(state)

    async def generate_final_image(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        if self._can_generate_live_images():
            return await self._generate_image_asset(state, mode="final")
        return await self._asset_provider.generate_final_image(state)

    async def decompose_layers(self, state: DrawingWorkflowState) -> list[GeneratedAssetSpec]:
        if self._can_decompose_layers_live():
            return await self._decompose_layers_live(state)
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
        except TransportSchemaError as exc:
            raise ProviderSchemaError(
                f"{artifact_name} generation returned invalid transport data.",
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

    def _can_generate_live_images(self) -> bool:
        return self._image_model is not None and self._image_transport is not None

    def _can_decompose_layers_live(self) -> bool:
        return self._layer_model is not None and self._layer_transport is not None

    async def _generate_image_asset(self, state: DrawingWorkflowState, *, mode: str) -> GeneratedAssetSpec:
        image_prompt = state.imagePrompt
        if image_prompt is None:
            raise ProviderSchemaError(
                "Image generation requires a prepared image prompt.",
                provider=self.runtime_info.provider_name,
                details={"artifact": mode},
            )

        request = ImageGenerationRequest(
            api_base_url=self._api_base_url,
            api_key=self._api_key,
            model=self._image_model or "",
            prompt=image_prompt.positivePrompt,
            negative_prompt=image_prompt.negativePrompt,
            size=_size_for_mode(image_prompt.size, mode=mode),
            timeout_seconds=_timeout_for_mode(self._timeout_seconds, mode=mode),
            mode=mode,
            quality="preview-fast" if mode == "preview" else "final-high",
            seed=image_prompt.seed,
        )

        try:
            result = await self._image_transport.generate_image(request)
        except TransportTimeoutError as exc:
            raise ProviderTimeoutError(
                f"{mode.title()} image generation timed out.",
                provider=self.runtime_info.provider_name,
                details={"artifact": mode},
            ) from exc
        except TransportSchemaError as exc:
            raise ProviderSchemaError(
                f"{mode.title()} image generation returned invalid data.",
                provider=self.runtime_info.provider_name,
                details={"artifact": mode},
            ) from exc
        except TransportError as exc:
            raise ProviderError(
                f"{mode.title()} image generation failed.",
                provider=self.runtime_info.provider_name,
                details={"artifact": mode},
            ) from exc

        return _to_generated_asset_spec(
            result,
            role="preview" if mode == "preview" else "final_image",
            label="Preview Image" if mode == "preview" else "Final Image",
            kind="preview" if mode == "preview" else "final",
            provider_name=self.runtime_info.provider_name,
            model=self._image_model or "",
            mode=mode,
        )

    async def _decompose_layers_live(self, state: DrawingWorkflowState) -> list[GeneratedAssetSpec]:
        if state.finalAsset is None:
            raise ProviderSchemaError(
                "Layer decomposition requires a final asset.",
                provider=self.runtime_info.provider_name,
                details={"artifact": "layers"},
            )
        if state.imagePrompt is None:
            raise ProviderSchemaError(
                "Layer decomposition requires an image prompt summary.",
                provider=self.runtime_info.provider_name,
                details={"artifact": "layers"},
            )

        request = LayerDecompositionRequest(
            api_base_url=self._api_base_url,
            api_key=self._api_key,
            model=self._layer_model or "",
            job_id=state.jobId,
            final_asset={
                "assetId": state.finalAsset.assetId,
                "mimeType": state.finalAsset.mimeType,
                "contentUrl": state.finalAsset.contentUrl,
                "width": state.finalAsset.width,
                "height": state.finalAsset.height,
                "metadata": {
                    "provider": state.finalAsset.metadata.get("provider"),
                    "mode": state.finalAsset.metadata.get("mode"),
                    "seed": state.finalAsset.metadata.get("seed"),
                },
            },
            prompt_summary={
                "positivePrompt": state.imagePrompt.positivePrompt[:400],
                "negativePrompt": state.imagePrompt.negativePrompt[:240],
                "guidance": state.imagePrompt.guidance,
                "seed": state.imagePrompt.seed,
                "artDirection": state.visualBrief.artDirection if state.visualBrief else None,
            },
            requested_roles=list(REQUIRED_LAYER_ROLES),
            timeout_seconds=max(self._timeout_seconds, 20.0),
        )

        try:
            result = await self._layer_transport.decompose_layers(request)
        except TransportTimeoutError as exc:
            raise ProviderTimeoutError(
                "Layer decomposition timed out.",
                provider=self.runtime_info.provider_name,
                details={"artifact": "layers"},
            ) from exc
        except TransportSchemaError as exc:
            raise ProviderSchemaError(
                "Layer decomposition returned invalid data.",
                provider=self.runtime_info.provider_name,
                details={"artifact": "layers"},
            ) from exc
        except TransportError as exc:
            raise ProviderError(
                "Layer decomposition failed.",
                provider=self.runtime_info.provider_name,
                details={"artifact": "layers"},
            ) from exc

        return _to_layer_asset_specs(
            result,
            provider_name=self.runtime_info.provider_name,
            model=self._layer_model or "",
            source_final_asset_id=state.finalAsset.assetId,
        )


def _runtime_mode(*, image_enabled: bool, layer_enabled: bool) -> str:
    if image_enabled and layer_enabled:
        return "live-text-live-image-live-layers"
    if image_enabled:
        return "live-text-live-image"
    if layer_enabled:
        return "live-text-mock-image-live-layers"
    return "live-text-mock-assets"


def _timeout_for_mode(timeout_seconds: float, *, mode: str) -> float:
    if mode == "preview":
        return max(5.0, min(timeout_seconds, 15.0))
    return max(timeout_seconds, 15.0)


def _size_for_mode(size: str, *, mode: str) -> str:
    if mode != "preview":
        return size

    try:
        width_text, height_text = size.lower().split("x", 1)
        width = max(256, min(int(width_text), 768))
        height = max(256, min(int(height_text), 768))
        return f"{width}x{height}"
    except (AttributeError, ValueError):
        return "512x512"


def _to_generated_asset_spec(
    result: ImageGenerationResult,
    *,
    role: str,
    label: str,
    kind: AssetKind,
    provider_name: str,
    model: str,
    mode: str,
) -> GeneratedAssetSpec:
    if not result.content_bytes:
        raise ProviderSchemaError(
            "Image generation returned empty content bytes.",
            provider=provider_name,
            details={"mode": mode},
        )
    if result.width <= 0 or result.height <= 0:
        raise ProviderSchemaError(
            "Image generation returned a non-positive image size.",
            provider=provider_name,
            details={"mode": mode},
        )

    return GeneratedAssetSpec(
        kind=kind,
        role=role,
        label=label,
        mime_type=result.mime_type,
        width=result.width,
        height=result.height,
        content_bytes=result.content_bytes,
        file_extension=_file_extension_for_mime_type(result.mime_type),
        metadata={
            "provider": provider_name,
            "model": model,
            "mode": mode,
            "seed": result.seed,
            "providerMetadata": result.provider_metadata or {},
        },
    )


def _to_layer_asset_specs(
    result: LayerDecompositionResult,
    *,
    provider_name: str,
    model: str,
    source_final_asset_id: str,
) -> list[GeneratedAssetSpec]:
    if not result.layers:
        raise ProviderSchemaError(
            "Layer decomposition returned no layers.",
            provider=provider_name,
            details={"artifact": "layers"},
        )

    roles = {layer.role for layer in result.layers}
    missing_roles = [role for role in REQUIRED_LAYER_ROLES if role not in roles]
    if missing_roles:
        raise ProviderSchemaError(
            "Layer decomposition is missing required layer roles.",
            provider=provider_name,
            details={"missingRoles": missing_roles},
        )

    specs: list[GeneratedAssetSpec] = []
    for item in sorted(result.layers, key=lambda layer: layer.order):
        if not item.content_bytes:
            raise ProviderSchemaError(
                "Layer decomposition returned an empty layer asset.",
                provider=provider_name,
                details={"role": item.role},
            )
        if not 0.0 <= item.opacity <= 1.0:
            raise ProviderSchemaError(
                "Layer decomposition returned an opacity outside the supported 0..1 range.",
                provider=provider_name,
                details={"role": item.role, "opacity": item.opacity},
            )
        specs.append(
            GeneratedAssetSpec(
                kind="layer",
                role=item.role,
                label=item.label,
                mime_type=item.mime_type,
                width=item.width,
                height=item.height,
                order=item.order,
                opacity=item.opacity,
                blend_mode=item.blend_mode,
                source_final_asset_id=source_final_asset_id,
                content_bytes=item.content_bytes,
                file_extension=_file_extension_for_mime_type(item.mime_type),
                metadata={
                    "provider": provider_name,
                    "model": model,
                    "mode": "live-layer-decomposition",
                    "order": item.order,
                    "opacity": item.opacity,
                    "blendMode": item.blend_mode,
                    "sourceFinalAssetId": source_final_asset_id,
                    "providerMetadata": _sanitize_external_metadata(result.provider_metadata),
                    "layerMetadata": _sanitize_external_metadata(item.metadata),
                },
            )
        )
    return specs


def _sanitize_external_metadata(value: object) -> dict[str, object]:
    if not isinstance(value, Mapping):
        return {}

    sanitized = _sanitize_mapping(value, parent_key="")
    return sanitized if isinstance(sanitized, dict) else {}


def _sanitize_mapping(value: Mapping[object, object], *, parent_key: str) -> dict[str, object]:
    sanitized: dict[str, object] = {}
    for raw_key, raw_value in value.items():
        key = str(raw_key)
        lowered = key.lower()
        if _looks_sensitive_key(lowered):
            continue

        qualified_key = f"{parent_key}.{lowered}" if parent_key else lowered
        sanitized_value = _sanitize_value(raw_value, qualified_key=qualified_key)
        if sanitized_value is None:
            continue
        sanitized[key] = sanitized_value
    return sanitized


def _sanitize_sequence(values: list[object] | tuple[object, ...], *, qualified_key: str) -> list[object]:
    sanitized_items: list[object] = []
    for item in values:
        sanitized = _sanitize_value(item, qualified_key=qualified_key)
        if sanitized is None:
            continue
        sanitized_items.append(sanitized)
    return sanitized_items


def _sanitize_value(value: object, *, qualified_key: str) -> object | None:
    if isinstance(value, Mapping):
        return _sanitize_mapping(value, parent_key=qualified_key)
    if isinstance(value, list):
        return _sanitize_sequence(value, qualified_key=qualified_key)
    if isinstance(value, tuple):
        return _sanitize_sequence(list(value), qualified_key=qualified_key)
    if isinstance(value, str):
        if value.startswith("http://") or value.startswith("https://"):
            return _sanitize_url(value)
        if _looks_sensitive_string(value, qualified_key=qualified_key):
            return None
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


def _looks_sensitive_key(key: str) -> bool:
    sensitive_fragments = (
        "api_key",
        "apikey",
        "token",
        "secret",
        "authorization",
        "password",
        "bearer",
        "cookie",
        "session",
        "envelope",
        "headers",
    )
    return any(fragment in key for fragment in sensitive_fragments)


def _looks_sensitive_string(value: str, *, qualified_key: str) -> bool:
    lowered = value.lower()
    if qualified_key.endswith("request") or qualified_key.endswith("response") or "envelope" in qualified_key:
        return True
    sensitive_fragments = (
        "bearer ",
        "authorization:",
        "api_key",
        "apikey",
        "token=",
        "secret",
        "password",
        "cookie:",
    )
    return any(fragment in lowered for fragment in sensitive_fragments)


def _sanitize_url(value: str) -> str:
    parts = urlsplit(value)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    if query_pairs:
        redacted_query = urlencode([(key, "***") for key, _ in query_pairs], doseq=True)
    else:
        redacted_query = ""
    return urlunsplit((parts.scheme, parts.netloc, parts.path, redacted_query, ""))


def _file_extension_for_mime_type(mime_type: str) -> str:
    if mime_type == "image/png":
        return "png"
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type == "image/webp":
        return "webp"
    if mime_type == "image/svg+xml":
        return "svg"
    raise ProviderSchemaError(
        "Image generation returned an unsupported mime type.",
        provider="openai-mixed-provider",
        details={"mimeType": mime_type},
    )
