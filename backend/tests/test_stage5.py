from __future__ import annotations

import json
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
SRC_ROOT = WORKSPACE_ROOT / "backend" / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from vocasketch_backend.main import create_app
from vocasketch_backend.providers.base import ProviderProfile
from vocasketch_backend.providers.config import ProviderConfigError


class Stage5ProviderTests(unittest.TestCase):
    def _client(self, *, extra_env: dict[str, str] | None = None):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_stage5_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
            "VOCASKETCH_RENDER_PROCESS_VIDEO": "0",
        }
        if extra_env:
            env_patch.update(extra_env)

        patcher = mock.patch.dict(os.environ, env_patch, clear=False)

        class _ClientContext:
            def __enter__(self_inner):
                try:
                    patcher.start()
                    self_inner.app = create_app()
                    self_inner.client = TestClient(self_inner.app)
                    self_inner.client.__enter__()
                    return self_inner.client
                except Exception:
                    patcher.stop()
                    tempdir.cleanup()
                    raise

            def __exit__(self_inner, exc_type, exc, tb):
                self_inner.client.__exit__(exc_type, exc, tb)
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

    def _list_events(self, client: TestClient, job_id: str) -> list[dict]:
        events_path = client.app.state.config.jobs_dir / f"{job_id}.events.json"
        with events_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _wait_for_event_type(self, client: TestClient, job_id: str, event_type: str, attempts: int = 100) -> list[dict]:
        events: list[dict] = []
        for _ in range(attempts):
            events = self._list_events(client, job_id)
            if any(event["type"] == event_type for event in events):
                return events
            time.sleep(0.02)
        self.fail(f"job {job_id} did not emit event type {event_type}; last events={events}")

    def test_default_provider_profile_is_mock(self):
        with self._client() as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.mock)
            self.assertEqual(runtime_info.provider_name, "mock-provider")
            self.assertFalse(runtime_info.network_enabled)
            self.assertFalse(runtime_info.placeholder)

    def test_mock_profile_happy_path_completes(self):
        with self._client(extra_env={"VOCASKETCH_PROVIDER_PROFILE": "mock"}) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "画一个蓝色长发角色", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertFalse(preview["requiresConfirmation"])

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={"notes": "stage5 mock profile"})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)

            completed = self._wait_for_status(client, job_id, "completed")
            self.assertTrue(completed["finalAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])

    def test_unconfigured_non_mock_profile_fails_fast_on_startup(self):
        with self.assertRaises(ProviderConfigError):
            with self._client(extra_env={"VOCASKETCH_PROVIDER_PROFILE": "openai"}):
                pass

    def test_placeholder_provider_fails_job_without_network(self):
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-placeholder",
                "VOCASKETCH_OPENAI_IMAGE_MODEL": "image-placeholder",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://example.invalid/v1",
            }
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.openai)
            self.assertTrue(runtime_info.placeholder)
            self.assertFalse(runtime_info.network_enabled)

            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "使用 openai 占位 provider", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")
            self.assertEqual(failed["error"]["provider"], "openai-placeholder")
            self.assertIn("placeholder", failed["error"]["message"])

    def test_provider_runtime_info_does_not_expose_secret(self):
        secret_value = "super-secret-key"
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-placeholder",
                "VOCASKETCH_OPENAI_IMAGE_MODEL": "image-placeholder",
                "VOCASKETCH_OPENAI_API_KEY": secret_value,
            }
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            serialized = str(runtime_info.safe_settings)
            self.assertNotIn(secret_value, serialized)
            self.assertNotIn("API_KEY", serialized.upper())

    def test_provider_runtime_info_sanitizes_url_query_secrets(self):
        secret_token = "inline-token"
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-placeholder",
                "VOCASKETCH_OPENAI_IMAGE_MODEL": "image-placeholder",
                "VOCASKETCH_OPENAI_API_BASE_URL": f"https://demo.example/v1?token={secret_token}&org=test-org",
            }
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            api_base_url = runtime_info.safe_settings["apiBaseUrl"]
            self.assertEqual(api_base_url, "https://demo.example/v1?token=%2A%2A%2A&org=%2A%2A%2A")
            self.assertNotIn(secret_token, api_base_url)

    def test_retry_event_note_is_neutral(self):
        with self._client(extra_env={"VOCASKETCH_PROVIDER_PROFILE": "mock"}) as client:
            failing = client.post(
                "/api/v2/drawing-jobs",
                json={
                    "inputText": "重试文案测试",
                    "locale": "zh-CN",
                    "simulateFailureAt": "preview_generating",
                },
            )
            self.assertEqual(failing.status_code, 202, failing.text)
            failing_job_id = failing.json()["jobId"]
            self._wait_for_status(client, failing_job_id, "failed")

            retried = client.post(
                f"/api/v2/drawing-jobs/{failing_job_id}/retry",
                json={"fromPhase": "preview_generating", "reason": "stage5 retry note"},
            )
            self.assertEqual(retried.status_code, 202, retried.text)
            retry_job_id = retried.json()["jobId"]

            events = self._list_events(client, retry_job_id)
            created_event = next(event for event in events if event["type"] == "job.created")
            note = created_event["payload"]["note"]
            self.assertEqual(note, "Retry restarts the current mock workflow from queued.")
            self.assertNotIn("phase three", note.lower())

    def test_intermediate_events_are_preserved(self):
        with self._client(extra_env={"VOCASKETCH_PROVIDER_PROFILE": "mock"}) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "验证中间事件", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            self._wait_for_status(client, job_id, "preview_ready")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            self._wait_for_status(client, job_id, "completed")

            event_types = [event["type"] for event in self._wait_for_event_type(client, job_id, "job.completed")]
            expected_order = [
                "job.created",
                "job.status_changed",
                "intent.ready",
                "prompt.ready",
                "preview.ready",
                "final.ready",
                "layers.ready",
                "playback.ready",
                "job.completed",
            ]

            last_index = -1
            for expected in expected_order:
                index = event_types.index(expected)
                self.assertGreater(index, last_index, f"event '{expected}' was missing or out of order")
                last_index = index


if __name__ == "__main__":
    unittest.main(verbosity=2)
