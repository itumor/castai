# DRAFT ONLY — human posts. Thread: "5.5k daily saving on a ~$55/day cluster"

Found it. The cluster is **k8s-andreas** (SMO Railigent X). Nothing is wrong with its cost
data, and **WOOP is not the cause** — verified live just now:

- Its realized-savings baseline is **INDUSTRY_AVERAGE** measured over a **24-hour window**
  (2026-04-15 → 2026-04-16), which froze an overprovisioning factor of **169.58× CPU / 35.44× RAM**.
- Console math: projected = demand × 169.58 × $0.0294/core-h. Live numbers (Oct 5–12):
  actual **$185** (≈$26.5/day) vs projected **$33,867** → reported savings **$33,682/week ≈
  $4.8k/day** — the "5.5k daily" figure. That is ~180× the real spend, so yes, it's fictional,
  Ahmed is right.
- WOOP check for Guy: requests went **down** (CPU 28.6→9.5 cores, RAM 99→55 GiB, 79/88
  workloads optimized). WOOP's own savings line is just $19/day. Overprovisioning AFTER CAST is
  57.3/18.6 ≈ **3.1× CPU** — vs the model's assumed 169.6× BEFORE. A real 169× factor would mean
  ~3,150 provisioned cores for an 18.6-core workload; impossible on a $55/day bill.
- Extra wrinkle: the cluster's node autoscaler now reads `read-only` (classic savings API 400s),
  yet the Value-Realization report **still accrues savings against the stale April baseline** —
  so the phantom figure keeps growing with the engine off.

Action: ask CAST AI to **recalculate/override this cluster's baseline** (their documented
"Overridden" path — custom/real CLUSTER_HISTORY window, realistic 2–4× factor). Until then,
exclude k8s-andreas from savings roll-ups (~$144k/month phantom). Fleet sweep today across all
orgs shows no other cluster at this magnitude; the only other savings>spend cases
(eks-Cluster1 ×2, kronos, pfm) are small and CLUSTER_HISTORY-based.

Re Manav's "explanation skill": we already have the bones — baseline-type + factor from
`baseline-params`, then compare against actual spend. Happy to productize it.

Evidence: live API pulls 2026-10-12 ~21:45 (read-only), saved in
`.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md` +
`scratch/savings-anomaly-hunt-2026-10-12/`.
