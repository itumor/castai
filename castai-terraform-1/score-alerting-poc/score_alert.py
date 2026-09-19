#!/usr/bin/env python3
"""Score-based alerting POC — proactive daily pings to cluster owners when
their CAST AI optimization posture degrades, with actionable to-do steps.

Commands
--------
scan    Discover orgs/clusters, evaluate rule templates, deliver alerts.
owners  Show who actually edits a cluster (audit-log inference).

Config: JSON file. See config.example.json. Secrets via environment:
CASTAI_API_KEY (X-API-Key auth), SMTP_USER/SMTP_PASS for email,
SLACK_WEBHOOK_* env vars referenced from owner entries.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

import notify
import owners as owners_mod
import rules as rules_mod
import signals as signals_mod
import state as state_mod
from castai_client import ApiError, CastaiClient

DEFAULT_CONFIG = {
    "base_url": "https://api.cast.ai",
    "enterprise_id": None,
    "organization_ids": [],
    "organization_name_filter": None,
    "cluster_name_filter": None,
    "console_scores": {},
    "thresholds": {},
    "cooldown_hours": 24,
    "state_file": ".score-alert-state.json",
    "lookback_days": 31,
    "owners": [],
    "default_recipients": {"emails": []},
    "smtp": {},
}


def load_config(path: str | None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if path and path != "-":
        with open(path, encoding="utf-8") as fh:
            cfg.update(json.load(fh))
    for arg_key, cfg_key in (("base_url", "base_url"),
                             ("enterprise_id", "enterprise_id")):
        return_value = os.environ.get(f"CASTAI_{arg_key.upper()}") or cfg.get(cfg_key)
        cfg[cfg_key] = return_value
    return cfg


def build_client(cfg: dict, args) -> CastaiClient:
    verbose = bool(getattr(args, "verbose", False)) or os.environ.get("DEBUG")
    logger = (lambda fmt, *a: print("[api]", fmt % a)) if verbose else None
    return CastaiClient(base_url=cfg.get("base_url"), logger=logger,
                        timeout=int(cfg.get("timeout_seconds", 30)))


def resolve_org_clusters(client: CastaiClient, cfg: dict) -> list[tuple]:
    """Cluster discovery. Returns ``(scoped_client, cluster)`` pairs so that
    downstream signal calls run inside the cluster's own org context.

    Resolution order: enterprise children via EnterpriseAPI when
    ``enterprise_id`` is set; otherwise, if an org name/id filter is given,
    the token-user's memberships via UsersAPI_ListOrganizations — a CAST AI
    user token that belongs to the enterprise can see every child org, and
    each is entered via the ``X-Castai-Organization-Id`` header
    (``client.scoped()``). Without filters, a plain single-org list is used."""
    orgs: list[dict] = []
    if cfg.get("enterprise_id"):
        orgs = client.enterprise_child_orgs(cfg["enterprise_id"])
    elif cfg.get("organization_name_filter") or cfg.get("organization_ids"):
        orgs = client.list_organizations()
    wanted = set(cfg.get("organization_ids") or [])
    name_filter = (cfg.get("organization_name_filter") or "").lower()

    def org_in_scope(org: dict) -> bool:
        if wanted and org.get("id") not in wanted:
            return False
        return not name_filter or name_filter in org.get("name", "").lower()

    clusters: list[tuple] = []
    if orgs:
        for org in orgs:
            org_id = org.get("id", "")
            if not org_id or not org_in_scope(org):
                continue
            org_client = client.scoped(org_id)
            for c in org_client.list_clusters():
                c["_org_name"] = org.get("name", "")
                clusters.append((org_client, c))
    else:
        # Single-org token: one list call; org scoping via cluster orgId.
        for c in client.list_clusters():
            if wanted and c.get("organizationId") not in wanted:
                continue
            clusters.append((client, c))
    cf = (cfg.get("cluster_name_filter") or "").lower()
    return [(cl, c) for cl, c in clusters
            if not cf or cf in c.get("name", "").lower()]


def cmd_scan(args) -> int:
    cfg = load_config(args.config)
    client = build_client(cfg, args)
    th = rules_mod.Thresholds.from_dict(cfg.get("thresholds"))
    state = state_mod.AlertState(cfg.get("state_file", DEFAULT_CONFIG["state_file"]),
                                 float(cfg.get("cooldown_hours", 24)))
    now = dt.datetime.now(dt.timezone.utc)
    scores_map = cfg.get("console_scores") or {}

    try:
        clusters = resolve_org_clusters(client, cfg)
    except ApiError as exc:
        print(f"ERROR discovering clusters: {exc}", file=sys.stderr)
        return 2
    if not clusters:
        print("No clusters in scope — check config filters.")
        return 0

    results = []
    delivered = suppressed = 0
    for org_client, cluster in clusters:
        sig = signals_mod.collect_cluster_signals(
            org_client, cluster, org_name=cluster.get("_org_name", ""),
            lookback_days=int(cfg["lookback_days"]), now=now,
            console_score=scores_map.get(cluster["name"]) or scores_map.get(cluster["id"]))
        all_findings = rules_mod.evaluate_rules(sig, th, now)
        fresh = [f for f in all_findings if state.should_send(sig.cluster_id, f.rule_id, now)]
        owner = owners_mod.resolve_owners(
            sig.cluster_name, cfg.get("owners") or [],
            cfg.get("default_recipients"))
        results.append({"signals": sig, "findings": all_findings,
                        "fresh": fresh, "owners": owner, "sent": bool(fresh)})
        suppressed += len(all_findings) - len(fresh)

        if not fresh:
            continue
        body = notify.render_owner_message(sig.cluster_name, sig, fresh)
        subject = f"[castai] {sig.cluster_name}: {len(fresh)} optimization to-dos"
        actions = []
        if args.dry_run:
            actions.append(notify.send_email(cfg.get("smtp", {}),
                                             owner.get("emails") or ["(no recipients)"],
                                             subject, body, dry_run=True))
        else:
            if owner.get("emails") and cfg.get("smtp"):
                try:
                    actions.append(notify.send_email(cfg["smtp"], owner["emails"],
                                                     subject, body))
                except OSError as exc:
                    actions.append(f"email FAILED: {exc}")
            webhook_env = owner.get("slack_webhook_env")
            webhook = os.environ.get(webhook_env or "", "")
            if webhook:
                try:
                    actions.append(notify.send_slack(webhook, body))
                except OSError as exc:
                    actions.append(f"slack FAILED: {exc}")
        if not args.dry_run:
            # Only consume the daily quota when something actually reached an
            # owner: a failed/unconfigured channel must not suppress tomorrow.
            delivered_somewhere = actions and not all("FAILED" in a for a in actions)
            if delivered_somewhere:
                for f in fresh:
                    state.mark_sent(sig.cluster_id, f.rule_id, now)
            else:
                print(f"  ⚠️ {sig.cluster_name}: no channel succeeded; "
                      "findings kept pending")
        delivered += len(fresh)
        for a in actions:
            print(f"  → {a}")

    report = notify.render_markdown_report(results, now)
    if args.report_out == "-":
        print(report)
    elif args.report_out:
        with open(args.report_out, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"Report written to {args.report_out}")
    if not args.dry_run:
        state.save()
    print(f"Scanned {len(clusters)} cluster(s): {delivered} finding(s) "
          f"delivered, {suppressed} suppressed by cooldown.")
    return 0


def cmd_owners(args) -> int:
    cfg = load_config(args.config)
    client = build_client(cfg, args)
    clusters = resolve_org_clusters(client, cfg)
    for org_client, cluster in clusters:
        cid = cluster.get("id", "")
        name = cluster.get("name", cid)
        print(f"{name} ({cid}):")
        editors = owners_mod.infer_active_editors(org_client, cid, days=args.days)
        if not editors:
            print("  no audit activity found")
        for email, count in editors:
            print(f"  {email}  ({count} actions)")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="score-alert",
                                     description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default="config.json",
                        help="Path to config JSON ('-' or missing → env/defaults).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Evaluate everything, deliver nothing, touch no state.")
    parser.add_argument("--verbose", action="store_true", help="Log raw API calls.")
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="Scan clusters and alert owners.")
    scan.add_argument("--report-out", default="-", metavar="PATH",
                      help="Markdown report path ('-' = stdout).")
    scan.set_defaults(func=cmd_scan)

    own = sub.add_parser("owners", help="Infer active cluster editors from audit log.")
    own.add_argument("--days", type=int, default=30)
    own.set_defaults(func=cmd_owners)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
