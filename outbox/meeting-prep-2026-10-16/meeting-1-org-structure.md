# Meeting 1 — Cast AI & Siemens: Org Structure — 9:30 AM

Prepared for Ebrahim Ramadan · compiled Thu 2026-10-15 ~20:00–20:05 Europe/Riga · all inputs read-only (Granola notes/transcripts, repo docs, live GET-only CAST AI EU API, public OpenAPI specs). Meeting: Fri 2026-10-16, 9:30 AM Europe/Riga. This is the 3rd session of the "Cast AI & Siemens - Cast AI Org Structure" series (Sep 8, Oct 2, now Oct 16).

---

## 1. Meeting snapshot

**Purpose:** Define how user and group access will be managed off the agreed **BU property** (e.g., "analytical access to all organizations where BU=DI") and the proposed **"Application ID" (APM\*) text field**; get Cast AI's internal answer on the delivery path (pipeline hook vs fine-grained service accounts); leave with a dated plan for backfill + auto-assignment and the FinOps-champion rollout.

**Why now:** Sergej Petrovski followed up to finalize the org-structure configuration (email context — *unverified in repo/Granola*; consistent with Ahmed saying on Oct 14 he had been "postponing every week a meeting with Sergey"). Internally, Cast AI committed on Oct 14 to have answers by Thursday for this Friday call.

**Participants — confirmed series history:**
| Name | Email | Side | Basis |
|---|---|---|---|
| Sergej Petrovski | sergej.petrovski@siemens.com | Siemens (requester; org-code/Cloudability owner on their side) | Granola 81b10bdc Sep 8 + 66292bc7 Oct 2; email context |
| Bosko Corak | bosko.corak@siemens.com | Siemens (orchestrator; "keep it small, keep it simple") | Granola 81b10bdc Sep 8 |
| Christoph Goebels | christoph.goebels@accenture.com | Accenture (implementer; presented champion needs Sep 8) | Granola 81b10bdc Sep 8 |
| Fabian Jennrich | fabian.jennrich@accenture.com | Accenture (holds Siemens full-org admin; Sep 7) | Granola ff220548/81b10bdc |
| Tahmid Shibly | tahmid.shibly@accenture.com | Accenture (implementer) | Granola 81b10bdc Sep 8 |
| Fan Yang | f.m.yang@accenture.com | Accenture (implementer) | Granola 66292bc7 Oct 2 |
| Ebrahim Ramadan | ebrahim@cast.ai | Cast AI (CE, host; wrote the CFR-1536 summary) | series notes |
| Ahmed Khaldi | ahmed.khaldi@cast.ai | Cast AI (TAM; **said Oct 14 he does not work Fridays, works Sundays, "will try to join"**) | Granola dea2cba7 Oct 14 transcript |
| Guy Faigenboim | guy@cast.ai | Cast AI (sponsor; confirmed on Oct 14 "call with Sergey Friday… you're there") | Granola dea2cba7 transcript |
| Aleksy Zaleński | aleksy@cast.ai | Cast AI (SA; owns role-binding API validation) | Granola dea2cba7 Oct 14 |
| Renata Klimiato | renata@cast.ai | Cast AI (product; owns fine-grained SA feasibility) | Granola dea2cba7 Oct 14 — presence Fri *unverified* |
| Theodor Iacob / Alexandra Bakalova | theodor@cast.ai / alexandra@cast.ai | Cast AI (product/eng) | attended Oct-14 internal; presence Fri *unverified* |
| John Doyle | john.doyle@siemens.com | Siemens (self-service portal owner — where the pipeline hook would land) | [presence unverified; he was in Oct-8 FinOps daily + Oct-14 SMO-RI weekly] |

---

## 2. Where we stand — verified facts

**The agreed model (Sep 8 session — the meeting record to anchor on):**
- Flat structure stays: one enterprise (Siemens) with flat child orgs; NO new hierarchy level. Cast-side consensus Aug 10: "map BUs to organizations, no need for nested sub-orgs." Source: Granola 81b10bdc (Sep 8, 12:30) + repo `outbox/cfr-1536-reply-theodor-final-2026-10-12.md` evidence ledger.
- Mandatory **BU tag** on each child org; values predefined (DI, SI, SMO, IT — BU = Siemens' 2nd hierarchy layer, 50–500+ members, biggest SI/DI/SMO); 3rd layer (GSW, CLO…) has no official Siemens definition. Bosko: "if it's not automatized and do manually, then high granularity cannot be managed" (Cloudability org-code precedent). Source: Granola 81b10bdc transcript.
- **Analyst role** = the champion role: Bosko verbatim "this analyst role perfectly match, perfectly match FinOps champion role" — read-only cost monitoring, no cluster edits; Viewer-vs-Analyst distinction flagged as needing confirmation (carry this question). Independent doc clarification Oct 6: "Analyst: read-only except cost monitoring; suited for FinOps personas." Sources: Granola 81b10bdc transcript; Granola d5ddf4f9 (Oct 6, MLB account — RBAC explainer).
- Create **2–3 tags upfront** for future flexibility (Bosko's proposal, Sep 8 transcript).
- **Contractual discounts stay at enterprise (Siemens top) level and propagate** to all child orgs via console and API — confirmed on the Sep 8 call; reconfirmed Oct 12 drafts: BU is visibility metadata only, nothing about billing changes. Sources: 81b10bdc transcript; `outbox/cfr-1536-comment-draft-2026-10-12.md`.
- Migration flagged Sep 8: existing child orgs have no tags; **bulk API update needed to backfill**. Source: 81b10bdc summary.
- "Application ID" (APM\*) text field: **no Granola note mentions it in org-structure context (searched Oct 15)** — the proposal is email-context only (*unverified*), but the nomenclature is real: 10 child orgs are APM-named (incl. template `APMXXXX - APP NAME`; live API today) and Siemens AWS cluster tags carry `application_id: APM0022911` (repo: `cluster-readiness-outputs/ngm-node-templates/deep-audit-2026-10-04/integ/cluster.json`).

**The Sep 7 requirement that started it:** FinOps champions (SMO first) must see all clusters onboarded in their BU — including newly onboarded ones — and must NOT see other BUs' cost data; global project team sees all; cluster owners only their own. Source: Granola ff220548 (Sep 7) + 81b10bdc.

**Oct 14 internal sync (the two technical paths):**
- **Path 1 — Pipeline approach (Theodor):** an extra API call inside John's self-service org-creation pipeline — after org creation, create the role binding that puts the new org into the relevant BU user group. Only enterprise owners can create child orgs (Renata confirmed on the call), so the step is enforceable; Theodor: "why would we get into weeks or months of development just because they don't want to make an extra API call?" (internal tone — do not repeat to customer). Source: Granola dea2cba7 transcript (Oct 14, 10:30).
- **Path 2 — Fine-grained service accounts (Renata, preferred roadmap):** one service account scoped to multiple child orgs with cost-monitoring permissions, created by the enterprise owner per BU; reuses existing fine-grained PAT logic ("hopefully… wouldn't be a big lift"); flagged "next priority" but **NOT built yet**. Source: Granola dea2cba7 transcript.
- API-key limits today: a key is either enterprise-level OR single-child-org — **no multi-select**; personal keys see all orgs the user is a member of, but non-enterprise members cannot create enterprise-level keys (Theodor/Aleksy exchange). Source: dea2cba7 transcript.
- **No API returns the list of orgs a user belongs to** (Renata); interim fallback = maintain the org list from the UI (Aleksy). Source: dea2cba7 transcript.
- Enterprise-level cost-report aggregation does not exist (Q4 backlog); lower priority since Siemens is API-proficient and self-aggregates per-org. Source: dea2cba7 transcript (Renata, Aleksy).
- Related gap flagged to product: rebalancing/hibernation schedules are org-level resources — cluster owners can't create them; "Schedule Manager" role exists but exposes all clusters' schedules in the org; Swisscom + NASDAQ raised the same. Source: dea2cba7 transcript.

**Live API verification (all GET-only, pulled 2026-10-15 ~17:00–17:03 UTC = ~20:00–20:03 Europe/Riga):**
- `GET https://api.eu.cast.ai/v1/organizations` → HTTP 200, **131 org objects**: 1 enterprise root **Siemens AG `8b69b8da-00d6-47e6-8af0-a36ab02b9847`**, **127 child orgs** with `parentId` = root, plus 3 standalone (`CAST AI EU`, `Siemens-test`, `Siemens-test-on`). **Note: 127 today vs 126 on Oct 12 and "126 child orgs today" in the Oct-14 note** — the difference is `FT D AA IN SGI EA ECO`, **created 2026-10-15T09:46:52Z** (createdAt, live API). A fresh org exists that no BU rule would have caught.
- Org object has **NO tag/property/metadata field** — full field union live: `id, name, createdAt, parentId, type, childOrderId, internal, organizationMember, blockEscalatedPrivilege`. So the BU property is genuinely net-new schema. Source: same GET + pinned OpenAPI (`castai-enterprise-dashboard/docs/openapi/castai-openapi.json`).
- `GET /v1/organizations/{enterpriseId}/roles` (enterprise key + `X-CastAI-Organization-Id` header) → 7 built-in roles; **Analyst id = `7c22c519-a9e7-4f58-90bd-af861d932033`**. Source: live GET, ~17:03Z.
- `GET /v1/organizations/{enterpriseId}/groups` → **0 user groups exist at the Siemens enterprise level today** — BU groups start from a blank slate. Source: live GET, ~17:03Z.
- **Public spec exposure for the pipeline flow (citations for Sergej):** `GET https://api.eu.cast.ai/v1/spec/openapi.json` (HTTP 200, ~2.2 MB, pulled ~17:02Z) contains: `/v1/organizations/{organizationId}/groups` (GET/POST/PATCH), `/v1/organizations/{organizationId}/groups/{id}` (GET/PATCH/DELETE), `/v1/organizations/{organizationId}/role-bindings` (GET/POST), `/v1/organizations/{organizationId}/role-bindings/{id}` (GET/PATCH/DELETE), `/v1/organizations/{organizationId}/roles` (GET), `/v1/organizations/{organizationId}/service-accounts` (+`/keys`) full CRUD, `/v1/organizations/{organizationId}/users/{userId}/groups` (GET). All are **per-org objects** — no rule-based cross-org binding endpoint exists. Also exposed: `/organization-management/v1/organizations/{organizationId}/permission-groups` (GET; PAT permission groups). Swagger index: `https://api.eu.cast.ai/spec/`.

**Scale context (for urgency, verified):**
- Org growth: 71 new child orgs in Aug+Sep (36/35; ~16 Jul) from live `createdAt` on Oct 12 (`outbox/cfr-input-siemens-child-org-2026-10-12.md`); Oct-14 note: ~50→125 in August, "now stable" — but today's new org shows growth continues (~35/month basis).
- Clusters: **~900 total; target 80% onboarded (~800) by February** (Oct-14 note, Guy). For the Feb ramp, Siemens onboarded ~240 of a ~1,000-cluster estate per Oct-12 figures (marked: 240 = observed onboarded, 900/1,000 = estate/target — different bases, quote carefully). Sources: dea2cba7; `outbox/cfr-1536-comment-draft-2026-10-12.md`.
- Name-prefix shape of the 127 children (name-parsing heuristic only): DI 21, SMO 12, SI 11, FT 11, IT 10, 10× APM-numbered, 33 un-prefixable (live API today) — **backfill by name-parsing is unreliable; Siemens must own the BU→org mapping** (repo: `outbox/cfr-input-siemens-child-org-2026-10-12.md`).

**Access-health warning (relevant to scale):** on Oct 2, users Sergej and John were intermittently losing Cast AI access — root cause identified: **"user list too large" bug**; fix in progress since Oct 1. Source: Granola 66292bc7 (Oct 2).

**Jira/drafts trail:** CFR-1536 (org hierarchy) — solution = BU tagging on child orgs + auto-scoped user groups, not a new hierarchy level; unblocks FinOps-champion rollout across ~1,000 AWS clusters; Aleksy posted Ebrahim's summary (user-supplied Jira info — *not independently re-verified*). Four paste-ready drafts under `outbox/cfr-1536-*-2026-10-12.md` + `outbox/cfr-input-siemens-child-org-2026-10-12.md`. Prior signals: Sep 29 — Cast engineering building a FinOps role with tag-based org access ("next sprint"); Oct 2 — Ahmed: accepted in principle, ETA "weeks, not days" (informal, side item — treat as* [confirm current status]*). Source: `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md` §1/§4; `outbox/cfr-1536-reply-theodor-final-2026-10-12.md` ledger.

---

## 3. Key numbers & facts to quote

| Item | Value | Source |
|---|---|---|
| Siemens child orgs (live) | **127** under `8b69b8da-00d6-47e6-8af0-a36ab02b9847` | `GET /v1/organizations`, 2026-10-15 ~17:00Z (~20:00 Riga) |
| Same figure Oct 12 / Oct 14 note | 126 / "126 child orgs today" | repo CFR docs; Granola dea2cba7 |
| Newest org (the drift example) | `FT D AA IN SGI EA ECO` created 2026-10-15T09:46:52Z | live `createdAt`, same pull |
| Org object property/tag field | **none today** — BU property is net-new schema | live field union + pinned OpenAPI, same pull |
| Enterprise user groups today | **0** | `GET /v1/organizations/{id}/groups`, ~17:03Z |
| Analyst role id (enterprise) | `7c22c519-a9e7-4f58-90bd-af861d932033` | `GET /v1/organizations/{id}/roles`, ~17:03Z |
| Role-binding/group APIs for pipeline | exist, per-org, public spec (`/v1/organizations/{organizationId}/role-bindings`, `…/groups`) | `api.eu.cast.ai/v1/spec/openapi.json`, ~17:02Z |
| Rule-based binding ("grant X where BU=Y") | **not in any spec** — net-new engineering | same public spec + pinned OpenAPI |
| Clusters | ~900 total; 800 (80%) onboarded target by **February 2027** | Granola dea2cba7 (Oct 14) |
| Onboarded today | ~240 of ~1,000-cluster estate (Oct-12 basis) | `outbox/cfr-1536-comment-draft-2026-10-12.md` |
| Org growth rate | 36 Aug + 35 Sep = **71**; ~35/month | live `createdAt`, Oct-12 pull (`outbox/cfr-input-…`) |
| APM-numbered child orgs | **10** (incl. template `APMXXXX - APP NAME`) | live names, 2026-10-15 pull |
| BU sizes / layers | 50–500+ members; BU = 2nd layer; 3rd layer undefined | Granola 81b10bdc transcript (Sep 8) |
| Accenture spend | ~$1M ("the rumor says", Guy, Oct 14) — *unverified* | Granola dea2cba7 transcript |
| Access bug at scale | user-list-too-large bug kicked Sergej + John; fix in progress | Granola 66292bc7 (Oct 2) |
| Champion requirement | see own BU only, incl. future orgs; no cross-BU cost visibility | Granola ff220548 (Sep 7) |

---

## 4. Open action items

| Owner | Item | Status |
|---|---|---|
| Aleksy Zaleński | Validate **user-group role-binding API flow end-to-end** — confirm no missing IDs block the pipeline approach (assigned Oct 14; due before Friday call). Precedent risk: Terraform role-binding flow needs the internal **user id**, and no user-lookup-by-email data source exists (MLB POC, Oct 6) | **Due Thu Oct 15 — no recorded outcome in Granola (searched Oct-15 evening). [confirm current status]** |
| Renata Klimiato | Confirm internal feasibility + engineering timeline for **fine-grained service accounts** (clear internal answer promised by Thu Oct 15) | **Due Thu Oct 15 — no recorded outcome. [confirm current status]** |
| Guy + Aleksy | Sep-8 task: sync with engineering on BU tagging, rule-based assignment, bulk migration API | CFR-1536 exists (Open; Aleksy posted Ebrahim's summary — user-supplied, unverified). Prior informal signal: accepted in principle, ETA "weeks, not days" (Oct 2) [confirm current status] |
| Siemens (Christoph/Tahmid) | Share John's self-service portal flow + org-creation documentation (assigned Sep 8) — input to the pipeline option | Unverified whether delivered |
| Siemens (Bosko/Christoph) | Own the **canonical BU enum** (values + change process) and the **BU→org (and APM→org) backfill mapping** for ~127 orgs | Not supplied — the blocking input |
| Cast AI (product/docs) | Update onboarding documentation: one child org per team (not per cluster) (Sep-8 action) | Unknown |
| Cast AI engineering | Fix "user list too large" access bug kicking Sergej/John (root-caused Oct 1) | In progress as of Oct 2 [confirm current status] |
| Ebrahim + Bosko | Follow-up calls in this series (Sep-8 action: week of Sep 14) | Done — series continued Oct 2; today's meeting is #3 |

---

## 5. Questions to ask in the meeting

1. "Can we lock the **exact BU enum** today — DI, SI, SMO, IT, and what else — and who at Siemens owns adding a value later?"
2. "Who supplies the **BU→organization backfill mapping** for the 127 existing orgs, and by when? Name-parsing won't do it — 10 orgs are APM-numbered and one is literally a template called 'APMXXXX - APP NAME'."
3. "On the **Application ID** field: mandatory at creation? Must it be unique, and validated against MyIT/ServiceNow/CMDB — or free text with an 'APM' prefix? Is it the join-key to Cloudability and your FinOps tooling?"
4. "Which delivery path do you prefer: **(1) one extra API call inside John's portal at org creation** — works with today's public APIs (`POST /v1/organizations/{orgId}/role-bindings`), enforceable because only enterprise owners create orgs — or **(2) fine-grained service accounts scoped to multiple child orgs**, which is the cleaner end-state but is not built yet?"
5. "We confirmed the role list: **Analyst** is the champion role. Open point from Sep 8 — Viewer vs Analyst look similar; and on Oct 5 your side needed 'Super Enterprise Admin' to see enterprise costs. Which role exposes **discounted enterprise-level cost views** for champions?"
6. "What is the **date driving the FinOps-champion rollout** — and can 2–3 SMO/DI champions start on manually scripted BU groups while rule-based auto-assignment ships?"
7. "What are the **iWire/identity constraints** on service accounts versus SSO-synced user groups — expiry, re-certification cadence, personal audit trail?"
8. "A new org — 'FT D AA IN SGI EA ECO' — was created **today**. Does the 800-cluster February target keep growth at ~35 orgs/month, and should we agree a **weekly untagged-org report** until auto-assignment is live?"
9. "Should new grants in the interim be **Analyst/read-only at the narrowest scope** — the Sep 28 owner-level grant to Vijay and Paras is still open and needs an expiry date? [confirm current status]"
10. "Do you want the BU tag to also drive **reporting slices** (cockpit/Cloudability savings per BU), or is it access-scoping only for now?"

---

## 6. Risks / watch-outs

- **Both internal validations are unreturned.** Aleksy's role-binding flow check and Renata's service-account feasibility were due Thu Oct 15; no outcome is recorded. Going in without them means presenting options we haven't proven — decide the demo story in the first 5 minutes (live dummy org vs payload walkthrough).
- **Don't commit engineering dates.** Fine-grained SAs are "not there yet" (Renata); rule-based bindings and the org-property schema are genuine net-new work ("weeks, not days" informal signal). Present the pipeline path as executable now, the SA path as direction — written ETA only after Renata's answer.
- **Analyst-role cost-surface uncertainty:** Access solved ≠ reporting solved. Oct 5 signal: enterprise cost visibility required "Super Enterprise Admin". If champions get Analyst on DI orgs but can't see discounted costs, we fix access and still block reporting.
- **Zero enterprise user groups exist today** — the BU-group story is greenfield; group naming/ownership/SSO-sync conventions must be agreed in the same meeting, not deferred.
- **Drift is happening in real time:** 127 orgs vs 126 three days ago; ~35/month growth; every day without the property adds backfill debt and a manual grant.
- **Standing over-exposure:** Vijay & Paras hold owner-level access to the full org since Sep 28 (temporary un-block). Every new champion grant repeats this pattern until grouping exists — push for expiry dates.
- **Scale bug in flight:** the "user list too large" bug already kicks Sergej/John out of the console; more groups/grants without the fix could worsen it. Ask for the fix status.
- **Sergej's flat-structure line is email-only** ("no change in organization structure, Siemens at the top…") — not found in ~12 searched notes/transcripts; paraphrase, don't quote him to himself (`outbox/cfr-1536-reply-theodor-final-2026-10-12.md`, `brain/notes/Siemens People.md`).
- **Never quote internal tone:** Theodor's "why would we get into weeks of development…" line and cross-customer references (Swisscom, NASDAQ, BMW/Deloitte in CID-196) are internal only.
- **Don't overpromise reporting rollups:** enterprise-level cost aggregation is a Q4 backlog item; Siemens self-aggregates via API per-org — offer the org-list API + their own pipeline as the interim.

---

## 7. Tonight's prep checklist

1. **Chase the two due items** (Slack/Teams, before morning): Aleksy — outcome of the user-group role-binding API validation (any missing IDs? does `POST /v1/organizations/{orgId}/role-bindings` accept GROUP subjects cleanly?); Renata — feasibility/timeline for fine-grained service accounts.
2. **Decide the demo plan:** if Aleksy green-lights, stage a dummy org + 3 curl payloads (create group → create role-binding → verify list) for a live walk-through with Sergej; otherwise present the payloads conceptually from this brief §2.
3. **Re-read** `outbox/cfr-1536-reply-theodor-final-2026-10-12.md`, `outbox/cfr-input-siemens-child-org-2026-10-12.md`, and the Oct-14 internal note (Granola dea2cba7) — your position papers.
4. **Screenshot/stage live evidence:** 131/127 org counts, the "FT D AA IN SGI EA ECO" createdAt, the 0-groups result, the Analyst role id — Sergej is an API power user and will ask "show me".
5. **Draft the follow-up email skeleton now** (recipient Sergej; CC rule: he is on ALL REST API threads, standing request 2026-10-13 — `outbox/case-threads/20261013T1401Z-sergej-rest-api-cc-case.md`), leaving blanks for decisions taken on the call.
6. **Pre-write the BU spec one-pager:** BU = mandatory org property, enterprise-owned enum + `n/a` for legacy, enforced at create in console AND API, audit-logged, extensible to Sergej's "BU second level" later without migration (deferring per Bosko's keep-it-simple) — from `outbox/cfr-input-siemens-child-org-2026-10-12.md`.
7. **Prepare the Application-ID question set** (§5 Q3); terminology is unverified outside the email — ask for their definition before proposing validation rules.
8. **Check status of the Vijay/Paras grant narrowing** and the user-list-too-large bug fix, so access-hygiene answers are current.
9. **Offer, don't promise:** the weekly untagged-org report (Ebrahim can run it read-only) and the scripted manual per-BU grants as interim — both exist today.
10. **Confirm the final attendee list** (Ahmed usually off Fridays; whether Renata/Theodor join) — align speaker order: Guy opens, Aleksy owns technical path, Ebrahim owns numbers/evidence.

---

## 8. Sources

**Granola (notes + transcripts, read via MCP):**
- `dea2cba7-fcfc-4193-9dd0-698ef093ae92` — "INTERNAL - Siemens org structure", Oct 14, 2026 10:30 (note + full transcript read) — 126-org count, 900-cluster/800-Feb target, two delivery paths, API-key limits, no-user-org-list-API, schedule-gap, action items
- `81b10bdc-727d-4d75-b082-ba608a253e1f` — "Cast AI & Siemens - Cast AI Org Structure", Sep 8, 2026 12:30 (note + full transcript read) — the agreement: flat structure, mandatory BU tag, Analyst role ("perfectly match"), 2–3 tags, discounts propagate, backfill need
- `ff220548-a48a-4df3-ba6e-fcf5d4f7806e` — "Cast AI Adoption - Follow Up Session #1", Sep 7 — BU-champion no-cross-BU requirement
- `66292bc7-718d-479f-a93b-dba796bf5b92` — "Cast AI & Siemens - Cast AI Org Structure", Oct 2 — user-list-too-large access bug, Sergej/John
- `e1d4c656-8e55-4790-becb-16fad4c9a718` — Sep 7 — cluster-owner metadata concept (tagging/ITAM/MyIT/ServiceNow), CMDB/Cloudability context
- `d5ddf4f9-3d87-4169-902e-3ed1b2414f79` — "MLB | Cast AI - Cloud Platform Weekly", Oct 6 — RBAC explainer ("Analyst: read-only except cost monitoring; suited for FinOps personas"); Terraform user-ID lookup gap (missing-IDs precedent)
- Siemens folder listing (folder `0dffa50d-…`, 77 meetings Aug 1–Oct 16) searched; targeted queries run Oct 15 for Application ID/APM, Aleksy/Renata outcomes — no new hits

**Repo (read-only):**
- `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md` (§1 timeline CFR-1536/Oct-14 call, §4 Jira trail, §8 people map)
- `outbox/cfr-1536-reply-theodor-final-2026-10-12.md`, `outbox/cfr-1536-comment-draft-2026-10-12.md`, `outbox/cfr-1536-support-ahmed-2026-10-12.md`, `outbox/cfr-1536-reply-ahmed-short-2026-10-12.md`, `outbox/cfr-input-siemens-child-org-2026-10-12.md`
- `outbox/meeting-prep/meeting-prep-2026-10-16.md` (day-level prep, 9:30 section)
- `brain/notes/Siemens People.md` (Sergej profile, CC rule, quote caveat)
- `cluster-readiness-outputs/ngm-node-templates/deep-audit-2026-10-04/{integ,kronos}/cluster.json` (Siemens `application_id: APM0022911` AWS tag evidence)
- `castai-enterprise-dashboard/docs/openapi/castai-openapi.json` (pinned spec: org schema, RBAC paths)

**API (GET-only, account's enterprise key, triggered 2026-10-15 ~17:00–17:03 UTC / ~20:00–20:03 Europe/Riga):**
- `GET https://api.eu.cast.ai/v1/organizations` → 200 (131 objects; 127 children of Siemens AG root; 10 APM-named; org field union verified)
- `GET https://api.eu.cast.ai/v1/organizations/8b69b8da-00d6-47e6-8af0-a36ab02b9847/roles` → 200 (7 roles incl. Analyst `7c22c519-…`)
- `GET https://api.eu.cast.ai/v1/organizations/8b69b8da-00d6-47e6-8af0-a36ab02b9847/groups` → 200 (0 groups)
- `GET https://api.eu.cast.ai/v1/spec/openapi.json` → 200 (public RBAC paths: `/v1/organizations/{organizationId}/groups`, `…/role-bindings`, `…/roles`, `…/service-accounts(+keys)`, `…/users/{userId}/groups`, `/organization-management/v1/organizations/{organizationId}/permission-groups`)
- `GET https://api.eu.cast.ai/spec/` → Swagger index (18 named specs + Legacy API v1)

**Unverified / email-only:** Sergej's recent follow-up email and the flat-structure verbatim quote; the "Application ID / APM" agenda item (no Granola mention); Accenture ~$1M (Guy called it a rumor); Jira statuses (user-supplied); CFR-1536 current status [confirm current status].
