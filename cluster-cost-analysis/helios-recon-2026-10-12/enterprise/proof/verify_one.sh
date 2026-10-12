#!/usr/bin/env bash
# Live GET-only re-verification of one cluster's pasted-table cells against api.eu.cast.ai.
# READ-ONLY: only GET requests. Usage: verify_one.sh <clusterUuid> <orgId> <orgName> <clusterName>
set -uo pipefail
U="$1"; OID="$2"; ORG="$3"; NAME="$4"
BASE_URL="https://api.eu.cast.ai"
PROOF="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise/proof"
OUT="$PROOF/live/$U"
mkdir -p "$OUT"
cd /Users/eramadan/castai
set -a; [ -f awskey.env ] && . ./awskey.env; [ -f .env ] && . ./.env; set +a
if [ -z "${CASTAI_API_KEY:-}" ]; then echo "RESULT-ERROR $U no CASTAI_API_KEY"; exit 1; fi
H1="X-API-Key: $CASTAI_API_KEY"; H2="X-CastAI-Organization-Id: $OID"

# 1) baseline-params (GET)
curl -sS -o "$OUT/baseline-params.json" -w "HTTP bp %{http_code}\n" -H "$H1" -H "$H2" \
  "$BASE_URL/reporting/v1beta/organizations/$OID/clusters/$U/baseline-params"

# 2) external-cluster inventory (GET, paginated, find our cluster)
cursor=""; page=0; : > "$OUT/inv_pages.jsonl"; found=""
while : ; do
  page=$((page+1))
  if [ -z "$cursor" ]; then url="$BASE_URL/v1/kubernetes/external-clusters?pageLimit=100";
  else url="$BASE_URL/v1/kubernetes/external-clusters?pageLimit=100&pageCursor=$cursor"; fi
  resp=$(curl -sS -H "$H1" -H "$H2" "$url"); echo "$resp" >> "$OUT/inv_pages.jsonl"
  if echo "$resp" | jq -e --arg u "$U" '.items[]? | select(.id==$u)' >/dev/null 2>&1; then found=1; fi
  cursor=$(echo "$resp" | jq -r '.nextCursor // empty' 2>/dev/null)
  [ -n "$found" ] && break
  [ "$page" -ge 20 ] && break
  [ -z "$cursor" ] && break
done
[ -n "$found" ] && echo "HTTP inv found(page(s)<= $page)" || echo "HTTP inv NOT-FOUND"

# 3) rebalancing plans (GET, FULL pagination — live-verified param name is `cursor`)
cursor=""; prev="__none__"; page=0; : > "$OUT/rp_pages.jsonl"
while : ; do
  page=$((page+1))
  if [ -z "$cursor" ]; then
    url="$BASE_URL/v1/kubernetes/clusters/$U/rebalancing-plans?pageLimit=50"
  else
    url="$BASE_URL/v1/kubernetes/clusters/$U/rebalancing-plans?pageLimit=50&cursor=$cursor"
  fi
  resp=$(curl -sS -H "$H1" -H "$H2" "$url")
  if ! echo "$resp" | jq -e . >/dev/null 2>&1; then echo "HTTP rp page$page non-json: ${resp:0:120}"; break; fi
  echo "$resp" >> "$OUT/rp_pages.jsonl"
  prev="$cursor"
  cursor=$(echo "$resp" | jq -r '.nextCursor // empty' 2>/dev/null)
  if [ -n "$cursor" ] && [ "$cursor" = "$prev" ]; then echo "rp cursor stuck at page $page — stop"; break; fi
  [ "$page" -ge 400 ] && { echo "rp safety-stop page 400"; break; }
  [ -z "$cursor" ] && break
done
echo "HTTP rp pages=$page"

# 4) compare everything against the pasted row
python3 - "$U" "$ORG" "$NAME" "$OUT" "$PROOF/pasted_rows.tsv" <<'PY'
import csv, json, sys, os
u, org, name, out, ptsv = sys.argv[1:6]
row = None
with open(ptsv) as fh:
    for r in csv.DictReader(fh, delimiter='\t'):
        if r['CAST AI cluster ID'].strip() == u:
            row = r; break
if not row:
    print(f"RESLINE|{u}|{org}|{name}|ERROR pasted row not found"); sys.exit(0)

def eq(a, b, tol=None):
    if tol is not None:
        try: return abs(float(str(a).replace(',', '')) - float(b)) <= tol
        except Exception: return False
    return str(a).strip() == str(b).strip()

parts = []
# --- baseline params ---
try:
    bp = json.load(open(f'{out}/baseline-params.json'))
    checks = {
      'Baseline type': eq(row['Baseline type'], bp.get('baselineType', '')),
      'Baseline start': eq(row['Baseline start'], (bp.get('baselinePeriodStartTime') or '')[:10]),
      'Baseline end': eq(row['Baseline end'], (bp.get('baselinePeriodEndTime') or '')[:10]),
      'Recomputed': eq(row['Recomputed'], (bp.get('updateTime') or '')[:10]),
      'CPU factor': eq(row['CPU factor'], float(bp.get('cpuOverprovisioningFactor')), 5e-5),
      'RAM factor': eq(row['RAM factor'], float(bp.get('memoryOverprovisioningFactor')), 5e-5),
    }
    bad = [k for k, ok in checks.items() if not ok]
    parts.append(('BP', 'OK' if not bad else 'DIFF:' + ','.join(bad),
                  f"start={(bp.get('baselinePeriodStartTime') or '')[:10]} end={(bp.get('baselinePeriodEndTime') or '')[:10]} "
                  f"cpu={float(bp.get('cpuOverprovisioningFactor', 0)):.4f} ram={float(bp.get('memoryOverprovisioningFactor', 0)):.4f} "
                  f"priceCpu={bp.get('costPerCpuCoreHourly')} priceRam={bp.get('costPerMemoryGibHourly')}"))
except Exception as e:
    parts.append(('BP', 'ERROR', str(e)[:120]))

# --- inventory ---
item = None
try:
    for line in open(f'{out}/inv_pages.jsonl'):
        j = json.loads(line)
        for it in j.get('items', []):
            if it.get('id') == u:
                item = it; break
        if item: break
    if item is None:
        parts.append(('INV', 'ERROR', 'cluster not found in org inventory'))
    else:
        reg = (item.get('region') or {}).get('name') or ''
        acct = (item.get('eks') or {}).get('accountId', '')
        checks = {
          'Created': eq(row['Created'], (item.get('createdAt') or '')[:10]),
          'First CAST op': eq(row['First CAST op'], (item.get('firstOperationAt') or '')[:19].replace('T', ' ')),
          'Status': eq(row['Status'], item.get('status', '')),
          'Region': eq(row['Region'], reg),
          'isPhase2': eq(row['isPhase2'], str(item.get('isPhase2'))),
          'account': ('#' + acct + '#') in row['Cluster ID (name#account#region)'],
        }
        bad = [k for k, ok in checks.items() if not ok]
        parts.append(('INV', 'OK' if not bad else 'DIFF:' + ','.join(bad),
                      f"created={(item.get('createdAt') or '')[:10]} firstOp={(item.get('firstOperationAt') or '')[:19]} "
                      f"status={item.get('status')} region={reg} phase2={item.get('isPhase2')} acct={acct}"))
except Exception as e:
    parts.append(('INV', 'ERROR', str(e)[:120]))

# --- rebalancing plans (full pages, deduped by plan id) ---
try:
    seen, dates, states = set(), [], {}
    for line in open(f'{out}/rp_pages.jsonl'):
        j = json.loads(line)
        for it in j.get('items', []):
            pid = it.get('rebalancingPlanId') or it.get('id')
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            if it.get('createdAt'):
                dates.append(it['createdAt'])
                st = it.get('state', '?'); states[st] = states.get(st, 0) + 1
    n_true = len(dates)
    first_true = min(dates)[:10] if dates else ''
    p_plans, p_first = int(row['Plans']), row['First rebalance']
    st = 'OK' if (n_true == p_plans and first_true == p_first) else \
         ('CORRECTION' if (n_true > p_plans or (first_true and first_true < p_first)) else 'DIFF')
    parts.append(('RP', st, f"plans true={n_true} vs paste={p_plans} | first true={first_true} vs paste={p_first} | states={states}"))
except Exception as e:
    parts.append(('RP', 'ERROR', str(e)[:120]))

overall = 'VERIFIED' if all(p[1] == 'OK' for p in parts) else \
          ('VERIFIED-WITH-RP-CORRECTION' if all(p[1] in ('OK', 'CORRECTION') for p in parts) else 'MISMATCH')
print(f"RESLINE|{u}|{org}|{name}|{overall}|" + ' | '.join(f"{p[0]}={p[1]} ({p[2]})" for p in parts))
PY
