#!/usr/bin/env python3
"""send_prep_email.py — send the meeting prep pack (markdown body + PDF
attachment) through the local sendmail(8) submission queue.

Usage:
  python3 scratch/send_prep_email.py --to ebrahim@cast.ai \
      --subject "..." --body-file report.md --attach report.pdf
"""

import argparse
import base64
import subprocess
import sys
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--body-file", required=True)
    ap.add_argument("--attach", action="append", default=[])
    args = ap.parse_args()

    with open(args.body_file, encoding="utf-8") as fh:
        body_text = fh.read()

    msg = MIMEMultipart("mixed")
    msg["To"] = args.to
    msg["From"] = "CAST AI Superteam <superteam@localhost>"
    msg["Date"] = formatdate(localtime=True)
    msg["Subject"] = args.subject
    msg.attach(MIMEText(body_text, "plain", "utf-8"))

    for path in args.attach:
        with open(path, "rb") as fh:
            part = MIMEApplication(fh.read(), _subtype="pdf")
        filename = path.rsplit("/", 1)[-1]
        part.add_header("Content-Disposition", "attachment", filename=filename)
        part.add_header("Content-Transfer-Encoding", "base64")
        msg.attach(part)

    proc = subprocess.run(
        ["/usr/sbin/sendmail", "-t", "-i"],
        input=msg.as_bytes(),
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(f"sendmail exit {proc.returncode}: {proc.stderr.decode(errors='replace')}\n")
        raise SystemExit(1)
    print(f"queued to sendmail: To={args.to} Subject={args.subject!r} attachments={len(args.attach)}")


if __name__ == "__main__":
    main()
