#!/usr/bin/env bash
# diagnose-castai-memory.sh — read-only detection of the CAST AI pod with a large memory request
# and whether Workload Autoscaler (WA) is the source. No mutations.
set -euo pipefail

NS="${NS:-castai-agent}"
THRESHOLD_MIB="${THRESHOLD_MIB:-1024}"   # flag pods requesting >= this many MiB

echo "=== 1) CAST AI pods: memory requests vs node ==="
kubectl get pods -n "$NS" \
  -o custom-columns='POD:.metadata.name,NODE:.spec.nodeName,MEM_REQ:.spec.containers[*].resources.requests.memory' \
  --no-headers 2>/dev/null | while read -r pod node mem; do
  # normalize to Mi for comparison
  mib=0
  if [[ "$mem" =~ ^([0-9]+)Mi$ ]]; then mib=${BASH_REMATCH[1]}
  elif [[ "$mem" =~ ^([0-9]+)Gi$ ]]; then mib=$(( ${BASH_REMATCH[1]} * 1024 ))
  elif [[ "$mem" =~ ^([0-9]+)$ ]]; then mib=$(( mem / 1024 / 1024 ))  # bytes -> Mi
  fi
  flag=""
  [[ $mib -ge $THRESHOLD_MIB ]] && flag="  <-- HIGH (>=${THRESHOLD_MIB}Mi)"
  printf '%-40s %-20s %8s Mi%s\n' "$pod" "$node" "$mib" "$flag"
done

echo
echo "=== 2) Actual usage (metrics-server must be running) ==="
kubectl top pods -n "$NS" --containers 2>/dev/null || echo "metrics-server not available; skipping usage"

echo
echo "=== 3) Scheduler failures (FailedScheduling) ==="
kubectl get events -A --field-selector reason=FailedScheduling --sort-by='.lastTimestamp' 2>/dev/null | tail -20

echo
echo "=== 4) Owner of high-request pods (Deployment / DaemonSet / StatefulSet) ==="
kubectl get pods -n "$NS" --no-headers 2>/dev/null | while read -r pod rest; do
  owner_kind=$(kubectl get pod -n "$NS" "$pod" -o jsonpath='{.metadata.ownerReferences[0].kind}' 2>/dev/null || true)
  owner_name=$(kubectl get pod -n "$NS" "$pod" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
  if [[ -n "$owner_kind" && -n "$owner_name" ]]; then
    echo "$pod  =>  $owner_kind/$owner_name"
  fi
done

echo
echo "=== 5) Workload Autoscaler annotation on CAST AI workloads ==="
kubectl get deploy,ds,sts -n "$NS" -o jsonpath='{range .items[*]}{.kind}{" "}{.metadata.name}{" => "}{.metadata.annotations.workloads\.cast\.ai/configuration}{"\n"}{end}' 2>/dev/null | grep -v '=> $' || echo "No WA annotations found"

echo
echo "=== 6) Helm values that may set component resources (if Helm-managed) ==="
helm get values castai -n "$NS" -o yaml 2>/dev/null | grep -A2 -E 'resources:|memory:' | head -40 || echo "Helm release 'castai' not found in $NS (or helm not available)"

echo
echo "=== 7) Node allocatable vs allocated on nodes running high-request pods ==="
kubectl get pods -n "$NS" --no-headers 2>/dev/null | while read -r pod node rest; do
  [[ -z "$node" || "$node" == "<none>" ]] && continue
  echo "--- Node: $node ---"
  kubectl describe node "$node" 2>/dev/null | sed -n '/Allocated resources:/,/^Events:/p' | head -30
  break  # just first affected node; remove break to see all
done

echo
echo "=== SUMMARY ==="
echo "If a pod shows >=${THRESHOLD_MIB}Mi request with low actual usage, note its POD name and OWNER (kind/name)."
echo "Check section 5: if that owner has a WA annotation with 'vertical.optimization: on' or 'nodeAllocatablePercentage', WA is the likely source."
echo "Check section 6: if Helm values set autoscaler.<component>.resources.requests.memory, that is the source."
echo "Run fix script only after confirming which source applies."