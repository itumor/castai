# CFR-1536 — short reply to Ahmed & Guy (v2, Granola-verified 2026-10-12)

**Draft only — a human reviews and posts.** Same shape/voice as the original Ahmed/Guy
draft, with all claims cross-checked against Granola (13 notes / 8 transcripts),
live API (2026-10-12), and Jira/Confluence. The fabricated/unverifiable lines from
the original were removed or rewritten — see the long version's change table
(cfr-1536-reply-theodor-final-2026-10-12.md) for the full audit trail.

---

## Paste-ready text

hey @Ahmed Khaldi @Guy Faigenboim — adding context from our Siemens sessions (cross-checked the notes today):

**The ask isn't "add a new hierarchy level."** The direction discussed was to avoid a new org layer. The proposal is three pieces:

1. **Mandatory BU tag on each child org** (DI, SI, SMO…) — a property with admin-defined values, not a structural change.
2. **User groups scoped by BU tag** — FinOps champions get a group covering all child orgs tagged with their BU. Target shape is read-only over the cost surface (worth confirming the role covers discounted costs — the 5 Oct note needed Super Enterprise Admin for that).
3. **Auto-assignment rule** — new child org created with the right BU tag joins the group automatically. That's what prevents manual overhead at scale.

**Why custom roles alone don't solve it:** the problem isn't *what* access people get — it's *which child orgs*, at a scale nobody maintains by hand. Verified today: **126 child orgs, ~240 clusters onboarded of a ~1,000-cluster estate, 71 new child orgs in Aug+Sep alone.** No one at Siemens can track which org is which BU, and the count moves ~35/month. A custom role still needs per-org assignments across dozens of orgs per BU, forever. The tag is what makes the grouping machine-readable.

**On "Siemens-only":** fair on cost, but org metadata + rule-based scoping is generic — CID-196 names BMW and Deloitte wanting BU self-service, and NASDAQ's 800-account BU cost allocation (CFR-480) shipped via tags, not hierarchy. Siemens is just first to the wall at this scale.

**What's blocking today:** the FinOps-champion rollout. Access is currently manual and over-exposed — e.g. 28 Sep, Christoph had to grant two vLab cluster engineers **temporary** owner-level access to the full org just to unblock onboarding (plan to scope down). Same pattern repeats per champion until the grouping exists.

One flag: this was reportedly accepted in principle already (2 Oct session, ETA "weeks not days") — worth confirming against the in-flight BEU hierarchy/merge work before scoping fresh.

---

## Verification ledger (what each claim rests on)

| Claim | Source | Status |
|---|---|---|
| No new org layer is the direction | Granola: internal sync 10 Aug ("map BUs to organizations, no need for nested sub-orgs") | ✅ confirmed |
| 126 orgs / ~240 clusters / 71 new Aug+Sep | live read-only GET /v1/organizations, 2026-10-12 | ✅ verified (not from Granola — notes quote ~60 Aug / ~160 Sep 18; projection 600–1,000) |
| 28 Sep Vijay/Paras temporary owner grant (vLab engineers) | Granola: "Cast AI Follow Up Session #1", 28 Sep | ✅ verbatim |
| Super Enterprise Admin needed for discount visibility | Granola: discounts note, 5 Oct | ✅ |
| CID-196 BMW/Deloitte; CFR-480 NASDAQ tags | Jira via twg | ✅ |
| Accepted in principle, "weeks not days"; BEU merge in flight | Granola: 2 Oct session; 17 Aug onboarding note | ✅ (informal acceptance — confirm) |
