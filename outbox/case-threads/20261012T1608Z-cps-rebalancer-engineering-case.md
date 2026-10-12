# Engineering case — paste-ready (DRAFT for Ebrahim to submit to CAST AI engineering)

**Title:** [Siemens CPS / dema-platform-services] On-demand rebalance plan selects ~1.78x-pricier c8in.large beside identical-shape c5a.large, plus Flex in spot-off cluster — need node-selection rationale

**Severity:** Low / advisory — blocks customer trust to enable node autoscaling on production EKS.

## Environment

- Org: Siemens **CPS** `5e413e89-eb67-48fb-b81c-6172baa988ed`
- Cluster: **dema-platform-services** `5dc3bf31-a263-4c6b-88bb-e95b6403aa51`
- EKS, eu-central-1, k8s 1.35, managed-by terraform/9.2.2, agent online, cluster ready
- Cluster policies (public API, verified 2026-10-12): `enabled=false`, `isScopedMode=false`, `spotInstances.enabled=false`, nodeDownscaler/evictor off, no rebalancing schedule/minSavings configured
- Current nodes (verified): 61× t3a.xlarge on-demand + 5× r8id.4xlarge on-demand ≈ $15.34/h
- Node templates (verified via `GET /v1/kubernetes/clusters/{id}/node-templates`): single non-default template **turbo** (`instanceFamilies.include=["r8id"]`, spot=false/onDemand=true, label+NoSchedule taint `siemens.com/node-type=turbo`). Default node configuration carries **no constraints** server-side.

## Observation

In the console rebalance view
`https://console.eu.cast.ai/automation/external-clusters/5dc3bf31-a263-4c6b-88bb-e95b6403aa51/rebalance/list/log?org=5e413e89-eb67-48fb-b81c-6172baa988ed`
the optimized configuration shows a wide mix of families/generations and, in the same plan, two nodes of identical shape at nearly 2x price:

- `c8in.large` 2 vCPU / 4 GiB — displayed $0.047 (per-vCPU hourly) and $67.91/mo (= $0.0930 node hourly × 730)
- `c5a.large` 2 vCPU / 4 GiB — displayed $0.026 (per-vCPU hourly) and $38.13/mo (= $0.0522 node hourly × 730)

Plan IDs generated while the customer reviewed this (all later `error/canceledByUser` — never executed):

- `106f0905-0fcc-4c4b-afa8-ae7c32d29c62` generated 2026-10-12T08:28:57Z *(11:28 local)* [reviewed 2026-10-12T11:28:57Z UTC]
- `5e132d41-d02e-4030-a6f7-d2ea9fe498a3` generated 2026-10-12T11:42:09Z UTC
- `5ada1f8b-00f7-4c6e-8589-0bd16231b69f` generated 2026-10-12T12:14:08Z UTC (replaceableNodes=47/66)
- Earlier related plans: `c15d34a9-…` 2026-10-12T08:46Z; three on 2026-10-09; one on 2026-10-08

Screenshot of the console plan with the c8in/c5a pair is attached by the customer-facing engineer (Ebrahim). Note: per-node plan configurations are **not exposed** via public API (`rebalancing-plans/{id}` returns `configurations=null`; `/configurations|/diff|/summary|/events` 404), so we could not independently re-pull the exact node list — the console view is the source.

## What we verified is NOT the cause (to save eng time)

1. **Not spot vs spot-fallback mixing** — spot is disabled cluster-wide (`spotInstances.enabled=false`); AWS us-east-1 spot price ratio (~1.16) doesn't match the observed 1.78 ratio.
2. **Not a CAST AI pricing error** — the two displayed prices decode to discounted on-demand node node rates ($0.0930 vs $0.0522 hourly); their ratio 1.781 ≈ AWS on-demand list ratio c8in.large $0.13608 / c5a.large $0.077 = 1.767 ([vantage c8in.large](https://instances.vantage.sh/aws/ec2/c8in.large), [vantage c5a.large](https://instances.vantage.sh/aws/ec2/c5a.large)). The "network-optimized" premium on c8in (Intel Granite Rapids, up to 25 Gbps; c5a = AMD EPYC up to 10 Gbps) is real AWS pricing.
3. **Not an availability-region artifact** — c8in is listed for EU (Frankfurt); introduced 2026-04-16, current generation.

## Questions for engineering

1. **Selection rationale:** Why does the optimizer include 1× c8in.large when 1× c5a.large (same vCPU/RAM, ~44% cheaper at observed discounted rates, same plan) would cover the same shape? Which driver applied — per-AZ capacity/quota, commitment coverage, template×AZ slotting, or something else (possible candidate-set bug)?
2. **Flex instances with Spot disabled:** The plan shows Flex-typed nodes although the cluster has spot off. Which setting gates Flex (`flex_instances_enabled`) for this org/cluster, and is it on? Customer perception: "why a Flex instance, we didn't enable Spot."
3. **Constraints source of truth:** Customer believes a ~13-instance-type allow-list is configured on the "main" node template, but public API shows no constraints on the default configuration and only the `turbo` (r8id) template. Where is the effective candidate set the rebalancer used for these plans recorded (node template vs autoscaler policy vs console-only simulation state)?
4. **Reproducibility:** Can you share the plan-generation debug snapshot (candidate input set + chosen nodes + reasons) for plan `5ada1f8b-00f7-4c6e-8589-0bd16231b69f`? That would let us give Siemens a transparent answer instead of "black magic". Their ask: at least "we chose Flex/Flex-type because …" level of reasoning in the future.

## Customer context (why this matters)

Siemens CPS is about to enable node autoscaling on a production multi-tenant cluster (68→~8 nodes idealized in Available Savings; realistic plan replaces 47/66). They are hesitant because the plan mix looks "random"; a documented-selection answer + recommended constraints (or a fix) unblocks the rollout. Turbo (r8id NVMe) group stays excluded from the initial rebalance due to an init script dependency. Full analysis: repo `.kimchi/docs/2026-10-12-cps-rebalancer-node-diversity.md`.

— Prepared by Ebrahim Ramadan (CAST AI), 2026-10-12. DRAFT — review channel/targets before submitting.
