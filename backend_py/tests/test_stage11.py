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
from vocasketch_backend.providers.base import ProviderProfile
from vocasketch_backend.providers.config import ProviderConfigError, get_provider_config


PROVIDER_ENV_BASELINE = {
    "VOCASKETCH_PROVIDER_PROFILE": "mock",
    "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "0",
    "VOCASKETCH_OPENAI_API_BASE_URL": "",
    "VOCASKETCH_OPENAI_API_KEY": "",
    "VOCASKETCH_OPENAI_IMAGE_API_BASE_URL": "",
    "VOCASKETCH_OPENAI_IMAGE_API_KEY": "",
    "VOCASKETCH_OPENAI_RESPONSE_MODEL": "",
    "VOCASKETCH_OPENAI_IMAGE_MODEL": "",
    "VOCASKETCH_OPENAI_LAYER_MODEL": "",
    "VOCASKETCH_OPENAI_TIMEOUT_SECONDS": "",
}


class Stage11ReadinessAndObservabilityTests(unittest.TestCase):
    def _client(self, *, extra_env: dict[str, str] | None = None):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_py_stage11_test_")
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

    def _list_events(
        self,
        client: TestClient,
        job_id: str,
        *,
        expected_type: str | None = None,
        attempts: int = 50,
    ) -> list[dict]:
        events_path = client.app.state.config.jobs_dir / f"{job_id}.events.json"
        events: list[dict] = []
        for _ in range(attempts):
            with events_path.open("r", encoding="utf-8") as handle:
                events = json.load(handle)
            if expected_type is None or any(event["type"] == expected_type for event in events):
                return events
            time.sleep(0.02)
        return events

    def test_mock_readiness_is_offline_and_secret_safe(self):
        with self._client(
            extra_env={
                "VOCASKETCH_OPENAI_API_KEY": "dirty-secret",
                "VOCASKETCH_OPENAI_API_BASE_URL": "https://demo.example/v1?token=secret",
                "VOCASKETCH_OPENAI_TIMEOUT_SECONDS": "not-a-number",
            }
        ) as client:
            response = client.get("/api/v2/runtime/readiness")
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            serialized = json.dumps(body, ensure_ascii=False)

            self.assertEqual(body["status"], "ready")
            self.assertEqual(body["provider"]["profile"], "mock")
            self.assertFalse(body["provider"]["networkEnabled"])
            self.assertFalse(body["provider"]["placeholder"])
            self.assertEqual(body["provider"]["modes"]["text"], "mock")
            self.assertEqual(body["provider"]["modes"]["preview"], "mock")
            self.assertEqual(body["provider"]["modes"]["layers"], "mock")
            self.assertIn(body["workflow"]["runnerMode"], {"sequential", "langgraph"})
            self.assertTrue(body["storage"]["jobsDir"]["exists"])
            self.assertTrue(body["storage"]["assetsDir"]["exists"])
            self.assertNotIn("dirty-secret", serialized)
            self.assertNotIn("token=secret", serialized)
            self.assertNotIn(str(client.app.state.config.data_dir), serialized)

    def test_readiness_get_does_not_write_probe_files(self):
        with self._client() as client:
            data_dir = client.app.state.config.data_dir
            before = sorted(path.relative_to(data_dir).as_posix() for path in data_dir.rglob("*"))

            response = client.get("/api/v2/runtime/readiness")
            self.assertEqual(response.status_code, 200, response.text)

            after = sorted(path.relative_to(data_dir).as_posix() for path in data_dir.rglob("*"))
            self.assertEqual(after, before)
            self.assertFalse((data_dir / ".readiness_probe").exists())
            self.assertFalse((client.app.state.config.jobs_dir / ".readiness_probe").exists())
            self.assertFalse((client.app.state.config.assets_dir / ".readiness_probe").exists())

    def test_openai_live_flag_off_stays_placeholder_without_network(self):
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-placeholder",
            }
        ) as client:
            readiness = client.get("/api/v2/runtime/readiness").json()
            self.assertEqual(readiness["provider"]["profile"], "openai")
            self.assertTrue(readiness["provider"]["placeholder"])
            self.assertFalse(readiness["provider"]["networkEnabled"])
            self.assertEqual(readiness["provider"]["modes"]["text"], "placeholder")

    def test_openai_live_missing_required_fields_has_stable_config_error(self):
        with self.assertRaises(ProviderConfigError) as raised:
            with self._client(
                extra_env={
                    "VOCASKETCH_PROVIDER_PROFILE": "openai",
                    "VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS": "1",
                    "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
                }
            ):
                pass
        self.assertIn("Missing required configuration", str(raised.exception))

    def test_openai_timeout_non_numeric_is_provider_config_error(self):
        with mock.patch.dict(
            os.environ,
            {
                **PROVIDER_ENV_BASELINE,
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
                "VOCASKETCH_OPENAI_TIMEOUT_SECONDS": "abc",
            },
            clear=False,
        ):
            with self.assertRaises(ProviderConfigError) as raised:
                get_provider_config()
        self.assertIn("VOCASKETCH_OPENAI_TIMEOUT_SECONDS", str(raised.exception))
        self.assertIn("positive number", str(raised.exception))

    def test_openai_timeout_non_positive_is_provider_config_error(self):
        with mock.patch.dict(
            os.environ,
            {
                **PROVIDER_ENV_BASELINE,
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
                "VOCASKETCH_OPENAI_TIMEOUT_SECONDS": "0",
            },
            clear=False,
        ):
            with self.assertRaises(ProviderConfigError) as raised:
                get_provider_config()
        self.assertIn("greater than 0", str(raised.exception))

    def test_openai_invalid_base_url_is_provider_config_error(self):
        with mock.patch.dict(
            os.environ,
            {
                **PROVIDER_ENV_BASELINE,
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
                "VOCASKETCH_OPENAI_API_BASE_URL": "not-a-url",
            },
            clear=False,
        ):
            with self.assertRaises(ProviderConfigError) as raised:
                get_provider_config()
        self.assertIn("absolute http(s) URL", str(raised.exception))

    def test_openai_invalid_image_base_url_is_provider_config_error(self):
        with mock.patch.dict(
            os.environ,
            {
                **PROVIDER_ENV_BASELINE,
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-structured",
                "VOCASKETCH_OPENAI_IMAGE_API_BASE_URL": "not-a-url",
            },
            clear=False,
        ):
            with self.assertRaises(ProviderConfigError) as raised:
                get_provider_config()
        self.assertIn("VOCASKETCH_OPENAI_IMAGE_API_BASE_URL", str(raised.exception))
        self.assertIn("absolute http(s) URL", str(raised.exception))

    def test_dashscope_profile_ignores_dirty_openai_timeout_env(self):
        env = {
            **PROVIDER_ENV_BASELINE,
            "VOCASKETCH_PROVIDER_PROFILE": "dashscope",
            "VOCASKETCH_DASHSCOPE_TEXT_MODEL": "dashscope-text-placeholder",
            "VOCASKETCH_DASHSCOPE_IMAGE_MODEL": "dashscope-image-placeholder",
            "VOCASKETCH_OPENAI_TIMEOUT_SECONDS": "abc",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            provider_config = get_provider_config()
            self.assertEqual(provider_config.profile, ProviderProfile.dashscope)
            self.assertEqual(provider_config.dashscope.textModel, "dashscope-text-placeholder")

        with self._client(extra_env=env) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.dashscope)
            self.assertTrue(runtime_info.placeholder)

    def test_local_profile_ignores_dirty_openai_base_url_env(self):
        env = {
            **PROVIDER_ENV_BASELINE,
            "VOCASKETCH_PROVIDER_PROFILE": "local",
            "VOCASKETCH_LOCAL_PROVIDER_RUNTIME": "local-placeholder",
            "VOCASKETCH_OPENAI_API_BASE_URL": "not-a-url",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            provider_config = get_provider_config()
            self.assertEqual(provider_config.profile, ProviderProfile.local)
            self.assertEqual(provider_config.local.runtimeName, "local-placeholder")

        with self._client(extra_env=env) as client:
            runtime_info = client.app.state.provider_runtime_info
            self.assertEqual(runtime_info.profile, ProviderProfile.local)
            self.assertTrue(runtime_info.placeholder)

    def test_failed_events_include_safe_observability_fields(self):
        with self._client(
            extra_env={
                "VOCASKETCH_PROVIDER_PROFILE": "openai",
                "VOCASKETCH_OPENAI_RESPONSE_MODEL": "gpt-placeholder",
                "VOCASKETCH_OPENAI_IMAGE_MODEL": "image-placeholder",
            }
        ) as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "placeholder should fail safely", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]

            failed = self._wait_for_status(client, job_id, "failed")
            self.assertEqual(failed["error"]["code"], "PROVIDER_ERROR")
            self.assertTrue(failed["error"]["retryable"])
            self.assertEqual(failed["error"]["provider"], "openai-placeholder")
            self.assertEqual(failed["error"]["details"]["node"], "parse_intent_node")

            events = self._list_events(client, job_id, expected_type="job.failed")
            failed_event = next(event for event in events if event["type"] == "job.failed")
            failed_status_event = next(
                event
                for event in events
                if event["type"] == "job.status_changed" and event["status"] == "failed"
            )
            self.assertEqual(failed_event["payload"]["code"], "PROVIDER_ERROR")
            self.assertEqual(failed_event["payload"]["phase"], "parsing")
            self.assertTrue(failed_event["payload"]["retryable"])
            self.assertEqual(failed_event["payload"]["provider"], "openai-placeholder")
            self.assertEqual(failed_event["payload"]["details"]["node"], "parse_intent_node")
            self.assertEqual(failed_status_event["payload"]["error"]["code"], "PROVIDER_ERROR")
            self.assertNotIn("Traceback", json.dumps(events, ensure_ascii=False))

    def test_cancel_terminal_job_returns_409(self):
        with self._client() as client:
            created = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "cancel terminal boundary", "locale": "zh-CN"},
            )
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            self._wait_for_status(client, job_id, "preview_ready")

            cancelled = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "test"})
            self.assertEqual(cancelled.status_code, 200, cancelled.text)

            cancel_again = client.post(f"/api/v2/drawing-jobs/{job_id}/cancel", json={"reason": "again"})
            self.assertEqual(cancel_again.status_code, 409, cancel_again.text)

    def test_retry_non_failed_job_returns_409_and_failed_job_retries(self):
        with self._client() as client:
            active = client.post(
                "/api/v2/drawing-jobs",
                json={"inputText": "retry boundary active", "locale": "zh-CN"},
            )
            self.assertEqual(active.status_code, 202, active.text)
            active_job_id = active.json()["jobId"]
            self._wait_for_status(client, active_job_id, "preview_ready")

            retry_active = client.post(
                f"/api/v2/drawing-jobs/{active_job_id}/retry",
                json={"reason": "not failed"},
            )
            self.assertEqual(retry_active.status_code, 409, retry_active.text)

            failing = client.post(
                "/api/v2/drawing-jobs",
                json={
                    "inputText": "retry boundary failed",
                    "locale": "zh-CN",
                    "simulateFailureAt": "preview_generating",
                },
            )
            self.assertEqual(failing.status_code, 202, failing.text)
            failed_job_id = failing.json()["jobId"]
            self._wait_for_status(client, failed_job_id, "failed")

            retried = client.post(
                f"/api/v2/drawing-jobs/{failed_job_id}/retry",
                json={"fromPhase": "preview_generating", "reason": "stage11"},
            )
            self.assertEqual(retried.status_code, 202, retried.text)
            body = retried.json()
            self.assertNotEqual(body["jobId"], failed_job_id)
            self.assertEqual(body["retryOfJobId"], failed_job_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
