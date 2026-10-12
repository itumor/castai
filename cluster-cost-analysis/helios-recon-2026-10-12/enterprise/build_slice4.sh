#!/usr/bin/env bash
# Build result_slice4.tsv from saved inv_*.json / vr_*.json files. Read-only.
set -u
DIR="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/enterprise"
TSV_ORGS="/Users/eramadan/castai/cluster-cost-analysis/helios-recon-2026-10-12/orgs_130.tsv"
OUT="$DIR/result_slice4.tsv"
RAW="$(mktemp)"

: > "$RAW"

# org lookup map (slice 52-68)
slice_names() {
  sed -n '52,68p' "$TSV_ORGS"
}

# Iterate ONLY over this slice's org ids (dir is shared with concurrent sibling slices)
while IFS=$'\t' read -r oid oname; do
  inv="$DIR/inv_${oid}.json"
  [ -f "$inv" ] || continue
  vr="$DIR/vr_${oid}.json"
  jq -rn --arg oname "$oname" --arg oid "$oid" \
    --slurpfile inv "$inv" \
    --slurpfile vr <( [ -f "$vr" ] && cat "$vr" || echo '{"items":[]}' ) '
    ($vr[0].items // []) as $vrs
    | (reduce $vrs[] as $v ({}; .[$v.clusterId] = $v.cost)) as $costs
    | $inv[0].items[] as $c
    | ($costs[$c.id]) as $k
    | [
        $oname, $oid, ($c.name // "-"), ($c.id // "-"),
        ($c.eks.accountId // $c.aks.accountId // $c.gke.projectId // "-"),
        ($c.region.name // "-"),
        (if $k then "yes" else "no" end),
        (if $k then ($k.actualCost*100|round/100|tostring) else "-" end),
        (if $k then ($k.projectedCost*100|round/100|tostring) else "-" end),
        (if $k then ($k.totalSavings*100|round/100|tostring) else "-" end)
      ] | @tsv' >> "$RAW"
done < <(slice_names)

# sort: org name asc, then savings desc (numeric, "-" treated as -inf is fine since plain text)
{
  printf 'ORG_NAME\tORG_ID\tCLUSTER_NAME\tCLUSTER_UUID\tACCOUNT\tREGION\tHAS_VR\tACTUAL\tPROJECTED\tSAVINGS\n'
  LC_ALL=C sort -t $'\t' -k1,1 -k10,10rn "$RAW"
} > "$OUT"
rm -f "$RAW"
wc -l "$OUT"
