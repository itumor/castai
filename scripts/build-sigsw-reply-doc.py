#!/usr/bin/env python3
"""Build SI GSW reply document (.docx): email + evidence table + console snapshots."""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from pathlib import Path

OUT = Path('/Users/eramadan/castai/outbox/savings-sigsw-snapshots-20261008')
DOC = Path('/Users/eramadan/castai/outbox/case-threads/SI-GSW-savings-reply-evidence-2026-10-08.docx')

doc = Document()
for section in doc.sections:
    section.page_width, section.page_height = Cm(21.0), Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.0)
    section.top_margin = section.bottom_margin = Cm(2.0)

st = doc.styles['Normal']
st.font.name = 'Calibri'
st.font.size = Pt(10.5)

def h(text, level=1):
    p = doc.add_heading(text, level=level)
    for r in p.runs:
        r.font.color.rgb = RGBColor(0x1F, 0x38, 0x64)
    return p

def para(text="", bold=False, italic=False, size=None, space_after=6):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    r = p.add_run(text)
    r.bold = bold
    r.italic = italic
    if size: r.font.size = Pt(size)
    return p

def bullet(text):
    return doc.add_paragraph(text, style='List Bullet')

def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    for i, htxt in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ''
        r = cell.paragraphs[0].add_run(htxt)
        r.bold = True
        r.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            r = cells[i].paragraphs[0].add_run(str(val))
            r.font.size = Pt(9.5)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    return t

# ---------------------------------------------------------------- title block
h('Re: SI GSW — CAST AI savings vs Cloudability: root cause, evidence, corrected numbers', 0)
para('Prepared 2026-10-08 · CAST AI (Ebrahim Ramadan) · Evidence: read-only CAST AI API (api.eu.cast.ai) + console.eu.cast.ai snapshots, org SI GSW CLO (07aa3c29-3e1f-44bc-ad60-ceedb878d99a)', italic=True, size=9)

doc.add_page_break()

# ------------------------------------------------------------------- the mail
h('The reply mail', 1)
para('Hi all,')
para('Thank you for the detailed feedback — you were right to challenge these numbers, and your specific comparisons (helios $44,587 vs $22,304; "saved $530k vs paid $470k") were the decisive clues. We reproduced every figure in our report against the CAST AI API and found three distinct defects that stacked into the $530k. Below: what we found, the evidence for each point (console snapshots in Appendix B, paired with the API calls that produce the same numbers), corrected numbers based on what you actually pay, and what we change going forward.')

h('TL;DR', 2)
for t in [
  '68% of the $530k was never real. Our FY26 report summed CAST\'s legacy per-cluster savings endpoint across all 12 months. That endpoint is a mechanical "frozen-baseline minus actual" model and — against CAST\'s own documented methodology — it books "savings" also for the months when CAST was only connected in read-only, before managing anything. For helios, 78% of the claimed savings predate CAST\'s first action on the cluster (first real operation: 2026-07-21, audit log evidence). CAST\'s own current console model (value realization) reports $184k, not $527k, for the same 3 clusters and period.',
  'The remaining ~$184k is computed on CAST\'s price sheet, which is ~2× your real costs. Your adjusted amortized Cloudability figures are ≈ 50% of CAST\'s modeled prices (helios Sep: CAST $44,588 compute vs your billed EC2 $22,304 = 0.5002; integ Sep: 0.503). Every cost AND saving figure we showed scaled with this inflated basis — including the "actual cost" columns. On your billed basis, the defensible FY26 gross saving is ≈ $92k, and the current monthly run-rate ≈ $20.4k gross.',
  'Your K8s-scheduler optimization is real, and part of "our" integ savings is actually yours. Integ\'s frozen baseline was locked 2026-04-27, before your May/June scheduler change. Your change cut provisioned capacity ~46% (Jun→Jul); because the baseline is never re-measured, the model keeps attributing ~$18.5–26.3k/month of that improvement to CAST. We cannot cleanly split CAST\'s marginal contribution from yours on integ without a controlled measurement.',
  'Fees: €14,394.26/month (September; €5 × 3,400.815 provisioned vCPU from the billing API — matches your ~$14.5k) must be and now is deducted. After fees, the current net is ≈ +$4.6k/month at your billed rates — not +$24.9k as our report stated.',
  'You are also right on process: workload autoscaling and spot stop being recommended (your on-prem parity and interruption-tolerance constraints are documented facts for us), and no list-price or CAST-model figure will be sent to your management again.',
]:
    p = doc.add_paragraph(style='List Number')
    p.add_run(t)

h('Corrected, defensible figures (your billed basis ≈ 50% of CAST\'s sheet)', 2)
table(['Metric', 'As reported', 'Corrected'], [
    ['FY26 realized savings, 3 clusters (gross)', '$526,923', '≈ $184k API-basis → ≈ $92k billed-basis'],
    ['September gross savings (API-basis $40,696)', '—', '≈ $20.4k billed-basis'],
    ['September net after CAST fee', '+$24,872', '≈ +$4.6k/month (fee €14,394)'],
    ['FY26 net after fees (≈ €52k)', '$357,284', '≈ +$34.5k'],
])
para('CAST AI is still net-positive for you at real rates — but ~15× below what we reported. Even the ≈ +$4.6k/month is conservative: it excludes any rightsizing upside you already captured yourselves, and integ\'s figure still contains the un-separable share of your own scheduler change.', italic=True)

h('Answers to your specific points', 2)
qa = [
    ('"$530k savings vs $470k paid / $195k during the CAST window"',
     'Correct observation; the $530k is void (Defect 1: 68% pre-go-live phantom; Defect 2: inflated price sheet). The figure exists only inside CAST\'s legacy savings model, never in anything you were billed. We withdraw the report.'),
    ('"May→June drop was our K8s scheduler change, nothing to do with CAST"',
     'Agreed and credited (Defect 3). The baseline froze 2026-04-27, weeks before your change; the model cannot tell your improvement from CAST\'s actions. On helios this is provable: CAST\'s first action there was Jul 21, so nothing before that date can be CAST\'s.'),
    ('"List prices must never reach management"',
     'Agreed. Note on precision: the report used CAST\'s default price sheet (not AWS public list — but ~2× your EDP-adjusted bills). Future reporting will carry an explicit price-basis column and converge to your Cloudability-adjusted amortized basis. We would like to align the exact ratio with your FinOps team once (0.5002 / 0.503 observed) and then apply it as a fixed conversion until CAST supports customer-specific discounts.'),
    ('"Fee not shown"',
     'It was included in the fee table but not in the headline; corrected above (net ≈ +$4.6k/month current).'),
    ('"No possibility to verify"',
     'Every number above is reproducible: console views (snapshots attached) and read-only API calls (exact endpoints in Appendix A). We will also provide the frozen-baseline methodology doc if you want the full math.'),
    ('Workload autoscaling / Spot',
     'Understood and accepted: WOOP stays disabled (on-prem/offline parity), spot stays disabled (interruption tolerance). We will not re-propose them; the remaining on-demand rightsizing opportunity (rebalancing) stays on the table only as an opt-in, controlled pilot when and if you choose.'),
    ('"On a year basis it is impossible to verify"',
     'The honest annual statement is the corrected table above. If you want month-by-month verification, we will provide a per-cluster × per-month CSV (actual | frozen-baseline adjusted | console-realized) on the billed basis.'),
]
for q, a in qa:
    p = doc.add_paragraph(style='List Bullet')
    r = p.add_run(q + ' — '); r.bold = True
    p.add_run(a)

h('What we change immediately', 2)
for t in [
    'The $526,923 figure and both ROI PDFs are withdrawn.',
    'Our reporting switches to the console value-realization model (zeroes pre-go-live months), converted to your billed basis, fees deducted, price basis labeled on every figure.',
    'We request a baseline refresh for kronos (frozen since 2025-12-03) and review of integ\'s baseline given your scheduler change — both need CAST-side action; we will confirm dates before the next review.',
    'Internal product tickets filed: legacy /savings endpoint must not report savings before firstOperationAt; support customer-discount price basis in cost reporting.',
]:
    bullet(t)
para('Happy to walk through the evidence live in our next call — including re-running any of the API reads against your screen share.')
para('Best regards,')
para('Ebrahim (CAST AI)')

doc.add_page_break()

# --------------------------------------------------------- Appendix A: table
h('Appendix A — Evidence table (console snapshot ⇄ API call)', 1)
para('All snapshots captured 2026-10-08 ~01:25–01:32 (console.eu.cast.ai, org SI GSW CLO; fleet state at capture: dev clusters at night-low load). Every console view is paired with the API call producing the same underlying numbers.', italic=True, size=9.5)
ev = [
    ('S1', 'Helios savings before CAST acted: none',
     'SNAP-02 helios dashboard — "CONNECTED: a year ago" (2025-09-30)',
     'Audit: zero events 2026-07-01→07-20; first nodeAdded 2026-07-21T23:07Z by internal|rebalancer (GET /v1/audit?clusterId=419c39e4…&fromDate=2026-07-01&toDate=2026-07-21). Legacy endpoint nonetheless reports $18–24k/month "savings" Oct 2025–Jun 2026.'),
    ('S2', 'Console-model FY26 realized savings',
     'Console per-cluster realized-savings view (cumulative)',
     'POST /reporting/v1beta/organizations/07aa3c29…/clusters:runValueRealizationReport, 2025-10-01→2026-10-01: helios $33,323.01, integ $91,523.11, kronos $59,188.15 (Σ $184,034.27) — not $526,923.'),
    ('S3', 'Where $526,923 came from',
     '(our PDF, withdrawn)',
     'Σ GET /v1/cost-reports/clusters/{id}/savings Oct 2025→Sep 2026: $220,834 + $289,245 + $16,844 = $526,923. Pre-go-live share: helios $171,894, integ $183,251, kronos $2,431 = $357,576 (68%).'),
    ('S4', 'CAST price sheet ≈ 2× your bill',
     'SNAP-06/07 cluster cost monitoring',
     'Helios Sep 2→Oct 2: totalCostOnDemand $44,588.13 vs Cloudability EC2 $22,303.58 (0.5002). Integ Sep: $22,047 compute + $1,786 storage vs billed EC2 $11,096.67 + EBS $1,807.33 (0.503).'),
    ('S5', 'Integ baseline frozen before your scheduler change',
     'SNAP-11 integ efficiency (current overprovisioning 55.31% vs frozen 120%)',
     'GET …/clusters/1ad1a0bf…/baseline-params: baselinePeriodEndTime 2026-04-27T00:00:00Z, cpuOverprovisioningFactor 2.196, CLUSTER_HISTORY. Your −46% provisioned-vCPU drop landed Jun→Jul 2026, after the freeze.'),
    ('S6', 'Kronos baseline stale 11 months',
     'SNAP-12 kronos efficiency (14 CPU provisioned / 6.04 requested / 0.38 used)',
     'kronos baselinePeriodEndTime 2025-11-06, updateTime 2025-12-03 — never refreshed; frozen factors 5.25×/11×. Console value-model even claims $59.2k savings on $21.6k FY26 actual — artifact.'),
    ('S7', 'Fee basis',
     'SNAP-01 org cluster list',
     'GET /v1/billing/platform-usage-detail?feature=phase2&period.from=2026-09-01&period.to=2026-09-30: org 3,400.815 vCPU (helios 1,786.383 / integ 1,005.878 / kronos 86.591) × €5 = €14,394.26.'),
    ('S8', '"Projected" is not independent',
     'SNAP-06/07',
     'Integ Sep window: actual $22,388.83 + savings $18,415.69 = $40,804.52 — exactly the "API-implied projected cost" in the report. Projected = actual + savings by construction, not a separate measurement.'),
    ('S9', 'Even the "remaining opportunity" was overstated',
     'SNAP-03/04/05 Available savings: helios $6,374/mo (rightsizing $5,009), integ $17,991/mo (rightsizing $1,707), kronos $292.88/mo (rightsizing $59.24)',
     'Report claimed helios rightsizing $17,387/mo, integ $2,590/mo, kronos $2,941.82/mo. Console\'s own current view is lower — scenario numbers must be labeled "modeled, at capture time, CAST price sheet".'),
]
table(['#', 'Claim', 'Console evidence', 'API evidence'], ev, widths=[0.8, 3.4, 5.6, 7.2])

doc.add_page_break()

# ------------------------------------------------------- Appendix B: shots
h('Appendix B — Console snapshots (evidence pack)', 1)
para('Captures from console.eu.cast.ai, org SI GSW CLO, 2026-10-08 01:25–01:32. Night-time state — dev fleets downscale; node counts are lower than September averages.', italic=True, size=9.5)

shots = [
    ('SNAP-01-cluster-list.png',  'SNAP-01 — Organization cluster list (SI GSW CLO, 20 clusters, provisioned CPU)',
     'Matches GET /v1/kubernetes/external-clusters (org header) — cluster inventory, onboarding dates.'),
    ('SNAP-02-helios-dashboard.png', 'SNAP-02 — ngm-helios-eks dashboard',
     'Connected 2025-09-30 ("a year ago"); 51 nodes, all on-demand, 0 spot (matches cost API: totalCostSpot=0, spotSavings=0 all months); CPU provisioned 676 / requested 506.6 / used 31.4 (4.6%) — the headroom behind the 1.60× frozen baseline factor. Account 600442974479 (CLO DEV - NGM Helios).'),
    ('SNAP-03-helios-avail-savings.png', 'SNAP-03 — helios Available savings (console current view)',
     'Total available $6,374/mo (33.64%): workload rightsizing $5,009, cluster schedule $6,960, spot $0. Report claimed $17,387/mo rightsizing — console\'s own number is far lower.'),
    ('SNAP-04-integ-avail-savings.png', 'SNAP-04 — ngm-integ-eks Available savings',
     'Total available $17,991/mo (57.07%): rightsizing $1,707, schedule $7,491. Report claimed rightsizing $2,590/mo.'),
    ('SNAP-05-kronos-avail-savings.png', 'SNAP-05 — ngm-kronos-eks Available savings',
     'Total available $292.88/mo (66.01%): rightsizing $59.24. Report claimed $2,941.82/mo — ~10× overstated.'),
    ('SNAP-06-helios-cost-report.png', 'SNAP-06 — helios cost monitoring (CAST price sheet)',
     'CAST-modeled current month spend view — the basis behind "actual cost $44,587" that reconciles to nothing in Cloudability (~2× billed).'),
    ('SNAP-07-integ-cost-report.png', 'SNAP-07 — integ cost monitoring (CAST price sheet)',
     'CAST-modeled monthly forecast ~$22.6k vs Cloudability billed ≈ $11.1k EC2 + $1.8k EBS (ratio 0.503).'),
    ('SNAP-08-org-overview.png', 'SNAP-08 — Organization overview',
     '20 clusters connected; org CPU used 246 of 5,375 allocatable (4.6%) — portfolio-level under-utilization context.'),
    ('SNAP-09-org-cost-report.png', 'SNAP-09 — Organization cost report (current month)',
     'Org total cluster cost MTD $51,311 on CAST\'s sheet — the same inflated basis appears at org level.'),
    ('SNAP-10-helios-efficiency.png', 'SNAP-10 — helios efficiency tab',
     'Current overprovisioning CPU 25.05% (provisioned 676 / requested 506.6 / used 32.9) — vs frozen baseline factor 1.60×. The model\'s "what you would have paid" no longer matches the fleet.'),
    ('SNAP-11-integ-efficiency.png', 'SNAP-11 — integ efficiency tab',
     'Current overprovisioning CPU 55.31% (provisioned 1,384 / requested 618.5 / used 61.5) — vs frozen 2.196× (120%). Proof the frozen baseline predates your scheduler change.'),
    ('SNAP-12-kronos-efficiency.png', 'SNAP-12 — kronos efficiency tab',
     'Cluster at 14 CPU provisioned / 6.04 requested / 0.38 used while a Nov-2025 baseline (5.25×/11×) still drives its "savings" curve.'),
]
for fname, title, caption in shots:
    h(title, 3)
    p = doc.add_paragraph(caption)
    for r in p.runs:
        r.font.size = Pt(9.5)
        r.italic = True
    path = OUT / fname
    if path.exists():
        doc.add_picture(str(path), width=Cm(16.5))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph()

doc.add_page_break()

# ------------------------------------------------------ internal appendix C
h('Appendix C — INTERNAL notes (delete before sending)', 1)
para('INTERNAL ONLY — remove this page before the document leaves CAST AI.', bold=True)
for t in [
    'Snapshot .txt twins in outbox/savings-sigsw-snapshots-20261008/ contain each page\'s text for pre-send verification.',
    'If the customer opens the console org savings view they may see ≈ $767k FY26 (org-wide, includes ngm-sim-eks $162k, sim2 $9.6k, data $3.1k, cilium $0.8k — same phantom-baseline and price-basis defects). Be ready to explain.',
    'ngm-sim-eks console savings $162,099.68 FY26 — review credibility before it reaches any management deck.',
    'FX used: €1 ≈ $1.0993. Fee €5/vCPU; if contractual rate is €5.70 → September fee €16,409.45 (net ≈ +$2.6–4.6k/month).',
    'Raw API evidence packs: cluster-cost-analysis/{helios,integ,kronos,org}-2026-10-08/ (~25–50 JSON files each).',
]:
    bullet(t)

doc.save(DOC)
print('written:', DOC)
