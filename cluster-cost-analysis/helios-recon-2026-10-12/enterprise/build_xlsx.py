#!/usr/bin/env python3
"""Build ENTERPRISE-SEP26-NET-SAVINGS.xlsx from the merged CSV."""
import csv
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

BASE = '/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12'
SRC  = f'{BASE}/vr_sep26_enterprise_net_savings.csv'
OUT  = f'{BASE}/ENTERPRISE-SEP26-NET-SAVINGS.xlsx'

rows = []
with open(SRC) as fh:
    rd = csv.DictReader(fh)
    for r in rd:
        rows.append(r)

def num(v):
    return float(v) if v not in ('', None) else None

for r in rows:
    for k in ('actual_usd', 'projected_usd', 'gross_savings_usd', 'billable_vcpu_phase2',
              'fee_usd_at_5.00', 'fee_usd_at_5.70', 'net_usd_at_5.00', 'net_usd_at_5.70'):
        r[k] = num(r[k])

HDR_FILL = PatternFill('solid', fgColor='1F3864')
ORG_FILL = PatternFill('solid', fgColor='D9E2F3')
TOT_FILL = PatternFill('solid', fgColor='FFE699')
HDR_FONT = Font(bold=True, color='FFFFFF', size=11)
RED      = Font(color='C00000')
GREEN    = Font(color='1E7A1E')
THIN     = Border(bottom=Side(style='thin', color='BFBFBF'))

MONEY0 = '#,##0'
MONEY2 = '#,##0.00'
VCPUF  = '#,##0.000'

wb = Workbook()

# ================= Sheet 1: Org roll-up =================
ws = wb.active
ws.title = 'Org roll-up'
ws.merge_cells('A1:J1')
ws['A1'] = 'Siemens AG enterprise — CAST AI September 2026 net savings by sub-organization (fee rates $5.00 and $5.70 per billable vCPU)'
ws['A1'].font = Font(bold=True, size=12)
ws.append([])
hdr = ['Organization', 'Total clusters', 'w/ VR savings', 'Actual $', 'Projected $', 'Gross savings $',
       'Billable vCPU', 'Fee $ @5.00', 'Fee $ @5.70', 'Net $ @5.00', 'Net $ @5.70']
ws.append(hdr)

orgs = {}
for r in rows:
    o = orgs.setdefault(r['organization'], {'clu': 0, 'vr': 0, 'a': 0, 'p': 0, 's': 0, 'v': 0, 'n5': 0, 'n57': 0, 'net': False})
    o['clu'] += 1
    o['vr'] += 1 if r['has_vr'] == 'yes' else 0
    o['a'] += r['actual_usd'] or 0
    o['p'] += r['projected_usd'] or 0
    o['s'] += r['gross_savings_usd'] or 0
    o['v'] += r['billable_vcpu_phase2'] or 0
    o['n5'] += r['net_usd_at_5.00'] or 0
    o['n57'] += r['net_usd_at_5.70'] or 0
    if (r['gross_savings_usd'] or 0) != 0 or (r['billable_vcpu_phase2'] or 0) > 0:
        o['net'] = True

tots = dict(clu=0, vr=0, a=0, p=0, s=0, v=0, n5=0, n57=0)
for name, o in sorted(orgs.items(), key=lambda kv: -kv[1]['s']):
    if not o['net']:
        continue
    ws.append([name, o['clu'], o['vr'], o['a'], o['p'], o['s'], o['v'], o['v']*5, o['v']*5.7, o['n5'], o['n57']])
    for k in tots:
        tots[k] += o[k]
ws.append(['Σ ENTERPRISE', tots['clu'], tots['vr'], tots['a'], tots['p'], tots['s'], tots['v'], tots['v']*5, tots['v']*5.7, tots['n5'], tots['n57']])

for cell in ws[3]:
    cell.font = HDR_FONT; cell.fill = HDR_FILL; cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
for row in ws.iter_rows(min_row=4):
    is_total = row[0].value == 'Σ ENTERPRISE'
    for c in row:
        c.border = THIN
        if is_total:
            c.fill = TOT_FILL
        val = c.value
        red = False
        if c.column in (4, 5, 6, 8, 9, 10, 11) and isinstance(val, (int, float)):
            c.number_format = MONEY0 if c.column in (4, 5, 6) else MONEY2
            if c.column >= 10 and val < 0:
                red = True
        if c.column == 7 and isinstance(val, (int, float)):
            c.number_format = VCPUF
        fkw = {}
        if is_total:
            fkw['bold'] = True
            if c.column >= 10 and isinstance(val, (int, float)) and val >= 0:
                fkw['color'] = '1E7A1E'
        if red:
            fkw['color'] = 'C00000'
        if fkw:
            c.font = Font(**fkw)
ws.freeze_panes = 'A4'
for i, width in enumerate([36, 15, 15, 14, 14, 15, 14, 14, 14, 14, 14], start=1):
    ws.column_dimensions[get_column_letter(i)].width = width

# ================= Sheet 2: All clusters =================
ws2 = wb.create_sheet('All clusters')
ws2.merge_cells('A1:N1')
ws2['A1'] = 'All clusters in all reachable sub-organizations — 267 rows (September 2026, VR report Sep window Europe/Berlin, discounted prices; fee = provisioned vCPU × rate)'
ws2['A1'].font = Font(bold=True, size=12)
ws2.append([])
hdr2 = ['Organization', 'Cluster name', 'Cluster ID (name#account#region)', 'CAST AI cluster ID', 'Region',
        'Actual $', 'Projected $', 'Gross savings $', 'Billable vCPU', 'Fee $ @5.00', 'Fee $ @5.70',
        'Net $ @5.00', 'Net $ @5.70', 'Has VR row']
ws2.append(hdr2)
for r in rows:
    ws2.append([r['organization'], r['cluster_name'], r['cluster_id'], r['castai_cluster_id'], r['region'],
                r['actual_usd'], r['projected_usd'], r['gross_savings_usd'], r['billable_vcpu_phase2'],
                r['fee_usd_at_5.00'], r['fee_usd_at_5.70'], r['net_usd_at_5.00'], r['net_usd_at_5.70'],
                r['has_vr']])
for cell in ws2[3]:
    cell.font = HDR_FONT; cell.fill = HDR_FILL; cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
for row in ws2.iter_rows(min_row=4):
    for c in row:
        c.border = THIN
        if c.column in (6, 7, 8) and isinstance(c.value, (int, float)):
            c.number_format = MONEY0
        if c.column in (10, 11, 12, 13) and isinstance(c.value, (int, float)):
            c.number_format = MONEY2
            if c.column >= 12 and c.value < 0:
                c.font = RED
        if c.column == 9 and isinstance(c.value, (int, float)):
            c.number_format = VCPUF
ws2.freeze_panes = 'A4'
ws2.auto_filter.ref = f'A3:N{3 + len(rows)}'
for i, width in enumerate([33, 34, 48, 38, 13, 12, 12, 14, 12, 12, 12, 13, 13, 11], start=1):
    ws2.column_dimensions[get_column_letter(i)].width = width

# ================= Sheet 3: Notes & provenance =================
ws3 = wb.create_sheet('Notes & provenance')
ws3.column_dimensions['A'].width = 130
notes = [
    ('Siemens AG enterprise — CAST AI September 2026 net savings — notes', True),
    ('', False),
    ('Basis: Value-Realization per-cluster report (POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport),', False),
    ('Sep window 2026-08-31T22:00:00Z → 2026-09-30T22:00:00Z Europe/Berlin, discounted prices (console parity).', False),
    ('IMPORTANT VR QUIRK: the endpoint returns HTTP 200 with EMPTY items unless header X-CastAI-Organization-Id matches the path org — verified 2026-10-12; all 21 billed orgs re-pulled correctly.', False),
    ('Fees: enterprise billing platform-usage-detail (feature=phase2), aggregated at Siemens AG parent org, 56 billed clusters, 8,632.32 billable vCPU. Rates $5.00 and $5.70 per vCPU (contractually pending: confirm with Finance; if quoted in EUR, apply EUR→USD FX ~1.15).', False),
    ('Clusters with no VR row and no billing ("unmanaged/roster") are listed with "—" economics: they consume no CAST AI fee and produced no reported savings in the September window.', False),
    ('4 default orgs were not accessible to the API key (HTTP 403): CAST AI EU, Siemens-test, Siemens-test-on (internal/test orgs, not customer sub-orgs).', False),
    ('One orphan billed cluster (0.022 vCPU, no inventory row — likely deleted mid-month) excluded; fee impact $0.11.', False),
    ('Spezialfälle: IT IPS net-negative (eleX01 fee base 1,736 vCPU vs September savings $8,085); DI SW PRS AMER SLC has negative VR savings on Posit; Pillar#1 clusters sit inside their baseline window (projected = actual by definition).', False),
    ('SMO Railigent X savings relate mainly to one cluster (k8s, 1,073 vCPU) — verify its baseline factors before quoting externally.', False),
    ('', False),
    ('Provenance (all read-only pulls, api.eu.cast.ai, 2026-10-12):', False),
    ('  organizations_full.json (130 orgs), enterprise/result_slice1..8.tsv (8 parallel sweeps), enterprise/vr_<orgid>.json (21 verified pulls),', False),
    ('  billing_phase2_sep26_enterprise.json (parent-aggregated, 56 entities), vr_sep26_berlin_all_clusters.json (SI GSW CLO console-verified rows, pinned).', False),
    ('  CSV twin: vr_sep26_enterprise_net_savings.csv · Report: ENTERPRISE-SEP26-NET-SAVINGS.md', False),
]
for text, bold in notes:
    ws3.append([text])
    if bold:
        ws3.cell(row=ws3.max_row, column=1).font = Font(bold=True, size=12)
    else:
        ws3.cell(row=ws3.max_row, column=1).alignment = Alignment(wrap_text=True, vertical='top')

wb.save(OUT)
print(f'saved {OUT}')
