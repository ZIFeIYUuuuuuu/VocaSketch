from __future__ import annotations

import importlib.util
from collections.abc import Awaitable, Callable

from ..assets.asset_store import AssetStore
from ..models import DrawingJob
from ..providers.base import ProviderGateway
from .nodes import (
    build_image_prompt_node,
    build_playback_manifest_node,
    build_visual_brief_node,
    decompose_layers_node,
    generate_final_image_node,
    generate_preview_node,
    parse_intent_node,
)
from .state import DrawingWorkflowState

NodeCallable = Callable[[DrawingWorkflowState], Awaitable[DrawingWorkflowState]]


def langgraph_runtime_available() -> bool:
    return importlib.util.find_spec("langgraph") is not None


class DrawingGraphRunner:
    def __init__(
        self,
        provider_gateway: ProviderGateway,
        asset_store: AssetStore,
        *,
        enable_langgraph: bool = True,
    ) -> None:
        self._provider_gateway = provider_gateway
        self._asset_store = asset_store
        self._langgraph_enabled = enable_langgraph
        self._backend_name = "sequential"
        self._compiled_single_node_graphs: dict[str, object] = {}
        self._compiled_flow_graphs: dict[str, object] = {}
        self._node_order = {
            "parse_intent": self._sequential_parse_intent,
            "build_visual_brief": self._sequential_build_visual_brief,
            "build_image_prompt": self._sequential_build_image_prompt,
            "generate_preview": self._sequential_generate_preview,
            "generate_final_image": self._sequential_generate_final_image,
            "decompose_layers": self._sequential_decompose_layers,
            "build_playback_manifest": self._sequential_build_playback_manifest,
        }
        self._initialize_backend()

    async def load_state(self, job: DrawingJob) -> DrawingWorkflowState:
        preview_asset = None
        final_asset = None
        manifest_asset = None
        if job.previewAssetId:
            preview_asset = await self._asset_store.get_asset(job.previewAssetId)
        if job.finalAssetId:
            final_asset = await self._asset_store.get_asset(job.finalAssetId)
        if job.playbackManifestAssetId:
            manifest_asset = await self._asset_store.get_asset(job.playbackManifestAssetId)
        return DrawingWorkflowState.from_job(
            job,
            preview_asset=preview_asset,
            final_asset=final_asset,
            playback_manifest_asset=manifest_asset,
        )

    async def run_parse_intent(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("parse_intent", state)

    async def run_build_visual_brief(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("build_visual_brief", state)

    async def run_build_image_prompt(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("build_image_prompt", state)

    async def run_generate_preview(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("generate_preview", state)

    async def run_generate_final_image(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("generate_final_image", state)

    async def run_decompose_layers(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("decompose_layers", state)

    async def run_build_playback_manifest(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_node("build_playback_manifest", state)

    async def run_until_preview_ready(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_flow("preconfirm", state)

    async def run_after_confirm(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await self._invoke_flow("postconfirm", state)

    @property
    def backend_name(self) -> str:
        return self._backend_name

    @property
    def uses_langgraph(self) -> bool:
        return self._backend_name == "langgraph"

    def _initialize_backend(self) -> None:
        if not self._langgraph_enabled:
            self._backend_name = "sequential"
            return
        if not langgraph_runtime_available():
            self._backend_name = "sequential"
            return
        self._backend_name = "langgraph"

    async def _invoke_node(self, node_name: str, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if self.uses_langgraph:
            return await self._invoke_node_with_langgraph(node_name, state)
        return await self._node_order[node_name](state)

    async def _invoke_flow(self, flow_name: str, state: DrawingWorkflowState) -> DrawingWorkflowState:
        if self.uses_langgraph:
            return await self._invoke_flow_with_langgraph(flow_name, state)
        if flow_name == "preconfirm":
            state = await self._sequential_parse_intent(state)
            state = await self._sequential_build_visual_brief(state)
            state = await self._sequential_build_image_prompt(state)
            state = await self._sequential_generate_preview(state)
            return state
        if flow_name == "postconfirm":
            state = await self._sequential_generate_final_image(state)
            state = await self._sequential_decompose_layers(state)
            state = await self._sequential_build_playback_manifest(state)
            return state
        raise ValueError(f"unknown flow: {flow_name}")

    async def _invoke_node_with_langgraph(self, node_name: str, state: DrawingWorkflowState) -> DrawingWorkflowState:
        graph = self._compiled_single_node_graphs.get(node_name)
        if graph is None:
            graph = self._build_single_node_graph(node_name)
            self._compiled_single_node_graphs[node_name] = graph
        result = await graph.ainvoke(state.model_dump(mode="python"))
        return DrawingWorkflowState.model_validate(result)

    async def _invoke_flow_with_langgraph(self, flow_name: str, state: DrawingWorkflowState) -> DrawingWorkflowState:
        graph = self._compiled_flow_graphs.get(flow_name)
        if graph is None:
            graph = self._build_flow_graph(flow_name)
            self._compiled_flow_graphs[flow_name] = graph
        result = await graph.ainvoke(state.model_dump(mode="python"))
        return DrawingWorkflowState.model_validate(result)

    def _build_single_node_graph(self, node_name: str):
        from langgraph.graph import END, START, StateGraph

        graph = StateGraph(dict)
        graph.add_node(node_name, self._to_langgraph_node(self._node_order[node_name]))
        graph.add_edge(START, node_name)
        graph.add_edge(node_name, END)
        return graph.compile()

    def _build_flow_graph(self, flow_name: str):
        from langgraph.graph import END, START, StateGraph

        sequences = {
            "preconfirm": ["parse_intent", "build_visual_brief", "build_image_prompt", "generate_preview"],
            "postconfirm": ["generate_final_image", "decompose_layers", "build_playback_manifest"],
        }
        steps = sequences[flow_name]
        graph = StateGraph(dict)
        for node_name in steps:
            graph.add_node(node_name, self._to_langgraph_node(self._node_order[node_name]))
        graph.add_edge(START, steps[0])
        for current, nxt in zip(steps, steps[1:]):
            graph.add_edge(current, nxt)
        graph.add_edge(steps[-1], END)
        return graph.compile()

    def _to_langgraph_node(self, node_callable: NodeCallable):
        async def runner(payload: dict) -> dict:
            state = DrawingWorkflowState.model_validate(payload)
            updated = await node_callable(state)
            return updated.model_dump(mode="python")

        return runner

    async def _sequential_parse_intent(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await parse_intent_node(state, self._provider_gateway)

    async def _sequential_build_visual_brief(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await build_visual_brief_node(state, self._provider_gateway)

    async def _sequential_build_image_prompt(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await build_image_prompt_node(state, self._provider_gateway)

    async def _sequential_generate_preview(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await generate_preview_node(state, self._provider_gateway, self._asset_store)

    async def _sequential_generate_final_image(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await generate_final_image_node(state, self._provider_gateway, self._asset_store)

    async def _sequential_decompose_layers(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await decompose_layers_node(state, self._provider_gateway, self._asset_store)

    async def _sequential_build_playback_manifest(self, state: DrawingWorkflowState) -> DrawingWorkflowState:
        return await build_playback_manifest_node(state, self._provider_gateway, self._asset_store)
