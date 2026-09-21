"""Dashboard configuration — env-first, fail-closed (B1).

Contract: docs/security-requirements.md SEC-1 (precedence env > st.secrets),
SEC-1.4 (fail closed, generic messages), SEC-4 (base-URL https + regional
allow-list = anti-exfiltration), CHK-04 (this is the ONLY module that reads
CASTAI_API_KEY / st.secrets).

* ``load_settings()`` resolves and validates everything; raises ConfigError.
* ``Settings.get_api_key()`` is the single key accessor; the key never appears
  in ``__repr__``/messages.
* streamlit is imported lazily inside helpers so tests need no streamlit
  runtime (ImportError tolerated).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from utils.errors import ConfigError, register_secret
from utils.logging import configure_secret_scrub

# Anti-exfiltration allow-list (SEC-1.4 / Appendix A).
ALLOWED_BASE_HOSTS: frozenset[str] = frozenset(
    {"api.cast.ai", "api.eu.cast.ai", "api.in.cast.ai"}
)

DEFAULT_BASE_URL = "https://api.eu.cast.ai"  # Siemens = EU data residency

_ENV_API_KEY = "CASTAI_API_KEY"
_ENV_BASE_URL = "CASTAI_BASE_URL"
_ENV_ENTERPRISE_ID = "CASTAI_ENTERPRISE_ID"
_ENV_MAX_WORKERS = "CASTAI_MAX_WORKERS"
_ENV_FLAG_NOTIFICATIONS = "CASTAI_ENABLE_NOTIFICATIONS"
_ENV_FLAG_ORG_EFFICIENCY = "CASTAI_ENABLE_ORG_EFFICIENCY"
_ENV_FLAG_ACTIVE_PROBE = "CASTAI_ENABLE_ACTIVE_PROBE"

_MAX_WORKERS_MIN = 4
_MAX_WORKERS_MAX = 32
_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off"}

__all__ = ["Settings", "load_settings", "ALLOWED_BASE_HOSTS", "DEFAULT_BASE_URL"]


def _env_get(name: str) -> str | None:
    value = os.environ.get(name)
    if value is None:
        return None
    value = value.strip()
    return value if value else None


def _secrets_get(key: str) -> str | None:
    """Read a Streamlit secret defensively; never raises, never leaks paths.

    streamlit is imported lazily (config must import without a streamlit
    runtime). A missing secrets.toml raises StreamlitSecretNotFoundError even
    for ``.get(..., default)`` on 1.64 — caught here; its message contains
    filesystem paths, so it is swallowed rather than propagated.
    """

    try:
        import streamlit as st  # lazy by design (SEC-1.1 fallback only)
    except ImportError:
        return None
    try:
        value = st.secrets.get(key)
    except Exception:  # missing file / parse error / no runtime — all benign
        return None
    if value is None:
        return None
    value = str(value).strip()
    return value if value else None


def _resolve(name: str, secret_key: str, default: str | None = None) -> str | None:
    """Precedence: environment variable first, then st.secrets (SEC-1.1)."""

    value = _env_get(name)
    if value is not None:
        return value
    value = _secrets_get(secret_key)
    if value is not None:
        return value
    return default


def _validate_base_url(raw: str) -> str:
    """https scheme + regional host allow-list, else ConfigError (fail closed)."""

    candidate = raw.strip()
    try:
        parts = urlsplit(candidate)
        scheme = parts.scheme.lower()
        host = (parts.hostname or "").lower()
    except ValueError:
        raise ConfigError("CAST AI is not configured correctly (base URL).")
    ok = parts.username is None and parts.password is None  # no userinfo tricks
    if ok and scheme == "https" and host in ALLOWED_BASE_HOSTS:
        return f"{scheme}://{host}"  # normalized, no trailing slash
    raise ConfigError("CAST AI is not configured correctly (base URL).")


def _parse_workers(raw: str | None) -> int:
    if raw is None:
        return 8
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ConfigError("CAST AI is not configured correctly (worker count).")
    return max(_MAX_WORKERS_MIN, min(_MAX_WORKERS_MAX, value))  # clamp 4..32


def _parse_bool(name: str, raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    lowered = raw.strip().lower()
    if lowered in _TRUE_VALUES:
        return True
    if lowered in _FALSE_VALUES:
        return False
    raise ConfigError(f"CAST AI is not configured correctly ({name}).")


@dataclass
class Settings:
    """Resolved, validated configuration. ``_api_key`` is write-only-ish:

    reachable only through ``get_api_key()`` and excluded from ``__repr__``.
    """

    base_url: str
    enterprise_id: str | None = None
    max_workers: int = 8
    enable_notifications: bool = False
    enable_org_efficiency: bool = True
    enable_active_probe: bool = False
    _api_key: str = field(default="", repr=False, compare=False)

    def get_api_key(self) -> str:
        """The single read path for the key (SEC-1.4 / CHK-04)."""
        if not self._api_key:
            raise ConfigError("CAST AI is not configured.")
        return self._api_key

    def __repr__(self) -> str:  # redacted by construction (SEC-2 / CHK-05)
        return (
            "Settings("
            f"base_url={self.base_url!r}, "
            f"enterprise_id={'***' if self.enterprise_id else None!r}, "
            f"max_workers={self.max_workers}, "
            f"enable_notifications={self.enable_notifications}, "
            f"enable_org_efficiency={self.enable_org_efficiency}, "
            f"enable_active_probe={self.enable_active_probe}, "
            "api_key='***')"
        )


def load_settings() -> Settings:
    """Resolve config (env > st.secrets), validate, fail closed on any gap.

    Messages are generic by design (SEC-1.4): no partial key values, no
    filesystem paths from secrets-parsing errors.
    """

    api_key = _resolve(_ENV_API_KEY, "castai.api_key")
    if api_key is None:
        raise ConfigError("CAST AI is not configured.")  # generic, fail closed

    base_url = _validate_base_url(
        _resolve(_ENV_BASE_URL, "castai.base_url", DEFAULT_BASE_URL) or DEFAULT_BASE_URL
    )
    enterprise_id = _resolve(_ENV_ENTERPRISE_ID, "castai.enterprise_id")
    max_workers = _parse_workers(_env_get(_ENV_MAX_WORKERS) or _secrets_get("castai.max_workers"))
    enable_notifications = _parse_bool(
        _ENV_FLAG_NOTIFICATIONS, _resolve(_ENV_FLAG_NOTIFICATIONS, "castai.enable_notifications"), False
    )
    enable_org_efficiency = _parse_bool(
        _ENV_FLAG_ORG_EFFICIENCY,
        _resolve(_ENV_FLAG_ORG_EFFICIENCY, "castai.enable_org_efficiency"),
        True,
    )
    enable_active_probe = _parse_bool(
        _ENV_FLAG_ACTIVE_PROBE, _resolve(_ENV_FLAG_ACTIVE_PROBE, "castai.enable_active_probe"), False
    )

    # Register the key with both scrub layers BEFORE it can flow anywhere else.
    register_secret(api_key)
    configure_secret_scrub(api_key)

    return Settings(
        base_url=base_url,
        enterprise_id=enterprise_id,
        max_workers=max_workers,
        enable_notifications=enable_notifications,
        enable_org_efficiency=enable_org_efficiency,
        enable_active_probe=enable_active_probe,
        _api_key=api_key,
    )
