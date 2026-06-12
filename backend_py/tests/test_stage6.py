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


class Stage6AssetContentTests(unittest.TestCase):
    def _client(self, *, extra_env: dict[str, str] | None = None):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage6_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
            "VOCASKETCH_PROVIDER_PROFILE": "mock",
        }
        if extra_env:
            env_patch.update(extra_env)

        patcher = mock.patch.dict(os.environ, env_patch, clear=False)

        class _ClientContext:
            def __enter__(self_inner):
                try:
                    patcher.start()
                    self_inner.tempdir = tempdir
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

    def test_preview_asset_metadata_and_content_exist(self):
        with self._client() as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "画一个蓝色长发角色", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            preview_asset_id = preview["previewAssetId"]
            self.assertTrue(preview_asset_id)

            asset_response = client.get(f"/api/v2/assets/{preview_asset_id}")
            self.assertEqual(asset_response.status_code, 200, asset_response.text)
            asset = asset_response.json()
            self.assertEqual(asset["mimeType"], "image/svg+xml")
            self.assertEqual(asset["contentUrl"], f"/api/v2/assets/{preview_asset_id}/content")
            self.assertTrue(asset["byteSize"] > 0)
            self.assertEqual(len(asset["checksum"]), 64)
            self.assertTrue(asset["storagePath"].endswith(".svg"))

            content_response = client.get(asset["contentUrl"])
            self.assertEqual(content_response.status_code, 200, content_response.text)
            self.assertIn("image/svg+xml", content_response.headers["content-type"])
            self.assertIn("<svg", content_response.text)

    def test_completed_job_exposes_final_layers_and_manifest_content(self):
        with self._client() as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "生成一个完整分层示意图", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertTrue(preview["previewAssetId"])
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)

            completed = self._wait_for_status(client, job_id, "completed")
            self.assertTrue(completed["finalAssetId"])
            self.assertTrue(completed["playbackManifestAssetId"])
            self.assertGreaterEqual(len(completed["layerAssets"]), 1)
            self.assertTrue(completed["playbackManifest"]["finalCompositeAssetId"])

            final_asset = client.get(f"/api/v2/assets/{completed['finalAssetId']}").json()
            self.assertEqual(final_asset["mimeType"], "image/svg+xml")
            final_content = client.get(final_asset["contentUrl"])
            self.assertEqual(final_content.status_code, 200, final_content.text)
            self.assertIn("<svg", final_content.text)

            first_layer = completed["layerAssets"][0]
            self.assertEqual(first_layer["mimeType"], "image/svg+xml")
            self.assertTrue(first_layer["contentUrl"])
            layer_content = client.get(first_layer["contentUrl"])
            self.assertEqual(layer_content.status_code, 200, layer_content.text)
            self.assertIn("<svg", layer_content.text)

            manifest_asset = client.get(f"/api/v2/assets/{completed['playbackManifestAssetId']}").json()
            self.assertEqual(manifest_asset["mimeType"], "application/json")
            manifest_content = client.get(manifest_asset["contentUrl"])
            self.assertEqual(manifest_content.status_code, 200, manifest_content.text)
            self.assertIn('"finalCompositeAssetId"', manifest_content.text)

    def test_invalid_asset_id_content_request_returns_400(self):
        with self._client() as client:
            response = client.get("/api/v2/assets/bad$id/content")
            self.assertEqual(response.status_code, 400, response.text)

    def test_missing_asset_content_returns_410(self):
        with self._client() as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "删除内容文件验证", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            preview = self._wait_for_status(client, job_id, "preview_ready")
            preview_asset_id = preview["previewAssetId"]

            asset = client.get(f"/api/v2/assets/{preview_asset_id}").json()
            content_path = client.app.state.config.assets_dir / asset["storagePath"]
            content_path.unlink()

            missing = client.get(f"/api/v2/assets/{preview_asset_id}/content")
            self.assertEqual(missing.status_code, 410, missing.text)

    def test_placeholder_provider_does_not_write_asset_content(self):
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-placeholder",
                "VOCASKETCH_OPENAI_IMAGE_MODEL": "image-placeholder",
            }
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "占位 provider 不应写图", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")

            content_root = client.app.state.config.assets_dir / "content"
            if content_root.exists():
                files = [path for path in content_root.rglob("*") if path.is_file()]
            else:
                files = []
            self.assertEqual(files, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
