from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

_SECRET_VALUE_PATTERN = re.compile(
    r"(?i)(api[_-]?key|token|secret|authorization|password|bearer|cookie)(\s*[:=]\s*)([^\s,;&]+)"
)
_AUTHORIZATION_BEARER_PATTERN = re.compile(r"(?i)(authorization\s*[:=]\s*)bearer\s+[^\s,;&]+")
_BEARER_PATTERN = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")


def api_error(
    *,
    status_code: int,
    code: str,
    message: str,
    retryable: bool = False,
    details: Mapping[str, Any] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=build_error_payload(
            code=code,
            message=message,
            retryable=retryable,
            details=details,
        ),
    )


def build_error_payload(
    *,
    code: str,
    message: str,
    retryable: bool,
    details: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": redact_text(message),
            "retryable": retryable,
            "details": sanitize_value(dict(details or {}), parent_key="details"),
        }
    }


async def v2_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if not request.url.path.startswith("/api/v2"):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    payload = _payload_from_http_exception(exc)
    return JSONResponse(status_code=exc.status_code, content=payload, headers=getattr(exc, "headers", None))


async def v2_validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    if not request.url.path.startswith("/api/v2"):
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    return JSONResponse(
        status_code=422,
        content=build_error_payload(
            code="VALIDATION_ERROR",
            message="request validation failed",
            retryable=False,
            details={"issues": _safe_validation_errors(exc.errors())},
        ),
    )


def sanitize_error_payload(error_payload: Mapping[str, Any]) -> dict[str, Any]:
    sanitized = dict(error_payload)
    if isinstance(sanitized.get("message"), str):
        sanitized["message"] = redact_text(sanitized["message"])
    if isinstance(sanitized.get("provider"), str):
        sanitized["provider"] = redact_text(sanitized["provider"])
    sanitized["details"] = sanitize_value(sanitized.get("details", {}), parent_key="details")
    return sanitized


def sanitize_value(value: Any, *, parent_key: str) -> Any:
    if _is_sensitive_key(parent_key):
        return "***"
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, Mapping):
        return {str(key): sanitize_value(item, parent_key=str(key)) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_value(item, parent_key=parent_key) for item in value]
    if isinstance(value, tuple):
        return [sanitize_value(item, parent_key=parent_key) for item in value]
    return value


def redact_text(value: str) -> str:
    redacted = _AUTHORIZATION_BEARER_PATTERN.sub(r"\1Bearer ***", value)
    redacted = _SECRET_VALUE_PATTERN.sub(r"\1\2***", redacted)
    redacted = _BEARER_PATTERN.sub("Bearer ***", redacted)
    return re.sub(r"https?://[^\s,]+", lambda match: _redact_url(match.group(0)), redacted)


def _payload_from_http_exception(exc: HTTPException) -> dict[str, Any]:
    if isinstance(exc.detail, Mapping) and isinstance(exc.detail.get("error"), Mapping):
        error = sanitize_error_payload(exc.detail["error"])
        error.setdefault("code", _default_code_for_status(exc.status_code))
        error.setdefault("message", _default_message_for_status(exc.status_code))
        error.setdefault("retryable", False)
        error.setdefault("details", {})
        return {"error": error}

    message = exc.detail if isinstance(exc.detail, str) else _default_message_for_status(exc.status_code)
    return build_error_payload(
        code=_default_code_for_status(exc.status_code),
        message=message,
        retryable=False,
        details={},
    )


def _safe_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    safe_errors: list[dict[str, Any]] = []
    for item in errors:
        safe_errors.append(
            {
                "loc": [str(part) for part in item.get("loc", [])],
                "msg": redact_text(str(item.get("msg", "validation error"))),
                "type": str(item.get("type", "validation_error")),
            }
        )
    return safe_errors


def _default_code_for_status(status_code: int) -> str:
    return {
        status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
        status.HTTP_404_NOT_FOUND: "NOT_FOUND",
        status.HTTP_409_CONFLICT: "CONFLICT",
        status.HTTP_410_GONE: "GONE",
        422: "VALIDATION_ERROR",
    }.get(status_code, "API_ERROR")


def _default_message_for_status(status_code: int) -> str:
    return {
        status.HTTP_400_BAD_REQUEST: "bad request",
        status.HTTP_404_NOT_FOUND: "resource not found",
        status.HTTP_409_CONFLICT: "request conflicts with current state",
        status.HTTP_410_GONE: "resource content is no longer available",
        422: "request validation failed",
    }.get(status_code, "api request failed")


def _redact_url(value: str) -> str:
    parts = urlsplit(value)
    if not parts.query:
        return value
    redacted_query = urlencode([(key, "***") for key, _ in parse_qsl(parts.query, keep_blank_values=True)])
    return urlunsplit((parts.scheme, parts.netloc, parts.path, redacted_query, ""))


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(
        token in lowered
        for token in (
            "key",
            "token",
            "secret",
            "authorization",
            "password",
            "bearer",
            "cookie",
        )
    )
