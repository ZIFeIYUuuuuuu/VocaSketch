from __future__ import annotations

import os

from pydantic import BaseModel, Field

from .base import ProviderProfile


class ProviderConfigError(ValueError):
    pass


class OpenAIProviderConfig(BaseModel):
    apiBaseUrl: str | None = None
    apiKey: str | None = None
    responseModel: str | None = None
    imageModel: str | None = None
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

    return ProviderConfig(
        profile=profile,
        allowLiveRequests=allow_live_requests,
        openai=OpenAIProviderConfig(
            apiBaseUrl=_optional_env("VOCASKETCH_OPENAI_API_BASE_URL"),
            apiKey=_optional_env("VOCASKETCH_OPENAI_API_KEY"),
            responseModel=_optional_env("VOCASKETCH_OPENAI_RESPONSE_MODEL"),
            imageModel=_optional_env("VOCASKETCH_OPENAI_IMAGE_MODEL"),
            timeoutSeconds=float(os.getenv("VOCASKETCH_OPENAI_TIMEOUT_SECONDS", "20")),
        ),
        dashscope=DashScopeProviderConfig(
            apiBaseUrl=_optional_env("VOCASKETCH_DASHSCOPE_API_BASE_URL"),
            textModel=_optional_env("VOCASKETCH_DASHSCOPE_TEXT_MODEL"),
            imageModel=_optional_env("VOCASKETCH_DASHSCOPE_IMAGE_MODEL"),
        ),
        comfyui=ComfyUIProviderConfig(
            baseUrl=_optional_env("VOCASKETCH_COMFYUI_BASE_URL"),
            workflowName=_optional_env("VOCASKETCH_COMFYUI_WORKFLOW_NAME"),
        ),
        local=LocalProviderConfig(
            runtimeName=_optional_env("VOCASKETCH_LOCAL_PROVIDER_RUNTIME"),
            assetsRoot=_optional_env("VOCASKETCH_LOCAL_PROVIDER_ASSETS_ROOT"),
        ),
    )


def _optional_env(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None
