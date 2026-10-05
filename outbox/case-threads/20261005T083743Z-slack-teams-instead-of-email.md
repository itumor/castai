# Slack message — offer Teams Workflows instead of email (Siemens)

<!-- DRAFT — paste-ready Slack message below the line. Customer-facing; public docs links only. -->

---

Hi all :wave:

Quick update on the email-notifications question:

CAST AI doesn't send alert notifications to email natively — supported delivery is **Slack (native)** or **webhooks**.
The good news: you're mostly set up already for the best alternative.

**Our recommendation: MS Teams notifications via Workflows**
https://docs.cast.ai/docs/examples#method-2-ms-teams-workflows-integration

Why this path:
• Runs on your existing Microsoft 365 tenant — no third-party tools
• Alerts arrive as adaptive cards in the Teams channel you pick
• Your **"Siemens Dev alerts"** configuration on our side is already healthy (`CanConnect`, category **All**, all severities) — CAST AI side is done :white_check_mark:

Status from today (2026-10-05):
• 03:46 UTC — CAST AI generated several **"Pending pod detected"** events and attempted delivery to your workflow URL. Please check the **flow run history** and the Teams channel — if the cards arrived, the pipeline is proven end-to-end.
• One fix needed on a related config: the auto-created **"Workload Autoscaler"** alert is failing (`FailedToConnect`) because it's missing the `Content-Type: application/json` header — one-line fix in the console (Notifications → Manage alerts).

Still want email too? Add an **Office 365 Outlook "Send an email (V2)"** action to the same Power Automate flow — every alert then lands in Teams *and* in the inbox, using the setup you already own.
Setup details & template variables: https://docs.cast.ai/docs/setup-notification-webhook

Happy to walk through all of this live on tomorrow's call (14:00 CET).

---

<!-- Internal reviewer notes (remove before sending):
- Live data verified 2026-10-05 read-only: org Siemens Dev (43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2); main config 18149273-43f3-4572-b669-d0a6ec2f2def = CanConnect; auto config 84134059-a524-4a24-9ac8-99a933dcffef = FailedToConnect (endpoint 400: octet-stream vs JSON → missing Content-Type header); feed shows "Pending pod detected" x4 today 03:46 UTC + INFO 08:22 UTC.
- The Pending-pod events = someone's test this morning already fired CAST AI-side; delivery proof = Power Automate run history (can't see downstream from our side).
- Teams Workflows method relies on the same Power Automate URL the customer already configured — that's why "mostly set up already" is fair.
-->
