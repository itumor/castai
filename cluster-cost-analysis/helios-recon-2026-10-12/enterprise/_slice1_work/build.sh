#!/bin/bash
set -u
BASE=/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12
W="$BASE/enterprise/_slice1_work"
RAW_INV="$W/raw_inv.tsv"; RAW_VR="$W/raw_vr.tsv"
: > "$RAW_INV"; : > "$RAW_VR"

head -17 "$BASE/orgs_130.tsv" | while IFS=$'\t' read -r OID ONAME; do
  [ -s "$W/inv_$OID.json" ] && jq -r --arg on "$ONAME" --arg oid "$OID" '
    (.items // [])[] |
    [ $on, $oid, (.name // "-"), (.id // "-"),
      (.eks.accountId // .aks.accountId // .gke.projectId // "-"),
      (.region.name // "-") ] | @tsv' "$W/inv_$OID.json" >> "$RAW_INV"
  [ -s "$W/vr_$OID.json" ] && jq -r --arg on "$ONAME" --arg oid "$OID" '
    (.items // [])[] |
    [ $on, $oid, (.clusterName // "-"), (.clusterId // "-"),
      ((.cost.actualCost    // "null") | tostring),
      ((.cost.projectedCost // "null") | tostring),
      ((.cost.totalSavings  // "null") | tostring) ] | @tsv' "$W/vr_$OID.json" >> "$RAW_VR"
done

awk -F'\t' '
  function fnum(v) { return (v == "null" || v == "") ? "-" : sprintf("%.2f", v + 0) }
  function fkey(v) { return (v == "null" || v == "") ? -1e18 : v + 0 }
  NR==FNR {
    k = $1 SUBSEP $4
    acct[k] = $5; reg[k] = $6
    i_on[++ni] = $1; i_oid[ni] = $2; i_cn[ni] = $3; i_uu[ni] = $4
    i_acct[ni] = $5; i_reg[ni] = $6
    next
  }
  {
    k = $1 SUBSEP $4
    a = (k in acct) ? acct[k] : "-"
    r = (k in reg)  ? reg[k]  : "-"
    printf "%s\t%.17g\t%s\t%s\t%s\t%s\t%s\t%s\tyes\t%s\t%s\t%s\n", \
      $1, fkey($7), $1, $2, $3, $4, a, r, fnum($5), fnum($6), fnum($7) > "/dev/stdout"
    seen_vr[k] = 1
  }
  END {
    for (i = 1; i <= ni; i++) {
      k = i_on[i] SUBSEP i_uu[i]
      if (!(k in seen_vr))
        printf "%s\t%.17g\t%s\t%s\t%s\t%s\t%s\t%s\tno\t-\t-\t-\n", \
          i_on[i], -1e18, i_on[i], i_oid[i], i_cn[i], i_uu[i], i_acct[i], i_reg[i] > "/dev/stdout"
    }
  }' "$RAW_INV" "$RAW_VR" \
  | sort -t $'\t' -k1,1 -k2,2gr \
  | cut -f3- > "$BASE/enterprise/result_slice1.tsv"

echo "rows: $(wc -l < "$BASE/enterprise/result_slice1.tsv")"
# place final inv/vr artifacts at the contract location (staging kept as backup)
for f in "$W"/inv_*.json "$W"/vr_*.json; do
  [ -e "$f" ] || continue
  cp "$f" "$BASE/enterprise/$(basename "$f")"
done
echo "placed: $(ls "$BASE"/enterprise/inv_*.json 2>/dev/null | wc -l) inv files (shared dir total)"
