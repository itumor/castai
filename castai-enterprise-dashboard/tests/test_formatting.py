"""Formatting helper tests (B1) — None vs 0 vs huge; all NA-safe.

Core contract: missing (None/pd.NA/NaN) renders "N/A", a REAL 0 renders as
"0"-family — never conflated (docs/architecture.md §5 sentinels).
"""

from __future__ import annotations

import math

import pandas as pd
import pytest

from utils.formatting import (
    fmt_cores,
    fmt_count,
    fmt_gib,
    fmt_money_compact,
    fmt_money_usd,
    fmt_na,
    fmt_percent,
    hours_to_monthly,
)

NA = "N/A"


class TestMissingVsZero:
    """The sentinels contract: missing != 0, everywhere."""

    @pytest.mark.parametrize(
        "fn", [fmt_money_usd, fmt_money_compact, fmt_percent, fmt_gib, fmt_cores, fmt_count]
    )
    def test_none_renders_na(self, fn):
        assert fn(None) == NA

    @pytest.mark.parametrize(
        "fn", [fmt_money_usd, fmt_money_compact, fmt_percent, fmt_gib, fmt_cores, fmt_count]
    )
    def test_pd_na_renders_na(self, fn):
        assert fn(pd.NA) == NA
        assert fn(float("nan")) == NA

    @pytest.mark.parametrize(
        "fn,expected",
        [
            (fmt_money_usd, "$0.00"),
            (fmt_money_compact, "$0"),
            (fmt_percent, "0.0%"),
            (fmt_gib, "0 GiB"),
            (fmt_cores, "0 cores"),
            (fmt_count, "0"),
        ],
    )
    def test_real_zero_is_preserved(self, fn, expected):
        assert fn(0) == expected
        assert fn("0") == expected


class TestMoney:
    def test_usd_basic(self):
        assert fmt_money_usd(12.5) == "$12.50"
        assert fmt_money_usd(1234.5) == "$1,234.50"
        assert fmt_money_usd(-12.5) == "-$12.50"

    def test_usd_string_and_proto3(self):
        assert fmt_money_usd("12.5") == "$12.50"
        assert fmt_money_usd("1,234.5") == "$1,234.50"
        assert fmt_money_usd("") == NA
        assert fmt_money_usd("not-a-number") == NA

    def test_usd_negative_zero_collapses(self):
        assert fmt_money_usd(-0.0) == "$0.00"

    def test_compact_thresholds(self):
        assert fmt_money_compact(1200) == "$1.2K"
        assert fmt_money_compact(3_400_000) == "$3.4M"
        assert fmt_money_compact(2_100_000_000) == "$2.1B"
        assert fmt_money_compact(-3_400_000) == "-$3.4M"
        assert fmt_money_compact(999) == "$999"
        assert fmt_money_compact(0.4) == "$0.4"

    def test_compact_huge(self):
        # No crash, no N/A, stays compact-ish at absurd magnitudes.
        out = fmt_money_compact(1e15)
        assert out.startswith("$")
        assert out != NA


class TestPercent:
    def test_zero_to_hundred_scale(self):
        assert fmt_percent(12.34) == "12.3%"
        assert fmt_percent(12.34, decimals=2) == "12.34%"
        assert fmt_percent(50) == "50.0%"
        assert fmt_percent(100) == "100.0%"

    def test_negative_zero_collapses(self):
        assert fmt_percent(-0.0) == "0.0%"


class TestUnits:
    def test_gib(self):
        assert fmt_gib(512) == "512 GiB"
        assert fmt_gib(0.5) == "0.5 GiB"
        assert fmt_gib(512.4) == "512.4 GiB"

    def test_cores(self):
        assert fmt_cores(16) == "16 cores"
        assert fmt_cores(0.5) == "0.5 cores"
        assert fmt_cores(0.25) == "0.25 cores"

    def test_count(self):
        assert fmt_count(1234) == "1,234"
        assert fmt_count(1_000_000) == "1,000,000"
        assert fmt_count("1000") == "1,000"
        assert fmt_count(12.4) == "12"


class TestFmtNa:
    def test_defaults(self):
        assert fmt_na(None) == NA
        assert fmt_na(pd.NA) == NA

    def test_custom_display(self):
        assert fmt_na(None, display="—") == "—"
        assert fmt_na(pd.NA, "no data") == "no data"

    def test_values_pass_through(self):
        assert fmt_na(0) == "0"
        assert fmt_na("ready") == "ready"


class TestMonthly:
    def test_run_rate(self):
        assert hours_to_monthly(2) == pytest.approx(1460.0)
        assert hours_to_monthly("1.5") == pytest.approx(1095.0)
        assert hours_to_monthly(0) == 0.0  # real 0 stays 0
        assert hours_to_monthly(None) is None  # missing stays missing
        assert hours_to_monthly(1, hours=100) == pytest.approx(100.0)

    def test_missing_not_zero(self):
        assert hours_to_monthly(pd.NA) is None
        assert hours_to_monthly(math.inf) is None  # unbounded never renders
