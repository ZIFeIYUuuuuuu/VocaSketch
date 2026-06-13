from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import threading
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
from vocasketch_backend.providers.base import (
    ProviderError,
    ProviderSchemaError,
    ProviderTimeoutError,
    WorkflowNodeError,
)


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


class Stage15CancelRetryTimeoutTests(unittest.TestCase):
    def _client(self, *, step_delay_seconds: str = "0.02"):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage15_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": step_delay_seconds,
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

    def _create_job(self, client: TestClient, input_text: str = "stage15 job", **extra_json) -> str:
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

    def _wait_for_event_type(self, client: TestClient, job_id: str, event_type: str, attempts: int = 80) -> list[dict]:
        events: list[dict] = []
        for _ in range(attempts):
            events = self._events(client, job_id)
            if any(event["type"] == event_type for event in events):
                return events
            time.sleep(0.02)
        self.fail(f"job {job_id} did not publish event {event_type}; last events={events}")

    def _assert_error_envelope(self, response, *, code: str) -> dict:
        body = response.json()
        self.assertIn("error", body, response.text)
        self.assertEqual(body["error"]["code"], code)
        self.assertFalse(body["error"]["retryable"])
        self.assertIsInstance(body["error"]["details"], dict)
        return body

    def _assert_no_status_after(self, events: list[dict], terminal_status: str) -> None:
        terminal_seq = next(
            event["seq"]
            for event in events
            if event["type"] == "job.status_changed" and event["status"] == terminal_status
        )
        later_status_events = [
            event
            for event in events
            if event["seq"] > terminal_seq and event["type"] == "job.status_changed"
        ]
        self.assertEqual(later_status_events, [])

    def test_immediate_cancel_does_not_progress_after_cancel(self):
        with self._client(step_delay_seconds="0.05") as client:
            job_id = self._create_job(client, "stage15 immediate cancel")

            cancelled_response = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "user changed mind"})
            self.assertEqual(cancelled_response.status_code, 200, cancelled_response.text)
            self.assertEqual(cancelled_response.json()["status"], "cancelled")

            time.sleep(0.2)
            snapshot = client.get(f"/api/v2/drawing-jobs/{job_id}").json()
            self.assertEqual(snapshot["status"], "cancelled")
            self.assertFalse(snapshot["requiresConfirmation"])
            self.assertIsNone(snapshot["previewAssetId"])
            self.assertIsNone(snapshot["finalAssetId"])
            self.assertEqual(snapshot["layerAssets"], [])

            events = self._events(client, job_id)
            self._assert_no_status_after(events, "cancelled")
            serialized = json.dumps(events, ensure_ascii=False)
            self.assertNotIn("preview.ready", serialized)
            self.assertNotIn("final.ready", serialized)
            self.assertNotIn("layers.ready", serialized)
            self.assertNotIn("job.completed", serialized)

    def test_preview_ready_cancel_does_not_generate_final_layers(self):
        with self._client() as client:
            job_id = self._create_job(client, "stage15 preview cancel")
            preview = self._wait_for_status(client, job_id, "preview_ready")
            self.assertTrue(preview["requiresConfirmation"])
            self.assertTrue(preview["previewAssetId"])

            cancelled = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "stop at preview"})
            self.assertEqual(cancelled.status_code, 200, cancelled.text)
            time.sleep(0.15)

            snapshot = client.get(f"/api/v2/drawing-jobs/{job_id}").json()
            self.assertEqual(snapshot["status"], "cancelled")
            self.assertFalse(snapshot["requiresConfirmation"])
            self.assertTrue(snapshot["previewAssetId"])
            self.assertIsNone(snapshot["finalAssetId"])
            self.assertEqual(snapshot["layerAssets"], [])

            events = self._events(client, job_id)
            self._assert_no_status_after(events, "cancelled")
            self.assertFalse(any(event["type"] == "final.ready" for event in events))
            self.assertFalse(any(event["type"] == "job.completed" for event in events))

    def test_cancel_during_cancellation_resistant_provider_does_not_publish_late_preview(self):
        with self._client(step_delay_seconds="0.02") as client:
            original_generate_preview = client.app.state.drawing_graph.run_generate_preview
            provider_started = threading.Event()

            async def cancellation_resistant_preview(state):
                provider_started.set()
                try:
                    await asyncio.sleep(0.25)
                except asyncio.CancelledError:
                    pass
                return await original_generate_preview(state)

            client.app.state.drawing_graph.run_generate_preview = cancellation_resistant_preview
            job_id = self._create_job(client, "stage15 cancellation resistant provider")
            self._wait_for_status(client, job_id, "preview_generating")
            self.assertTrue(provider_started.wait(timeout=2.0))

            cancelled = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "during provider"})
            self.assertEqual(cancelled.status_code, 200, cancelled.text)
            time.sleep(0.2)

            snapshot = client.get(f"/api/v2/drawing-jobs/{job_id}").json()
            self.assertEqual(snapshot["status"], "cancelled")
            self.assertIsNone(snapshot["previewAssetId"])
            self.assertIsNone(snapshot["finalAssetId"])
            self.assertEqual(snapshot["layerAssets"], [])

            events = self._events(client, job_id)
            self._assert_no_status_after(events, "cancelled")
            self.assertFalse(any(event["type"] == "preview.ready" for event in events))
            self.assertFalse(any(event["type"] == "job.completed" for event in events))

    def test_cancel_terminal_job_returns_409_without_new_events(self):
        with self._client() as client:
            job_id = self._create_job(client, "stage15 terminal cancel")
            self._wait_for_status(client, job_id, "preview_ready")

            first_cancel = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "first"})
            self.assertEqual(first_cancel.status_code, 200, first_cancel.text)
            before_events = self._events(client, job_id)

            second_cancel = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "again"})
            self.assertEqual(second_cancel.status_code, 409, second_cancel.text)
            self._assert_error_envelope(second_cancel, code="WORKFLOW_STATE_CONFLICT")
            self.assertEqual(self._events(client, job_id), before_events)

            confirm_after_cancel = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirm_after_cancel.status_code, 409, confirm_after_cancel.text)
            self._assert_error_envelope(confirm_after_cancel, code="WORKFLOW_STATE_CONFLICT")
            self.assertEqual(client.get(f"/api/v2/drawing-jobs/{job_id}").json()["status"], "cancelled")

    def test_non_failed_retry_returns_409_envelope(self):
        with self._client() as client:
            job_id = self._create_job(client, "stage15 non failed retry")
            self._wait_for_status(client, job_id, "preview_ready")

            response = client.post(f"/api/v2/drawing-jobs/{job_id}/retry", json={"reason": "not failed"})
            self.assertEqual(response.status_code, 409, response.text)
            body = self._assert_error_envelope(response, code="WORKFLOW_STATE_CONFLICT")
            self.assertEqual(body["error"]["details"]["operation"], "retry")

    def test_retry_failed_job_creates_clean_job_with_fresh_event_sequence(self):
        with self._client() as client:
            original_parse = client.app.state.drawing_graph.run_parse_intent
            failed_once = {"value": False}

            async def fail_once_then_succeed(state):
                if not failed_once["value"]:
                    failed_once["value"] = True
                    raise WorkflowNodeError(
                        "parse_intent_node",
                        "provider failed",
                        cause=ProviderError(
                            "Authorization=Bearer top-secret-token apiKey=super-secret "
                            "https://demo.example/path?token=secret",
                            provider="openai-test",
                            details={
                                "node": "provider-inner-node",
                                "operation": "parse_intent",
                                "apiKey": "super-secret",
                                "sourceUrl": "https://demo.example/path?token=secret",
                            },
                        ),
                    )
                return await original_parse(state)

            client.app.state.drawing_graph.run_parse_intent = fail_once_then_succeed
            source_job_id = self._create_job(client, "stage15 retry clean failure")
            source_failed = self._wait_for_status(client, source_job_id, "failed")
            self.assertEqual(source_failed["error"]["code"], "PROVIDER_ERROR")

            retried = client.post(f"/api/v2/drawing-jobs/{source_job_id}/retry", json={"reason": "retry after failure"})
            self.assertEqual(retried.status_code, 202, retried.text)
            retry_job_id = retried.json()["jobId"]
            self.assertNotEqual(retry_job_id, source_job_id)
            self.assertEqual(retried.json()["retryOfJobId"], source_job_id)

            retry_preview = self._wait_for_status(client, retry_job_id, "preview_ready")
            self.assertEqual(retry_preview["retryOfJobId"], source_job_id)
            self.assertIsNone(retry_preview["error"])

            source_after_retry = client.get(f"/api/v2/drawing-jobs/{source_job_id}").json()
            self.assertEqual(source_after_retry["status"], "failed")

            retry_events = self._events(client, retry_job_id)
            self.assertEqual([event["seq"] for event in retry_events], list(range(1, len(retry_events) + 1)))
            self.assertEqual(retry_events[0]["type"], "job.created")
            serialized = json.dumps({"job": retry_preview, "events": retry_events}, ensure_ascii=False)
            self.assertNotIn("super-secret", serialized)
            self.assertNotIn("top-secret-token", serialized)
            self.assertNotIn("token=secret", serialized)

    def test_provider_failures_have_consistent_secret_safe_snapshot_and_events(self):
        cases = [
            (
                ProviderTimeoutError,
                "PROVIDER_TIMEOUT",
                "request timed out with Authorization=Bearer top-secret-token",
            ),
            (
                ProviderSchemaError,
                "PROVIDER_SCHEMA_ERROR",
                "bad envelope apiKey=super-secret",
            ),
            (
                ProviderError,
                "PROVIDER_ERROR",
                "transport failed https://demo.example/path?token=secret",
            ),
        ]

        for error_cls, expected_code, message in cases:
            with self.subTest(expected_code=expected_code):
                with self._client() as client:
                    async def fail_with_provider_error(state):
                        raise WorkflowNodeError(
                            "parse_intent_node",
                            "provider node failed",
                            cause=error_cls(
                                message,
                                provider="openai-test",
                                details={
                                    "node": "provider-inner-node",
                                    "operation": "parse_intent",
                                    "apiKey": "super-secret",
                                    "Authorization": "Bearer top-secret-token",
                                    "sourceUrl": "https://demo.example/path?token=secret",
                                },
                            ),
                        )

                    client.app.state.drawing_graph.run_parse_intent = fail_with_provider_error
                    job_id = self._create_job(client, f"stage15 {expected_code}")
                    failed = self._wait_for_status(client, job_id, "failed")
                    self.assertEqual(failed["error"]["code"], expected_code)
                    self.assertEqual(failed["error"]["phase"], "parsing")
                    self.assertEqual(failed["error"]["provider"], "openai-test")
                    self.assertTrue(failed["error"]["retryable"])
                    self.assertEqual(failed["error"]["details"]["node"], "parse_intent_node")

                    events = self._wait_for_event_type(client, job_id, "job.failed")
                    failed_status_event = next(
                        event
                        for event in events
                        if event["type"] == "job.status_changed" and event["status"] == "failed"
                    )
                    failed_event = next(event for event in events if event["type"] == "job.failed")
                    for payload in (failed_status_event["payload"]["error"], failed_event["payload"]):
                        self.assertEqual(payload["code"], failed["error"]["code"])
                        self.assertEqual(payload["phase"], failed["error"]["phase"])
                        self.assertEqual(payload["provider"], failed["error"]["provider"])
                        self.assertEqual(payload["retryable"], failed["error"]["retryable"])
                        self.assertEqual(payload["details"]["node"], failed["error"]["details"]["node"])

                    serialized = json.dumps({"snapshot": failed, "events": events}, ensure_ascii=False)
                    self.assertNotIn("super-secret", serialized)
                    self.assertNotIn("top-secret-token", serialized)
                    self.assertNotIn("token=secret", serialized)
                    self.assertNotIn("Authorization=Bearer", serialized)


if __name__ == "__main__":
    unittest.main(verbosity=2)
