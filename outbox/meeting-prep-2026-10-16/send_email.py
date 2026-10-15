#!/usr/bin/env python3
"""Send the meeting-prep email via Mail.app (AppleScript) with attachments.
Usage: python3 send_email.py <body_txt_file> <attachment1> [attachment2 ...]
Self-send to ebrahim@cast.ai explicitly requested by the account owner."""
import pathlib
import subprocess
import sys

TO = "ebrahim@cast.ai"
SENDER = "ebrahim@cast.ai"
SUBJECT = "Meeting prep pack — Siemens × CAST AI, Friday Oct 16 (5 meetings) + PDF"


def as_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")


def main() -> int:
    body_file = pathlib.Path(sys.argv[1])
    attachments = [pathlib.Path(a).resolve() for a in sys.argv[2:]]
    for a in attachments:
        if not a.exists():
            print("Attachment missing:", a, file=sys.stderr)
            return 2
    body = body_file.read_text(encoding="utf-8")

    attach_lines = "\n".join(
        f'            make new attachment with properties {{file name:(POSIX file "{a}")}} at after the last paragraph'
        for a in attachments
    )

    # Build body assignment in <=3000-char chunks for AppleScript safety
    chunks = [body[i:i + 3000] for i in range(0, len(body), 3000)]
    body_assign = "\n".join(
        f'set bodyText to bodyText & "{as_escape(c)}"' for c in chunks
    )

    script = f'''
set bodyText to ""
{body_assign}
tell application "Mail"
    set msg to make new outgoing message with properties {{subject:"{as_escape(SUBJECT)}", content:bodyText, visible:false}}
    tell msg
        make new to recipient with properties {{address:"{TO}"}}
        set sender to "{SENDER}"
        tell content
{attach_lines}
        end tell
    end tell
    send msg
end tell
return "SENT"
'''
    script_path = pathlib.Path("/tmp/dsh-send-meeting-prep.applescript")
    script_path.write_text(script, encoding="utf-8")
    result = subprocess.run(
        ["osascript", str(script_path)], capture_output=True, text=True, timeout=240
    )
    print("RC:", result.returncode)
    print("OUT:", result.stdout.strip())
    print("ERR:", result.stderr.strip()[:2000])
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
