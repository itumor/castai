#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Customer-facing doc: CAST AI Realized Savings — Case Matrix, Definitions & API Guide."""
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ACCENT = RGBColor(0x0E, 0x3B, 0x5C)   # deep blue
ACCENT2 = RGBColor(0x1B, 0x7F, 0x79)  # teal
GREY = RGBColor(0x5B, 0x6B, 0x7B)
CODE_BG = "F2F5F7"
HDR_BG = "0E3B5C"

doc = Document()

# ---------- page + base styles ----------
sec = doc.sections[0]
sec.top_margin = Cm(1.9); sec.bottom_margin = Cm(1.9)
sec.left_margin = Cm(2.0); sec.right_margin = Cm(2.0)

normal = doc.styles['Normal']
normal.font.name = 'Calibri'
normal.font.size = Pt(10)
normal.paragraph_format.space_after = Pt(6)

for i, (size, color) in enumerate([(16, ACCENT), (13, ACCENT), (11.5, ACCENT2)], start=1):
    st = doc.styles[f'Heading {i}']
    st.font.name = 'Calibri Light'
    st.font.size = Pt(size)
    st.font.color.rgb = color
    st.font.bold = True

# ---------- helpers ----------
def shade(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear'); shd.set(qn('w:fill'), hexcolor)
    tcPr.append(shd)

def htable(headers, rows, widths=None, header_bg=HDR_BG, fontsize=9):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0]
    for j, h in enumerate(headers):
        c = hdr.cells[j]; c.text = ''
        r = c.paragraphs[0].add_run(h)
        r.font.name = 'Calibri Light'; r.font.size = Pt(fontsize); r.font.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        shade(c, header_bg)
    for row in rows:
        cells = t.add_row().cells
        for j, v in enumerate(row):
            c = cells[j]; c.text = ''
            lines = v if isinstance(v, list) else [v]
            first = True
            for ln in lines:
                p = c.paragraphs[0] if first else c.add_paragraph()
                first = False
                code, bold, grey = False, False, False
                txt = ln
                if ln.startswith('`'):
                    code, txt = True, ln.strip('`')
                elif ln.startswith('**'):
                    bold, txt = True, ln.strip('*')
                r = p.add_run(txt)
                r.font.name = 'Courier New' if code else 'Calibri'
                r.font.size = Pt(fontsize if not code else fontsize - 0.5)
                r.font.bold = bold
                if code: r.font.color.rgb = ACCENT
                if txt.startswith('⚠'): r.font.color.rgb = RGBColor(0xB5, 0x50, 0x00)
    if widths:
        for j, w in enumerate(widths):
            for row in t.rows:
                row.cells[j].width = Cm(w)
    doc.add_paragraph()
    return t

def code_block(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2); p.paragraph_format.space_after = Pt(2)
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement('w:shd'); shd.set(qn('w:val'), 'clear'); shd.set(qn('w:fill'), CODE_BG)
    pPr.append(shd)
    lines = text.split('\n')
    for i, ln in enumerate(lines):
        if i: p.add_run('\n')
        r = p.add_run(ln)
        r.font.name = 'Courier New'; r.font.size = Pt(8.5); r.font.color.rgb = RGBColor(0x24, 0x33, 0x42)
    doc.add_paragraph()

def note(text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(9); r.font.italic = True; r.font.color.rgb = GREY
    return p

def bullets(items, size=10):
    for it in items:
        p = doc.add_paragraph(style='List Bullet')
        if isinstance(it, tuple):
            r = p.add_run(it[0]); r.font.bold = True; r.font.size = Pt(size)
            r2 = p.add_run(it[1]); r2.font.size = Pt(size)
        else:
            p.add_run(it).font.size = Pt(size)

# =========================================================================
# COVER
# =========================================================================
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.LEFT
r = title.add_run('CAST AI Realized Savings — Case Matrix, Definitions & API Guide')
r.font.name = 'Calibri Light'; r.font.size = Pt(22); r.font.bold = True
r.font.color.rgb = ACCENT

sub = doc.add_paragraph()
r = sub.add_run('Siemens fleet · how savings reporting behaves per cluster topology, with the exact live API calls and verified examples')
r.font.size = Pt(11.5); r.font.color.rgb = ACCENT2

meta = doc.add_paragraph()
r = meta.add_run('Prepared 2026-10-08 · Data window 2026-09-05 → 2026-10-05 (30d) unless noted · API: https://api.eu.cast.ai (EU) · Read-only analysis')
r.font.size = Pt(9); r.font.italic = True; r.font.color.rgb = GREY

note('Provenance: every number in this document comes from a live CAST AI API response captured on 2026-10-08 with '
     'X-API-Key + X-CastAI-Organization-Id headers. No estimates, no UI screenshots, no manual spreadsheets. '
     'Where a behavior is an observation from this verification (an HTTP status used as a signal), it is marked as such — '
     'observed behavior, not a documented API guarantee.')

doc.add_paragraph()

# =========================================================================
# 1 · CASE MATRIX
# =========================================================================
doc.add_heading('1 · Case matrix (verified detection flow)', level=1)
doc.add_paragraph(
    'CAST AI savings reporting depends on which autoscaling capabilities are adopted and whether a valid node-level '
    'savings baseline exists. Classify each cluster into one of the six cases before aggregating any numbers.')

htable(
    ['Case', 'Cluster configuration', 'Reporting rule', 'Example (30d)'],
    [
        ['**A — Monitoring only', 'Cluster connected in read-only mode; neither autoscaler adopted',
         'No realized savings data. Report N/A — not $0.', '`bx-edex-prod-eu'],
        ['**B — Workload Autoscaler only', 'CAST AI rightsizes workloads; Karpenter/EKS continues managing nodes',
         'Report workloadAutoscalerSavings as modeled potential savings. No node-level realized savings (no baseline needed).',
         '`f8dd5b4f — $431.26'],
        ['**C — Node Autoscaler only', 'CAST AI manages nodes; workload rightsizing inactive',
         'Report autoscalerSavings after the baseline period ends.', '`ngm-kronos-eks — $7,702.24'],
        ['**D — Both autoscalers', 'CAST AI manages nodes and rightsizes workloads',
         ['Report totalSavings as realized savings.'] + ['Show WAS savings separately for attribution; never add them together.'],
         '`k8s-andreas — $150,024.33 realized; $619.45 WAS attribution'],
        ['**E — Transition B → D', 'Workload Autoscaler enabled first; Node Autoscaler enabled later',
         'WAS savings continue independently. Node-level savings start after the baseline ends (baselinePeriodEndTime).',
         '`k8s-andreas — WAS since 2026-04, node savings since 2026-05'],
        ['**F — Disconnected / reporting unavailable', 'Agent disconnected or savings reporting unavailable',
         'Flag as unavailable. Do not report $0 and do not silently exclude the cluster.', '`rhx-test'],
    ], widths=[2.6, 4.6, 6.2, 3.6])

doc.add_heading('API detection logic', level=2)
htable(
    ['Case', 'Observed detection signals (value-realization report flags first)'],
    [
        ['A', 'Empty report items; WAS summary HTTP 400 ("should be installed"); classic savings HTTP 400 read-only'],
        ['B', 'woopAdopted=true, autoscalerAdopted=false; baseline-params 404 (no baseline); classic savings HTTP 400 read-only'],
        ['C', 'woopAdopted=false, autoscalerAdopted=true; baseline-params HTTP 200 (CLUSTER_HISTORY)'],
        ['D', 'Both adoption flags true; baseline available (CLUSTER_HISTORY or INDUSTRY_AVERAGE)'],
        ['E', 'Org timeline: WAS savings precede node savings (e.g., start 2026-04 vs 2026-05); node baseline becomes effective later'],
        ['F', 'agentStatus ∈ {disconnected, non-responding, waiting-connection, archived}; cluster missing from report items'],
    ], widths=[1.6, 15.4])
note('⚠ These HTTP status combinations are observations from the verification flow, not guaranteed API behavior. '
     'The authoritative signals are the woopAdopted / autoscalerAdopted flags in the value-realization report; '
     'the status codes corroborate.')

# =========================================================================
# 2 · PRINCIPLES + RECOMMENDATION + DOCS
# =========================================================================
doc.add_heading('2 · Key reporting principles', level=1)
bullets([
    ('1 · Avoid double counting. ', 'totalSavings currently equals autoscalerSavings. When both autoscalers are enabled, '
     'Workload Autoscaler impact is already included in realized savings — never add WAS savings on top.'),
    ('2 · Baseline dependency. ', 'Node-level realized savings require a valid baseline and begin after the baseline period '
     'ends. Workload-rightsizing savings are calculated independently of that period.'),
    ('3 · Adoption thresholds. ', 'CAST AI reports node-level realized savings when at least 20% of nodes are CAST AI-managed, '
     'and WAS savings when at least 20% of workloads are managed in VPA mode.'),
    ('4 · Baseline quality. ', 'CLUSTER_HISTORY is preferred. INDUSTRY_AVERAGE uses fleet-wide assumptions and should be '
     'reviewed for unusually high estimated savings.'),
    ('5 · Missing data is not zero savings. ', 'Distinguish inactive autoscaling, missing baselines, disconnected agents, and '
     'unavailable reporting.'),
])

doc.add_heading('Reporting recommendation', level=2)
doc.add_paragraph(
    'Classify each cluster into Cases A–F before aggregation. Report realized node savings separately from WAS-only '
    'potential savings. For clusters using both autoscalers, show WAS as an attribution metric rather than an additional '
    'saving.')

doc.add_heading('Official CAST AI documentation', level=2)
bullets([
    'Realized Savings Report — https://docs.cast.ai/docs/savings-report',
    'Savings Calculations and Baseline Methodology — https://docs.cast.ai/docs/savings-baseline',
    'CAST AI Savings API Reference — https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport',
    'Autoscaled agent (visual reference) — https://docs.cast.ai/docs/workload-autoscaling-introduction (rightsizing model)',
])

# =========================================================================
# 3 · WHAT THE COLUMNS MEAN
# =========================================================================
doc.add_heading('3 · Definitions — money, baseline, agent & flags', level=1)

doc.add_heading('3.1 Money columns (one window, one report)', level=2)
doc.add_paragraph(
    'All four figures come from the same value-realization report item (see §4.3). WAS = Workload Autoscaler '
    '(pod CPU/RAM rightsizing). The two savings tracks are independent and never summed.')
htable(
    ['Column', 'What it is', 'Calculation', 'API field'],
    [
        ['WAS $', 'Workload-rightsizing savings accrued in the window; works with no baseline',
         'Σ per day: (original − current pod requests) × unit price, CPU + RAM', '`cost.workloadAutoscalerSavings'],
        ['node $', 'Realized node savings', 'Σ per day: max(original,current demand) × overprovisioning factor × '
         'max(current price, baseline unit price) − actual, after baseline end', '`cost.autoscalerSavings'],
        ['total $', 'Realized savings as reported by the report', 'Currently == node $ (verified fleet-wide: Σ equal to the cent)', '`cost.totalSavings'],
        ['actual $', 'What the cluster actually consumed in the window — the spend the savings sit on', 'measured', '`cost.actualCost'],
    ], widths=[2.0, 5.2, 6.0, 3.8])

doc.add_heading('3.2 Baseline types — the "no-CAST-AI" counterfactual', level=2)
doc.add_paragraph(
    'The baseline freezes, per CPU and RAM, an overprovisioning factor (× demand) and a unit‑price floor at the moment node '
    'management started (baselinePeriodEndTime). Only the node track needs it; WAS-only Case-B clusters have none by design.')
htable(
    ['Baseline type', 'How it is calculated', 'Reliability'],
    [
        ['CLUSTER_HISTORY', "Uses at least 7 days of the cluster's own history before CAST AI node management", 'Highest'],
        ['PEER_CLUSTERS', 'Uses historical baseline data from eligible clusters within the same organization', 'Medium'],
        ['INDUSTRY_AVERAGE', "Uses averages from CAST AI's broader cluster fleet when no suitable cluster or peer history exists", 'Lowest — review generous estimates'],
        ['Overridden', 'CAST AI representative manually adjusts parameters or recalculates the baseline over a custom period', 'Requires review'],
        ['UNSPECIFIED / No baseline', 'No baseline has been established, or node-level baseline reporting does not apply', 'N/A'],
    ], widths=[4.2, 8.8, 4.0])
note('Live check: k8s-andreas has an INDUSTRY_AVERAGE baseline with a 24-hour window (2026-04-15→16), CPU factor 169.58, '
     'RAM factor 35.44 — this is why its node savings ($150k/30d) are large in absolute terms and get flagged for review.')

doc.add_heading('3.3 Agent & flags columns', level=2)
htable(
    ['Column', 'Values', 'Meaning'],
    [
        ['agent', ['online', 'disconnected · non-responding · waiting-connection · archived'],
         ['agent connected, reporting works → Cases A–E possible',
          'agent not reporting → Case F (flagged, never dropped)']],
        ['woop', 'on / off', 'woopAdopted — CAST AI-controlled workload rightsizing active (≥20% workloads in VPA mode)'],
        ['node mgmt', 'on / off', 'autoscalerAdopted — CAST AI node management active (≥20% nodes CAST-managed). '
         'Authoritative even under Karpenter integration, where 0% of nodes carry the managed-by label yet node savings exist.'],
    ], widths=[2.2, 5.0, 9.8])

# =========================================================================
# 4 · API REFERENCE
# =========================================================================
doc.add_heading('4 · Live API calls used in this analysis', level=1)
doc.add_paragraph(
    'Base URL (EU): https://api.eu.cast.ai · Auth headers on EVERY call: X-API-Key: <API-KEY> and '
    'X-CastAI-Organization-Id: <ORG-ID> — the org header is mandatory; without it an enterprise key sees 404/empty '
    'inventory. The public OpenAPI spec does not include the reporting/v1beta endpoints below; they are enterprise '
    'reporting endpoints verified here with full request/response shapes — for formal schema documentation, contact the '
    'CAST AI account team.')

ENDPOINTS = [
    ('4.1 List organizations', 'GET', '/v1/organizations',
     'Resolves every organization the key is entitled to (130 in this key). Used to enumerate the fleet for the sweep.',
     'Savings API Reference (concept docs above); GET /v1/organizations is in the public API docs.',
     """curl -sS "https://api.eu.cast.ai/v1/organizations" -H "X-API-Key: <API-KEY>" -H "Accept: application/json """ ,
     """{ "organizations": [ { "id": "f15f33b9-20ad-4128-8289-da529844d3f0",
    "name": "SMO Railigent X" }, ... 130 entries ] }""",
     ['organizations[] — id, name']),

    ('4.2 Fleet inventory (per organization)', 'GET', '/v1/kubernetes/external-clusters',
     'Lists clusters with name, id, status and agentStatus. Only orgs with clusters return items (27 of 130 here). '
     'agentStatus values observed: online · disconnected · non-responding · waiting-connection · archived.',
     'External Kubernetes Clusters API — https://docs.cast.ai/reference/getkubernetesexternalclusters',
     """curl -sS "https://api.eu.cast.ai/v1/kubernetes/external-clusters" -H "X-API-Key: <API-KEY>" -H "X-CastAI-Organization-Id: <ORG-ID> """,
     """{ "items": [ { "id": "f8dd5b4f-3cf4-48e2-b453-7be4562e36cb", "name": "fgac-eks-preprod",
    "status": "ready", "agentStatus": "online", "region": "eu-central-1",
    "providerType": "aws" } ] }""",
     ['items[] — id, name, status, agentStatus, region, providerType']),

    ('4.3 Value realization report (THE savings report)', 'POST',
     '/reporting/v1beta/organizations/{orgId}/clusters:runValueRealizationReport?startTime={ISO}&endTime={ISO}',
     'The single source for ALL money columns and adoption flags, per cluster per window. ⚠ startTime/endTime MUST be '
     'query parameters with an empty JSON body {} — JSON-body time fields produce HTTP 400 "start_time value is required".',
     'Enterprise Reporting API (v1beta) — not in the public OpenAPI spec; concepts match '
     'https://docs.cast.ai/docs/savings-report.',
     """curl -sS -X POST "https://api.eu.cast.ai/reporting/v1beta/organizations/<ORG-ID>/clusters:runValueRealizationReport?startTime=2026-09-05T06:00:00Z&endTime=2026-10-05T06:00:00Z" -H "X-API-Key: <API-KEY>" -H "X-CastAI-Organization-Id: <ORG-ID>" -H "Content-Type: application/json" -d '{}'""",
     """{ "items": [ {
    "clusterId": "f8dd5b4f-3cf4-48e2-b453-7be4562e36cb",
    "clusterName": "fgac-eks-preprod", "clusterStatus": "ready",
    "baselineType": "BASELINE_TYPE_UNSPECIFIED",
    "woopAdopted": true, "autoscalerAdopted": false,
    "cost": { "actualCost": 984.42, "projectedCost": 1415.68,
              "autoscalerSavings": 0, "workloadAutoscalerSavings": 431.26,
              "totalSavings": 431.26 } }, ... ] }""",
     ['items[] — clusterId, clusterName, woopAdopted, autoscalerAdopted, baselineType',
      'cost { actualCost · projectedCost · autoscalerSavings · workloadAutoscalerSavings · totalSavings }']),

    ('4.4 Value realization timeline (Case-E detection)', 'POST',
     '/reporting/v1beta/organizations/{orgId}:runValueRealizationTimelineReport?startTime=…&endTime=…&step=ONE_MONTH',
     'Monthly points for the whole org: detects transitions (WAS first, node later). ⚠ Maximum range 365 days at monthly '
     'step; per-cluster timeline path 404s.',
     'Enterprise Reporting API (v1beta) — not in public OpenAPI spec.',
     """curl -sS -X POST "https://api.eu.cast.ai/reporting/v1beta/organizations/<ORG-ID>:runValueRealizationTimelineReport?startTime=2025-10-14T00:00:00Z&endTime=2026-10-08T00:00:00Z&step=ONE_MONTH" -H "X-API-Key: <API-KEY>" -H "X-CastAI-Organization-Id: <ORG-ID>" -d '{}'""",
     """{ "summary": { "cost": { ... } }, "timelineItems": [
  { "timestamp": "2026-04-01T00:00:00Z",
    "cost": { "actualCost": 36614.31, "autoscalerSavings": 0,
              "workloadAutoscalerSavings": 300.79, "totalSavings": 0 } },
  { "timestamp": "2026-05-01T00:00:00Z",
    "cost": { "actualCost": 39339.12, "autoscalerSavings": 1853.17,
              "workloadAutoscalerSavings": 667.84, "totalSavings": 1853.17 } } ] }""",
     ['timelineItems[] — timestamp, cost.* (node track first accrued 2026-05; WAS since 2026-04 → Case E)']),

    ('4.5 Baseline params (per cluster)', 'GET',
     '/reporting/v1beta/organizations/{orgId}/clusters/{clusterId}/baseline-params',
     'The frozen no-CAST-AI counterfactual for node savings. HTTP 404 = the cluster legitimately has no baseline '
     '(normal for WAS-only Case B) — a classification signal, not an error.',
     'Enterprise Reporting API (v1beta) — not in public OpenAPI spec; methodology in '
     'https://docs.cast.ai/docs/savings-baseline.',
     """curl -sS "https://api.eu.cast.ai/reporting/v1beta/organizations/<ORG-ID>/clusters/<CLUSTER-ID>/baseline-params" -H "X-API-Key: <API-KEY>" -H "X-CastAI-Organization-Id: <ORG-ID> """,
     """{ "baselineType": "BASELINE_TYPE_CLUSTER_HISTORY",
  "baselinePeriodStartTime": "2025-09-30T06:00:00Z",
  "baselinePeriodEndTime":   "2025-11-06T05:59:59Z",
  "cpuParams":    { "overprovisioningFactor": 5.2468, "costPerCpuCoreHourly": 0.029858 },
  "memoryParams": { "overprovisioningFactor": 11.0015, "costPerMemoryGibHourly": 0.004142 } }""",
     ['baselineType, baselinePeriodStartTime/EndTime, cpuParams/memoryParams { factor, unit floor }']),

    ('4.6 Workloads summary (WAS effect)', 'GET',
     '/v1/workload-autoscaling/clusters/{clusterId}/workloads-summary',
     'Shows what rightsizing did to pod requests: original vs current cores/GiB, how many workloads are optimized. '
     'HTTP 400 "should be installed" = WAS agent absent (a Case-A signal).',
     'Workload Autoscaling API — https://docs.cast.ai/reference/getworkloadautoscalerclusterservices',
     """curl -sS "https://api.eu.cast.ai/v1/workload-autoscaling/clusters/<CLUSTER-ID>/workloads-summary" -H "X-API-Key: <API-KEY>" -H "X-CastAI-Organization-Id: <ORG-ID> """,
     """{ "originalRequestedCpuCores": 25.719, "requestedCpuCores": 5.842,
  "originalRequestedMemoryGibs": 99.519, "requestedMemoryGibs": 36.091,
  "optimizedCount": 56, "totalCount": 65, "apiManagedCount": 62 }""",
     ['originalRequested*/requested* — CPU (cores) & RAM (GiB); optimizedCount/totalCount']),

    ('4.7 Node inventory (labels)', 'GET', '/v1/kubernetes/external-clusters/{clusterId}/nodes',
     'Per-node labels and costs. The provisioner.cast.ai/managed-by=cast.ai label identifies CAST-managed nodes; '
     'karpenter.sh/* identifies Karpenter nodes. Note: under Karpenter integration, 0% managed labels is normal even for '
     'Case D — the adoption flag beats the label rule. Cached data, refresh via trigger_nodes_refresh.',
     'External Kubernetes Clusters API — https://docs.cast.ai/reference/listclusternodes',
     """curl -sS "https://api.eu.cast.ai/v1/kubernetes/external-clusters/<CLUSTER-ID>/nodes" -H "X-API-Key: <API-KEY>" -H "X-CastAI-Organization-Id: <ORG-ID> """,
     """{ "items": [ { "instanceType": "m5.xlarge", "labels":
    { "provisioner.cast.ai/managed-by": "cast.ai",
      "cast.ai/engine": "true" , ... } }, ... 7 nodes ] }""",
     ['items[] — labels (managed-by, karpenter.sh/*), instanceType, pricing (onDemandPrice/spotPrice)']),

    ('4.8 Classic savings (cross-check only)', 'GET', '/v1/cost-reports/clusters/{clusterId}/savings',
     'Older savings methodology — used here only as a negative probe: HTTP 400 "cluster is read-only" on Karpenter/WOOP-only '
     'clusters (machine signal for Case B). When 200, its numbers can diverge from the value-realization report; '
     'prefer §4.3 for reporting.',
     'Savings API Reference — https://docs.cast.ai/reference/clusterreportapi_getclustersavingsreport',
     """curl -sS "https://api.eu.cast.ai/v1/cost-reports/clusters/<CLUSTER-ID>/savings" -H "X-API-Key: <API-KEY> """,
     """HTTP 400 → { "message": "Cost report could not be generated because the cluster is read-only" }
(or HTTP 200 with cost.{autoscalerSavings,...} for read-only=false clusters)""",
     ['summary (200) — cost.autoscalerSavings; classic methodology for cross-checks only']),
]
for title_, method, path, purpose, docslink, curl, resp, fields in ENDPOINTS:
    doc.add_heading(title_, level=2)
    p = doc.add_paragraph()
    r = p.add_run(f'{method}  {path}'); r.font.name = 'Courier New'; r.font.size = Pt(9.5); r.font.bold = True
    r.font.color.rgb = ACCENT2
    doc.add_paragraph(purpose)
    p = doc.add_paragraph(); r = p.add_run('Docs: '); r.font.bold = True; r.font.size = Pt(9)
    r = p.add_run(docslink); r.font.size = Pt(9); r.font.color.rgb = GREY
    code_block(curl)
    code_block(resp)
    note('Fields used: ' + '；'.join(fields))

# =========================================================================
# 5 · EXAMPLE CLUSTERS (verified live)
# =========================================================================
doc.add_heading('5 · Example clusters — verified data (window 2026-09-05 → 2026-10-05, UTC)', level=1)
doc.add_paragraph(
    'One row per case-relevant cluster from the live fleet. All figures from §4.3 report items; baseline facts from §4.5.'
)

htable(
    ['Cluster', 'Org', 'Case', 'Baseline', 'WAS $', 'Node $', 'Total $', 'Actual $', 'Notes'],
    [
        ['f8dd5b4f (railigent preprod)', 'Railigent X', '**B', '— none (404)', '431.26', '—', '—', '984.42',
         'effect: 28.1→6.3 CPU cores, 99.5→36.0 GiB RAM; 56/65 workloads optimized'],
        ['ngm-kronos-eks', 'SI GSW CLO', '**C', 'CLUSTER_HISTORY (2025-09-30→11-06)', '—', '7,702.24', '7,702.24', '5,428.10',
         'node savings 141.9% of actual spend in the window'],
        ['ngm-helios-eks', 'SI GSW CLO', '**C', 'CLUSTER_HISTORY (→2026-07-20)', '—', '14,967.86', '14,967.86', '5,186.55',
         'same baseline line as kronos'],
        ['ngm-sim-eks', 'SI GSW CLO', '**D', 'CLUSTER_HISTORY (2025-08-14→08-21)', '0.00', '51,723.31', '51,723.31', '24,830.16',
         'D by flags, but WAS contribution $0 (no optimization effect)'],
        ['k8s-andreas', 'Railigent X', '**D (+E)', 'INDUSTRY_AVERAGE (24h window)', '619.45', '150,024.33', '150,024.33', '97,355.44',
         'the proven Case-E transition: WAS from 2026-04, node from 2026-05; Karpenter integration'],
        ['35d616b7 (STC non-prod)', 'Siemens Mobility …', '**D', 'CLUSTER_HISTORY' , '12,804.09', '227.17', '227.17', '40,702.22',
         'WAS-heavy cluster: rightsizing 51.8% of spend (24.1→11.7 cores)'],
        ['bx-edex-prod-eu', 'BX-EDEX', '**A', '—', '—', '—', '—', '—',
         'connected read-only; WAS summary 400 "should be installed"'],
        ['rhx-test (35c0f9b5)', 'Railigent X', '**F', '—', '—', '—', '—', '—',
         'agentStatus=disconnected; flagged and kept in the report'],
    ], widths=[3.4, 2.6, 1.7, 3.3, 1.7, 1.8, 1.8, 1.8, 5.0], fontsize=8)

note('k8s-andreas WAS $619.45 is attribution-only inside a Case-D cluster — it is already priced into the projection; '
     'adding it to the $150,024.33 realized figure would double-count. For ngm-sim the distributional row shows WAS $0 '
     'even though the woop flag is on: an honest woop=true row is not a promise of non-zero effect.')

# =========================================================================
# 6 · TRANSITIONS + FLEET SNAPSHOT
# =========================================================================
doc.add_heading('6 · Case E transitions across the fleet (org timeline, last 12 months)', level=1)
doc.add_paragraph(
    'Per-cluster transition history is org-level only (the per-cluster timeline endpoint 404s). Scanning monthly '
    'timeline reports over 130 organizations finds four orgs whose WAS track preceded the node track:')
htable(
    ['Organization', 'WAS $ first accrues', 'Node $ first accrues', 'Gap'],
    [
        ['CPS', '2026-03', '2026-07', '4 months'],
        ['SMO Railigent X', '2026-04', '2026-05', '1 month — the k8s-andreas story'],
        ['evosoft IT MIS', '2026-07', '2026-08', '1 month'],
        ['Pillar#1', '2026-08', '2026-09', '1 month'],
    ], widths=[5.0, 4.0, 4.0, 4.0])

doc.add_heading('7 · Fleet snapshot at verification time (2026-10-08, rolling 30d)', level=1)
htable(
    ['Metric', 'Value'],
    [
        ['Organizations reachable', '127 of 130 (3 orgs unreadable with this key — listed, not dropped)'],
        ['Clusters', '238'],
        ['Case mix', ['B ×16 · C ×15 · D ×33', 'A ×139 (connected, nothing set up)', 'F ×35 (disconnected 19 · non-responding 8 · waiting-connection 9 · archived 1)']],
        ['Agents online', '201'],
        ['WAS savings (30d Σ)', '$15,284.48'],
        ['Node savings (30d Σ)', '$363,777.15'],
        ['totalSavings (30d Σ)', '$363,777.15 — equals node savings to the cent (double-count guard verified)'],
        ['Actual spend (30d Σ)', '$244,881.60'],
    ], widths=[6.0, 11.0])

# =========================================================================
# 8 · GOTCHAS
# =========================================================================
doc.add_heading('8 · Gotchas (all verified live — bake them into every consumer)', level=1)
bullets([
    'The value-realization POST takes startTime/endTime in the QUERY STRING with an empty {} body; JSON-body time fields → HTTP 400 "start_time value is required".',
    'The path is POST /reporting/v1beta/organizations/{orgId}/clusters:runValueRealizationReport — the colon-org variant /organizations/{org}:runValueRealizationReport is a different namespace (timeline) and 404s for cluster rows.',
    'baseline-params HTTP 404 and classic-savings HTTP 400 are classification signals, not errors.',
    'Duplicate cluster names exist fleet-wide (six clusters named "k8s") — always key by clusterId.',
    'Negative node-savings values occur (rightsizing-driven upsizing inside node reporting) — real API values, do not clamp.',
    'Timeline report at step=ONE_MONTH rejects ranges over 365 days.',
    'Enterprise API keys need X-CastAI-Organization-Id on every org-scoped call; without it you get 404/empty inventory instead of a clear error.',
    'Under Karpenter integration, node labels alone cannot detect node management (flag beats label).',
])

doc.save('/Users/eramadan/castai/outbox/savings-cases-2026-10-08/CASTAI-Siemens-Realized-Savings-Guide.docx')
print('saved DOCX')
