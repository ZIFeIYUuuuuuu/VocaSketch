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
SRC_ROOT = WORKSPACE_ROOT / "backend_py" / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from vocasketch_backend.main import create_app


class ProcessPlaybackTests(unittest.TestCase):
    def _client(self):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_process_test_")
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
        patcher = mock.patch.dict(os.environ, env_patch, clear=False)

        class _ClientContext:
            def __enter__(self_inner):
                try:
                    patcher.start()
                    self_inner.client = TestClient(create_app())
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

    def test_completed_job_includes_digital_process_manifest(self):
        with self._client() as client:
            created = client.post("/api/v2/drawing-jobs", json={"inputText": "画一个适合过程播放的蓝发角色", "locale": "zh-CN"})
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            self._wait_for_status(client, job_id, "preview_ready")

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")

            process = completed["playbackManifest"]["process"]
            self.assertEqual(process["version"], "process-v1")
            self.assertEqual(process["style"], "digital-immersive")
            self.assertEqual(process["source"]["finalAssetId"], completed["finalAssetId"])
            self.assertTrue(process["source"]["finalContentUrl"])
            self.assertEqual(
                [phase["role"] for phase in process["phases"]],
                ["sketch", "lineart", "flat_color", "shadow", "lighting", "details"],
            )
            action_types = {action["type"] for action in process["actions"]}
            self.assertTrue({"stroke", "fillRegion", "maskReveal", "layerBadge", "finalReveal", "eyeSpark"}.issubset(action_types))
            self.assertGreaterEqual(completed["playbackManifest"]["durationMs"], 11000)

            serialized = json.dumps(process, ensure_ascii=False)
            self.assertNotIn("apiKey", serialized)
            self.assertNotIn("Authorization", serialized)
            self.assertNotIn("Bearer", serialized)

            manifest_asset = client.get(f"/api/v2/assets/{completed['playbackManifestAssetId']}").json()
            manifest_content = client.get(manifest_asset["contentUrl"])
            self.assertEqual(manifest_content.status_code, 200, manifest_content.text)
            manifest_payload = manifest_content.json()
            self.assertEqual(manifest_payload["process"]["version"], "process-v1")
            self.assertIn("eyeSpark", {action["type"] for action in manifest_payload["process"]["actions"]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
