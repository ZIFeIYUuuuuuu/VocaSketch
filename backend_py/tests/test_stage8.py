from __future__ import annotations

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
from vocasketch_backend.providers.base import ProviderProfile
from vocasketch_backend.providers.transports import FakeTextTransport, TransportError, TransportTimeoutError


class Stage8TextProviderTests(unittest.TestCase):
    def _client(
        self,
        *,
        extra_env: dict[str, str] | None = None,
        fake_transport: FakeTextTransport | None = None,
    ):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage8_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
        }
        if extra_env:
            env_patch.update(extra_env)

        patchers: list[mock._patch] = [mock.patch.dict(os.environ, env_patch, clear=False)]
        if fake_transport is not None:
            patchers.append(
                mock.patch(
                    "vocasketch_backend.providers.registry.build_openai_text_transport",
                    return_value=fake_transport,
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

    def test_default_mock_profile_does_not_build_live_transport(self):
        with mock.patch("vocasketch_backend.providers.registry.build_openai_text_transport") as transport_builder:
            with self._client() as client:
                runtime_info = client.app.state.provider_runtime_info
                self.assertEqual(runtime_info.profile, ProviderProfile.mock)
                transport_builder.assert_not_called()

    def test_openai_live_text_mixed_mode_happy_path_with_fake_transport(self):
        fake_transport = FakeTextTransport(
            responses=[
                """
                {
                  "subject": "blue-haired anime portrait",
                  "style": "premium watercolor illustration",
                  "composition": "half-body portrait with clean silhouette",
                  "constraints": ["preserve readable silhouette", "support later layer playback"],
                  "edits": [],
                  "ambiguities": [],
                  "confidence": 0.95
                }
                """,
                """
                {
                  "artDirection": "premium watercolor anime rendering",
                  "camera": "medium close-up portrait",
                  "palette": ["sky blue", "rose pink", "warm ivory"],
                  "mood": "gentle and polished",
                  "characterSpec": "Blue-haired anime character with polished face rendering.",
                  "backgroundSpec": "Soft watercolor wash background.",
                  "negativeConstraints": ["no crude doodle output", "no unfinished anatomy"]
                }
                """,
                """
                {
                  "model": "openai-text-guided-image-plan",
                  "positivePrompt": "Best-quality anime watercolor portrait, blue-haired character, polished face, gentle lighting.",
                  "negativePrompt": "messy lines, crude doodle, distorted anatomy, unfinished paint",
                  "size": "1024x1024",
                  "guidance": "Preserve layer-friendly painting progression for playback.",
                  "seed": 424242
                }
                """,
            ]
        )
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1?token=secret",
                "VOCASKETCH_OPENAI_API_KEY": "super-secret",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
            },
            fake_transport=fake_transport,
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.openai)
            self.assertFalse(runtime_info.placeholder)
            self.assertTrue(runtime_info.network_enabled)
            self.assertEqual(runtime_info.safe_settings["mode"], "live-text-mock-assets")
            self.assertNotIn("super-secret", str(runtime_info.safe_settings))

            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "画一个蓝色长发角色，水彩风", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertEqual(preview["parsedIntent"]["subject"], "blue-haired anime portrait")
            self.assertEqual(preview["visualBrief"]["mood"], "gentle and polished")
            self.assertEqual(preview["imagePrompt"]["seed"], 424242)
            self.assertTrue(preview["previewAssetId"])

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")
            self.assertTrue(completed["finalAssetId"])
            self.assertGreaterEqual(len(completed["layerAssets"]), 1)
            self.assertEqual(len(fake_transport.requests), 3)

    def test_openai_live_text_invalid_json_fails_job_with_schema_error(self):
        fake_transport = FakeTextTransport(responses=["not-json"])
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1",
                "VOCASKETCH_OPENAI_API_KEY": "secret",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
            },
            fake_transport=fake_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "非法 JSON 测试", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_SCHEMA_ERROR")

    def test_openai_live_text_timeout_fails_job_with_timeout_error(self):
        fake_transport = FakeTextTransport(error=TransportTimeoutError("timed out"))
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1",
                "VOCASKETCH_OPENAI_API_KEY": "secret",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
            },
            fake_transport=fake_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "超时测试", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_TIMEOUT")

    def test_openai_live_text_transport_error_fails_job_with_provider_error(self):
        fake_transport = FakeTextTransport(error=TransportError("transport exploded"))
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1",
                "VOCASKETCH_OPENAI_API_KEY": "secret",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
            },
            fake_transport=fake_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "transport error 测试", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")

    def test_openai_without_live_flag_stays_placeholder(self):
        with mock.patch("vocasketch_backend.providers.registry.build_openai_text_transport") as transport_builder:
            with self._client(
                extra_env={
                    "VOCASKETCH_PROVIDER_PROFILE": "openai",
                    "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1",
                    "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
                }
            ) as client:
                runtime_info = client.app.state.provider_runtime_info
                self.assertTrue(runtime_info.placeholder)
                transport_builder.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
