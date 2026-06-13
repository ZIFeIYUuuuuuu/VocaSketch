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
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from vocasketch_backend.main import create_app
from vocasketch_backend.models import AssetRecord, PlaybackManifest, PlaybackManifestStep
from vocasketch_backend.providers.process_playback import enrich_manifest_with_process
from tools.render_process_manifest import load_optional_asset_image


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
            self.assertEqual(process["version"], "process-v3")
            self.assertEqual(process["style"], "linedrawer-color-derived")
            self.assertEqual(process["source"]["previewAssetId"], completed["previewAssetId"])
            self.assertEqual(process["source"]["finalAssetId"], completed["finalAssetId"])
            self.assertTrue(process["source"]["finalContentUrl"])
            self.assertTrue(process["source"]["previewContentUrl"])
            self.assertEqual(process["source"]["mode"], "preview-guided-final-refined-process")
            self.assertEqual(
                [phase["role"] for phase in process["phases"]],
                ["sketch", "lineart", "flat_color", "shadow", "lighting", "details"],
            )
            action_types = {action["type"] for action in process["actions"]}
            self.assertTrue({"stroke", "fillRegion", "maskReveal", "layerBadge", "finalReveal"}.issubset(action_types))
            self.assertNotIn("eyeSpark", action_types)
            fill_actions = [action for action in process["actions"] if action["type"] == "fillRegion"]
            self.assertTrue(fill_actions)
            self.assertTrue(all(action.get("sourceImage") == "preview" for action in fill_actions))
            self.assertGreaterEqual(completed["playbackManifest"]["durationMs"], 11000)

            serialized = json.dumps(process, ensure_ascii=False)
            self.assertNotIn("apiKey", serialized)
            self.assertNotIn("Authorization", serialized)
            self.assertNotIn("Bearer", serialized)

            manifest_asset = client.get(f"/api/v2/assets/{completed['playbackManifestAssetId']}").json()
            manifest_content = client.get(manifest_asset["contentUrl"])
            self.assertEqual(manifest_content.status_code, 200, manifest_content.text)
            manifest_payload = manifest_content.json()
            self.assertEqual(manifest_payload["process"]["version"], "process-v3")
            self.assertNotIn("eyeSpark", {action["type"] for action in manifest_payload["process"]["actions"]})

    def test_process_manifest_can_derive_strokes_from_final_image(self):
        try:
            from PIL import Image, ImageDraw
            import cv2  # noqa: F401
        except Exception as exc:
            self.skipTest(f"optional image tooling unavailable: {exc}")

        with tempfile.TemporaryDirectory(prefix="vocasketch_process_image_test_") as tempdir:
            image_path = Path(tempdir) / "final.png"
            preview_path = Path(tempdir) / "preview.png"
            preview = Image.new("RGB", (512, 512), "white")
            preview_draw = ImageDraw.Draw(preview)
            preview_draw.ellipse((150, 100, 365, 405), outline="#7a8597", width=7)
            preview_draw.line((240, 120, 240, 390), fill="#7a8597", width=5)
            preview.save(preview_path)
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
            preview_asset = AssetRecord(
                assetId="asset_test_preview",
                jobId="job_test",
                kind="preview",
                role="preview",
                mimeType="image/png",
                url="/api/v2/assets/asset_test_preview",
                contentUrl="/api/v2/assets/asset_test_preview/content",
                width=512,
                height=512,
                storagePath="content/job_test/asset_test_preview.png",
            )

            enriched = enrich_manifest_with_process(
                manifest,
                preview_asset=preview_asset,
                final_asset=final_asset,
                preview_content_path=preview_path,
                final_content_path=image_path,
            )
            process = enriched.process or {}
            contour_strokes = [
                action
                for action in process["actions"]
                if action["type"] == "stroke" and action.get("source") == "final-image-contour"
            ]

            self.assertEqual(process["version"], "process-v3")
            self.assertEqual(process["source"]["mode"], "preview-guided-final-refined-process")
            self.assertEqual(process["source"]["previewAssetId"], preview_asset.assetId)
            self.assertGreater(process["source"]["strokeCount"], 6)
            self.assertGreater(len(contour_strokes), 6)
            self.assertLessEqual(max(point["x"] for action in contour_strokes for point in action["points"]), 1)
            self.assertLessEqual(max(point["y"] for action in contour_strokes for point in action["points"]), 1)
            fill_actions = [action for action in process["actions"] if action["type"] == "fillRegion"]
            self.assertTrue(fill_actions)
            self.assertTrue(all(action.get("sourceImage") == "preview" for action in fill_actions))

    def test_process_manifest_filters_border_noise_from_image_derived_strokes(self):
        try:
            from PIL import Image, ImageDraw
            import cv2  # noqa: F401
        except Exception as exc:
            self.skipTest(f"optional image tooling unavailable: {exc}")

        with tempfile.TemporaryDirectory(prefix="vocasketch_process_filter_test_") as tempdir:
            image_path = Path(tempdir) / "final.png"
            preview_path = Path(tempdir) / "preview.png"
            preview = Image.new("RGB", (512, 512), "white")
            preview_draw = ImageDraw.Draw(preview)
            preview_draw.ellipse((182, 112, 350, 405), outline="#7a8597", width=8)
            preview_draw.line((260, 140, 260, 388), fill="#7a8597", width=6)
            preview.save(preview_path)
            image = Image.new("RGB", (512, 512), "white")
            draw = ImageDraw.Draw(image)
            draw.rectangle((2, 2, 509, 509), outline="black", width=4)
            draw.line((10, 450, 500, 30), fill="black", width=3)
            draw.ellipse((170, 90, 360, 420), outline="black", width=5)
            draw.arc((205, 165, 265, 225), 200, 340, fill="black", width=4)
            draw.arc((275, 165, 335, 225), 200, 340, fill="black", width=4)
            draw.line((228, 315, 308, 315), fill="black", width=4)
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
            preview_asset = AssetRecord(
                assetId="asset_test_preview",
                jobId="job_test",
                kind="preview",
                role="preview",
                mimeType="image/png",
                url="/api/v2/assets/asset_test_preview",
                contentUrl="/api/v2/assets/asset_test_preview/content",
                width=512,
                height=512,
                storagePath="content/job_test/asset_test_preview.png",
            )

            enriched = enrich_manifest_with_process(
                manifest,
                preview_asset=preview_asset,
                final_asset=final_asset,
                preview_content_path=preview_path,
                final_content_path=image_path,
            )
            process = enriched.process or {}
            contour_strokes = [
                action
                for action in process["actions"]
                if action["type"] == "stroke" and action.get("source") == "final-image-contour"
            ]

            self.assertTrue(contour_strokes)
            self.assertTrue(
                all(
                    min(point["x"] for point in action["points"]) > 0.03
                    and max(point["x"] for point in action["points"]) < 0.97
                    and min(point["y"] for point in action["points"]) > 0.03
                    and max(point["y"] for point in action["points"]) < 0.97
                    for action in contour_strokes
                )
            )
            fill_actions = [action for action in process["actions"] if action["type"] == "fillRegion"]
            self.assertTrue(fill_actions)
            self.assertTrue(all(action.get("sourceImage") == "preview" for action in fill_actions))

    def test_old_process_v2_manifest_is_rebuilt(self):
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
            process={
                "version": "process-v2",
                "renderer": "canvas-final-image-luma-strokes",
                "source": {"mode": "final-image-edge-color-process"},
                "actions": [{"id": "old-eye-spark", "type": "eyeSpark"}],
            },
        )
        preview_asset = AssetRecord(
            assetId="asset_test_preview",
            jobId="job_test",
            kind="preview",
            role="preview",
            mimeType="image/png",
            url="/api/v2/assets/asset_test_preview",
            contentUrl="/api/v2/assets/asset_test_preview/content",
            width=512,
            height=512,
            storagePath="content/job_test/asset_test_preview.png",
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
            preview_asset=preview_asset,
            final_asset=final_asset,
        )

        self.assertEqual(enriched.process["version"], "process-v3")
        self.assertEqual(enriched.process["source"]["mode"], "preview-guided-final-refined-process")
        self.assertNotIn("eyeSpark", {action["type"] for action in enriched.process["actions"]})

    def test_job_detail_refreshes_old_process_manifest_through_real_api(self):
        with self._client() as client:
            created = client.post("/api/v2/drawing-jobs", json={"inputText": "打开历史任务时自动升级过程播放", "locale": "zh-CN"})
            self.assertEqual(created.status_code, 202, created.text)
            job_id = created.json()["jobId"]
            self._wait_for_status(client, job_id, "preview_ready")

            confirmed = client.post(f"/api/v2/drawing-jobs/{job_id}/confirm", json={})
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            completed = self._wait_for_status(client, job_id, "completed")
            old_manifest_asset_id = completed["playbackManifestAssetId"]

            store = client.app.state.job_store
            job_path = store._job_path(job_id)
            payload = store._read_json(job_path)
            self.assertIsNotNone(payload)
            self.assertIsNotNone(payload["playbackManifest"])
            payload["playbackManifest"]["process"] = {
                "version": "process-v2",
                "renderer": "canvas-final-image-luma-strokes",
                "source": {"mode": "final-image-edge-color-process"},
                "actions": [{"id": "old-eye-spark", "type": "eyeSpark"}],
            }
            store._write_json(job_path, payload)

            refreshed_response = client.get(f"/api/v2/drawing-jobs/{job_id}")
            self.assertEqual(refreshed_response.status_code, 200, refreshed_response.text)
            refreshed = refreshed_response.json()
            process = refreshed["playbackManifest"]["process"]
            self.assertEqual(process["version"], "process-v3")
            self.assertEqual(process["source"]["mode"], "preview-guided-final-refined-process")
            self.assertEqual(process["source"]["previewAssetId"], refreshed["previewAssetId"])
            self.assertEqual(process["source"]["finalAssetId"], refreshed["finalAssetId"])
            self.assertNotIn("eyeSpark", {action["type"] for action in process["actions"]})
            self.assertNotEqual(refreshed["playbackManifestAssetId"], old_manifest_asset_id)

            persisted_payload = store._read_json(job_path)
            self.assertEqual(persisted_payload["playbackManifest"]["process"]["version"], "process-v3")
            manifest_asset = client.get(f"/api/v2/assets/{refreshed['playbackManifestAssetId']}").json()
            manifest_content = client.get(manifest_asset["contentUrl"])
            self.assertEqual(manifest_content.status_code, 200, manifest_content.text)
            self.assertEqual(manifest_content.json()["process"]["version"], "process-v3")

    def test_render_tool_missing_preview_asset_content_falls_back_to_final(self):
        with tempfile.TemporaryDirectory(prefix="vocasketch_render_tool_test_") as tempdir:
            data_dir = Path(tempdir)
            assets_dir = data_dir / "assets"
            assets_dir.mkdir(parents=True)
            missing_asset_id = "asset_missing_preview"
            (assets_dir / f"{missing_asset_id}.json").write_text(
                json.dumps({"assetId": missing_asset_id, "storagePath": "content/job/missing.png"}),
                encoding="utf-8",
            )

            self.assertIsNone(load_optional_asset_image(data_dir, missing_asset_id))


if __name__ == "__main__":
    unittest.main(verbosity=2)
