# CFR input — Siemens child organisation (BU tagging + group access)

**Draft only — a human reviews and sends.**
**Author:** ebrahim · **Date:** 2026-10-12 · **In reply to:** Ahmed's CFR on child organisations
**Evidence:** live read-only `GET /v1/organizations` (EU API, 2026-10-12) + pinned OpenAPI spec
(`castai-enterprise-dashboard/docs/openapi/castai-openapi.json`). No writes performed.

---

## Slack-ready text

Hey @Ahmed — input on the CFR from our side. I re-verified the live state today (read-only, EU API), so this is current as of 12 Oct, not just the September thread.

**1. Current state (verified live)**
- Structure is still flat: 1 enterprise (`Siemens AG`) + **126 child orgs**; no BU-level orgs, no nesting. Matches what the CFR summary found — the BU-tag proposal has not been implemented.
- The org object today has **no custom tag/property field at all** — only `id, name, createdAt, parentId, type, childOrderId, internal, flags` (pinned OpenAPI + live response). So the mandatory BU property is **new platform capability** (users-service schema + console + API + reporting), not something we can switch on by config.
- Backfill sizing: **126 orgs** to tag. Growth is the bigger story: ~16 created Jul, **36 Aug, 35 Sep** — without auto-assignment we re-accumulate untagged orgs at ~10–12/week.
- Child-org naming gives no reliable BU signal (APM-numbered names, test/template orgs like `APMXXXX - APP NAME`, `CASE-Test`), so scripted backfill by name-parsing would be guesswork. Backfill needs a Siemens-owned BU mapping, not automation.

**2. Input on the three open points**
- **Mandatory BU values** — agree with the pre-defined, admin-managed enum (select-list) + `n/a` default for legacy orgs. Additions: enum owned at enterprise level; enforced at creation in console *and* API; editable afterwards only within the enum; every change audit-logged. Schema should be extensible so Sergej's optional "BU Second level"/Option1/Option2 can be added later **without a migration** — but recommend deferring them (Bosko's keep-it-simple).
- **Backfill** — one-time bulk job over 126 orgs is trivial (~130 API calls), but the real risk is **drift**: orgs created while the rule engine isn't live. Proposal: a weekly "untagged child orgs" report until auto-assignment ships — our enterprise sweep already touches every org weekly, easy to piggyback.
- **BU-based group assignment in scope?** — Per-org user groups and role bindings already exist and are scriptable today (`/v1/organizations/{orgId}/groups`, `.../role-bindings`). What's missing is (a) the BU property itself and (b) **rule-based binding** ("grant role X on all orgs where BU=Y") — today bindings are per-org objects, so this is genuine engineering. Interim: manual per-BU grants are scriptable the day tags exist, no need to wait for the rule engine.

**3. Two hygiene flags**
- The 28 Sep workaround (owner-level access on the full Siemens org) is broader than the need; while this CFR is in flight, new grants should be Analyst/read-only at the narrowest scope, and the temporary grants should get an expiry/remediation date.
- Worth stating explicitly in the CFR: **BU is metadata for visibility only** — contractual discounts stay at enterprise level and propagate; also BU lives at *org* level, distinct from existing per-cluster tags, so reporting doesn't depend on cluster tag hygiene.

**4. Asks**
- @Ahmed / WIRE Identity: confirm CFR status on the three points (mandatory values, backfill owner, rule-based assignment in scope for first drop?).
- @Bosko / @Christoph: own the canonical BU list (values + change process) — that's the blocking input for both backfill and the enum config.
- Happy to run the backfill script + weekly untagged-org report from our side once the property exists.

---

## Verified data (for the record)

| Fact | Value | Source |
|---|---|---|
| Orgs visible to enterprise key | 130 (1 enterprise, 126 children, 3 standalone) | live GET 2026-10-12 |
| Enterprise root | Siemens AG `8b69b8da-…b9847` | live + docs |
| Org object custom fields | none (no tags/properties/metadata) | live keys + pinned OpenAPI |
| Children created Jul/Aug/Sep 2026 | 16 / 36 / 35 | live `createdAt` |
| Groups & role-bindings APIs | exist, per-org, scriptable | pinned OpenAPI paths |
| Cross-org "role on all orgs matching property" | not in current API | pinned OpenAPI |
