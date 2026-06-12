from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .base import ProviderGateway, ProviderProfile, ProviderRuntimeInfo
from .config import ProviderConfig, ProviderConfigError
from .mock import MockProviderGateway
from .placeholders import (
    ComfyUIProviderGateway,
    DashScopeProviderGateway,
    LocalProviderGateway,
    OpenAIProviderGateway,
    build_placeholder_runtime_info,
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
                "VOCASKETCH_OPENAI_IMAGE_MODEL": config.openai.imageModel,
            },
        )
        gateway = OpenAIProviderGateway(
            build_placeholder_runtime_info(
                profile=config.profile,
                provider_name="openai-placeholder",
                safe_settings={
                    "apiBaseUrl": _sanitize_url(config.openai.apiBaseUrl),
                    "responseModel": config.openai.responseModel,
                    "imageModel": config.openai.imageModel,
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
