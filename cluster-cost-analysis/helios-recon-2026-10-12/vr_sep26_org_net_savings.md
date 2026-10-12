# SI GSW CLO — org net savings, September 2026 (VR basis + CAST AI fees @ $5.00 and $5.70/vCPU)

**Basis:** Value-Realization per-cluster report (`POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport`), Sep window Europe/Berlin, discounted prices (console parity) · fees = billable (provisioned) vCPU × **$5.00** and × **$5.70** applied directly in USD (no FX) · identification per Siemens schema `cluster_id = cluster_name#aws_account_id#region`. All data pulled live 2026-10-12 from `api.eu.cast.ai`.
⚠ If the contract quotes the rate in **EUR** (fee-corrections doc says €5 vs €5.70), USD fees are ×~1.15 — see note 6.

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ngm-helios-eks | ngm-helios-eks#600442974479#eu-central-1 | `419c39e4-66bf-4d61-b833-4562968a61c7` | eu-central-1 | 45,121 | 51,790 | 6,668 | 1,850.51 | 9,252.56 | 10,547.91 | **−2,584** ⚠ | **−3,880** ⚠ |
| ngm-integ-eks | ngm-integ-eks#600442974479#eu-central-1 | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` | eu-central-1 | 22,031 | 30,739 | 8,708 | 1,049.91 | 5,249.57 | 5,984.52 | **+3,458** | **+2,723** |
| ngm-sim-eks | ngm-sim-eks#894875834901#eu-central-1 | `51dd234c-a5bf-4f99-a884-b79956de8f94` | eu-central-1 | 8,051 | 47,377 | 39,326 | 359.20 | 1,795.98 | 2,047.41 | **+37,530** | **+37,278** |
| alliander-demo-eks | alliander-demo-eks#721233634880#eu-central-1 | `c686f800-f17f-4b9a-8b7e-7655f209e07f` | eu-central-1 | 3,744 | 13,923 | 10,178 | — ¹ | — | — | **+10,178** | **+10,178** |
| baseline-clo-eks | baseline-clo-eks#110201440604#eu-central-1 | `02810f4b-b793-4ef2-95f1-e902af61d9e3` | eu-central-1 | 2,542 | 21,639 | 19,096 | 114.79 | 573.96 | 654.32 | **+18,522** | **+18,442** |
| ngm-sim2-eks | ngm-sim2-eks#894875834901#eu-central-1 | `8bd361b0-fcbf-491d-beac-af92fb7d6b46` | eu-central-1 | 2,047 | 11,625 | 9,578 | 67.22 | 336.08 | 383.13 | **+9,242** | **+9,195** |
| ngm-kronos-eks | ngm-kronos-eks#600442974479#eu-central-1 | `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` | eu-central-1 | 1,939 | 7,330 | 5,391 | 89.69 | 448.43 | 511.21 | **+4,942** | **+4,879** |
| ngm-data-eks | ngm-data-eks#595960695089#eu-south-1 | `9b9d2d51-ec75-46d4-bac0-ba38253cb8d9` | eu-south-1 | 1,103 | 776 | −327 ⚠ | — ¹ | — | — | **−327** | **−327** |
| **Σ ORG (8 clusters)** | | | | **86,578** | **185,196** | **98,618** | **3,531.32** | **17,656.58** | **20,128.50** | **+80,962** | **+78,490** |

**Read:** org September is net-positive under both rates (**+$80,962 @ $5.00 · +$78,490 @ $5.70**); fee consumes 17.9–20.4% of gross savings; VR-basis savings rate 53.3%.

## Notes / open items

1. **No billing usage under phase2** for alliander-demo-eks and ngm-data-eks → no fee line shown. Confirm with Finance whether they are contractually billed elsewhere; if billed, subtract accordingly (ngm-data is net-negative regardless).
2. **woop attribution quirk:** the Sep `woop` billing detail attributes ~the same vCPU pool (3,416.65 vs 3,531.32). If the contract invoices **both** feature lines, fees ~double (≈$40.1k @5.00) and org net ≈ **+$58.5k** — still positive. Finance to confirm one fee line vs two.
3. **ngm-helios-eks is net-negative on this conservative VR basis at both rates** (−$2,584 / −$3,880) — the frozen 2026-07-20 baseline caps its gross at a 14.8% savings rate while it carries 52% of the org fee base. On the classic gross basis Helios nets **+$9,625 @5.00 / +$8,330 @5.70**. Baseline-refresh ask to CAST AI (Marko/Ahmed) is the structural fix. Don't quote Helios net in isolation — quote the portfolio.
4. **Account spread (per live cluster inventory):** helios/integ/kronos → 600442974479 · sim/sim2 → 894875834901 · baseline-clo → 110201440604 · alliander → 721233634880 · data → 595960695089 (**eu-south-1**, not eu-central-1). ngm-sim3-eks (894875834901) exists but has no VR savings row and no billing — excluded.
5. **Billing finalization:** live Sep billing (Helios 1,850.51 vCPU) is +3.6% vs the 2026-10-04 verification (1,786.38) — reconcile with Finance.
6. **Currency caveat:** rates applied as USD per instruction. If the contract is EUR (€5/€5.70), USD fee = vCPU × rate × FX (~1.15) → org net **+$78,313 @€5 / +$75,470 @€5.70**; Helios net **−$3,972 / −$4,864**.
7. Fee basis = provisioned vCPU → self-shrinking as the autoscaler removes nodes; Helios rebalancing (9% utilization) cuts both the savings gap and the fee base.
8. **Do not mix bases:** this table is VR-basis throughout. Classic-basis portfolio (Helios+Integ+Kronos): gross $40,696 − fee $17,193 @5.00 (USD direct) = **+$23,503** net.

## Provenance (all read-only, api.eu.cast.ai, 2026-10-12)

- VR per-cluster (Sep, Berlin): `vr_sep26_berlin_all_clusters.json` — POST `…/clusters:runValueRealizationReport?startTime=2026-08-31T22:00:00Z&endTime=2026-09-30T22:00:00Z&timeZone=Europe/Berlin` (doc: docs.cast.ai/reference/valuerealizationapi_runclustersvaluerealizationreport)
- Billing phase2: `billing_phase2_sep26_live.json` — GET `/v1/billing/platform-usage-detail?period.from=2026-09-01&period.to=2026-10-01&feature=phase2`
- Billing woop: `billing_woop_sep26_live.json` · Cluster inventory/accounts: `external_clusters_live.json` — GET `/v1/kubernetes/external-clusters`
- Fee model: `outbox/case-threads/20261004T080929Z-report-fee-corrections.md` · CSV: `vr_sep26_org_net_savings.csv`
