# CAST AI Baseline Types — reference doc
*Siemens AG enterprise · prepared 2026-10-12 · basis: CAST AI savings semantics + live API evidence from all billed/VR clusters (57 baseline records, `GET /reporting/v1beta/organizations/{org}/clusters/{cid}/baseline-params`)*

---

## 1. What a baseline is

A baseline is the frozen description of **how the cluster would have behaved without CAST AI**. Every realized-savings number is `projected_cost − actual_cost`, and the projection is driven entirely by the baseline:

| Field | Meaning |
|---|---|
| `cpuOverprovisioningFactor` | ×-factor: how much CPU capacity the cluster provisioned per requested core-hour before CAST |
| `memoryOverprovisioningFactor` | ×-factor: same for RAM (GiB-hour) |
| `costPerCpuCoreHourly` | unit price $/CPU-core-hour at baseline time |
| `costPerMemoryGibHourly` | unit price $/GiB-hour at baseline time |
| `baselinePeriodStartTime / EndTime` | the window the factors were measured over; **projection (and savings) only starts after EndTime — inside the window projected = actual, savings = 0** |
| `baselineType` | how the factors were obtained — *the topic of this doc* |
| `updateTime` | last (re)compute of the baseline |

Projection per day (after baseline end):
```
projected = max(originalRequest, currentRequest) × factor × max(currentPrice, baselinePrice)
savings   = projected − actual
```
*(Docs/skill semantics use max() on both price and demand. Observed Siemens data reproduces exactly with **current-only** pricing — flagged as engineer question #2 in VERIFICATION-AND-SCENARIOS.md.)*

---

## 2. The selection waterfall

CAST AI picks the **first** method that has sufficient data, in this order:

```
┌─────────────────────────────┐  cluster has ≥7 days of own history between
│ 1. CLUSTER_HISTORY          │  initial connection and CAST AI taking over
│    (most defensible)        │  active node management (>20% of nodes managed)
└──────────────┬──────────────┘
               │ insufficient own history ── but org has clusters WITH
               ▼                              valid cluster-history baselines
┌─────────────────────────────┐  factors & unit prices = AVERAGE OF THE
│ 2. PEER_CLUSTERS            │  eligible peer clusters' baselines
└──────────────┬──────────────┘
               │ no usable own history, no eligible peers
               ▼
┌─────────────────────────────┐  CAST AI fleet-wide empirical averages
│ 3. INDUSTRY_AVERAGE         │  (least cluster-specific)
└─────────────────────────────┘

Special labels: **Overridden** — a CAST AI rep manually set factors or recalculated
over a custom range (frozen thereafter). **No baseline** — cluster is <14 days old
or not actively managed → realized savings stay 0 (cluster may vanish from the report).
```

Once selected, **the baseline is frozen** — it does not silently re-measure when workload shape changes. Only CAST's recompute cadence or a manual override updates it. *This is why a baseline can go stale: the factors describe the cluster as it was, not as it is.*

---

## 3. The three types in the Siemens fleet (verified live data)

| | `CLUSTER_HISTORY` | `PEER_CLUSTERS` | `INDUSTRY_AVERAGE` | *no baseline (404)* |
|---|---:|---:|---:|---:|
| Clusters | 28 | 15 | 14 | 14 |
| CPU factor min / median / max | 1.42 / 3.01 / **58.29** | 1.58 / 2.43 / **21.56** | 1.81 / 2.18 / **169.58** | — |
| RAM factor min / median / max | 1.35 / 3.34 / **87.50** | 2.06 / 4.64 / **29.95** | 2.24 / 2.57 / **35.44** | — |
| Baseline ended before 2026-07-31 | 20/28 | 14/15 | 8/14 | — |
| Savings claim rests on… | cluster's **own pre-CAST habit** | habits of **sibling clusters** | a **fleet-wide assumption** | *nothing enumerated* |

**Type-2/3 examples with digits** (why scrutiny matters):
- `alliander-demo-eks` — PEER_CLUSTERS, factors **×5.45 CPU / ×10.44 RAM**, cluster never had a CAST operation → $10.2k September "savings".
- `SI B SW fgeks-blue-eks-cluster` (several duplicates) — PEER_CLUSTERS up to **×21.6 / ×30.0**.
- `SMO Railigent k8s-andreas` / `CASE shining-star` — INDUSTRY_AVERAGE **×169.6 / ×35.4**.
- 14 clusters (incl. SMO Railigent `k8s`) return **404** — no baseline record at all, yet some still appear in the Value-Realization report.

---

## 4. Can leadership defend each type? — the honest table

| Type | What it defensible as | What it is NOT | Guidance |
|---|---|---|---|
| **CLUSTER_HISTORY** (recent end, sane factors ≤ ~3) | "We measured how THIS cluster over-provisioned before CAST took over management, froze it, and compare against today's demand at today's prices." | A forecast; a demand model | ✅ **Headline tier. Only type where "paid €X/vCPU before, €Y/vCPU after" is literally true.** (e.g. ngm-helios-eks ×1.60/×2.17, window 2025-09-30→2026-07-20, takeover coincides.) |
| **CLUSTER_HISTORY** (stale end or factors > 4) | "CAST's own measurement of the cluster's history — but the workload shape CHANGED after the measurement window closed." | Evidence of *casting actual money* saved recently | ⚠️ Keep visible, flag; do not headline. (`ngm-sim-eks` ×3.84/×7.88, ended 2026-06-03 → 4.9× savings-on-actual; `SI B SW fgeks-blue` ×17.4–58.3/×87.5.) |
| **PEER_CLUSTERS** | "No own history — so we applied the measured behavior of comparable Siemens clusters." | The cluster's own habit; it can import an unrelated fleet's overprovisioning profile | ⚠️ Acceptable for exploratory estimates; **not for a number Mark signs off on.** (Question for CAST: which peers, and why imported factors up to ×21.6?) |
| **INDUSTRY_AVERAGE** | "A market-typical assumption until the cluster proves otherwise." | Anything measured — its failure mode is extreme on unusual clusters (×169) | ❌ Exclude from headline; keep for context only. |
| **No baseline (404)** | — | Savings cannot legitimately exist, yet VR showed $158.7k on SMO Railigent | ❌ Exclude (already the meeting's Karpenter decision). |

**Defensibility rule of thumb for the report:**
> A savings row is defensible iff the baseline is `CLUSTER_HISTORY`, the window end is *plausibly close* to the period being reported (weeks, not quarters), factors sit in the sane band (≤ ~3), and the cluster's `firstOperationAt` lies **inside** the baseline window (evidence CAST actually took over there).

---

## 5. Attack lines & answers

**"Why is savings bigger than spend?"** → demand grew after the baseline froze; the ×factor multiplies the bigger demand (sim: ×3.84 × grown demand). Not a bug in arithmetic — an artifact of a stale-but-frozen baseline. Answer with the type table + staleness.

**"Can we trust PEER_CLUSTERS if org averages differ wildly?"** → no: peers import EO habits (×5.45 on alliander; ×21.6 on SI B SW blues). Use only as provisional metrics, never signed numbers.

**"Did we double-count workload autoscaling?"** → no — WAS savings are an explanatory component only; report total = projected − actual; never stack `realized + workload_autoscaler`.

**"Inside the baseline window there should be no savings."** → check `projected == actual` rows (Pillar#1: baseline end inside September ⇒ savings 0 by construction).

---

## 6. APIs & evidence

- `GET /v1/organizations/{org}` — org inventory (130 orgs; key must send `X-CastAI-Organization-Id` for org-scoped reporting calls).
- `POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport` — VR report items carry `clusterId, clusterName, baselineType, baselinePeriodStart/EndTime, cost{actualCost, projectedCost, totalSavings, ...}`.
- `GET /reporting/v1beta/organizations/{org}/clusters/{cid}/baseline-params` — factors, unit prices, window, type, updateTime. **404 = no baseline record** (≈ the Karpenter/enterprise-mode fleet here).
- `GET /v1/kubernetes/external-clusters` — `isPhase2`, `firstOperationAt`, `managedBy`, `status` (classification markers).
- Raw evidence: `enterprise/verify/bp_*.json` (57 baseline records), inventory `enterprise/inv_*.json`, merged view `enterprise/verify/verification_full.csv`, workbook sheet **Baseline & onboarding**.

Sources: CAST AI docs — *Realized savings* (docs.cast.ai/docs/savings-report), savings-calculation semantics (`cast-ai-savings-calculations` skill), and the Siemens live pulls of 2026-10-12.
