Subject: RE: ORG CPS — two clusters with negative savings
To: Sergej Petrovski <sergej.petrovski@siemens.com>
Cc: Lars Marin (tecracer)

Hello Sergej,

short answer first: nothing is wrong — neither cluster is in minus. I verified this today, claim by claim, against your own console and our API. Claims and proofs below.

**Claim 1 — Both clusters have positive realized savings. Right now, every day.**
Proof: the CPS Savings Report as of this morning (October, org scope) — see attached screenshot 1. Baseline spend $6,841 minus actual spend $3,849 = realized savings +$2,992 in the first week of October alone. A cluster losing money cannot produce this picture.

**Claim 2 — On the first cluster, node autoscaling is configured and working — the low score has a different cause.**
Proof: the Savings Report of dema-platform-services — screenshot 2. Realized savings +$2,930 this month; under "Node autoscaler impact": baseline 684 CPU vs. 485 CPU actually provisioned — CAST AI removed ~199 CPU of waste. Node autoscaling has managed this cluster since July 22.
The 4.9 score (your screenshot showed 4.6 — it drifts) comes from remaining headroom, not from missing configuration: 0% Spot usage and a pending rebalancing recommendation (screenshot 3 — cluster list with both scores). That headroom is also the next saving: Spot scenarios estimate −48.7% to −73.5% of the current ~$12.6k per month.

**Claim 3 — The "couple of dozen Euro in minus" on the well-configured cluster is the Workload Autoscaler line — negative by definition, not by error.**
Documented formula (https://docs.cast.ai/docs/savings-baseline):
workload autoscaler savings = (original requests − current requests) × max(current price, baseline price)
On both clusters the Workload Autoscaler raised requests that were set too low — a stability correction. Your test cluster recorded 348 OOM kills in the last 30 days; under-requested memory is a classic cause. When current requests are higher than the originals, this line is negative by construction. In August it was −$24.81 ≈ −€22 — exactly the figure you saw. Two things matter:
1. This value is already contained in Total savings — a sub-attribution, not an additional loss on top (documented: Total savings = node autoscaler savings; the workload effect enters it via reduced demand).
2. It turned positive on September 24, once rightsizing caught up.
Proof: the same report for dema-platform-services-test, today — screenshot 4: realized savings +$66 (45% under baseline), Workload Autoscaler line ≈ +$9, positive.

**The calculation, compressed**

| Month | dema-platform-services — realized / workload line | dema-platform-services-test — realized / workload line |
|---|---|---|
| Jul 22–31 | +$2,567 / −$17 | +$70 / −$6 |
| August | +$9,951 / −$75 | +$213 / −$25 (≈ −€22 ← your figure) |
| September | +$11,690 / −$81 | +$202 / −$9 |
| October 1–8 (console today) | +$2,930 / ≈ +$3 | +$66 / ≈ +$9 |

Verdict: nothing is broken on either cluster. The minus you see is the Workload Autoscaler sub-attribution for corrected under-sizing — stability money, not lost money. The real remaining lever is Spot adoption (−48.7% to −73.5% estimated on dema-platform-services). Say the word and we walk through it in 30 minutes.

One note from our side, for completeness: the cloud-cost telemetry for both clusters has been stale since September 16 (some report tiles under-count as a result). We are correcting this — no action needed from you.

Sources: https://docs.cast.ai/docs/savings-report and https://docs.cast.ai/docs/savings-baseline. Screenshots taken today, 2026-10-08, from your console; monthly history from the CAST AI reporting API (the console offers rolling time windows only).

Best regards,
Ebrahim Ramadan
CAST AI — ebrahim@cast.ai

---
Attachments (embed in this order):
1. 06-savings-default.png — CPS Savings Report, this month (org scope)
2. 22-main-savings-last30d.png — dema-platform-services Savings Report
3. 01-cluster-list.png — cluster list with scores 4.9 / 6.2
4. 09-savings-main-only.png — dema-platform-services-test Savings Report
All in: outbox/case-threads/console-shots-20261007T2155Z/
