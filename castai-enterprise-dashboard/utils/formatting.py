"""Display formatting helpers (B1) — all pd.NA/None-safe.

Contract: docs/architecture.md §5 sentinels (``0 != pd.NA != "No data"`` —
missing must NEVER render as 0, and a real 0 must render as "0"-family).
Units per docs/data-model.md / api-matrix.md §0.1: money USD, RAM GiB,
CPU cores. ``hours_to_monthly`` uses the run-rate convention 730 h (§5 KPI).

Every public helper returns a str; missing values render as "N/A" via
``fmt_na`` semantics, never raise, and never leak the raw value type.
"""

from __future__ import annotations

import math
from decimal import Decimal
from typing import Any

import pandas as pd

__all__ = [
    "fmt_money_usd",
    "fmt_money_compact",
    "fmt_percent",
    "fmt_pct",
    "fmt_gib",
    "fmt_cores",
    "fmt_count",
    "fmt_na",
    "hours_to_monthly",
]

NA_DISPLAY = "N/A"
_NEGATIVE_ZERO_GUARD = 0.0005  # below this, -0.0 formats as 0 (not -0)


def _to_float(v: Any) -> float | None:
    """Defensive proto3-string-numeric parse; None for any missing/weird."""

    if v is None:
        return None
    try:
        if pd.isna(v):  # None, NaN, pd.NA, NaT — all missing sentinels
            return None
    except (TypeError, ValueError):
        pass  # e.g. list input — treat as missing below
    if isinstance(v, Decimal):
        out = float(v)  # Decimal is exact; float() is total
        return out if math.isfinite(out) else None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
        v = v.replace(",", "").replace("$", "")
        try:
            out = float(v)
        except ValueError:
            return None
        return out if math.isfinite(out) else None
    try:
        out = float(v)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def fmt_na(v: Any, display: str = NA_DISPLAY) -> str:
    """Identity renderer: value as str, or ``display`` when missing."""

    f = _to_float(v)
    if f is not None:
        return _fmt_auto_number(f)
    if v is None:
        return display
    try:
        if pd.isna(v):
            return display
    except (TypeError, ValueError):
        return display
    return str(v)


def _fmt_auto_number(f: float) -> str:
    """0 -> "0"; integers without decimals; others trimmed to 2 decimals."""

    if abs(f) < _NEGATIVE_ZERO_GUARD:
        return "0"
    if f == int(f) and abs(f) < 1e15:
        return f"{int(f)}"
    return f"{f:.2f}".rstrip("0").rstrip(".")


def fmt_money_usd(v: Any) -> str:
    """USD amount: $0.00, $-1.25, $1234.57 (thousands-separated). N/A-safe."""

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    if abs(f) < 0.005:  # collapse -$0.00
        return "$0.00"
    sign = "-" if f < 0 else ""
    return f"{sign}${abs(f):,.2f}"


def fmt_money_compact(v: Any) -> str:
    """USD compact: $1.2K / $3.4M / $2.1B. N/A-safe; 0 -> $0."""

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    sign = "-" if f < 0 else ""
    a = abs(f)
    for threshold, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if a >= threshold:
            return f"{sign}${a / threshold:.1f}{suffix}"
    if a < 0.005:
        return "$0"
    return f"{sign}${a:.2f}".rstrip("0").rstrip(".") if a < 1 else f"{sign}${a:,.0f}"


def fmt_percent(v: Any, decimals: int = 1) -> str:
    """0–100 scale (api-matrix convention): 12.34 -> "12.3%", 0 -> "0.0%"."""

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    if abs(f) < 0.5 * (10 ** -decimals):  # collapse -0.0%
        f = 0.0
    return f"{f:.{decimals}f}%"


def fmt_pct(v: Any, *, scale: str = "fraction", decimals: int = 1) -> str:
    """Central percent formatter (ADR v2 R5): one entry point for BOTH pct
    conventions flowing through the app.

    * ``scale="fraction"`` — value on the 0–1 scale (efficiency/utilization
      ratios, coverage ratios): ``0.473`` -> ``"47.3%"``.
    * ``scale="percent"`` — value already on the 0–100 scale (e.g.
      ``report_cost_pct_change``: the CAST AI report payload ships percent
      numbers, NOT fractions): ``-12.4`` -> ``"-12.4%"``.

    Missing/non-numeric -> ``"N/A"``. Never raises; the sign is preserved
    (negative percents are honest deltas, not clamped). Use this everywhere a
    percent renders so the 0–1 vs 0–100 inconsistency can never leak.
    """

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    if scale == "fraction":
        return fmt_percent(f * 100.0, decimals=decimals)
    if scale == "percent":
        return fmt_percent(f, decimals=decimals)
    raise ValueError(f"unknown fmt_pct scale {scale!r}")


def fmt_gib(v: Any) -> str:
    """GiB amount: "512 GiB", "0.5 GiB", 0 -> "0 GiB". N/A-safe."""

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    if abs(f) < _NEGATIVE_ZERO_GUARD:
        return "0 GiB"
    sign = "-" if f < 0 else ""
    a = abs(f)
    if a >= 100 and a == int(a):
        return f"{sign}{int(a)} GiB"
    return f"{sign}{a:,.1f} GiB"


def fmt_cores(v: Any) -> str:
    """CPU cores: "16 cores", "0.5 cores", 0 -> "0 cores". N/A-safe."""

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    if abs(f) < _NEGATIVE_ZERO_GUARD:
        return "0 cores"
    sign = "-" if f < 0 else ""
    a = abs(f)
    if a == int(a) and a >= 1:
        return f"{sign}{int(a)} cores"
    return f"{sign}{a:.2f}".replace(".00", "").rstrip("0").rstrip(".") + " cores"


def fmt_count(v: Any) -> str:
    """Integer count with thousands separators: 1234 -> "1,234"; 0 -> "0"."""

    f = _to_float(v)
    if f is None:
        return NA_DISPLAY
    return f"{int(round(f)):,}"


def hours_to_monthly(hourly: Any, hours: float = 730) -> float | None:
    """Run-rate conversion: USD/hour -> USD/month (730 h convention).

    Returns None for missing input (missing never becomes 0 in KPIs).
    """

    f = _to_float(hourly)
    if f is None:
        return None
    return f * hours
