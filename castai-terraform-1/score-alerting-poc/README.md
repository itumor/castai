# castai-score-alerting (POC)

Proactive daily alerting to cluster owners when a cluster's CAST AI **Cluster
Score posture** degrades — with actionable to-do steps, not a naked score.

Built as the POC for the Siemens/Council conversation (Sergej's ask, Ahmed's
build). Rule-based templates mapped to the six documented score sub-metrics —
no AI involved.

## How it answers the meeting asks

| Ask | How this POC does it |
|---|---|
| Proactive daily alert when score is low | cron\\* running `scan`; dedup state fires each rule at most once per 24 h |
| Actionable to-dos, not a raw score | `rules.py` emits per-finding step lists sourced from docs.cast.ai |
| Overprovisioning → "enable evictor, run rebalance" | `overprovisioning`, `evictor_off`, `rebalance_stale` rules |
| Unoptimized workloads → "enable WOOP policy" | `woop_off` rule |
| Org/sub-org complexity | documented `EnterpriseAPI_ListChildrenOrganizations` (see curl below); per-org cluster enumeration |
| Alert the techies, not org creators | `owners.py`: glob-name mapping, plus audit-log inference of who actually edits a cluster |
| Confirm action was taken, don't blame people | Plans in `rebalance history` are a fact: a re-enabled Evictor / executed plan silences the alert automatically |
| OpsPilot checklist not API-accessible | out of scope by design; restrictions via `ClusterScoreAPI_ListClusterRestrictions` stand in |

\\\* `cron` line: `0 8 * * *  cd score-alerting-poc && CASTAI_API_KEY=... python3 score_alert.py scan --report-out reports/$(date +\%F).md`

## Why it does not *read* the numeric score

The public API does not expose the 0–10 console Cluster Score —
`ClusterScoreAPI` only ships the **restrictions** (the constraint catalogue
behind a low score). This POC instead:

1. Re-evaluates the documented healthy thresholds from signal APIs
   (efficiency overprovisioning %, Evictor config, WOOP policies, rebalance
   recency — the same inputs the score sub-metrics use).
2. Accepts injected console scores via config (`console_scores` map) so the
   report still displays the official number when someone provides it.

That makes the alert *causal*: every alert names the specific sub-metric and
threshold being violated, which is exactly the conversation Sergej wants.

## Setup

```bash
export CASTAI_API_KEY='your-api-key'          # X-API-Key auth (console-issued)
cp config.example.json config.json            # adjust owners/smtp/filters
python3 score_alert.py scan --dry-run         # full evaluation, zero delivery
python3 score_alert.py scan --report-out report.md
python3 score_alert.py owners --days 30       # who actually edits clusters?
python3 -m unittest discover -s tests -v      # 17 offline tests
```

Python 3.10+, stdlib only — nothing to install. EU tenants: set
`"base_url": "https://api.eu.cast.ai"` in config.json.

## The enterprise curl (Ahmed → Ebrahim)

"The API is org-scoped but you can fan out from an enterprise token" is
**documented**, not an undocumented flag — `EnterpriseAPI`:

```bash
# 1. List every child org under the enterprise (token-scoped)
curl -sS "https://api.cast.ai/organization-management/v1/enterprises/${ENTERPRISE_ID}/organizations?page.limit=100" \
  -H "X-API-Key: ${CASTAI_API_KEY}"

# 2. For each child org id, list clusters (org context switch):
curl -sS "https://api.cast.ai/v1/kubernetes/external-clusters" \
  -H "X-API-Key: ${CASTAI_API_KEY}"

# 3. Per-cluster signals the POC uses:
curl -sS "https://api.cast.ai/v1/cost-reports/clusters/${CLUSTER_ID}/efficiency?startTime=...&endTime=..." -H "X-API-Key: $CASTAI_API_KEY"
curl -sS "https://api.cast.ai/v1/kubernetes/clusters/${CLUSTER_ID}/policies" -H "X-API-Key: $CASTAI_API_KEY"
curl -sS "https://api.cast.ai/v1/workload-autoscaling/clusters/${CLUSTER_ID}/policies" -H "X-API-Key: $CASTAI_API_KEY"
curl -sS "https://api.cast.ai/v1/kubernetes/clusters/${CLUSTER_ID}/rebalancing-plans" -H "X-API-Key: $CASTAI_API_KEY"
curl -sS "https://api.cast.ai/v1/cost-reports/clusters/${CLUSTER_ID}/estimated-savings" -H "X-API-Key: $CASTAI_API_KEY"
curl -sS "https://api.cast.ai/reporting/v1beta/organizations/${ORG_ID}/clusters/${CLUSTER_ID}/restrictions" -H "X-API-Key: $CASTAI_API_KEY"
```

### Verified on live EU API (2026-09-18) ✅

The open question is **closed**. One user API key reached into every child
org of the Siemens AG enterprise — no undocumented flag, no per-org keys:

1. **Org enumeration**: `GET /v1/organizations` returns every org the token
   user belongs to (~130 for us: the enterprise plus all children, incl.
   "Siemens Dev").
2. **Org context switch**: add `-H "X-Castai-Organization-Id: <child-org-id>"` to
   ANY call. (`X-Organization-Id` alone is silently ignored; the
   `X-Castai-Organization-Id` spelling is the working one.) Implemented as
   `client.scoped(org_id)`.
3. **Cloudflare blocks library User-Agents**: `python-urllib/…` gets HTTP 403
   error 1010 ("browser_signature_banned"). The client sends
   `castai-score-alerting-poc/1.0` by default (override `CASTAI_USER_AGENT`).
4. **Live run results** (`reports/2026-09-18-siemens-dev-live.md`): 7 real
   clusters scanned in "Siemens Dev" → 28 findings; every signal endpoint
   matched the documented shapes first try (efficiency, policies, evictor,
   WOOP, rebalance plans, savings, restrictions). One healthy cluster at
   100%, three recreations of `dev-vlab-cluster` at 0% with 78 %-savings on
   the table, and one at 33% (evictor off, last rebalance 130 days ago).
5. **Owner attribution reality check**: lab clusters show *zero* human
   audit events in 90 days — 100% `internal|autoscaler`. Org-level actions
   exist (e.g. discount edits) but carry no `clusterId` label. ⇒ For real
   alerting, rely on the **glob owner map**; use audit inference only as a
   hint. Confirms what the meeting predicted ("finding the techie is hard").

## Demo without a real token

```bash
python3 mock/mock_server.py --port 4015 &
python3 score_alert.py --config mock/config.demo.json --dry-run scan
```

The mock tells the meeting's story: `teamcenter-prod` at 82%/79%
overprovisioning with no rebalance ever run (5 poor findings, email to the
mapped owner), `teamcenter-dev` healthy.

## Config reference (config.json)

| Field | Meaning |
|---|---|
| `base_url` | `https://api.cast.ai` (US) or `https://api.eu.cast.ai` |
| `enterprise_id` | fan out across child orgs via EnterpriseAPI |
| `organization_ids`, `cluster_name_filter` | scope the scan |
| `console_scores` | `{clusterNameOrId: 4.1}` — display-only official score |
| `thresholds` | doc-derived defaults: CPU 20 %, RAM 35 %, 14/30-day rebalance, 10 % savings floor |
| `owners[]` | first glob match on cluster name wins → emails and/or `slack_webhook_env` |
| `default_recipients` | fallback audience |
| `cooldown_hours` | alert cadence dedup window (24 default) |
| `smtp` | host/port/starttls/from + `*_env` names for credentials |

## Prior-art / related

- `brain/notes/castai-optimization-quality-metrics-and-notifications.md` —
  verified docs research behind every threshold and remediation step here.
- `brain/notes/meeting-prep-optimization-quality-metrics.md` — framing
  (score = posture, capture ratio = quality, constraint register = why).
- Open action items for Ahmed also covered: enterprise curl above, and the
  feature request for a unified org/cluster view stays manual.

## Known limits (be honest in the demo)

- Uptime of sub-metrics 3 (node-template consolidation) and 4 (% workloads
  with CPU limits) is not observable through the used endpoints — the proxy
  never claims full score parity; the report says "observable sub-metrics".
- Owner attribution from audit is best-effort (service accounts blur it);
  the glob map is the reliable path.
- Delivery channels implemented: markdown report, Slack webhook, SMTP email.
  PagerDuty/OpsGenie work via CAST AI's own webhook notifications if you
  prefer delivery from inside the platform.
