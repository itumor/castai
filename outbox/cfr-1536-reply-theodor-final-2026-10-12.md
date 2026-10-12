# CFR-1536 — final reply to Theodor/Carl (v2, Granola-verified 2026-10-12)

**Draft only — a human reviews and posts.** v2 after first-hand Granola verification
(~12 meetings / 8 transcripts read). Three claims from v1 were REMOVED — they are not
supported by the notes; one was contradicted. All kept claims are now backed by a
meeting note, a live API read, or a Jira/Confluence record (ledger below).

---

## Paste-ready Jira comment (as Ebrahim)

Hey @Theodor Iacob — adding my 2 cents from the Siemens sessions, plus what I verified today.

**On the "another layer" instinct — we agree.** Nobody is asking to nest orgs deeper. From the sessions themselves: the per-team child-org model was CAST AI's own recommendation (internal review 10 Aug: "map BUs to organizations, no need for nested sub-orgs"; consensus to keep the per-team model). Siemens' org-structure question is still genuinely open on their side (18 Sep RACI session: "we are in this task for more than 2 months now") — which is exactly why this request shouldn't be framed as a structural layer. What their FinOps people need is the missing *grouping* primitive: **a BU property on the child org + rule-based group access**. Two small features, no hierarchy change.

**Why a custom role alone solves the wrong half.** A role defines *what* someone can do; the unsolved part is *which child orgs* it applies to. Verified today (read-only): **126 child orgs under the Siemens enterprise, ~240 clusters onboarded of a ~1,000-cluster estate, 71 new child orgs created in Aug+Sep alone (36/35)**. Role bindings are strictly per-org objects (`/v1/organizations/{orgId}/role-bindings`), so even a perfect custom role needs per-org bindings enumerated and maintained across 126+ orgs growing ~35/month. And the custom-roles track itself (CFR-1452, Kakao) is still at Gathering-interest; roles today are the fixed built-ins. Either way, something machine-readable still has to say which orgs form a BU — that property is the prerequisite under any solution shape.

**The access half is largely done; the gap is grouping/reporting.** CASTA5-41 (enterprise user groups → child orgs + SSO group sync) shipped, and the read-only role shape for FinOps champions already exists. What doesn't exist anywhere: the org object has **no custom tag/metadata field at all** (only `id, name, createdAt, parentId, type, flags` — verified against the live API and the OpenAPI spec today), and per CFR-646 comments, tag-based grouping is the named missing primitive (Deloitte wants the same for cluster grouping). Net-new work: org property + admin-defined enum enforced at org-create (console + API) + one binding rule ("grant role X on orgs where BU=Y"). Backfill is one-time (~126 orgs); Siemens will own and supply the BU→org mapping from their side — name-parsing backfill isn't reliable (APM-numbered/template orgs), and they accept that.

**On "Siemens-only":** the demand is generic. CID-196 names Siemens, BMW and Deloitte wanting BU self-service; Kakao groups child orgs by environment (CFR-1452); and we've shipped this exact pattern before for cost allocation — **NASDAQ's CFR-480** (BUs across 800+ AWS accounts) was solved with allocation tags, not a hierarchy change. The Q1-2026 Cost Reporting plan ("label/tags mapping for chargebacks, exportable to BI tools") points the same direction.

**@Carl Gridley — on the FinOps-tooling workaround:** it relocates the problem. A Siemens-side tool still needs *access* to those orgs: the enterprise key sees all BUs (fails their no-cross-BU-visibility requirement — champions must not see other BUs' cost data, stated 7 Sep), so it'd need 126+ per-org API keys to issue/rotate/secure, access tied to keys not users (no SSO, no per-user audit — a hard no from their iWire identity team), plus the BU mapping maintained by hand in a third system. Tag + rule-based groups does it once, platform-native, user-level.

**Why it's urgent — it's blocking their FinOps-champion rollout, and the interim cost is standing over-exposure.** From the 28 Sep session (your note too, Carl): "Root cause: Vijay and Paras lacked proper org-level access in Cast AI" — those are the vLab cluster engineers, and Christoph granted them **owner-level access to the full organization** as a temporary connectivity unblock, with a plan to scope down after onboarding. That narrowing still can't happen without a BU grouping to narrow *to* — and the same pattern will repeat for every FinOps champion grant until the grouping exists. One risk to flag: on 5 Oct they noted enterprise cost visibility required a "Super Enterprise Admin" role — worth checking the champion read-only role covers the cost surface they'll need, so we don't fix access and still block reporting.

**Last, so we don't duplicate work:** Ahmed raised this exact ask with engineering before (accepted in principle, ETA "weeks, not days" per the 2 Oct session), and the 17 Aug onboarding note recorded "Organization hierarchy/merge across BEUs: Cast AI team handling, expected within 1-2 months". If that in-flight work covers BU grouping, CFR-1536 should reference it rather than scope fresh.

Happy to walk through the session notes or demo the cross-org aggregation we already run daily. cc @Ahmed Khaldi @Guy Faigenboim @Aleksy Zaleński

---

## What Granola verification changed vs v1 (read before you post)

| v1 claim | Granola verdict | Action taken in v2 |
|---|---|---|
| Sergej: "There will be no change in organization structure…" | **NOT FOUND** in any of ~12 meetings/8 transcripts; Siemens' structure decision was still OPEN (18 Sep) | **REMOVED the quote.** Replaced with documented CAST-side consensus ("map BUs to organizations, no need for nested sub-orgs", 10 Aug) |
| "Bosco confirmed the Analyst role matches" | **NOT FOUND.** "Analyst" never appears in Siemens notes (roles discussed: Owner/Member/Viewer); Oct 5 needed "Super Enterprise Admin" for cost visibility | **REMOVED.** Replaced with a caution to verify the champion role covers the cost surface. Note canonical spelling: **Bosko Corak** |
| "Teams restructure every ~3 years" | NOT FOUND | **REMOVED** |
| 28 Sep Vijay/Paras owner-level grant | **CONFIRMED** verbatim (incl. attendee list) | Kept, with the "temporary, plan to scope down" nuance |
| "Siemens asked for a tag per child org" | PARTIAL — closest: 29 Sep note "Cast engineering building a FinOps role with tag-based org access (next sprint)"; BU grouping need itself confirmed (7 Sep, 10 Aug) | Reframed as grouping primitive; tag framed as mechanism from both sides |
| (new) Engineering already accepted; ETA "weeks, not days" (2 Oct); "hierarchy/merge across BEUs — handled by Cast AI team, 1-2 months" (17 Aug) | NEW from Granola | Added closing paragraph to avoid scoping duplicate work |

## Evidence ledger

- **126 child orgs / ~240 clusters / 71 new in Aug+Sep; org object has no tag field; bindings are per-org only** — live read-only API + pinned OpenAPI, 2026-10-12. ⚠️ Provenance: this 126 is the console-of-today count, NOT from Granola — meeting notes quote ~60 (19 Aug) and ~160 (18 Sep, likely counting planned/template orgs), with 600–1,000 orgs projected at full adoption (10 Aug). If someone in the thread quotes a different number, this is why.
- **"map BUs to organizations, no need for nested sub-orgs"; per-team consensus** — Granola: "Siemens" internal sync, 10 Aug 2026.
- **"we are in this task for more than 2 months now"** (structure still open) — Granola: "Siemens RACI", 18 Sep 2026.
- **Vijay/Paras owner-grant quote** — Granola: "Cast AI Follow Up Session #1", 28 Sep 2026.
- **BU-scoped visibility; champions must not see all-BU cost** — Granola: "Cast AI Adoption — Follow Up Session #1", 7 Sep 2026.
- **FinOps role w/ tag-based org access (roadmap, "next sprint")** — Granola: "SIEMENS x Cast AI | Clarification Request", 29 Sep 2026.
- **Ahmed: engineering accepted, ETA "weeks, not days"** — Granola: "Cast AI & Siemens — Cast AI Org Structure", 2 Oct 2026 (note: meeting content mostly covered the JVM incident; the CFR status update was a side item — treat the acceptance as informal until confirmed).
- **"Organization hierarchy/merge across BEUs: Cast AI team handling, expected within 1-2 months"** — Granola: "Cast AI Onboarding Session SI + SMO [Option 2]", 17 Aug 2026.
- **Super Enterprise Admin (John + Bosko) for enterprise cost visibility** — Granola: "cast.ai and siemens discounts", 5 Oct 2026.
- **CFR-480 NASDAQ tags; CFR-533 SAP; CFR-1452 Kakao (Gathering interest); CFR-1263 LVMH rollup; CFR-1388 enterprise rollup; CID-196 BMW/Deloitte** — Jira via twg, 2026-10-12.
- **CASTA5-41 done** — Q4 Enterprise experience (WIRE) page; **rollup gap deferred to Reporting team** — Organizations v2 page.
- Name spellings: **Bosko Corak** (bosko.corak@siemens.com), **Sergej Petrovski** (transcripts sometimes "Sergey"). Vijay Kumar & Paras Puri are external (DI FA DSP SUP SPH).
