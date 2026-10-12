#!/usr/bin/env python3
"""Reconcile everything OFFLINE from stored evidence: pasted_rows.tsv + proof/live/* + live VR payloads.
Outputs: live_matrix.csv (per-cluster verification verdicts) and corrected_table.csv
(paste with corrected Plans/First-rebalance where live full-pagination proved the sheet was truncated)."""
import csv, json, glob, os

P = os.path.dirname(os.path.abspath(__file__))
ORGS = {}
for line in open(f'{P}/../classic_scope.tsv'):
    c = line.rstrip('\n').split('\t')
    if len(c) >= 4:
        ORGS[c[0]] = (c[1], c[2])

vr_live = {}
for fp in glob.glob(f'{P}/live/vr_*_live.json'):
    for it in json.load(open(fp)).get('items', []):
        vr_live[it['clusterId']] = it.get('cost', {})

def xlr(x, nd):
    from decimal import Decimal, ROUND_HALF_UP
    return float(Decimal(str(x)).quantize(Decimal(1).scaleb(-nd), rounding=ROUND_HALF_UP))

def num(s):
    return float(str(s).replace(',', '').strip())

rows_out, corr_out = [], []
pasted = list(csv.DictReader(open(f'{P}/pasted_rows.tsv'), delimiter='\t'))
for r in pasted:
    u = r['CAST AI cluster ID'].strip()
    d = f'{P}/live/{u}'
    rec = dict(uuid=u, org=r['Organization'], name=r['Cluster name'])
    # BP
    try:
        bp = json.load(open(f'{d}/baseline-params.json'))
        rec['bp_ok'] = (r['Baseline type'] == bp.get('baselineType')
                        and r['Baseline start'] == (bp.get('baselinePeriodStartTime') or '')[:10]
                        and r['Baseline end'] == (bp.get('baselinePeriodEndTime') or '')[:10]
                        and r['Recomputed'] == (bp.get('updateTime') or '')[:10]
                        and abs(num(r['CPU factor']) - float(bp.get('cpuOverprovisioningFactor'))) <= 5e-5
                        and abs(num(r['RAM factor']) - float(bp.get('memoryOverprovisioningFactor'))) <= 5e-5)
        rec['bp_price_cpu'] = bp.get('costPerCpuCoreHourly'); rec['bp_price_ram'] = bp.get('costPerMemoryGibHourly')
    except Exception as e:
        rec['bp_ok'] = f'ERR {e}'
    # INV
    item = None
    try:
        for line in open(f'{d}/inv_pages.jsonl'):
            for it in json.loads(line).get('items', []):
                if it.get('id') == u:
                    item = it
        reg = (item.get('region') or {}).get('name') or ''
        acct = (item.get('eks') or {}).get('accountId', '')
        rec['inv_ok'] = (r['Created'] == (item.get('createdAt') or '')[:10]
                         and r['First CAST op'] == (item.get('firstOperationAt') or '')[:19].replace('T', ' ')
                         and r['Status'] == item.get('status') and r['Region'] == reg
                         and r['isPhase2'] == str(item.get('isPhase2'))
                         and ('#' + acct + '#') in r['Cluster ID (name#account#region)'])
    except Exception as e:
        rec['inv_ok'] = f'ERR {e}'
    # RP (full pages, dedupe)
    try:
        seen, dates = set(), []
        for line in open(f'{d}/rp_pages.jsonl'):
            for it in json.loads(line).get('items', []):
                pid = it.get('rebalancingPlanId') or it.get('id')
                if pid and pid in seen:
                    continue
                seen.add(pid)
                if it.get('createdAt'):
                    dates.append(it['createdAt'])
        rec['plans_true'] = len(dates)
        rec['first_true'] = min(dates)[:10]
        rec['plans_paste'] = int(r['Plans']); rec['first_paste'] = r['First rebalance']
        rec['rp_verdict'] = ('OK' if (rec['plans_true'] == rec['plans_paste'] and rec['first_true'] == r['First rebalance'])
                             else 'CORRECTED')
    except Exception as e:
        rec['rp_verdict'] = f'ERR {e}'
    # VR live vs paste
    c = vr_live.get(u, {})
    if c:
        rec['vr_live_actual'] = round(float(c['actualCost']), 2)
        rec['vr_live_projected'] = round(float(c['projectedCost']), 2)
        rec['vr_live_savings'] = round(float(c['totalSavings']), 2)
        rec['vr_verdict'] = ('OK' if (xlr(float(c['actualCost']), 0) == num(r['Actual $ (VR)'])
                                      and xlr(float(c['projectedCost']), 0) == num(r['Projected $ (VR)'])
                                      and xlr(float(c['totalSavings']), 0) == num(r['VR savings $']))
                             else f"DRIFT d_proj={float(c['projectedCost']) - num(r['Projected $ (VR)']):+.2f}")
    else:
        rec['vr_verdict'] = 'NO ITEM'
    rows_out.append(rec)
    # corrected table row
    co = dict(r)
    co['Plans'] = str(rec.get('plans_true', r['Plans']))
    co['First rebalance'] = rec.get('first_true', r['First rebalance'])
    co['Plans corrected'] = 'yes' if rec.get('rp_verdict') == 'CORRECTED' and str(rec['plans_paste']) != str(rec['plans_true']) else ''
    co['First rebalance corrected'] = 'yes' if rec.get('rp_verdict') == 'CORRECTED' and rec['first_paste'] != rec['first_true'] else ''
    corr_out.append(co)

with open(f'{P}/live_matrix.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows_out[0].keys()))
    w.writeheader(); w.writerows(rows_out)
with open(f'{P}/corrected_table.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(corr_out[0].keys()))
    w.writeheader(); w.writerows(corr_out)

print(f"{'cluster':<28}{'BP':>5}{'INV':>5}{'VR':>28}{'RP':>10}  plans paste→true · first paste→true")
for rec in rows_out:
    print(f"{rec['name'][:27]:<28}{str(rec['bp_ok'])[:4]:>5}{str(rec['inv_ok'])[:4]:>5}"
          f"{rec.get('vr_verdict', ''):>28}{rec.get('rp_verdict', ''):>10}  "
          f"{rec.get('plans_paste')}→{rec.get('plans_true')} · {rec.get('first_paste')}→{rec.get('first_true')}")
ok_bp = sum(1 for r in rows_out if r['bp_ok'] is True)
ok_inv = sum(1 for r in rows_out if r['inv_ok'] is True)
ok_vr = sum(1 for r in rows_out if r.get('vr_verdict') == 'OK')
rp_corr = sum(1 for r in rows_out if r.get('rp_verdict') == 'CORRECTED')
print(f"\nBP live-verified {ok_bp}/21 · INV live-verified {ok_inv}/21 · VR live matches paste {ok_vr}/21 · RP corrected {rp_corr}/21, exact {21 - rp_corr}/21")
print('wrote live_matrix.csv + corrected_table.csv')
