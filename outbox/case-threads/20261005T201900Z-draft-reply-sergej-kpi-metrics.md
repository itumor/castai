# DRAFT — NOT SENT. Human reviews and sends.
# To: Sergej Petrovski <sergej.petrovski@siemens.com>
# Subject: Re: Optimisation KPI of onboarded Clusters
# In reply to: Mail.app message id 8841 (2026-10-05 14:23)

Hello Sergej,

thank you for the invite — I've accepted and will join the Teams call.

You raise the right point: the optimization score alone does not tell us
whether a cluster is well optimized, and Guy is also right that many clusters
have limited headroom. To make the discussion concrete, I suggest we align on
a small set of metrics we can report per onboarded cluster:

1. **Score + achievable headroom together** — current optimization score
   paired with the *available savings* ($/month, computed at list unit
   prices). A low score with near-zero available savings means "nothing more
   to do", not "badly optimized".
2. **Automation coverage** — share of CAST AI-managed nodes (the >20%
   threshold that gates node-level savings) and share of workloads with
   Workload Autoscaler active (VPA mode). This separates "not onboarded
   properly" from "onboarded but constrained".
3. **Constraint inventory per cluster** — the concrete reasons a cluster
   cannot be optimized further: PDBs, do-not-disrupt annotations,
   commitment/RI/EDP coverage, Windows/stateful/non-movable workloads. This
   turns "cannot be optimized" into an auditable list.
4. **Realized savings (baseline methodology)** — measured at list unit
   prices, reported separately from available savings so past results and
   future potential never mix.

For notifications, I propose: automation events (scale-ups, evictions/blocked
scale-downs, spot interruptions, rebalancing) via webhook, plus a scheduled
monthly savings/cost summary per org.

Unless you prefer otherwise, I'll bring a first per-cluster matrix along
these metrics to the call and we refine from there.

Thanks,
Ebrahim
