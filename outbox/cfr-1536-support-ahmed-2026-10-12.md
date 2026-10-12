# CFR-1536 — support comment for Ahmed + ticket field text (2026-10-12)

**Draft only — a human reviews and posts.**
Answers Theodor's "why isn't a custom role enough?", confirms his no-new-layer instinct,
and answers Carl's FinOps-tooling workaround question. Numbers verified live read-only
(EU API `GET /v1/organizations` 2026-10-12 + pinned OpenAPI spec).

---

## Paste-ready Jira comment (as Ebrahim)

Hey @Theodor Iacob — adding my 2 cents from the Siemens sessions and a read-only API check I ran today.

**First: we're aligned on the layer.** Nobody is asking for a BU org layer — Sergej's own summary after the Siemens call was "There will be no change in organization structure, but remains Siemens at the top and all organizations below it." The ask is two much smaller features: **an org-level property (BU tag)** and **rule-based group access** driven by it.

**Why a custom role isn't enough — it solves the wrong half of the problem.** A role defines *what* someone can do; the unsolved part is *which orgs* the binding applies to. Verified today:

- 126 child orgs under the Siemens enterprise, ~240 clusters onboarded (of a ~1,000-cluster estate), and **71 new child orgs created in Aug+Sep alone** (36 in Aug, 35 in Sep).
- Role bindings today are strictly **per-org objects** (`/v1/organizations/{orgId}/role-bindings`). So even with a perfect custom role, someone must enumerate and maintain per-org bindings for every org a champion should see — across 126+ orgs, growing ~35/month, with teams restructuring every ~3 years. That's precisely the "high-granularity manual structure" Siemens told us they cannot maintain.
- The permission shape itself isn't contested: the existing **Analyst** role (read-only cost visibility) already matches the champion requirement — Bosko confirmed that on our call. The missing primitives are: (a) a **tag/property on the org object** (it has none today — only id/name/parentId/type/flags), and (b) a **binding rule** ("grant role X on all orgs where BU=Y").
- And note the tag is the prerequisite *regardless*: even if a cross-org role existed tomorrow, something machine-readable still has to say which orgs are DI vs SI vs SMO. That mapping is what nobody at Siemens can maintain by hand.

**Sizing honesty for the engineering toll:** per-org user groups and role bindings already exist and are scriptable, so the net-new work is the org property (+ admin-defined enum, enforced at creation in console and API) and the binding rule. Backfill of the 126 existing orgs is a one-time bulk job. Minimal viable version = property + rule evaluated at org-create time; before that ships, a weekly untagged-org report catches drift, and manual per-BU grants become scriptable the day tags exist.

**@Carl Gridley — on your FinOps-tooling integration question:** we looked at it, and it relocates the problem rather than solving it. For a Siemens-side tool to show BU-scoped data it still needs *access* to the underlying orgs: an enterprise key sees **all** BUs (fails the "no cross-BU visibility" requirement), so it would need per-child-org API keys — 126+ keys to issue, rotate, and secure in their tooling, access tied to keys instead of users (no SSO, no per-user audit trail — a hard no from their security/WIRE Identity folks), and the BU→org mapping maintained manually in yet another system. That's the exact unmaintainable structure Siemens rejected, plus key sprawl. The tag + rule-based group does it once, platform-native, user-level.

**Why this is urgent rather than nice-to-have:** it's blocking Siemens' internal rollout to FinOps champions, and the interim is over-exposure — on 28 Sep Christoph had to grant Vijay and Paras **owner-level** access to the full org just to unblock onboarding. The cost of waiting is measured in standing over-grants.

Happy to walk through the session notes or do a live 15-min demo of the cross-org aggregation patterns we run today. cc @Ahmed Khaldi @Guy Faigenboim @Aleksy Zaleński

---

## Suggested text for the empty ticket fields

**Workarounds tried:**
> 1. Manual per-org grants: BU champion access was left unresolved in Sep; on 28 Sep a CAST AI-side admin temporarily granted two Siemens users owner-level access to the full "Siemens Dev"/"Siemens AG" org to unblock onboarding (plan to narrow later). Not sustainable; over-exposes data.
> 2. Enterprise-key aggregation dashboards (CAST AI-side, read-only): we already aggregate all child orgs via the enterprise API key + `X-CastAi-Organization-Id` header — proves cross-org reporting works technically, but it is all-BU visibility and an internal tool, not user-scoped access.
> 3. Siemens-internal FinOps tooling integration (proposed by Carl): rejected as workaround — still requires per-child-org keys (126+), no user-level SSO/audit, and manual BU→org mapping; the same unmaintainable structure Siemens rejected.
> 4. BU-level child orgs (one org per BU with teams as… nothing — CAST AI has no second nesting level), i.e. restructuring the tenant: rejected by Siemens and by us (no nesting support).

**CAST Org IDs:**
> Enterprise root: Siemens AG `8b69b8da-00d6-47e6-8af0-a36ab02b9847` (type ORGANIZATION_TYPE_ENTERPRISE). 126 child orgs, all `parentId = <root>` (verified 2026-10-12); example child: "Siemens Dev" `43b8288a-7bc4-4f6b-a008-dcd9e1d5e7d2`. Full child list available on request / via `GET /v1/organizations` with the enterprise key.

**Suggested edit to the "Why?" description:**
> Replace "~1,000 AWS clusters" with "~240 clusters onboarded to CAST AI today, of a ~1,000-cluster AWS estate (126 child orgs, growing ~35 orgs/month)". Keeps the scale story and survives engineering fact-checking.
