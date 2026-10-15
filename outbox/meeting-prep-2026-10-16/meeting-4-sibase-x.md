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
