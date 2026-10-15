---
name: castai-customer-communication
description: Draft CAST AI support emails, concise ticket replies, internal engineering escalations, incident status updates, and customer RCA summaries. Use after investigations to explain findings clearly without overstating unverified fixes or savings.
---

# CAST AI customer support communications

## Procedure
1. Identify audience (customer / support / engineering / account team), incident/case ID if **actually provided**, business impact, confirmed evidence, remaining uncertainty and next owner.
2. Use concise, accurate, respectful wording. Start with direct outcome or current status, then evidence and next step. Avoid vague reassurance and defensive phrasing.
3. Label **confirmed**, **under investigation**, and **proposed** changes. Do not claim customer approval, engineering acknowledgement, case creation, root cause, or ETA unless there is evidence.
4. For financial explanations, clearly distinguish available, realized and net savings, time period, methodology and source.
5. Include links to official CAST AI docs and case evidence where accessible. Do not paste private tenant links or unredacted identifiers into public content.
6. Draft only. Sending email, posting messages, updating tickets, or filing escalations needs explicit user instruction and available integration.

## Template: customer progress email
```text
Subject: Update — <issue / ticket>

Hi <name/team>,

We investigated <specific scope and time window>.

Confirmed findings:
- <verified observation and evidence>

What we are still checking:
- <one relevant uncertainty>

Next step: <action and owner, only if known>.

Reference: <official doc or relevant case link>

Best regards,
<sender>
```

## Template: engineering handoff
```text
Issue: <brief symptom> | Severity: <supported level>
Environment: <provider, region, versions, redacted cluster>
Window (TZ): <start – end>
Impact: <observed impact>
Repro: <steps or not reproducible>
Evidence: <logs, timestamps, API responses, source links>
Checks completed: <read-only checks actually performed>
Hypotheses: <ranked and explicitly unverified>
Request: <specific engineering decision/investigation>
Status/Owner: <only if known>
```

## Quality gate
Prefer 100–250 words for routine customer emails unless a full RCA is requested. Redact secrets and sensitive data; avoid invented status or ticket references.

## References
- [CAST AI documentation](https://docs.cast.ai/)
- [Changelog](https://docs.cast.ai/changelog)
