from __future__ import annotations

import asyncio
import importlib.util
import os
import sys
import tempfile
import time
import unittest
import warnings
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient


warnings.filterwarnings("ignore", category=UserWarning)

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = WORKSPACE_ROOT / "backend_py" / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from vocasketch_backend.main import create_app
from vocasketch_backend.providers.mock import MockProviderGateway, stable_seed_for_text


class Stage4BackendTests(unittest.TestCase):
    def _client(self, *, disable_langgraph: bool = False, patch_langgraph_available: bool | None = None):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage4_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
            "VOCASKETCH_PROVIDER_PROFILE": "mock",
            "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "0",
            "VOCASKETCH_OPENAI_API_BASE_URL": "",
            "VOCASKETCH_OPENAI_API_KEY": "",
            "VOCASKETCH_OPENAI_RESPONSE_MODEL": "",
            "VOCASKETCH_OPENAI_IMAGE_MODEL": "",
            "VOCASKETCH_OPENAI_LAYER_MODEL": "",
        }
        if disable_langgraph:
            env_patch["VOCASKETCH_DISABLE_LANGGRAPH"] = "1"
        else:
            env_patch.pop("VOCASKETCH_DISABLE_LANGGRAPH", None)

        patchers = [mock.patch.dict(os.environ, env_patch, clear=False)]
        if patch_langgraph_available is not None:
            patchers.append(
                mock.patch(
                    "vocasketch_backend.workflows.drawing_graph.langgraph_runtime_available",
                    return_value=patch_langgraph_available,
                )
            )

        class _ClientContext:
            def __enter__(self_inner):
                try:
                    for patcher in patchers:
                        patcher.start()
                    self_inner.app = create_app()
                    self_inner.client = TestClient(self_inner.app)
                    self_inner.client.__enter__()
                    return self_inner.client
                except Exception:
                    for patcher in reversed(patchers):
                        patcher.stop()
                    tempdir.cleanup()
                    raise

            def __exit__(self_inner, exc_type, exc, tb):
                self_inner.client.__exit__(exc_type, exc, tb)
                for patcher in reversed(patchers):
                    patcher.stop()
                tempdir.cleanup()

        return _ClientContext()

    def _wait_for_status(self, client: TestClient, job_id: str, target_status: str, attempts: int = 150) -> dict:
        body = {}
        for _ in range(attempts):
            response = client.get(f"/api/v2/drawing-jobs/{job_id}")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            if body["status"] == target_status:
                return body
            time.sleep(0.02)
        self.fail(f"job {job_id} did not reach {target_status}; last body={body}")

    def test_fallback_startup_without_langgraph(self):
        with self._client(patch_langgraph_available=False) as client:
            self.assertEqual(client.app.state.drawing_graph.backend_name, "sequential")

    def test_default_startup_prefers_langgraph_when_available(self):
        if importlib.util.find_spec("langgraph") is None:
            self.skipTest("langgraph is not installed in this environment")

        with self._client() as client:
            self.assertEqual(client.app.state.drawing_graph.backend_name, "langgraph")

    def test_create_preview_confirm_completed(self):
        with self._client() as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "画一个蓝色长发角色", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertTrue(preview["requiresConfirmation"])

            confirmed = client.post(
                f"/api/v2/drawing-jobs/{job_id}/confirm",
                json={"notes": "stage4 test"},
            )
            self.assertEqual(confirmed.status_code, 200, confirmed.text)

            completed = self._wait_for_status(client, job_id, "completed")
            self.assertTrue(completed["finalAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])
            self.assertTrue(completed["playbackManifest"])
            self.assertGreaterEqual(len(completed["layerAssets"]), 1)

            final_asset = client.get(f"/api/v2/assets/{completed['finalAssetId']}")
            self.assertEqual(final_asset.status_code, 200, final_asset.text)

            manifest_asset = client.get(f"/api/v2/assets/{completed['playbackManifestAssetId']}")
            self.assertEqual(manifest_asset.status_code, 200, manifest_asset.text)

    def test_invalid_ids_return_400(self):
        with self._client() as client:
            bad_job = client.get("/api/v2/drawing-jobs/bad$id")
            self.assertEqual(bad_job.status_code, 400, bad_job.text)

            bad_asset = client.get("/api/v2/assets/bad$id")
            self.assertEqual(bad_asset.status_code, 400, bad_asset.text)

    def test_simulate_failure_and_retry(self):
        with self._client() as client:
            failing = client.post(
                "/api/v2/drawing-jobs",
                json={
                    "inputText": "故障测试",
                    "locale": "zh-CN",
                    "simulateFailureAt": "preview_generating",
                },
            )
            self.assertEqual(failing.status_code, 202, failing.text)
            failing_job_id = failing.json()["jobId"]

            failed = self._wait_for_status(client, failing_job_id, "failed")
            self.assertEqual(failed["error"]["code"], "MOCK_WORKFLOW_FAILED")

            retried = client.post(
                f"/api/v2/drawing-jobs/{failing_job_id}/retry",
                json={"fromPhase": "preview_generating", "reason": "retry test"},
            )
            self.assertEqual(retried.status_code, 202, retried.text)
            retried_body = retried.json()
            self.assertNotEqual(retried_body["jobId"], failing_job_id)
            self.assertEqual(retried_body["retryOfJobId"], failing_job_id)

    def test_seed_is_stable_for_same_input(self):
        input_text = "画一个蓝色长发角色"
        seed_one = stable_seed_for_text(input_text)
        seed_two = stable_seed_for_text(input_text)
        self.assertEqual(seed_one, seed_two)

        provider = MockProviderGateway()
        state_factory = {
            "jobId": "job_test",
            "inputText": input_text,
            "locale": "zh-CN",
            "status": "queued",
            "progressPercent": 0,
        }
        from vocasketch_backend.workflows.state import DrawingWorkflowState

        prompt_one = asyncio.run(provider.build_image_prompt(DrawingWorkflowState.model_validate(state_factory)))
        prompt_two = asyncio.run(provider.build_image_prompt(DrawingWorkflowState.model_validate(state_factory)))
        self.assertEqual(prompt_one.seed, prompt_two.seed)


if __name__ == "__main__":
    unittest.main(verbosity=2)
