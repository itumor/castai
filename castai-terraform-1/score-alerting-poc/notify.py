"""Delivery: markdown report (always), Slack incoming webhook, SMTP email.
All network sends honour --dry-run by reporting what *would* go out.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import smtplib
import urllib.request
from email.message import EmailMessage

from rules import Finding, health_percent
from signals import ClusterSignals

_METHOD = {"poor": "🔴", "concerning": "🟡", "info": "🔵"}


def render_owner_message(cluster_name: str, sig: ClusterSignals,
                         findings: list[Finding]) -> str:
    """The proactive message a cluster owner receives: actionable to-dos,
    not a naked score (Sergej's core ask)."""
    pct = health_percent(findings, sig)
    score_line = (f" (console score: {sig.console_score})"
                  if sig.console_score is not None else "")
    lines = [
        f"⚠️ CAST AI optimization check for **{cluster_name}** — "
        f"{pct}% of observable sub-metrics healthy{score_line}",
        "",
    ]
    for f in findings:
        lines.append(f"{_METHOD.get(f.severity, '⚪')} **{f.title}**")
        lines.append(f"   {f.description}")
        for i, step in enumerate(f.steps, 1):
            lines.append(f"   {i}. {step}")
        if f.docs:
            lines.append("   Docs: " + ", ".join(f.docs))
        lines.append("")
    lines.append("_Reply or re-run when the steps are applied; the daily "
                 "scan will confirm the fix from rebalance history / policy "
                 "state, no manual ack needed._")
    return "\n".join(lines)


def render_markdown_report(results: list[dict],
                           generated_at: dt.datetime | None = None) -> str:
    generated_at = generated_at or dt.datetime.now(dt.timezone.utc)
    out = ["# Score-based alerting — scan report",
           f"_Generated {generated_at.isoformat(timespec='seconds')}_", ""]
    for entry in results:
        sig: ClusterSignals = entry["signals"]
        findings: list[Finding] = entry["findings"]
        owners = entry.get("owners") or {}
        sent = entry.get("sent", False)
        pct = health_percent(findings, sig)
        header = f"## {sig.cluster_name or sig.cluster_id} — {pct}%"
        if sig.console_score is not None:
            header += f" · console score {sig.console_score}"
        out.append(header)
        out.append(f"- org: `{sig.organization_id}` ({sig.organization_name or 'n/a'})"
                   f" · provider {sig.provider or '?'} · region {sig.region or '?'}")
        if owners.get("emails"):
            out.append(f"- owners ({owners.get('source')}): "
                       + ", ".join(owners["emails"]))
        out.append(f"- findings: {len(findings)}"
                   + ("" if sent or not findings
                      else " *(all suppressed by daily dedup)*"))
        if sig.errors:
            out.append(f"- ⚠️ partial data: {', '.join(sorted(sig.errors))}")
        for f in findings:
            out.append(f"\n### {_METHOD.get(f.severity, '⚪')} {f.title}")
            out.append(f.description)
            for step in f.steps:
                out.append(f"- {step}")
            out.append("")
        out.append("")
    if not results:
        out.append("_No clusters in scope._")
    return "\n".join(out)


def send_slack(webhook_url: str, text: str, dry_run: bool = False) -> str:
    if dry_run:
        return f"dry-run: would post {len(text)} chars to {webhook_url[:40]}…"
    payload = json.dumps({"text": text}).encode()
    req = urllib.request.Request(webhook_url, data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return f"slack {resp.status}"


def send_email(smtp_cfg: dict, to_addrs: list[str], subject: str, body: str,
               dry_run: bool = False) -> str:
    if not to_addrs:
        return "skipped: no recipients"
    msg = EmailMessage()
    msg["From"] = smtp_cfg.get("from", "castai-alerts@cast.ai")
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    msg.set_content(body)
    if dry_run:
        return f"dry-run: would email {to_addrs} '{subject}'"
    user = os.environ.get(smtp_cfg.get("username_env", ""), "") or None
    password = os.environ.get(smtp_cfg.get("password_env", ""), "") or None
    with smtplib.SMTP(smtp_cfg.get("host", "localhost"),
                      int(smtp_cfg.get("port", 587)), timeout=30) as smtp:
        if smtp_cfg.get("starttls", True):
            smtp.starttls()
        if user and password:
            smtp.login(user, password)
        smtp.send_message(msg)
    return f"emailed {to_addrs}"
