"""QA phase-2 gap tests — CSV formula-injection sanitization (SUB-AGENT QA).

Master-prompt demand: the raw CSV export must not let hostile text values
(cluster / organization names) execute as spreadsheet formulas (OWASP
CWE-1236). Phase 2 shipped ``fleet_csv_export`` with raw ``to_csv`` output
and ZERO escaping — CONFIRMED GAP, fixed in ui/tables.py (sanitize_csv_frame)
and pinned here.

Law under test:
  * Any string cell whose FIRST character is one of ``= + - @ \\t \\r \\n``
    is escaped with a leading single quote in the exported CSV.
  * Numeric columns are never touched — NEGATIVE money (finops §2 rule 9)
    round-trips as a number, never a quoted string.
  * pd.NA / None / timestamps pass through unchanged.
  * The input frame is never mutated; escaping is capped-scope identical to
    rows_shipped (escape applies AFTER the 500-row cap, on the shipped rows).

No network, no credentials, no Streamlit server.
"""

from __future__ import annotations

import io

import pandas as pd

from ui.tables import EXPORT_ROW_CAP, fleet_csv_export, sanitize_csv_frame


def _parse(data: bytes) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(data), dtype=str)


# ---------------------------------------------------------------- escalation

def test_csv_export_escapes_formula_prefixed_names():
    df = pd.DataFrame(
        {
            "organization_name": [
                "=HYPERLINK(\"https://evil.example\",\"x\")",
                "+cmd|'/c calc'!A0",
                "-10+20+cmd|'/c calc'!A0",
                "@SUM(1+1)",
                "\t=cmd|'/c calc'!A0",
                "innocent org",
            ],
            "cluster_name": [
                "=2+5",
                "web-1",
                "normal",
                "1,000 nodes",  # comma, not a formula — quoting is pandas' job
                "plain",
                "ends-with-minus-",
            ],
            "cluster_id": [f"c{i}" for i in range(6)],
            "organization_id": [f"o{i}" for i in range(6)],
        }
    )
    data, shown, total = fleet_csv_export(df)
    assert (shown, total) == (6, 6)
    parsed = _parse(data)
    assert parsed["organization_name"].tolist() == [
        "'=HYPERLINK(\"https://evil.example\",\"x\")",
        "'+cmd|'/c calc'!A0",
        "'-10+20+cmd|'/c calc'!A0",
        "'@SUM(1+1)",
        "'\t=cmd|'/c calc'!A0",
        "innocent org",
    ]
    assert parsed["cluster_name"].tolist() == [
        "'=2+5",
        "web-1",
        "normal",
        "1,000 nodes",
        "plain",
        "ends-with-minus-",  # leading char is benign — NOT escaped
    ]


def test_csv_export_raw_bytes_contain_no_unescaped_formula_line_start():
    df = pd.DataFrame(
        {
            "cluster_name": ["=IMPORTXML(\"http://x\", \"//a\")", "ok"],
            "organization_name": ["=1+1", "ok-org"],
            "cluster_id": ["c1", "c2"],
        }
    )
    data, _, _ = fleet_csv_export(df)
    text = data.decode("utf-8")
    # No data line may BEGIN a field with a formula char unescaped (the CSV
    # layer quotes fields containing separators; a quote-escape prefix still
    # prevents spreadsheet interpretation — the first character is a quote
    # or an apostrophe, never a bare formula char).
    for line in text.splitlines()[1:]:  # skip header
        first_cell = line.split(",", 1)[0].lstrip('"')
        assert not first_cell.startswith(("=", "+", "-", "@", "\t")), line


def test_csv_export_carriage_return_prefix_escaped():
    df = pd.DataFrame({"cluster_name": ["\r=1+1"], "cluster_id": ["c1"]})
    data, _, _ = fleet_csv_export(df)
    parsed = _parse(data)
    assert parsed["cluster_name"].iloc[0].startswith("'")


# --------------------------------------------------------- numeric integrity

def test_csv_export_numeric_negatives_stay_numeric_unescaped():
    """Negative money (finops §2 rule 9) ships as a NUMBER — the '-x' form must
    NOT be quote-escaped (it is a value, not text)."""
    df = pd.DataFrame(
        {
            "cluster_name": ["good", "headroom-cluster"],
            "cluster_id": ["c1", "c2"],
            "potential_savings": [12.5, -9.0],
            "overview_cost_hourly": [1.25, 2.0],
        }
    )
    data, _, _ = fleet_csv_export(df)
    parsed = pd.read_csv(io.BytesIO(data))  # typed parse, not dtype=str
    assert parsed["potential_savings"].tolist() == [12.5, -9.0]
    assert parsed["overview_cost_hourly"].tolist() == [1.25, 2.0]
    assert float(parsed["potential_savings"].iloc[1]) == -9.0  # real number


def test_csv_export_na_none_timestamps_pass_through():
    ts = pd.Timestamp("2026-09-21T12:00:00Z")
    df = pd.DataFrame(
        {
            "cluster_name": [None, pd.NA, "plain"],
            "cluster_id": ["c1", "c2", "c3"],
            "last_updated": [ts, ts, ts],
            "nodes_total": [1, None, 3],
        }
    )
    data, _, _ = fleet_csv_export(df)
    parsed = _parse(data)
    assert parsed["cluster_name"].isna().tolist()[:2] == [True, True]
    assert parsed["cluster_name"].iloc[2] == "plain"
    # no crash, no mutation of NA; timestamp column stayed present
    assert "last_updated" in parsed.columns


def test_csv_export_input_frame_never_mutated():
    original_names = ["=2+5", "plain"]
    df = pd.DataFrame(
        {"cluster_name": list(original_names), "cluster_id": ["c1", "c2"]}
    )
    fleet_csv_export(df)
    assert df["cluster_name"].tolist() == original_names  # untouched


def test_csv_export_sanitization_applies_within_cap():
    """Escaping operates on the SHIPPED rows (post-cap); rows beyond the cap
    are dropped before escaping — no formula leaks via truncation boundary."""
    rows = EXPORT_ROW_CAP + 50
    names = ["=1+" + str(i) for i in range(rows)]
    df = pd.DataFrame({"cluster_name": names, "cluster_id": [f"c{i}" for i in range(rows)]})
    data, shown, total = fleet_csv_export(df)
    assert (shown, total) == (EXPORT_ROW_CAP, rows)
    parsed = _parse(data)
    assert len(parsed) == EXPORT_ROW_CAP
    assert parsed["cluster_name"].str.startswith("'=").all()


# ------------------------------------------------------------- helper shape

def test_sanitize_csv_frame_edge_inputs():
    assert sanitize_csv_frame(None) is None
    empty = pd.DataFrame({"cluster_name": []})
    out = sanitize_csv_frame(empty)
    assert len(out) == 0 and list(out.columns) == ["cluster_name"]
    # integer/bool-only frames return unchanged content
    plain = pd.DataFrame({"nodes_total": [1, 2], "ok": [True, False]})
    out2 = sanitize_csv_frame(plain)
    assert out2["nodes_total"].tolist() == [1, 2]
    assert out2["ok"].tolist() == [True, False]


def test_sanitize_csv_frame_escape_surface_is_first_character_only():
    df = pd.DataFrame(
        {
            "cluster_name": [
                "a=b",       # '=' NOT at position 0 — safe
                "x+y",       # safe
                "safe-name", # '-' not leading — safe
                "  =1+1",    # leading SPACE then '=': pandas/Excel do not treat
                             # leading-space cells as formulas — ships as-is
            ],
        }
    )
    out = sanitize_csv_frame(df)
    assert out["cluster_name"].tolist() == ["a=b", "x+y", "safe-name", "  =1+1"]
