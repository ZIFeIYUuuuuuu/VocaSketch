from __future__ import annotations

import base64
import asyncio
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
SRC_ROOT = WORKSPACE_ROOT / "backend_py" / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from vocasketch_backend.main import create_app
from vocasketch_backend.providers.base import ProviderProfile
from vocasketch_backend.providers.transports import (
    DashScopeImageTransport,
    FakeImageTransport,
    FakeTextTransport,
    ImageGenerationRequest,
    ImageGenerationResult,
    OpenAIChatCompatibleImageTransport,
    TransportError,
    TransportTimeoutError,
)


PNG_1X1_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUswAAAAASUVORK5CYII="
)


class Stage9ImageProviderTests(unittest.TestCase):
    def _client(
        self,
        *,
        extra_env: dict[str, str] | None = None,
        fake_text_transport: FakeTextTransport | None = None,
        fake_image_transport: FakeImageTransport | None = None,
    ):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage9_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
            "VOCASKETCH_PROVIDER_PROFILE": "mock",
            "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "0",
            "VOCASKETCH_OPENAI_API_BASE_URL": "",
            "VOCASKETCH_OPENAI_API_KEY": "",
            "VOCASKETCH_OPENAI_IMAGE_API_BASE_URL": "",
            "VOCASKETCH_OPENAI_IMAGE_API_KEY": "",
            "VOCASKETCH_OPENAI_RESPONSE_MODEL": "",
            "VOCASKETCH_OPENAI_IMAGE_MODEL": "",
            "VOCASKETCH_OPENAI_LAYER_MODEL": "",
        }
        if extra_env:
            env_patch.update(extra_env)

        patchers: list[mock._patch] = [mock.patch.dict(os.environ, env_patch, clear=False)]
        if fake_text_transport is not None:
            patchers.append(
                mock.patch(
                    "vocasketch_backend.providers.registry.build_openai_text_transport",
                    return_value=fake_text_transport,
                )
            )
        if fake_image_transport is not None:
            patchers.append(
                mock.patch(
                    "vocasketch_backend.providers.registry.build_openai_image_transport",
                    return_value=fake_image_transport,
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

    def _list_events(self, client: TestClient, job_id: str) -> list[dict]:
        events_path = client.app.state.config.jobs_dir / f"{job_id}.events.json"
        with events_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _openai_live_env(self, *, image_model: str | None = "gpt-image-1") -> dict[str, str]:
        env = {
            "VOCASKETCH_PROVIDER_PROFILE": "openai",
            "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
            "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1?token=secret",
            "VOCASKETCH_OPENAI_API_KEY": "super-secret",
            "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
        }
        if image_model:
            env["VOCASKETCH_OPENAI_IMAGE_MODEL"] = image_model
        return env

    def _fake_text_transport(self) -> FakeTextTransport:
        return FakeTextTransport(
            responses=[
                """
                {
                  "subject": "blue-haired anime portrait",
                  "style": "premium watercolor illustration",
                  "composition": "half-body portrait with clean silhouette",
                  "constraints": ["preserve readable silhouette", "support layer playback"],
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

    def _fake_image_transport(self) -> FakeImageTransport:
        return FakeImageTransport(
            responses=[
                ImageGenerationResult(
                    content_bytes=PNG_1X1_BYTES,
                    mime_type="image/png",
                    width=512,
                    height=512,
                    seed=424242,
                    provider_metadata={"stage": "preview"},
                ),
                ImageGenerationResult(
                    content_bytes=PNG_1X1_BYTES,
                    mime_type="image/png",
                    width=1024,
                    height=1024,
                    seed=424242,
                    provider_metadata={"stage": "final"},
                ),
            ]
        )

    def test_default_mock_profile_does_not_build_live_image_transport(self):
        with mock.patch("vocasketch_backend.providers.registry.build_openai_image_transport") as image_builder:
            with self._client() as client:
                runtime_info = client.app.state.provider_runtime_info
                self.assertEqual(runtime_info.profile, ProviderProfile.mock)
                image_builder.assert_not_called()

    def test_live_text_and_live_image_happy_path_generates_png_assets(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.openai)
            self.assertEqual(runtime_info.safe_settings["mode"], "live-text-live-image-derived-frames")
            self.assertNotIn("super-secret", str(runtime_info.safe_settings))

            readiness = client.get("/api/v2/runtime/readiness")
            self.assertEqual(readiness.status_code, 200, readiness.text)
            self.assertEqual(readiness.json()["provider"]["modes"]["layers"], "derived")
            self.assertEqual(readiness.json()["provider"]["modes"]["playback"], "derived")

            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "画一个蓝色长发角色，水彩风", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            preview_asset_id = preview["previewAssetId"]
            self.assertTrue(preview_asset_id)

            preview_asset = client.get(f"/api/v2/assets/{preview_asset_id}").json()
            self.assertEqual(preview_asset["mimeType"], "image/png")
            self.assertTrue(preview_asset["storagePath"].endswith(".png"))
            self.assertTrue(preview_asset["byteSize"] > 0)
            self.assertEqual(preview_asset["contentUrl"], f"/api/v2/assets/{preview_asset_id}/content")
            self.assertNotIn("super-secret", json.dumps(preview_asset, ensure_ascii=False))

            preview_content = client.get(preview_asset["contentUrl"])
            self.assertEqual(preview_content.status_code, 200, preview_content.text)
            self.assertIn("image/png", preview_content.headers["content-type"])
            self.assertEqual(preview_content.content, PNG_1X1_BYTES)

            completed = self._wait_for_status(client, job_id, "completed")
            self.assertFalse(completed["requiresConfirmation"])
            self.assertTrue(completed["finalAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])
            self.assertEqual(
                [layer["role"] for layer in completed["layerAssets"]],
                ["sketch", "lineart", "flat_color", "shadow", "lighting", "details"],
            )

            final_asset = client.get(f"/api/v2/assets/{completed['finalAssetId']}").json()
            self.assertEqual(final_asset["mimeType"], "image/png")
            self.assertTrue(final_asset["storagePath"].endswith(".png"))
            final_content = client.get(final_asset["contentUrl"])
            self.assertEqual(final_content.status_code, 200, final_content.text)
            self.assertIn("image/png", final_content.headers["content-type"])
            self.assertEqual(final_content.content, PNG_1X1_BYTES)

            first_layer = completed["layerAssets"][0]
            self.assertEqual(first_layer["mimeType"], "image/svg+xml")
            self.assertEqual(first_layer["metadata"]["mode"], "derived-final-playback-frame")
            self.assertEqual(first_layer["metadata"]["progressPercent"], 10)
            self.assertEqual(first_layer["sourceFinalAssetId"], completed["finalAssetId"])
            first_layer_content = client.get(first_layer["contentUrl"])
            self.assertEqual(first_layer_content.status_code, 200, first_layer_content.text)
            self.assertIn("image/svg+xml", first_layer_content.headers["content-type"])
            self.assertIn(final_asset["contentUrl"], first_layer_content.text)
            self.assertIn("same final asset", first_layer_content.text)
            manifest_steps = completed["playbackManifest"]["steps"]
            self.assertEqual([step["label"] for step in manifest_steps], ["10% 草图", "25% 线稿", "45% 平涂", "65% 阴影", "85% 光照", "100% 完成"])
            self.assertTrue(all(step["transition"] == "replace-frame" for step in manifest_steps))

            self.assertEqual(len(fake_text_transport.requests), 3)
            self.assertEqual(len(fake_image_transport.requests), 2)
            self.assertEqual(fake_image_transport.requests[0].mode, "preview")
            self.assertEqual(fake_image_transport.requests[0].size, "768x768")
            self.assertEqual(fake_image_transport.requests[0].timeout_seconds, 20.0)
            self.assertEqual(fake_image_transport.requests[1].mode, "final")
            self.assertEqual(fake_image_transport.requests[1].size, "1024x1024")

    def test_live_image_can_use_separate_gateway_and_key(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        env = {
            **self._openai_live_env(),
            "VOCASKETCH_OPENAI_IMAGE_API_BASE_URL": "https://images.example/v1?token=image-secret",
            "VOCASKETCH_OPENAI_IMAGE_API_KEY": "image-key-secret",
        }
        with self._client(
            extra_env=env,
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            serialized_runtime = json.dumps(runtime_info.safe_settings, ensure_ascii=False)
            self.assertEqual(runtime_info.safe_settings["imageApiBaseUrl"], "https://images.example/v1?token=%2A%2A%2A")
            self.assertNotIn("image-key-secret", serialized_runtime)
            self.assertNotIn("image-secret", serialized_runtime)

            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "分离生图网关", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            self._wait_for_status(client, job_id, "preview_ready")

            self.assertEqual(fake_text_transport.requests[0].api_base_url, "https://demo.example/v1?token=secret")
            self.assertEqual(fake_text_transport.requests[0].api_key, "super-secret")
            self.assertEqual(fake_image_transport.requests[0].api_base_url, "https://images.example/v1?token=image-secret")
            self.assertEqual(fake_image_transport.requests[0].api_key, "image-key-secret")

    def test_live_image_auto_generates_final_and_playback_after_preview_without_confirm(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "preview 后后台预生成", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertFalse(preview["requiresConfirmation"])
            self.assertIsNone(preview["finalAssetId"])

            completed = self._wait_for_status(client, job_id, "completed")
            self.assertFalse(completed["requiresConfirmation"])
            self.assertTrue(completed["finalAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])
            self.assertEqual(len(completed["layerAssets"]), 6)
            self.assertTrue(
                all(layer["metadata"]["mode"] == "derived-final-playback-frame" for layer in completed["layerAssets"])
            )
            self.assertFalse(
                any(layer["metadata"].get("provider") == "mock-provider" for layer in completed["layerAssets"])
            )
            final_asset = client.get(f"/api/v2/assets/{completed['finalAssetId']}").json()
            for layer in completed["layerAssets"]:
                content = client.get(layer["contentUrl"])
                self.assertEqual(content.status_code, 200, content.text)
                self.assertIn(final_asset["contentUrl"], content.text)
                self.assertNotIn("VocaSketch Mock Asset", content.text)
            self.assertEqual(len(fake_image_transport.requests), 2)
            self.assertEqual(fake_image_transport.requests[0].mode, "preview")
            self.assertEqual(fake_image_transport.requests[1].mode, "final")

    def test_dashscope_image_transport_generates_image_bytes_without_exposing_remote_url(self):
        transport = DashScopeImageTransport()
        captured_requests = []

        class _FakeHTTPResponse:
            def __init__(self, payload: bytes):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self._payload

        def fake_urlopen(request, timeout):
            captured_requests.append(request)
            if request.full_url.endswith("/services/aigc/multimodal-generation/generation"):
                body = json.loads(request.data.decode("utf-8"))
                self.assertEqual(body["model"], "qwen-image-2.0-pro")
                self.assertEqual(body["parameters"]["size"], "768*768")
                self.assertEqual(request.headers["Authorization"], "Bearer dashscope-secret")
                return _FakeHTTPResponse(
                    json.dumps(
                        {
                            "request_id": "dashscope-request-1",
                            "output": {
                                "choices": [
                                    {
                                        "message": {
                                            "content": [
                                                {"image": "https://dashscope-result.example/image.png?token=secret"},
                                            ]
                                        }
                                    }
                                ]
                            },
                        }
                    ).encode("utf-8")
                )
            if request.full_url.startswith("https://dashscope-result.example/image.png"):
                return _FakeHTTPResponse(PNG_1X1_BYTES)
            raise AssertionError(f"Unexpected URL: {request.full_url}")

        request = ImageGenerationRequest(
            api_base_url="https://dashscope.aliyuncs.com/api/v1",
            api_key="dashscope-secret",
            model="qwen-image-2.0-pro",
            prompt="blue robot",
            negative_prompt="bad anatomy",
            size="768x768",
            timeout_seconds=30,
            mode="preview",
            seed=424242,
        )
        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = asyncio.run(transport.generate_image(request))

        self.assertEqual(result.content_bytes, PNG_1X1_BYTES)
        self.assertEqual(result.mime_type, "image/png")
        self.assertEqual(result.width, 768)
        self.assertEqual(result.height, 768)
        self.assertEqual(result.provider_metadata["requestId"], "dashscope-request-1")
        serialized_metadata = json.dumps(result.provider_metadata, ensure_ascii=False)
        self.assertNotIn("dashscope-secret", serialized_metadata)
        self.assertNotIn("token=secret", serialized_metadata)
        self.assertEqual(len(captured_requests), 2)

    def test_chat_compatible_image_transport_generates_image_bytes_from_markdown_url(self):
        transport = OpenAIChatCompatibleImageTransport()
        captured_requests = []

        class _FakeHTTPResponse:
            def __init__(self, payload: bytes):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self._payload

        def fake_urlopen(request, timeout):
            captured_requests.append(request)
            if request.full_url.endswith("/chat/completions"):
                body = json.loads(request.data.decode("utf-8"))
                self.assertEqual(body["model"], "gpt-image-2")
                self.assertEqual(body["group"], "GPT-image")
                self.assertEqual(body["messages"][0]["role"], "user")
                self.assertIn("Return one image only", body["messages"][0]["content"])
                self.assertEqual(request.headers["Authorization"], "Bearer zc-image-secret")
                return _FakeHTTPResponse(
                    json.dumps(
                        {
                            "choices": [
                                {
                                    "message": {
                                        "content": "图片已生成：![image](https://zc-result.example/image.png?token=secret)"
                                    }
                                }
                            ]
                        }
                    ).encode("utf-8")
                )
            if request.full_url.startswith("https://zc-result.example/image.png"):
                return _FakeHTTPResponse(PNG_1X1_BYTES)
            raise AssertionError(f"Unexpected URL: {request.full_url}")

        request = ImageGenerationRequest(
            api_base_url="https://api.codelife.eu.cc/v1",
            api_key="zc-image-secret",
            model="gpt-image-2",
            prompt="anime school portrait",
            negative_prompt="bad anatomy",
            size="768x768",
            timeout_seconds=30,
            mode="preview",
            seed=424242,
            group="GPT-image",
        )
        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = asyncio.run(transport.generate_image(request))

        self.assertEqual(result.content_bytes, PNG_1X1_BYTES)
        self.assertEqual(result.mime_type, "image/png")
        self.assertEqual(result.width, 768)
        self.assertEqual(result.height, 768)
        self.assertEqual(result.provider_metadata["transport"], "openai-chat-compatible")
        serialized_metadata = json.dumps(result.provider_metadata, ensure_ascii=False)
        self.assertNotIn("zc-image-secret", serialized_metadata)
        self.assertNotIn("token=secret", serialized_metadata)
        self.assertEqual(len(captured_requests), 2)

    def test_live_text_without_image_model_falls_back_to_mock_image_assets(self):
        fake_text_transport = self._fake_text_transport()
        with mock.patch("vocasketch_backend.providers.registry.build_openai_image_transport") as image_builder:
            with self._client(
                extra_env=self._openai_live_env(image_model=None),
                fake_text_transport=fake_text_transport,
            ) as client:
                runtime_info = client.app.state.provider_runtime_info
                self.assertEqual(runtime_info.safe_settings["mode"], "live-text-mock-assets")
                image_builder.assert_not_called()

                created = client.post(
                    "/api/v2/drawing-jobs",
                    json={"inputText": "只开 live text", "locale": "zh-CN"},
                )
                self.assertEqual(created.status_code, 202, created.text)
                job_id = created.json()["jobId"]
                preview = self._wait_for_status(client, job_id, "preview_ready")
                asset = client.get(f"/api/v2/assets/{preview['previewAssetId']}").json()
                self.assertEqual(asset["mimeType"], "image/svg+xml")

    def test_live_image_empty_bytes_fail_with_schema_error(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = FakeImageTransport(
            responses=[
                ImageGenerationResult(
                    content_bytes=b"",
                    mime_type="image/png",
                    width=512,
                    height=512,
                    seed=424242,
                    provider_metadata={},
                )
            ]
        )
        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "空图片 bytes", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_SCHEMA_ERROR")

    def test_live_image_timeout_fails_job(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = FakeImageTransport(error=TransportTimeoutError("timed out"))
        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "图片超时测试", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_TIMEOUT")

    def test_live_image_transport_error_fails_job(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = FakeImageTransport(error=TransportError("boom"))
        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "图片 transport error", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")

    def test_invalid_asset_id_content_request_returns_400(self):
        with self._client() as client:
            response = client.get("/api/v2/assets/bad$id/content")
            self.assertEqual(response.status_code, 400, response.text)

    def test_events_and_runtime_info_do_not_leak_api_key(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertNotIn("super-secret", str(runtime_info.safe_settings))

            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "不要泄露 secret", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            self._wait_for_status(client, job_id, "preview_ready")

            events = self._list_events(client, job_id)
            serialized_events = json.dumps(events, ensure_ascii=False)
            self.assertNotIn("super-secret", serialized_events)
            self.assertNotIn("token=secret", serialized_events)


if __name__ == "__main__":
    unittest.main(verbosity=2)
