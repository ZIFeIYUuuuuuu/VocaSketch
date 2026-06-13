from __future__ import annotations

from fastapi import APIRouter, Request

from ..providers.base import ProviderProfile, ProviderRuntimeInfo
from ..workflows.drawing_graph import langgraph_runtime_available

router = APIRouter(prefix="/api/v2/runtime", tags=["runtime"])


@router.get("/readiness")
async def get_runtime_readiness(request: Request) -> dict:
    config = request.app.state.config
    provider_config = request.app.state.provider_config
    runtime_info: ProviderRuntimeInfo = request.app.state.provider_runtime_info
    drawing_graph = request.app.state.drawing_graph
    storage_readiness = request.app.state.storage_readiness

    return {
        "status": "ready",
        "app": {
            "name": config.app_name,
            "version": config.app_version,
        },
        "provider": {
            "profile": runtime_info.profile.value,
            "providerName": runtime_info.provider_name,
            "allowLiveRequests": provider_config.allowLiveRequests,
            "networkEnabled": runtime_info.network_enabled,
            "configured": runtime_info.configured,
            "placeholder": runtime_info.placeholder,
            "capabilities": {
                "preview": runtime_info.capabilities.supports_preview,
                "final": runtime_info.capabilities.supports_final,
                "layerDecomposition": runtime_info.capabilities.supports_layer_decomposition,
                "playbackManifest": runtime_info.capabilities.supports_playback_manifest,
            },
            "modes": _provider_modes(runtime_info),
            "safeSettings": runtime_info.safe_settings,
        },
        "storage": storage_readiness,
        "workflow": {
            "runnerMode": drawing_graph.backend_name,
            "usesLangGraph": drawing_graph.uses_langgraph,
            "langGraphAvailable": langgraph_runtime_available(),
            "langGraphDisabled": config.disable_langgraph,
        },
    }


def _provider_modes(runtime_info: ProviderRuntimeInfo) -> dict[str, str]:
    if runtime_info.profile == ProviderProfile.mock:
        return {
            "text": "mock",
            "preview": "mock",
            "final": "mock",
            "layers": "mock",
            "playback": "mock",
        }
    if runtime_info.placeholder:
        return {
            "text": "placeholder",
            "preview": "placeholder",
            "final": "placeholder",
            "layers": "placeholder",
            "playback": "placeholder",
        }

    mode = str(runtime_info.safe_settings.get("mode", "unknown"))
    return {
        "text": "live" if mode.startswith("live-text") else "mock",
        "preview": "live" if "live-image" in mode else "mock",
        "final": "live" if "live-image" in mode else "mock",
        "layers": "live" if "live-layers" in mode else "mock",
        "playback": "mock",
    }
