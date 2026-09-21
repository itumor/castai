"""ADR v2 R2 cross-check: waste drift math (final-review MAJOR wiring)."""

from __future__ import annotations

import math

from app import _waste_drift


def test_both_sides_missing_no_verdict():
    assert _waste_drift(None, None) == (None, None)
    assert _waste_drift(100.0, None) == (None, None)
    assert _waste_drift(None, 100.0) == (None, None)


def test_zero_frame_sum_no_verdict():
    # Nothing to compare against — never claim "pass" on an empty base.
    assert _waste_drift(0.0, 5.0) == (None, None)
    assert _waste_drift(-1.0, 5.0) == (None, None)


def test_within_five_percent_passes():
    drift, exceeded = _waste_drift(100.0, 104.9)
    assert exceeded is False
    assert math.isclose(drift, 0.049, rel_tol=1e-9)


def test_above_five_percent_warns():
    drift, exceeded = _waste_drift(100.0, 106.0)
    assert exceeded is True
    assert math.isclose(drift, 0.06, rel_tol=1e-9)


def test_string_inputs_parse_and_negative_diff_uses_abs():
    # proto3-style strings; |190-200|/200 = exactly 5% -> strict '>' does NOT warn.
    drift, exceeded = _waste_drift("200", "190")
    assert exceeded is False
    assert math.isclose(drift, 0.05, rel_tol=1e-9)
    drift_over, exceeded_over = _waste_drift("200", "180")  # 10% drift -> warns
    assert exceeded_over is True
    assert math.isclose(drift_over, 0.10, rel_tol=1e-9)


def test_unparseable_inputs_no_verdict():
    assert _waste_drift("n/a", 5) == (None, None)
    assert _waste_drift(5, "junk") == (None, None)
