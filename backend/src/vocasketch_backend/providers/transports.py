from __future__ import annotations

import asyncio
import base64
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol


class TransportError(RuntimeError):
    pass


class TransportTimeoutError(TransportError):
    pass


class TransportSchemaError(TransportError):
    pass


@dataclass(frozen=True)
class TextGenerationRequest:
    api_base_url: str
    api_key: str
    model: str
    system_prompt: str
    user_prompt: str
    timeout_seconds: float = 20.0
    temperature: float = 0.2


class TextGenerationTransport(Protocol):
    async def generate_json(self, request: TextGenerationRequest) -> str: ...


@dataclass(frozen=True)
class ImageGenerationRequest:
    api_base_url: str
    api_key: str
    model: str
    prompt: str
    negative_prompt: str | None
    size: str
    timeout_seconds: float = 45.0
    mode: str = "final"
    quality: str | None = None
    seed: int | None = None
    group: str | None = None


@dataclass(frozen=True)
class ImageGenerationResult:
    content_bytes: bytes
    mime_type: str
    width: int
    height: int
    seed: int | None = None
    provider_metadata: dict[str, object] | None = None


class ImageGenerationTransport(Protocol):
    async def generate_image(self, request: ImageGenerationRequest) -> ImageGenerationResult: ...


@dataclass(frozen=True)
class LayerDecompositionRequest:
    api_base_url: str
    api_key: str
    model: str
    job_id: str
    final_asset: dict[str, object]
    prompt_summary: dict[str, object]
    requested_roles: list[str]
    timeout_seconds: float = 45.0


@dataclass(frozen=True)
class LayerDecompositionItem:
    role: str
    label: str
    mime_type: str
    width: int
    height: int
    content_bytes: bytes
    order: int
    opacity: float
    blend_mode: str
    metadata: dict[str, object] | None = None


@dataclass(frozen=True)
class LayerDecompositionResult:
    layers: list[LayerDecompositionItem]
    provider_metadata: dict[str, object] | None = None


class LayerDecompositionTransport(Protocol):
    async def decompose_layers(self, request: LayerDecompositionRequest) -> LayerDecompositionResult: ...


class OpenAICompatibleTextTransport:
    async def generate_json(self, request: TextGenerationRequest) -> str:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._send_request, request),
                timeout=request.timeout_seconds + 1.0,
            )
        except TimeoutError as exc:
            raise TransportTimeoutError("The LLM text transport timed out.") from exc
        except TransportTimeoutError:
            raise
        except TransportError:
            raise
        except Exception as exc:
            raise TransportError("The LLM text transport failed.") from exc

    def _send_request(self, request: TextGenerationRequest) -> str:
        payload = {
            "model": request.model,
            "temperature": request.temperature,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": request.system_prompt},
                {"role": "user", "content": request.user_prompt},
            ],
        }
        body = json.dumps(payload).encode("utf-8")
        target_url = request.api_base_url.rstrip("/") + "/chat/completions"
        http_request = urllib.request.Request(
            target_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {request.api_key}",
            },
        )

        try:
            with urllib.request.urlopen(http_request, timeout=request.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise TransportError(f"LLM provider returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The LLM provider connection timed out.") from exc
            raise TransportError("The LLM provider connection failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The LLM provider request timed out.") from exc

        try:
            decoded = json.loads(response_body)
            return decoded["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise TransportSchemaError("The LLM provider returned an unexpected response envelope.") from exc


class OpenAICompatibleImageTransport:
    async def generate_image(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._send_request, request),
                timeout=request.timeout_seconds + 1.0,
            )
        except TimeoutError as exc:
            raise TransportTimeoutError("The image transport timed out.") from exc
        except (TransportTimeoutError, TransportSchemaError):
            raise
        except TransportError:
            raise
        except Exception as exc:
            raise TransportError("The image transport failed.") from exc

    def _send_request(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        payload: dict[str, object] = {
            "model": request.model,
            "prompt": request.prompt,
            "size": request.size,
            "response_format": "b64_json",
        }

        body = json.dumps(payload).encode("utf-8")
        target_url = request.api_base_url.rstrip("/") + "/images/generations"
        http_request = urllib.request.Request(
            target_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "Origin": request.api_base_url.rstrip("/").removesuffix("/v1"),
                "Referer": request.api_base_url.rstrip("/").removesuffix("/v1") + "/console/playground",
                "User-Agent": _browser_user_agent(),
                "Authorization": f"Bearer {request.api_key}",
            },
        )

        try:
            with urllib.request.urlopen(http_request, timeout=request.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise TransportError(f"Image provider returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The image provider connection timed out.") from exc
            raise TransportError("The image provider connection failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The image provider request timed out.") from exc

        try:
            decoded = json.loads(response_body)
            item = decoded["data"][0]
            encoded = item["b64_json"]
            content_bytes = base64.b64decode(encoded)
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise TransportSchemaError("The image provider returned an unexpected response envelope.") from exc

        mime_type = _detect_image_mime_type(content_bytes)
        if mime_type is None:
            raise TransportSchemaError("The image provider returned bytes with an unsupported mime type.")

        width, height = _parse_image_size(request.size)
        return ImageGenerationResult(
            content_bytes=content_bytes,
            mime_type=mime_type,
            width=width,
            height=height,
            seed=request.seed,
            provider_metadata={
                "mode": request.mode,
                "quality": request.quality,
                "mimeType": mime_type,
                "revisedPromptPresent": bool(item.get("revised_prompt")),
            },
        )


class OpenAIChatCompatibleImageTransport:
    async def generate_image(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._send_request, request),
                timeout=request.timeout_seconds + 1.0,
            )
        except TimeoutError as exc:
            raise TransportTimeoutError("The chat image transport timed out.") from exc
        except (TransportTimeoutError, TransportSchemaError):
            raise
        except TransportError:
            raise
        except Exception as exc:
            raise TransportError("The chat image transport failed.") from exc

    def _send_request(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        prompt_parts = [request.prompt]
        if request.negative_prompt:
            prompt_parts.append(f"Negative prompt: {request.negative_prompt}")
        prompt_parts.append(f"Canvas size: {request.size}. Return one image only.")

        payload: dict[str, object] = {
            "model": request.model,
            "messages": [
                {
                    "role": "user",
                    "content": "\n\n".join(prompt_parts),
                }
            ],
        }
        if request.group:
            payload["group"] = request.group
        if request.seed is not None:
            payload["seed"] = request.seed

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        target_url = request.api_base_url.rstrip("/") + "/chat/completions"
        http_request = urllib.request.Request(
            target_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "Origin": request.api_base_url.rstrip("/").removesuffix("/v1"),
                "Referer": request.api_base_url.rstrip("/").removesuffix("/v1") + "/console/playground",
                "User-Agent": _browser_user_agent(),
                "Authorization": f"Bearer {request.api_key}",
            },
        )

        try:
            with urllib.request.urlopen(http_request, timeout=request.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise TransportError(f"Chat image provider returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The chat image provider connection timed out.") from exc
            raise TransportError("The chat image provider connection failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The chat image provider request timed out.") from exc

        image_ref = _extract_chat_image_reference(response_body)
        content_bytes = _read_image_reference(image_ref, timeout_seconds=request.timeout_seconds)
        mime_type = _detect_image_mime_type(content_bytes)
        if mime_type is None:
            raise TransportSchemaError("The chat image provider returned bytes with an unsupported mime type.")

        width, height = _parse_image_size(request.size)
        return ImageGenerationResult(
            content_bytes=content_bytes,
            mime_type=mime_type,
            width=width,
            height=height,
            seed=request.seed,
            provider_metadata={
                "mode": request.mode,
                "transport": "openai-chat-compatible",
                "mimeType": mime_type,
                "remoteImageUrlPresent": image_ref.startswith("http://") or image_ref.startswith("https://"),
            },
        )


class DashScopeImageTransport:
    async def generate_image(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._send_request, request),
                timeout=request.timeout_seconds + 1.0,
            )
        except TimeoutError as exc:
            raise TransportTimeoutError("The DashScope image transport timed out.") from exc
        except (TransportTimeoutError, TransportSchemaError):
            raise
        except TransportError:
            raise
        except Exception as exc:
            raise TransportError("The DashScope image transport failed.") from exc

    def _send_request(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        width, height = _parse_image_size(request.size)
        prompt_parts = [request.prompt]
        if request.negative_prompt:
            prompt_parts.append(f"Negative prompt: {request.negative_prompt}")

        payload: dict[str, object] = {
            "model": request.model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": "\n".join(prompt_parts)}],
                    }
                ]
            },
            "parameters": {
                "size": f"{width}*{height}",
                "n": 1,
                "watermark": False,
            },
        }
        if request.seed is not None:
            payload["parameters"]["seed"] = request.seed  # type: ignore[index]

        body = json.dumps(payload).encode("utf-8")
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
            raise TransportError(f"DashScope image provider returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The DashScope image provider connection timed out.") from exc
            raise TransportError("The DashScope image provider connection failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The DashScope image provider request timed out.") from exc

        try:
            decoded = json.loads(response_body)
            request_id = decoded.get("request_id")
            content = decoded["output"]["choices"][0]["message"]["content"]
            image_url = _first_dashscope_image_url(content)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise TransportSchemaError("The DashScope image provider returned an unexpected response envelope.") from exc

        content_bytes = self._download_image(image_url, request.timeout_seconds)
        mime_type = _detect_image_mime_type(content_bytes)
        if mime_type is None:
            raise TransportSchemaError("The DashScope image provider returned bytes with an unsupported mime type.")

        return ImageGenerationResult(
            content_bytes=content_bytes,
            mime_type=mime_type,
            width=width,
            height=height,
            seed=request.seed,
            provider_metadata={
                "mode": request.mode,
                "provider": "dashscope",
                "mimeType": mime_type,
                "requestId": request_id,
                "remoteImageUrlPresent": True,
            },
        )

    @staticmethod
    def _download_image(image_url: str, timeout_seconds: float) -> bytes:
        try:
            http_request = urllib.request.Request(image_url, method="GET")
            with urllib.request.urlopen(http_request, timeout=timeout_seconds) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            raise TransportError(f"DashScope image download returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The DashScope image download timed out.") from exc
            raise TransportError("The DashScope image download failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The DashScope image download timed out.") from exc


class OpenAICompatibleLayerTransport:
    async def decompose_layers(self, request: LayerDecompositionRequest) -> LayerDecompositionResult:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self._send_request, request),
                timeout=request.timeout_seconds + 1.0,
            )
        except TimeoutError as exc:
            raise TransportTimeoutError("The layer decomposition transport timed out.") from exc
        except (TransportTimeoutError, TransportSchemaError):
            raise
        except TransportError:
            raise
        except Exception as exc:
            raise TransportError("The layer decomposition transport failed.") from exc

    def _send_request(self, request: LayerDecompositionRequest) -> LayerDecompositionResult:
        payload = {
            "model": request.model,
            "job_id": request.job_id,
            "final_asset": request.final_asset,
            "prompt_summary": request.prompt_summary,
            "requested_roles": request.requested_roles,
        }
        body = json.dumps(payload).encode("utf-8")
        target_url = request.api_base_url.rstrip("/") + "/images/decompositions"
        http_request = urllib.request.Request(
            target_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {request.api_key}",
            },
        )

        try:
            with urllib.request.urlopen(http_request, timeout=request.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raise TransportError(f"Layer provider returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The layer provider connection timed out.") from exc
            raise TransportError("The layer provider connection failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The layer provider request timed out.") from exc

        try:
            decoded = json.loads(response_body)
            raw_layers = decoded["layers"]
            layers = [
                _decode_layer_item(item, fallback_order=index, requested_roles=request.requested_roles)
                for index, item in enumerate(raw_layers, start=1)
            ]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise TransportSchemaError("The layer provider returned an unexpected response envelope.") from exc

        return LayerDecompositionResult(
            layers=layers,
            provider_metadata={"requestedRoles": request.requested_roles},
        )


class FakeTextTransport:
    def __init__(self, responses: list[str] | None = None, *, error: Exception | None = None) -> None:
        self._responses = list(responses or [])
        self._error = error
        self.requests: list[TextGenerationRequest] = []

    async def generate_json(self, request: TextGenerationRequest) -> str:
        self.requests.append(request)
        if self._error is not None:
            raise self._error
        if not self._responses:
            raise TransportError("Fake transport has no prepared response.")
        return self._responses.pop(0)


class FakeImageTransport:
    def __init__(self, responses: list[ImageGenerationResult] | None = None, *, error: Exception | None = None) -> None:
        self._responses = list(responses or [])
        self._error = error
        self.requests: list[ImageGenerationRequest] = []

    async def generate_image(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        self.requests.append(request)
        if self._error is not None:
            raise self._error
        if not self._responses:
            raise TransportError("Fake image transport has no prepared response.")
        return self._responses.pop(0)


class FakeLayerDecompositionTransport:
    def __init__(
        self,
        responses: list[LayerDecompositionResult] | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self._responses = list(responses or [])
        self._error = error
        self.requests: list[LayerDecompositionRequest] = []

    async def decompose_layers(self, request: LayerDecompositionRequest) -> LayerDecompositionResult:
        self.requests.append(request)
        if self._error is not None:
            raise self._error
        if not self._responses:
            raise TransportError("Fake layer decomposition transport has no prepared response.")
        return self._responses.pop(0)


def _parse_image_size(size: str) -> tuple[int, int]:
    try:
        width_text, height_text = size.lower().split("x", 1)
        width = int(width_text)
        height = int(height_text)
    except (AttributeError, ValueError) as exc:
        raise TransportSchemaError(f"Unsupported image size format '{size}'. Expected '<width>x<height>'.") from exc

    if width <= 0 or height <= 0:
        raise TransportSchemaError(f"Unsupported image size '{size}'. Width and height must be positive.")
    return width, height


def _first_dashscope_image_url(content: object) -> str:
    if not isinstance(content, list):
        raise TransportSchemaError("The DashScope image provider returned content in an unsupported format.")
    for item in content:
        if not isinstance(item, dict):
            continue
        image = item.get("image")
        if isinstance(image, str) and image:
            return image
    raise TransportSchemaError("The DashScope image provider did not return an image URL.")


def _browser_user_agent() -> str:
    return (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/137.0.0.0 Safari/537.36"
    )


def _extract_chat_image_reference(response_body: str) -> str:
    try:
        decoded = json.loads(response_body)
        message = decoded["choices"][0]["message"]
        content = message.get("content")
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise TransportSchemaError("The chat image provider returned an unexpected response envelope.") from exc

    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            image_url = item.get("image_url")
            if isinstance(image_url, dict) and isinstance(image_url.get("url"), str):
                return image_url["url"]
            if isinstance(item.get("url"), str):
                return item["url"]
            if isinstance(item.get("image"), str):
                return item["image"]
            if isinstance(item.get("b64_json"), str):
                return f"data:image/png;base64,{item['b64_json']}"

    if isinstance(content, str):
        data_url_match = re.search(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+", content)
        if data_url_match:
            return data_url_match.group(0).replace("\n", "").replace("\r", "")

        markdown_image_match = re.search(r"!\[[^\]]*]\((https?://[^)\s]+)\)", content)
        if markdown_image_match:
            return markdown_image_match.group(1)

        url_match = re.search(r"https?://[^\s)\"']+", content)
        if url_match:
            return url_match.group(0)

    raise TransportSchemaError("The chat image provider did not return a usable image reference.")


def _read_image_reference(image_ref: str, *, timeout_seconds: float) -> bytes:
    if image_ref.startswith("data:image/"):
        try:
            _, encoded = image_ref.split(",", 1)
            return base64.b64decode(encoded)
        except (ValueError, TypeError) as exc:
            raise TransportSchemaError("The chat image provider returned an invalid data URL.") from exc

    if image_ref.startswith("http://") or image_ref.startswith("https://"):
        http_request = urllib.request.Request(
            image_ref,
            method="GET",
            headers={
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "User-Agent": _browser_user_agent(),
            },
        )
        try:
            with urllib.request.urlopen(http_request, timeout=timeout_seconds) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            raise TransportError(f"Chat image download returned HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            if isinstance(reason, TimeoutError):
                raise TransportTimeoutError("The chat image download connection timed out.") from exc
            raise TransportError("The chat image download connection failed.") from exc
        except TimeoutError as exc:
            raise TransportTimeoutError("The chat image download timed out.") from exc

    raise TransportSchemaError("The chat image provider returned an unsupported image reference.")


def _detect_image_mime_type(content_bytes: bytes) -> str | None:
    stripped = content_bytes.lstrip()
    if stripped.startswith(b"<svg") or stripped.startswith(b"<?xml"):
        return "image/svg+xml"
    if content_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content_bytes) >= 12 and content_bytes[:4] == b"RIFF" and content_bytes[8:12] == b"WEBP":
        return "image/webp"
    return None


def _decode_layer_item(
    item: dict[str, object],
    *,
    fallback_order: int,
    requested_roles: list[str],
) -> LayerDecompositionItem:
    try:
        encoded = item["b64_json"]
        if not isinstance(encoded, str):
            raise ValueError("layer b64_json must be a string")
        content_bytes = base64.b64decode(encoded)
    except (KeyError, ValueError, TypeError) as exc:
        raise TransportSchemaError("Layer decomposition item is missing valid content bytes.") from exc

    mime_type = item.get("mime_type")
    if not isinstance(mime_type, str) or not mime_type:
        mime_type = _detect_image_mime_type(content_bytes)
    if mime_type is None:
        raise TransportSchemaError("Layer decomposition returned bytes with an unsupported mime type.")

    role = item.get("role")
    if not isinstance(role, str) or not role:
        raise TransportSchemaError("Layer decomposition item is missing role.")

    width = item.get("width")
    height = item.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        raise TransportSchemaError("Layer decomposition item is missing integer width/height.")

    label = item.get("label")
    order = item.get("order", fallback_order)
    opacity = item.get("opacity", 1.0)
    blend_mode = item.get("blend_mode", "normal")
    metadata = item.get("metadata")

    return LayerDecompositionItem(
        role=role,
        label=label if isinstance(label, str) and label else _label_for_role(role, requested_roles=requested_roles),
        mime_type=mime_type,
        width=width,
        height=height,
        content_bytes=content_bytes,
        order=order if isinstance(order, int) else fallback_order,
        opacity=float(opacity) if isinstance(opacity, (int, float)) else 1.0,
        blend_mode=blend_mode if isinstance(blend_mode, str) and blend_mode else "normal",
        metadata=metadata if isinstance(metadata, dict) else None,
    )


def _label_for_role(role: str, *, requested_roles: list[str]) -> str:
    labels = {
        "sketch": "Sketch Layer",
        "lineart": "Line Art Layer",
        "flat_color": "Flat Color Layer",
        "shadow": "Shadow Layer",
        "lighting": "Lighting Layer",
        "details": "Details Layer",
    }
    return labels.get(role, role if role in requested_roles else f"{role} Layer")
