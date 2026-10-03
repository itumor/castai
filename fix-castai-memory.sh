#!/usr/bin/env bash
# fix-castai-memory.sh — guarded remediation for a CAST AI pod with an oversized memory request.
# Usage: ./fix-castai-memory.sh <POD_NAME> [TARGET_MEMORY_Mi] [--yes]
#   POD_NAME         : the pod reported by diagnose script (e.g., castai-workload-autoscaler-xxx)
#   TARGET_MEMORY_Mi : desired request in MiB (default 512). Must be >= actual usage with headroom.
#   --yes            : skip interactive confirmation (DANGEROUS — prefer interactive)
# 
# The script:
#   1) Identifies the owner workload (Deployment/DaemonSet/StatefulSet)
#   2) Checks for existing WA annotation; if WA is the source, patches annotation + resources via kubectl
#   3) If no WA annotation but Helm values show a high request, it prints the Helm override command instead
#   4) Restarts the workload and verifies
#
# READ THE LOGIC BEFORE RUNNING. This script makes cluster changes.

set -euo pipefail

NS="${NS:-castai-agent}"
POD="${1:-}"
TARGET_MIB="${2:-512}"
AUTO_YES="${3:-}"

if [[ -z "$POD" ]]; then
  echo "Usage: $0 <POD_NAME> [TARGET_MEMORY_Mi] [--yes]"
  echo "Example: $0 castai-workload-autoscaler-7d5b8f 512"
  exit 1
fi

confirm() {
  [[ "$AUTO_YES" == "--yes" ]] && return 0
  read -r -p "$1 [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

echo "=== Inspecting pod $POD in namespace $NS ==="
if ! kubectl get pod -n "$NS" "$POD" >/dev/null 2>&1; then
  echo "Pod $POD not found in $NS"
  exit 1
fi

# Owner
OWNER_KIND=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.metadata.ownerReferences[0].kind}')
OWNER_NAME=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.metadata.ownerReferences[0].name}')
CONTAINER_NAME=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.spec.containers[0].name}')

if [[ -z "$OWNER_KIND" || -z "$OWNER_NAME" ]]; then
  echo "Could not determine owner of $POD (no ownerReference). Aborting."
  exit 1
fi

echo "Owner: $OWNER_KIND/$OWNER_NAME"
echo "Primary container: $CONTAINER_NAME"

# Current request
CURRENT_REQ=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.spec.containers[0].resources.requests.memory}')
echo "Current memory request: $CURRENT_REQ"

# Check WA annotation on the owner
WA_ANNOT=$(kubectl get "$OWNER_KIND" -n "$NS" "$OWNER_NAME" -o jsonpath='{.metadata.annotations.workloads\.cast\.ai/configuration}' 2>/dev/null || true)
if [[ -n "$WA_ANNOT" ]]; then
  echo "Found WA annotation on $OWNER_KIND/$OWNER_NAME:"
  echo "$WA_ANNOT" | head -c 500; echo
  WA_SOURCE=true
else
  echo "No WA annotation on $OWNER_KIND/$OWNER_NAME"
  WA_SOURCE=false
fi

# Check Helm values for this component (best-effort)
HELM_VALUES=""
if command -v helm >/dev/null 2>&1; then
  # Map common component names to Helm value paths
  COMPONENT_KEY=""
  case "$OWNER_NAME" in
    *cluster-controller*) COMPONENT_KEY="castai-cluster-controller" ;;
    *workload-autoscaler*) COMPONENT_KEY="castai-workload-autoscaler" ;;
    *kvisor*) COMPONENT_KEY="castai-kvisor" ;;
    *evictor*) COMPONENT_KEY="castai-evictor" ;;
    *spot-handler*) COMPONENT_KEY="castai-spot-handler" ;;
    *pod-mutator*) COMPONENT_KEY="castai-pod-mutator" ;;
    *pod-pinner*) COMPONENT_KEY="castai-pod-pinner" ;;
    *agent*) COMPONENT_KEY="castai-agent" ;;
    *pod-node-lifecycle*) COMPONENT_KEY="castai-pod-node-lifecycle" ;;
    *workload-autoscaler-exporter*) COMPONENT_KEY="castai-workload-autoscaler-exporter" ;;
    *live*) COMPONENT_KEY="castai-live" ;;
  esac
  if [[ -n "$COMPONENT_KEY" ]]; then
    HELM_VALUES=$(helm get values castai -n "$NS" -o yaml 2>/dev/null | grep -A10 "autoscaler:$" | grep -A10 "$COMPONENT_KEY:" | head -20 || true)
  fi
fi

if [[ -n "$HELM_VALUES" ]]; then
  echo "Helm values for $COMPONENT_KEY (may be setting resources):"
  echo "$HELM_VALUES"
  HELM_SOURCE=true
else
  HELM_SOURCE=false
fi

echo
echo "=== Planned action ==="
if [[ "$WA_SOURCE" == true ]]; then
  echo "Source: Workload Autoscaler annotation detected."
  echo "  1) Patch annotation to disable memory optimization (preserve other WA settings if any)."
  echo "  2) Set container memory request to ${TARGET_MIB}Mi via kubectl set resources."
  echo "  3) Rollout restart $OWNER_KIND/$OWNER_NAME."
elif [[ "$HELM_SOURCE" == true ]]; then
  echo "Source: Helm values appear to set a high request for $COMPONENT_KEY."
  echo "  The kubectl annotation+resources patch will be TEMPORARY (Helm will revert on next upgrade)."
  echo "  PERMANENT FIX: update your Helm values file:"
  echo "    autoscaler:"
  echo "      $COMPONENT_KEY:"
  echo "        resources:"
  echo "          requests:"
  echo "            memory: ${TARGET_MIB}Mi"
  echo "  Then run: helm upgrade castai castai-helm/castai -n $NS --reset-then-reuse-values -f <your-values.yaml>"
  echo
  echo "  This script can still apply a temporary patch now if you confirm."
else
  echo "Source: Unknown (no WA annotation, no Helm override detected)."
  echo "  Will apply temporary kubectl patch + restart. Consider adding Helm override for permanence."
fi

if ! confirm "Proceed with the above?"; then
  echo "Aborted."
  exit 0
fi

# ------- APPLY -------
echo
echo "=== Applying fix ==="

# 1) Patch WA annotation if present — preserve existing keys, only set vertical.memory.optimization: off
if [[ "$WA_SOURCE" == true ]]; then
  echo "Patching WA annotation to disable memory optimization..."
  # Build merged annotation: keep existing YAML, ensure vertical.memory.optimization: off
  # We use a small python one-liner for safe YAML merge (kubectl annotate --overwrite replaces whole value)
  MERGED=$(cat <<'PY' | python3 - "$WA_ANNOT"
import sys, yaml
cfg = yaml.safe_load(sys.argv[1]) or {}
cfg.setdefault('vertical', {})
cfg['vertical'].setdefault('memory', {})
cfg['vertical']['memory']['optimization'] = 'off'
print(yaml.dump(cfg, sort_keys=False).strip())
PY
)
  kubectl annotate "$OWNER_KIND" -n "$NS" "$OWNER_NAME" \
    workloads.cast.ai/configuration="$MERGED" --overwrite
  echo "Annotation updated."
fi

# 2) Set memory request on the container
echo "Setting memory request to ${TARGET_MIB}Mi on $OWNER_KIND/$OWNER_NAME (container: $CONTAINER_NAME)..."
kubectl set resources "$OWNER_KIND/$OWNER_NAME" -n "$NS" \
  -c "$CONTAINER_NAME" --requests=memory="${TARGET_MIB}Mi"

# 3) Rollout restart
echo "Restarting $OWNER_KIND/$OWNER_NAME..."
kubectl rollout restart "$OWNER_KIND/$OWNER_NAME" -n "$NS"
echo "Waiting for rollout to complete..."
kubectl rollout status "$OWNER_KIND/$OWNER_NAME" -n "$NS" --timeout=300s

# 4) Verify
echo
echo "=== Verification ==="
sleep 3
NEW_POD=$(kubectl get pods -n "$NS" -l "app.kubernetes.io/name=$OWNER_NAME" --no-headers 2>/dev/null | head -1 | awk '{print $1}')
if [[ -z "$NEW_POD" ]]; then
  # fallback: any pod owned by this workload
  NEW_POD=$(kubectl get pods -n "$NS" --no-headers 2>/dev/null | while read p r; do
    ok=$(kubectl get pod -n "$NS" "$p" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || true)
    [[ "$ok" == "$OWNER_NAME" ]] && echo "$p" && break
  done)
fi

if [[ -n "$NEW_POD" ]]; then
  echo "New pod: $NEW_POD"
  kubectl get pod -n "$NS" "$NEW_POD" -o custom-columns='POD:.metadata.name,MEM_REQ:.spec.containers[0].resources.requests.memory'
  kubectl top pod -n "$NS" "$NEW_POD" --containers 2>/dev/null || echo "metrics-server not available"
else
  echo "Could not locate new pod; check manually:"
  echo "  kubectl get pods -n $NS -o custom-columns='POD:.metadata.name,MEM_REQ:.spec.containers[0].resources.requests.memory'"
fi

# 5) Check FailedScheduling events again
echo
echo "=== Recent FailedScheduling events (should be clear) ==="
kubectl get events -A --field-selector reason=FailedScheduling --sort-by='.lastTimestamp' 2>/dev/null | tail -10

echo
echo "=== Done ==="
if [[ "$HELM_SOURCE" == true ]]; then
  echo "⚠️  REMINDER: This was a TEMPORARY patch. Helm will revert it on next upgrade."
  echo "   Permanently fix by updating your Helm values (see planned action above) and running helm upgrade."
fi