"""Typed error taxonomy for the CAST AI Enterprise Dashboard (B1).

Contract: docs/security-requirements.md SEC-2.2/SEC-2.7, docs/api-matrix.md §0.

Every message that crosses one of these exceptions is sanitized at
construction: the configured API key and any Authorization-like header values
are scrubbed before they can reach logs, UI, or tracebacks. Messages must be
generic enough to satisfy SEC-2.7 (no raw API bodies in user-facing output);
callers log the sanitized message, never the raw one.
"""

from __future__ import annotations

import re
from typing import Any

__all__ = [
    "CastAIError",
    "AuthError",
    "PermissionDeniedError",
    "NotFoundError",
    "RateLimitedError",
    "ServerError",
    "ApiTimeoutError",
    "ConfigError",
    "error_kind",
]

# API keys/cache poisoning defence: register secret material to scrub here.
_SECRET_VALUES: list[str] = []

# Authorization-like header values: "X-API-Key: abc", "Authorization: Bearer abc".
_AUTH_VALUE_RE = re.compile(
    r"(?i)\b(authorization|x-api-key|x-castai-organization-id|proxy-authorization)"
    r"(\s*[:=]\s*)(?:bearer\s+|basic\s+)?([^\s,;\]\)\}\"']+)"
)


def register_secret(value: Any) -> None:
    """Register secret material to be scrubbed from all future error messages.

    Called once by config.settings after resolving the key. Empty/short values
    are ignored (scrubbing a tiny substring would mangle ordinary text).
    """

    if isinstance(value, str) and len(value) >= 6 and value not in _SECRET_VALUES:
        _SECRET_VALUES.append(value)


def sanitize_message(text: Any) -> str:
    """Return a string safe for logs/UI: secrets and header values scrubbed."""

    if text is None:
        return ""
    out = str(text)
    for secret in _SECRET_VALUES:
        out = out.replace(secret, "***")
    out = _AUTH_VALUE_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}***", out)
    return out


def error_kind(exc: BaseException) -> str:
    """Stable classifier tag for FetchError.kind (GAP-B): the concrete
    exception class name, e.g. ``ServerError``/``ApiTimeoutError``. Purely
    type-derived — it can never carry secrets or user data."""

    return type(exc).__name__


class CastAIError(Exception):
    """Base dashboard error. The message is sanitized at construction."""

    def __init__(self, message: Any = "") -> None:
        self.message = sanitize_message(message)
        super().__init__(self.message)

    def __str__(self) -> str:  # sanitized copy, not raw args
        return self.message

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.message!r})"


class AuthError(CastAIError):
    """HTTP 401 — key rejected. NEVER retried (credentials do not heal)."""


class PermissionDeniedError(CastAIError):
    """HTTP 403 — missing scope, or a forbidden verb/path (SEC-4). NEVER retried."""


class NotFoundError(CastAIError):
    """HTTP 404 — resource absent. NEVER retried."""


class RateLimitedError(CastAIError):
    """HTTP 429 — throttled. ``retry_after`` seconds (from Retry-After) or None."""

    def __init__(self, message: Any = "", retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = float(retry_after) if retry_after is not None else None


class ServerError(CastAIError):
    """HTTP 5xx — upstream failure. Retriable."""


class ApiTimeoutError(CastAIError):
    """Connect/read timeout (network-side). Retriable."""


class ConfigError(CastAIError):
    """Configuration missing/invalid. Fail-closed; NEVER retried."""
