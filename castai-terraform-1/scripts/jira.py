#!/usr/bin/env python3
"""Tiny Jira Cloud helper for the CAST AI super-engineer agent.

Usage:
  jira.py <jql> [--fields f1,f2] [--max N]   -> prints key | proj | type | status | priority | summary rows
Environment: JIRA_TOKEN must be set. Email fixed to ebrahim@cast.ai.
Never prints the token.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = "https://castai.atlassian.net"
EMAIL = "ebrahim@cast.ai"


def jql_search(jql: str, fields: str, max_results: int) -> dict:
    token = os.environ.get("JIRA_TOKEN", "")
    if not token:
        print("JIRA_TOKEN not set", file=sys.stderr)
        sys.exit(2)
    params = urllib.parse.urlencode(
        {"jql": jql, "maxResults": max_results, "fields": fields}
    )
    url = f"{BASE}/rest/api/3/search/jql?{params}"
    req = urllib.request.Request(url)
    import base64

    auth = base64.b64encode(f"{EMAIL}:{token}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("jql")
    ap.add_argument(
        "--fields",
        default="summary,status,project,issuetype,priority,assignee,created,updated",
    )
    ap.add_argument("--max", type=int, default=20)
    args = ap.parse_args()

    data = jql_search(args.jql, args.fields, args.max)
    issues = data.get("issues", [])
    for i in issues:
        f = i["fields"]
        proj = (f.get("project") or {}).get("key", "?")
        itype = (f.get("issuetype") or {}).get("name", "?")
        status = (f.get("status") or {}).get("name", "?")
        prio = (f.get("priority") or {}).get("name", "-")
        assignee = (f.get("assignee") or {}).get("displayName", "Unassigned")
        summary = (f.get("summary") or "").replace("\n", " ")[:70]
        print(
            f"{i['key']} | {proj} | {itype} | {status} | {prio} | {assignee} | {summary}"
        )
    print(f"-- {len(issues)} issues returned")


if __name__ == "__main__":
    main()
