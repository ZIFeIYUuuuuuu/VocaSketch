from __future__ import annotations

import hashlib

from ..models import ImagePrompt, ParsedIntent, PlaybackManifest, VisualBrief
from ..workflows.state import DrawingWorkflowState
from .base import GeneratedAssetSpec, ProviderGateway


def stable_seed_for_text(input_text: str) -> int:
    digest = hashlib.blake2b(input_text.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") % 1_000_000


class MockProviderGateway(ProviderGateway):
    async def parse_intent(self, *, job_id: str, input_text: str, locale: str) -> ParsedIntent:
        return ParsedIntent(
            subject="anime watercolor portrait",
            style="high-quality watercolor illustration",
            composition="half-body portrait with clean character focus",
            constraints=[
                "prioritize polish over speed",
                "preserve readable silhouette",
                "support layer-based playback",
            ],
            edits=[],
            ambiguities=[],
            confidence=0.94,
        )

    async def build_visual_brief(self, state: DrawingWorkflowState) -> VisualBrief:
        return VisualBrief(
            artDirection="soft anime watercolor with polished lighting",
            camera="medium close-up, portrait orientation",
            palette=["sky blue", "rose pink", "warm ivory", "soft violet"],
            mood="dreamy and clean",
            characterSpec=f"Interpret the request as a premium illustrated character portrait based on: {state.inputText}",
            backgroundSpec="minimal watercolor backdrop with soft atmospheric contrast",
            negativeConstraints=["no rough stick-figure canvas output", "no unfinished silhouette"],
        )

    async def build_image_prompt(self, state: DrawingWorkflowState) -> ImagePrompt:
        prompt_seed = stable_seed_for_text(state.inputText)
        return ImagePrompt(
            model="mock-preview-final-pipeline",
            positivePrompt=(
                "Best-quality anime watercolor portrait, refined facial features, layered paint workflow, "
                f"user intent: {state.inputText}"
            ),
            negativePrompt="messy lines, crude canvas doodle, unfinished paint, distorted anatomy",
            size="1024x1024",
            guidance="Preserve the feeling of a staged painting workflow that can later map to playback layers.",
            seed=prompt_seed,
        )

    async def generate_preview(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        return GeneratedAssetSpec(
            kind="preview",
            role="preview",
            label="Preview Image",
            mime_type="application/json",
            width=1024,
            height=1024,
            metadata={
                "provider": "mock-provider",
                "note": "Preview is metadata only in phase three.",
                "inputText": state.inputText,
            },
        )

    async def generate_final_image(self, state: DrawingWorkflowState) -> GeneratedAssetSpec:
        return GeneratedAssetSpec(
            kind="final",
            role="final_image",
            label="Final Image",
            mime_type="application/json",
            width=1024,
            height=1024,
            metadata={
                "provider": "mock-provider",
                "note": "Final image is metadata only in phase three.",
                "inputText": state.inputText,
            },
        )

    async def decompose_layers(self, state: DrawingWorkflowState) -> list[GeneratedAssetSpec]:
        roles = [
            ("sketch", "Sketch Layer"),
            ("lineart", "Line Art Layer"),
            ("flat_color", "Flat Color Layer"),
            ("shadow", "Shadow Layer"),
            ("lighting", "Lighting Layer"),
            ("details", "Details Layer"),
            ("final_composite", "Final Composite Layer"),
        ]
        return [
            GeneratedAssetSpec(
                kind="layer",
                role=role,
                label=label,
                mime_type="application/json",
                width=1024,
                height=1024,
                metadata={
                    "provider": "mock-provider",
                    "note": f"{label} is metadata only in phase three.",
                },
            )
            for role, label in roles
        ]

    async def build_playback_manifest(self, state: DrawingWorkflowState) -> PlaybackManifest:
        layer_refs = [layer.assetId for layer in state.layerAssets]
        return PlaybackManifest(
            manifestVersion="0.1.0",
            canvasSize={"width": 1024, "height": 1024},
            durationMs=6200,
            layerRefs=layer_refs,
            finalCompositeAssetId=state.finalAsset.assetId if state.finalAsset else None,
            steps=[
                {"step": 1, "phase": "sketch", "assetRole": "sketch", "durationMs": 900},
                {"step": 2, "phase": "lineart", "assetRole": "lineart", "durationMs": 850},
                {"step": 3, "phase": "flat_color", "assetRole": "flat_color", "durationMs": 1000},
                {"step": 4, "phase": "shadow", "assetRole": "shadow", "durationMs": 850},
                {"step": 5, "phase": "lighting", "assetRole": "lighting", "durationMs": 800},
                {"step": 6, "phase": "details", "assetRole": "details", "durationMs": 950},
                {"step": 7, "phase": "final_composite", "assetRole": "final_composite", "durationMs": 850},
            ],
        )
