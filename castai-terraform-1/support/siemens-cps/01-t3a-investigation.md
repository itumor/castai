# 01 — T3a Node Template: Zero Available Instances

**Symptom** (Siemens CPS, EKS, EU): node template restricted to the **T3a family** shows
**0 available instance types**. The **Turbo** template (higher CPU/RAM) shows **13**.
Console: <https://console.eu.cast.ai/automation/external-clusters/5dc3bf31-a263-4c6b-88bb-e95b6403aa51/autoscaler/settings/node-templates?org=5e413e89-eb67-48fb-b81c-6172baa988ed>

## Why this matters (business context)

- Siemens holds heavy central discounts on T-family (up to 80% RI/Savings-Plan discount), so T3a
  is deliberately the preferred family for the general-purpose pool.
- Zero available types ⇒ Cast AI autoscaling can never place a T3a node ⇒ the template is dead weight
  and the agreed "T3a-first" scheduling strategy can't start.

## Ranked root-cause hypotheses

The console's available-instance inventory is the set of cloud instance types that pass **all**
template constraints *and* the org/cluster blocklist. Every member of T3a is **burstable**,
**x86_64**, **no local NVMe**, **no GPU**, and tops out at **t3a.2xlarge (8 vCPU / 32 GiB)**.
Anything below that collides with one of those properties yields exactly "0":

1. **H1 — "Burstable instances" constraint left disabled (most likely).**
   Node templates carry a dedicated *Burstable instances* inclusion flag
   ([docs](https://docs.cast.ai/docs/node-templates#apply-instance-constraints)). If the template
   restricts `Instance Family = t3a` but the burstable flag is off, **every** candidate is filtered:
   result = 0. Turbo still shows 13 because its 13 matches are non-burstable lines.
   **Verify:** template JSON: `constraints.taskType` / burstable flag value via diag script.
2. **H2 — Min CPU/MEM above the T3a ceiling.** Template copied from Turbo with e.g.
   `minCpu ≥ 16` or `minMem ≥ 64 GiB` ⇒ no t3a (max 8 vCPU/32 GiB) qualifies ⇒ 0.
3. **H3 — A single hard flag excludes the entire family**: GPU-enabled, storage-optimized
   (local SSD), compute-optimized, or a bare-metal constraint.
4. **H4 — Blocklist entry** for `t3*` at org or cluster level (blacklist API used earlier, per
   [spot docs troubleshooting](https://docs.cast.ai/docs/spot#general)).
5. **H5 — Spot-only template with zero T3a spot inventory** in the cluster region — possible but
   less consistent with the console showing *types*, not capacity. (AWS quota exhaustion on T3a
   would usually grey out, not zero out, the listing.)

Notable non-cause: AZ/subnet scoping — documented to move *placement*, not to empty the type list.

## How to verify (5 end-to-end minutes)

```bash
export CASTAI_API_KEY=<EU key, org scope or equivalent>   # console.eu.cast.ai => EU key
./scripts/siemens-t3a-diag.sh
```

The script (read-only) fetches every template for cluster
`5dc3bf31-…ba…` from `api.eu.cast.ai`, prints each template's full `constraints` block, then calls
the available-instance-types preview per template and prints the resulting counts. Raw JSON is kept
in `/tmp/siemens-t3a-diag/` for evidence — **attach it to the ticket**.

Field mapping to hypotheses:

| Evidence field | -> Hypothesis |
|---|---|
| burstable-instances flag = off/absent while family t3a | H1 (fix: enable it) |
| `minCpu > 8` or `minMem > 32` | H2 |
| `gpuEnabled`/storage-optimized/compute-optimized = true | H3 |
| org/cluster blocklist API lists t3* | H4 |
| template `spotOnly=true` and preview also = 0 for on-demand | H5 |

## If the customer can check right now in the UI

Node template → *Apply Instance constraints*: look for **"Burstable instances"** toggled off and for
any **Min CPU/MEM** values crossing the t3a.2xlarge ceiling. Enabling burstable inclusion is the
single most probable one-click fix.

## Recommendation sequence (aligned with customer preference)

1. Confirm/fix T3a template (H1–H3 are template-local; no product change needed).
2. Keep T3a as the **entry-point family** for node scheduling as agreed in the meeting
   (top priority tier), expand families only after it schedules successfully.
3. Then revisit blocklist/quota if the count is still 0 after the flag is on.

> NOTE: live verification is scripted but was **not executed in this session** — no EU
> `CASTAI_API_KEY` with this org's scope was available on the machine. Run the script, paste the
> constraints JSON into `02-support-ticket-t3a-draft.md`, then file it.
