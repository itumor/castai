# SI GSW ngm Cost Case

Case: Siemens SI GSW CLO R&D clusters `ngm-helios-eks` and `ngm-integ-eks` —
"why are CAST AI costs so high on our dynamic clusters" (Gerolf Reinwardt
thread, data from August 2026). Analyzed 2026-10-02 with verified read-only
EU API pulls; workshop prep lives in `labs/si-gsw-sep30-meeting/`.

## Identifiers

| What | Value |
|---|---|
| Org | SI GSW CLO — `07aa3c29-3e1f-44bc-ad60-ceedb878d99a` |
| ngm-helios-eks | `419c39e4-66bf-4d61-b833-4562968a61c7` (first CAST op 2026-07-20) |
| ngm-integ-eks | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` (first CAST op 2026-04-27) |
| AWS account / region | `600442974479`, eu-central-1, EKS, k8s 1.34, terraform 9.2.1 |
| Phase | Both `isPhase2: true` (autoscaler mode), agents online |

Enterprise key needed: the default MCP key sees **0 clusters** here; the
billing-export key with header `X-CastAI-Organization-Id` sees them
(see [[API Keys & Regions]]). Auth = `X-API-Key` + `X-CastAI-Organization-Id`.

## Durable learnings (billing methodology)

1. **Billable CPU = time-weighted average provisioned vCPU per month.**
   One billable CPU = one provisioned CPU running the full month; sampled at
   intervals, day-average ÷ days-in-month, summed. Verified numerically:
   Gerolf's "Billable CPUs (CAST)" 1806 / 876 are exactly the API's
   *avg provisioned vCPU (month)* for helios / integ.
2. Billing counts **provisioned node capacity** — not pod requests, not
   utilization. On-demand and spot count the same. All org clusters count
   (including test clusters).
3. Both features (Node Autoscaler `phase2`, Workload Autoscaler `woop`)
   report the same usage figure; whether they are charged separately or
   bundled is a **contract question**, not a docs question.
4. Fee math: avg-provisioned × contract rate (SI: €5/CPU/mo) →
   helios ≈ €9.0k, integ ≈ €4.4k. The lever is shrinking provisioned vCPU,
   not disputing the rate.

## What is actually wrong (August 2026, API-verified)

- **0% spot** on both clusters; autoscaler `enabled` but 0 node templates
  (pure defaults).
- **Workload autoscaling recommendation-only**: 0 of ~3,598 workloads
  optimized — no measured "after" exists; do not claim measured before/after.
- **Massive over-request**: helios ~2,277 cores requested vs ~454
  recommended (~1,823 vCPU excess, utilization 5.27%). Waste dominated by
  dev teams' own Helm charts in `siemens-digital-grid-*` namespaces
  (gmbd, cqa2, mil2).
- Upsize list matters too: kube-proxy / filebeat / datadog / efs-csi-node
  under-provisioned on 211 nodes — right-sizing protects reliability.
- CAST **already saves ~$40k/mo** via downscaling (helios $19.6k ≈ 30% vs
  static, integ $20.7k ≈ 51%). FinOps $27k/$12.5k sit below CAST list
  compute ($55.7k/$22.8k full; $27.9k/$13.2k CPU-only) → consistent with
  Siemens AWS RI/Savings-Plan discounts; needs their rate card to reconcile.
- Optimization still on the table: helios $68.2k → $20.3k run-rate (spot
  path −70%), integ $17.5k → $4.3k (−75%).

## Way of working agreed (on-prem driver)

Keep R&D in recommendation mode; devs fix their own Helm charts (git is
source of truth); CAST AI per-workload export is the worklist; apply mode
reserved for prod-like test (ngm-sim2) for measured before/after.

## Open items

- AWS rate card / RI coverage from SI FinOps (reconcile $27k vs $27.9k).
- FinOps SPOC/champion for the savings cockpit dashboard.
- Workshop dates; node-template/evictor tuning review; spot enablement plan
  (30–50% target on R&D).

## Tooling note (support swarm)

- Swarm run on the verbatim thread mis-triaged as `node_downscale` →
  verdict REJECT. Root cause: offline `HeuristicLlm` rule
  `/scal/i + /down|not scale|stuck/i` fires on "auto**scal**ing" +
  "shutdown" before the cost rule. Workaround: cost-focused thread rewrite
  → category `cost_reporting`, verdict PASS, confidence 50.
  Engine fix (not yet applied): tighten rule 1 to /\bscale|scal(e|ing) down\b/
  or reorder cost rule first. Case artifacts in
  `support/si-gsw-2026-10-ngm-cost-analysis/`.
- 2026-10-02 re-confirmation: verbatim run REJECT reproduced (org+cluster IDs
  parsed fine that time — `missingInfo: []`; the clarify draft re-asking for
  both IDs is the writer's empty-asks fallback, a wording quirk, not missing
  data). Trace also shows the KB researcher queries the customer's literal
  questions against the swarm's own `outbox/kb`, hits unrelated internal
  meta-docs, and curation prunes all 13 claims + evidence → 0 evidence-backed
  → REJECT ×3 loops. PASS re-confirmed on the rewrite thread; raw PASS draft
  leaks internal 404-probing lines — use `REPLY-draft-v3-2026-10-02.md`
  (enriched, docs.cast.ai links fetched 200) instead.
