from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
import warnings
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient


warnings.filterwarnings("ignore", category=UserWarning)

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = WORKSPACE_ROOT / "backend_py" / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from vocasketch_backend.main import create_app
from vocasketch_backend.models import DrawingJob, JobError, JobStatus


PROVIDER_ENV_BASELINE = {
    "VOCASKETCH_PROVIDER_PROFILE": "mock",
    "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "0",
    "VOCASKETCH_OPENAI_API_BASE_URL": "",
    "VOCASKETCH_OPENAI_API_KEY": "",
    "VOCASKETCH_OPENAI_RESPONSE_MODEL": "",
    "VOCASKETCH_OPENAI_IMAGE_MODEL": "",
    "VOCASKETCH_OPENAI_LAYER_MODEL": "",
    "VOCASKETCH_OPENAI_TIMEOUT_SECONDS": "",
}


class Stage12RecentJobsTests(unittest.TestCase):
    def _client(self, *, extra_env: dict[str, str] | None = None):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage12_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
            **PROVIDER_ENV_BASELINE,
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

    def _create_job(self, client: TestClient, input_text: str, **extra_json) -> str:
        response = client.post(
            "/api/v2/drawing-jobs",
            json={"inputText": input_text, "locale": "zh-CN", **extra_json},
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["jobId"]

    def _write_secret_failed_job(self, client: TestClient, job_id: str = "stage12_secret_failed_job") -> str:
        now = datetime.now(UTC)
        secret_job = DrawingJob(
            jobId=job_id,
            status=JobStatus.failed,
            progressPercent=42,
            inputText="failed list summary",
            error=JobError(
                code="PROVIDER_ERROR",
                phase=JobStatus.layers_generating,
                message=(
                    "Authorization=Bearer top-secret-token apiKey=super-secret "
                    "https://demo.example/path?token=secret&org=test"
                ),
                retryable=True,
                provider="fake-provider",
                details={
                    "apiKey": "super-secret",
                    "Authorization": "Bearer top-secret-token",
                    "sourceUrl": "https://demo.example/path?token=secret&org=test",
                    "nested": {
                        "cookie": "session-secret",
                        "safeRequestId": "req_123",
                    },
                },
            ),
            createdAt=now - timedelta(seconds=1),
            updatedAt=now,
        )
        job_path = client.app.state.config.jobs_dir / f"{secret_job.jobId}.json"
        with job_path.open("w", encoding="utf-8") as handle:
            json.dump(secret_job.model_dump(mode="json"), handle, ensure_ascii=False, indent=2)
        return secret_job.jobId

    def test_recent_jobs_returns_updated_desc_order(self):
        with self._client() as client:
            first_id = self._create_job(client, "first recent job")
            self._wait_for_status(client, first_id, "preview_ready")
            second_id = self._create_job(client, "second recent job")
            self._wait_for_status(client, second_id, "preview_ready")

            response = client.get("/api/v2/drawing-jobs?limit=2")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()

            self.assertEqual(body["limit"], 2)
            self.assertEqual([item["jobId"] for item in body["items"]], [second_id, first_id])
            self.assertTrue(all(item["status"] == "preview_ready" for item in body["items"]))

    def test_recent_jobs_status_and_limit_filters(self):
        with self._client() as client:
            failed_id = self._create_job(
                client,
                "failed recent job",
                simulateFailureAt="preview_generating",
            )
            self._wait_for_status(client, failed_id, "failed")
            active_id = self._create_job(client, "active recent job")
            self._wait_for_status(client, active_id, "preview_ready")

            response = client.get("/api/v2/drawing-jobs?status=failed&limit=1")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()

            self.assertEqual(body["status"], "failed")
            self.assertEqual(body["limit"], 1)
            self.assertEqual(len(body["items"]), 1)
            self.assertEqual(body["items"][0]["jobId"], failed_id)
            self.assertNotEqual(body["items"][0]["jobId"], active_id)

    def test_recent_jobs_excludes_heavy_job_payload(self):
        with self._client() as client:
            job_id = self._create_job(client, "completed recent job")
            self._wait_for_status(client, job_id, "preview_ready")
            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            self._wait_for_status(client, job_id, "completed")

            response = client.get("/api/v2/drawing-jobs?limit=1")
            self.assertEqual(response.status_code, 200, response.text)
            item = response.json()["items"][0]

            self.assertEqual(item["jobId"], job_id)
            self.assertIn("finalAssetId", item)
            self.assertNotIn("layerAssets", item)
            self.assertNotIn("playbackManifest", item)
            self.assertNotIn("parsedIntent", item)
            self.assertNotIn("visualBrief", item)
            self.assertNotIn("imagePrompt", item)

    def test_failed_job_error_summary_is_secret_safe(self):
        with self._client() as client:
            self._write_secret_failed_job(client)

            response = client.get("/api/v2/drawing-jobs?status=failed&limit=5")
            self.assertEqual(response.status_code, 200, response.text)
            serialized = json.dumps(response.json(), ensure_ascii=False)

            self.assertIn("PROVIDER_ERROR", serialized)
            self.assertIn("fake-provider", serialized)
            self.assertNotIn("super-secret", serialized)
            self.assertNotIn("top-secret-token", serialized)
            self.assertNotIn("token=secret", serialized)
            self.assertNotIn("Authorization=Bearer", serialized)

    def test_failed_job_detail_response_is_secret_safe(self):
        with self._client() as client:
            job_id = self._write_secret_failed_job(client)

            response = client.get(f"/api/v2/drawing-jobs/{job_id}")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            serialized = json.dumps(body, ensure_ascii=False)

            self.assertEqual(body["error"]["code"], "PROVIDER_ERROR")
            self.assertEqual(body["error"]["details"]["nested"]["safeRequestId"], "req_123")
            self.assertEqual(body["error"]["details"]["apiKey"], "***")
            self.assertEqual(body["error"]["details"]["Authorization"], "***")
            self.assertEqual(body["error"]["details"]["nested"]["cookie"], "***")
            self.assertNotIn("super-secret", serialized)
            self.assertNotIn("top-secret-token", serialized)
            self.assertNotIn("session-secret", serialized)
            self.assertNotIn("token=secret", serialized)
            self.assertNotIn("Authorization=Bearer", serialized)

    def test_opening_failed_recent_job_uses_secret_safe_detail_data(self):
        with self._client() as client:
            job_id = self._write_secret_failed_job(client, job_id="stage12_recent_failed_secret_job")

            recent = client.get("/api/v2/drawing-jobs?status=failed&limit=1")
            self.assertEqual(recent.status_code, 200, recent.text)
            self.assertEqual(recent.json()["items"][0]["jobId"], job_id)

            detail = client.get(f"/api/v2/drawing-jobs/{recent.json()['items'][0]['jobId']}")
            self.assertEqual(detail.status_code, 200, detail.text)
            serialized = json.dumps(detail.json(), ensure_ascii=False)

            self.assertIn("PROVIDER_ERROR", serialized)
            self.assertNotIn("super-secret", serialized)
            self.assertNotIn("top-secret-token", serialized)
            self.assertNotIn("token=secret", serialized)
            self.assertNotIn("session-secret", serialized)

    def test_readiness_remains_secret_safe_for_recent_jobs_panel(self):
        with self._client(
            extra_env={
                "VOCASKETCH_OPENAI_API_KEY": "dirty-secret",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1?token=secret",
            }
        ) as client:
            response = client.get("/api/v2/runtime/readiness")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            serialized = json.dumps(body, ensure_ascii=False)

            self.assertEqual(body["provider"]["profile"], "mock")
            self.assertFalse(body["provider"]["networkEnabled"])
            self.assertEqual(body["provider"]["modes"]["text"], "mock")
            self.assertEqual(body["provider"]["modes"]["layers"], "mock")
            self.assertNotIn("dirty-secret", serialized)
            self.assertNotIn("token=secret", serialized)


if __name__ == "__main__":
    unittest.main(verbosity=2)
