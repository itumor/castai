#!/usr/bin/env python3
"""meeting_prep_pdf.py — render the meeting prep markdown report to PDF.

Usage: python3 scratch/meeting_prep_pdf.py <input.md> <output.pdf>

Handles the markdown subset the meeting-prep report uses:
# / ## / ### headings, '- ' bullets, **bold**, *italic*, pipe tables,
horizontal rules, and paragraphs. Reportlab only — no external deps.
"""

import re
import sys

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ACCENT = colors.HexColor("#0b3a75")
LIGHT = colors.HexColor("#eef3fa")
RULE = colors.HexColor("#b9c7da")

BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, spaceAfter=4)
BULLET = ParagraphStyle("bullet", parent=BODY, leftIndent=12, bulletIndent=2, spaceAfter=2)
H1 = ParagraphStyle("h1", parent=BODY, fontName="Helvetica-Bold", fontSize=17, leading=21,
                    textColor=ACCENT, spaceBefore=4, spaceAfter=8)
H2 = ParagraphStyle("h2", parent=BODY, fontName="Helvetica-Bold", fontSize=13, leading=17,
                    textColor=ACCENT, spaceBefore=10, spaceAfter=4)
H3 = ParagraphStyle("h3", parent=BODY, fontName="Helvetica-Bold", fontSize=10.5, leading=14,
                    textColor=colors.HexColor("#1a2f4a"), spaceBefore=8, spaceAfter=3)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.5, leading=11.5, spaceAfter=0)
CELLH = ParagraphStyle("cellh", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)


def inline(text: str) -> str:
    text = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\w)\*(.+?)\*(?!\w)", r"<i>\1</i>", text)
    text = re.sub(r"`(.+?)`", r'<font face="Courier">\1</font>', text)
    return text


def is_table_row(line: str) -> bool:
    return line.startswith("|") and line.endswith("|") and line.count("|") >= 2


def is_separator_row(line: str) -> bool:
    return bool(re.fullmatch(r"\|[\s:|-]+\|", line))


def build_table(rows):
    parsed = [[c.strip() for c in r.strip("|").split("|")] for r in rows]
    header, body = parsed[0], [r for r in parsed[1:] if not is_separator_row("|" + "|".join(r) + "|")]
    ncols = len(header)
    data = [[Paragraph(inline(c), CELLH) for c in header]]
    for r in body:
        r = (r + [""] * ncols)[:ncols]
        data.append([Paragraph(inline(c), CELL) for c in r])
    usable = A4[0] - 36 * mm
    colw = [usable / ncols] * ncols
    t = Table(data, colWidths=colw, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def render(md: str, out: str):
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm, title="Meeting Prep Pack")
    story = []
    lines = md.splitlines()
    i = 0
    first_h1 = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if is_table_row(line):
            rows = []
            while i < len(lines) and is_table_row(lines[i].rstrip()):
                rows.append(lines[i].rstrip())
                i += 1
            story.append(Spacer(1, 2 * mm))
            story.append(build_table(rows))
            story.append(Spacer(1, 3 * mm))
            continue
        if re.fullmatch(r"-{3,}", line.strip()):
            story.append(Spacer(1, 2 * mm))
            story.append(HRFlowable(width="100%", thickness=1, color=RULE))
            story.append(Spacer(1, 2 * mm))
        elif line.startswith("### "):
            story.append(Paragraph(inline(line[4:]), H3))
        elif line.startswith("## "):
            story.append(Paragraph(inline(line[3:]), H2))
        elif line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), H1))
            if first_h1:
                first_h1 = False
                story.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
                story.append(Spacer(1, 2 * mm))
        elif re.match(r"^[*-] ", line):
            story.append(Paragraph(inline(line[2:]), BULLET, bulletText="•"))
        elif re.match(r"^\d+\. ", line):
            num, text = line.split(". ", 1)
            story.append(Paragraph(inline(text), BULLET, bulletText=f"{num}."))
        else:
            story.append(Paragraph(inline(line), BODY))
        i += 1
    doc.build(story)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: meeting_prep_pdf.py <input.md> <output.pdf>\n")
        raise SystemExit(2)
    with open(sys.argv[1], encoding="utf-8") as fh:
        render(fh.read(), sys.argv[2])
    print(f"pdf written: {sys.argv[2]}")


if __name__ == "__main__":
    main()
