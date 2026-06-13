from __future__ import annotations

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
from ..providers.process_playback import enrich_manifest_with_process
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
        playback_manifest = enrich_manifest_with_process(
            playback_manifest,
            preview_asset=state.previewAsset,
            final_asset=state.finalAsset,
            preview_content_path=preview_content_path,
            final_content_path=final_content_path,
        )
        manifest_asset = await asset_store.save_playback_manifest(state.jobId, playback_manifest)
    except ProviderError as exc:
        raise WorkflowNodeError("build_playback_manifest_node", str(exc), cause=exc) from exc
    return state.model_copy(update={"playbackManifest": playback_manifest, "playbackManifestAsset": manifest_asset})
