# Current-Data Audit — `docs/baseline-fleet.csv`

**Subject:** `docs/baseline-fleet.csv` (241 rows × 42 cols, 57 orgs), exported from the
live v1 Streamlit app on 2026-09-21 evening. Sibling copy: `~/Downloads/castai_fleet.csv`.
**Method:** pandas via `.venv/bin/python`, read-only. CSV was NOT modified. No app code changed.
**Audit date:** 2026-09-21 (sweep timestamp inside file: `2026-09-21 17:06:37+00:00`).
**Context docs:** `docs/architecture.md`, `docs/data-model.md` (read first; subject is the CSV, not the app).

> **Shape note.** Architecture §5 documents **43 columns** for the shipped v1 fleet table
> (34 `FLEET_COLUMNS` + 7 `EXTRA_COLUMNS` + 2 `REPORT_EXTRA_COLUMNS`). The CSV carries **42**;
> the documented `overview_cost_hourly` column is missing from the export. This is not
> cosmetic — see Finding A1.

---

## 1. Column inventory (42 columns)

| # | column | dtype (pandas) | null % | unique | sample / range |
|---|--------|----------------|--------|--------|----------------|
| 1 | organization_name | str | 0.0% | 57 | 'DI IT DEX CLD', 'SI B SW', 'HAFAS H&O' |
| 2 | organization_id | str | 0.0% | 57 | UUIDs |
| 3 | cluster_name | str | **1.7% (4)** | 208 | 'gspkafka-k8s-dev', 'eks', 'renfe-prod' |
| 4 | cluster_id | str | 0.0% | **241 (all unique)** | UUIDs |
| 5 | provider | str | 1.7% (4) | 3 | eks 173, aks 63, anywhere 1 |
| 6 | region | str | 1.7% (4) | 16 | eu-central-1 115, eastus 30, westeurope 28, eu-west-1 24, us-east-1 19, …, **'unknown' ×1** |
| 7 | status | str | 1.7% (4) | 3 | ready 228, failed 8, hibernated 1 |
| 8 | agent_status | str | 1.7% (4) | 4 | online 198, disconnected 23, non-responding 8, waiting-connection 8 |
| 9 | kubernetes_version | str | **77.6% (187)** | 8 | '1.35' 21, '1.34' 19, '1.36' 7, '1.34.9' 2 (!), '1.32' 2, '1.33'/'1.34.2'/'1.31' ×1 |
| 10 | cpu_provisioned | float64 | 17.8% (43) | 75 | 4.0 … 3028.0 cores, med 40.0 |
| 11 | cpu_allocatable | float64 | 17.8% (43) | 136 | 3.56 … 2677.1, med 39.1 |
| 12 | cpu_requested | float64 | 17.8% (43) | 192 | 0.56 … 2308.162, med 19.16 |
| 13 | cpu_used | float64 | **22.4% (54)** | 182 | 0.038 … 239.9, med 1.40 |
| 14 | cpu_efficiency | float64 | 22.4% (54) | 186 | 0.0015 … 0.3712 (0–1 fraction) |
| 15 | memory_provisioned_gib | float64 | 17.8% (43) | 89 | 8 … 14128 GiB, med 128 |
| 16 | memory_allocatable_gib | float64 | 17.8% (43) | 190 | 6.43 … 10894.6, med 112.6 |
| 17 | memory_requested_gib | float64 | 17.8% (43) | 194 | 2.19 … 6651.4, med 51.3 |
| 18 | memory_used_gib | float64 | 22.4% (54) | 187 | 0.85 … 2961.8, med 26.9 |
| 19 | memory_efficiency | float64 | 22.4% (54) | 187 | 0.0112 … 0.7283 (0–1 fraction) |
| 20 | nodes_total | float64 | 17.8% (43) | 43 | 1 … 326, med 6 |
| 21 | nodes_spot | float64 | 17.8% (43) | 17 | 0 … 106, med 0 |
| 22 | nodes_on_demand | float64 | 17.8% (43) | 41 | 0 … 326, med 6 |
| 23 | nodes_fallback | float64 | 17.8% (43) | **1 (all 0.0)** | constant zero where present |
| 24 | cost_hourly | float64 | 17.8% (43) | 163 | 0.0912 … 106.23 USD/h, med 1.171 |
| 25 | monthly_cost | float64 | 17.8% (43) | 163 | 66.5 … 77,548 USD, med 855.1 |
| 26 | potential_savings_hourly | float64 | 9.5% (23) | 170 | **−2.46 … 43.93** USD/h |
| 27 | potential_savings_percentage | float64 | 10.8% (26) | 198 | **−18.22 … 0.949 (fraction scale)** |
| 28 | workload_autoscaler_status | str | 0.0% | 3 | AGENT_STATUS_UNKNOWN 182, AGENT_STATUS_RUNNING 55, 'Not installed' 4 |
| 29 | node_autoscaler_status | str | 0.0% | **1** | 'T2' ×241 |
| 30 | problematic_nodes | str | 0.0% | **1** | 'T2' ×241 |
| 31 | problematic_workloads | str | 0.0% | **1** | 'T2' ×241 |
| 32 | unschedulable_pods | float64 | 17.8% (43) | 11 | 0 … **10 672** |
| 33 | data_status | str | 0.0% | 2 | ok 198, partial 43 |
| 34 | last_updated | str | 0.0% | **1** | '2026-09-21 17:06:37+00:00' (single sweep) |
| 35 | reporting_state | str | 0.0% | 5 | READ_ONLY 160 / OPTIMIZED 38 / DISCONNECTED 32 / DISCOVERED 7 / UNSPECIFIED 4 |
| 36 | optimal_cost_hourly | float64 | 9.5% (23) | 122 | 0.0 … 74.4 (min is exactly 0.0) |
| 37 | is_phase2 | object (bool/NA) | 1.7% (4) | 2 | False 191, True 46 |
| 38 | pod_count | float64 | 17.8% (43) | 156 | 10 … 10 912, med 139 |
| 39 | nodes_unknown | float64 | 17.8% (43) | **1 (all 0.0)** | constant zero where present |
| 40 | potential_savings | float64 | 9.5% (23) | 167 | **−1 795.8 … 32 068.9 USD/mo** (= hourly×730) |
| 41 | report_period_cost | float64 | 12.4% (30) | 211 | 0.82 … 53 951.5 USD (30-day window) |
| 42 | report_cost_pct_change | float64 | 12.4% (30) | 154 | −96.6 … **+49 597.4 (0–100 scale)**; 55 rows exactly 0 |

## 2. Placeholder detection — CONFIRMED

| Column | "T2" share | Verdict |
|---|---|---|
| `node_autoscaler_status` | 241/241 = **100.00%** | Pure sentinel, zero fleet-level information ✓ (as expected) |
| `problematic_nodes` | 241/241 = **100.00%** | Pure sentinel ✓ |
| `problematic_workloads` | 241/241 = **100.00%** | Pure sentinel ✓ |

Other dominated-by-one-value columns: `last_updated` 100% one sweep timestamp (expected);
`status` = 'ready' 94.6%; `nodes_fallback` and `nodes_unknown` are **constant 0.0** in all
198 present rows (dead columns in this snapshot — keep schema, exclude from stat cards).

## 3. Sentinels — CONFIRMED with spelling corrections

- **`workload_autoscaler_status`**: AGENT_STATUS_UNKNOWN **182** (75.5%), AGENT_STATUS_RUNNING
  **55** (22.8%), 'Not installed' **4** (1.7%). Expected ~182 UNKNOWN ✓ — but the two raw
  enums are mixed with one human label ('Not installed'), style-inconsistent. The 4
  'Not installed' rows are exactly the 4 CLUSTER_STATE_UNSPECIFIED rows.
- **The quoted distribution "Read-only 160, Optimized 38, Disconnected 32, Discovered 7,
  Other 4" lives in `reporting_state`** (160+38+32+7+4 = 241 ✓). Exact stored spellings:
  `CLUSTER_STATE_READ_ONLY` 160, `CLUSTER_STATE_OPTIMIZED` 38, `CLUSTER_STATE_DISCONNECTED` 32,
  `CLUSTER_STATE_DISCOVERED` 7, `CLUSTER_STATE_UNSPECIFIED` 4 ("Other" == UNSPECIFIED).
- **Cross-tabulation `reporting_state` × `status`:** UNSPECIFIED ⇒ status **NaN** (4/4);
  DISCONNECTED ⇒ failed 5, hibernated 1, ready 26; DISCOVERED ⇒ failed 2, ready 5;
  OPTIMIZED ⇒ failed 1 (!), ready 37; READ_ONLY ⇒ ready 160/160.
- **`reporting_state` × `data_status`:** READ_ONLY 160 ok / 0 partial; OPTIMIZED 37 ok /
  **1 partial**; DISCONNECTED 1 ok / **31 partial**; DISCOVERED 0 ok / **7 partial**;
  UNSPECIFIED 0 ok / **4 partial**. ⇒ `partial` tracks "no cost-metrics pipeline" almost perfectly.
- **`status` × `agent_status`:** 197 ready+online ⇒ ok; 23 ready+disconnected ⇒ **31
  partial** overlap; 8 non-responding = 7 failed + 1 hibernated; 8 waiting-connection = ready.
  One contradiction: `FT-FT RPD CED SSI-IIP / CDM-EKS-Cluster` is status=**failed** yet
  agent=online, reporting=OPTIMIZED, data=partial and shows **negative savings** (A2).
- **`agent_status` × `data_status`:** online 197 ok / 1 partial; disconnected 1 ok / 22 partial;
  non-responding 0 ok / 8 partial; waiting-connection 0 ok / 8 partial; NaN 0 ok / 4 partial.
- `is_phase2` = True for all 38 OPTIMIZED + 6 DISCONNECTED + 2 DISCOVERED; False for all
  160 READ_ONLY. Consistent with phase-2 = autoscaler-managed.

## 4. Anomalies

### A1 — Savings columns use TWO different cost bases; pct not reproducible from CSV (CRITICAL)
`potential_savings_hourly ≠ cost_hourly − optimal_cost_hourly` in **104/198 rows (52.6%)**
(max |diff| $12.10/h, mean $0.31/h). Exact reconstruction shows:
`psp ≡ ps_hourly / (ps_hourly + optimal_cost_hourly)` — i.e. savings and pct derive from the
**organization/overview** `costHourly`, while `cost_hourly`/`monthly_cost` come from
**organization/clusters/summary**. The overview cost is the documented `overview_cost_hourly`
column that is **missing from this 42-col export**, so `potential_savings_percentage` cannot
be re-derived or verified from the CSV alone. Example: `SI B SW / fgeks-blue-eks-cluster`
cost_hourly 0.4068, optimal 0.17 → (0.4068−0.17)/0.4068 = 58.2 %, but ps_hourly 0.25 and
**psp 59.5 %** because the overview cost is 0.42. Both bases are legitimate casts; mixing
them in one table invites double-takes.

### A2 — Negative `potential_savings` rows: exactly 10, as expected (HIGH)
| org | cluster | state | data_status | cost $/h | optimal $/h | savings $/h | savings $/mo | pct |
|---|---|---|---|---|---|---|---|---|
| SI B SW | fgeks-blue-eks-cluster | READ_ONLY | ok | 0.147 | 0.18 | −0.03 | −21.9 | −20.0 % |
| kong | case-k8s-private-prod-fargate | READ_ONLY | ok | 0.346 | 0.37 | −0.02 | −14.6 | −5.7 % |
| SI-SI EP EMS FIN IT CSS-CTDM | CDM-EKS-Cluster | READ_ONLY | ok | 0.096 | 0.11 | −0.01 | −7.3 | −10.0 % |
| FT-FT RPD CED SSI-IIP | CDM-EKS-Cluster | OPTIMIZED | **partial** | **NA** | 0.16 | −0.06 | −43.8 | −60.0 % |
| IT DA PL IP - SDC.Streaming | sdcstreaming-eks-cluster-prod | READ_ONLY | ok | **0.091** | **1.73** | **−1.64** | **−1 197.2** | **−1 822.2 %** |
| SMO-RI-CSX-CS | csx-snigdha-devops | READ_ONLY | ok | 1.399 | 1.55 | −0.14 | −102.2 | −9.9 % |
| SI-B-BTWIN | fgeks-blue-eks-cluster | READ_ONLY | ok | **0.490** | **2.96** | **−2.46** | **−1 795.8** | **−492.0 %** |
| TeamLeonis | pssp-k8s-cluster | READ_ONLY | ok | 0.199 | 0.27 | −0.07 | −51.1 | −35.0 % |
| APM0423755-Azure_Platform_Service | rg-lab-aks-nodes-prod | DISCONNECTED | **partial** | **NA** | 0.20 | −0.03 | −21.9 | −17.6 % |
| SMO-SW-PDH-TPS | eks-tpslive-dev | OPTIMIZED | ok | 0.120 | 0.20 | −0.08 | −58.4 | −66.7 % |

Two sub-issues: (a) 2 partial rows report savings **with no current cost at all**
(cost NaN → implicit overview cost = optimal − |savings|); (b) 2 rows (SDC.Streaming,
SI-B-BTWIN) have "optimal" 19× and 6× **above** current cost — the optimal-cost estimate
is implausible for tiny dev clusters and poisons sum-based KPIs by −$2 993/mo combined.

### A3 — Money arithmetic (CONFIRMED good)
- **No negative costs** in any cost/resource column. `monthly_cost ≡ cost_hourly × 730`
  **exactly** in all 198 comparable rows (max |diff| 3.6e-12) — run-rate, must stay labeled.
- `potential_savings ≡ potential_savings_hourly × 730` exactly (218 rows).
- `monthly_cost` vs `report_period_cost` (actual 30-d): ratio med 1.019 but **43 rows
  diverge >50 %** (min 0.097, max 6.9) — run-rate vs actual, expected; never blend.

### A4 — Zero-resource vs cost (CONFIRMED good)
43 rows have cpu/memory allocatable **null (never 0)**; all 43 are exactly the
`data_status=partial` rows, with the **entire numeric block null** (cost, nodes, pods,
resources). No cluster has nonzero resources with zero cost, and no zero-node row has cost.
Also within the 198 `ok` rows, 11 have `cpu_used`/`cpu_efficiency`/`memory_used*` null
(disconnected-but-agent-registered clusters) — KPIs already mask pairwise; keep it.

### A5 — Efficiency columns (CONFIRMED exact relation)
`cpu_efficiency ≡ cpu_used / cpu_allocatable` — 187/187 exact (float noise ≤ 9.7e-17);
**not** used/requested (max diff 0.54) and not used/provisioned. `memory_efficiency ≡
memory_used_gib / memory_allocatable_gib` (187/187 exact). Scale is **0–1 fraction** for both.

### A6 — Percentage scales are INCONSISTENT across pct columns (MEDIUM)
`cpu_efficiency`, `memory_efficiency`, `potential_savings_percentage` are 0–1 fractions
(psp max 0.949, negatives unbounded to −18.2 = −1 822 %), while `report_cost_pct_change`
is **0–100 style** (max +49 597 %, driven by zero-base new clusters; 55 rows exactly 0.0).
Any shared formatter will silently 100× one of them.

### A7 — Memory units: GiB CONFIRMED
mem:cpu per-row median ratio 3.6 GiB/core — plausibly GiB (not MiB/GB); magnitudes
(allocatable med 112 GiB at 39 cores) match node-class memory.

### A8 — Other field anomalies
- `unschedulable_pods` max **10 672 of 10 912 pods** on 8-node `SMO-RI-CSX-CS /
  csx-georgi-vnv` (READ_ONLY, ok) — 98 % of the cluster's pods unschedulable; verify whether
  metric or real saturation. 24 rows have >0; runner-up only 361.
- 4 `CLUSTER_STATE_UNSPECIFIED` "ghost" rows (HAFAS H&O ×2, DI-PA-SW-DOE4,
  APM0423755-Azure_Platform_Service): cluster_id only — **null** name/provider/region/
  status/agent_status/is_phase2, all numerics null, WA 'Not installed'.
- `region` = 'unknown' ×1; `status` NaN ×4 (the ghosts). `optimal_cost_hourly` = exactly
  0.0 in some rows (claims full eliminability — sanity-check before KPI).

## 5. Freshness — CONFIRMED

`last_updated` is a **single value** (`2026-09-21 17:06:37+00:00`) for all 241 rows —
one synchronized sweep ✓. Stored as **string**; parse to datetime on load. No other
time-like column exists in the file (report period boundaries are implicit, not exported).

## 6. Identity — CONFIRMED with caveats

- **No duplicate `cluster_id`** anywhere (241/241 unique; hence none within orgs either). ✓
- **Duplicate `cluster_name`:** 4 names span 2 orgs each — `CDM-EKS-Cluster` (SI-SI EP EMS
  FIN IT CSS-CTDM + FT-FT RPD CED SSI-IIP), `console-eks-integ` (Pillar#1 + Pillar#2),
  `gspkafka-k8s-dev` (DI IT DEX CLD + gsp-kafka), `fgeks-blue-eks-cluster` (SI B SW ×10 +
  SI-B-BTWIN ×1 = 11 rows). **9 names repeat within a single org**: `fgeks-blue-eks-cluster`
  ×10 (SI B SW), `k8s` ×7 (SMO Railigent X), `dev-vlab-cluster` ×3 (Siemens Dev),
  `eks-Cluster1` ×3 (SI EA electrificationx), `eks` ×3 (HAFAS H&O), `bx-edex-dev-eu` ×2,
  `eleX01` ×2 (IT IPS), `cluster` ×2 (SI-EP-EMS-R&D), `kubernetes` ×2 (Botanica).
  ⇒ `(organization_id, cluster_id)` must remain the only key; display names need suffixing.
- **12 orgs are 100 % partial** (all rows lack metrics): APM0423755-Azure_Platform_Service
  (2), CASE, DI FA HMI URT PRC2, DI IT DEX CLD, DI-PA-SW-DOE4, DI-SW-RAPIDMINER-GRAPH,
  FT FDS CDS (2, both DISCOVERED-only), FT-FT RPD CED SSI-IIP, FT-RDP-SSP-DEVOPSFF-EKS-DEV,
  Pillar#2, SPICE, SiePortal (1 each) — these orgs are invisible to every cost KPI.
- **Per-org completeness (ok vs partial)** — Top 10 by cluster count:
  SMO-RI-CSX-CS 33 ok/1 p (97.1 %), IT IPS 22/4 (84.6 %), SI GSW CLO 20/0 (100 %),
  SFS IT CDO 16/0 (100 %), HAFAS H&O 12/3 (80 %), DDI SW MNDX PRO&TECH 12/0 (100 %),
  SMO Railigent X 9/1 (90 %), SI B SW 7/3 (70 %), Pillar#1 6/3 (66.7 %),
  **DI FA DSP - DPP 1/7 (12.5 %)**. Bottom 10 (worst ok %): the 12 all-partial orgs above,
  all 0 % (each 1–2 clusters); next-worst with >2 clusters are DI FA DSP - DPP (12.5 %)
  and Pillar#1 (66.7 %). Fleet size per org: min 1, median 2, max 34.

## 7. Kubernetes version — coverage CONFIRMED sparse & state-biased

Overall **54/241 = 22.4 %** present. By `reporting_state`: OPTIMIZED **38/38 = 100 %**,
DISCOVERED 2/7 = 28.6 %, DISCONNECTED 6/32 = 18.8 %, **READ_ONLY 8/160 = 5 %**,
UNSPECIFIED 0/4. By agent: non-responding 8/8 (100 %), online 46/198 (23 %), disconnected
0/23, waiting-connection 0/8. Version presence follows "full agent/AAM feature set", so a
fleet version chart is misleading unless labeled. Orgs with full coverage: 12/57; SFS IT
CDO has 0 % over 16 clusters. Format inconsistency: AKS clusters report patch versions
('1.34.9' ×2, '1.34.2') while others report minor only ('1.35') — normalize before grouping.

## 8. Severity-classified findings table

| # | Current field(s) | Coverage (real values) | Quality issue | Severity | Recommended action | Proposed replacement / source |
|---|---|---|---|---|---|---|
| 1 | `potential_savings`, `potential_savings_hourly`, `potential_savings_percentage` vs `cost_hourly`/`monthly_cost` | 90.5 % / 89.2 % | Two cost bases (overview vs summary) on one row; `psp` not reproducible from CSV; `overview_cost_hourly` column missing from export | **CRITICAL** | Export `overview_cost_hourly` (documented col #43); document "savings are relative to overview costHourly"; recompute any derived pct from ONE base | Same endpoints; add `overview_cost_hourly` (overview `clusters[].costHourly`) to export; verify psp ≡ ps_hourly/overview_cost |
| 2 | `potential_savings*` (10 rows) | 100 % of those rows | Negative savings incl. 2 computed with cost=NA and 2 with optimal 6–19× above cost (−$2 993/mo poisoned) | **CRITICAL** | Exclude rows with cost NA from savings KPIs; clamp/flag negative savings; audit optimal for sub-$0.50/h clusters | Source OK (`optimalCostHourly`); add validation rule; cross-check via per-cluster `estimated-savings` (Tier 2) |
| 3 | numeric block on `data_status=partial` rows | 82.2 % (43 null rows) | Partial rows carry zero metrics; 12 orgs fully dark to cost KPIs; partial ≈ DISCONNECTED/DISCOVERED/UNSPECIFIED | **HIGH** | Surface per-org coverage in UI (ok 12.5–100 %); never extrapolate; per-row `data_status` already masks KPIs — assert pairwise-complete masks in tests | No new source; visibility fix in presentation + optional `clusters/active` POST coverage oracle from architecture §3 |
| 4 | `kubernetes_version` | 22.4 %, 100 % biased to OPTIMIZED | State-biased coverage (READ_ONLY 5 %) + mixed minor/patch formats ('1.34.9' vs '1.35') | **HIGH** | Label coverage next to any version chart; normalize to `major.minor` before grouping | For connected-but-versionless clusters, derive from cluster details/nodes endpoint; else leave N/A |
| 5 | `node_autoscaler_status`, `problematic_nodes`, `problematic_workloads` | 0 % real (100 % 'T2') | Pure placeholders, no fleet-level information (intentional v1 descope) | **MEDIUM** | Keep out of KPIs/filters; fetch in Tier-3 batch or accept Tier-2-only | Tier-2 per-cluster problematic-nodes/workloads; node-autoscaler state per-cluster (architecture §9.4) |
| 6 | `workload_autoscaler_status` | 100 % | Mixed sentinel styles (raw enum ×2 vs human label); UNKNOWN on 75.5 % incl. 2 OPTIMIZED + 143 READ_ONLY rows; 'Not installed' only marks ghost rows | **MEDIUM** | Map enums → display labels centrally; distinguish "not installed" (READ_ONLY 143) from "unknown/error" (2 OPTIMIZED rows) | Org WOA components endpoint already the source; add enum-mapping table in normalizers |
| 7 | `potential_savings_percentage` vs `report_cost_pct_change` | 89.2 % / 87.6 % | Scale mismatch (0–1 fraction vs 0–100); +49 597 % outliers; 55 exact-0 rows | **MEDIUM** | Central display formatter per column; winsorize/clamp pct_change in charts; document scales in metrics.md | No new source; presentation-layer fix |
| 8 | `(cluster_name)` non-uniqueness | 96 % of rows unique | 9 names repeat within one org (up to ×10); 4 names span orgs | **MEDIUM** | Enforce composite key everywhere (already spec'd); add regression test on exports | Key on (organization_id, cluster_id); UI suffix disambiguator |
| 9 | `unschedulable_pods` single row | 82.2 % | 10 672/10 912 pods unschedulable on 8-node cluster — artifact or red alert | **LOW** | Verify against live cluster; if artifact, cap display | unscheduled-pods endpoint (Tier 2) |
| 10 | 4 `CLUSTER_STATE_UNSPECIFIED` ghost rows | 1.7 % | cluster_id only; null name/provider/region/status; WA 'Not installed'; carry null metrics | **LOW** | Filter or quarantine with reason "not in external-clusters"; do not count in org rollups | Re-join against external-clusters in cluster_service before export |
| 11 | `nodes_fallback`, `nodes_unknown` | 0 % variance | Constant 0.0 in all present rows | **LOW** | Keep schema, hide from cards | n/a |
| 12 | `monthly_cost` (derived), `last_updated` (string) | 82.2 % / 100 % | Derived field ×730 exact (duplicate data); timestamp stored as string | **LOW** | Label "run-rate"; parse to datetime on load | n/a |
| 13 | `region='unknown'` ×1; `status`/`provider` NaN ×4; `optimal_cost_hourly=0.0` rows | ~2 % | Minor sentinel/NaN leaks | **LOW** | Map 'unknown'→NA; sanity-check optimal=0 before savings KPI | external-clusters region fallback |

**Confirmed-good facts (no action):** cluster_id 100 % unique; no negative costs;
`cpu_efficiency`/`memory_efficiency` ≡ used/allocatable exactly; `monthly_cost` ≡
cost_hourly×730 exactly; `potential_savings` ≡ hourly×730 exactly; single sweep timestamp;
partial rows exactly equal the all-null-numeric rows (43); spot coverage 19/198 clusters,
492/3 542 nodes = 13.9 %.

---

## Disposition (2026-09-21) — v2 ship, per §8 severity-table row

*(The adoption brief's "§10 severity table" refers to the §8 table above; one
line per row. FIXED = shipped in v2 code/tests; by-design = intentionally kept,
documented; deferred = open, with a named doc pointer.)*

| # | Disposition | v2 reality |
|---|---|---|
| 1 (CRITICAL, two cost bases / export col) | **FIXED — export 42→43 + raw** | `overview_cost_hourly` ships in the 70-column export (34 FLEET + 34 EXTRA + 2 REPORT); `potential_savings_percentage` is re-derivable from the CSV; both bases documented (ADR v2 R1, metrics.md v2 table) |
| 2 (CRITICAL, negative savings) | **FIXED — negatives trio** | `has_positive_savings_opportunity`/`has_negative_savings` columns; raw never clamped; net/gross/headroom KPI companions; 🔻 display cells + Savings-tab warning (ADR v2 R5, finops §2 rule 9). Cost-NA rows leave the pairwise mask via `data_status`. 2(a) FIXED by mask; 2(b) (optimal 6–19× on sub-$0.50/h clusters) is **by-design** — explained in UI, never "fixed" in data |
| 3 (HIGH, partial-row darkness) | **FIXED** | "Data coverage" KPI card (ok/partial/unavailable over the filtered scope) + grouped banner rollup (Permission denied / Temporarily unavailable / Partial data); `CASTAI_ENABLE_ACTIVE_PROBE` oracle flag available; pairwise masks test-pinned |
| 4 (HIGH, k8s version coverage/formats) | **FIXED — k8s normalize** | `kubernetes_version_short` (`major.minor`, handles `'v1.34.9'`→`'1.34'` and `'1.35'`) + `kubernetes_version_known`; state-biased coverage labeling documented (OPTIMIZED 100 % vs READ_ONLY 5 % stays a caveat — **by-design**, no new source) |
| 5 (MEDIUM, T2 placeholders) | **FIXED — health batch + T2 removal** | `na_managed_nodes`/`na_coverage_pct` ship at Tier-1 (+0 calls); `health` enrichment batch fills problematic counts (cap 400); `na_policies` batch resolves `policies.enabled`; pre-batch cells render `"n/a — load"`, the `"T2"` string is gone from v2 rendering (ADR v2 R3/R6) |
| 6 (MEDIUM, WA mixed sentinels) | **FIXED** | `wa_display` central mapping (Running / Installed (status unknown) / Unknown / Invalid / Not installed / NA) + `wa_agent_version`, `wa_version_drift`, `wa_in_place_resize`, `wa_last_reported` columns (autoscaler-model §2.2) |
| 7 (MEDIUM, pct scale mismatch) | **FIXED — pct formatter** | central formatter switches per column scale: ratios stored 0–1 rendered % (never 0–100); `report_cost_pct_change` stays 0–100 and is display-only; +49 597 % outliers labeled zero-base artifacts |
| 8 (MEDIUM, cluster-name non-uniqueness) | **by-design** | composite key `(organization_id, cluster_id)` everywhere is asserted by tests; export regression test in place — no code change needed |
| 9 (LOW, 10 672-pods outlier) | **deferred — live-probe flagged** | `csx-georgi-vnv` (98 % of 10 912 pods unschedulable on 8 nodes) is flagged for a live-cluster probe via the Tier-2 unscheduled-pods drill (ADR v2 R5 note); not capped or edited in data |
| 10 (LOW, ghost rows) | **FIXED — ghosts** | `is_ghost` quarantine: 4 UNSPECIFIED rows excluded from filters and masked from every KPI by default; "Show ghost rows" toggle restores visibility (rows stay in the table, 👻 marker) (ADR v2 R5) |
| 11 (LOW, constant-0 columns) | **by-design** | `nodes_fallback`/`nodes_unknown` schema kept; hidden from the default grid via the v2 column picker (visible on demand) |
| 12 (LOW, derived cost + string ts) | **FIXED — freshness trio** (run-rate by-design) | `monthly_cost` stays labeled "run-rate" (convention kept); single sweep `last_updated` superseded by per-cluster `latest_sync_time` / `snapshot_age_minutes` / `data_freshness_status` (fresh < 30 min ≥ stale ≥ unknown) |
| 13 (LOW, minor sentinel leaks) | **deferred-with-doc-pointer** | `optimal_cost_hourly = 0.0` "full eliminability" sanity-check and `region='unknown'` mapping remain open — tracked in finops-model §9 validation checklist and ADR v2 R5 follow-ups; not silently fixed |
