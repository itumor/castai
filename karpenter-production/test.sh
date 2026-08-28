#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# test.sh - End-to-end validation for Karpenter production manifests.
#
# Tests (in order):
#   1. General workload scale-up: scale api to 10, verify Spot nodes.
#   2. Critical workload scale-up: deploy api-critical, verify On-Demand.
#   3. HPA scale-out under synthetic load; verify zone spread.
#   4. Consolidation: scale down, verify empty nodes are removed.
#   5. Print RESULT: PASS / FAIL summary and exit 0 / 1.
# ----------------------------------------------------------------------------

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"
AWSKEY_FILE="${REPO_ROOT}/awskey.env"

CLUSTER_NAME="${CLUSTER_NAME:-karpenter-lab}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
KARPENTER_NAMESPACE="${KARPENTER_NAMESPACE:-karpenter}"

# Test budget controls - keep small for AWS cost.
GENERAL_REPLICAS="${GENERAL_REPLICAS:-10}"
CRITICAL_REPLICAS="${CRITICAL_REPLICAS:-2}"
HPA_LOAD_REPLICAS="${HPA_LOAD_REPLICAS:-10}"
TEST_TIMEOUT="${TEST_TIMEOUT:-600s}"

# ----------------------------------------------------------------------------
# AWS credentials (if needed).
# ----------------------------------------------------------------------------
if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  if [[ -f "${AWSKEY_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${AWSKEY_FILE}"
  fi
fi
export AWS_REGION
export AWS_DEFAULT_REGION="${AWS_REGION}"

# ----------------------------------------------------------------------------
# kubeconfig.
# ----------------------------------------------------------------------------
if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "[test] Updating kubeconfig for ${CLUSTER_NAME}..."
  aws eks update-kubeconfig --region "${AWS_REGION}" --name "${CLUSTER_NAME}" >/dev/null
fi

# Track failures with an array. Final result computed at end.
FAILURES=()
CURRENT_STEP="init"

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; FAILURES+=("$*"); }
info() { echo "[INFO] $*"; }

# ----------------------------------------------------------------------------
# Step 1: General workload scale-up (Spot-first).
# ----------------------------------------------------------------------------
step_general_scaleup() {
  CURRENT_STEP="step-1-general-scaleup"
  echo "================================================================"
  echo "  ${CURRENT_STEP}"
  echo "================================================================"

  info "Scaling api deployment to ${GENERAL_REPLICAS} replicas..."
  kubectl scale deployment/api --replicas="${GENERAL_REPLICAS}"

  if ! kubectl wait --for=condition=Available deployment/api \
        --timeout="${TEST_TIMEOUT}"; then
    fail "api deployment did not become Available"
    return 1
  fi
  pass "api deployment Available with ${GENERAL_REPLICAS} replicas"

  if ! kubectl wait --for=jsonpath='{.status.readyReplicas}'="${GENERAL_REPLICAS}" \
        deployment/api --timeout="${TEST_TIMEOUT}"; then
    fail "api deployment did not reach ${GENERAL_REPLICAS} ready replicas"
    return 1
  fi
  pass "api readyReplicas == ${GENERAL_REPLICAS}"

  info "Waiting up to 7 minutes for Karpenter to launch general nodes..."
  local end_ts=$(( $(date +%s) + 420 ))
  spot_count=0
  while [[ "$(date +%s)" -lt "${end_ts}" ]]; do
    spot_count="$(kubectl get nodes -l karpenter.sh/capacity-type=spot,karpenter.sh/nodepool=general --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "${spot_count}" -ge 1 ]]; then
      break
    fi
    sleep 10
  done

  if [[ "${spot_count}" -ge 1 ]]; then
    pass "Found ${spot_count} Spot node(s) labeled karpenter.sh/nodepool=general"
  else
    info "No Spot nodes yet for general; checking for On-Demand fallback..."
  fi

  # Spot OR on-demand fallback acceptable, but verify at least one Karpenter node exists.
  local karpenter_count
  karpenter_count="$(kubectl get nodes -l karpenter.sh/nodepool=general \
    --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${karpenter_count}" -ge 1 ]]; then
    pass "Found ${karpenter_count} Karpenter-provisioned node(s) for general (Spot=${spot_count})"
  else
    fail "No Karpenter-provisioned nodes found for general NodePool"
    info "All nodes:"
    kubectl get nodes -o wide || true
    return 1
  fi
}

# ----------------------------------------------------------------------------
# Step 2: Critical workload scale-up (On-Demand only).
# ----------------------------------------------------------------------------
step_critical_scaleup() {
  CURRENT_STEP="step-2-critical-scaleup"
  echo "================================================================"
  echo "  ${CURRENT_STEP}"
  echo "================================================================"

  info "Scaling api-critical deployment to ${CRITICAL_REPLICAS} replicas..."
  kubectl scale deployment/api-critical --replicas="${CRITICAL_REPLICAS}" || true

  if ! kubectl wait --for=condition=Available deployment/api-critical \
        --timeout="${TEST_TIMEOUT}"; then
    fail "api-critical deployment did not become Available"
    return 1
  fi
  pass "api-critical deployment Available with ${CRITICAL_REPLICAS} replicas"

  info "Waiting up to 7 minutes for Karpenter to launch critical on-demand nodes..."
  local end_ts=$(( $(date +%s) + 420 ))
  od_count=0
  while [[ "$(date +%s)" -lt "${end_ts}" ]]; do
    od_count="$(kubectl get nodes -l karpenter.sh/capacity-type=on-demand,karpenter.sh/nodepool=critical-on-demand --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "${od_count}" -ge 1 ]]; then
      break
    fi
    sleep 10
  done

  if [[ "${od_count}" -ge 1 ]]; then
    pass "Found ${od_count} On-Demand node(s) for critical-on-demand"
  else
    fail "No On-Demand node found for critical-on-demand NodePool"
    info "Node list with labels:"
    kubectl get nodes -L karpenter.sh/capacity-type,karpenter.sh/nodepool || true
    return 1
  fi

  # Verify the workload-type=critical:NoSchedule taint is present.
  local tainted
  tainted="$(kubectl get nodes -l karpenter.sh/nodepool=critical-on-demand \
    -o jsonpath='{range .items[*]}{.spec.taints[*].key}{"\n"}{end}' 2>/dev/null \
    | grep -c 'workload-type' || true)"
  if [[ "${tainted}" -ge 1 ]]; then
    pass "critical-on-demand nodes carry workload-type=critical NoSchedule taint"
  else
    fail "Expected workload-type taint not found on critical-on-demand nodes"
  fi
}

# ----------------------------------------------------------------------------
# Step 3: HPA + zone spread.
# ----------------------------------------------------------------------------
step_hpa_zones() {
  CURRENT_STEP="step-3-hpa-zones"
  echo "================================================================"
  echo "  ${CURRENT_STEP}"
  echo "================================================================"

  # Confirm HPA exists.
  if kubectl get hpa/api >/dev/null 2>&1; then
    pass "HPA api exists"
  else
    fail "HPA api not found"
    return 1
  fi

  # Drive CPU load so HPA scales from the baseline.
  info "Scaling api down to HPA minimum (2) before load test..."
  kubectl scale deployment/api --replicas=2
  kubectl wait --for=jsonpath='{.status.readyReplicas}'=2 deployment/api --timeout=120s

  # Add a temporary stress sidecar to drive CPU above the 50% HPA target.
  info "Adding temporary CPU stress sidecar to api deployment..."
  kubectl patch deployment api --type=json -p='[{"op":"add","path":"/spec/template/spec/containers/-","value":{"name":"stress","image":"busybox:1.36","command":["sh","-c","while :; do :; done"],"resources":{"requests":{"cpu":"50m"}}}}]' >/dev/null
  kubectl rollout status deployment/api --timeout=180s

  info "Waiting for HPA to scale api to >= ${GENERAL_REPLICAS} replicas under load..."
  local end_ts=$(( $(date +%s) + 180 ))
  local hpa_current=0
  while [[ "$(date +%s)" -lt "${end_ts}" ]]; do
    hpa_current="$(kubectl get hpa/api -o jsonpath='{.status.currentReplicas}' 2>/dev/null || echo 0)"
    if [[ "${hpa_current}" -ge "${GENERAL_REPLICAS}" ]]; then
      break
    fi
    sleep 10
  done

  # Inspect topology spread using a Python helper to avoid per-node kubectl calls.
  info "Checking zone spread for api pods..."
  local zones_present
  zones_present="$(python3 - <<'PY'
import subprocess, json, sys
try:
    pods = json.loads(subprocess.check_output(['kubectl','get','pods','-l','app=api','-o','json'], timeout=30))
    nodes = set(p['spec']['nodeName'] for p in pods['items'])
    node_json = json.loads(subprocess.check_output(['kubectl','get','nodes','-o','json'], timeout=30))
    zones = set(n['metadata']['labels'].get('topology.kubernetes.io/zone','') for n in node_json['items'] if n['metadata']['name'] in nodes)
    zones.discard('')
    print(len(zones))
except Exception:
    print(0)
PY
)"

  if [[ "${zones_present}" -ge 2 ]]; then
    pass "api pods scheduled across ${zones_present} availability zone(s)"
  else
    fail "api pods not spread across multiple zones (found ${zones_present})"
  fi

  info "HPA current replicas after load: ${hpa_current}"
  if [[ "${hpa_current}" -ge "${GENERAL_REPLICAS}" ]]; then
    pass "HPA scaled to >= ${GENERAL_REPLICAS} replicas under load"
  else
    fail "HPA did not scale to >= ${GENERAL_REPLICAS} replicas under load (found ${hpa_current})"
  fi

  # Remove the temporary stress sidecar to restore normal workload shape.
  info "Removing temporary CPU stress sidecar from api deployment..."
  kubectl patch deployment api --type=json -p='[{"op":"remove","path":"/spec/template/spec/containers/-"}]' >/dev/null || true
  kubectl rollout status deployment/api --timeout=180s || true
}

# ----------------------------------------------------------------------------
# Step 4: Scale-down / consolidation.
# ----------------------------------------------------------------------------
step_consolidation() {
  CURRENT_STEP="step-4-consolidation"
  echo "================================================================"
  echo "  ${CURRENT_STEP}"
  echo "================================================================"

  local before_nodes
  before_nodes="$(kubectl get nodes -l karpenter.sh/nodepool=general \
    --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  info "general NodePool nodes before scale-down: ${before_nodes}"

  # Capture NodeClaim count BEFORE scale-down so the comparison is meaningful.
  local nc_before
  nc_before="$(kubectl get nodeclaims -l karpenter.sh/nodepool=general \
    --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  info "NodeClaim count before scale-down: ${nc_before}"

  info "Scaling api down to 1 replica..."
  kubectl scale deployment/api --replicas=1

  if ! kubectl wait --for=jsonpath='{.status.readyReplicas}'=1 \
        deployment/api --timeout="${TEST_TIMEOUT}"; then
    fail "api did not scale down to 1"
    return 1
  fi
  pass "api scaled down to 1 ready replica"

  info "Scaling api-critical down to 0 replicas..."
  kubectl scale deployment/api-critical --replicas=0 || true

  info "Waiting up to 5 minutes for Karpenter consolidation..."
  local end_ts=$(( $(date +%s) + 300 ))
  local after_nodes="${before_nodes}"
  while [[ "$(date +%s)" -lt "${end_ts}" ]]; do
    after_nodes="$(kubectl get nodes -l karpenter.sh/nodepool=general \
      --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "${after_nodes}" -lt "${before_nodes}" ]]; then
      break
    fi
    sleep 20
  done

  info "general NodePool nodes after consolidation: ${after_nodes}"
  if [[ "${after_nodes}" -lt "${before_nodes}" ]]; then
    pass "Karpenter removed at least one empty node (${before_nodes} -> ${after_nodes})"
  else
    fail "Node count did not decrease after consolidation (still ${after_nodes})"
  fi

  # Also check NodeClaim count decreased vs pre-scale-down baseline.
  local nc_after
  nc_after="$(kubectl get nodeclaims -l karpenter.sh/nodepool=general \
    --no-headers 2>/dev/null | wc -l | tr -d ' ')"
  info "NodeClaim count after consolidation: ${nc_after}"
  if [[ "${nc_after}" -lt "${nc_before}" || "${nc_after}" -eq 0 ]]; then
    pass "NodeClaim count reduced or zero (${nc_before} -> ${nc_after})"
  else
    fail "NodeClaim count not reduced (${nc_before} -> ${nc_after})"
  fi
}

# ----------------------------------------------------------------------------
# Cleanup.
# ----------------------------------------------------------------------------
cleanup_workloads() {
  info "Cleaning up test workloads (deployments, hpa, service, pdb)..."
  kubectl delete deployment -n default api api-critical --ignore-not-found=true
  kubectl delete hpa -n default api --ignore-not-found=true
  kubectl delete service -n default api --ignore-not-found=true
  kubectl delete pdb -n default api --ignore-not-found=true
}

# ----------------------------------------------------------------------------
# Main.
# ----------------------------------------------------------------------------
main() {
  echo "[test] Cluster: ${CLUSTER_NAME}"
  echo "[test] Region:  ${AWS_REGION}"

  # Ensure cleanup runs even on early exit / error.
  trap cleanup_workloads EXIT

  # Run each step; do not abort on first failure - accumulate results.
  step_general_scaleup      || true
  step_critical_scaleup     || true
  step_hpa_zones            || true
  step_consolidation        || true

  echo "================================================================"
  echo "  SUMMARY"
  echo "================================================================"
  if [[ "${#FAILURES[@]}" -eq 0 ]]; then
    echo "RESULT: PASS"
    echo "All end-to-end checks completed successfully."
    cleanup_workloads
    exit 0
  else
    echo "RESULT: FAIL"
    echo "Failed checks:"
    for f in "${FAILURES[@]}"; do echo "  - ${f}"; done
    cleanup_workloads
    exit 1
  fi
}

main "$@"
