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
from vocasketch_backend.providers.base import ProviderError, WorkflowNodeError


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


class Stage14ErrorAndInvariantTests(unittest.TestCase):
    def _client(self):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_stage14_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
            "VOCASKETCH_RENDER_PROCESS_VIDEO": "0",
            **PROVIDER_ENV_BASELINE,
        }
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

    def _create_job(self, client: TestClient, input_text: str = "stage14 invariant job", **extra_json) -> str:
        response = client.post(
            "/api/v2/drawing-jobs",
            json={"inputText": input_text, "locale": "zh-CN", **extra_json},
        )
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["jobId"]

    def _wait_for_status(self, client: TestClient, job_id: str, target_status: str, attempts: int = 180) -> dict:
        body = {}
        for _ in range(attempts):
            response = client.get(f"/api/v2/drawing-jobs/{job_id}")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            if body["status"] == target_status:
                return body
            time.sleep(0.02)
        self.fail(f"job {job_id} did not reach {target_status}; last body={body}")

    def _events(self, client: TestClient, job_id: str) -> list[dict]:
        path = client.app.state.config.jobs_dir / f"{job_id}.events.json"
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _wait_for_status_event(self, client: TestClient, job_id: str, target_status: str, attempts: int = 80) -> list[dict]:
        events: list[dict] = []
        for _ in range(attempts):
            events = self._events(client, job_id)
            status_events = [event for event in events if event["type"] == "job.status_changed"]
            if status_events and status_events[-1]["status"] == target_status:
                return events
            time.sleep(0.02)
        self.fail(f"job {job_id} did not publish latest status event {target_status}; last events={events}")

    def _wait_for_event_type(self, client: TestClient, job_id: str, event_type: str, attempts: int = 80) -> list[dict]:
        events: list[dict] = []
        for _ in range(attempts):
            events = self._events(client, job_id)
            if any(event["type"] == event_type for event in events):
                return events
            time.sleep(0.02)
        self.fail(f"job {job_id} did not publish event {event_type}; last events={events}")

    def _assert_error_envelope(self, response, *, code: str, retryable: bool = False) -> dict:
        body = response.json()
        self.assertIn("error", body, response.text)
        self.assertEqual(body["error"]["code"], code)
        self.assertIsInstance(body["error"]["message"], str)
        self.assertEqual(body["error"]["retryable"], retryable)
        self.assertIsInstance(body["error"]["details"], dict)
        serialized = json.dumps(body, ensure_ascii=False)
        self.assertNotIn("Traceback", serialized)
        self.assertNotIn("super-secret", serialized)
        self.assertNotIn("token=secret", serialized)
        return body

    def test_drawing_job_errors_use_stable_envelope(self):
        with self._client() as client:
            invalid = client.get("/api/v2/drawing-jobs/bad$id")
            self.assertEqual(invalid.status_code, 400, invalid.text)
            self._assert_error_envelope(invalid, code="INVALID_JOB_ID")

            missing = client.get("/api/v2/drawing-jobs/missing_job")
            self.assertEqual(missing.status_code, 404, missing.text)
            self._assert_error_envelope(missing, code="JOB_NOT_FOUND")

            job_id = self._create_job(client, "stage14 conflict job")
            self._wait_for_status(client, job_id, "preview_ready")
            conflict = client.post(f"/api/v2/drawing-jobs/{job_id}/retry", json={"reason": "not failed"})
            self.assertEqual(conflict.status_code, 409, conflict.text)
            body = self._assert_error_envelope(conflict, code="WORKFLOW_STATE_CONFLICT")
            self.assertEqual(body["error"]["details"]["operation"], "retry")

            invalid_seq = client.get(f"/api/v2/drawing-jobs/{job_id}/events?afterSeq=abc")
            self.assertEqual(invalid_seq.status_code, 400, invalid_seq.text)
            self._assert_error_envelope(invalid_seq, code="INVALID_EVENT_SEQUENCE")

    def test_asset_errors_use_stable_envelope(self):
        with self._client() as client:
            invalid = client.get("/api/v2/assets/bad$id")
            self.assertEqual(invalid.status_code, 400, invalid.text)
            self._assert_error_envelope(invalid, code="INVALID_ASSET_ID")

            missing = client.get("/api/v2/assets/missing_asset")
            self.assertEqual(missing.status_code, 404, missing.text)
            self._assert_error_envelope(missing, code="ASSET_NOT_FOUND")

            job_id = self._create_job(client, "stage14 missing asset content")
            preview = self._wait_for_status(client, job_id, "preview_ready")
            asset = client.get(f"/api/v2/assets/{preview['previewAssetId']}").json()
            content_path = client.app.state.config.assets_dir / asset["storagePath"]
            content_path.unlink()
            missing_content = client.get(f"/api/v2/assets/{asset['assetId']}/content")
            self.assertEqual(missing_content.status_code, 410, missing_content.text)
            self._assert_error_envelope(missing_content, code="ASSET_CONTENT_MISSING")

    def test_completed_job_state_and_event_invariants_hold(self):
        with self._client() as client:
            job_id = self._create_job(client, "stage14 completed invariant job")
            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertIsNone(preview["completedAt"])
            self.assertGreaterEqual(preview["progressPercent"], 0)
            self.assertLessEqual(preview["progressPercent"], 100)

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(completed["progressPercent"], 100)
            self.assertIsNotNone(completed["completedAt"])

            events = self._wait_for_status_event(client, job_id, "completed")
            sequences = [event["seq"] for event in events]
            self.assertEqual(sequences, sorted(sequences))
            self.assertEqual(sequences, list(range(1, len(events) + 1)))

            status_events = [event for event in events if event["type"] == "job.status_changed"]
            self.assertGreaterEqual(len(status_events), 2)
            progress_values = [event["payload"]["progressPercent"] for event in status_events]
            self.assertEqual(progress_values, sorted(progress_values))
            self.assertTrue(all(0 <= value <= 100 for value in progress_values))
            self.assertEqual(status_events[-1]["status"], completed["status"])
            self.assertEqual(status_events[-1]["payload"]["progressPercent"], completed["progressPercent"])

            cancel_completed = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "terminal"})
            self.assertEqual(cancel_completed.status_code, 409, cancel_completed.text)
            self._assert_error_envelope(cancel_completed, code="WORKFLOW_STATE_CONFLICT")

            confirm_completed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirm_completed.status_code, 409, confirm_completed.text)
            self._assert_error_envelope(confirm_completed, code="WORKFLOW_STATE_CONFLICT")

            still_completed = client.get(f"/api/v2/drawing-jobs/{job_id}").json()
            self.assertEqual(still_completed["status"], "completed")
            self.assertEqual(still_completed["progressPercent"], 100)

    def test_failed_job_snapshot_matches_latest_status_event(self):
        with self._client() as client:
            job_id = self._create_job(
                client,
                "stage14 failed invariant job",
                simulateFailureAt="preview_generating",
            )
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["status"], "failed")
            self.assertIsNotNone(failed["completedAt"])
            self.assertTrue(failed["error"]["retryable"])

            self._wait_for_status_event(client, job_id, "failed")
            events = self._wait_for_event_type(client, job_id, "job.failed")
            status_events = [event for event in events if event["type"] == "job.status_changed"]
            self.assertEqual(status_events[-1]["status"], failed["status"])
            self.assertEqual(status_events[-1]["payload"]["error"]["code"], failed["error"]["code"])
            self.assertTrue(status_events[-1]["payload"]["error"]["retryable"])

    def test_failed_events_are_secret_safe_and_keep_diagnostics(self):
        with self._client() as client:
            async def fail_with_secret_provider_error(state):
                raise WorkflowNodeError(
                    "parse_intent_node",
                    "provider failed",
                    cause=ProviderError(
                        "Authorization=Bearer top-secret-token apiKey=super-secret "
                        "https://demo.example/path?token=secret&org=test",
                        provider="openai-test",
                        details={
                            "node": "provider-inner-node",
                            "operation": "parse_intent",
                            "artifact": "text-response",
                            "apiKey": "super-secret",
                            "Authorization": "Bearer top-secret-token",
                            "sourceUrl": "https://demo.example/path?token=secret&org=test",
                            "nested": {
                                "cookie": "session-secret",
                                "safeTraceId": "trace_123",
                            },
                        },
                    ),
                )

            client.app.state.drawing_graph.run_parse_intent = fail_with_secret_provider_error
            job_id = self._create_job(client, "stage14 secret event failure")
            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")

            self._wait_for_status_event(client, job_id, "failed")
            events = self._wait_for_event_type(client, job_id, "job.failed")
            failed_status_event = next(
                event
                for event in events
                if event["type"] == "job.status_changed" and event["status"] == "failed"
            )
            failed_event = next(event for event in events if event["type"] == "job.failed")

            serialized = json.dumps([failed_status_event, failed_event], ensure_ascii=False)
            self.assertNotIn("super-secret", serialized)
            self.assertNotIn("top-secret-token", serialized)
            self.assertNotIn("token=secret", serialized)
            self.assertNotIn("Authorization=Bearer", serialized)
            self.assertNotIn("session-secret", serialized)

            for payload in (failed_status_event["payload"]["error"], failed_event["payload"]):
                self.assertEqual(payload["code"], "PROVIDER_ERROR")
                self.assertEqual(payload["phase"], "parsing")
                self.assertTrue(payload["retryable"])
                self.assertEqual(payload["provider"], "openai-test")
                self.assertEqual(payload["details"]["node"], "parse_intent_node")
                self.assertEqual(payload["details"]["operation"], "parse_intent")
                self.assertEqual(payload["details"]["artifact"], "text-response")
                self.assertEqual(payload["details"]["nested"]["safeTraceId"], "trace_123")


if __name__ == "__main__":
    unittest.main(verbosity=2)
