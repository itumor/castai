#!/usr/bin/env python3
"""Final merge: slice TSVs + verified VR pulls (header-fixed) + enterprise billing."""
import json, csv, glob, collections

BASE = '/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12'
ENT  = f'{BASE}/enterprise'

def fnum(x):
    try:
        return float(x)
    except Exception:
        return None

def fmt(x, d=0):
    return f"{x:,.{d}f}" if x is not None else "—"

bill = {e['entityName']: e['usage'] for e in json.load(open(f'{BASE}/billing_phase2_sep26_enterprise.json'))['detail']['entities']}

vr = {}
for fp in glob.glob(f'{ENT}/vr_*.json'):
    if '_slice' in fp or '_guard' in fp:
        continue
    for it in json.load(open(fp)).get('items', []):
        vr[it['clusterId']] = it

rows, seen = [], set()
for fp in sorted(glob.glob(f'{ENT}/result_slice*.tsv')):
    for line in open(fp):
        c = line.rstrip('\n').split('\t')
        if len(c) < 6 or c[0].strip() == 'ORG_NAME':
            continue
        org, oid, name, uuid, acct, region = [c[i].strip() for i in range(6)]
        if (oid, uuid) in seen:
            continue
        seen.add((oid, uuid))
        it = vr.get(uuid)
        rows.append(dict(org=org, oid=oid, name=name, uuid=uuid, acct=acct, region=region,
                         has_vr=bool(it),
                         a=fnum(it['cost']['actualCost']) if it else None,
                         p=fnum(it['cost']['projectedCost']) if it else None,
                         s=fnum(it['cost']['totalSavings']) if it else None))

known = {r['uuid'] for r in rows}
for u, it in vr.items():
    if u not in known:
        rows.append(dict(org='(VR-only)', oid='?', name=it['clusterName'], uuid=u, acct='-', region='-',
                         has_vr=True,
                         a=fnum(it['cost']['actualCost']), p=fnum(it['cost']['projectedCost']),
                         s=fnum(it['cost']['totalSavings'])))

for r in rows:
    v = bill.get(r['uuid'])
    r['vcpu']  = v
    r['fee5']  = (v or 0) * 5.00 if v is not None else None
    r['fee57'] = (v or 0) * 5.70 if v is not None else None
    if r['has_vr'] and r['s'] is not None:
        r['net5'], r['net57'] = r['s'] - (r['fee5'] or 0), r['s'] - (r['fee57'] or 0)
    else:
        r['net5']  = -(r['fee5']  or 0) if r['fee5']  else None
        r['net57'] = -(r['fee57'] or 0) if r['fee57'] else None

orphans = [(u, v) for u, v in bill.items() if u not in {r['uuid'] for r in rows} and v > 0.01]

orgs_map = collections.OrderedDict()
for r in sorted(rows, key=lambda r: (r['org'].lower(), -(r['s'] or 0))):
    orgs_map.setdefault(r['org'], []).append(r)

with open(f'{BASE}/vr_sep26_enterprise_net_savings.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['organization', 'cluster_name', 'cluster_id', 'castai_cluster_id', 'region',
                'actual_usd', 'projected_usd', 'gross_savings_usd', 'billable_vcpu_phase2',
                'fee_usd_at_5.00', 'fee_usd_at_5.70', 'net_usd_at_5.00', 'net_usd_at_5.70', 'has_vr'])
    for org, rs in orgs_map.items():
        for r in rs:
            cid = f"{r['name']}#{r['acct']}#{r['region']}" if r['acct'] not in ('', '-', '?') else r['uuid']
            w.writerow([org, r['name'], cid, r['uuid'], r['region'],
                        *['' if r[k] is None else f"{r[k]:.2f}" for k in ('a', 'p', 's')],
                        '' if r['vcpu'] is None else f"{r['vcpu']:.3f}",
                        *['' if r[k] is None else f"{r[k]:.2f}" for k in ('fee5', 'fee57', 'net5', 'net57')],
                        'yes' if r['has_vr'] else 'no'])

T = collections.defaultdict(float)
nvr = nclu = 0
print(f"\n{'ORG':<34}{'clu':>5}{'VR':>4}{'actual':>10}{'projected':>11}{'savings':>10}{'vCPU':>9}{'net@5':>10}{'net@5.7':>10}")
for org, rs in orgs_map.items():
    vr_n = sum(1 for r in rs if r['has_vr'])
    a = sum(r['a'] or 0 for r in rs); p = sum(r['p'] or 0 for r in rs); s = sum(r['s'] or 0 for r in rs)
    v = sum(r['vcpu'] or 0 for r in rs)
    n5 = sum(r['net5'] for r in rs if r['net5'] is not None)
    n57 = sum(r['net57'] for r in rs if r['net57'] is not None)
    if vr_n == 0 and v == 0:
        continue
    nvr += vr_n; nclu += len(rs)
    for k, val in zip('apsvn5n57', (a, p, s, v, n5, n57)):
        T[k] += val
    print(f"{org[:33]:<34}{len(rs):>5}{vr_n:>4}{fmt(a):>10}{fmt(p):>11}{fmt(s):>10}{fmt(v,2):>9}{fmt(n5):>10}{fmt(n57):>10}")
print(f"{'Σ ENTERPRISE':<34}{nclu:>5}{nvr:>4}{fmt(T['a']):>10}{fmt(T['p']):>11}{fmt(T['s']):>10}{fmt(T['v'],2):>9}{fmt(T['n5']):>10}{fmt(T['n57']):>10}")
print(f"\nfees: @5.00 ${T['v']*5:,.2f} | @5.70 ${T['v']*5.7:,.2f}")
print(f"orphan billed clusters (no inventory row, usage>0.01): {len(orphans)} = {sum(v for _, v in orphans):,.3f} vCPU")
