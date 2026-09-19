#!/usr/bin/env python3
"""
Scan every CAST AI organization and cluster accessible with the API key and
identify clusters that currently have, or previously had, Karpenter installed.

The script combines four independent signals:

  1. Cluster settings  -> current Karpenter installation flag and version
                         (GET /v1/kubernetes/clusters/{id}/settings).
  2. Karpenter migration-intent endpoint -> residual Karpenter CRDs that may
                         survive a controller uninstall
                         (GET /v1/kubernetes/clusters/{id}/karpenter/migrate).
  3. Cost-report summary -> historical nodes managed by KARPENTER
                         (GET /v1/cost-reports/clusters/{id}/summary).
  4. v2 audit events    -> strongest historical signal; paginated, base64
                         body decoded, matched to clusters
                         (GET /v2/audit/events).

CLI flags:
  --from-date YYYY-MM-DD          Start of audit window (UTC).
  --to-date YYYY-MM-DD            End of audit window (UTC, inclusive).
  --target-date YYYY-MM-DD        Convenience: derives --from-date/--to-date
                                  as target +/- --target-window-days in UTC.
                                  Overrides --from-date/--to-date when given.
  --target-window-days N          Half-width of the --target-date window
                                  (default 7).
  --search TERM [TERM ...]        Free-text search terms passed to the audit
                                  events endpoint. Defaults to the canonical
                                  Karpenter-related term list.
  --actor EMAIL                   Substring filter for the actor email on
                                  matched audit events (applied client-side).
  --dry-run                       Hit the API only long enough to prove that
                                  credentials, connectivity and enum work,
                                  then exit. No Excel is written.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_API_BASE = "https://api.eu.cast.ai"
DEFAULT_ENV_FILE = SCRIPT_DIR / ".env"
OUTPUT_XLSX = SCRIPT_DIR / "castai_karpenter_history.xlsx"

REQUEST_TIMEOUT_S = 30
MAX_RETRIES = 3
RETRY_BACKOFF_S = (0.5, 1.0, 2.0)
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
RATE_LIMIT_SLEEP_S = 0.2
AUDIT_PAGE_LIMIT = 100
DEFAULT_AUDIT_WINDOW_DAYS = 90
COST_REPORT_WINDOW_DAYS = 30
DEFAULT_TARGET_WINDOW_DAYS = 7

DEFAULT_SEARCH_TERMS = [
    "karpenter",
    "kent",
    "migrate",
    "migration",
    "node template",
    "node configuration",
    "node pool",
    "uninstall",
    "remove",
]

KARPENTER_MANAGED_BY = "KARPENTER"

# ---------------------------------------------------------------------------
# Credential loading
# ---------------------------------------------------------------------------


def load_api_key(env_file: Optional[Path] = None) -> str:
    """Load CASTAI_API_KEY from an env file or process environment.

    Resolution order:
      1. CASTAI_ENV_FILE env var (overrides everything else)
      2. `env_file` argument
      3. .env in the script directory
      4. os.environ["CASTAI_API_KEY"]
    """
    candidates: List[Path] = []
    override = os.environ.get("CASTAI_ENV_FILE")
    if override:
        candidates.append(Path(override))
    if env_file is not None:
        candidates.append(env_file)
    candidates.append(DEFAULT_ENV_FILE)

    for path in candidates:
        if path and path.is_file():
            value = _read_env_key(path, "CASTAI_API_KEY")
            if value:
                return value

    fallback = os.environ.get("CASTAI_API_KEY")
    if fallback:
        return fallback.strip()

    raise RuntimeError(
        "CASTAI_API_KEY not found. Set it in .env next to the script, "
        "in os.environ, or via CASTAI_ENV_FILE."
    )


def _read_env_key(path: Path, key: str) -> Optional[str]:
    """Read a single KEY=VALUE line from a .env file (ignores comments/blanks)."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.match(rf"^{re.escape(key)}\s*=\s*(.*)$", line)
                if not m:
                    continue
                value = m.group(1).strip()
                if (value.startswith('"') and value.endswith('"')) or (
                    value.startswith("'") and value.endswith("'")
                ):
                    value = value[1:-1]
                return value or None
    except OSError:
        return None
    return None


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------


@dataclass
class ApiError:
    scope: str  # 'org' or 'cluster:<id>'
    org_id: Optional[str]
    org_name: Optional[str]
    cluster_id: Optional[str]
    cluster_name: Optional[str]
    endpoint: str
    message: str


class CastAIClient:
    """Thin wrapper around requests.Session with retries and rate limiting."""

    def __init__(
        self,
        api_key: str,
        api_base: str = DEFAULT_API_BASE,
        errors: Optional[List[ApiError]] = None,
    ) -> None:
        self.api_base = api_base.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "X-API-Key": api_key,
                "Accept": "application/json",
                "User-Agent": "castai-karpenter-history/1.0",
            }
        )
        self.errors: List[ApiError] = errors if errors is not None else []
        self.last_org_call_at: Optional[float] = None

    # -- low-level HTTP ----------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        org_id: Optional[str] = None,
        params: Optional[Dict[str, Any]] = None,
        scope: str = "global",
        org_name: Optional[str] = None,
        cluster_id: Optional[str] = None,
        cluster_name: Optional[str] = None,
    ) -> Optional[Any]:
        url = f"{self.api_base}{path}"
        headers: Dict[str, str] = {}
        if org_id:
            headers["X-CastAI-Organization-Id"] = org_id

        last_exc: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = self.session.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    timeout=REQUEST_TIMEOUT_S,
                )
            except requests.exceptions.RequestException as exc:
                last_exc = exc
                sleep_for = RETRY_BACKOFF_S[min(attempt, len(RETRY_BACKOFF_S) - 1)]
                time.sleep(sleep_for)
                continue

            status = resp.status_code
            if status in RETRYABLE_STATUSES and attempt < MAX_RETRIES - 1:
                sleep_for = RETRY_BACKOFF_S[min(attempt, len(RETRY_BACKOFF_S) - 1)]
                time.sleep(sleep_for)
                continue

            if status in (403, 404):
                # Continue-on-error: log and skip.
                self._record_error(
                    scope=scope,
                    org_id=org_id,
                    org_name=org_name,
                    cluster_id=cluster_id,
                    cluster_name=cluster_name,
                    endpoint=path,
                    message=f"HTTP {status} {resp.reason}".strip(),
                )
                return None

            if status >= 400:
                # Non-retryable client error: surface message and move on.
                snippet = (resp.text or "")[:200].replace("\n", " ")
                self._record_error(
                    scope=scope,
                    org_id=org_id,
                    org_name=org_name,
                    cluster_id=cluster_id,
                    cluster_name=cluster_name,
                    endpoint=path,
                    message=f"HTTP {status}: {snippet}",
                )
                return None

            if not resp.content:
                return {}
            try:
                return resp.json()
            except ValueError as exc:
                self._record_error(
                    scope=scope,
                    org_id=org_id,
                    org_name=org_name,
                    cluster_id=cluster_id,
                    cluster_name=cluster_name,
                    endpoint=path,
                    message=f"JSON decode failed: {exc}",
                )
                return None

        # Exhausted retries.
        msg = (
            f"Network error after {MAX_RETRIES} attempts"
            + (f": {last_exc}" if last_exc else "")
        )
        self._record_error(
            scope=scope,
            org_id=org_id,
            org_name=org_name,
            cluster_id=cluster_id,
            cluster_name=cluster_name,
            endpoint=path,
            message=msg,
        )
        return None

    def _record_error(
        self,
        *,
        scope: str,
        org_id: Optional[str],
        org_name: Optional[str],
        cluster_id: Optional[str],
        cluster_name: Optional[str],
        endpoint: str,
        message: str,
    ) -> None:
        self.errors.append(
            ApiError(
                scope=scope,
                org_id=org_id,
                org_name=org_name,
                cluster_id=cluster_id,
                cluster_name=cluster_name,
                endpoint=endpoint,
                message=message,
            )
        )

    def _post_org_call(self, had_org_id: bool) -> None:
        if not had_org_id:
            return
        now = time.monotonic()
        if self.last_org_call_at is not None:
            elapsed = now - self.last_org_call_at
            if elapsed < RATE_LIMIT_SLEEP_S:
                time.sleep(RATE_LIMIT_SLEEP_S - elapsed)
        self.last_org_call_at = time.monotonic()

    # -- public helpers ----------------------------------------------------

    def get(self, path: str, **kwargs: Any) -> Optional[Any]:
        org_id = kwargs.pop("org_id", None)
        params = kwargs.pop("params", None)
        return self._request(
            "GET", path, org_id=org_id, params=params, scope=kwargs.pop("scope", "global"), **kwargs
        )

    def list_organizations(self) -> List[Dict[str, Any]]:
        data = self.get("/v1/organizations", scope="global")
        if not data:
            return []
        return data.get("organizations") or []

    def list_clusters(self, org_id: str, org_name: str) -> List[Dict[str, Any]]:
        data = self.get(
            "/v1/kubernetes/external-clusters",
            org_id=org_id,
            org_name=org_name,
            scope="org",
        )
        self._post_org_call(True)
        if not data:
            return []
        return data.get("items") or []

    def get_cluster_settings(
        self, cluster_id: str, org_id: str, org_name: str, cluster_name: str
    ) -> Optional[Dict[str, Any]]:
        data = self.get(
            f"/v1/kubernetes/clusters/{cluster_id}/settings",
            org_id=org_id,
            org_name=org_name,
            cluster_id=cluster_id,
            cluster_name=cluster_name,
            scope="cluster",
        )
        self._post_org_call(True)
        return data

    def get_karpenter_migrate(
        self, cluster_id: str, org_id: str, org_name: str, cluster_name: str
    ) -> Optional[Dict[str, Any]]:
        data = self.get(
            f"/v1/kubernetes/clusters/{cluster_id}/karpenter/migrate",
            org_id=org_id,
            org_name=org_name,
            cluster_id=cluster_id,
            cluster_name=cluster_name,
            scope="cluster",
        )
        self._post_org_call(True)
        return data

    def get_cost_report_summary(
        self,
        cluster_id: str,
        org_id: str,
        org_name: str,
        cluster_name: str,
        start: datetime,
        end: datetime,
    ) -> Optional[Dict[str, Any]]:
        params = {
            "startTime": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "endTime": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        data = self.get(
            f"/v1/cost-reports/clusters/{cluster_id}/summary",
            org_id=org_id,
            org_name=org_name,
            cluster_id=cluster_id,
            cluster_name=cluster_name,
            scope="cluster",
            params=params,
        )
        self._post_org_call(True)
        return data

    def fetch_audit_events(
        self,
        from_dt: datetime,
        to_dt: datetime,
        search_terms: Iterable[str],
    ) -> List[Dict[str, Any]]:
        """Fetch all matching v2 audit events, paginating with page.cursor."""
        events: List[Dict[str, Any]] = []
        cursor: Optional[str] = None
        # API expects RFC 3339 UTC.
        params_base: Dict[str, Any] = {
            "fromDate": from_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "toDate": to_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "filter.search": " ".join(search_terms),
            "page.limit": AUDIT_PAGE_LIMIT,
        }

        while True:
            params = dict(params_base)
            if cursor:
                params["page.cursor"] = cursor
            data = self.get("/v2/audit/events", scope="global", params=params)
            self._post_org_call(False)
            if data is None:
                break
            batch = data.get("events") or []
            events.extend(batch)
            cursor = data.get("nextCursor")
            if not cursor:
                break

        return events


# ---------------------------------------------------------------------------
# Audit helpers
# ---------------------------------------------------------------------------


def decode_body(body: Optional[str]) -> Optional[str]:
    if not body:
        return None
    try:
        raw = base64.b64decode(body, validate=False)
        text = raw.decode("utf-8", errors="replace")
        # Try to pretty-print JSON if possible.
        try:
            return json.dumps(json.loads(text), indent=2)
        except ValueError:
            return text
    except Exception:  # noqa: BLE001 - base64 decode can raise anything
        return None


def audit_event_matches_search(event: Dict[str, Any], search_terms: List[str]) -> Optional[str]:
    """Return the first matching search term, or None. Inspects description and decoded body."""
    fields = [
        (event.get("description") or ""),
        decode_body(event.get("body")) or "",
        (event.get("eventDomain") or ""),
        (event.get("eventResource") or ""),
        (event.get("eventAction") or ""),
    ]
    haystack = "\n".join(fields).lower()
    for term in search_terms:
        if term.lower() in haystack:
            return term
    return None


def match_event_to_cluster(
    event: Dict[str, Any],
    cluster_by_id: Dict[str, Dict[str, Any]],
) -> Optional[Tuple[Dict[str, Any], str]]:
    """Return (cluster_row, match_source) or None.

    Match order:
      1. event['clusterId'] present in the cluster map
      2. event['resource']['id'] when event['resource']['type'] == 'cluster'
    """
    direct = event.get("clusterId")
    if direct and direct in cluster_by_id:
        return cluster_by_id[direct], "clusterId"

    resource = event.get("resource") or {}
    if resource.get("type") == "cluster":
        rid = resource.get("id")
        if rid and rid in cluster_by_id:
            return cluster_by_id[rid], "resource.id"

    return None


# ---------------------------------------------------------------------------
# Domain logic
# ---------------------------------------------------------------------------


@dataclass
class ClusterRecord:
    org_id: str
    org_name: str
    cluster_id: str
    cluster_name: str
    provider: Optional[str]
    region: Optional[str]
    status: Optional[str]
    agent_status: Optional[str]

    # Current state
    current_karpenter_installed: Optional[bool] = None
    current_karpenter_version: Optional[str] = None
    settings_checked: bool = False
    settings_ok: bool = False

    # Migration intent
    migration_intent_found: bool = False
    migration_nodepool_count: int = 0
    migration_ec2nodeclass_count: int = 0
    migration_provisioner_count: int = 0
    migration_awsnodetemplate_count: int = 0
    migration_checked: bool = False
    migration_ok: bool = False

    # Cost report
    cost_report_karpenter_nodes_seen: int = 0
    cost_report_checked: bool = False
    cost_report_ok: bool = False

    # Audit
    audit_event_count: int = 0
    audit_first_seen: Optional[str] = None
    audit_last_seen: Optional[str] = None
    audit_actor_emails: List[str] = field(default_factory=list)
    audit_event_domains: List[str] = field(default_factory=list)
    audit_event_sample: Optional[str] = None

    # Reasoning
    signals_checked: List[str] = field(default_factory=list)
    detection_notes: str = ""


def derive_detection(rec: ClusterRecord) -> str:
    if rec.current_karpenter_installed:
        return "currently installed"
    if rec.audit_event_count > 0:
        return "previously installed (audit evidence)"
    if rec.cost_report_karpenter_nodes_seen > 0:
        return "previously installed (cost-report evidence)"
    if rec.migration_intent_found:
        return "previously installed (migration CRD evidence)"
    if rec.settings_ok or rec.migration_ok or rec.cost_report_ok:
        return "no evidence"
    return "error"


def parse_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)


def resolve_window(
    args: argparse.Namespace,
) -> Tuple[datetime, datetime, List[str], Optional[str]]:
    """Return (from_dt, to_dt, search_terms, actor_substring)."""
    search_terms = list(args.search) if args.search else list(DEFAULT_SEARCH_TERMS)

    if args.target_date:
        target = parse_date(args.target_date)
        window = max(args.target_window_days, 0)
        from_dt = target - timedelta(days=window)
        to_dt = target + timedelta(days=window) + timedelta(days=1) - timedelta(microseconds=1)
    else:
        if args.from_date:
            from_dt = parse_date(args.from_date)
        else:
            from_dt = datetime.now(timezone.utc) - timedelta(days=DEFAULT_AUDIT_WINDOW_DAYS)
        if args.to_date:
            to_dt = parse_date(args.to_date)
        else:
            to_dt = datetime.now(timezone.utc)
        # Make the upper bound inclusive of the day.
        to_dt = to_dt + timedelta(days=1) - timedelta(microseconds=1)

    return from_dt, to_dt, search_terms, (args.actor.lower() if args.actor else None)


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def enumerate_orgs_and_clusters(
    client: CastAIClient,
) -> Tuple[List[Dict[str, Any]], List[ClusterRecord]]:
    print(f"Using API base: {client.api_base}")
    print("Listing organizations...")
    orgs = client.list_organizations()
    print(f"Found {len(orgs)} organizations")

    records: List[ClusterRecord] = []
    for i, org in enumerate(orgs, 1):
        org_id = org.get("id")
        org_name = org.get("name", "")
        if not org_id:
            print(f"[{i}/{len(orgs)}] {org_name} (no id) - skipped")
            continue
        print(f"[{i}/{len(orgs)}] {org_name} ({org_id}) ... ", end="", flush=True)
        clusters = client.list_clusters(org_id, org_name)
        print(f"{len(clusters)} clusters")
        for c in clusters:
            cid = c.get("id")
            if not cid:
                continue
            region = c.get("region") or {}
            region_name = region.get("name") if isinstance(region, dict) else region
            records.append(
                ClusterRecord(
                    org_id=org_id,
                    org_name=org_name,
                    cluster_id=cid,
                    cluster_name=c.get("name") or "",
                    provider=c.get("providerType") or c.get("provider"),
                    region=region_name,
                    status=c.get("status"),
                    agent_status=c.get("agentStatus") or c.get("agent_status"),
                )
            )

    return orgs, records


def collect_current_state(
    client: CastAIClient,
    records: List[ClusterRecord],
) -> None:
    total = len(records)
    if not total:
        return
    print(f"Fetching current Karpenter state for {total} clusters...")
    for i, rec in enumerate(records, 1):
        settings = client.get_cluster_settings(
            rec.cluster_id, rec.org_id, rec.org_name, rec.cluster_name
        )
        rec.signals_checked.append("settings")
        rec.settings_checked = True
        if settings:
            rec.settings_ok = True
            rec.current_karpenter_installed = bool(settings.get("karpenterInstalled"))
            version = settings.get("karpenterVersion")
            rec.current_karpenter_version = version if version else None

        migrate = client.get_karpenter_migrate(
            rec.cluster_id, rec.org_id, rec.org_name, rec.cluster_name
        )
        rec.signals_checked.append("karpenter.migrate")
        rec.migration_checked = True
        if migrate:
            rec.migration_ok = True
            nodepools = migrate.get("nodePools") or []
            ec2 = migrate.get("ec2NodeClasses") or []
            provisioners = migrate.get("provisioners") or []
            templates = migrate.get("awsNodeTemplates") or []
            rec.migration_nodepool_count = len(nodepools)
            rec.migration_ec2nodeclass_count = len(ec2)
            rec.migration_provisioner_count = len(provisioners)
            rec.migration_awsnodetemplate_count = len(templates)
            rec.migration_intent_found = any(
                len(x) > 0 for x in (nodepools, ec2, provisioners, templates)
            )

        end = datetime.now(timezone.utc)
        start = end - timedelta(days=COST_REPORT_WINDOW_DAYS)
        cost = client.get_cost_report_summary(
            rec.cluster_id, rec.org_id, rec.org_name, rec.cluster_name, start, end
        )
        rec.signals_checked.append("cost-reports.summary")
        rec.cost_report_checked = True
        if cost:
            rec.cost_report_ok = True
            for node_summary in cost.get("nodesSummaries") or []:
                if (node_summary.get("managedBy") or "").upper() == KARPENTER_MANAGED_BY:
                    rec.cost_report_karpenter_nodes_seen += 1

        if i % 25 == 0 or i == total:
            print(f"  current-state progress: {i}/{total}")


def collect_audit_evidence(
    client: CastAIClient,
    records: List[ClusterRecord],
    from_dt: datetime,
    to_dt: datetime,
    search_terms: List[str],
    actor_substring: Optional[str],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    print(
        f"Fetching v2 audit events from {from_dt.isoformat()} to {to_dt.isoformat()} "
        f"with {len(search_terms)} search term(s)..."
    )
    events = client.fetch_audit_events(from_dt, to_dt, search_terms)
    print(f"Fetched {len(events)} audit event(s) (pre-filter)")

    cluster_by_id = {r.cluster_id: r for r in records}
    matched_rows: List[Dict[str, Any]] = []
    unmatched_rows: List[Dict[str, Any]] = []

    for ev in events:
        match = audit_event_matches_search(ev, search_terms)
        if not match:
            continue
        actor = (ev.get("actor") or {}).get("email") or ""
        if actor_substring and actor_substring not in actor.lower():
            continue

        target = match_event_to_cluster(ev, cluster_by_id)
        decoded = decode_body(ev.get("body"))
        row = {
            "event_id": ev.get("eventId"),
            "occurred_at": ev.get("occurredAt"),
            "ingested_at": ev.get("ingestedAt"),
            "actor_email": actor,
            "domain": ev.get("eventDomain"),
            "resource": ev.get("eventResource"),
            "action": ev.get("eventAction"),
            "description": ev.get("description"),
            "decoded_body": decoded,
            "search_term_matched": match,
            "resource_id": (ev.get("resource") or {}).get("id"),
            "resource_type": (ev.get("resource") or {}).get("type"),
            "raw_event": ev,
        }

        if target is None:
            unmatched_rows.append(row)
            continue

        cluster, source = target
        row["cluster_id"] = cluster.cluster_id
        row["cluster_name"] = cluster.cluster_name
        row["match_source"] = source

        cluster.audit_event_count += 1
        occurred = ev.get("occurredAt")
        if occurred:
            if not cluster.audit_first_seen or occurred < cluster.audit_first_seen:
                cluster.audit_first_seen = occurred
            if not cluster.audit_last_seen or occurred > cluster.audit_last_seen:
                cluster.audit_last_seen = occurred
        if actor and actor not in cluster.audit_actor_emails:
            cluster.audit_actor_emails.append(actor)
        domain = ev.get("eventDomain")
        if domain and domain not in cluster.audit_event_domains:
            cluster.audit_event_domains.append(domain)
        if cluster.audit_event_sample is None:
            cluster.audit_event_sample = (
                f"{ev.get('eventDomain','?')} / {ev.get('eventResource','?')} / "
                f"{ev.get('eventAction','?')} @ {ev.get('occurredAt','?')}"
            )
        cluster.signals_checked.append("v2.audit.events")

        matched_rows.append(row)

    return matched_rows, unmatched_rows


# ---------------------------------------------------------------------------
# Excel writing
# ---------------------------------------------------------------------------


def build_detection_notes(
    from_dt: datetime,
    to_dt: datetime,
    search_terms: List[str],
    actor_substring: Optional[str],
) -> str:
    """Format the analyst-facing detection note describing what was queried."""
    from_date = from_dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
    to_date = to_dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
    actor = actor_substring if actor_substring else "none"
    endpoints = "settings, karpenter.migrate, cost-reports.summary, v2.audit.events"
    return (
        f"Audit window: {from_date}Z to {to_date}Z; "
        f"search terms: {search_terms!r}; "
        f"actor filter: {actor}; "
        f"endpoints queried: {endpoints}"
    )


def build_history_dataframe(records: List[ClusterRecord]) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for rec in records:
        rows.append(
            {
                "cluster_id": rec.cluster_id,
                "cluster_name": rec.cluster_name,
                "org_id": rec.org_id,
                "org_name": rec.org_name,
                "provider": rec.provider,
                "region": rec.region,
                "status": rec.status,
                "agent_status": rec.agent_status,
                "current_karpenter_installed": rec.current_karpenter_installed,
                "current_karpenter_version": rec.current_karpenter_version,
                "migration_intent_found": rec.migration_intent_found,
                "migration_nodepool_count": rec.migration_nodepool_count,
                "migration_ec2nodeclass_count": rec.migration_ec2nodeclass_count,
                "migration_provisioner_count": rec.migration_provisioner_count,
                "migration_awsnodetemplate_count": rec.migration_awsnodetemplate_count,
                "cost_report_karpenter_nodes_seen": rec.cost_report_karpenter_nodes_seen,
                "audit_event_count": rec.audit_event_count,
                "audit_first_seen": rec.audit_first_seen,
                "audit_last_seen": rec.audit_last_seen,
                "audit_actor_emails": ", ".join(rec.audit_actor_emails),
                "audit_event_domains": ", ".join(rec.audit_event_domains),
                "audit_event_sample": rec.audit_event_sample,
                "detection_summary": derive_detection(rec),
                "signals_checked": ", ".join(sorted(set(rec.signals_checked))),
                "detection_notes": rec.detection_notes,
            }
        )
    return pd.DataFrame(rows)


def build_audit_dataframe(rows: List[Dict[str, Any]]) -> pd.DataFrame:
    safe_rows: List[Dict[str, Any]] = []
    for r in rows:
        safe_rows.append(
            {
                "cluster_id": r.get("cluster_id"),
                "cluster_name": r.get("cluster_name"),
                "match_source": r.get("match_source"),
                "event_id": r.get("event_id"),
                "occurred_at": r.get("occurred_at"),
                "ingested_at": r.get("ingested_at"),
                "actor_email": r.get("actor_email"),
                "domain": r.get("domain"),
                "resource": r.get("resource"),
                "action": r.get("action"),
                "description": r.get("description"),
                "decoded_body": r.get("decoded_body"),
                "search_term_matched": r.get("search_term_matched"),
                "resource_id": r.get("resource_id"),
                "resource_type": r.get("resource_type"),
            }
        )
    return pd.DataFrame(safe_rows)


def build_errors_dataframe(errors: List[ApiError]) -> pd.DataFrame:
    if not errors:
        return pd.DataFrame(
            columns=[
                "scope",
                "org_id",
                "org_name",
                "cluster_id",
                "cluster_name",
                "endpoint",
                "message",
            ]
        )
    return pd.DataFrame(
        [
            {
                "scope": e.scope,
                "org_id": e.org_id,
                "org_name": e.org_name,
                "cluster_id": e.cluster_id,
                "cluster_name": e.cluster_name,
                "endpoint": e.endpoint,
                "message": e.message,
            }
            for e in errors
        ]
    )


def write_workbook(
    output_path: Path,
    history_df: pd.DataFrame,
    audit_df: pd.DataFrame,
    unmatched_df: pd.DataFrame,
    errors_df: pd.DataFrame,
) -> None:
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        history_df.to_excel(writer, sheet_name="Karpenter History", index=False)
        audit_df.to_excel(writer, sheet_name="Audit Events", index=False)
        unmatched_df.to_excel(writer, sheet_name="Unmatched Audit Events", index=False)
        errors_df.to_excel(writer, sheet_name="Errors", index=False)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[1] if __doc__ else "Karpenter history")
    p.add_argument("--from-date", help="Start of audit window (YYYY-MM-DD, UTC).")
    p.add_argument("--to-date", help="End of audit window (YYYY-MM-DD, UTC, inclusive).")
    p.add_argument(
        "--target-date",
        help="Center date for the audit window; expands with --target-window-days.",
    )
    p.add_argument(
        "--target-window-days",
        type=int,
        default=DEFAULT_TARGET_WINDOW_DAYS,
        help="Half-width in days of the --target-date window (default 7).",
    )
    p.add_argument(
        "--search",
        nargs="+",
        help="Search terms passed to the audit-events endpoint. Defaults to the canonical list.",
    )
    p.add_argument(
        "--actor",
        help="Substring filter for actor email on matched audit events (case-insensitive).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="List orgs + one cluster's settings to prove connectivity, then exit.",
    )
    p.add_argument(
        "--api-base",
        default=os.environ.get("CASTAI_API_BASE", DEFAULT_API_BASE),
        help="CAST AI API base URL (overrides CASTAI_API_BASE env var).",
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    api_key = load_api_key()
    client = CastAIClient(api_key=api_key, api_base=args.api_base)

    orgs, records = enumerate_orgs_and_clusters(client)

    if args.dry_run:
        if records:
            first = records[0]
            settings = client.get_cluster_settings(
                first.cluster_id, first.org_id, first.org_name, first.cluster_name
            )
            print(
                f"Dry-run OK. First cluster: {first.cluster_name} ({first.cluster_id}) "
                f"karpenterInstalled={bool((settings or {}).get('karpenterInstalled'))}"
            )
        else:
            print("Dry-run OK. No clusters accessible with this API key.")
        print(f"Errors recorded during dry-run: {len(client.errors)}")
        return 0

    from_dt, to_dt, search_terms, actor_substring = resolve_window(args)

    collect_current_state(client, records)
    matched, unmatched = collect_audit_evidence(
        client, records, from_dt, to_dt, search_terms, actor_substring
    )

    detection_notes = build_detection_notes(
        from_dt, to_dt, search_terms, actor_substring
    )
    for rec in records:
        rec.detection_notes = detection_notes

    history_df = build_history_dataframe(records)
    audit_df = build_audit_dataframe(matched)
    unmatched_df = build_audit_dataframe(unmatched)
    errors_df = build_errors_dataframe(client.errors)

    write_workbook(OUTPUT_XLSX, history_df, audit_df, unmatched_df, errors_df)

    print()
    print(f"Wrote workbook: {OUTPUT_XLSX}")
    if not history_df.empty and "detection_summary" in history_df.columns:
        print("Detection summary counts:")
        print(history_df["detection_summary"].value_counts(dropna=False).to_string())
    print(f"Audit Events sheet rows: {len(audit_df)}")
    print(f"Unmatched Audit Events sheet rows: {len(unmatched_df)}")
    print(f"Errors sheet rows: {len(errors_df)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
