#!/bin/bash
# Build result_slice3.tsv: join inventory (items[]) with VR report (items[]) on clusterId == id
set -u
ENTERPRISE="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise"
ORGS="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/orgs_130.tsv"
OUT="$ENTERPRISE/result_slice3.tsv"
ROWS="$ENTERPRISE/.rows_slice3.tsv"
cd "$ENTERPRISE" || exit 1
: > "$ROWS"

ROUND='def r2: (tonumber * 100 | round) / 100;'

sed -n '35,51p' "$ORGS" | while IFS=$'\t' read -r ORG_ID ORG_NAME; do
  INV="inv_$ORG_ID.json"; VR="vr_$ORG_ID.json"
  VR_ITEMS='[]'
  if [ -f "$VR" ]; then
    VR_ITEMS=$(jq -c '.items // []' "$VR" 2>/dev/null || echo '[]')
  fi

  if [ -f "$INV" ]; then
    # inventory-driven rows (VR costs attached when a VR item matches cluster id)
    jq -r --arg on "$ORG_NAME" --arg oi "$ORG_ID" --argjson vr "$VR_ITEMS" \
      "$ROUND"'
      .items[] | . as $c |
      ([ $vr[] | select(.clusterId == $c.id) ][0] // null) as $r |
      [ $on, $oi, ($c.name // "-"), ($c.id // "-"),
        ($c.eks.accountId // $c.aks.accountId // $c.gke.projectId // "-"),
        ($c.region.name // "-"),
        (if $r then "yes" else "no" end),
        (if $r then ($r.cost.actualCost    | r2 | tostring) else "-" end),
        (if $r then ($r.cost.projectedCost | r2 | tostring) else "-" end),
        (if $r then ($r.cost.totalSavings  | r2 | tostring) else "-" end)
      ] | @tsv' "$INV" >> "$ROWS"

    # VR rows whose clusterId is NOT in this org's inventory
    if [ "$VR_ITEMS" != '[]' ]; then
      INVIDS=$(jq -r '.items[].id' "$INV" | sort -u | tr '\n' ' ' | sed 's/ $//')
      jq -r --arg on "$ORG_NAME" --arg oi "$ORG_ID" --arg inv "$INVIDS" \
        "$ROUND"'
        ($inv | split(" ")) as $ids |
        .items[] | select(($ids | index(.clusterId)) == null) |
        [ $on, $oi, (.clusterName // "-"), (.clusterId // "-"), "-", "-", "yes",
          (.cost.actualCost    | r2 | tostring),
          (.cost.projectedCost | r2 | tostring),
          (.cost.totalSavings  | r2 | tostring)
        ] | @tsv' "$VR" >> "$ROWS"
    fi
  else
    # No inventory: every VR row (if any) is an unmatched VR row
    if [ "$VR_ITEMS" != '[]' ]; then
      jq -r --arg on "$ORG_NAME" --arg oi "$ORG_ID" \
        "$ROUND"'
        .items[] |
        [ $on, $oi, (.clusterName // "-"), (.clusterId // "-"), "-", "-", "yes",
          (.cost.actualCost    | r2 | tostring),
          (.cost.projectedCost | r2 | tostring),
          (.cost.totalSavings  | r2 | tostring)
        ] | @tsv' "$VR" >> "$ROWS"
    fi
  fi
done

{
  printf 'ORG_NAME\tORG_ID\tCLUSTER_NAME\tCLUSTER_UUID\tACCOUNT\tREGION\tHAS_VR\tACTUAL\tPROJECTED\tSAVINGS\n'
  if [ -s "$ROWS" ]; then
    # ORG_NAME asc, then SAVINGS desc numeric with numbers first ("-" goes last)
    awk -F'\t' '{
      key = $10; if (key == "-" || key == "") num = -1e18; else num = -(key + 0);
      printf "%s\t%030.17g\t%s\n", $1, num, $0
    }' "$ROWS" | LC_ALL=C sort -k1,1 -k2,2n | cut -f3-
  fi
} > "$OUT"

rm -f "$ROWS"
echo "rows=$(( $(wc -l < "$OUT") - 1 )) written to $OUT"
