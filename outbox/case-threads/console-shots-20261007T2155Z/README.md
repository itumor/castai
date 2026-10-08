# Console proof set — ORG CPS negative-savings case (captured 2026-10-08, ~00:52–01:10 EET)

Source: console.eu.cast.ai, org = CPS (`5e413e89-…`), logged-in CAST AI session, read-only
(navigation + screenshots only; no settings touched). Captured via Playwright-driven Chrome,
scripts `scripts/console-cps-shots*.mjs` (repo root).

## Claim → screenshot map

| Email claim | Console proof | File |
|---|---|---|
| CPS org = exactly these 2 clusters; scores low vs OK | Cluster list: dema-platform-services **4.9**, dema-platform-services-test **6.2**, monthly cost ~$12.6k / ~$347 | `01-cluster-list.png` |
| Realized savings positive, org level | Savings Report (This month): Baseline spend **$6,841**, **Realized +$2,992**, Actual $3,849. Geometry: 6,841 − 3,849 = 2,992 → realized = projected − actual | `06-savings-default.png` (org) |
| Main cluster NOT negative; node autoscaling IS working | Main Savings (Oct): Realized **+$2,930**, Actual $3,771 (44% below baseline $6,701); Node autoscaler impact: **683.96 → 485.25 CPU (−198.84)** | `22-main-savings-last30d.png`, `08-savings-test-only.png` |
| Test cluster NOT negative; WOOP flipped positive | Test Savings (Oct): Baseline $147, Realized **+$66**, Actual $81 (45%); **Workload Autoscaler savings ~$9 positive** (Aug was −$24.81 — API) | `09-savings-main-only.png` |
| WOOP line is a sub-attribution inside Total | Org report: WOOP ~$12 shown as separate tile next to Realized $2,992 — included, not stacked | `06-savings-default.png` |
| Bad score = efficiency, not "autoscaler missing" | Main Cluster score 4.9 "underperforming — considerable inefficiencies", cost-efficiency 80% weight, 14/16 checks; test 6.2, 16/16 checks | `02-main-score.png`, `03-test-score.png` |
| "Connected since 2025-10-21", baseline window | Header of per-cluster Savings pages | `08-…`, `09-…` |

## Verified in console but only for "This month" (October)

The console date picker offers ONLY rolling presets (Last 7d / 2w / 30d / This month / Previous
week / Previous month / Last 3m / Last 12m) — no custom month. **An August-only console view
cannot be produced** (verified by DOM probing + URL-parameter probing: no `from/to/startTime/…`
param is honoured). The August figures in the email (WOOP test −$24.81 ≈ −€22, main −$74.59) come
from the value-realization API pull of 2026-10-05 (recorded in
`.kimchi/docs/2026-10-05-cps-negative-savings-case.md`) — keep them, but cite them as API-verified.

## Notes for the sender

- The score tiles drifted since the customer's screenshot: console TODAY shows **4.9 / 6.2**
  (his screenshot: 4.6 / 6.8). Re-check wording before sending — the edited draft's phrase
  "…for a total of $12,585/month and a 4.6 score" mixes the estimated-savings monthly figure
  with the score and should be rewritten or dropped.
- Node managed state: 72/77 nodes CAST-managed on main (API today; console Nodes page:
  `02-main-node-autoscaler.png`).
- All console numbers are discounted USD (console selector visible in shots).
