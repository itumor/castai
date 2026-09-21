"""QA phase-2 gap tests — enrichment scope hygiene + batch in-flight guard.

Master-prompt gaps confirmed against phase 2:

  * ``_sync_enrichment_scope`` purges ``_enr``/``_enr_stats``/``_spot_trend``
    when the refresh token bumps OR the date window changes (ux-v2 I5). Phase 2
    had NO test pinning this — a missed purge merges STALE enrichment rows
    into a refreshed fleet frame. Pinned here via AppTest.
  * >1-in-flight batch guard: YES, one exists — render-layer
    ``_enr_running`` flag disables all four batch buttons while a batch runs,
    and ``_run_enrichment_batch`` clears the flag in ``finally`` even on an
    unexpected raise. Both were UNTESTED. Pinned here (characterization:
    unexpected non-ValueError still propagates after the flag is cleared).
  * ``merge_enrichment`` robustness against malformed session-stores (non-dict
    values, non-2-tuple keys) — any session-state corruption must degrade
    silently, never raise.

No real network, no credentials. AppTest scripts patch app.build_client and
the two cached Tier-1 loaders exactly like tests/test_ui_v2.py. Scripts that
stub ``app.run_enrichment`` restore the original in try/finally — the module
object is shared across the whole pytest process.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

import app as app_module
from tests.test_ui_v2 import (
    _APPT_HEADER,
    _HIER_PATCH,
    _ROW_V2_SRC,
    APITEST_TIMEOUT,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# _HIER_BLOCK mirrors the _HIER_PATCH hierarchy patch minus its trailing
# app.main() call, so a test can wrap app.main() in try/finally and guarantee
# module-state restoration on the shared app module.
_HIER_BLOCK = """
from models import Enterprise, Organization
from services.organization_service import DiscoveryResult
from services.cluster_service import FleetResult

_root = Organization("root", "Root", None, "ORGANIZATION_TYPE_ENTERPRISE")
_org_a = Organization("org-a", "Org A", "root", "ORGANIZATION_TYPE_CHILD")
_org_b = Organization("org-b", "Org B", "root", "ORGANIZATION_TYPE_CHILD")
_HIER = DiscoveryResult(
    enterprise=Enterprise(id="root", name="Root"),
    organizations=[_root, _org_a, _org_b],
    errors=[],
)
app.cached_hierarchy = lambda base_url, enterprise_id, token: _HIER
app.cached_fleet = lambda *a, **k: FleetResult(
    df=_FRAME, errors=[], fetched_at="2026-09-21T12:00:00Z", reports={}
)
"""


def _run(script_body: str):
    from streamlit.testing.v1 import AppTest

    at = AppTest.from_string(_APPT_HEADER + script_body, default_timeout=APITEST_TIMEOUT)
    at.run()
    return at


# =================================================== scope-sync purge (I5)

def test_scope_sync_purges_on_refresh_token_bump():
    script = _APPT_HEADER + """
import streamlit as st
st.session_state["_enr"] = {"realized": {("org-a", "c1"): {"realized_savings": 1.0}}}
st.session_state["_enr_stats"] = {"realized": {"attempted": 1, "succeeded": 1, "failed": 0, "caps": {}, "messages": [], "fetched_at": 0.0}}
st.session_state["_spot_trend"] = {"org-a": ["x"]}
st.session_state["_enr_scope_sig"] = (0, "2026-09-01", "2026-09-07")
app._sync_enrichment_scope(1, "2026-09-01", "2026-09-07")
"""
    at = _run(script)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert "_enr" not in at.session_state
    assert "_enr_stats" not in at.session_state
    assert "_spot_trend" not in at.session_state
    assert tuple(at.session_state["_enr_scope_sig"]) == (1, "2026-09-01", "2026-09-07")


def test_scope_sync_purges_on_date_window_change():
    script = _APPT_HEADER + """
import streamlit as st
st.session_state["_enr"] = {"wa_coverage": {("org-a", "c1"): {"wa_coverage_pct": 0.5}}}
st.session_state["_enr_scope_sig"] = (2, "2026-09-01", "2026-09-07")
app._sync_enrichment_scope(2, "2026-09-08", "2026-09-14")  # SAME token, NEW window
"""
    at = _run(script)
    assert not at.exception
    assert "_enr" not in at.session_state
    assert tuple(at.session_state["_enr_scope_sig"]) == (2, "2026-09-08", "2026-09-14")


def test_scope_sync_same_signature_is_noop():
    """Matching signature must NOT purge — this is the steady-state rerun path."""
    script = _APPT_HEADER + """
import streamlit as st
st.session_state["_enr"] = {"realized": {("org-a", "c1"): {"realized_savings": 9.0}}}
st.session_state["_enr_scope_sig"] = (3, "2026-09-01", "2026-09-07")
app._sync_enrichment_scope(3, "2026-09-01", "2026-09-07")
"""
    at = _run(script)
    assert not at.exception
    assert at.session_state["_enr"]["realized"][("org-a", "c1")]["realized_savings"] == 9.0


# ============================================== >1-in-flight guard (session)

def test_all_batch_buttons_disabled_while_inflight():
    """ANSWER to the master-prompt question: YES, a 1-in-flight/session guard
    exists — ``_enr_running`` renders all four batch buttons disabled."""
    body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1"), _row("org-b", "db-1")])\n'
        + "import streamlit as st\n"
        + 'st.session_state["_enr_running"] = "health"\n'
        + _HIER_PATCH
    )
    at = _run(body)
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    keys = {b.key: b for b in at.button}
    for kind in ("realized", "na_policies", "wa_coverage", "health"):
        btn = keys.get(f"enr_btn_{kind}")
        assert btn is not None, f"enr_btn_{kind} not rendered"
        assert btn.disabled is True, f"enr_btn_{kind} not disabled during in-flight"


def test_batch_buttons_enabled_when_not_inflight():
    body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1"), _row("org-b", "db-1")])\n'
        + "import streamlit as st\n"
        + 'st.session_state.pop("_enr_running", None)\n'
        + _HIER_PATCH
    )
    at = _run(body)
    assert not at.exception
    keys = {b.key: b for b in at.button}
    for kind in ("realized", "na_policies", "wa_coverage", "health"):
        assert keys[f"enr_btn_{kind}"].disabled is False  # 2 clusters < all caps


def test_inflight_flag_cleared_and_error_shown_on_cap_refusal():
    """ValueError pre-flight refusal: no half-run, flag cleared, st.error shows,
    page rerenders without exception."""
    stub_test_body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1"), _row("org-b", "db-1")])\n'
        + """
def _refuse(*a, **k):
    raise ValueError("batch refuses: over the 100-cluster cap")
_ORIG_ENR = app.run_enrichment
app.run_enrichment = _refuse
try:
"""
        + _indent(_HIER_BLOCK + "app.main()")
        + """
finally:
    app.run_enrichment = _ORIG_ENR
"""
    )
    at = _run(stub_test_body)
    assert not at.exception
    at.button(key="enr_btn_realized").click().run()
    assert not at.exception, [getattr(e, "value", e) for e in at.exception]
    assert "_enr_running" not in at.session_state  # cleared
    assert not at.session_state["_enr"]             # no half-run payload
    assert any("over the 100-cluster cap" in e.value for e in at.error)


def test_inflight_flag_cleared_even_on_unexpected_raise():
    """Any non-ValueError raise mid-batch: the ``finally`` clears the flag (the
    guard can never wedge the session) — the error itself still surfaces
    (current contract: propagation to the Streamlit error surface)."""
    body = (
        _ROW_V2_SRC
        + '\n_FRAME = pd.DataFrame([_row("org-a", "web-1")])\n'
        + """
def _boom(*a, **k):
    raise RuntimeError("synthetic mid-batch failure")
_ORIG_ENR = app.run_enrichment
app.run_enrichment = _boom
try:
"""
        + _indent(_HIER_BLOCK + "app.main()")
        + """
finally:
    app.run_enrichment = _ORIG_ENR
"""
    )
    at = _run(body)
    assert not at.exception
    at.button(key="enr_btn_realized").click().run()
    assert at.exception  # propagated — current contract, pinned
    assert "synthetic mid-batch failure" in str(at.exception[0].value)
    assert "_enr_running" not in at.session_state  # guard self-heals
    assert not at.session_state["_enr"]            # no half-run payload


def _indent(block: str, pad: str = "    ") -> str:
    return "\n".join(pad + line if line.strip() else line for line in block.splitlines())


# ================================================= merge_enrichment hygiene

def test_merge_enrichment_skips_malformed_store_entries():
    df = pd.DataFrame(
        {
            "organization_id": ["org-a", "org-b"],
            "cluster_id": ["c1", "c2"],
        }
    )
    store = {
        "_enr": {
            "realized": {
                ("org-a", "c1"): {"realized_savings": 5.0},
                "not-a-tuple": {"realized_savings": 6.0},     # bare cluster-id form
                ("org-b", "c2"): "not-a-dict",                # value not a dict -> skipped
                ("org-x",): 7,                                 # 1-tuple -> skipped
                "org-b|c2": {"realized_savings": 7.5},        # pipe form
            },
            "wa_coverage": "not-a-dict",                      # whole kind malformed
        }
    }
    out = app_module.merge_enrichment(df, store)
    col = out["enr_realized_realized_savings"].tolist()
    assert col[0] == 5.0
    assert col[1] == 7.5          # pipe-form key resolved for (org-b, c2)
    assert "enr_wa_coverage_wa_coverage_pct" not in out.columns  # malformed kind skipped


def test_merge_enrichment_missing_identity_columns_returns_input():
    df = pd.DataFrame({"cluster_name": ["only-names"]})  # no org/cluster ids
    out = app_module.merge_enrichment(df, {"_enr": {"realized": {("o", "c"): {"x": 1}}}})
    assert list(out.columns) == ["cluster_name"]  # untouched, no raise


def test_merge_enrichment_does_not_mutate_input_df():
    df = pd.DataFrame({"organization_id": ["o"], "cluster_id": ["c"]})
    before = df.copy(deep=True)
    app_module.merge_enrichment(df, {"_enr": {"realized": {("o", "c"): {"realized_savings": 1.0}}}})
    pd.testing.assert_frame_equal(df, before)


def test_run_enrichment_module_attr_restored_after_stub_tests():
    """Self-check: the shared app module must not keep a QA stub."""
    assert callable(app_module.run_enrichment)
    assert "synthetic" not in getattr(app_module.run_enrichment, "__name__", "")
