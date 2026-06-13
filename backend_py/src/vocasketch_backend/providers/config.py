from __future__ import annotations

import os
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from .base import ProviderProfile


class ProviderConfigError(ValueError):
    pass


class OpenAIProviderConfig(BaseModel):
    apiBaseUrl: str | None = None
    apiKey: str | None = None
    responseModel: str | None = None
    imageModel: str | None = None
    layerModel: str | None = None
    timeoutSeconds: float = 20.0


class DashScopeProviderConfig(BaseModel):
    apiBaseUrl: str | None = None
    textModel: str | None = None
    imageModel: str | None = None


class ComfyUIProviderConfig(BaseModel):
    baseUrl: str | None = None
    workflowName: str | None = None


class LocalProviderConfig(BaseModel):
    runtimeName: str | None = None
    assetsRoot: str | None = None


class ProviderConfig(BaseModel):
    profile: ProviderProfile = ProviderProfile.mock
    allowLiveRequests: bool = False
    openai: OpenAIProviderConfig = Field(default_factory=OpenAIProviderConfig)
    dashscope: DashScopeProviderConfig = Field(default_factory=DashScopeProviderConfig)
    comfyui: ComfyUIProviderConfig = Field(default_factory=ComfyUIProviderConfig)
    local: LocalProviderConfig = Field(default_factory=LocalProviderConfig)


def get_provider_config() -> ProviderConfig:
    profile_value = os.getenv("VOCASKETCH_PROVIDER_PROFILE", ProviderProfile.mock.value).strip().lower()
    try:
        profile = ProviderProfile(profile_value)
    except ValueError as exc:
        supported = ", ".join(item.value for item in ProviderProfile)
        raise ProviderConfigError(
            f"Unsupported provider profile '{profile_value}'. Expected one of: {supported}."
        ) from exc

    allow_live_requests = os.getenv("VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    config = ProviderConfig(
        profile=profile,
        allowLiveRequests=allow_live_requests,
    )

    if profile == ProviderProfile.openai:
        openai_config = OpenAIProviderConfig(
            apiBaseUrl=_optional_env("VOCASKETCH_OPENAI_API_BASE_URL"),
            apiKey=_optional_env("VOCASKETCH_OPENAI_API_KEY"),
            responseModel=_optional_env("VOCASKETCH_OPENAI_RESPONSE_MODEL"),
            imageModel=_optional_env("VOCASKETCH_OPENAI_IMAGE_MODEL"),
            layerModel=_optional_env("VOCASKETCH_OPENAI_LAYER_MODEL"),
            timeoutSeconds=_parse_positive_float_env("VOCASKETCH_OPENAI_TIMEOUT_SECONDS", default=20.0),
        )
        _validate_optional_http_url("VOCASKETCH_OPENAI_API_BASE_URL", openai_config.apiBaseUrl)
        return config.model_copy(update={"openai": openai_config})

    if profile == ProviderProfile.dashscope:
        return config.model_copy(update={"dashscope": DashScopeProviderConfig(
            apiBaseUrl=_optional_env("VOCASKETCH_DASHSCOPE_API_BASE_URL"),
            textModel=_optional_env("VOCASKETCH_DASHSCOPE_TEXT_MODEL"),
            imageModel=_optional_env("VOCASKETCH_DASHSCOPE_IMAGE_MODEL"),
        )})

    if profile == ProviderProfile.comfyui:
        return config.model_copy(update={"comfyui": ComfyUIProviderConfig(
            baseUrl=_optional_env("VOCASKETCH_COMFYUI_BASE_URL"),
            workflowName=_optional_env("VOCASKETCH_COMFYUI_WORKFLOW_NAME"),
        )})

    if profile == ProviderProfile.local:
        return config.model_copy(update={"local": LocalProviderConfig(
            runtimeName=_optional_env("VOCASKETCH_LOCAL_PROVIDER_RUNTIME"),
            assetsRoot=_optional_env("VOCASKETCH_LOCAL_PROVIDER_ASSETS_ROOT"),
        )})

    return config


def _optional_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _parse_positive_float_env(name: str, *, default: float) -> float:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        parsed = float(raw_value)
    except ValueError as exc:
        raise ProviderConfigError(f"{name} must be a positive number of seconds.") from exc
    if parsed <= 0:
        raise ProviderConfigError(f"{name} must be greater than 0 seconds.")
    return parsed


def _validate_optional_http_url(name: str, value: str | None) -> None:
    if value is None:
        return
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ProviderConfigError(f"{name} must be an absolute http(s) URL.")
