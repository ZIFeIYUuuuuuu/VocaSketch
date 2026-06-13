from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .base import ProviderGateway, ProviderProfile, ProviderRuntimeInfo
from .config import ProviderConfig, ProviderConfigError
from .mock import MockProviderGateway
from .openai_text import OpenAITextProviderGateway
from .placeholders import (
    ComfyUIProviderGateway,
    DashScopeProviderGateway,
    LocalProviderGateway,
    OpenAIProviderGateway,
    build_placeholder_runtime_info,
)
from .transports import (
    DashScopeImageTransport,
    ImageGenerationTransport,
    LayerDecompositionTransport,
    OpenAIChatCompatibleImageTransport,
    OpenAICompatibleImageTransport,
    OpenAICompatibleLayerTransport,
    OpenAICompatibleTextTransport,
    TextGenerationTransport,
)


@dataclass(frozen=True)
class ProviderBuildResult:
    gateway: ProviderGateway
    runtime_info: ProviderRuntimeInfo


def create_provider_gateway(config: ProviderConfig) -> ProviderBuildResult:
    if config.profile == ProviderProfile.mock:
        gateway = MockProviderGateway()
        return ProviderBuildResult(gateway=gateway, runtime_info=gateway.runtime_info)

    if config.profile == ProviderProfile.openai:
        _require_fields(
            profile=config.profile,
            required={
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": config.openai.responseModel,
            },
        )
        if config.allowLiveRequests:
            _require_live_fields(
                profile=config.profile,
                required={
                    "VOCASKETCH_OPENAI_API_BASE_URL": config.openai.apiBaseUrl,
                    "VOCASKETCH_OPENAI_API_KEY": config.openai.apiKey,
                },
            )
            gateway = OpenAITextProviderGateway(
                api_base_url=config.openai.apiBaseUrl or "",
                safe_api_base_url=_sanitize_url(config.openai.apiBaseUrl),
                api_key=config.openai.apiKey or "",
                image_api_base_url=config.openai.imageApiBaseUrl or config.openai.apiBaseUrl or "",
                safe_image_api_base_url=_sanitize_url(config.openai.imageApiBaseUrl or config.openai.apiBaseUrl),
                image_api_key=config.openai.imageApiKey or config.openai.apiKey or "",
                image_group=config.openai.imageGroup,
                text_model=config.openai.responseModel or "",
                image_model=config.openai.imageModel,
                layer_model=config.openai.layerModel,
                timeout_seconds=config.openai.timeoutSeconds,
                text_transport=build_openai_text_transport(config),
                image_transport=build_openai_image_transport(config) if config.openai.imageModel else None,
                layer_transport=build_openai_layer_transport(config) if config.openai.layerModel else None,
                asset_provider=MockProviderGateway(),
            )
            return ProviderBuildResult(gateway=gateway, runtime_info=gateway.runtime_info)

        gateway = OpenAIProviderGateway(
            build_placeholder_runtime_info(
                profile=config.profile,
                provider_name="openai-placeholder",
                safe_settings={
                    "apiBaseUrl": _sanitize_url(config.openai.apiBaseUrl),
                    "imageApiBaseUrl": _sanitize_url(config.openai.imageApiBaseUrl or config.openai.apiBaseUrl),
                    "imageTransport": config.openai.imageTransport,
                    "imageGroup": config.openai.imageGroup,
                    "responseModel": config.openai.responseModel,
                    "imageModel": config.openai.imageModel,
                    "layerModel": config.openai.layerModel,
                    "allowLiveRequests": False,
                },
            )
        )
        return ProviderBuildResult(gateway=gateway, runtime_info=gateway.runtime_info)

    if config.profile == ProviderProfile.dashscope:
        _require_fields(
            profile=config.profile,
            required={
                "VOCASKETCH_DASHSCOPE_TEXT_MODEL": config.dashscope.textModel,
                "VOCASKETCH_DASHSCOPE_IMAGE_MODEL": config.dashscope.imageModel,
            },
        )
        gateway = DashScopeProviderGateway(
            build_placeholder_runtime_info(
                profile=config.profile,
                provider_name="dashscope-placeholder",
                safe_settings={
                    "apiBaseUrl": _sanitize_url(config.dashscope.apiBaseUrl),
                    "textModel": config.dashscope.textModel,
                    "imageModel": config.dashscope.imageModel,
                },
            )
        )
        return ProviderBuildResult(gateway=gateway, runtime_info=gateway.runtime_info)

    if config.profile == ProviderProfile.comfyui:
        _require_fields(
            profile=config.profile,
            required={
                "VOCASKETCH_COMFYUI_BASE_URL": config.comfyui.baseUrl,
                "VOCASKETCH_COMFYUI_WORKFLOW_NAME": config.comfyui.workflowName,
            },
        )
        gateway = ComfyUIProviderGateway(
            build_placeholder_runtime_info(
                profile=config.profile,
                provider_name="comfyui-placeholder",
                safe_settings={
                    "baseUrl": _sanitize_url(config.comfyui.baseUrl),
                    "workflowName": config.comfyui.workflowName,
                },
            )
        )
        return ProviderBuildResult(gateway=gateway, runtime_info=gateway.runtime_info)

    if config.profile == ProviderProfile.local:
        _require_fields(
            profile=config.profile,
            required={
                "VOCASKETCH_LOCAL_PROVIDER_RUNTIME": config.local.runtimeName,
            },
        )
        gateway = LocalProviderGateway(
            build_placeholder_runtime_info(
                profile=config.profile,
                provider_name="local-placeholder",
                safe_settings={
                    "runtimeName": config.local.runtimeName,
                    "assetsRoot": config.local.assetsRoot,
                },
            )
        )
        return ProviderBuildResult(gateway=gateway, runtime_info=gateway.runtime_info)

    raise ProviderConfigError(f"Unsupported provider profile '{config.profile.value}'.")


def _require_fields(*, profile: ProviderProfile, required: dict[str, str | None]) -> None:
    missing = [name for name, value in required.items() if not value]
    if missing:
        missing_joined = ", ".join(missing)
        raise ProviderConfigError(
            f"Provider profile '{profile.value}' is not ready to start. Missing required non-secret configuration: {missing_joined}."
        )


def build_openai_text_transport(config: ProviderConfig) -> TextGenerationTransport:
    return OpenAICompatibleTextTransport()


def build_openai_image_transport(config: ProviderConfig) -> ImageGenerationTransport:
    if config.openai.imageTransport == "dashscope":
        return DashScopeImageTransport()
    if config.openai.imageTransport == "openai-chat-compatible":
        return OpenAIChatCompatibleImageTransport()
    return OpenAICompatibleImageTransport()


def build_openai_layer_transport(config: ProviderConfig) -> LayerDecompositionTransport:
    return OpenAICompatibleLayerTransport()


def _require_live_fields(*, profile: ProviderProfile, required: dict[str, str | None]) -> None:
    missing = [name for name, value in required.items() if not value]
    if missing:
        missing_joined = ", ".join(missing)
        raise ProviderConfigError(
            f"Provider profile '{profile.value}' live mode is not ready to start. Missing required configuration: {missing_joined}."
        )


def _sanitize_url(value: str | None) -> str | None:
    if not value:
        return value

    parts = urlsplit(value)
    hostname = parts.hostname or ""
    port = f":{parts.port}" if parts.port is not None else ""
    userinfo = ""
    if parts.username or parts.password:
        username = parts.username or ""
        userinfo = f"{username}:***@" if parts.password else f"{username}@"
    netloc = f"{userinfo}{hostname}{port}"

    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    if query_pairs:
        redacted_query = urlencode([(key, "***") for key, _ in query_pairs], doseq=True)
    else:
        redacted_query = ""

    return urlunsplit((parts.scheme, netloc, parts.path, redacted_query, ""))
