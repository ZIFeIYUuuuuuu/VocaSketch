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
from vocasketch_backend.models import AssetRecord, PlaybackManifest, PlaybackManifestStep
from vocasketch_backend.providers.process_playback import enrich_manifest_with_process


class ProcessPlaybackTests(unittest.TestCase):
    def _client(self):
        tempdir = tempfile.TemporaryDirectory(prefix="vocasketch_backend_process_test_")
        env_patch = {
            "VOCASKETCH_BACKEND_DATA_DIR": tempdir.name,
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
            self.assertEqual(process["version"], "process-v2")
            self.assertEqual(process["style"], "linedrawer-color-derived")
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
            self.assertEqual(manifest_payload["process"]["version"], "process-v2")
            self.assertIn("eyeSpark", {action["type"] for action in manifest_payload["process"]["actions"]})

    def test_process_manifest_can_derive_strokes_from_final_image(self):
        try:
            from PIL import Image, ImageDraw
            import cv2  # noqa: F401
        except Exception as exc:
            self.skipTest(f"optional image tooling unavailable: {exc}")

        with tempfile.TemporaryDirectory(prefix="vocasketch_process_image_test_") as tempdir:
            image_path = Path(tempdir) / "final.png"
            image = Image.new("RGB", (512, 512), "white")
            draw = ImageDraw.Draw(image)
            draw.ellipse((130, 80, 382, 390), outline="black", width=5)
            draw.arc((170, 170, 250, 250), 200, 340, fill="black", width=4)
            draw.arc((262, 170, 342, 250), 200, 340, fill="black", width=4)
            draw.line((190, 360, 322, 360), fill="black", width=5)
            image.save(image_path)

            manifest = PlaybackManifest(
                manifestVersion="0.3.0",
                canvasSize={"width": 512, "height": 512},
                durationMs=5200,
                steps=[
                    PlaybackManifestStep(
                        stepId="step-sketch",
                        order=1,
                        role="sketch",
                        label="10% 草图",
                        startMs=0,
                        durationMs=900,
                    )
                ],
            )
            final_asset = AssetRecord(
                assetId="asset_test_final",
                jobId="job_test",
                kind="final",
                role="final",
                mimeType="image/png",
                url="/api/v2/assets/asset_test_final",
                contentUrl="/api/v2/assets/asset_test_final/content",
                width=512,
                height=512,
                storagePath="content/job_test/asset_test_final.png",
            )

            enriched = enrich_manifest_with_process(
                manifest,
                final_asset=final_asset,
                final_content_path=image_path,
            )
            process = enriched.process or {}
            contour_strokes = [
                action
                for action in process["actions"]
                if action["type"] == "stroke" and action.get("source") == "final-image-contour"
            ]

            self.assertEqual(process["version"], "process-v2")
            self.assertEqual(process["source"]["mode"], "final-image-edge-color-process")
            self.assertGreater(process["source"]["strokeCount"], 10)
            self.assertGreater(len(contour_strokes), 10)
            self.assertLessEqual(max(point["x"] for action in contour_strokes for point in action["points"]), 1)
            self.assertLessEqual(max(point["y"] for action in contour_strokes for point in action["points"]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
