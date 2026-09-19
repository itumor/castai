"""Cluster-owner resolution.

Sergej's preference: alert the engineers who *work on* a cluster, not the
manager who created the org. Two mechanisms:

1. config mapping — glob patterns on cluster name → audience (emails /
   Slack-channel env var). Deterministic; recommended for the POC.
2. audit inference — who initiated write operations on the cluster
   (AuditAPI_ListAuditEntries supports initiatedByEmail filtering). The
   simplest defensible proxy for "the techies who edit clusters".
"""

from __future__ import annotations

import datetime as dt
import fnmatch
from collections import Counter

from castai_client import ApiError, CastaiClient


def resolve_owners(cluster_name: str, owner_config: list[dict],
                   default: dict | None = None) -> dict:
    """First-glob-wins mapping over the configured owner list.

    Each entry: {"pattern": "teamcenter-prod-*", "emails": [...],
    "slack_webhook_env": "SLACK_WEBHOOK_X"}.
    Returns {"emails": [...], "slack_webhook_env": str|None, "source": "config"|"default"|"none"}.
    """
    for entry in owner_config or []:
        pattern = entry.get("pattern", "*")
        if fnmatch.fnmatchcase(cluster_name.lower(), pattern.lower()):
            return {"emails": list(entry.get("emails", [])),
                    "slack_webhook_env": entry.get("slack_webhook_env"),
                    "source": "config", "pattern": pattern}
    if default and default.get("emails"):
        return {"emails": list(default.get("emails", [])),
                "slack_webhook_env": default.get("slack_webhook_env"),
                "source": "default"}
    return {"emails": [], "slack_webhook_env": None, "source": "none"}


def infer_active_editors(client: CastaiClient, cluster_id: str,
                         days: int = 30, limit: int = 100,
                         now: dt.datetime | None = None) -> list[tuple[str, int]]:
    """Emails that initiated operations on the cluster recently, most-active
    first. Read-only signal: we never attribute responsibility, we just
    surface the people who actually touch the cluster."""
    now = now or dt.datetime.now(dt.timezone.utc)
    frm = (now - dt.timedelta(days=days)).isoformat()
    try:
        data = client.audit_entries(cluster_id, frm, now.isoformat(), limit=limit)
    except ApiError:
        return []
    counts: Counter = Counter()
    for item in data.get("items", []) or []:
        email = (item.get("initiatedBy") or {}).get("email")
        if email and "@" in email and not email.startswith("system"):
            counts[email] += 1
    return counts.most_common()
