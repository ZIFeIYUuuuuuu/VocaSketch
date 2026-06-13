from __future__ import annotations

import base64
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
    FakeImageTransport,
    FakeLayerDecompositionTransport,
    FakeTextTransport,
    ImageGenerationResult,
    LayerDecompositionItem,
    LayerDecompositionResult,
    TransportError,
    TransportTimeoutError,
)


PNG_1X1_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUswAAAAASUVORK5CYII="
)
EXPECTED_LAYER_ROLES = ["sketch", "lineart", "flat_color", "shadow", "lighting", "details"]


class Stage10LayerPlaybackTests(unittest.TestCase):
    def _client(
        self,
        *,
        extra_env: dict[str, str] | None = None,
        fake_text_transport: FakeTextTransport | None = None,
        fake_image_transport: FakeImageTransport | None = None,
        fake_layer_transport: FakeLayerDecompositionTransport | None = None,
    ):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage10_test_")
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
        if fake_layer_transport is not None:
            patchers.append(
                mock.patch(
                    "vocasketch_backend.providers.registry.build_openai_layer_transport",
                    return_value=fake_layer_transport,
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

    def _openai_live_env(
        self,
        *,
        image_model: str | None = "gpt-image-1",
        layer_model: str | None = "gpt-layer-1",
    ) -> dict[str, str]:
        env = {
            "VOCASKETCH_PROVIDER_PROFILE": "openai",
            "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
            "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1?token=secret",
            "VOCASKETCH_OPENAI_API_KEY": "super-secret",
            "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
        }
        if image_model:
            env["VOCASKETCH_OPENAI_IMAGE_MODEL"] = image_model
        if layer_model:
            env["VOCASKETCH_OPENAI_LAYER_MODEL"] = layer_model
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

    def _layer_svg_bytes(self, role: str, label: str) -> bytes:
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">'
            f'<rect width="1024" height="1024" fill="#0f172a" opacity="0.08"/>'
            f'<text x="96" y="200" font-size="88" fill="#111827">{label}</text>'
            f'<text x="96" y="292" font-size="32" fill="#475569">{role}</text>'
            f"</svg>"
        ).encode("utf-8")

    def _fake_layer_transport(self) -> FakeLayerDecompositionTransport:
        items: list[LayerDecompositionItem] = []
        layer_specs = [
            ("sketch", "Sketch Layer", 1, 0.82, "multiply"),
            ("lineart", "Line Art Layer", 2, 0.94, "multiply"),
            ("flat_color", "Flat Color Layer", 3, 1.0, "normal"),
            ("shadow", "Shadow Layer", 4, 0.76, "multiply"),
            ("lighting", "Lighting Layer", 5, 0.72, "screen"),
            ("details", "Details Layer", 6, 1.0, "normal"),
        ]
        for role, label, order, opacity, blend_mode in layer_specs:
            items.append(
                LayerDecompositionItem(
                    role=role,
                    label=label,
                    mime_type="image/svg+xml",
                    width=1024,
                    height=1024,
                    content_bytes=self._layer_svg_bytes(role, label),
                    order=order,
                    opacity=opacity,
                    blend_mode=blend_mode,
                    metadata={"mode": "fake-live-layer"},
                )
            )
        return FakeLayerDecompositionTransport(
            responses=[
                LayerDecompositionResult(
                    layers=items,
                    provider_metadata={"pipeline": "fake-openai-layer"},
                )
            ]
        )

    def _fake_sensitive_layer_transport(self) -> FakeLayerDecompositionTransport:
        transport = self._fake_layer_transport()
        result = transport._responses[0]
        sensitive_layers: list[LayerDecompositionItem] = []
        for item in result.layers:
            sensitive_layers.append(
                LayerDecompositionItem(
                    role=item.role,
                    label=item.label,
                    mime_type=item.mime_type,
                    width=item.width,
                    height=item.height,
                    content_bytes=item.content_bytes,
                    order=item.order,
                    opacity=item.opacity,
                    blend_mode=item.blend_mode,
                    metadata={
                        "mode": "fake-live-layer",
                        "requestId": "req-layer-001",
                        "Authorization": "Bearer top-secret-token",
                        "apiKey": "super-secret",
                        "sourceUrl": "https://demo.example/path?token=secret&org=test",
                        "requestEnvelope": {"Authorization": "Bearer top-secret-token"},
                    },
                )
            )

        transport._responses = [
            LayerDecompositionResult(
                layers=sensitive_layers,
                provider_metadata={
                    "pipeline": "fake-openai-layer",
                    "requestId": "req-provider-001",
                    "apiKey": "super-secret",
                    "Authorization": "Bearer top-secret-token",
                    "sourceUrl": "https://demo.example/path?token=secret&org=test",
                    "rawEnvelope": {
                        "Authorization": "Bearer top-secret-token",
                        "cookie": "session=abc",
                    },
                },
            )
        ]
        return transport

    def _create_job_and_wait_preview(self, client: TestClient, text: str) -> tuple[str, dict]:
        created = client.post("/api/v2/drawing-jobs", json={"inputText": text, "locale": "zh-CN"})
        self.assertEqual(created.status_code, 202, created.text)
        job_id = created.json()["jobId"]
        preview = self._wait_for_status(client, job_id, "preview_ready")
        return job_id, preview

    def test_default_mock_profile_generates_playable_layers_and_manifest(self):
        with self._client() as client:
            job_id, preview = self._create_job_and_wait_preview(client, "默认 mock 播放测试")
            self.assertTrue(preview["previewAssetId"])

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")

            self.assertEqual([layer["role"] for layer in completed["layerAssets"]], EXPECTED_LAYER_ROLES)
            manifest = completed["playbackManifest"]
            self.assertEqual([step["role"] for step in manifest["steps"]], EXPECTED_LAYER_ROLES)
            self.assertTrue(manifest["finalCompositeAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])

            first_layer = completed["layerAssets"][0]
            self.assertTrue(first_layer["contentUrl"])
            self.assertEqual(first_layer["order"], 1)
            self.assertEqual(first_layer["blendMode"], "multiply")
            self.assertIsNotNone(first_layer["opacity"])
            layer_content = client.get(first_layer["contentUrl"])
            self.assertEqual(layer_content.status_code, 200, layer_content.text)
            self.assertIn("image/svg+xml", layer_content.headers["content-type"])
            self.assertIn("<svg", layer_content.text)

    def test_live_text_image_and_layer_happy_path_completes_with_playback_manifest(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        fake_layer_transport = self._fake_layer_transport()

        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
            fake_layer_transport=fake_layer_transport,
        ) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.openai)
            self.assertEqual(runtime_info.safe_settings["mode"], "live-text-live-image-live-layers")
            self.assertNotIn("super-secret", str(runtime_info.safe_settings))

            job_id, preview = self._create_job_and_wait_preview(client, "live text + image + layer")
            preview_asset = client.get(f"/api/v2/assets/{preview['previewAssetId']}").json()
            self.assertEqual(preview_asset["mimeType"], "image/png")

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")

            self.assertTrue(completed["finalAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])
            self.assertEqual([layer["role"] for layer in completed["layerAssets"]], EXPECTED_LAYER_ROLES)
            self.assertEqual([step["role"] for step in completed["playbackManifest"]["steps"]], EXPECTED_LAYER_ROLES)
            self.assertEqual(completed["playbackManifest"]["finalCompositeAssetId"], completed["finalAssetId"])

            final_asset = client.get(f"/api/v2/assets/{completed['finalAssetId']}").json()
            self.assertEqual(final_asset["mimeType"], "image/png")
            final_content = client.get(final_asset["contentUrl"])
            self.assertEqual(final_content.status_code, 200, final_content.text)
            self.assertEqual(final_content.content, PNG_1X1_BYTES)

            first_layer = completed["layerAssets"][0]
            self.assertEqual(first_layer["mimeType"], "image/svg+xml")
            self.assertEqual(first_layer["sourceFinalAssetId"], completed["finalAssetId"])
            self.assertEqual(first_layer["metadata"]["provider"], "openai-mixed-provider")
            self.assertEqual(first_layer["metadata"]["mode"], "live-layer-decomposition")
            layer_content = client.get(first_layer["contentUrl"])
            self.assertEqual(layer_content.status_code, 200, layer_content.text)
            self.assertIn("image/svg+xml", layer_content.headers["content-type"])
            self.assertIn("<svg", layer_content.text)

            manifest_step = completed["playbackManifest"]["steps"][0]
            self.assertEqual(manifest_step["assetId"], first_layer["assetId"])
            self.assertEqual(manifest_step["blendMode"], "multiply")
            self.assertIn("startMs", manifest_step)
            self.assertIn("durationMs", manifest_step)
            self.assertIn("opacityFrom", manifest_step)
            self.assertIn("opacityTo", manifest_step)

            manifest_asset = client.get(f"/api/v2/assets/{completed['playbackManifestAssetId']}").json()
            manifest_content = client.get(manifest_asset["contentUrl"])
            self.assertEqual(manifest_content.status_code, 200, manifest_content.text)
            self.assertIn('"steps"', manifest_content.text)

            serialized = json.dumps(completed, ensure_ascii=False)
            self.assertNotIn("super-secret", serialized)
            self.assertNotIn("token=secret", serialized)
            self.assertEqual(len(fake_text_transport.requests), 3)
            self.assertEqual(len(fake_image_transport.requests), 2)
            self.assertEqual(len(fake_layer_transport.requests), 1)

    def test_live_layer_empty_result_fails_with_schema_error(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        fake_layer_transport = FakeLayerDecompositionTransport(
            responses=[LayerDecompositionResult(layers=[], provider_metadata={"pipeline": "empty"})]
        )

        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
            fake_layer_transport=fake_layer_transport,
        ) as client:
            job_id, _ = self._create_job_and_wait_preview(client, "空 layer result")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_SCHEMA_ERROR")

    def test_live_layer_timeout_fails_job(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        fake_layer_transport = FakeLayerDecompositionTransport(error=TransportTimeoutError("timed out"))

        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
            fake_layer_transport=fake_layer_transport,
        ) as client:
            job_id, _ = self._create_job_and_wait_preview(client, "layer timeout")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_TIMEOUT")

    def test_live_layer_transport_error_fails_job(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        fake_layer_transport = FakeLayerDecompositionTransport(error=TransportError("boom"))

        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
            fake_layer_transport=fake_layer_transport,
        ) as client:
            job_id, _ = self._create_job_and_wait_preview(client, "layer transport error")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")

    def test_layer_events_and_metadata_do_not_leak_secret(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        fake_layer_transport = self._fake_sensitive_layer_transport()

        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
            fake_layer_transport=fake_layer_transport,
        ) as client:
            job_id, _ = self._create_job_and_wait_preview(client, "不要泄露 layer secret")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")
            manifest_asset = client.get(f"/api/v2/assets/{completed['playbackManifestAssetId']}").json()

            layer_payload = json.dumps(completed["layerAssets"], ensure_ascii=False)
            events_payload = json.dumps(self._list_events(client, job_id), ensure_ascii=False)
            manifest_payload = json.dumps(manifest_asset, ensure_ascii=False)
            self.assertNotIn("super-secret", layer_payload)
            self.assertNotIn("super-secret", events_payload)
            self.assertNotIn("super-secret", manifest_payload)
            self.assertNotIn("token=secret", layer_payload)
            self.assertNotIn("token=secret", events_payload)
            self.assertNotIn("token=secret", manifest_payload)
            self.assertNotIn("Bearer top-secret-token", layer_payload)
            self.assertNotIn("Bearer top-secret-token", events_payload)
            self.assertIn("requestId", layer_payload)
            self.assertIn("sourceUrl", layer_payload)
            self.assertIn("token=%2A%2A%2A", layer_payload)

    def test_live_layer_invalid_opacity_fails_with_schema_error(self):
        fake_text_transport = self._fake_text_transport()
        fake_image_transport = self._fake_image_transport()
        fake_layer_transport = FakeLayerDecompositionTransport(
            responses=[
                LayerDecompositionResult(
                    layers=[
                        LayerDecompositionItem(
                            role="sketch",
                            label="Sketch Layer",
                            mime_type="image/svg+xml",
                            width=1024,
                            height=1024,
                            content_bytes=self._layer_svg_bytes("sketch", "Sketch Layer"),
                            order=1,
                            opacity=1.2,
                            blend_mode="multiply",
                            metadata={},
                        ),
                        LayerDecompositionItem(
                            role="lineart",
                            label="Line Art Layer",
                            mime_type="image/svg+xml",
                            width=1024,
                            height=1024,
                            content_bytes=self._layer_svg_bytes("lineart", "Line Art Layer"),
                            order=2,
                            opacity=0.94,
                            blend_mode="multiply",
                            metadata={},
                        ),
                        LayerDecompositionItem(
                            role="flat_color",
                            label="Flat Color Layer",
                            mime_type="image/svg+xml",
                            width=1024,
                            height=1024,
                            content_bytes=self._layer_svg_bytes("flat_color", "Flat Color Layer"),
                            order=3,
                            opacity=1.0,
                            blend_mode="normal",
                            metadata={},
                        ),
                        LayerDecompositionItem(
                            role="shadow",
                            label="Shadow Layer",
                            mime_type="image/svg+xml",
                            width=1024,
                            height=1024,
                            content_bytes=self._layer_svg_bytes("shadow", "Shadow Layer"),
                            order=4,
                            opacity=0.76,
                            blend_mode="multiply",
                            metadata={},
                        ),
                        LayerDecompositionItem(
                            role="lighting",
                            label="Lighting Layer",
                            mime_type="image/svg+xml",
                            width=1024,
                            height=1024,
                            content_bytes=self._layer_svg_bytes("lighting", "Lighting Layer"),
                            order=5,
                            opacity=0.72,
                            blend_mode="screen",
                            metadata={},
                        ),
                        LayerDecompositionItem(
                            role="details",
                            label="Details Layer",
                            mime_type="image/svg+xml",
                            width=1024,
                            height=1024,
                            content_bytes=self._layer_svg_bytes("details", "Details Layer"),
                            order=6,
                            opacity=1.0,
                            blend_mode="normal",
                            metadata={},
                        ),
                    ],
                    provider_metadata={"pipeline": "invalid-opacity"},
                )
            ]
        )

        with self._client(
            extra_env=self._openai_live_env(),
            fake_text_transport=fake_text_transport,
            fake_image_transport=fake_image_transport,
            fake_layer_transport=fake_layer_transport,
        ) as client:
            job_id, _ = self._create_job_and_wait_preview(client, "layer opacity invalid")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_SCHEMA_ERROR")


if __name__ == "__main__":
    unittest.main(verbosity=2)
