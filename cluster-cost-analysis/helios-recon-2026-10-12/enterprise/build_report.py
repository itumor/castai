#!/usr/bin/env python3
"""Final build: org sections md + csv + chat summary for enterprise net savings."""
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

# authoritative VR: fresh header-fixed pulls for all orgs
vr = {}
for fp in glob.glob(f'{ENT}/vr_*.json'):
    if '_slice' in fp or '_guard' in fp:
        continue
    for it in json.load(open(fp)).get('items', []):
        vr[it['clusterId']] = it
# override SI GSW CLO with the console-verified pull (presented earlier today)
for it in json.load(open(f'{BASE}/vr_sep26_berlin_all_clusters.json'))['items']:
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
        rows.append(dict(org='(VR-only, no inventory row)', oid='?', name=it['clusterName'],
                         uuid=u, acct='-', region='-', has_vr=True,
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

orgs_map = collections.OrderedDict()
for r in sorted(rows, key=lambda r: (r['org'].lower(), -(r['s'] or 0), r['name'])):
    orgs_map.setdefault(r['org'], []).append(r)

def cid_of(r):
    return f"{r['name']}#{r['acct']}#{r['region']}" if r['acct'] not in ('', '-', '?') else r['uuid']

def num(r, k, d=0):
    return fmt(r[k], d)

# ---------- CSV ----------
with open(f'{BASE}/vr_sep26_enterprise_net_savings.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['organization', 'cluster_name', 'cluster_id', 'castai_cluster_id', 'region',
                'actual_usd', 'projected_usd', 'gross_savings_usd', 'billable_vcpu_phase2',
                'fee_usd_at_5.00', 'fee_usd_at_5.70', 'net_usd_at_5.00', 'net_usd_at_5.70', 'has_vr'])
    for org, rs in orgs_map.items():
        for r in rs:
            w.writerow([org, r['name'], cid_of(r), r['uuid'], r['region'],
                        *['' if r[k] is None else f"{r[k]:.2f}" for k in ('a', 'p', 's')],
                        '' if r['vcpu'] is None else f"{r['vcpu']:.3f}",
                        *['' if r[k] is None else f"{r[k]:.2f}" for k in ('fee5', 'fee57', 'net5', 'net57')],
                        'yes' if r['has_vr'] else 'no'])

# ---------- per-org aggregates (only orgs with economics) ----------
econ = []
for org, rs in orgs_map.items():
    vr_n = sum(1 for r in rs if r['has_vr'])
    v = sum(r['vcpu'] or 0 for r in rs)
    s = sum(r['s'] or 0 for r in rs)
    if vr_n == 0 and v == 0:
        continue
    econ.append(dict(org=org, rs=rs, vr_n=vr_n, clu=len(rs), a=sum(r['a'] or 0 for r in rs),
                     p=sum(r['p'] or 0 for r in rs), s=s, v=v,
                     n5=sum(r['net5'] for r in rs if r['net5'] is not None),
                     n57=sum(r['net57'] for r in rs if r['net57'] is not None)))

T = dict(a=sum(e['a'] for e in econ), p=sum(e['p'] for e in econ), s=sum(e['s'] for e in econ),
         v=sum(e['v'] for e in econ), n5=sum(e['n5'] for e in econ), n57=sum(e['n57'] for e in econ),
         clu=sum(e['clu'] for e in econ), vr=sum(e['vr_n'] for e in econ))

# ---------- chat summary ----------
print(f"\n{'Organization':<28}{'clu':>5}{'VR':>4}{'Actual':>10}{'Projected':>11}{'Gross sav':>10}{'vCPU':>9}{'Net@5.00':>11}{'Net@5.70':>11}")
for e in sorted(econ, key=lambda e: -e['s']):
    print(f"{e['org'][:27]:<28}{e['clu']:>5}{e['vr_n']:>4}{fmt(e['a']):>10}{fmt(e['p']):>11}{fmt(e['s']):>10}{fmt(e['v'],2):>9}{fmt(e['n5']):>11}{fmt(e['n57']):>11}")
print(f"{'Σ ENTERPRISE':<28}{T['clu']:>5}{T['vr']:>4}{fmt(T['a']):>10}{fmt(T['p']):>11}{fmt(T['s']):>10}{fmt(T['v'],2):>9}{fmt(T['n5']):>11}{fmt(T['n57']):>11}")
print(f"\nTotal clusters in roster: {len(rows)} | orgs scanned: 130 (3 defaulted 403: CAST AI EU, Siemens-test, Siemens-test-on) | VR-bearing rows: {T['vr']}")

# ---------- markdown deliverable ----------
HDR = "| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |"
DIV = "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"
L = []
L.append("# Siemens AG enterprise — CAST AI September 2026 net savings, all sub-organizations, all clusters")
L.append("")
L.append("**Basis:** Value-Realization per-cluster report (`POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport` — note: the endpoint returns data **only when the `X-CastAI-Organization-Id` header matches the path org**), Sep window Europe/Berlin, discounted prices (console parity) · fees = enterprise billing `platform-usage-detail` (feature=phase2, aggregated at Siemens AG parent) × **$5.00** and × **$5.70** per billable vCPU · identification `cluster_id = name#aws_account_id#region`. All pulls 2026-10-12, `api.eu.cast.ai`. SI GSW CLO rows pinned to the console-verified pull presented earlier today.")
L.append("")
L.append(f"**Σ ENTERPRISE: {130} orgs scanned · {len(orgs_map)} orgs with clusters · {len(rows)} clusters inventoried · {T['vr']} VR-savings rows · actual Σ ${fmt(T['a'])} · projected Σ ${fmt(T['p'])} · gross savings Σ ${fmt(T['s'])} · billable Σ {fmt(T['v'],2)} vCPU · fee Σ ${fmt(T['v']*5,2)} @5.00 / ${fmt(T['v']*5.7,2)} @5.70 · NET Σ **+${fmt(T['n5'])}** @5.00 / **+${fmt(T['n57'])}** @5.70.**")
L.append("")
org_rows = sorted(econ, key=lambda e: -e['s'])
rows_md = [f"| {e['org']} | {e['clu']} | {e['vr_n']} | {fmt(e['a'])} | {fmt(e['p'])} | {fmt(e['s'])} | {fmt(e['v'],2)} | {fmt(e['v']*5,2)} | {fmt(e['v']*5.7,2)} | **{'+' if e['n5']>=0 else ''}{fmt(e['n5'])}** | **{'+' if e['n57']>=0 else ''}{fmt(e['n57'])}** |" for e in org_rows]
L += ["## Organization roll-up (orgs with savings or fees)",
      "",
      "| Organization | Total clusters | w/ VR | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
      *rows_md,
      f"| **Σ** | **{T['clu']}** | **{T['vr']}** | **{fmt(T['a'])}** | **{fmt(T['p'])}** | **{fmt(T['s'])}** | **{fmt(T['v'],2)}** | **{fmt(T['v']*5,2)}** | **{fmt(T['v']*5.7,2)}** | **+{fmt(T['n5'])}** | **+{fmt(T['n57'])}** |", ""]
for e in org_rows:
    L.append(f"## {e['org']}")
    L.append("")
    L.append(HDR); L.append(DIV)
    st = dict(a=0, p=0, s=0, v=0, f5=0, f57=0, n5=0, n57=0)
    for r in e['rs']:
        n5 = fmt(r['net5']) if r['net5'] is not None else "—"
        n57 = fmt(r['net57']) if r['net57'] is not None else "—"
        L.append(f"| {r['name']} | {cid_of(r)} | `{r['uuid']}` | {r['region']} | {num(r,'a')} | {num(r,'p')} | {num(r,'s')} | {fmt(r['vcpu'],2) if r['vcpu'] is not None else '—'} | {fmt(r['fee5'],2) if r['fee5'] is not None else '—'} | {fmt(r['fee57'],2) if r['fee57'] is not None else '—'} | {n5} | {n57} |")
        st['a'] += r['a'] or 0; st['p'] += r['p'] or 0; st['s'] += r['s'] or 0
        st['v'] += r['vcpu'] or 0
        st['f5'] += r['fee5'] or 0; st['f57'] += r['fee57'] or 0
        st['n5'] += r['net5'] if r['net5'] is not None else 0; st['n57'] += r['net57'] if r['net57'] is not None else 0
    L.append(f"| **Σ {e['org'][:30]}** | | | | **{fmt(st['a'])}** | **{fmt(st['p'])}** | **{fmt(st['s'])}** | **{fmt(st['v'],2)}** | **{fmt(st['f5'],2)}** | **{fmt(st['f57'],2)}** | **{'+' if st['n5']>=0 else ''}{fmt(st['n5'])}** | **{'+' if st['n57']>=0 else ''}{fmt(st['n57'])}** |")
    L.append("")
inv_only = {o: rs for o, rs in orgs_map.items() if all(not r['has_vr'] and not r['vcpu'] for r in rs)}
L.append("## Inventory-only orgs (no September savings, no CAST AI fee)")
L.append("")
for o, rs in sorted(inv_only.items()):
    L.append(f"- **{o}** — {len(rs)} cluster(s), all unmanaged/undriven in Sep: " + ", ".join(r['name'] for r in rs))
L.append("")
L += ["## Notes",
      "",
      "1. **Clubs with negative or thin net get flagged per row (see tables).** Headline positives: SMO Railigent X, SI GSW CLO, HAFAS H&O, SI B SW, CPS. Inspect: IT IPS (net −$596/−$1,811 — heavy eleX01 fee base vs thin September savings), DI SW PRS AMER SLC (−$803/−$832 — negative VR on Posit + fee), DI AUT PI APF (−$186/−$204), Pillar#1 (VR 0 across 6 rows — inside baseline window → fee-only −$25/−$29).",
      "2. `has_vr=no` rows were legitimately absent from the September VR window (not an API artifact — verified by re-pulling all 21 billed orgs with the required org header; 16 orgs returned data, 4 others are consistent zeros with ~0 billing: SiePortal, CASE, FT-RDP-SSP-DEVOPSFF-EKS-DEV, DI IT DEX CLD).",
      "3. Fees applied in USD per instruction; if contract quotes EUR, multiply by EUR→USD FX (≈1.15).",
      "4. One orphan billed cluster (0.022 vCPU, no inventory row — likely deleted mid-month) excluded from roster; negligible ($0.11).",
      "5. fmt: net cells equal gross savings for rows with no billing entity (fee = —).",
      "6. Provenance: `enterprise/result_slice{1..8}.tsv` (8 parallel org sweeps), `enterprise/vr_<org_id>.json` (21 verified pulls), `billing_phase2_sep26_enterprise.json` (parent-aggregated), `vr_sep26_berlin_all_clusters.json` (GSW CLO verified), CSV `vr_sep26_enterprise_net_savings.csv`.",
      ""]
open(f'{BASE}/ENTERPRISE-SEP26-NET-SAVINGS.md', 'w').write("\n".join(L))
print("written: ENTERPRISE-SEP26-NET-SAVINGS.md + vr_sep26_enterprise_net_savings.csv")
