#!/usr/bin/env python3
"""Merge org-sweep slices + enterprise billing -> per-org net savings tables."""
import json, csv, glob, collections

BASE = '/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12'
ENT  = f'{BASE}/enterprise'

def _f(x):
    try:
        return float(x)
    except Exception:
        return None

def f(x, d=0):
    return f"{x:,.{d}f}" if x is not None else "—"

bill_raw = json.load(open(f'{BASE}/billing_phase2_sep26_enterprise.json'))['detail']['entities']
bill = {e['entityName']: e['usage'] for e in bill_raw}

rows, seen = [], set()
for fp in sorted(glob.glob(f'{ENT}/result_slice*.tsv')):
    for line in open(fp):
        line = line.rstrip('\n')
        if not line or line.startswith('ORG_NAME'):
            continue
        c = line.split('\t')
        if len(c) < 10:
            continue
        org, oid, name, uuid, acct, region, has_vr, a, p, s = c[:10]
        key = (oid, uuid)
        if key in seen:
            continue
        seen.add(key)
        rows.append(dict(org=org, oid=oid, name=name, uuid=uuid, acct=acct, region=region,
                         has_vr=(has_vr.strip().lower() == 'yes'),
                         a=_f(a), p=_f(p), s=_f(s)))

for r in rows:
    v = bill.get(r['uuid'])
    r['vcpu'] = v
    r['fee5']  = v * 5.00 if v is not None else None
    r['fee57'] = v * 5.70 if v is not None else None
    if r['has_vr'] and r['s'] is not None:
        r['net5']  = r['s'] - r['fee5']  if r['fee5']  is not None else r['s']
        r['net57'] = r['s'] - r['fee57'] if r['fee57'] is not None else r['s']
    else:
        r['net5']  = -r['fee5']  if r['fee5']  else None
        r['net57'] = -r['fee57'] if r['fee57'] else None

orphans = [(u, v) for u, v in bill.items() if u not in {r['uuid'] for r in rows}]

orgs = collections.OrderedDict()
for r in sorted(rows, key=lambda r: (r['org'].lower(), -(r['s'] or 0))):
    orgs.setdefault(r['org'], []).append(r)

# ---------- CSV ----------
with open(f'{BASE}/vr_sep26_enterprise_net_savings.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['organization', 'cluster_name', 'cluster_id', 'castai_cluster_id', 'region',
                'actual_usd', 'projected_usd', 'gross_savings_usd', 'billable_vcpu_phase2',
                'fee_usd_at_5.00', 'fee_usd_at_5.70', 'net_usd_at_5.00', 'net_usd_at_5.70', 'has_vr'])
    for org, rs in orgs.items():
        for r in rs:
            cid = f"{r['name']}#{r['acct']}#{r['region']}" if r['acct'] not in (None, '', '-', '?') else r['uuid']
            w.writerow([org, r['name'], cid, r['uuid'], r['region'],
                        f"{r['a']:.2f}" if r['a'] is not None else '',
                        f"{r['p']:.2f}" if r['p'] is not None else '',
                        f"{r['s']:.2f}" if r['s'] is not None else '',
                        f"{r['vcpu']:.3f}" if r['vcpu'] is not None else '',
                        f"{r['fee5']:.2f}" if r['fee5'] is not None else '',
                        f"{r['fee57']:.2f}" if r['fee57'] is not None else '',
                        f"{r['net5']:.2f}" if r['net5'] is not None else '',
                        f"{r['net57']:.2f}" if r['net57'] is not None else '',
                        'yes' if r['has_vr'] else 'no'])

# ---------- console summary ----------
T = dict(a=0, p=0, s=0, v=0, f5=0, f57=0, n5=0, n57=0, vr=0, novr=0)
print(f"\n{'ORG':<34}{'clusters':>9}{'w/ VR':>7}{'savings $':>12}{'vCPU':>10}{'net @5.00':>12}{'net @5.70':>12}")
for org, rs in orgs.items():
    vr  = [r for r in rs if r['has_vr']]
    gs  = sum(r['s'] or 0 for r in rs)
    vv  = sum(r['vcpu'] or 0 for r in rs)
    n5  = sum(r['net5'] for r in rs if r['net5'] is not None)
    n57 = sum(r['net57'] for r in rs if r['net57'] is not None)
    if not vr and vv == 0:
        continue
    print(f"{org:<34}{len(rs):>9}{len(vr):>7}{f(gs):>12}{f(vv,2):>10}{f(n5):>12}{f(n57):>12}")
    T['a'] += sum(r['a'] or 0 for r in rs); T['p'] += sum(r['p'] or 0 for r in rs)
    T['s'] += gs; T['v'] += vv; T['n5'] += n5; T['n57'] += n57
    T['f5'] += sum(r['fee5'] or 0 for r in rs); T['f57'] += sum(r['fee57'] or 0 for r in rs)
    T['vr'] += len(vr); T['novr'] += len(rs) - len(vr)
print(f"{'Σ ENTERPRISE':<34}{T['vr']+T['novr']:>9}{T['vr']:>7}{f(T['s']):>12}{f(T['v'],2):>10}{f(T['n5']):>12}{f(T['n57']):>12}")
print(f"\nΣ actual {f(T['a'],2)} | Σ projected {f(T['p'],2)} | Σ fee @5.00 {f(T['f5'],2)} | @5.70 {f(T['f57'],2)}")
print(f"orphan billed clusters (no inventory/VR row found): {len(orphans)} "
      f"-> {sum(v for _, v in orphans):,.3f} vCPU, fee @5 ${sum(v*5 for _, v in orphans):,.2f}")
for u, v in orphans:
    print(f"   orphan {u}  {v:.3f} vCPU  -> ${v*5:,.2f}")
