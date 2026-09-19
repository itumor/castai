# 02 — Support Ticket Draft: T3a node template shows 0 available instances

> Ready to paste into the internal support flow; **CC the Siemens CPS contacts**.
> Attach the JSON evidence from `/tmp/siemens-t3a-diag/` after running
> `scripts/siemens-t3a-diag.sh` (fill the bracketed fields from its output).

---

**Subject:** Node template restricted to T3a family shows 0 available instance types (Siemens CPS, EKS, EU org)

**Priority:** High — customer blocked on agreed T3a-first rollout strategy

**Reporter:** Ebrahim Ramadan (Cast AI), on behalf of Siemens CPS team

**CC:** [Siemens CPS team members from meeting]

**Org ID:** `5e413e89-eb67-48fb-b81c-6172baa988ed`
**Cluster ID:** `5dc3bf31-a263-4c6b-88bb-e95b6403aa51` (AWS EKS)
**Console URL:** <https://console.eu.cast.ai/automation/external-clusters/5dc3bf31-a263-4c6b-88bb-e95b6403aa51/autoscaler/settings/node-templates?org=5e413e89-eb67-48fb-b81c-6172baa988ed>

## Summary

Siemens CPS runs an internal Kubernetes-as-a-Service platform (~100–150 namespaces, 110 nodes,
AWS EKS). Both production and test clusters are onboarded to Cast AI in autoscale mode.

The customer's **T3a node template** (their preferred family due to centrally negotiated RI/Savings
Plan discounts of up to 80%) shows **zero available instance types** in the console. The **Turbo**
node template on the same cluster shows **13 available instance types**. The T3a template therefore
cannot provision any nodes, blocking the customer-agreed plan to use T3a as the entry point for
node scheduling before expanding to other families.

## Expected behavior

A template constrained to `instance family = t3a` should list the t3a.* sizes eligible under the
remaining constraints (up to t3a.2xlarge, 8 vCPU / 32 GiB), comparable to the Turbo template's 13.

## Actual behavior

Available instance types = **0** for the T3a template only.

## What we checked / suspected root causes

Ranked hypotheses with evidence fields — see attached diagnostics for the template JSON:

1. **Burstable-instances inclusion flag disabled** while the family is restricted to t3a
   (t3a is burstable-only ⇒ complete exclusion ⇒ 0 types). Single most likely cause.
2. Min CPU/MEM constraints above the t3a ceiling (8 vCPU / 32 GiB).
3. GPU / storage-optimized / compute-optimized / bare-metal flag set, excluding all t3a.
4. Org- or cluster-level instance blocklist entry matching t3*.
5. Spot-only template with zero t3a spot inventory in region **[REGION — fill]**.

## Evidence

- Template constraints JSON: **[paste from `/tmp/siemens-t3a-diag/node-templates.json`]**
- Available-instance preview count per template: **[paste counts: T3a=0, Turbo=13]**
- Cluster region / node config: **[fill]**

## Ask

1. Confirm which constraint (or blocklist entry) is filtering the t3a family to zero.
2. If H1: confirm "Burstable instances" must be enabled in the template for t3a* — we will adjust
   with the customer and re-verify the instance inventory.
3. If a product-side bug (inventory starvation unrelated to constraints): fix or advise a workaround.

**Important customer context:** suit of centrally managed RIs + 3-year Savings Plans with heavy
discounts on T-family; limiting to one family is a conscious customer choice, so the T3a template
working correctly is the gating item for the next phase (workload autoscaler rollout + spot pilot).

---

*Filed by:* Ebrahim Ramadan · *Date:* [today]
