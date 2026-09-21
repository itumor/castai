"""Retry helper (B1) — backoff with full jitter, Retry-After honored.

Contract: docs/performance.md §2.5 and docs/security-requirements.md SEC-2.6:
attempts = 4 total (1 + 3 retries); backoff = min(base * 2**n, cap) with full
jitter in [0, delay]; honor ``RateLimitedError.retry_after`` clamped 1..30 s.
401/403/404/ConfigError NEVER retried — they are simply absent from
``retry_on`` (and explicitly re-raised for defense in depth).

Capped exponential-jitter sleep in tests is patched via ``sleep`` injection.
"""

from __future__ import annotations

import random
import time
from typing import Any, Callable, TypeVar

from utils.errors import (
    ApiTimeoutError,
    AuthError,
    ConfigError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitedError,
    ServerError,
)

__all__ = ["with_retry"]

F = TypeVar("F")

_DEFAULT_RETRY_ON = (RateLimitedError, ServerError, ApiTimeoutError)

# Fail-fast taxonomy (SEC-2.6 / performance.md §2.5 "Never retried").
_NEVER_RETRY = (AuthError, PermissionDeniedError, NotFoundError, ConfigError)

_RETRY_AFTER_MIN = 1.0
_RETRY_AFTER_MAX = 30.0

# Total wait budget: attempt 0 -> attempt 3 worst case ≈ 0.5+1+2+4+... <= 15s
# per sleep; with cap=15 worst realistic sum stays well under 30 s (SEC-2.6).


def _sleep_seconds(exc: BaseException, attempt: int, base: float, cap: float) -> float:
    """Full-jitter exponential backoff; Retry-After honored and clamped."""

    if isinstance(exc, RateLimitedError) and exc.retry_after is not None:
        delay = min(max(exc.retry_after, _RETRY_AFTER_MIN), _RETRY_AFTER_MAX)
    else:
        delay = min(base * (2**attempt), cap)
    return random.uniform(0.0, delay)


def with_retry(
    func: Callable[[], F],
    *,
    retry_on: tuple[type[BaseException], ...] = _DEFAULT_RETRY_ON,
    attempts: int = 4,
    base: float = 0.5,
    cap: float = 15.0,
    sleep: Callable[[float], Any] | None = None,
) -> F:
    """Call ``func`` with up to ``attempts`` total tries.

    Retries only ``retry_on`` exception types. ``sleep`` defaults to
    ``time.sleep`` (resolved at CALL time so tests can monkeypatch it) and is
    injectable; ``random.uniform`` provides full jitter.
    """

    sleep_fn = time.sleep if sleep is None else sleep
    tries = max(1, int(attempts))
    for attempt in range(tries):
        try:
            return func()
        except _NEVER_RETRY:
            raise  # credentials/permission/config: fail fast, exactly 1 request
        except retry_on as exc:
            if attempt == tries - 1:
                raise
            sleep_fn(_sleep_seconds(exc, attempt, base, cap))
