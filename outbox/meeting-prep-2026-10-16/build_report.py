#!/usr/bin/env python3
"""Assemble the 5 meeting briefs into (a) one consolidated markdown,
(b) a styled HTML for Chrome headless -> PDF."""
import pathlib
import re
import sys
import datetime

from markdown_it import MarkdownIt

BASE = pathlib.Path("/Users/eramadan/castai/outbox/meeting-prep-2026-10-16")
ORDER = [
    ("meeting-1-org-structure.md", "09:30", "Cast AI & Siemens — Org Structure"),
    ("meeting-2-uc2-weekly.md", "10:30", "Cast AI 1 to 1 | IT DF COL UC 2 — Weekly Follow Up"),
    ("meeting-3-smo-railigent.md", "12:30", "SIEMENS x Cast AI | SMO Railigent X — Alignment & Next Steps"),
    ("meeting-4-sibase-x.md", "15:00", "CAST AI 1 to 1 | APM0414470 SiBase X — Follow Up #3"),
    ("meeting-5-cluster-score.md", "17:00", "Cast AI Cluster Score Review"),
]

def read_brief(fname: str) -> str:
    p = BASE / fname
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8").strip()

def main() -> int:
    briefs = []
    missing = []
    for fname, t, title in ORDER:
        txt = read_brief(fname)
        if txt is None:
            missing.append(fname)
        else:
            briefs.append((t, title, txt))
    if missing:
        print("MISSING:", ", ".join(missing), file=sys.stderr)

    today = "Thursday, October 15, 2026"
    day = "Friday, October 16, 2026"

    header_md = f"""# Siemens × CAST AI — Meeting Preparation Pack
**For:** Ebrahim Ramadan · **Meetings day:** {day} (Europe/Riga) · **Prepared:** {today}

Five accepted meetings, each with verified context from Granola meeting notes, the CAST AI API (read-only), and repo case docs. All figures carry a source and pull timestamp inside each section.

---
"""
    toc_lines = ["## Today's schedule\n"]
    for t, title, _ in briefs:
        anchor = title.split("—")[0].split("|")[0].strip().lower()
        anchor = re.sub(r"[^a-z0-9]+", "-", anchor).strip("-")
        toc_lines.append(f"- **{t}** — {title}")
    toc_lines.append("\n---\n")
    toc_md = "\n".join(toc_lines)

    body_md = "\n\n".join(txt for _, _, txt in briefs)
    full_md = header_md + toc_md + "\n" + body_md + "\n"

    (BASE / "meeting-prep-pack.md").write_text(full_md, encoding="utf-8")

    md = MarkdownIt("commonmark").enable("table")
    body_html = md.render(full_md)

    css = """
    @page { margin: 18mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
           color: #1a1a2e; font-size: 10.5pt; line-height: 1.45; margin: 0; }
    h1 { font-size: 20pt; color: #0b3d91; border-bottom: 3px solid #0b3d91;
         padding-bottom: 6px; margin: 0 0 12px 0; }
    h1:not(:first-child) { page-break-before: always; margin-top: 0; }
    h2 { font-size: 13pt; color: #0b3d91; margin: 18px 0 6px 0;
         border-bottom: 1px solid #c9d4e8; padding-bottom: 3px; }
    h3 { font-size: 11pt; color: #2c3e50; margin: 12px 0 4px 0; }
    p { margin: 5px 0; }
    ul, ol { margin: 4px 0 8px 0; padding-left: 22px; }
    li { margin: 2.5px 0; }
    table { border-collapse: collapse; width: 100%; margin: 8px 0;
            font-size: 9pt; page-break-inside: auto; }
    th { background: #0b3d91; color: #fff; text-align: left; padding: 5px 7px; }
    td { border: 1px solid #c9d4e8; padding: 4px 7px; vertical-align: top; }
    tr:nth-child(even) td { background: #f2f5fa; }
    code { background: #eef1f6; padding: 1px 4px; border-radius: 3px;
           font-family: 'SF Mono', Menlo, monospace; font-size: 9pt; }
    strong { color: #10243e; }
    hr { border: none; border-top: 1px dashed #9fb2cf; margin: 14px 0; }
    a { color: #0b3d91; text-decoration: none; word-break: break-all; }
    .footer { margin-top: 20px; font-size: 8.5pt; color: #667; }
    """

    footer = f'<p class="footer">Prepared {today} by the CAST AI Superteam research run — sources: Granola meeting notes, CAST AI EU API (read-only, api.eu.cast.ai), repo case docs. All pull timestamps inside sections. INTERNAL — do not forward raw to customers.</p>'

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Siemens × CAST AI — Meeting Prep 2026-10-16</title>
<style>{css}</style></head>
<body>{body_html}{footer}</body></html>"""
    (BASE / "meeting-prep-pack.html").write_text(html, encoding="utf-8")
    print("WROTE", BASE / "meeting-prep-pack.md")
    print("WROTE", BASE / "meeting-prep-pack.html")
    return 0 if not missing else 1

if __name__ == "__main__":
    sys.exit(main())
