"""Structlog-lite logging on stdlib (B1) — JSON-ish extras, secret scrubbing.

Contract: docs/security-requirements.md SEC-2.2 (never log headers; redaction
helper replaces the configured key and Authorization-like header values),
SEC-7 (ids over names in log fields), performance.md §7 (JSON-line events).

Usage::

    log = get_logger(__name__)
    log.info("api_call", extra={"endpoint": path, "status": 200, "latency_ms": 12})

All ``extra`` values and the message pass through :func:`scrub` before
emission. Request/response headers MUST NOT be passed here at all — a
``headers`` extra key is dropped defensively.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

__all__ = ["get_logger", "scrub", "configure_secret_scrub"]

# Secret material registered by config.settings.load_settings(). Same >=6-char
# guard as utils.errors to avoid mangling ordinary text with tiny substrings.
_SECRET_VALUES: list[str] = []

_AUTH_VALUE_RE = re.compile(
    r"(?i)\b(authorization|x-api-key|x-castai-organization-id|proxy-authorization)"
    r"(\s*[:=]\s*)(?:bearer\s+|basic\s+)?([^\s,;\]\)\}\"']+)"
)

_FORBIDDEN_EXTRA_KEYS = frozenset(
    {"headers", "request_headers", "response_headers", "set-cookie", "cookie"}
)


def configure_secret_scrub(value: Any) -> None:
    """Register secret material (typically the API key) for scrubbing."""

    if isinstance(value, str) and len(value) >= 6 and value not in _SECRET_VALUES:
        _SECRET_VALUES.append(value)


def scrub(text: Any) -> str:
    """Remove the configured key and Authorization-like header values.

    Applied to every message and structured-log field before emission
    (SEC-2.2). Safe on any input; returns a string.
    """

    if text is None:
        return ""
    out = str(text)
    for secret in _SECRET_VALUES:
        out = out.replace(secret, "***")
    out = _AUTH_VALUE_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}***", out)
    return out


class _ScrubbingJsonFormatter(logging.Formatter):
    """JSON-ish one-line formatter; scrubs message + extra values."""

    def format(self, record: logging.LogRecord) -> str:
        base: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "event": scrub(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.lower() in _FORBIDDEN_EXTRA_KEYS:
                continue  # headers never cross into logs (SEC-2.2)
            base[key] = scrub(value) if isinstance(value, str) else value
        if record.exc_info:
            base["exc"] = scrub(self.formatException(record.exc_info))
        return json.dumps(base, ensure_ascii=True, default=str)


_RESERVED = frozenset(
    logging.makeLogRecord({}).__dict__.keys()
) | {"message", "asctime", "taskName"}


_configured = False


def _ensure_configured() -> None:
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler()  # stderr; no file by default (SEC-7.3)
    handler.setFormatter(_ScrubbingJsonFormatter())
    root = logging.getLogger("castai_dashboard")
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    root.propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Process-shared ``castai_dashboard.<name>`` logger with scrubbing."""

    _ensure_configured()
    return logging.getLogger(f"castai_dashboard.{name}")
