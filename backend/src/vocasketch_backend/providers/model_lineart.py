from __future__ import annotations

import asyncio
import base64
import json
import os
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from ..models import AssetRecord, ImagePrompt
from .base import GeneratedAssetSpec, ProviderError, ProviderSchemaError, ProviderTimeoutError
from .transports import _detect_image_mime_type


LINEART_PROVIDER_ENV = "VOCASKETCH_LINEART_PROVIDER"
LINEART_ENABLED_ENV = "VOCASKETCH_ENABLE_MODEL_LINEART"
LINEART_MODEL_ENV = "VOCASKETCH_LINEART_MODEL"
LINEART_API_BASE_URL_ENV = "VOCASKETCH_LINEART_API_BASE_URL"
LINEART_API_KEY_ENV = "VOCASKETCH_LINEART_API_KEY"
IMAGE_TRANSPORT_ENV = "VOCASKETCH_OPENAI_IMAGE_TRANSPORT"
IMAGE_MODEL_ENV = "VOCASKETCH_OPENAI_IMAGE_MODEL"
IMAGE_API_BASE_URL_ENV = "VOCASKETCH_OPENAI_IMAGE_API_BASE_URL"
IMAGE_API_KEY_ENV = "VOCASKETCH_OPENAI_IMAGE_API_KEY"


def is_model_lineart_configured() -> bool:
    live_enabled = os.getenv("VOCASKETCH_PROVIDER_ALLOW_LIVE_REQUESTS", "0").strip().lower() in {"1", "true", "yes", "on"}
    lineart_enabled = os.getenv(LINEART_ENABLED_ENV, "0").strip().lower() in {"1", "true", "yes", "on"}
    provider = _lineart_provider()
    return (
        live_enabled
        and lineart_enabled
        and provider in {"dashscope", "gemini"}
        and bool(_lineart_api_key(provider))
        and bool(_lineart_model())
    )


async def generate_model_lineart_asset_spec(
    *,
    final_asset: AssetRecord,
    final_content_path: Path,
    image_prompt: ImagePrompt | None,
    timeout_seconds: float = 90.0,
) -> GeneratedAssetSpec:
    provider = _lineart_provider()
    if provider == "dashscope":
        return await _generate_dashscope_lineart_asset_spec(
            final_asset=final_asset,
            final_content_path=final_content_path,
            image_prompt=image_prompt,
            timeout_seconds=timeout_seconds,
        )
    if provider != "gemini":
        raise ProviderSchemaError(
            "Unsupported model lineart provider.",
            provider="model-lineart",
            details={"provider": provider or "missing"},
        )

    request = _GeminiLineartRequest(
        api_base_url=_lineart_api_base_url(provider),
        api_key=_lineart_api_key(provider),
        model=_lineart_model(),
        source_png_bytes=await asyncio.to_thread(_prepare_source_png_bytes, final_content_path),
        prompt=_lineart_prompt(image_prompt),
        timeout_seconds=timeout_seconds,
    )


async def _generate_dashscope_lineart_asset_spec(
    *,
    final_asset: AssetRecord,
    final_content_path: Path,
    image_prompt: ImagePrompt | None,
    timeout_seconds: float,
) -> GeneratedAssetSpec:
    request = _DashScopeLineartRequest(
        api_base_url=_lineart_api_base_url("dashscope"),
        api_key=_lineart_api_key("dashscope"),
        model=_lineart_model(),
        source_png_bytes=await asyncio.to_thread(_prepare_source_png_bytes, final_content_path),
        prompt=_lineart_prompt(image_prompt),
        timeout_seconds=timeout_seconds,
    )
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_send_dashscope_lineart_request, request),
            timeout=request.timeout_seconds + 1.0,
        )
    except TimeoutError as exc:
        raise ProviderTimeoutError(
            "DashScope lineart generation timed out.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc
    except ProviderError:
        raise
    except Exception as exc:
        raise ProviderError(
            "DashScope lineart generation failed.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc

    if not result["content_bytes"]:
        raise ProviderSchemaError(
            "DashScope lineart generation returned empty image bytes.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        )

    return GeneratedAssetSpec(
        kind="layer",
        role="lineart",
        label="Clean Model Lineart",
        mime_type=result["mime_type"],
        width=result["width"],
        height=result["height"],
        order=2,
        opacity=1.0,
        blend_mode="multiply",
        source_final_asset_id=final_asset.assetId,
        content_bytes=result["content_bytes"],
        file_extension=_extension_for_mime(result["mime_type"]),
        metadata={
            "provider": "dashscope-lineart",
            "model": request.model,
            "mode": "model-clean-lineart",
            "sourceFinalAssetId": final_asset.assetId,
            "note": "Clean lineart generated from the final image and used as the stroke/vector source.",
            "providerMetadata": {
                "mimeType": result["mime_type"],
                "requestId": result.get("request_id"),
                "remoteImageUrlPresent": result.get("remote_image_url_present", False),
            },
        },
    )
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(_send_gemini_lineart_request, request),
            timeout=request.timeout_seconds + 1.0,
        )
    except TimeoutError as exc:
        raise ProviderTimeoutError(
            "Model lineart generation timed out.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc
    except ProviderError:
        raise
    except Exception as exc:
        raise ProviderError(
            "Model lineart generation failed.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc

    if not result["content_bytes"]:
        raise ProviderSchemaError(
            "Model lineart generation returned empty image bytes.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        )

    return GeneratedAssetSpec(
        kind="layer",
        role="lineart",
        label="Clean Model Lineart",
        mime_type=result["mime_type"],
        width=result["width"],
        height=result["height"],
        order=2,
        opacity=1.0,
        blend_mode="multiply",
        source_final_asset_id=final_asset.assetId,
        content_bytes=result["content_bytes"],
        file_extension=_extension_for_mime(result["mime_type"]),
        metadata={
            "provider": "gemini-lineart",
            "model": request.model,
            "mode": "model-clean-lineart",
            "sourceFinalAssetId": final_asset.assetId,
            "note": "Clean lineart generated from the final image and used as the stroke/vector source.",
            "providerMetadata": {
                "mimeType": result["mime_type"],
                "requestId": result.get("request_id"),
                "textResponsePresent": result.get("text_response_present", False),
            },
        },
    )


class _GeminiLineartRequest:
    def __init__(self, *, api_base_url: str, api_key: str, model: str, source_png_bytes: bytes, prompt: str, timeout_seconds: float) -> None:
        self.api_base_url = api_base_url or "https://generativelanguage.googleapis.com/v1beta"
        self.api_key = api_key
        self.model = model
        self.source_png_bytes = source_png_bytes
        self.prompt = prompt
        self.timeout_seconds = timeout_seconds


class _DashScopeLineartRequest:
    def __init__(self, *, api_base_url: str, api_key: str, model: str, source_png_bytes: bytes, prompt: str, timeout_seconds: float) -> None:
        self.api_base_url = api_base_url or "https://dashscope.aliyuncs.com/api/v1"
        self.api_key = api_key
        self.model = model
        self.source_png_bytes = source_png_bytes
        self.prompt = prompt
        self.timeout_seconds = timeout_seconds


def _send_dashscope_lineart_request(request: _DashScopeLineartRequest) -> dict[str, Any]:
    if not request.api_key or not request.model:
        raise ProviderSchemaError(
            "DashScope lineart provider is missing api key or model.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        )

    payload = {
        "model": request.model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"image": "data:image/png;base64," + base64.b64encode(request.source_png_bytes).decode("ascii")},
                        {"text": request.prompt},
                    ],
                }
            ]
        },
        "parameters": {
            "n": 1,
            "watermark": False,
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    target_url = request.api_base_url.rstrip("/") + "/services/aigc/multimodal-generation/generation"
    http_request = urllib.request.Request(
        target_url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {request.api_key}",
            "X-DashScope-SSE": "disable",
        },
    )
    try:
        with urllib.request.urlopen(http_request, timeout=request.timeout_seconds) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise ProviderError(
            f"DashScope lineart provider returned HTTP {exc.code}.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart", "status": exc.code},
        ) from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError):
            raise ProviderTimeoutError(
                "DashScope lineart provider connection timed out.",
                provider="dashscope-lineart",
                details={"artifact": "cleanLineart"},
            ) from exc
        raise ProviderError(
            "DashScope lineart provider connection failed.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc

    try:
        decoded = json.loads(response_body)
        request_id = decoded.get("request_id") or decoded.get("requestId")
        image_ref = _first_image_reference(decoded)
        content_bytes = _read_image_reference(image_ref, timeout_seconds=request.timeout_seconds)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ProviderSchemaError(
            "DashScope lineart provider returned an unexpected response envelope.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc

    detected = _detect_image_mime_type(content_bytes)
    if detected is None:
        raise ProviderSchemaError(
            "DashScope lineart provider returned unsupported image bytes.",
            provider="dashscope-lineart",
            details={"artifact": "cleanLineart"},
        )
    width, height = _image_size(content_bytes)
    return {
        "content_bytes": content_bytes,
        "mime_type": detected,
        "width": width,
        "height": height,
        "request_id": request_id,
        "remote_image_url_present": image_ref.startswith("http://") or image_ref.startswith("https://"),
    }


def _send_gemini_lineart_request(request: _GeminiLineartRequest) -> dict[str, Any]:
    if not request.api_key or not request.model:
        raise ProviderSchemaError(
            "Gemini lineart provider is missing api key or model.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": request.prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": base64.b64encode(request.source_png_bytes).decode("ascii"),
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    target_url = f"{request.api_base_url.rstrip('/')}/models/{request.model}:generateContent"
    http_request = urllib.request.Request(
        target_url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": request.api_key,
        },
    )
    try:
        with urllib.request.urlopen(http_request, timeout=request.timeout_seconds) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise ProviderError(
            f"Gemini lineart provider returned HTTP {exc.code}.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart", "status": exc.code},
        ) from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError):
            raise ProviderTimeoutError(
                "Gemini lineart provider connection timed out.",
                provider="gemini-lineart",
                details={"artifact": "cleanLineart"},
            ) from exc
        raise ProviderError(
            "Gemini lineart provider connection failed.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc

    try:
        decoded = json.loads(response_body)
        request_id = decoded.get("responseId") or decoded.get("response_id")
        image_part = _first_inline_image_part(decoded)
        content_bytes = base64.b64decode(image_part["data"])
        mime_type = image_part["mime_type"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ProviderSchemaError(
            "Gemini lineart provider returned an unexpected response envelope.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        ) from exc

    detected = _detect_image_mime_type(content_bytes)
    if detected is None:
        raise ProviderSchemaError(
            "Gemini lineart provider returned unsupported image bytes.",
            provider="gemini-lineart",
            details={"artifact": "cleanLineart"},
        )
    width, height = _image_size(content_bytes)
    return {
        "content_bytes": content_bytes,
        "mime_type": detected or mime_type,
        "width": width,
        "height": height,
        "request_id": request_id,
        "text_response_present": _has_text_response(decoded),
    }


def _first_inline_image_part(decoded: dict[str, Any]) -> dict[str, str]:
    candidates = decoded.get("candidates")
    if not isinstance(candidates, list):
        raise KeyError("candidates")
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline_data = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline_data, dict):
                continue
            data = inline_data.get("data")
            mime_type = inline_data.get("mimeType") or inline_data.get("mime_type") or "image/png"
            if isinstance(data, str) and isinstance(mime_type, str) and mime_type.startswith("image/"):
                return {"data": data, "mime_type": mime_type}
    raise KeyError("inline image")


def _has_text_response(decoded: dict[str, Any]) -> bool:
    for candidate in decoded.get("candidates", []) if isinstance(decoded.get("candidates"), list) else []:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if isinstance(parts, list) and any(isinstance(part, dict) and isinstance(part.get("text"), str) for part in parts):
            return True
    return False


def _first_image_reference(value: object) -> str:
    if isinstance(value, str):
        if value.startswith(("http://", "https://", "data:image/")):
            return value
        raise KeyError("image reference")
    if isinstance(value, list):
        for item in value:
            try:
                return _first_image_reference(item)
            except KeyError:
                continue
    if isinstance(value, dict):
        for key in ("image", "url", "image_url", "output_url", "b64_json"):
            item = value.get(key)
            if isinstance(item, str) and item:
                if key == "b64_json":
                    return f"data:image/png;base64,{item}"
                if key == "image_url" and not item.startswith(("http://", "https://", "data:image/")):
                    continue
                return item
            if isinstance(item, dict):
                nested = item.get("url")
                if isinstance(nested, str) and nested:
                    return nested
        for item in value.values():
            try:
                return _first_image_reference(item)
            except KeyError:
                continue
    raise KeyError("image reference")


def _read_image_reference(image_ref: str, *, timeout_seconds: float) -> bytes:
    if image_ref.startswith("data:image/"):
        try:
            _, encoded = image_ref.split(",", 1)
            return base64.b64decode(encoded)
        except (ValueError, TypeError) as exc:
            raise ProviderSchemaError(
                "DashScope lineart provider returned an invalid data URL.",
                provider="dashscope-lineart",
                details={"artifact": "cleanLineart"},
            ) from exc

    if image_ref.startswith(("http://", "https://")):
        http_request = urllib.request.Request(
            image_ref,
            method="GET",
            headers={
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "User-Agent": "Mozilla/5.0 VocaSketch lineart downloader",
            },
        )
        try:
            with urllib.request.urlopen(http_request, timeout=timeout_seconds) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            raise ProviderError(
                f"DashScope lineart image download returned HTTP {exc.code}.",
                provider="dashscope-lineart",
                details={"artifact": "cleanLineart", "status": exc.code},
            ) from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise ProviderTimeoutError(
                    "DashScope lineart image download timed out.",
                    provider="dashscope-lineart",
                    details={"artifact": "cleanLineart"},
                ) from exc
            raise ProviderError(
                "DashScope lineart image download failed.",
                provider="dashscope-lineart",
                details={"artifact": "cleanLineart"},
            ) from exc

    raise ProviderSchemaError(
        "DashScope lineart provider returned an unsupported image reference.",
        provider="dashscope-lineart",
        details={"artifact": "cleanLineart"},
    )


def _lineart_provider() -> str:
    explicit = os.getenv(LINEART_PROVIDER_ENV, "").strip().lower()
    if explicit:
        return explicit
    image_transport = os.getenv(IMAGE_TRANSPORT_ENV, "").strip().lower()
    if image_transport == "dashscope":
        return "dashscope"
    return "gemini"


def _lineart_model() -> str:
    return os.getenv(LINEART_MODEL_ENV, "").strip() or os.getenv(IMAGE_MODEL_ENV, "").strip()


def _lineart_api_key(provider: str) -> str:
    explicit = os.getenv(LINEART_API_KEY_ENV, "").strip()
    if explicit:
        return explicit
    if provider == "dashscope":
        return os.getenv(IMAGE_API_KEY_ENV, "").strip()
    return ""


def _lineart_api_base_url(provider: str) -> str:
    explicit = os.getenv(LINEART_API_BASE_URL_ENV, "").strip()
    if explicit:
        return explicit
    if provider == "dashscope":
        return os.getenv(IMAGE_API_BASE_URL_ENV, "").strip() or "https://dashscope.aliyuncs.com/api/v1"
    return "https://generativelanguage.googleapis.com/v1beta"


def _prepare_source_png_bytes(path: Path) -> bytes:
    with Image.open(path) as image:
        image = image.convert("RGB")
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (image.width, image.height), "white")
        canvas.paste(image, (0, 0))
        output = BytesIO()
        canvas.save(output, format="PNG")
        return output.getvalue()


def _image_size(content_bytes: bytes) -> tuple[int, int]:
    with Image.open(BytesIO(content_bytes)) as image:
        return image.width, image.height


def _extension_for_mime(mime_type: str) -> str:
    if mime_type == "image/png":
        return "png"
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type == "image/webp":
        return "webp"
    raise ProviderSchemaError(
        "Gemini lineart provider returned an unsupported mime type.",
        provider="gemini-lineart",
        details={"mimeType": mime_type},
    )


def _lineart_prompt(image_prompt: ImagePrompt | None) -> str:
    source_hint = image_prompt.positivePrompt[:500] if image_prompt else "the provided final anime illustration"
    return (
        "Convert the provided final colored illustration into a clean anime production lineart image.\n"
        "Requirements:\n"
        "- Preserve the exact character identity, pose, face, hair silhouette, clothing, and composition.\n"
        "- Output only black or dark gray line art on a pure white background.\n"
        "- Include complete outer contours and important interior details: hair strands, eyes, mouth, neck, clothing seams, tie, hands, and folds.\n"
        "- Remove all color, shadows, gradients, watercolor texture, background glow, highlights, and painterly noise.\n"
        "- Do not redraw into a different character. Do not crop. Do not add text, watermark, panels, or UI.\n"
        "- The result should be suitable for vectorization and stroke-by-stroke drawing playback.\n\n"
        f"Original generation prompt summary: {source_hint}"
    )
