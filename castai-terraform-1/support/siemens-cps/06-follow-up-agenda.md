# 06 — Follow-up Session Agenda (next week)

**Suggested length:** 45 min · **Attendees:** Ebrahim (Cast AI) + Siemens CPS team

1. **T3a availability status** (5 min)
   - Ticket reference + root cause (burstable flag / constraints / blocklist).
   - Walk through the corrected template in the console; confirm available-instances count.
   - Agree the T3a-first scheduling order before expanding families.
2. **Savings Plan / RI strategy deep-dive** (10 min)
   - Confirm Siemens' commitments shape (3-year SP vs. centrally managed RIs).
   - Reiterate: Savings Plans (Compute SP) apply across instance families, so Cast AI family
     switching doesn't forfeit coverage; RI *allocation* across scopes is AWS-side
     non-deterministic — no vendor can guarantee attribution.
   - Show discounted-price cost reporting already wired (cluster / workload / namespace level).
3. **Workload autoscaler rollout plan** (10 min)
   - Enable cluster-wide with **keep existing resource limits**; requests-only optimization.
   - Deferred mode for StatefulSets / single-replica workloads.
   - Recap the earlier incident cause (requests > limits ⇒ enforced-limit restarts) and the guard
     that prevents it; 1-week observation window; OpsPilot-generated scaling policies → Terraform.
   - Reference: current cluster already optimized from 500 vCPU / 2 TB → 318 vCPU.
   - Billing reminder: per-vCPU pricing applies regardless of per-workload opt-in state.
4. **CLM + rebalancing demo** (15 min) — run with
   [04-clm-rebalancing-demo-runbook.md](04-clm-rebalancing-demo-runbook.md) on the test cluster.
5. **DBO + open items** (5 min)
   - Contract-inclusion answer (see 05). MySQL now supported; MSSQL not yet.
   - Their D2 review status and what documentation we supplied.
   - Product feedback to relay: Network Intelligence filter-expression field names not in UI and no
     validation errors; OpsPilot weak on network-intelligence queries.
6. **Spot pilot** (remaining time)
   - Walk the shared config doc ([03-spot-workload-configuration.md](03-spot-workload-configuration.md)):
     correct label `scheduling.cast.ai/spot`, distribution percentage for 50/50, fallback mechanics.
   - Decide namespaces for the pilot once node autoscaler approval follows the RI/SP clarification.

## Follow-up email draft skeleton

> Thanks for today's session. Action items on our side: T3a template investigation (support ticket
> [REF] filed, CC'ing you), Database Optimizer contract check, spot scheduling documentation
> (attached), and a CLM/rebalancing demo — proposal: [2 slots] for the follow-up next week. Notes
> and materials linked here: [link].
