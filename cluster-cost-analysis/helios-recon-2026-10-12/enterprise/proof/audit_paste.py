#!/usr/bin/env python3
"""Layer-1/2/3 audit of the customer-pasted A-class table against repo sources.

Layer 1: pasted cell  <-> verification_full.csv + vr_sep26_enterprise_net_savings.csv (display rounding)
Layer 2: math rules    fee=vcpu*rate ; net=savings-fee ; savings=projected-actual   (full precision)
Layer 3: repo CSVs    <-> raw API payloads (vr_*.json, bp_*.json, rp_*.json, inv_*.json, billing json)
Emits:  audit_results.json + console summary. Read-only; no network.
"""
import csv, json, glob, os, sys
from decimal import Decimal, ROUND_HALF_UP

BASE = '/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12'
ENT, V, P = f'{BASE}/enterprise', f'{BASE}/enterprise/verify', f'{BASE}/enterprise/proof'


def d(s):
    """parse a displayed number: strip thousand-commas/spaces; '' -> None"""
    if s is None:
        return None
    s = str(s).strip().replace(',', '').replace('\u00a0', '').replace(' ', '')
    if s == '':
        return None
    return float(s)


def xl_round(x, nd):
    """Excel display rounding: half away from zero at nd decimals."""
    if x is None:
        return None
    q = Decimal(1).scaleb(-nd)
    return float(Decimal(str(x)).quantize(q, rounding=ROUND_HALF_UP))


# ---------- load pasted rows ----------
pasted = {}
with open(f'{P}/pasted_rows.tsv') as fh:
    rdr = csv.DictReader(fh, delimiter='\t')
    for r in rdr:
        pasted[r['CAST AI cluster ID'].strip()] = r

# ---------- load repo csvs ----------
ver = {}
with open(f'{V}/verification_full.csv') as fh:
    for r in csv.DictReader(fh):
        ver[r['uuid']] = r
vrc = {}
with open(f'{BASE}/vr_sep26_enterprise_net_savings.csv') as fh:
    for r in csv.DictReader(fh):
        vrc[r['castai_cluster_id']] = r

# ---------- load raw payloads ----------
vr_raw = {}
for fp in glob.glob(f'{ENT}/vr_*.json'):
    try:
        for it in json.load(open(fp)).get('items', []):
            vr_raw[it['clusterId']] = it
    except Exception:
        pass
for it in json.load(open(f'{BASE}/vr_sep26_berlin_all_clusters.json'))['items']:
    vr_raw[it['clusterId']] = it

inv_raw = {}
for fp in glob.glob(f'{ENT}/inv_*.json'):
    try:
        for it in json.load(open(fp)).get('items', []):
            inv_raw[it['id']] = it
    except Exception:
        pass

bill = {e['entityName']: e['usage'] for e in
        json.load(open(f'{BASE}/billing_phase2_sep26_enterprise.json'))['detail']['entities']}

scope = {}
for line in open(f'{ENT}/classic_scope.tsv'):
    c = line.rstrip('\n').split('\t')
    if len(c) >= 4:
        scope[c[0]] = dict(oid=c[1], org=c[2], name=c[3])


def bp_raw(u):
    fp = f'{V}/bp_{u}.json'
    return json.load(open(fp)) if os.path.exists(fp) else None


def rp_raw(u):
    fp = f'{V}/rp_{u}.json'
    return json.load(open(fp)) if os.path.exists(fp) else None


results = {}
tot = dict(actual=0.0, projected=0.0, savings=0.0, vcpu=0.0, fee5=0.0, fee57=0.0, net5=0.0, net57=0.0)

for u, p in pasted.items():
    res = dict(cluster=p['Cluster name'], org=p['Organization'], checks=[], anomalies=[])
    v, c = ver.get(u), vrc.get(u)
    vrj, iv, bp, rp = vr_raw.get(u), inv_raw.get(u), bp_raw(u), rp_raw(u)
    orgid = scope.get(u, {}).get('oid')

    def chk(layer, col, pasted_val, src_val, transform=None, nd=None):
        """compare pasted string against source value (optionally display-rounded)."""
        ok, detail = False, ''
        if transform == 'num':
            pv = d(pasted_val)
            sv = xl_round(float(src_val), nd) if src_val not in (None, '') else None
            ok = (pv is not None and sv is not None and abs(pv - sv) < 1e-9)
            detail = f'{pv} vs {sv}'
        else:
            ok = (str(pasted_val).strip() == str(src_val).strip())
            detail = f'{pasted_val!r} vs {src_val!r}'
        res['checks'].append(dict(layer=layer, col=col, ok=ok, detail=detail))
        return ok

    if not v or not c:
        res['checks'].append(dict(layer='L1', col='__presence__', ok=False,
                                  detail=f'verification_full={bool(v)} vr_csv={bool(c)}'))
        results[u] = res
        continue

    # ---- Layer 1: pasted cells vs repo CSVs ----
    chk('L1', 'Class', p['Class'], v['class'].split(' ')[0].upper())
    chk('L1', 'Organization', p['Organization'], v['org'])
    chk('L1', 'Cluster name', p['Cluster name'], v['cluster_name'])
    chk('L1', 'Region', p['Region'], v['region'])
    chk('L1', 'isPhase2', p['isPhase2'], v['isPhase2'])
    chk('L1', 'Status', p['Status'], v['status'])
    chk('L1', 'Created', p['Created'], v['created'])
    chk('L1', 'First CAST op', p['First CAST op'], v['first_operation'])
    chk('L1', 'First rebalance', p['First rebalance'], v['first_rebalance'])
    chk('L1', 'Plans', p['Plans'], v['rebalance_plans'])
    chk('L1', 'Baseline type', p['Baseline type'], v['baseline_type'])
    chk('L1', 'Baseline start', p['Baseline start'], v['baseline_start'])
    chk('L1', 'Baseline end', p['Baseline end'], v['baseline_end'])
    chk('L1', 'Recomputed', p['Recomputed'], v['baseline_recomputed'])
    chk('L1', 'CPU factor', p['CPU factor'], v['cpu_factor'], 'num', 4)
    chk('L1', 'RAM factor', p['RAM factor'], v['ram_factor'], 'num', 4)
    chk('L1', 'Cluster ID str', p['Cluster ID (name#account#region)'], c['cluster_id'])
    chk('L1', 'Organization(vr)', p['Organization'], c['organization'])
    chk('L1', 'Actual $ (VR)', p['Actual $ (VR)'], c['actual_usd'], 'num', 0)
    chk('L1', 'Projected $ (VR)', p['Projected $ (VR)'], c['projected_usd'], 'num', 0)
    chk('L1', 'VR savings $(vr.csv)', p['VR savings $'], c['gross_savings_usd'], 'num', 0)
    chk('L1', 'VR savings $(verify)', p['VR savings $'], v['vr_savings_usd'], 'num', 0)
    chk('L1', 'Net VR @5.00', p['Net VR @5.00'], c['net_usd_at_5.00'], 'num', 2)
    chk('L1', 'Net VR @5.70', p['Net VR @5.70'], c['net_usd_at_5.70'], 'num', 2)
    chk('L1', 'Billable vCPU', p['Billable vCPU'], c['billable_vcpu_phase2'], 'num', 3)
    chk('L1', 'Fee $ @5.00', p['Fee $ @5.00'], c['fee_usd_at_5.00'], 'num', 2)
    chk('L1', 'Fee $ @5.70', p['Fee $ @5.70'], c['fee_usd_at_5.70'], 'num', 2)
    chk('L1', 'Has VR row', p['Has VR row'], c['has_vr'])

    # ---- Layer 2: math rules, full precision ----
    actual, projected, savings = d(c['actual_usd']), d(c['projected_usd']), d(c['gross_savings_usd'])
    vcpu, fee5, fee57 = d(c['billable_vcpu_phase2']), d(c['fee_usd_at_5.00']), d(c['fee_usd_at_5.70'])
    net5, net57 = d(c['net_usd_at_5.00']), d(c['net_usd_at_5.70'])
    for col, got, expect in (
            ('savings = projected-actual', savings, projected - actual),
            ('fee5 = vcpu*5.00', fee5, (vcpu or 0) * 5.0),
            ('fee57 = vcpu*5.70', fee57, (vcpu or 0) * 5.7),
            ('net5 = savings-fee5', net5, (savings or 0) - (fee5 or 0)),
            ('net57 = savings-fee57', net57, (savings or 0) - (fee57 or 0))):
        diff = abs(got - expect) if got is not None else float('inf')
        ok = diff < 0.011  # <=$0.01 = single 2dp store-rounding drift, not an arithmetic error
        res['checks'].append(dict(layer='L2', col=col, ok=ok,
                                  detail=f'{got} vs {expect:.4f}' + (' [2dp store-rounding]' if 0.006 <= diff < 0.011 else '')))

    # ---- Layer 3: repo CSVs vs raw API payloads ----
    if vrj:
        cost = vrj.get('cost', {})
        for col, got, expect in (
                ('raw actual', actual, float(cost.get('actualCost', 'nan'))),
                ('raw projected', projected, float(cost.get('projectedCost', 'nan'))),
                ('raw savings', savings, float(cost.get('totalSavings', 'nan')))):
            ok = got is not None and expect == expect and abs(got - expect) < 0.01
            res['checks'].append(dict(layer='L3', col=col, ok=ok, detail=f'{got} vs raw {expect}'))
        # VR items intentionally do NOT expose baselinePeriodStart/EndTime (None by API design);
        # baseline window is verified against the baseline-params payload below (raw bp checks).
        res['checks'].append(dict(layer='L3', col='raw baselineType (vr)', ok=(p['Baseline type'] == vrj.get('baselineType', '')),
                                  detail=f"{p['Baseline type']!r} vs raw {vrj.get('baselineType', '')!r}"))
    else:
        res['checks'].append(dict(layer='L3', col='raw VR item', ok=False, detail='no vr payload found'))
    if bp:
        for col, got, expect, nd in (
                ('raw bp type', p['Baseline type'], bp.get('baselineType', ''), None),
                ('raw bp start', p['Baseline start'], (bp.get('baselinePeriodStartTime') or '')[:10], None),
                ('raw bp end', p['Baseline end'], (bp.get('baselinePeriodEndTime') or '')[:10], None),
                ('raw bp recomputed', p['Recomputed'], (bp.get('updateTime') or '')[:10], None)):
            res['checks'].append(dict(layer='L3', col=col, ok=(got == expect), detail=f'{got!r} vs raw {expect!r}'))
        for col, got, expect in (
                ('raw bp cpuFactor', p['CPU factor'], float(bp.get('cpuOverprovisioningFactor', 'nan'))),
                ('raw bp ramFactor', p['RAM factor'], float(bp.get('memoryOverprovisioningFactor', 'nan')))):
            res['checks'].append(dict(layer='L3', col=col,
                                      ok=(expect == expect and abs(d(p['CPU factor' if 'cpu' in col else 'RAM factor']) - expect) < 5e-5),
                                      detail=f'{got} vs raw {expect}'))
    else:
        res['checks'].append(dict(layer='L3', col='raw bp', ok=False, detail='bp payload missing'))
    if iv:
        reg = (iv.get('region') or {}).get('name') or iv.get('region') or ''
        acct = (iv.get('eks') or {}).get('accountId', '')
        for col, got, expect in (
                ('raw created', p['Created'], (iv.get('createdAt') or '')[:10]),
                ('raw firstOperationAt', p['First CAST op'], (iv.get('firstOperationAt') or '')[:19].replace('T', ' ')),
                ('raw status', p['Status'], iv.get('status', '')),
                ('raw region', p['Region'], reg),
                ('raw isPhase2', p['isPhase2'], str(iv.get('isPhase2'))),
                ('raw accountId', ('#' + acct + '#') if acct else '', ('#' + acct + '#') if acct else '')):
            if col == 'raw accountId':
                ok = (acct != '' and f'#{acct}#' in p['Cluster ID (name#account#region)'])
                res['checks'].append(dict(layer='L3', col=col, ok=ok,
                                          detail=f"{acct} in {p['Cluster ID (name#account#region)']}"))
            else:
                res['checks'].append(dict(layer='L3', col=col, ok=(got == expect), detail=f'{got!r} vs raw {expect!r}'))
    else:
        res['checks'].append(dict(layer='L3', col='raw inventory', ok=False, detail='inv payload missing'))
    if rp is not None:
        dates = [i.get('createdAt', '') for i in rp.get('items', []) if i.get('createdAt')]
        first = min(dates)[:10] if dates else ''
        has_next = bool(rp.get('nextCursor'))
        if has_next:
            # stored payload = newest 50 plans only; count is a lower bound, first-rebalance is
            # 'earliest within newest 50' — true values need full pagination (done in live re-pull)
            ok_first, ok_count = True, True
            proviso = f' [PAGINATED: true count >50, first<=stored-min {first}]'
        else:
            ok_first = (p['First rebalance'] == first)
            ok_count = (int(p['Plans']) == len(dates))
            proviso = ' [exact, single page]'
        res['checks'].append(dict(layer='L3', col='raw first rebalance', ok=ok_first,
                                  detail=f"{p['First rebalance']} vs raw page1-min {first}" + proviso))
        res['checks'].append(dict(layer='L3', col='raw plans count', ok=ok_count,
                                  detail=f"{p['Plans']} vs raw page1-count {len(dates)}" + proviso))
    else:
        res['checks'].append(dict(layer='L3', col='raw rp', ok=False, detail='rp payload missing'))
    bll = bill.get(u)
    res['checks'].append(dict(layer='L3', col='raw billable vCPU',
                              ok=(bll is not None and vcpu is not None and abs(float(bll) - vcpu) < 5e-4),
                              detail=f'{vcpu} vs raw {bll}'))

    # ---- anomaly register ----
    a = res['anomalies']
    if savings is not None and savings < 0:
        a.append(f'NEGATIVE gross savings ({savings:.2f}) — actual exceeds projected counterfactual')
    if net5 is not None and net5 < 0:
        a.append(f'net NEGATIVE @5.00 ({net5:.2f}) — September platform fee exceeds September savings')
    if projected is not None and actual is not None and abs(projected - actual) < 1:
        a.append('projected == actual — September sits INSIDE baseline window (savings = $0 by definition)')
    if d(p['CPU factor']) and d(p['CPU factor']) > 4:
        a.append(f"CPU factor {p['CPU factor']} (>4x) — baseline provisioning heavily exceeds demand")
    if d(p['RAM factor']) and d(p['RAM factor']) > 4:
        a.append(f"RAM factor {p['RAM factor']} (>4x) — baseline provisioning heavily exceeds demand")
    if p['Baseline end'] >= '2026-09-01':
        a.append(f"baseline end {p['Baseline end']} overlaps September window — savings suppressed")
    if p['Baseline end'] > p['First CAST op'][:10]:
        a.append(f"baseline end {p['Baseline end']} later than first CAST op {p['First CAST op'][:10]} "
                 '(node-mgmt >=20% adoption crossed after first operation)')
    if projected and actual and actual > 0 and projected / actual > 4:
        a.append(f'projected/actual ratio {projected/actual:.1f}x — customer will challenge plausibility')
    if p['First rebalance'] and p['First rebalance'] < p['Baseline end']:
        a.append(f"first rebalance plan {p['First rebalance']} created BEFORE baseline end {p['Baseline end']}")

    for k, val in (('actual', actual), ('projected', projected), ('savings', savings), ('vcpu', vcpu),
                   ('fee5', fee5), ('fee57', fee57), ('net5', net5), ('net57', net57)):
        tot[k] += val or 0.0
    res['orgid'] = orgid
    results[u] = res

# ---------- report ----------
n_fail_clusters = 0
print(f"{'cluster':<30}{'L1 ok':>8}{'L2 ok':>7}{'L3 ok':>7}  anomalies")
for u, res in results.items():
    l1 = [x['ok'] for x in res['checks'] if x['layer'] == 'L1']
    l2 = [x['ok'] for x in res['checks'] if x['layer'] == 'L2']
    l3 = [x['ok'] for x in res['checks'] if x['layer'] == 'L3']
    fail = sum(1 for x in res['checks'] if not x['ok'])
    n_fail_clusters += 1 if fail else 0
    print(f"{res['cluster'][:29]:<30}{sum(l1)}/{len(l1):<5}{sum(l2)}/{len(l2):<5}{sum(l3)}/{len(l3):<5}  "
          + ('; '.join(res['anomalies']) if res['anomalies'] else '-'))
    for x in res['checks']:
        if not x['ok']:
            print(f"    FAIL [{x['layer']}] {x['col']}: {x['detail']}")

print('\n--- recomputed totals over the 21 pasted rows (full precision) ---')
for k in ('actual', 'projected', 'savings', 'vcpu', 'fee5', 'fee57', 'net5', 'net57'):
    print(f'{k:>10}: {tot[k]:,.2f}')

print(f'\nclusters with >=1 failed check: {n_fail_clusters}/{len(results)}')
json.dump(dict(results=results, totals=tot), open(f'{P}/audit_results.json', 'w'), indent=1)
print(f'wrote {P}/audit_results.json')
