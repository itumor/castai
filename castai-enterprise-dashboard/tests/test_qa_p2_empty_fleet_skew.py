"""QA phase-2 gap tests — literal empty fleet UI + clock-skew clamp.

Master-prompt gaps confirmed against phase 2:

  * "UI on LITERAL empty fleet": every existing AppTest renders 2–3 rows.
    The zero-cluster page (both an empty frame WITH the v2 column contract and
    a zero-column frame — the worst case a fresh org sweep can yield) was
    UNTESTED. Pinned here: full page must render with ZERO raises.
  * "freshness trio + skew clamp": normalizers clamp snapshot/fallback ages at
    ``max(0.0, …)`` so a clock-skewed FUTURE timestamp is 0 minutes old, never
    negative. The trio (latest_sync_time / snapshot_age_minutes /
    data_freshness_status) had tests for every case EXCEPT the skewed-future
    clamp. Pinned here at the exact wall-clock boundary.

No real network, no credentials, no Streamlit server (AppTest in-tree).
"""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from tests.test_normalizers import make_cluster_item
from tests.test_ui_v2 import (
    _APPT_HEADER,
    _HIER_PATCH,
    _ROW_V2_SRC,
    APITEST_TIMEOUT,
)

NOW = datetime(2026, 9, 21, 12, 0, 0, tzinfo=timezone.utc)
FUTURE = "2026-09-21T12:10:00Z"  # 10 minutes AHEAD of the pinned wall clock


@pytest.fixture
def pin_now(monkeypatch):
    monkeypatch.setattr("data.normalizers._utc_now", lambda: NOW)


# ---------------------------------------------------------- clock-skew clamp

def test_future_snapshot_timestamp_clamps_age_to_zero_never_negative(pin_now):
    from data.normalizers import build_fleet_row

    row = build_fleet_row(
        organization_id="org-1",
        organization_name="Org One",
        cluster_item=make_cluster_item(agentSnapshotReceivedAt=FUTURE),
        fetched_at="2026-09-21T12:00:00Z",
    )
    assert row["snapshot_age_minutes"] == 0.0            # clamped, not -10
    assert row["snapshot_age_minutes"] >= 0.0            # never negative
    assert row["data_freshness_status"] == "fresh"       # age 0 < 30 min bound
    assert row["latest_sync_time"] == pd.Timestamp(FUTURE)  # value kept as-is


def test_future_sweep_timestamp_fallback_also_clamps(pin_now):
    """Fallback path (no agent snapshot): a skewed FUTURE sweep ts is likewise
    0 minutes old, never negative — second max(0.0, …) site in normalizers."""
    from data.normalizers import build_fleet_row

    row = build_fleet_row(
        organization_id="org-1",
        organization_name="Org One",
        cluster_item=make_cluster_item(agentSnapshotReceivedAt=None),
        fetched_at=FUTURE,
    )
    assert row["latest_sync_time"] == pd.Timestamp(FUTURE)
    assert row["snapshot_age_minutes"] == 0.0
    assert row["data_freshness_status"] == "fresh"


# ------------------------------------------------------ literal empty fleet

def _run(script_body: str):
    from streamlit.testing.v1 import AppTest

    at = AppTest.from_string(_APPT_HEADER + script_body, default_timeout=APITEST_TIMEOUT)
    at.run()
    return at


def test_full_page_apptest_literal_empty_fleet_with_columns_renders():
    """Empty frame CARRYING the full v2 column contract (a sweep over an
    enterprise whose orgs all returned zero clusters)."""
    body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame(columns=list(_row("org-a", "web-1").keys()))\n'
        + _HIER_PATCH
    )
    at = _run(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    # Designed literal-empty contract (app.py main): explicit warning surface +
    # health banner + st.stop() — the KPI grid/table are skipped deliberately.
    assert any(
        "No clusters were returned for this enterprise" in (w.value or "")
        for w in at.warning
    ), [w.value for w in at.warning]


def test_full_page_apptest_zero_column_empty_frame_renders():
    """Worst case: a zero-column empty frame — every presence-check in the UI
    layer must degrade, never raise."""
    body = """
_FRAME = pd.DataFrame()
from models import Enterprise, Organization
from services.organization_service import DiscoveryResult
from services.cluster_service import FleetResult

_root = Organization("root", "Root", None, "ORGANIZATION_TYPE_ENTERPRISE")
_org_a = Organization("org-a", "Org A", "root", "ORGANIZATION_TYPE_CHILD")
_HIER = DiscoveryResult(
    enterprise=Enterprise(id="root", name="Root"),
    organizations=[_root, _org_a],
    errors=[],
)
app.cached_hierarchy = lambda base_url, enterprise_id, token: _HIER
app.cached_fleet = lambda *a, **k: FleetResult(
    df=_FRAME, errors=[], fetched_at="2026-09-21T12:00:00Z", reports={}
)
app.main()
"""
    at = _run(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
