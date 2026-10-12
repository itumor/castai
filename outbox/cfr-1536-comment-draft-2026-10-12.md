# CFR-1536 comment — reviewed draft (2026-10-12)

**Draft only — a human reviews and posts.**
Review verdict: post-able. All structural claims and the Sergej quote match the verified state
(live read-only `GET /v1/organizations`, EU API, 2026-10-12 + pinned OpenAPI spec).
Four adjustments below; revised comment is paste-ready.

---

## Adjustments vs the original draft

1. **Cluster count (must-fix).** "~1,000 AWS clusters" is Siemens' *stated estate / design target*, not what's onboarded. Observed fleet: ~240 clusters (239 clusters / 129 orgs snapshot 2026-09-26; 230 on 2026-09-11). Wrong numbers in front of engineering cost credibility. Use: "~240 clusters onboarded today of a ~1,000-cluster estate."
2. **Add the strongest technical fact (strengthens Theodor thread).** The org object has **no** custom tag/property field today — only `id, name, createdAt, parentId, type, childOrderId, internal, flags` (pinned OpenAPI + live response). So this is net-new capability; answer the engineering-cost concern with a concrete scope list, framed as a generic mechanism, not a Siemens special.
3. **Add the growth stat that justifies auto-assignment.** 36 new child orgs in Aug, 35 in Sep (live `createdAt`) — 71 in two months. Backfill is one-time (~126 orgs ≈ ~130 API calls, trivial); the rule is the durable piece. Also: per-org user groups + role bindings APIs already exist — the missing pieces are (a) the org property and (b) rule-based bindings.
4. **Small accuracy/tone tweaks.** "Full org-level access" → "owner-level" (that's what the 28 Sep notes say, and it's the over-exposure point). Add one line that BU is visibility metadata only — enterprise discounts/contracts unchanged (pre-empts the predictable billing question). Soften the Kakao claim to a pattern statement unless there's a confirmed Kakao requirement.

---

## Paste-ready revised comment

Hey Theodor — adding context from our discussions with Siemens, plus what I verified against the live API today.

**The ask isn't "add a new hierarchy level."** The agreed direction from our call with Siemens (Bosko, Sergej, and others) was specifically to avoid a new org layer. Sergej's summary confirmed it directly: "There will be no change in organization structure, but remains Siemens at the top and all organizations below it." The proposal is three pieces:

1. **Mandatory BU tag on each child org** (DI, SI, SMO, …) — a property with admin-defined values, not a structural change.
2. **User groups scoped by BU tag** — FinOps champions get a group covering all child orgs tagged with their BU. The existing "Analyst" role (read-only cost visibility) already matches the requirement; Bosko confirmed this on the call.
3. **Auto-assignment rule** — a new child org created with the correct BU tag automatically joins the relevant group. This is the piece that prevents manual overhead at scale.

**Why custom roles alone don't solve it:** the problem isn't *what* access people get — it's *which child orgs* they get it for, at a scale nobody can maintain by hand. I verified the numbers this morning (read-only): **126 child orgs under the Siemens enterprise, ~240 clusters onboarded of a ~1,000-cluster estate, and 71 new child orgs created in Aug+Sep alone.** No one at Siemens can track which org belongs to which BU, and teams restructure every ~3 years. A custom role still requires someone to manually assign it across dozens of child orgs per BU and maintain those assignments. The BU tag is what makes the grouping discoverable and automatable.

**On engineering scope — concretely, what exists today:** per-org user groups and role bindings already exist and are scriptable (`/v1/organizations/{orgId}/groups`, `.../role-bindings`). What's missing is (a) **the org-level property itself** — the org object currently has no custom tag/metadata field at all — and (b) **rule-based bindings** ("grant role X on all orgs where BU=Y"); today bindings are strictly per-org objects. So the net-new work is: org property + admin-defined enum + enforcement at creation (console and API) + display/edit + audit + reporting surface, plus the binding rule. Backfill is a one-time bulk job (~126 orgs), and a weekly untagged-org report covers drift until the rule ships.

**On the "Siemens-only" concern:** fair on cost, but the mechanism is generic — org-level metadata + rule-based group scoping is what any enterprise with departmental structure needs. Siemens is simply first to the wall at this scale. Future multi-BU enterprise onboarding hits the same limitation.

**What's blocking today:** Siemens can't roll out to their FinOps champions without this. Access is currently manual — e.g. on 28 Sep Christoph had to grant Vijay and Paras *owner-level* access to the full org just to unblock connectivity, which over-exposes data and has no expiry. Interim hygiene while this is scoped: new grants Analyst/read-only at the narrowest scope, temporary grants with end dates. One clarification worth stating on the ticket: **the BU tag is visibility metadata only** — contractual discounts stay at enterprise level and propagate; nothing about billing changes.

Happy to jump on a call to walk through the Granola notes from the Siemens session if that helps. cc Ahmed, Guy, Aleksy

---

## Verified data behind the numbers

| Claim in comment | Value | Source |
|---|---|---|
| Child orgs | 126 | live GET /v1/organizations, 2026-10-12 |
| Clusters onboarded | ~240 (239 on 2026-09-26 snapshot; 230 on 09-11) | repo fleet snapshots |
| Estate scale ~1,000 | design target, not onboarded count | dashboard docs (design brief) |
| New child orgs Aug / Sep | 36 / 35 | live `createdAt`, 2026-10-12 |
| Org object custom fields | none | live keys + pinned OpenAPI |
| Groups / role-bindings APIs | exist, per-org | pinned OpenAPI paths |
| Rule-based cross-org bindings | not in current API | pinned OpenAPI |
