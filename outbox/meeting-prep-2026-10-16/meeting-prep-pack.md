# Siemens × CAST AI — Meeting Preparation Pack
**For:** Ebrahim Ramadan · **Meetings day:** Friday, October 16, 2026 (Europe/Riga) · **Prepared:** Thursday, October 15, 2026

Five accepted meetings, each with verified context from Granola meeting notes, the CAST AI API (read-only), and repo case docs. All figures carry a source and pull timestamp inside each section.

---
## Today's schedule

- **09:30** — Cast AI & Siemens — Org Structure
- **10:30** — Cast AI 1 to 1 | IT DF COL UC 2 — Weekly Follow Up
- **12:30** — SIEMENS x Cast AI | SMO Railigent X — Alignment & Next Steps
- **15:00** — CAST AI 1 to 1 | APM0414470 SiBase X — Follow Up #3
- **17:00** — Cast AI Cluster Score Review

---

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

# Meeting 2 — Cast AI 1 to 1 | IT DF COL UC 2 — 10:30 AM

*Prep compiled Thu 2026-10-15 ~20:00 Europe/Riga for Ebrahim Ramadan (CAST AI). All data read-only: Granola meeting notes/transcripts, repo case files, live GET-only CAST AI EU API (api.eu.cast.ai), official CAST AI onboarding script template. Unverifiable items are marked **unverified**.*

---

## 1. Meeting snapshot

- **Title:** Cast AI 1 to 1 | IT DF COL UC 2 - Weekly Follow up
- **When:** Friday 2026-10-16, 10:30 AM Europe/Riga (GMT+3). Weekly slot agreed at Follow-up #4 ("I keep the same slot as today" — Fan Yang, Oct 9; #4 ran 10:30–11:00, Teams ID 299 782 252 555 10) — this is session **#5** in the UC 2 series; first under the new weekly cadence.
- **Purpose (from Oct 9 decisions):** (a) confirm the final Oct 9 Helm/autoscaling run actually completed on the test cluster; (b) run the **configuration walkthrough on dev** that was deferred from #4; (c) review Samuel's IAM mirroring prep for production — **deployment stays gated** on dev validation; (d) keep the weekly series going until both clusters are fully configured.

**Participants (confirmed at #4 on Oct 9; same list invited, attendance today unverified):**

| Name | Email | Side | Role in this engagement |
|---|---|---|---|
| Ebrahim Ramadan | ebrahim@cast.ai | CAST AI | Host / engineer; minted the new token live on Oct 9; identified + shared the full required IAM policy |
| Fan Yang | f.m.yang@accenture.com | Accenture | Organizer of #4; drove the session; requested weekly cadence |
| Samuel Frunza-Hincu | samuel.frunza@conceptboard.com | Conceptboard | Hands-on executor; owns IAM policy updates; containerized K9s env, split AWS/kubectl profiles; **no CAST AI console access** |
| Umair Shahid | umair.shahid@conceptboard.com | Conceptboard | Hands-on support |
| Markus These | markus.these@conceptboard.com | Conceptboard | On invite |
| Malika Hoffer | malika.hoffer@siemens.com | Siemens | Decision approver — pre-approved autoscaling activation on dev; was **absent** Oct 9 |
| Adolfo Cabacinhas-ribeiro | adolfo.cabacinhas-ribeiro@siemens.com | Siemens | On invite |
| Guelen Toker | guelen.toker.ext@siemens.com | Siemens | On invite |
| Christoph Göbels | christoph.goebels@accenture.com | Accenture | Coordination |
| Fabian Jennrich | fabian.jennrich@accenture.com | Accenture | Coordination |
| Tahmid Shibly | tahmid.shibly@accenture.com | Accenture | Coordination |

*Oct-9 transcript shows the active trio was Fan + Samuel + Ebrahim; Malika did not attend. An unnamed "cluster owner" holds the CAST AI console access + cluster token (Samuel explicitly cannot log in).*

---

## 2. Where we stand — verified facts

**Cluster / org identity (verified live today):**

- CAST AI org: **`IT DF COL UC 2`** = `2b9d9744-f37d-4a22-b9c6-2f1857a5417d`, created 2026-09-15T08:25:00Z. *Source: GET https://api.eu.cast.ai/v1/organizations, HTTP 200, pulled 2026-10-15T16:59:46Z.* Note: the Oct-9 transcript's "ATDF COL" reference is this org. The sister org **`IT DF COL UC`** (`3fdf2233-8c32-478f-80be-381e609bd0d2`, created 2026-08-19T07:33:10Z) currently has **zero** external clusters. *Same endpoint, same pull.*
- Cluster: **`siemenstest-siemenstest-1`** = `36575565-7149-431b-b5f6-71f43f18ef3f`, EKS, **eu-west-1** (EU Ireland), AWS account **`951463557399`**, Kubernetes 1.35, createdAt **2026-09-25T08:27:36Z**, managedBy: console. *Source: GET https://api.eu.cast.ai/v1/kubernetes/external-clusters (headers X-API-Key + X-CastAI-Organization-Id: 2b9d9744-…), HTTP 200, pulled 2026-10-15T16:59:49Z.*
- Agent / connection status **right now**: `status: ready`, **`agentStatus: online`**, last agent snapshot **`2026-10-15T16:59:34Z`** (≈15 s before pull — live). `isPhase2: true`; `reconcileInfo: mode "enabled", status "ok", errorCount 0, reconciledAt 2026-10-15T16:46:47Z`. Assume-role: `arn:aws:iam::951463557399:role/cast-eks-siemenstest-siemenstest-1-cluster-role-36575565`. *Same endpoint/pull.* → Phase-2 (cross-account role) onboarding is in place and the reconciler is healthy — **beyond the read-only state seen at the start of the Oct 9 session**.
- **But autoscaling is not yet acting:** 6 nodes visible — 5× `r6a.large` (3× eu-west-1a, 2× eu-west-1b) + 1× `m5a.xlarge` (eu-west-1a) — **none CAST AI-managed**; `eks.instanceProfileArn` empty (node provisioning not configured). *Source: GET …/external-clusters/36575565-…/nodes, HTTP 200, pulled 2026-10-15T16:59:59Z.* On Sep 25 there were 5 nodes (4× r6a.large); one r6a.large has been added since — by AWS-side tooling, not by CAST AI. *Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md §CAST AI-side state.*
- Telemetry is flowing: latest cost-report point shows **14.0 vCPU / 96 GiB provisioned, 10.23 vCPU / 48.2 GiB requested** (Sep 25: 12 vCPU / 80 GiB provisioned). *Source: GET https://api.eu.cast.ai/v1/cost-reports/clusters/36575565-…/resource-usage, HTTP 200, pulled 2026-10-15T17:02:18Z.*

**Timeline of the series (problem → fix):**

- **Follow-ups #1–#2:** no Granola notes found (searched through Oct 15). Existence inferred from the Sep-25 transcript ("last time when you tried to run the scripts, we encountered certain problems"). **Unverified.**
- **Follow-up #3 — Fri 2026-09-25, 10:30** *(Granola 1230e87c-50c6-4c69-8330-ab8a663f7711, summary+transcript)*: castctl CLI installed only after Samuel **manually created a missing directory**; install command had to be re-sent (chat lost); kubectl context pointed at the wrong cluster ("development" context) — fixed manually; **region mismatch** (AWS default eu-west-1 vs nodes reported us-east-1/EUS1); **root blocker: two separate profiles** — one with kubectl access, one with AWS access, neither with both; `eks describe-cluster` failed; token from the earlier session had **expired**, new one generated in-call. Same day, per repo case file: run 1 (`castctl cluster connect --cluster-optimization=false --workload-autoscaler=false`, 11:58 CEST) **succeeded** (cost monitoring); run 2 with both flags `=true` (15:27 CEST) **died on `iam:PutRolePolicy` 403** on role `cast-eks-…-36575565` — an identity-policy gap on deployer role `siemenstest-siemenstest-ir-admin` (not SCP/boundary). Fix documented: add `iam:PutRolePolicy/GetRolePolicy/DeleteRolePolicy` scoped to `role/cast-eks-*`, `role/cast-kvisor-*` in account 951463557399, then re-run the same idempotent command. Support bundle `castctl-support-bundle-20260925T131720.zip` held by Samuel. *Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md; brain/notes/PutRolePolicy 403 Case.md.*
- **Follow-up #4 — Fri 2026-10-09, 10:30** *(Granola db4f0e91-089b-49a0-8131-71b889d415eb, summary+transcript)*: Malika pre-approved autoscaling (absent herself). Start state: cluster in **read-only**, no autoscaling. Token had **expired again** — Ebrahim minted a new one in-meeting and pasted it in chat. The autoscaling install then failed repeatedly mid-run on IAM gaps, each error surfacing one missing permission at a time: **`iam:GetInstanceProfile`**, **`TagInstanceProfile`** (added to an edited policy live), **`sts:GetCallerIdentity`**. Root cause of the churn: **Samuel had been hand-assembling policies from older JSON snippets** ("the last one I more or less got… you send me all the data, I made it by hand"); Ebrahim pulled the full required policy from CAST AI documentation and shared it in chat; permissions were added incrementally to the generic IAM role. Each Helm run restarted from scratch. **Final run was progressing without errors when the session ended — success not confirmed.** Samuel agreed to confirm by email; **no such confirmation exists in Granola Oct 10–15** (searched today, read-only). Fan asked Samuel to prepare the production cluster but deploy only after dev is validated; weekly sessions continue until both clusters are done; Ebrahim to send the recurring invite.
- **Since Oct 9:** Samuel's confirmation email: **unverified / not found**. Live API (today) shows agent online + reconcile ok — strong signal the final run completed, but **no CAST-managed node exists yet**, consistent with "installed, configuration walkthrough still pending" (which is exactly this meeting's job).

---

## 3. Key numbers & facts to quote

| Item | Value | Source |
|---|---|---|
| CAST AI org | `IT DF COL UC 2` / `2b9d9744-f37d-4a22-b9c6-2f1857a5417d` (created 2026-09-15) | GET /v1/organizations, pulled 2026-10-15T16:59:46Z |
| Cluster | `siemenstest-siemenstest-1` / `36575565-7149-431b-b5f6-71f43f18ef3f`, EKS, K8s 1.35 | GET /v1/kubernetes/external-clusters, pulled 16:59:49Z |
| AWS account / region | `951463557399` / **eu-west-1** (the Sep-25 "us-east-1/EUS1" note is wrong or obsolete — all 6 nodes + API agree on eu-west-1) | Same pull |
| Cluster first connected | 2026-09-25T08:27:36Z (cost-monitoring run 1) | Same pull |
| Agent status | **online**, last snapshot 2026-10-15T16:59:34Z; status `ready` | Same pull |
| Reconciler | mode **enabled**, status **ok**, 0 errors, 2026-10-15T16:46:47Z; isPhase2 true | Same pull |
| CAST AI assume-role | `arn:aws:iam::951463557399:role/cast-eks-siemenstest-siemenstest-1-cluster-role-36575565` | Same pull |
| Nodes now | **6** — 5× r6a.large + 1× m5a.xlarge, eu-west-1a/1b; **0 CAST AI-managed** | GET …/nodes, pulled 16:59:59Z |
| Deployer principal | `assumed-role/siemenstest-siemenstest-ir-admin/samuel` | Repo: labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md |
| IAM actions that failed Sep 25 | `iam:PutRolePolicy` (403, identity-policy gap) | Same repo file |
| IAM actions that failed Oct 9 | `iam:GetInstanceProfile`, `iam:TagInstanceProfile`, `sts:GetCallerIdentity` (+ earlier `ec2:TagInstanceProfile` misattribution on the call — tagging an instance profile is an **iam:** action) | Granola db4f0e91 summary+transcript |
| Official operator-side preflight list (autoscaler install) | **31 actions**: `sts:GetCallerIdentity`; EKS: `DescribeCluster`, `ListNodegroups`, `DescribeNodegroup`, `ListAccessEntries`, `CreateAccessEntry`; IAM roles: `GetRole`, `CreateRole`, `UpdateAssumeRolePolicy`; instance profiles: `GetInstanceProfile`, `CreateInstanceProfile`, `AddRoleToInstanceProfile`; IAM policies: `ListPolicies`, `GetPolicy`, `CreatePolicy`, `ListPolicyVersions`, `GetPolicyVersion`, `CreatePolicyVersion`, `DeletePolicyVersion`, `AttachRolePolicy`, `PutRolePolicy`, `ListAttachedRolePolicies`, `CreateServiceLinkedRole`, `PassRole`; EC2: `DescribeSecurityGroups`, `CreateSecurityGroup`, `AuthorizeSecurityGroupEgress`, `AuthorizeSecurityGroupIngress`, `CreateTags`, `DescribeLaunchTemplateVersions`; `autoscaling:DescribeAutoScalingGroups` | Official script template: GET https://api.eu.cast.ai/v1/scripts/eks/onboarding.sh (HTTP 200, 1,987 lines, PERMS block lines 1318–1363), pulled 2026-10-15T17:00:54Z |
| Permissions CAST AI's own role gets (created by the script) | Managed policy `CastEKSPolicy-<cluster>`: `iam:PassRole` (to ec2 + eks services), `iam:CreateServiceLinkedRole`, `ec2:CreateTags`, `ec2:RunInstances`, `ec2:DeleteKeyPair`, `ec2:ImportKeyPair`, `ec2:DescribeCapacityReservations`; inline policy: tag-restricted `ec2:RunInstances/Terminate/Start/Stop/CreateTags`, autoscaling group actions, `eks:Describe*/List*/TagResource/CreateNodegroup/DeleteNodegroup`, launch-template mgmt; AWS managed policies attached: `AmazonEC2ReadOnlyAccess`, `IAMReadOnlyAccess`; worker instance-profile role gets `AmazonEKSWorkerNodePolicy` + `AmazonEC2ContainerRegistryReadOnly` | Same script, lines 640–650, 775, 942 |
| ⚠ Policy-doc gap to expect live | `iam:TagInstanceProfile` failed on Oct 9 but is **not** in the current script's preflight list → keep it (and `iam:TagRole`, `iam:RemoveRoleFromInstanceProfile`, `iam:DetachRolePolicy`, `iam:DeleteRole` from the Terraform path) in the paste-ready policy so prod mirroring doesn't rediscover it | Granola db4f0e91; repo docs/castai/terraform-e2e.md §5.1 |
| Docs to cite on the call | https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/connect-with-castctl · https://docs.cast.ai/docs/autoscaler-checklist (docs SPA — script template above is the machine-readable equivalent) | docs.cast.ai nav, fetched 2026-10-15 |
| Samuel's email confirmation of the final Oct-9 run | **Not found** in Granola (searched Oct 10–15) | Granola search, 2026-10-15 |

---

## 4. Open action items (owner → item → status)

1. **Samuel Frunza-Hincu → email confirmation that the final Oct-9 Helm run completed** → **overdue / unverified.** No email found in searchable notes. Live API says agent online + reconcile ok, 0 CAST-managed nodes → likely "installed, not yet configured".
2. **Samuel → IAM policy mirroring prep for production cluster** → agreed Oct 9: prepare but **do not deploy** until dev validated. Prep status unverified.
3. **Ebrahim → send recurring weekly invite (same slot)** → committed Oct 9; this meeting exists on the calendar, so done (invite itself unverified but implied).
4. **Fan Yang / org-admin (unnamed cluster owner) → CAST AI console invite for Samuel to org IT DF COL UC 2** → open since Sep 25; still no console access as of Oct 9 (screen-share driven). CAST AI-side org API key is read-only — cannot invite; customer-side org-admin action.
5. **Cluster owner (unnamed) → token rotation once onboarding stabilizes** → flagged Sep 25 (token circulated via plaintext email) and again relevant Oct 9 (new token pasted in Teams chat). Old token stays valid ≥60 min post-rotation; on rotation update the `castai-credentials` secret and restart all components.
6. **Ebrahim → configuration walkthrough on dev** → deferred from #4, this meeting's main agenda. Conservative first-activation scope recommended (rebalancing/spot/hibernation OFF; startup-delay set; StatefulSets excluded).
7. **Team → resolve region/profile ambiguity** → Sep-25 notes mention us-east-1/EUS1 nodes; API + all 6 current nodes say **eu-west-1**. One profile with both kubectl + AWS access still Samuel's environment debt.

---

## 5. Questions to ask in the meeting (quotable)

1. "Samuel — did the final October 9th Helm run actually finish green? We never got the email confirmation. For what it's worth, our side shows the agent online and the reconciler healthy, so I just need your yes."
2. "On your screen, do you now see both checkmarks — cluster optimization and workload autoscaler — as installed, and is anything still pending in the CAST AI agent logs?"
3. "Which AWS profile and region is the authoritative one on your side now — account 951463557399, role siemenstest-siemenstest-ir-admin, eu-west-1? Let's write that one down and kill the split-profile problem for good."
4. "Who exactly holds the CAST AI console access for the IT DF COL UC 2 org — and can we get Samuel invited today so he stops working blind through screen-shares?"
5. "For production: is the prod account's IAM setup — permission boundaries, SCPs — identical to the test account's, or do we need a policy diff reviewed by someone on the Siemens side?"
6. "Which production cluster are we mirroring to, in which account and region — and who reviews the final IAM policy document before it's applied there?"
7. "If dev stays stable after today's walkthrough, what date are we targeting for the production deployment?"
8. "Before we touch production, can we rotate the cluster token once? It's been shared over email and Teams chat twice already."
9. "For the walkthrough: which workloads on the test cluster are safe first candidates for autoscaling — anything stateful or disruption-sensitive we should exclude from day one?"

---

## 6. Risks / watch-outs

- **Confirmation gap:** the Oct-9 "final run" was never confirmed; treat as *probably installed* (agent online, reconcile ok) but verify live with Samuel before starting the walkthrough — the walkthrough itself will surface the truth.
- **No CAST-managed nodes yet** (0 of 6): nothing has actually been optimized; first node-provisioning attempt may hit *new* IAM edges (instance-profile tagging failed on Oct 9; `eks.instanceProfileArn` in our record is still empty — node configuration not yet created).
- **Policy drift into prod:** Samuel builds IAM policies by hand from old snippets — that behavior caused three mid-install failures on Oct 9. Mitigation: deliver ONE complete paste-ready policy document (§3 row "Official operator-side preflight list" + the observed extras), and have the same document reviewed for prod before mirroring.
- **Token expiry recurs every session** (Sep 25, Oct 9). Mint a fresh one *before* the call; if a previous token is still cached anywhere, expect 401s; old tokens linger valid ≥60 min.
- **Samuel has no console access** and works from a containerized K9s env with split profiles — every step is screen-share + chat-paste driven; slow, error-prone, and the chat history has been lost before (Sep 25).
- **Prod environment may differ:** separate Siemens engagement (DI FA vLab, Oct 5) hit explicit *permissions-boundary* denies on role creation — a different IAM mechanism than UC 2's identity-policy gaps. If the UC 2 prod account carries boundaries/SCPs, the test policy document will not port 1:1.
- **Nobody from Siemens-owning side may attend:** Malika (approver) missed #4; a prod deployment date shouldn't be promised without Siemens sign-off.
- **Don't quote savings yet:** recommendations need ~1 week of workload history after first activation; the cluster has zero CAST-managed nodes today.
- **Do not conflate** this engagement with: IT DF COL UC (org with 0 clusters), Siemens Dev vLab series (Vijay/Paras, umbrella-chart migration, Sep 28), or the DI FA vLab DaemonSet/boundary cases (Oct 2–5).

---

## 7. Tonight's prep checklist

1. **Re-pull the cluster before bed or 08:00 tomorrow:** `GET https://api.eu.cast.ai/v1/kubernetes/external-clusters` (headers X-API-Key + X-CastAI-Organization-Id: 2b9d9744-f37d-4a22-b9c6-2f1857a5417d) → confirm agentStatus still online; then `GET …/36575565-7149-431b-b5f6-71f43f18ef3f/nodes` → check if any node became CAST-managed overnight.
2. **Prepare the one-page IAM policy document** for hand-paste: the 31-action operator preflight list (from the official onboarding script template, saved locally at /tmp/onboarding-eks.sh lines 1318–1363) **plus** the observed extras: `iam:TagInstanceProfile`, `iam:TagRole`, `iam:RemoveRoleFromInstanceProfile`, `iam:DetachRolePolicy`, `iam:DeleteRole` — scoped to `arn:aws:iam::951463557399:role/cast-*` & instance profiles where possible. Store it as a clean .json ready to paste (do not email it — chat on the call).
3. **Mint a fresh cluster token** via console.eu.cast.ai → org IT DF COL UC 2 → cluster 36575565 → generate; stage it in the password manager for live handover. Have the rotation runbook open (.kimchi/docs/rotate-token-manual-commands.md).
4. **Open tabs:** console.eu.cast.ai (org IT DF COL UC 2 cluster page) · https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/connect-with-castctl · labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md (exact role/ARN names) · Granola note db4f0e91 (Oct 9).
5. **Draft the conservative first-activation scope** as a short checklist: startup delay on, spot OFF, rebalancing OFF, hibernation OFF, StatefulSet + disruption-sensitive workload exclusions, min/max request constraints — ready to configure live during the walkthrough.
6. **Verify the Teams invite** for tomorrow 10:30 is the recurring one and includes the full #4 participant list (esp. Malika Hoffer — her sign-off gates any prod date).
7. **Rehearse the 60-second state summary** (from §3): "agent online, 6 nodes, none managed yet, IAM policy doc ready, token ready — today we configure dev."

---

## 8. Sources

**Granola (read 2026-10-15):**
- [Follow-up #4 — Oct 9, 2026](https://notes.granola.ai/d/db4f0e91-089b-49a0-8131-71b889d415eb) — summary + full transcript (id `db4f0e91-089b-49a0-8131-71b889d415eb`)
- [Follow-up #3 — Sep 25, 2026](https://notes.granola.ai/d/1230e87c-50c6-4c69-8330-ab8a663f7711) — summary + full transcript (id `1230e87c-50c6-4c69-8330-ab8a663f7711`)
- Granola query 2026-10-15: no Conceptboard/UC 2 activity or Samuel confirmation found Oct 10–15; follow-ups #1–#2 have no notes in range (unverified).
- Note: Granola sitewide results for "follow-up #1/#2" (Sep 21 id `3bd96503-…`, Sep 28 id `44d132c8-…`) belong to the **Siemens Dev vLab** series (Vijay Kumar / Paras Puri / Christoph Göbels, umbrella-chart migration) — a *different* engagement; excluded from the UC 2 timeline.

**Repo:**
- `labs/putrolepolicy-403/CASE-PutRolePolicy-403-conceptboard.md` — Sep-25 timeline, root cause, IAM fix JSON, CAST AI-side state
- `labs/putrolepolicy-403/MEETING-PREP-followup4.md` — #4 prep (Teams link, command sheet)
- `labs/putrolepolicy-403/REPLY-to-samuel.md` — drafted customer reply (unsent draft)
- `brain/notes/PutRolePolicy 403 Case.md` — brain precedent
- `docs/castai/terraform-e2e.md` §5.1 — operator-side IAM list (Terraform path)
- `outbox/meeting-prep/meeting-prep-2026-10-16.md` (10:30 section) — day-level consolidated prep
- `outbox/case-threads/20261005T081407Z-case.md` — DI FA vLab permission-boundary precedent (different org/account; analogy only)
- `.kimchi/docs/onboarding-demo-next-session.md` — ~1-week telemetry before meaningful recommendations

**CAST AI EU API (https://api.eu.cast.ai) — GET-only, X-API-Key [+ X-CastAI-Organization-Id where marked]:**
- `GET /v1/organizations` — HTTP 200, pulled 2026-10-15T16:59:46Z (org ids, created-dates; SI GSW CLO `07aa3c29-…` is a different org, not used here)
- `GET /v1/kubernetes/external-clusters` with org id `2b9d9744-…` — HTTP 200, pulled 2026-10-15T16:59:49Z (cluster status, agentStatus online, reconcileInfo, isPhase2, assumeRoleArn)
- `GET /v1/kubernetes/external-clusters/36575565-7149-431b-b5f6-71f43f18ef3f/nodes` — HTTP 200, pulled 2026-10-15T16:59:59Z (6 nodes, 0 CAST-managed)
- `GET /v1/cost-reports/clusters/36575565-…/resource-usage` — HTTP 200, pulled 2026-10-15T17:02:18Z (14 vCPU/96 GiB provisioned, 10.2 vCPU requested)
- `GET /v1/scripts/eks/onboarding.sh` — HTTP 200, pulled 2026-10-15T17:00:54Z (official script: operator PERMS block L1318–1363; CastEKSPolicy JSON L649; inline cluster policy L648; managed-policy attachments L942; role naming L640)

**Official docs:** https://docs.cast.ai/docs/cloud-permissions · https://docs.cast.ai/docs/connect-with-castctl · https://docs.cast.ai/docs/autoscaler-checklist · module source: github.com/castai/terraform-castai-eks-role-iam (policy JSON is server-generated per cluster via `castai_eks_settings`).

# Meeting 3 — SIEMENS x Cast AI | SMO Railigent X — 12:30 PM

**Friday 2026-10-16, 12:30 (Europe/Riga)** · Series: Siemens account cadence · Compiled Thu 2026-10-15 ~20:05 Riga · All sources read-only (Granola notes, repo docs, live GET-only CAST AI EU API).

---

## 1. Meeting snapshot

**Purpose (from Ebrahim's email context, unverified):** review the already-onboarded SMO Railigent X clusters; align the September Workload Autoscaler (WOOP) value story; agree points of contact during an upcoming time-off window; define next steps. No Granola note exists yet for this meeting — attendee list below merges the email context with the SMO-RI-CSX-CS weekly-series roster.

**Confirmed / likely participants:**

| Name | Side | Email | Basis |
|---|---|---|---|
| Christoph Goebels | Accenture (embedded at Siemens) — meeting organizer | christoph.goebels@accenture.com · christoph.goebels.ext@siemens.com | Email context (set up the meeting); Granola roster everywhere |
| Andreas Schieb | Siemens (SMO — Railigent X cluster owner/lead) | andreas.schieb@siemens.com | Email context; verified via cluster tags on k8s-andreas (`owner`, `TeamName: railigent-devops-enabler`, `org:unit: SMO CS DS MAC-DOP DEV`, `InvoiceTo: DE-K8SX`) — `outbox/savings-cases-2026-10-08/raw/d03690cb/01-cluster.json` |
| Fan Yang | Accenture | f.m.yang@accenture.com | Oct-14 SMO-RI weekly (Granola 056db3bf) — runs the Azure onboarding track |
| Fabian Jennrich | Accenture | fabian.jennrich@accenture.com | Siemens cadence-call roster |
| Tahmid Shibly | Accenture | tahmid.shibly@accenture.com | Siemens cadence-call roster |
| Sunil Bandi | Siemens (SMO-RI-CSX) | sunil.bandi@siemens.com | Oct-14 weekly — drove the Azure test-cluster connect |
| Georgi Markov | Siemens (FT RPD SWA) | georgi.markov@siemens.com | Oct-14 weekly |
| John Doyle | Siemens (IT IPS TE) | john.doyle@siemens.com | Oct-14 weekly |
| Ashwini Hebbar / Ashik N / Snigdha Athaiya | Siemens (SMO-RI-CSX-CS) | …@siemens.com | Oct-14 weekly roster (Granola 056db3bf) |
| Ebrahim Ramadan | Cast AI (customer engineer, host) | ebrahim@cast.ai | — |
| Ahmed Khaldi | Cast AI (TAM) | ahmed.khaldi@cast.ai | Weekly-series note-taker |

Coverage/escalation model on record (Aug–Sep planning, Granola 642192a4 Sep 1): Ebrahim covers Mon/Fri slots, mid-week covered by a substitute; Ebrahim CC'd on all invites as fallback; escalation Aleksy Zaleński (SA) → Carl Gridley (account). Whose time off this meeting covers is **unverified** — confirm live (Question 3).

---

## 2. Where we stand — verified facts

**Estate (live API, pulled 2026-10-15 17:00–17:03 UTC):**
- Org **SMO Railigent X** = `f15f33b9-20ad-4128-8289-da529844d3f0`, child org of the Siemens AG tree; exists live (`GET /v1/organizations`, 131 orgs, pull 17:00Z).
- **10 clusters** (`GET /v1/kubernetes/external-clusters` + `X-CastAI-Organization-Id`, pull 17:01Z): 9 EKS (7 in eu-central-1, 2 in ap-south-1) all `ready`/`online`, 7 of them literally named `k8s` (distinguish by id), plus `staging`, `k8s-andreas`; **`rhx-test` (anywhere provider) is `disconnected` since 2026-06-20** — never installed (`agentStatus=disconnected`, 0 cost items).
- **Node management is 100% Karpenter/read-only across the org.** `GET /v1/cost-reports/clusters/{id}/savings` returns **HTTP 400 "cluster is read-only" for all 10 clusters** (Sept window, pull 17:02Z) — expected, not an error; the classic node-savings API is unavailable on this estate by design.
- **No baseline records exist for 9 of 10 clusters** (`GET …/baseline-params` → nginx 404, pull 17:02Z) — consistent with WOOP-only operation (no node track to baseline against). Only k8s-andreas has one.

**k8s-andreas anomaly — fix verified live:**
- Oct 12: Siemens escalated $158,738 "savings" on $754 actual — root-caused to an INDUSTRY_AVERAGE baseline frozen over a 24h window (2026-04-15→16), locking **×169.58 CPU / ×35.44 RAM** overprovisioning factors (≈$4.8k/day phantom on a ~$26–55/day cluster). Filed as **CSU-6233**; fix **merged** (Mateusz Ledwoń), savings recalculated. Source: `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md`; `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md`.
- **Live re-pull 2026-10-15 17:02Z:** k8s-andreas baseline-params now `baselineType=CLUSTER_HISTORY`, **×1.8825 CPU / ×1.5051 RAM**, $0.0170575/CPU-core-hr, `updateTime=2026-10-14T12:29:20Z` — the recalculation is in production. Watch-out: the baseline window itself is still the same 24h (2026-04-15→16); factors are sane now, the window choice is unchanged.

**WOOP value story (the clean track — measured independently of nodes):**
- Per-cluster calendar-September WOOP dollars **cannot be pulled with GET-only calls**: the Value Realization report is POST-only (`:runValueRealizationReport`), and the classic savings GET 400s on all 10 clusters (verified above). **$8,513.97 across 8 clusters therefore stands as source = Ebrahim's email highlight, unverified-by-API.**
- Closest API-verified corroboration (POST VR report run by Ebrahim on 2026-10-08, window **2026-09-05→10-05**, raw: `outbox/savings-cases-2026-10-08/raw/org-railigentx/06-org-value-realization-30d.json`): **WOOP total $8,983.35 across 9 clusters ≈ 14.0% of $63,959.05 actual spend**. Per cluster: d0c7a7a5 $2,678.93 · 4952c4ce $2,267.45 · cf62a8e1 $1,816.26 · k8s-andreas $619.45 · ae3e22a4 (staging) $431.69 · f8dd5b4f $431.26 · 0e277bb2 $369.35 · 7eb37770 $200.99 · 5771ec22 $167.95. Excluding k8s-andreas → **$8,363.90 across the 8 pure-WOOP clusters** — consistent in magnitude with the email's $8,513.97 (different window: 30d vs calendar-Sept).
- **12-month cumulative WOOP savings: $28,900.31** (org timeline, same Oct-08 pull). WOOP track active since **2026-04** (first dollar coincides with k8s-andreas activation); node track since 2026-05. The same pull's 12m node figure ($707,231.59) is pre-fix and k8s-andreas-contaminated — **do not quote**.
- **September actual spend per cluster** (`GET /v1/cost-reports/clusters/{id}/cost`, 2026-09-01→10-01, pull 17:03Z): 4952c4ce **$26,732.92** (avg 1,041 vCPU) · d0c7a7a5 **$20,733.17** (862) · cf62a8e1 **$18,981.18** (655) · staging $1,925.37 (58.6) · k8s-andreas $1,449.83 (44.1) · 5771ec22 $949.14 (64.2) · 0e277bb2 $900.92 (26.6) · 7eb37770 $887.41 (53.3) · f8dd5b4f $875.01 (25.7) · rhx-test $0 (no items). **Org total: $73,434.94.**

**WOOP operational maturity (GET-only audit, 2026-10-05, `.kimchi/docs/woop-status-console-org-2026-10-05.md` + `console-org-woop-enablement-2026-10.md`):**
- **85–97% of workloads VPA-optimized** fleet-wide; CPU requests cut **−36%…−78%**. RAM **upsized** on d0c7a7a5 (+2.2%) and 4952c4ce (+50%) — VPA fixed under-provisioning; never sell RAM savings on these two.
- **Andreas Schieb is personally the activation driver**: the only human who ever flipped policies `readonly→managed` org-wide — k8s-andreas 2026-04-14 15:31 (single), then three 90-second bulk waves: 06-24 (4952c4ce), 07-02 (d0c7a7a5, f8dd5b4f, 7eb37770), 07-14 (5771ec22, cf62a8e1, 0e277bb2). Customer-workload applies began seconds after each flip (verified at payload level).
- **Agent drift: 7 of 9 clusters run WOOP agent v1.2.5 vs current v1.14.1** (13 minors behind; blocks scopedRecommendations ≥v1.11.0). staging + k8s-andreas on v1.10.0.
- 9 of 10 clusters run Karpenter (`SELF_HOSTED`); 8 of 9 carry `kent_enabled=true` (Karpenter Enterprise suite); 0e277bb2 is kent `NOT_SUPPORTED`. Rebalancing flakiness on staging/d0c7a7a5/5771ec22 noted Oct 5; CLM feature flapping org-wide (platform noise, support question open).
- Benchmark insight: 5771ec22 = Karpenter+WOOP with zero applied changes = natural control group; best effect clusters: k8s-andreas (applying since Apr 14), staging (since May 27).

**Siemens-side reporting rules already agreed (Granola 02150355 Sep 29 · 13c0a426 Oct 5 · f96617c9 + 150ba07d Oct 12):**
- Value Realization V1 beta = the official savings methodology (matches console; accounts for workload change).
- Oct-12 decision: **exclude Karpenter/Enterprise Suite clusters from node-level savings reports** (k8s-andreas effect). WOOP savings on these clusters are tracked **separately** and are the defensible proof point.
- **Never sum WOOP + node autoscaler savings** — VR `totalSavings == autoscalerSavings` (WOOP already inside). Siemens counts savings only for a cluster's **first 12 months** (Railigent X oldest connection 2026-02-04 → window ends ~2027-02-04).
- Enterprise September headline: ~$300K gross → exclude Karpenter/ES → **$131K**; CLUSTER_HISTORY-only → ~$121K net headline (all-Siemens). September Siemens report earlier quoted ~$59–60K gross / ~$19K net / ~$32K excl. negatives, with read-only Karpenter clusters contributing ~$10K attributed to WOOP; **use-case classification for WOOP-only Karpenter savings still unresolved** (UCs 20/515 don't cover it; new category may be needed — Bosko alignment).

**Adjacent track — SMO-RI-CSX-CS Azure onboarding (Granola 056db3bf Oct 14 + transcript):**
- First Azure test cluster connected live on the call after two root-caused blockers: (1) Windows single-quote vs double-quote around the org ID (typo-level fix — use double quotes on Windows); (2) app-registration/SPN flow unsupported → workaround = console script + `CASTAI_IMPERSONATE=true`, Linux/macOS only. Azure eventual-consistency retries are expected.
- **28 more Azure clusters pending** once the test cluster proves stable; workload + node autoscaling installed; reconcile + Cast node-pool creation up to ~30 min/cluster. Next: Fan to sync with Sunil next week (week of Oct 19).
- Live org check (17:03Z): SMO-RI-CSX-CS = `f2806a31-e339-4309-ba5a-e2518d1623d8`, **34 clusters (30 AKS + 4 EKS), 32 online**.
- Future default auth: managed identity (Siemens side) federated with Cast GCP service account — no keys, no app registrations; castctl + Terraform support **in progress, no GA date**.

**Commercial framing already on record:** SI + SMO onboarding positioned Cast AI as **20–30% savings on top of Karpenter** with read-only as the low-risk entry; autoscale priced at **€5/vCore/month** (Granola 0bf68990 Aug 17). Siemens pays for WOOP even where node savings aren't generated (Granola 18e3523c Sep 11) — exact WOOP-only fee basis for Railigent X **unverified** (Question 8).

---

## 3. Key numbers & facts to quote

| Item | Value | Source |
|---|---|---|
| September WOOP savings, SMO Railigent X | **$8,513.97 across 8 clusters** — **unverified-by-API** (GET-only pull impossible: VR report is POST-only; classic savings GETs 400 on all 10 clusters) | Ebrahim's email highlight |
| Corroborating WOOP figure | $8,983.35 across 9 clusters (30d window 2026-09-05→10-05) ≈ **14.0% of actual spend**; $8,363.90 excl. k8s-andreas | VR raw pull 2026-10-08: `outbox/savings-cases-2026-10-08/raw/org-railigentx/06-org-value-realization-30d.json` |
| 12-month cumulative WOOP savings | **$28,900.31** (clean track, active since 2026-04) | Same Oct-08 pull, `07-org-timeline-12m.json` |
| September actual spend, org total | **$73,434.94** (rhx-test $0) | GET `/v1/cost-reports/clusters/{id}/cost`, pull 2026-10-15 17:03Z |
| Top-3 spend clusters (Sept) | 4952c4ce $26,732.92 · d0c7a7a5 $20,733.17 · cf62a8e1 $18,981.18 (≈90% of org spend) | Same GET pull 17:03Z |
| WOOP 30d savings, top-3 | d0c7a7a5 $2,678.93 · 4952c4ce $2,267.45 · cf62a8e1 $1,816.26 | Oct-08 VR pull |
| VPA adoption / request effect | **85–97%** workloads optimized; CPU −36%…−78%; RAM **up** +2.2% (d0c7a7a5) / +50% (4952c4ce) | `.kimchi/docs/woop-status-console-org-2026-10-05.md` (Oct-05 pull) |
| k8s-andreas baseline, fixed | ×169.58 → **×1.88 CPU**, ×35.44 → **×1.51 RAM**, `CLUSTER_HISTORY`, recalculated 2026-10-14T12:29:20Z | GET baseline-params, pull 2026-10-15 17:02Z (before: `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md`) |
| k8s-andreas pre-fix phantom | $158,738 VR "savings" on $754 actual (≈$4.8k/day on a ~$26/day cluster) — excluded from all reports | Granola 150ba07d Oct 12; case doc |
| WOOP activation | Andreas Schieb, 4 flip events: 04-14 + 3 bulk waves 06-24 / 07-02 / 07-14 | `.kimchi/docs/console-org-woop-enablement-2026-10.md` (payload-verified) |
| WOOP agent currency | 7/9 clusters on **v1.2.5**; latest **v1.14.1** | `.kimchi/docs/console-org-woop-enablement-2026-10.md` |
| Classic savings API behavior | **HTTP 400 "cluster is read-only" on all 10 clusters** (expected on Karpenter/read-only estate) | GET `/v1/cost-reports/clusters/{id}/savings`, pull 17:02Z |
| Rule: never sum tracks | VR `totalSavings == autoscalerSavings`; WOOP already inside | `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md`; Granola f96617c9 |
| Rule: 12-month counting | Savings counted only first 12 months per cluster (oldest Railigent X connection 2026-02-04) | Granola 02150355 Sep 29 |
| Enterprise September headline | ~$121K net (all Siemens orgs, CLUSTER_HISTORY-only, fees deducted) | `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md` |
| Azure onboarding (SMO-RI-CSX-CS) | 1 test cluster connected Oct 14; **28 more pending**; `CASTAI_IMPERSONATE=true` + console script, Linux/macOS only | Granola 056db3bf Oct 14 + transcript |
| SMO-RI-CSX-CS live inventory | 34 clusters (30 AKS + 4 EKS), 32 online | GET external-clusters, pull 17:03Z |
| Railigent X inventory | 10 clusters: 9 EKS online (7×eu-central-1, 2×ap-south-1) + rhx-test disconnected | GET external-clusters, pull 17:01Z |

---

## 4. Open action items (owner → item → status)

| Owner | Item | Status |
|---|---|---|
| Fan Yang (Accenture) | Sync with Sunil to complete Azure test-cluster configuration | Scheduled — week of Oct 19 (Granola 056db3bf) |
| Sunil Bandi / SMO-RI-CSX team | Onboard remaining **28 Azure clusters** via console script + `CASTAI_IMPERSONATE=true` (Linux/macOS only) | In progress — first cluster live Oct 14 |
| Cast AI eng (Illia Litovchenko) | castctl native impersonation flow + Terraform support for managed-identity auth | In progress, no GA date (Oct-14 transcript) |
| Andreas Schieb (Siemens) | Nominate a non-prod cluster for CAST AI **node-autoscaling/rebalancing pilot** + success criteria | Open — proposal tomorrow (suggest `staging` or `f8dd5b4f` preprod) |
| Andreas Schieb / Railigent team | **WOOP agent upgrade v1.2.5 → v1.14.1** on 7 clusters (unlocks scopedRecommendations) | Open — owner to be named tomorrow |
| Railigent team | Offboard/clean up `rhx-test` (disconnected since 2026-06-20, never installed) | Open — recommend closure |
| Ebrahim | Re-verify Sept per-cluster WOOP dollars (VR report, calendar-Sept window) and reconcile $8,513.97 vs $8,363.90/30d | Open — needs POST VR (or console UI); GET-only was impossible today |
| Aleksy Zaleński (Cast AI SA) | SALP-129 savings-trust RCA + customer-facing cluster-by-cluster walkthrough; get-well plan with Carl + Ebrahim | In Progress (Jira, per Oct-15 briefing) |
| Bosko Corak + Ebrahim | Use-case/category classification for WOOP-only Karpenter savings (UC 20/515 don't cover; new category?) | Open (Granola 13c0a426 Oct 5) |
| Christoph Goebels | Time-off window: exact dates + point-of-contact matrix | Open — agenda item tomorrow |

---

## 5. Questions to ask in the meeting

1. "Can we walk through the eight clusters you have onboarded and confirm the September Workload Autoscaler number you are comfortable putting your name to — from our side it is $8,513.97, achieved with zero node autoscaling?"
2. "Which cluster do you nominate for the node-autoscaling pilot — our suggestion is `staging` (about $1,900/month of spend, agent already near-current) or the `f8dd5b4f` preprod cluster — and what does success need to look like after four weeks for you to take it to production?"
3. "For the upcoming time off: what are the exact dates, who is primary on your side, and if something breaks, do we route through Christoph and Fan or do you want a direct line to us?"
4. "Who owns the Workload Autoscaler agent upgrade window on your side? Seven of nine clusters are on v1.2.5; v1.14.1 unlocks scoped recommendations at no extra cost — it is the cheapest improvement available to you."
5. "k8s-andreas was recalculated on October 14 — the baseline factor dropped from 170× to 1.9× and the inflated figures are gone. Do you want a short walkthrough of which historical reports to disregard so nobody re-quotes them internally?"
6. "Do you want the September Workload Autoscaler figure included in the Siemens management report — and if so, on the Value-Realization basis, consistent with the October-12 decision to exclude Karpenter clusters from the node-level report?"
7. "Adoption is at 85–97% of workloads on the onboarded clusters — what blocks the remaining 3–15%, and should we raise the optimization aggressiveness on the non-prod clusters?"
8. "Can we confirm how the Workload-Autoscaler-only clusters are billed on your contract — per optimized vCPU or another basis — so the net number we quote next month is beyond dispute?"
9. "rhx-test has been disconnected since June 20 — shall we offboard it so your Railigent X dashboard shows only real estate?"

---

## 6. Risks / watch-outs

1. **$8,513.97 is email-sourced, unverified-by-API.** If challenged tomorrow, say the per-cluster table comes from the Value Realization report and offer to re-run it live — do not improvise a per-cluster split. Corroboration in hand: $8,983.35 (9 clusters) / $8,363.90 (8 clusters excl. k8s-andreas) over 2026-09-05→10-05.
2. **Never sum WOOP + node savings.** VR `totalSavings == autoscalerSavings`; the WOOP figure is already complete on its own. Summing destroyed credibility twice this month ($530K FY26 report, k8s-andreas $158K).
3. **Never quote k8s-andreas pre-fix node figures** ($150,024 30d / $707,232 12m — phantom, pre-CSU-6233-fix). The recalculated baseline is live since 2026-10-14 12:29Z, but the recalculated *savings* numbers were not pullable GET-only tonight — no new node figure may be quoted.
4. **Classic API 400s are expected, not an incident.** All 10 Railigent X clusters return "cluster is read-only" on the legacy savings endpoint — anticipate the question if anyone re-runs old scripts (Ralf/Sergej pattern).
5. Don't sell RAM savings on **4952c4ce (+50%)** and **d0c7a7a5 (+2.2%)** — VPA intentionally upsized memory there.
6. **Baseline window still 24h** on k8s-andreas (factors fixed, window not) — if asked for a cleaner baseline, the answer is a custom-period recalculation (`:recalculate` exists; needs CAST AI side).
7. WOOP savings views are limited in Karpenter mode ("Show Trend" proxy) — pre-answer the console-navigation question (Granola 18e3523c).
8. Rebalancing flakiness on staging and CLM org-wide config flapping (Oct-05 observations) are open platform questions — don't get drawn into promising dates.
9. The remaining 28-cluster Azure rollout depends on a workaround (`CASTAI_IMPERSONATE`), not GA functionality — no castctl/Terraform dates exist.
10. If the management-report discussion merges Railigent X with the enterprise headline (~$121K), keep the bases separate: WOOP-only number for this org, CLUSTER_HISTORY-only net for the enterprise.

---

## 7. Tonight's prep checklist

1. **Verify the $8,513.97.** Re-run the org VR report for the calendar-September window — `POST /reporting/v1beta/organizations/f15f33b9-20ad-4128-8289-da529844d3f0/clusters:runValueRealizationReport` with `{"clusterIds":[…9 online ids…]}`, headers `X-API-Key` + `X-CastAI-Organization-Id` (run from the console UI or under your own approval — POST is outside my read-only mandate; today I proved it cannot be done with GETs). Build the per-cluster table; reconcile vs the Oct-08 pull ($8,363.90 excl. k8s-andreas).
2. Save the Sept cost table above (§3) as the spend baseline for tomorrow — it is GET-verified with pull timestamp 2026-10-15 17:03Z.
3. Confirm with Christoph (Slack/email) the exact attendee list and the **time-off window dates + substitute names** — Granola holds no coverage note for this meeting.
4. Skim `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md` — be able to tell the bug story in 30 seconds: "24-hour industry-average window froze a 170× factor; fix merged; baseline recalculated October 14; WOOP track was never affected."
5. Draft the pilot one-pager: scope (`staging` ae3e22a4 or `f8dd5b4f` preprod), guardrails (no production clusters, no kent/Turbo changes), rollback (detach = return to Karpenter-only), success metric (node-level savings $ + disruption budget, 4-week review).
6. Prepare the agent-upgrade ask: list the 7 clusters on v1.2.5 (4952c4ce, d0c7a7a5, f8dd5b4f, 7eb37770, 5771ec22, 0e277bb2, cf62a8e1) and the v1.14.1 target.
7. Re-read this brief at 08:00; reload this page's numbers if any VR re-pull happens between now and then — **always quote VR numbers with their pull timestamp** (values recompute on read).
8. After the meeting: file a Granola note and update `brain/notes/Siemens Fleet.md` (currently stale, last refreshed 2026-09-11).

---

## 8. Sources

**Granola (meeting notes):**
- [056db3bf — CAST AI 1 to 1 | SMO-RI-CSX-CS Weekly Follow Up — Oct 14, 2026](https://notes.granola.ai/d/056db3bf-5b0d-45c6-b9c7-efb21a7ec49e) (summary + full transcript: quote fix, CASTAI_IMPERSONATE workaround, 28 clusters pending, Fan↔Sunil next week)
- [150ba07d — [Urgent] Cast AI: Cost and Savings Calculation — Oct 12, 2026 17:00](https://notes.granola.ai/d/150ba07d-75f8-47f5-b324-e4aff6d780b0) (k8s-andreas flag; exclude Karpenter/ES decision)
- [f96617c9 — [Urgent] Cast AI: Cost and Savings Calculation — Oct 12, 2026 15:30](https://notes.granola.ai/d/f96617c9-cbc2-4cd9-ac27-0b2ae683d501) (VR V1 beta = official methodology)
- [13c0a426 — cast.ai and siemens discounts — Oct 5, 2026](https://notes.granola.ai/d/13c0a426-6186-41c1-a765-29bcbbc663e0) (Sept report ~$59–60K gross/~$19K net; Karpenter ~$10K WOOP; classification gap)
- [18e3523c — WOOP + Karpenter model / HyperCat — Sep 11, 2026](https://notes.granola.ai/d/18e3523c-8468-4e6f-9db4-56bfd6e451ee) (read-only definition; WOOP on top of Karpenter; limited savings view)
- [02150355 — Cast.AI baseline scaling — Sep 29, 2026](https://notes.granola.ai/d/02150355-46dd-440d-b409-121f7890f4b8) (12-month rule; CPU+RAM basis; start date per cluster from API)
- [0bf68990 — Cast AI Onboarding Session SI + SMO — Aug 17, 2026](https://notes.granola.ai/d/0bf68990-f1d8-4833-992e-6ffa859e02c8) (20–30% on top of Karpenter; €5/vCore/mo)
- [642192a4 — Planning upcoming 2 weeks — Sep 1, 2026](https://notes.granola.ai/d/642192a4-eb91-4966-a402-bb64a61abbc1) (coverage model)
- Query-verified: **no Granola note mentions Andreas Schieb** and none contains "$8,513.97" (searched 90 days, folder 0dffa50d "Siemenes", 77 meetings Aug 1–Oct 16).

**Repo (read-only):**
- `.kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md` (enterprise headline ladder, business rules, CSU-6233/CSU-6239/SALP-129 state)
- `.kimchi/docs/2026-10-12-k8s-andreas-inflated-daily-savings-case.md` (phantom-savings RCA)
- `.kimchi/docs/console-org-woop-enablement-2026-10.md` (enablement waves, Schieb flips, agent drift)
- `.kimchi/docs/woop-status-console-org-2026-10-05.md` (adoption 85–97%, request deltas, rhx-test, anomalies)
- `outbox/savings-cases-2026-10-08/CASES.md` + `raw/org-railigentx/06-*.json`, `07-*.json` (Case-B definition; 30d WOOP table; 12m totals)
- `outbox/savings-cases-2026-10-08/raw/d03690cb/01-cluster.json` (k8s-andreas tags → Andreas Schieb identity)
- `brain/notes/Siemens Fleet.md` (org/cluster counts, 2026-09-11 xlsx refresh — stale vs live)

**CAST AI API (EU, GET-only, pull timestamps UTC 2026-10-15):**
- `GET /v1/organizations` 17:00Z — SMO Railigent X `f15f33b9…`, SMO-RI-CSX-CS `f2806a31…`, 131 orgs
- `GET /v1/kubernetes/external-clusters` (org header) 17:01Z / 17:03Z — 10 Railigent X clusters; 34 SMO-RI-CSX-CS clusters (30 AKS/4 EKS, 32 online)
- `GET /v1/cost-reports/clusters/{id}/savings` 17:02Z — 400 "cluster is read-only" × 10 (expected)
- `GET /v1/cost-reports/clusters/{id}/cost` 17:03Z — September actual cost per cluster (org total $73,434.94)
- `GET /reporting/v1beta/organizations/…/clusters/{id}/baseline-params` 17:02Z — 404 × 9; k8s-andreas 200 with recalculated CLUSTER_HISTORY ×1.88/×1.51 (updateTime 2026-10-14T12:29:20Z)
- `GET /spec/` + `/spec/reporting/openapi.yaml` 17:01Z — VR reports confirmed POST-only → September WOOP-by-cluster dollars not pullable GET-only; $8,513.97 marked unverified-by-API accordingly

# Meeting 4 — CAST AI 1 to 1 | APM0414470 SiBase X — 3:00 PM

Prep compiled Thu 2026-10-15 ~20:00 Europe/Riga for Ebrahim Ramadan (CAST AI CE). All CAST AI API data pulled GET-only from `https://api.eu.cast.ai` at the timestamps noted; Granola notes read in full where cited. Anything not backed by a source below is marked **unverified**.

## 1. Meeting snapshot

- **What:** "CAST AI 1 to 1 | APM0414470 - SiBase X - Follow Up Session #3", Fri 2026-10-16 15:00 (Europe/Riga).
- **Purpose (from email context, partially verified):** (1) Follow up on the read-only optimization review of the 4 connected EKS clusters — the provisioned-vs-actual gap is now backed by live API numbers (§2–3); (2) get the SiBase X security team's container image-signing/verification requirements captured (written summary still pending per email; **no Granola record exists**) and commit to logging a CAST AI support ticket; (3) move toward a controlled NON-PROD Karpenter-vs-CAST-AI comparison — all 4 clusters are Karpenter-Enterprise eligible as of today (§2).
- **Participants:** Confirmed host: **Ebrahim Ramadan** (CAST AI, ebrahim@cast.ai). **Likely, unverified for this specific call** (inferred from adjacent syncs in this Siemens series — Granola has no note for SiBase Follow-Ups #1/#2): Christoph Göbels (Siemens product owner; christoph.goebels.ext@siemens.com / christoph.goebels@accenture.com), Fabian Jennrich (Accenture, platform/Karpenter owner; fabian.jennrich@accenture.com / fabian.jennrich.ext@siemens.com), Tahmid Shibly (Accenture; tahmid.shibly@accenture.com / .ext@siemens.com), Fan Yang (Accenture; f.m.yang@accenture.com / yang.ext@siemens.com), Carl Gridley (CAST AI, carl@cast.ai) — all present in the Sep 21/26/28 follow-up syncs (Granola 3bd96503, 44d132c8, f078d18a). SiBase X security-team attendee names: **unknown — ask/confirm live**.

## 2. Where we stand — verified facts

- **The 4 SiBase X clusters are real, live, and monitored.** Org `da42870b-cc64-4239-b7f8-e223c32f76f8` "APM0414470 - SiBase X" holds exactly 4 EKS clusters, all `eu-central-1`, all `status: ready`, `agentStatus: online` (last agent snapshot 2026-10-15T16:58–16:59Z), all connected 2026-10-01 12:41–12:51 UTC. A second org `0c6e0c08-78f6-4f8b-b2a6-da6dfa18d77a` "SiBase X" exists but holds **zero** clusters. Source: GET /v1/organizations + GET /v1/kubernetes/external-clusters, pulled 2026-10-15T16:59:50Z.
- **Read-only posture confirmed by API:** all 4 clusters `managedBy: console`, `reconcileInfo.mode: paused`, `isPhase2: false` — matches the email's "connected in read-only mode". Same call as above.
- **Karpenter confirmed on all 4 clusters** (API attribute, pulled 2026-10-15T16:59:50Z): cluster 598b4c17 (acct 790776864453) runs Karpenter **1.10.0**; b0c2741c (992382623068), e76350af (851725572881), 9d404cbd (851725647785) run **1.14.1** — all `controllerMode: SELF_HOSTED`, all `kentEligibility: ELIGIBLE`. This verifies the email's "customer currently uses Karpenter" and means the Karpenter-Enterprise (Kentroller) pilot path needs no version upgrade on 3 of 4 clusters.
- **The provisioned-vs-actual gap is verified with live numbers** (GET /v1/cost-reports/clusters/{id}/resource-usage, 1h step, pulled 2026-10-15T17:01:30Z, latest bucket 17:00:00Z): fleet-wide **304 vCPU provisioned vs 110.7 used (36%)** and **1,888 GiB RAM provisioned vs 908.6 used (48%)**. Worst case: cluster 9d404cbd uses 1.844 of 52 provisioned vCPU (3.5%). See §3 table.
- **Estimated-savings recommendations are live for all 4 clusters** (GET /v1/cost-reports/clusters/{id}/estimated-savings, pulled 2026-10-15T17:01:39Z): current spend ≈ $8,984.77/mo; CAST AI "Layman" scenario ≈ $6,454.06/mo (-28.2%, ~$2,530.71/mo); all-Spot "SpotOnly" scenario ≈ $2,676.52/mo (-70.2%). Per-cluster table in §3.
- **Four Karpenter + CAST AI integration options were defined with Fabian Jennrich on 2026-09-28 09:30** (Granola f078d18a): (1) Karpenter alone; (2) Karpenter + CAST AI Workload Autoscaler; (3) Karpenter + CAST AI node-autoscaling add-on (Fabian's preferred example: Spot→on-demand fallback); (4) full CAST AI (node + workload autoscaler), no Karpenter. Leadership concern recorded: "don't want to manage Karpenter and Cast AI as 2 tools."
- **Option 4 already failed once at Siemens on 2026-09-30** (Granola 7e2eb50d, "Switch out Karpenter", integration cluster): Karpenter scaled to 0, NodePools imported to CAST AI node templates, initial rebalance cut provisioned CPUs ~114→~56 (7-day avg), **then** the node autoscaler provisioned undersized cheap 2–4 vCPU nodes (no min-CPU constraint set), pods restarted cluster-wide, ~25-minute downtime, Siemens management escalated and ordered full rollback to Karpenter. Remedies agreed: min CPU ≥16 in all node templates before retry; Jay Dobariya to raise a high-priority engineering ticket. Workload Autoscaler JVM policy was configured with startup metrics so JVM start-up spikes aren't read as peak.
- **JVM/startup policy doc exists:** CAST AI "Pod startup recommendations" and "JVM workload optimization" pages (docs.cast.ai/docs/woop-startup-recommendations, docs.cast.ai/docs/woop-jvm-optimization) — the ~30-minute startup-delay policy appears in prior repo prep (outbox/meeting-prep/meeting-prep-2026-10-16.md:239); exact 30-min figure **unverified** in Granola notes (Sep 30 note says "startup metrics enabled" without a number).
- **Image-signing requirement: no Granola record.** Full-note reads + two targeted queries found no SiBase X note and no mention of image signing/cosign/Notary in this series; closest adjacent precedent is 2026-09-28 "Charter <> Cast AI Kimchi Sync" (Granola 6f684649): Chainguard base images, Wiz + GoVuln scanning, SBOMs via FOSSA, and a decision that Charter would verify CAST images in its own GitLab pipeline. Treat SiBase X requirements as **pending, per email only**.
- **No published CAST AI cosign/Notary doc found** (docs.cast.ai sitemap scanned 2026-10-15): closest pages are Container Image Vulnerabilities (https://docs.cast.ai/docs/image-security), Kvisor (https://docs.cast.ai/docs/kvisor), and Platform permissions & data privacy (https://docs.cast.ai/docs/platform-permissions-and-data-privacy). Absence of a signing/verification doc strengthens the case for a support ticket.
- **Follow-Ups #1/#2 of this APM0414470 series have no Granola notes** — verified by direct query and folder listing (Siemens folder, 77 meetings 2026-08-01→10-16). Note-title collision: "Cast AI Follow Up Session #1" notes dated 2026-09-21 (3bd96503) and 2026-09-28 (44d132c8) belong to the **DI FA vLab** series, not SiBase X — do not mix them up in the call.
- **Ticket process precedent (Hypercare, 2026-09-21, Granola 22f0f422):** Teams-chat tickets must be forwarded to the Hypercare email to get a ticket ID before any replies; afterwards, reply-all on that chain. Use the same discipline for the image-signing ticket.

## 3. Key numbers & facts to quote

| Item | Value | Source |
|---|---|---|
| SiBase X org (primary) | `da42870b-cc64-4239-b7f8-e223c32f76f8` "APM0414470 - SiBase X" | GET /v1/organizations, 2026-10-15T16:59:50Z |
| Second (empty) org | `0c6e0c08-78f6-4f8b-b2a6-da6dfa18d77a` "SiBase X" — 0 clusters | same call |
| Clusters | 4 × EKS `eks-cluster`, all eu-central-1, connected 2026-10-01 | GET /v1/kubernetes/external-clusters, 16:59:50Z |
| Cluster IDs ↔ AWS accounts | 598b4c17→790776864453 · b0c2741c→992382623068 · e76350af→851725572881 · 9d404cbd→851725647785 | same call |
| Karpenter | on all 4; v1.10.0 (598b4c17), v1.14.1 ×3; SELF_HOSTED; kent ELIGIBLE ×4 | same call (attributes.karpenter) |
| Nodes now | 53 total: 6 (598b4c17), 21 (b0c2741c), 14 (e76350af), 12 (9d404cbd) | GET …/nodes, 17:00:40Z |
| Spot / on-demand | 598b4c17: 2S/4OD · b0c2741c: 0/21OD · e76350af: 0/14OD · 9d404cbd: 12S/0 | same call |
| CPU prov / req / used | 304 / 177.3 / **110.7 vCPU** (36% of provisioned) | GET …/resource-usage, 17:01:30Z, bucket 17:00Z |
| RAM prov / req / used | 1,888 / 1,451 / **908.6 GiB** (48% of provisioned) | same call |
| Biggest waste | 9d404cbd: 1.844 of 52 vCPU used (3.5%); 100% Spot already | same call |
| Current spend | $552.86 + $4,580.99 + $2,928.16 + $922.76 = **$8,984.77/mo** | GET …/estimated-savings, 17:01:39Z |
| Layman scenario | $6,454.06/mo → **-28.2% (~$2,531/mo)** | same call (22.1–56.7% per cluster) |
| SpotInstances scenario | $6,064.87/mo → -32.5% | same call |
| SpotOnly scenario | $2,676.52/mo → **-70.2%** | same call (56–78% per cluster) |
| Precedent rebalance result | Siemens integration cluster: provisioned CPU ~114 → ~56 (−51%) after CAST AI rebalance | Granola 7e2eb50d, 2026-09-30 |
| Precedent incident | undersized 2–4 vCPU nodes, ~25-min downtime, rollback to Karpenter | Granola 7e2eb50d |
| Email-only claims (no Granola/API backing) | exact wording of security requirements; attendees of #1/#2 | source=email, unverified-by-API |

## 4. Open action items (owner → item → status)

- SiBase X security team → written image-signing/verification requirements summary → **pending** (email context; no Granola record; capture live if it didn't land).
- Ebrahim Ramadan (CAST AI) → open CAST AI support ticket "[APM0414470 SiBase X] Container image signing & admission-control requirements" → **ready to log today**, capture template drafted in outbox/meeting-prep/meeting-prep-2026-10-16.md:227-235.
- SiBase X team ↔ CAST AI → decide integration option (1–4) + non-prod pilot cluster + metrics → **target of this meeting**.
- Jay Dobariya (CAST AI eng) → high-priority engineering ticket on undersized-node provisioning post-Karpenter-migration (Sept 30) → **status unknown — confirm today**.
- Anshuman Singh / Siemens platform → set min CPU ≥16 in all node templates before any Option-4 retry → open per Sept 30 notes.
- Ahmed Khaldi (CAST AI) → Karpenter vs CAST AI benchmark (was targeted ~Sept 23) → status unknown; relevant evidence for the comparison discussion.
- Ebrahim → send Fabian Jennrich the Karpenter add-on documentation link + stronger customer references (Sept 28 action) → check done.

## 5. Questions to ask in the meeting (quotable verbatim)

1. "Has the security team's written summary of the image-signing and verification requirements landed? If not, can we fill the five fields together right now — signing tool, key management, verification point, admission controller and mode, registry allow-list?"
2. "Which signing tool are you standardizing on — Cosign, Notary, or Sigstore keyless — and does verification happen in CI, at cluster admission, or both?"
3. "Which admission controller runs on these clusters today — Kyverno, Gatekeeper, something else — and would the `castai-agent` namespace need policy exemptions for CAST AI images?"
4. "All four of your clusters are Karpenter Enterprise-eligible as of this morning; for the non-production comparison, do you want Option 2+3 — Karpenter stays the provisioner and we add Workload Autoscaler plus the Karpenter add-on — or are you pushing for the full Option 4 replacement?"
5. "Which cluster is the pilot candidate? My suggestion would be to avoid the all-Spot one and the one still on Karpenter 1.10.0 — do we align versions first?"
6. "What are the pilot's success metrics — cost per requested vCPU, bin-packing density, spot-fallback recovery time — and over what window, two or four weeks?"
7. "Who owns scaling Karpenter down — and restoring it — on the pilot cluster, and what's the rollback trigger? After the September 30th incident on the integration cluster we will not touch this without min-CPU constraints and a signed-off rollback plan."
8. "Are your workloads JVM-heavy? If yes, we set startup-metric delays up front, like the JVM startup policy from the vLab work, so JVM start spikes are not read as peak utilization."

## 6. Risks / watch-outs

- **Sept 30 incident is the elephant in the room.** Any Option-4 (full replacement) proposal triggers the memory of a management escalated ~25-minute outage. Lead with Option 2+3; state plainly: full replacement only after the pilot proves out, with min CPU ≥16 in every node template, gradual rebalancing, and the open engineering ticket closed.
- **Requirements doc may not arrive before the call** — the capture template (prior prep) is the fallback; commit on the call to logging the ticket same-day and routing it via the Hypercare email flow to get a ticket ID.
- **No CAST AI published cosign/Notary position exists** — do not improvise product claims on signing; promise the ticket and an official response.
- **Cluster heterogeneity:** 9d404cbd is already 100% Spot (piloting spot-fallback there proves little); b0c2741c is 100% on-demand and the biggest spender ($4,581/mo) — the biggest demonstration prize but likely the most sensitive; Karpenter version drift (1.10.0 vs 1.14.1).
- **Don't attribute the "significant gap" to the email's unstated numbers** — use only today's live API figures (36% CPU / 48% RAM utilization of provisioned).
- **Title collision:** the Sep 21/28 "Follow Up Session #1" notes are DI FA vLab, not SiBase X — quoting them as "this series" is wrong.
- If September savings/methodology comes up sideways, quote only the restated basis (fleet savings restated $320,348.65 → $86,106.22 after the CSU-6233 baseline fix) — full detail lives in the day's general prep note, not this brief.
- JVM-heavy workloads: rebalancing without startup-delay policy caused spike-misreads before; keep the ~30-min policy recommendation (figure unverified in notes — confirm against docs before stating as fact).

## 7. Tonight's prep checklist (concrete, executable)

1. Re-run the live pulls at ~14:30 tomorrow so numbers are <30 min old: `GET /v1/cost-reports/clusters/{id}/resource-usage` (24h/1h step) + `GET /v1/cost-reports/clusters/{id}/estimated-savings` for the 4 IDs in §3, headers `X-API-Key` + `X-CastAI-Organization-Id: da42870b-cc64-4239-b7f8-e223c32f76f8`.
2. Print/keep open the ticket capture template (outbox/meeting-prep/meeting-prep-2026-10-16.md:227-235); pre-fill org id, 4 cluster IDs, Karpenter versions.
3. Have the Karpenter Enterprise links ready to paste in chat: https://docs.cast.ai/docs/karpenter-enterprise, …/karpenter-enterprise-kentroller, https://docs.cast.ai/docs/migration-from-karpenter; pilot enablement is `helm upgrade --set kent.enabled=true` per brain/notes/Karpenter + CAST AI Coexistence.md.
4. Have the security-monitoring links for the ticket discussion: https://docs.cast.ai/docs/image-security, https://docs.cast.ai/docs/kvisor, https://docs.cast.ai/docs/platform-permissions-and-data-privacy.
5. Skim Granola 7e2eb50d (Sept 30) for incident facts and f078d18a (Sept 28) for the 4-option definitions + Fabian's exact asks (docs link, customer references).
6. Check mailbox tonight for the security summary; if present, draft the Hypercare email subject `[APM0414470 SiBase X] Container image signing & admission-control requirements` so it goes out minutes after the call.
7. Confirm with Christoph Göbels / Fabian Jennrich who from the SiBase X security team is actually attending; unknown names are the #1 intel gap.

## 8. Sources

- **CAST AI API (GET-only, api.eu.cast.ai), pulled 2026-10-15:** `/v1/organizations` (16:59Z) · `/v1/kubernetes/external-clusters` w/ org header da42870b (16:59:50Z) · `/v1/kubernetes/external-clusters/{id}/nodes` ×4 (17:00:40Z) · `/v1/cost-reports/clusters/{id}/resource-usage` ×4 (17:01:30Z, latest bucket 17:00:00Z) · `/v1/cost-reports/clusters/{id}/estimated-savings` ×4 (17:01:39Z). Org 0c6e0c08 queried and empty.
- **Granola:** f078d18a (2026-09-28, EKS/AKS autoscaler comparison + 4 options, with Fabian Jennrich) · 7e2eb50d (2026-09-30, Switch out Karpenter incident) · 22f0f422 (2026-09-21, Hypercare ticket process) · 3bd96503 + 44d132c8 (DI FA vLab Follow Up #1 notes — NOT this series) · 6f684649 (Charter supply-chain sync). Folder listing 0dffa50d-aac5-4881-aa84-e7a191d2affd, 2026-08-01→10-16 (77 meetings): no SiBase/APM0414470-titled note exists.
- **Repo:** outbox/meeting-prep/meeting-prep-2026-10-16.md:195-254 (prior SiBase prep + ticket template) · brain/notes/Karpenter + CAST AI Coexistence.md (supported model, kent.enabled) · .kimchi/docs/karpenter-castai-eks-analysis.md (coexistence analysis) · .kimchi/docs/castai-api-savings-endpoints.md:37,47,62 (endpoint shapes) · cluster-cost-analysis/helios-recon-2026-10-12/ENTERPRISE-SEP26-NET-SAVINGS.md:258 (4 clusters unmanaged in Sept) · .kimchi/docs/karpenter-castai-clm-learnings.md.
- **docs.cast.ai (fetched 2026-10-15):** sitemap.xml scan — no cosign/Notary/signing page found; cited: image-security, kvisor, platform-permissions-and-data-privacy, karpenter-enterprise family, migration-from-karpenter, woop-startup-recommendations, woop-jvm-optimization.
- **Email context from Ebrahim (unverified where it conflicts):** series count (#3), security-requirements summary pending, non-prod Karpenter comparison intent. "4 read-only clusters" and "Karpenter in use" and "significant provisioned-vs-actual gap" all confirmed by API; specific email figures not re-quoted.

# Meeting 5 — Cast AI Cluster Score Review — 5:00 PM

Friday 2026-10-16, 17:00 Europe/Riga · Prepared 2026-10-15 evening (all data read-only; live GET pulls timestamped below; nothing modified anywhere).

---

## 1. Meeting snapshot

**Purpose (from email context + Oct 9 precedent):** go through the Siemens cluster list, assess the Cluster Score per cluster, and analyze savings *potential vs realized* — including reconciling the September Value-Realization report Ebrahim distributed ($14,746.76 Workload Autoscaler savings across 36 clusters, explicitly kept separate from Node Autoscaler savings to prevent double-counting).

**Participants (confirmed = attended the Oct 9 session of this exact thread):**

| Name | Email | Side | Role in this thread |
|---|---|---|---|
| Ebrahim Ramadan | ebrahim@cast.ai | Cast AI | Customer engineer, Siemens account; savings methodology + Sept VR report owner |
| Ahmed Khaldi | ahmed.khaldi@cast.ai | Cast AI | TAM; owner of the /scorecards script + score-alerting POC; Helios cost-string investigation |
| Sergej Petrovski | sergej.petrovski@siemens.com | Siemens | REST API power user, score-report author (his ~50-cluster report triggered this); standing request 2026-10-13: CC him on ALL API-related threads |

**Likely but unverified (invite not seen):** Bosko Corak (bosko.corak@siemens.com, Siemens orchestrator), Carl Gridley (Cast AI account side).

---

## 2. Where we stand — verified facts

- **Oct 9 baseline (Granola 899a37f7 + ebb1cc5a, Oct 9, summary + full transcript read):** Siemens clusters score poorly — max seen **7.9**, many at 2–3 (Sergej's red bucket = "very bad"). Sergej's report covers ~50 node-optimization-enabled clusters, red-flagging clusters where **savings < Cast AI payment**. Example quoted on the call: Helios with **$19,492 savings last month** still red-flagged by that rule.
- **Three recurring culprits for low scores, seen live in console Oct 9** (transcript, ebb1cc5a): Evictor (node downscaling) not enabled; CPU overprovisioning (example shown: 44%); Rebalancer schedule disabled. Agreed: score directly correlates with savings potential; **7+ is the realistic ceiling** given instance-family/disk constraints ("sometimes they want specific instance families, sometimes disks... complexities that make it not easy to optimize 100%").
- **Intentional opt-outs exist and must be annotated, not treated as failures** (transcript): "Some customers really don't want Evictor or node autoscaling" — e.g. GSW's stance. WOOP is **ruled out for all Siemens R&D clusters** (on-prem parity requirement; Granola a736d7c7, Oct 9 SI GSW Exchange).
- **Subscores are console + console-API only**: overall score was said on the call to be in the `/summary` API; subscores (Scorecards: Cost efficiency / Resilience / Operations split, "Opportunities for Improvement") live in the console UI and the console-internal `GET https://console.eu.cast.ai/api/v1/cost-reports/clusters/{id}/scorecards` which requires a browser session cookie — **no API-key auth** (repo: .kimchi/docs/cluster-score-schedule-api/working-endpoints.md). Ahmed committed to send his score-to-recommendation script to Sergej as a TXT (action item below). Resilience=0 on some clusters is because the reliability-matrix component isn't installed — Cost efficiency is the subscore Siemens cares about.
- **Live correction tonight (GET pull 2026-10-15T17:00:56Z / 20:00:56 EEST): the overall numeric Cluster Score IS publicly GET-able** — `GET https://api.eu.cast.ai/v1/cost-reports/clusters/{id}/summary` returns `summary.clusterScore` (string). Pulled 64 of 65 clusters across SI GSW CLO (22), CPS (2), IT IPS (24), SFS IT CDO (16); fleet max = **ngm-sim-eks 7.9 exactly** — matches Sergej's Oct 9 observation, so the field maps to the console score (formal side-by-side console comparison still open — do it live in the meeting). This **invalidates** the "numeric score is console-only" assumption in our repo notes (working-endpoints.md, score-alerting-poc README, today-20:00 master prep §17:00).
- **What is NOT GET-able:** the subscore split. The reporting spec (`https://api.eu.cast.ai/spec/reporting/openapi.yaml`, pulled 2026-10-15) carries a `ClusterScoreAPI` with GET `/reporting/v1beta/organizations/{orgId}/clusters/{clusterId}/restrictions` and `/restriction-details` — verified live (HTTP 200 on ngm-helios, returns a per-workload restriction catalogue, e.g. `missing_probes` in `kasten-io` and `siemens-digital-grid-avg` namespaces). This is the **reason catalogue** behind low scores, not numeric subscores. The only numeric efficiency-score payload sits behind **POST** `:runOptimizationsReport` — POST is forbidden by this engagement's read-only rule, so marked blocked.
- **Deep-red clusters are largely read-only-connected** (live, 2026-10-15T17:01:33Z): classic savings `GET /v1/cost-reports/clusters/{id}/savings` returns **HTTP 400 "cluster is read-only"** for ngm-vsinteg-eks, ngm-vsdev-eks, clo-master-eks, hermes-val-eks, shire-qa-eks, ngm-data-eks — no node-autoscaling engine on these, which explains both their 1.1–2.5 scores and "no savings" lines in Sergej's report.
- **Evictor state verified live** (`GET /workload-eviction/v1/clusters/{id}/config`, 2026-10-15T17:02:59Z): ngm-vsinteg-eks **enabled:false**; ngm-helios-eks and ngm-integ-eks **enabled:true**; clo-master endpoint returned HTTP 500 (state unverified via this endpoint).
- **Rebalancer right now:** latest plan per cluster (GET `/v1/kubernetes/clusters/{id}/rebalancing-plans`, 17:01:33Z): **ngm-integ-eks and ngm-kronos-eks are actively draining nodes this minute** (plans created 17:00:11Z / 17:00:06Z, status `draining_nodes`); eleX01p and iec-tcx-flat last plans 2026-09-29 status `error`; ngm-data-eks last plan 2026-08-27 status `error`; kafka-test and the five read-only clusters have **zero plans ever**. **All 13 deep-pulled clusters return `isRebalancingRecommended: true`** (estimated-savings, 17:02Z).
- **September methodology is settled (Granola f96617c9 Oct 12 15:30 + 150ba07d Oct 12 17:00):** Value-Realization V1 beta is the single source of truth; `totalSavings == autoscalerSavings` (WOOP already inside — never sum); Karpenter/Enterprise-Suite clusters excluded; never publish unexplained outliers; Siemens rule = savings counted only first 12 months per cluster; cost basis = CPU+RAM at contracted discounted prices.
- **September was RESTATED after the CSU-6233 baseline-bug fix** (k8s-andreas ×170/×35 overprovisioning from a 24h INDUSTRY_AVERAGE window; fix merged by Mateusz Ledwoń): fleet September VR savings **restated $320,348.65 → $86,106.22 across 36 clusters**; corrections were still landing 2026-10-15 (HAFAS override 09:26Z). Source: outbox master prep + email-body (compiled 2026-10-15 ~20:15) — original report artifact is Ebrahim's distributed September VR report (unverified here beyond those references).
- **The $14,746.76 Workload-Autoscaler line (36 clusters, September)** is part of that distributed report and must continue to be quoted **separately** from Node Realized Savings (source: email context + outbox email-body.txt). WOOP savings live *inside* the per-cluster totalSavings; the separate line is for visibility only.
- **Negative-net-savings mechanics documented** (repo: .kimchi/docs/2026-10-05-cps-negative-savings-case.md, 2026-10-08-cps-negative-savings-refresh.md): CPS dema-platform-services realized **+$11,689.75** September VR while its WOOP line is **−$80.91** — negative *by design* (WOOP raised under-provisioned requests); the fleet's fee basis: **SI GSW = €5 per avg-provisioned vCPU-month** (invoice-verified 1,806→€9,030; Sept basis 8,275.94 billable vCPU → €41,379.70 at €5 — the €5/$5.70 per-vCPU fee is what pushed low-score, low-savings clusters net-negative in Sergej's view); **CPS = 5% of positive gross** — never mix.
- **Helios "unit cost −14%" story verified** (repo: cluster-cost-analysis/helios-recon-2026-10-12/ + today-20:00 master prep): baseline 1.60×/2.17×, provisioned −520 vCPU July→Sept, utilization ≈9.8% of requested; classic $18,877.78 vs VR $6,667.82 both reproducible; net is fee-marginal.
- **Live rebalance = the score's biggest single lever:** executing recommended rebalances raises the score (rebalancer subscore), captures the Layman potential (below), and shrinks the €5/vCPU fee basis.

---

## 3. Key numbers & facts to quote

**Live Cluster Score table** — `GET /v1/cost-reports/clusters/{id}/summary → summary.clusterScore`, pulled 2026-10-15T17:01:09–17:01:33Z (20:01 EEST), 65 clusters pulled, 64 with scores; buckets per Sergej's Oct 9 convention (Red/Poor 0–3, Yellow/Concerning 4–6, Green/Healthy 7–10):

| Cluster (org) | Score | Bucket | Key failing signal (live GET, tonight) | Sept realized (classic GET) | Potential (Layman) |
|---|---:|---|---|---|---|
| ngm-sim-eks (SI GSW) | **7.9** | Green | — (fleet max; baseline 06-03 stale per audit) | n/a (VR $11,476.95*) | — |
| baseline-clo-eks (SI GSW) | 7.4 | Green | CSU-6239 hibernation-inflated baseline | $1,350.90* | — |
| ngm-sim2-eks (SI GSW) | 6.6 | Yellow | youngest; fix validated here | $435.43* | — |
| ngm-integ-eks (SI GSW) | 5.8 | Yellow | OP 36%; **rebalancing now (17:00Z)**; WOOP attribution open | $18,512.46 | $17,058/mo (56.1%) |
| pioneer-tcx (IT IPS) | 5.4 | Yellow | OP 62.6%** | $300.68* | — |
| ngm-helios-eks (SI GSW) | 4.8 | Yellow | util ≈9.8%; rebalance recommended, never executed | **$18,877.78** | **$23,082/mo (32.2%)** |
| dema-platform-services-test (CPS) | 8.3 | Green | WOOP covers 77/97 workloads | $213.33-month→Sept realized +$202.02 (classic n/a†) | — |
| dema-platform-services (CPS) | 4.4 | Yellow | WOOP line −$80.91 by design; 0 spot | $1,249.10 | $5,431/mo (43.2%) |
| ngm-demo-eks (SI GSW) | 2.9 | Red | — | — | — |
| ngm-test-eks (SI GSW) | 2.6 | Red | — | — | — |
| ngm-data-eks (SI GSW) | 2.5 | Red | OP 89.8%; VR −$325.39*; last plan **08-27, error** | 400 read-only | $1,481/mo (87.7%) |
| workbench-preprodeu-eks (SI GSW) | 2.5 | Red | — | — | — |
| kafka-test (IT IPS) | 2.5 | Red | OP 84%; **0 plans ever**; classic $0 Sept | $0.00 | $305/mo (75.7%) |
| bx-edex-dev-eu (IT IPS) | 2.4 | Red | — | — | — |
| shire-demo-eks (SI GSW) | 2.1 | Red | — | — | — |
| eleX01p (IT IPS) | 1.9 | Red | **VR −$3,266.77 on $12,913.98 actual**; OP 54.8%; last plan 09-29 error | $6.65 | $9,254/mo (66.9%) |
| shire-qa-eks (SI GSW) | 1.4 | Red | read-only engine; OP 55.0% | 400 read-only | $54/mo (19.9%) |
| clo-master-eks (SI GSW) | **1.1** | Red | OP 68.6%; evictor state unverified (500); **never rebalanced** | 400 read-only | $525/mo (71.9%) |
| hermes-val-eks (SI GSW) | **1.1** | Red | OP 30.1%; never rebalanced; read-only | 400 read-only | $1,361/mo (88.7%) |
| ngm-vsdev-eks (SI GSW) | **1.1** | Red | OP 93.1%; evictor OFF; never rebalanced | 400 read-only | $1,409/mo (89.4%) |
| ngm-vsinteg-eks (SI GSW) | **1.1** | Red | OP 93.1%; **evictor OFF** (live); never rebalanced | 400 read-only | $1,409/mo (89.4%) |
| iec-tcx-flat (IT IPS) | **1.1** | Red | **VR −$419.99 on $1,106.38 actual**; OP 62.6%; last plan 09-29 error | $0.00 | $791/mo (70.5%) |
| cloudcore02 (IT IPS) | — | — | **status=failed** (no score possible) | — | — |

\* from `scratch/siemens-review/sept2026-verified-per-cluster.tsv` (restated verified September, repo). \*\* eleX01p OP 54.8% is its live pull; pioneer-tcx not in tonight's deep-pull — OP% cited from earlier pulls, re-verify. † CPS realized figures are VR-basis from the CPS case docs (classic endpoint undercounts there — cloud-connect telemetry stale since 09-16). Full 64-row table available if needed; remainder: alliander-demo 3.4, iands-sales2 4.0, ngm-kronos 3.8, onboard-delivery 3.9, onboard-sales1 3.6, shire-dev 3.4 (SI GSW); eleX01 5.1/4.4, eleX01in 4.6, eagle-kafka01 4.2, staging-sec 3.6, aks-neobot ×2 3.2, dev-sec 3.2, shared01 2.9, bx-edex-int/prod 2.7, cloudcore01 2.7, mof-staging 2.7, aks-dios 2.3/2.0, ea-admin 2.2, aks-n8n 2.1/2.0, mof 2.1 (IT IPS); SFS IT CDO AKS fleet 2.4–4.2 (rg-cdo-p lowest 2.4); SMO Railigent X k8s-andreas not re-pulled tonight (VR post-fix $444.49 on $753.83 actual per TSV).

| Item | Value | Source |
|---|---|---|
| Fleet max score (Oct 9 report → tonight's pull) | 7.9 → **still 7.9** (ngm-sim-eks) | Granola 899a37f7/ebb1cc5a; API 17:01Z |
| Fleet score distribution | 1 green-ish (7.9) + 1 (7.4) + 1 ×8.3 (CPS test); bulk 1.1–5.8 | API 17:01Z |
| Sept fleet VR savings, restated | **$320,348.65 → $86,106.22** (36 clusters) | outbox master prep/email-body (post-CSU-6233) |
| Sept Workload-Autoscaler line | **$14,746.76** across 36 clusters — separate line, never summed into Node Realized | Ebrahim's distributed Sept VR report / email-body.txt |
| Sept fee basis (SI GSW) | 8,275.94 billable vCPU ≈ **€41,379.70 @ €5/vCPU-mo** | outbox master prep + invoice-verified €5 rate |
| Helios: classic vs VR Sept | $18,877.78 (GET live) vs $6,667.82 VR (TSV) | both verified |
| Helios potential | $23,082/mo Layman rebalancing (32.2%); rebalance also cuts fee basis | GET estimated-savings 17:02Z |
| eleX01p / iec-tcx-flat Sept VR | **−$3,266.77** on $12,913.98 / **−$419.99** on $1,106.38 | verified TSV + classic $6.65 / $0.00 live |
| CPS dema main Sept | realized +$11,689.75; WOOP line −$80.91 (by design) | repo CPS case docs + TSV |
| Score→savings correlation quote (verbatim, Sergej, Oct 9) | "I am pretty sure that if the score will be improved, then it will be much, much, much better also for saving." | Granola ebb1cc5a transcript |
| 7+ ceiling quote (verbatim, Ebrahim, Oct 9) | "If we reach the score of 7... we're already in a very good state... constraints... specific instance families... disks..." | Granola ebb1cc5a transcript |

---

## 4. Open action items (owner → item → status)

- **Ahmed Khaldi →** send cluster-score recommendations script to Sergej as TXT in chat (maps scorecards subscores → docs → generic recommendations) — committed Oct 9 · status unverified — ask in meeting.
- **Ahmed + Sergej →** integrate the /scorecards pull into Sergej's automation so recommendations flow to cluster owners automatically — Sergej assigned Oct 9 ("Review Cast AI console score and subscores... use the shared script") · **score-alerting POC exists** (castai-terraform-1/score-alerting-poc: cron scan, rules.py six sub-metrics, owners.py DRI mapping, dedup 24h, 17 offline tests) · POC predates tonight's score-GET discovery — should now read `clusterScore` directly instead of injected console scores.
- **Ahmed →** Helios cost-string investigation (Sergej's strings; time blocked Oct 9 1–2 PM) · status unverified — close verbally.
- **Ahmed →** CFR for cross-organization search in new UI · status unverified.
- **Ebrahim →** pull baseline date + first-rebalance per cluster (Oct 12 urgent #2) · **DONE** — table in .kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md §6.
- **Ebrahim →** September extract on restated basis ($86.1K story) before Mark · in progress; verify the Oct-12 draft email was sent.
- **Aleksy Zaleński + Carl + Ebrahim →** SALP-129: RCA for flagged clusters, cluster-by-cluster savings walkthrough, get-well plan (~2–3 days SA) · In Progress per Jira summary (user-supplied; not re-verified).
- **Cast AI engineering →** baseline-recalculation plan fleet-wide (PATCH baseline-params / POST :recalculate exist) — stale pre-fix baselines will repeat September anomalies in October · open.
- **Siemens (Fan/Cloudability owners) →** Cloudability rate-card export to pin the discount factor · open since Oct 9.
- **Sergej →** cluster-owner mapping for the DRI column (owners.py-style) · open.

---

## 5. Questions to ask in the meeting (verbatim)

1. "We verified last night that the overall Cluster Score is now GET-able per cluster from the public API — `/v1/cost-reports/clusters/{id}/summary` returns `clusterScore`, and our fleet max is still exactly 7.9. Sergej, does this unblock your automation, or do you additionally need the Cost/Resilience/Operations subscore split, which is still console-only?"
2. "Can we lock tonight's top-10 red list — clo-master, hermes-val, ngm-vsinteg, ngm-vsdev and iec-tcx-flat all at 1.1, eleX01p at 1.9, shire-qa 1.4, kafka-test 2.5, ngm-data 2.5, kronos 3.8 — each with a named DRI and a target date?"
3. "Six red clusters return HTTP 400 'cluster is read-only' on the savings API — vsinteg, vsdev, clo-master, hermes-val, shire-qa, ngm-data. Are those intentional read-only onboardings? If yes, let's annotate them so red reads as a posture choice, not a failure."
4. "ngm-integ and ngm-kronos are literally draining nodes as of 5:00 PM today. Can we use these two as the pilot evidence for enabling scheduled rebalancing on the other red clusters?"
5. "Helios: rebalance has been recommended for weeks, never executed — the estimate is $23.1K a month on the Layman path, and every rebalance also shrinks our €5-per-vCPU fee basis. What is the decision — pilot, maintenance window, owner?"
6. "eleX01p is VR-negative $3,267 in September on $12.9K of spend. Is that cluster's workload still comparable to its frozen baseline, or do we re-baseline it before it goes in front of Mark?"
7. "Confirm we all quote September on the restated basis only — $320.3K down to $86.1K across 36 clusters — with pull timestamps, and keep the $14.7K Workload Autoscaler line visibly separate, never summed?"
8. "The score-alerting POC runs read-only on an 8 AM cron and alerts the cluster owner with named sub-metrics — shall we demo it tomorrow and agree the owners mapping as the delivery mechanism?"
9. "Resilience and Operations show zero where the reliability matrix isn't installed — do we tell owners to ignore that subscore for now, or do we install the matrix?"
10. "Ahmed — is the Helios cost-string thread with Sergej's strings fully closed, or is any part still open?"

---

## 6. Risks / watch-outs

- **Don't quote pre-restatement September numbers.** VR is recomputed on read; corrections were still landing today. Every number in the meeting needs a pull timestamp.
- **Score ≠ punishment.** Several reds are intentional opt-outs (GSW: no Evictor/no WOOP on R&D, on-prem parity). Get the annotation agreed, or the DRI conversation turns adversarial.
- **clusterScore↔console mapping:** the summary field matches Sergej's "max 7.9" observation exactly, but a formal console side-by-side is still pending — do one live in the meeting before promising score-automation accuracy. Subscores remain console-only; do NOT promise subscore API automation with API keys.
- **Fee-mixing:** SI GSW €5/provisioned-vCPU-month vs CPS 5%-of-gross vs the legacy $5.70 UC21 sheet — mixing these once more will relitigate the whole trust debate.
- **eleX01p/iec-tcx-flat negative VR optics:** these are honest counterfactual negatives (VR semantics), not "money lost" — but they are the two names most likely to be quoted back at us; have the re-baseline answer ready (question 6).
- **cloudcore02 (IT IPS) is in `failed` status** — no score; separate hygiene item, don't let it derail.
- **Baseline staleness risks October repeat:** every flagged baseline pre-dates the CSU-6233 fix (fleet audit 10-14); September anomalies recur in October until recalculated/overridden — ask who triggers recalculation.
- **WOOP-attribution question on ngm-integ** (woopAdopted=true, 0/4,566 workloads managed) is open with engineering; keep the WOOP line at $0 quotes for integ until resolved.
- **Never resurface** the withdrawn ROI PDFs ($526,923 / $357,285 figures) in any customer-facing context.
- **No spot or WOOP pitch to GSW R&D** (ruled out Oct 9); no list prices to management — Siemens billed basis only (≈0.500–0.503 × CAST price sheet).
- **Classic-vs-VR dual numbers** (Helios $18,877.78 vs $6,667.82) will be quoted by the audience interchangeably; the accepted answer is: V1 beta VR is official, both are reproducible, the delta is September's workload decrease.

---

## 7. Tonight's prep checklist

1. ✅ Done: live score pull (64 clusters, 4 orgs, 17:01Z), potential vs realized pairing, read-only-classification of the deep-red six, evictor states.
2. Re-pull the same score table ~30 min before the call (scores are recomputed); freeze with timestamp and bring the CSV/screen.
3. Open the console Cluster Score page for Helios + one red cluster; confirm the console number equals the API `clusterScore` (closes the mapping question).
4. Screenshot the console score pages (incl. "Opportunities for Improvement") for the top-10 reds — subscores are console-only, no other way to show them.
5. Prepare the score-alerting POC demo: `config.example.json → config.json`, owners mapping pre-filled for the top-10, run one `scan --dry-run` and save the report (17 offline tests already green); update it to read `clusterScore` from the summary API instead of injected console scores.
6. Re-freeze the September restated totals ($86.1K / $14.7K lines) with timestamp from the post-HAFAS-override state; confirm the Oct-12 restated-basis email went out.
7. Verify fee math per contract before any net quote (€5/vCPU × 8,275.94 Sept billable vCPU).
8. CC Sergej on any API-related follow-up mail after the meeting (standing request 2026-10-13).

---

## 8. Sources

- **Granola:** [899a37f7 (Oct 9, Ahmed's capture)](https://notes.granola.ai/d/899a37f7-94af-4daf-8729-293277155a5f) + [ebb1cc5a (Oct 9, Ebrahim's capture, full transcript read)](https://notes.granola.ai/d/ebb1cc5a-255d-4c89-82fb-f5599e5b93bf) — "Optimisation KPI of onboarded Clusters"; [f96617c9 (Oct 12 urgent #1, V1-beta decision)](https://notes.granola.ai/d/f96617c9-cbc2-4cd9-ac27-0b2ae683d501); [150ba07d (Oct 12 urgent #2, $300K/$158K/$38K)](https://notes.granola.ai/d/150ba07d-75f8-47f5-b324-e4aff6d780b0); [7e8970e5 (Oct 8 FinOps daily, $70,303.78 vs $6K)](https://notes.granola.ai/d/7e8970e5-5c48-4ff5-bbd0-d5ce4984ee0c); [a736d7c7 (Oct 9 SI GSW Exchange)](https://notes.granola.ai/d/a736d7c7-7322-4eee-886d-c5894d1a9053).
- **Repo:** .kimchi/docs/2026-10-15-siemens-savings-escalation-briefing.md; .kimchi/docs/2026-10-05-cps-negative-savings-case.md; .kimchi/docs/2026-10-08-cps-negative-savings-refresh.md; .kimchi/docs/case-smo-it-in-cop-access-blank-reporting.md (RBAC/blank-reporting pattern: org-without-clusters ⇒ blanks — same class as score/reporting access questions); .kimchi/docs/cluster-score-schedule-api/{README,working-endpoints,test-results}.md; scratch/siemens-review/sept2026-verified-per-cluster.tsv (69-row restated September); castai-terraform-1/score-alerting-poc/ (Ahmed's POC); brain/notes/Siemens People.md (Sergej CC rule).
- **Outbox:** outbox/meeting-prep/meeting-prep-2026-10-16.md + email-body.txt (2026-10-15 ~20:15 compile — restated September totals, fee basis, prioritized red-cluster table).
- **Live CAST AI EU API (GET-only, all pulls 2026-10-15 16:59:50Z–17:02:59Z UTC = 19:59–20:02 EEST):** `GET /v1/organizations` (131 orgs; enterprise Siemens AG 8b69b8da); `GET /v1/kubernetes/external-clusters` per org (SI GSW CLO 22, CPS 2, IT IPS 24, SFS IT CDO 16); `GET /v1/cost-reports/clusters/{id}/summary` (clusterScore — 64 pulls); `GET /v1/cost-reports/clusters/{id}/savings?startTime=2026-09-01T00:00:00Z&endTime=2026-09-30T23:59:59Z` (Sept classic); `GET /v1/cost-reports/clusters/{id}/efficiency` (OP%); `GET /v1/cost-reports/clusters/{id}/estimated-savings` (Layman/SpotInstances/SpotOnly potential + isRebalancingRecommended); `GET /v1/kubernetes/clusters/{id}/rebalancing-plans`; `GET /workload-eviction/v1/clusters/{id}/config`; `GET /reporting/v1beta/organizations/{orgId}/clusters/{id}/restrictions` (restriction catalogue); spec checks: `GET /v1/spec/openapi.json` (no score paths), `GET /spec/reporting/openapi.yaml` (ClusterScoreAPI; numeric score only behind POST :runOptimizationsReport — blocked, POST forbidden).
