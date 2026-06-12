from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol


class TransportError(RuntimeError):
    pass


class TransportTimeoutError(TransportError):
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
            raise TransportError("The LLM provider returned an unexpected response envelope.") from exc


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
