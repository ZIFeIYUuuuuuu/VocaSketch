from __future__ import annotations

import os

from ..assets.asset_store import AssetStore
from ..models import VisualBrief
from ..providers.base import (
    ImageGenerationProvider,
    ImagePromptProvider,
    IntentParserProvider,
    LayerDecompositionProvider,
    PlaybackManifestProvider,
    ProviderError,
    VisualBriefProvider,
    WorkflowNodeError,
)
from ..providers.model_lineart import generate_model_lineart_asset_spec, is_model_lineart_configured
from ..providers.process_playback import PROCESS_VIDEO_FPS, PROCESS_VIDEO_HEIGHT, PROCESS_VIDEO_WIDTH, enrich_manifest_with_process, render_process_video_bytes
from .state import DrawingWorkflowState


async def parse_intent_node(state: DrawingWorkflowState, provider: IntentParserProvider) -> DrawingWorkflowState:
    try:
        parsed_intent = await provider.parse_intent(
            job_id=state.jobId,
            input_text=state.inputText,
            locale=state.locale,
        )
    except ProviderError as exc:
        raise WorkflowNodeError("parse_intent_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"parsedIntent": parsed_intent})


async def build_visual_brief_node(state: DrawingWorkflowState, provider: VisualBriefProvider) -> DrawingWorkflowState:
    try:
        visual_brief = await provider.build_visual_brief(state)
    except ProviderError as exc:
        raise WorkflowNodeError("build_visual_brief_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"visualBrief": visual_brief})


async def build_image_prompt_node(state: DrawingWorkflowState, provider: ImagePromptProvider) -> DrawingWorkflowState:
    try:
        image_prompt = await provider.build_image_prompt(state)
    except ProviderError as exc:
        raise WorkflowNodeError("build_image_prompt_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"imagePrompt": image_prompt})


async def generate_preview_node(
    state: DrawingWorkflowState,
    provider: ImageGenerationProvider,
    asset_store: AssetStore,
) -> DrawingWorkflowState:
    try:
        spec = await provider.generate_preview(state)
        preview_asset = await asset_store.create_preview_asset(state.jobId, spec)
    except ProviderError as exc:
        raise WorkflowNodeError("generate_preview_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"previewAsset": preview_asset})


async def generate_final_image_node(
    state: DrawingWorkflowState,
    provider: ImageGenerationProvider,
    asset_store: AssetStore,
) -> DrawingWorkflowState:
    try:
        spec = await provider.generate_final_image(state)
        final_asset = await asset_store.create_final_asset(state.jobId, spec)
    except ProviderError as exc:
        raise WorkflowNodeError("generate_final_image_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"finalAsset": final_asset})


async def decompose_layers_node(
    state: DrawingWorkflowState,
    provider: LayerDecompositionProvider,
    asset_store: AssetStore,
) -> DrawingWorkflowState:
    try:
        specs = await provider.decompose_layers(state)
        layer_assets = [await asset_store.create_layer_asset(state.jobId, spec) for spec in specs]
    except ProviderError as exc:
        raise WorkflowNodeError("decompose_layers_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"layerAssets": layer_assets})


async def build_playback_manifest_node(
    state: DrawingWorkflowState,
    provider: PlaybackManifestProvider,
    asset_store: AssetStore,
) -> DrawingWorkflowState:
    try:
        playback_manifest = await provider.build_playback_manifest(state)
        preview_content_path = None
        if state.previewAsset is not None and state.previewAsset.storagePath:
            preview_content = await asset_store.get_asset_content(state.previewAsset.assetId)
            preview_content_path = preview_content.absolute_path if preview_content else None
        final_content_path = None
        if state.finalAsset is not None and state.finalAsset.storagePath:
            final_content = await asset_store.get_asset_content(state.finalAsset.assetId)
            final_content_path = final_content.absolute_path if final_content else None
        lineart_asset = None
        lineart_content_path = None
        layer_assets = list(state.layerAssets)
        if state.finalAsset is not None and final_content_path is not None and is_model_lineart_configured():
            lineart_spec = await generate_model_lineart_asset_spec(
                final_asset=state.finalAsset,
                final_content_path=final_content_path,
                image_prompt=state.imagePrompt,
            )
            lineart_layer = await asset_store.create_layer_asset(state.jobId, lineart_spec)
            layer_assets = [layer for layer in layer_assets if not (layer.role == "lineart" and layer.metadata.get("mode") != "model-clean-lineart")]
            layer_assets = [layer for layer in layer_assets if layer.assetId != lineart_layer.assetId]
            layer_assets.append(lineart_layer)
            layer_assets.sort(key=lambda layer: (layer.order or 999, layer.role, layer.assetId))
            lineart_asset = await asset_store.get_asset(lineart_layer.assetId)
            lineart_content = await asset_store.get_asset_content(lineart_layer.assetId)
            lineart_content_path = lineart_content.absolute_path if lineart_content else None
        else:
            lineart_layer = next(
                (layer for layer in layer_assets if layer.role == "lineart" and layer.metadata.get("mode") == "model-clean-lineart"),
                None,
            )
            if lineart_layer is not None:
                lineart_asset = await asset_store.get_asset(lineart_layer.assetId)
                lineart_content = await asset_store.get_asset_content(lineart_layer.assetId)
                lineart_content_path = lineart_content.absolute_path if lineart_content else None
        playback_manifest = enrich_manifest_with_process(
            playback_manifest,
            preview_asset=state.previewAsset,
            final_asset=state.finalAsset,
            lineart_asset=lineart_asset,
            preview_content_path=preview_content_path,
            final_content_path=final_content_path,
            lineart_content_path=lineart_content_path,
        )
        if playback_manifest.process and final_content_path is not None and _should_render_process_video():
            video_bytes = render_process_video_bytes(
                playback_manifest.process,
                final_content_path=final_content_path,
                preview_content_path=preview_content_path,
            )
            if video_bytes:
                process_video = await asset_store.save_process_video(
                    state.jobId,
                    content_bytes=video_bytes,
                    width=PROCESS_VIDEO_WIDTH,
                    height=PROCESS_VIDEO_HEIGHT,
                    duration_ms=playback_manifest.durationMs,
                    metadata={
                        "processVersion": playback_manifest.process.get("version"),
                        "fps": PROCESS_VIDEO_FPS,
                        "sourceFinalAssetId": state.finalAsset.assetId if state.finalAsset else None,
                    },
                )
                process = dict(playback_manifest.process)
                source = dict(process.get("source") if isinstance(process.get("source"), dict) else {})
                source.update(
                    {
                        "processVideoAssetId": process_video.assetId,
                        "processVideoContentUrl": process_video.contentUrl,
                        "processVideoMimeType": process_video.mimeType,
                    }
                )
                process["source"] = source
                process["renderer"] = "backend-rendered-process-video"
                playback_manifest = playback_manifest.model_copy(update={"process": process})
        manifest_asset = await asset_store.save_playback_manifest(state.jobId, playback_manifest)
    except ProviderError as exc:
        raise WorkflowNodeError("build_playback_manifest_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"layerAssets": layer_assets, "playbackManifest": playback_manifest, "playbackManifestAsset": manifest_asset})


def _should_render_process_video() -> bool:
    return os.getenv("VOCASKETCH_RENDER_PROCESS_VIDEO", "1").strip().lower() not in {"0", "false", "no", "off"}
