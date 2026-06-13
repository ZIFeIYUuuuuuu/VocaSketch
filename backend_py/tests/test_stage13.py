from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
import warnings
import asyncio
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient


warnings.filterwarnings("ignore", category=UserWarning)

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = WORKSPACE_ROOT / "backend_py" / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from vocasketch_backend.main import create_app
from vocasketch_backend.event_bus import JobEventBus
from vocasketch_backend.models import JobEvent


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


class Stage13EventResumeTests(unittest.TestCase):
    def _client(self):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage13_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_PY_DATA_DIR": tempdir.name,
            "VOCASKETCH_WORKFLOW_STEP_DELAY_SECONDS": "0.02",
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

    def _create_preview_job(self, client: TestClient) -> str:
        created = client.post(
            "/api/v2/drawing-jobs",
            json={"inputText": "stage13 resume event stream", "locale": "zh-CN"},
        )
        self.assertEqual(created.status_code, 202, created.text)
        job_id = created.json()["jobId"]
        self._wait_for_status(client, job_id, "preview_ready")
        return job_id

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

    def _event_payloads_from_bus(self, stored_events: list[dict], job_id: str, after_seq: int, expected_count: int) -> list[dict]:
        class _FakeStore:
            async def list_events(self, stream_job_id: str):
                self_stream_job_id = stream_job_id
                return [JobEvent.model_validate(event) for event in stored_events if event["jobId"] == self_stream_job_id]

        event_bus = JobEventBus(_FakeStore())

        async def _collect() -> list[dict]:
            payloads: list[dict] = []
            async for chunk in event_bus.stream(job_id, after_seq=after_seq):
                for line in chunk.splitlines():
                    if not line.startswith("data: "):
                        continue
                    payloads.append(json.loads(line.removeprefix("data: ")))
                if len(payloads) >= expected_count:
                    return payloads
            return payloads

        return asyncio.run(_collect())

    def test_event_bus_replays_after_seq_in_order(self):
        with self._client() as client:
            job_id = self._create_preview_job(client)
            stored_events = client.app.state.job_store._read_json(
                client.app.state.config.jobs_dir / f"{job_id}.events.json"
            )
            self.assertGreaterEqual(len(stored_events), 4)
            after_seq = stored_events[1]["seq"]
            expected_events = [event for event in stored_events if event["seq"] > after_seq]

            payloads = self._event_payloads_from_bus(
                stored_events,
                job_id,
                after_seq,
                expected_count=len(expected_events),
            )

            self.assertEqual([event["seq"] for event in payloads], [event["seq"] for event in expected_events])
            self.assertTrue(all(event["seq"] > after_seq for event in payloads))

    def test_events_endpoint_passes_after_seq_to_stream(self):
        with self._client() as client:
            job_id = self._create_preview_job(client)
            captured: dict[str, int | str] = {}

            async def fake_stream(stream_job_id: str, *, after_seq: int = 0):
                captured["job_id"] = stream_job_id
                captured["after_seq"] = after_seq
                yield "event: test\ndata: {}\n\n"

            client.app.state.event_bus.stream = fake_stream
            response = client.get(f"/api/v2/drawing-jobs/{job_id}/events?afterSeq=3")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(captured, {"job_id": job_id, "after_seq": 3})

    def test_events_endpoint_accepts_since_seq_alias(self):
        with self._client() as client:
            job_id = self._create_preview_job(client)
            captured: dict[str, int | str] = {}

            async def fake_stream(stream_job_id: str, *, after_seq: int = 0):
                captured["job_id"] = stream_job_id
                captured["after_seq"] = after_seq
                yield "event: test\ndata: {}\n\n"

            client.app.state.event_bus.stream = fake_stream
            response = client.get(f"/api/v2/drawing-jobs/{job_id}/events?sinceSeq=4")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(captured, {"job_id": job_id, "after_seq": 4})

    def test_events_endpoint_invalid_after_seq_returns_400(self):
        with self._client() as client:
            job_id = self._create_preview_job(client)

            invalid_text = client.get(f"/api/v2/drawing-jobs/{job_id}/events?afterSeq=abc")
            self.assertEqual(invalid_text.status_code, 400, invalid_text.text)

            invalid_negative = client.get(f"/api/v2/drawing-jobs/{job_id}/events?sinceSeq=-1")
            self.assertEqual(invalid_negative.status_code, 400, invalid_negative.text)

    def test_events_endpoint_missing_job_returns_404(self):
        with self._client() as client:
            response = client.get("/api/v2/drawing-jobs/missing_job/events?afterSeq=2")
            self.assertEqual(response.status_code, 404, response.text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
