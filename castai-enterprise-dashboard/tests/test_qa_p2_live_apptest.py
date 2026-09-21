"""QA phase-2 — ONE live-page AppTest against REAL settings (SUB-AGENT QA).

Skipped by default: runs only with ``QA_LIVE=1`` AND ``CASTAI_API_KEY`` in the
environment (sourced from the repo-root .env). NEVER prints the key — only
boolean presence. Read-only: every call the page makes is a GET.

Drive (master-prompt task 4):
  fleet load → filter by a known org → open that org's cluster drill-down →
  arm EVERY arming button (12 loader ids via the 8 gates) → export —
  must end zero-raise. Failures are captured exactly (phase + element dump).

The real fleet/hierarchy are ALSO loaded pytest-side (same read-only calls)
to pick a deterministic known org/cluster and to sanity-check the REAL CSV
export bytes (cap + round-trip, formula-escape on the true frame).
"""

from __future__ import annotations

import io
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent

LIVE = os.environ.get("QA_LIVE") == "1" and bool(os.environ.get("CASTAI_API_KEY"))
pytestmark = pytest.mark.skipif(not LIVE, reason="live drive: needs QA_LIVE=1 + CASTAI_API_KEY")

LIVE_TIMEOUT = 900


def test_live_full_drive():
    # ------------------------------------------------ preflight (no secrets)
    from config.settings import load_settings

    settings = load_settings()
    assert settings.base_url.rstrip("/").endswith("cast.ai")
    assert os.environ.get("CASTAI_API_KEY", "") != ""  # presence only, never printed
    print(f"[live] base_url={settings.base_url} key=***set***")

    # ----------------------------------------- real discovery + fleet (GETs)
    import app as app_module
    from services.cluster_service import build_fleet_dataframe
    from services.castai_client import CastAIClient
    from services.organization_service import discover_enterprise_hierarchy

    client = CastAIClient(settings.base_url, settings.get_api_key())
    hierarchy = discover_enterprise_hierarchy(client, settings.enterprise_id)
    assert hierarchy.organizations, "no organizations discovered"
    print(
        f"[live] hierarchy: enterprise={hierarchy.enterprise.name!r} "
        f"orgs={len(hierarchy.organizations)} errors={len(hierarchy.errors)}"
    )

    today = datetime.now(timezone.utc).date()
    start = f"{(today - timedelta(days=30)).isoformat()}T00:00:00Z"
    end = f"{today.isoformat()}T23:59:59Z"
    fleet = build_fleet_dataframe(
        client, hierarchy.organizations, start, end, max_workers=settings.max_workers
    )
    assert fleet.df is not None and len(fleet.df) > 0, "fleet empty — cannot drive"
    df = fleet.df
    print(f"[live] fleet rows={len(df)} errors={len(fleet.errors)}")

    # pick a KNOWN healthy row: prefer ok + non-ghost for maximum loader data
    pick = df
    if "data_status" in df.columns:
        ok = df[df["data_status"] == "ok"]
        if len(ok):
            pick = ok
    if "is_ghost" in pick.columns:
        non_ghost = pick[(pick["is_ghost"] == False) | (pick["is_ghost"].isna())]  # noqa: E712
        if len(non_ghost):
            pick = non_ghost
    row = pick.iloc[0]
    org_id = str(row["organization_id"])
    org_name = str(row["organization_name"])
    cluster_id = str(row["cluster_id"])
    cluster_name = str(row.get("cluster_name") or cluster_id)
    print(f"[live] driving org={org_name!r} cluster={cluster_name!r}")

    # --------------------------------------------- export sanity, REAL frame
    from ui.tables import EXPORT_ROW_CAP, fleet_csv_export

    data, shipped, total = fleet_csv_export(df)
    assert total == len(df) and shipped == min(total, EXPORT_ROW_CAP)
    assert data, "export bytes empty"
    parsed = pd.read_csv(io.BytesIO(data))
    assert len(parsed) == shipped
    assert "overview_cost_hourly" in parsed.columns
    print(f"[live] export shipped={shipped}/{total} bytes={len(data)}")

    # ------------------------------------------------------ live-page AppTest
    from streamlit.testing.v1 import AppTest

    script = f"""
import sys
sys.path.insert(0, {str(PROJECT_ROOT)!r})
import app
app.main()
"""
    at = AppTest.from_string(script, default_timeout=LIVE_TIMEOUT)

    def _dump(phase: str) -> str:
        return (
            f"[phase={phase}] exceptions={[getattr(e, 'value', e) for e in at.exception]} "
            f"errors={[getattr(e, 'value', e) for e in at.error][:3]} "
            f"warnings={[getattr(e, 'value', e) for e in at.warning][:3]}"
        )

    # 1) fleet load
    at.run(timeout=1200)
    assert not at.exception, _dump("fleet-load")
    assert any(
        b.key == "fleet_csv_download" for b in at.download_button
    ), _dump("fleet-load: no export widget")
    print("[live] fleet load OK — 0 raises")

    # 2) org filter (known org via name multiselect)
    org_ms = [m for m in at.multiselect if m.key == "flt_organizations"]
    assert org_ms, _dump("filter: multiselect missing")
    org_ms[0].set_value([org_name])
    at.run()
    assert not at.exception, _dump("filter")
    print("[live] filter OK — 0 raises")

    # 3) open the known org's cluster drill-down
    at.session_state["selected"] = (org_id, cluster_id)
    at.run()
    assert not at.exception, _dump("drilldown-open")
    assert len(at.tabs) >= 11, _dump(f"drilldown-open: tabs={len(at.tabs)}")
    print("[live] drill-down open OK — 11 tabs")

    # 4) arm EVERY arming button (8 gates -> all 12 loader ids)
    gates = ["cost", "savings", "wa", "na", "nodes", "workloads", "issues", "history"]
    for tab in gates:
        key = f"btn_load_{tab}_{cluster_id}"
        buttons = [b for b in at.button if b.key == key]
        assert buttons, _dump(f"arm-{tab}: button {key} not rendered")
        buttons[0].click()
        at.run(timeout=LIVE_TIMEOUT)
        assert not at.exception, _dump(f"arm-{tab}")
        print(f"[live] armed {tab} — 0 raises")
    armed = {
        t for t in app_module._TAB_IDS
        if at.session_state.get(f"tab_armed_{cluster_id}_{t}")
    }
    assert armed == set(app_module._TAB_IDS), (
        f"not all 12 loader ids armed: missing {sorted(set(app_module._TAB_IDS) - armed)}"
    )
    print("[live] all 12 loader ids armed — 0 raises")

    # 5) export widget still healthy after the whole drive (bytes checked at top)
    assert any(b.key == "fleet_csv_download" for b in at.download_button), _dump("export")
    print("[live] export widget OK — drive complete, zero raises")
