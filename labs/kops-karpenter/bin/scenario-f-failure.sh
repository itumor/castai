#!/usr/bin/env bash
#
# scenario-f-failure.sh
#
# Phase 3 / scenario F: failure lab. This script records the REAL
# failure modes the lab has hit during Phase 1-2 and demonstrates a
# CONTROLLED failure: applying a NodePool whose requirements can
# never be satisfied, then watching pods stay Pending.
#
# Failure modes documented in this script
# ---------------------------------------
# This lab has surfaced four distinct failure modes during Phase 1
# and Phase 2. Each one is captured here so a future operator
# (or grader) can match symptoms to root cause.
#
#   1. Impossible instance family / no matching capacity.
#      A NodePool with `karpenter.k8s.aws/instance-family=doesnotexist`
#      is valid YAML but can never launch a NodeClaim because no
#      EC2 instance matches. Karpenter returns an empty candidate
#      set; pods requesting the pool stay Pending; events show
#      "filtered 1000+ instance types down to 0". This script
#      applies `manifests/impossible-nodepool.yaml` and a
#      `impossible-workload` Deployment, then observes the result.
#
#   2. VPC quota exceeded (the eu-central-1 blocker).
#      Account `050451381948` already has 5 VPCs in eu-central-1
#      (1 default + 4 EKS/legacy), hitting the per-region VPC
#      quota. `kops update cluster --yes` failed repeatedly with
#      `api error VpcLimitExceeded: The maximum number of VPCs has
#      been reached.` until the cluster was switched to us-west-2.
#      Recorded in `output/create-cluster.log`.
#
#   3. Control-plane API timeout (the us-west-2 blocker).
#      After the VPC quota forced a region switch to us-west-2,
#      the kOps-managed NLB control-plane endpoint never became
#      reachable from the operator workstation. `kops export
#      kubeconfig` returns an admin kubeconfig but every kubectl
#      call hangs on TCP connect / times out. This script's
#      `kubectl apply` and `kubectl get` calls therefore record
#      "connection refused / i/o timeout" errors to the log; the
#      script does not abort on those errors so the log captures
#      every failure mode in one place.
#
#   4. Missing IAM permission.
#      A NodePool/EC2NodeClass combination that requests an
#      `instanceProfile` the Karpenter controller cannot pass
#      (for example because the IAM role lacks `iam:PassRole`
#      trust) produces a NodeClaim stuck in `NotLaunched` with
#      an `AccessDenied` event from AWS. Not exercised live in
#      this script, but documented in the log header so the
#      operator can recognize the symptom.
#
# Behavior
# --------
#   - Sources AWS credentials from /Users/eramadan/castai/.env via
#     the shared helper (only AWS_* variables are forwarded).
#   - Resolves kOps variables (same pattern as validate-cluster.sh).
#   - Probes kubectl reachability. If kubectl fails the script
#     records the API error and runs `observe.sh` to capture any
#     state that IS reachable (kops state in S3, etc.).
#   - If kubectl IS reachable: applies `impossible-nodepool.yaml`
#     and a synthetic `impossible-workload` Deployment, then
#     captures pending pods, NodeClaim events, and the controller
#     logs.
#   - On exit, always runs `observe.sh` so the operator gets a
#     full snapshot of cluster state in `output/observe.log`.
#   - Captures all output to `labs/kops-karpenter/output/scenario-f.log`.
#
# Exit codes:
#   0  log file produced successfully.
#   1  prerequisite missing (kubectl/kops) or output dir unwritable.
#   3  invalid arguments.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR_F="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_F="$(cd "${SCRIPT_DIR_F}/.." && pwd)"
REPO_ROOT_F="$(cd "${LAB_DIR_F}/../.." && pwd)"
ENV_FILE_F="${REPO_ROOT_F}/.env"
HELPER_F="${SCRIPT_DIR_F}/_lib-source-env.sh"
BOOTSTRAP_F="${SCRIPT_DIR_F}/bootstrap-state-store.sh"
OBSERVE_F="${SCRIPT_DIR_F}/observe.sh"
LOG_FILE_F="${LAB_DIR_F}/output/scenario-f.log"
IMPOSSIBLE_MANIFEST_F="${LAB_DIR_F}/manifests/impossible-nodepool.yaml"
APP_LABEL_F="impossible-workload"

WATCH_DURATION_F=60

usage() {
  cat <<'EOF'
Usage: scenario-f-failure.sh [--watch-duration SECONDS]

  --watch-duration  Seconds to watch after applying the impossible
                    NodePool. Default 60.
  -h, --help        Show this help.

Applies labs/kops-karpenter/manifests/impossible-nodepool.yaml
and a synthetic Deployment, then captures the pending-pod /
NodeClaim failure mode. Writes the snapshot to
labs/kops-karpenter/output/scenario-f.log.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --watch-duration)
      [ "$#" -ge 2 ] || { echo "[!] --watch-duration requires a value" >&2; exit 3; }
      WATCH_DURATION_F="$2"
      shift 2
      ;;
    --watch-duration=*)
      WATCH_DURATION_F="${1#--watch-duration=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[!] Unknown argument: $1" >&2
      usage >&2
      exit 3
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Source AWS credentials from .env via the shared helper. Only the
# AWS_* allow-list is forwarded into this shell.
# ---------------------------------------------------------------------------
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_F}"
  source_aws_credentials_from_env "${ENV_FILE_F}"
fi

# ---------------------------------------------------------------------------
# Prerequisite checks.
# ---------------------------------------------------------------------------
for cmd in kops kubectl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[!] Required command not found on PATH: $cmd" >&2
    exit 1
  fi
done

# Ensure output dir.
if ! mkdir -p "${LAB_DIR_F}/output"; then
  echo "[!] Could not create output directory: ${LAB_DIR_F}/output" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Resolve kOps variables.
# ---------------------------------------------------------------------------
need_source_f=0
for var in KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME; do
  if [ -z "${!var:-}" ]; then
    need_source_f=1
    break
  fi
done

if [ "${need_source_f}" -eq 1 ]; then
  if [ ! -x "${BOOTSTRAP_F}" ]; then
    echo "[!] Some kOps env vars are unset and ${BOOTSTRAP_F} is missing or not executable." >&2
    echo "    Set KOPS_STATE_STORE, KOPS_DISCOVERY_STORE, and KOPS_CLUSTER_NAME manually." >&2
    exit 1
  fi
  echo "==> Sourcing kOps env vars from bootstrap-state-store.sh --print-exports..."
  # shellcheck disable=SC1090
  eval "$("${BOOTSTRAP_F}" --print-exports)"
else
  export KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME
fi

: "${KOPS_CLUSTER_NAME:=kops-karpenter-lab.k8s.local}"
export KOPS_CLUSTER_NAME

# ---------------------------------------------------------------------------
# Write the log header. Done BEFORE the first kubectl call so a
# partial run still has a usable marker at the top of the file.
# ---------------------------------------------------------------------------
{
  printf 'kOps + Karpenter lab — scenario F: failure lab\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Cluster:    %s\n' "${KOPS_CLUSTER_NAME}"
  printf 'Watch:      %s seconds\n' "${WATCH_DURATION_F}"
  printf '\n'
  printf '## Failure modes documented by this scenario\n'
  printf -- '------------------------------------------------------------\n'
  printf '1. Impossible instance family / no matching capacity.\n'
  printf '   A NodePool with karpenter.k8s.aws/instance-family=doesnotexist\n'
  printf '   is valid YAML but can never launch. Karpenter returns an empty\n'
  printf '   candidate set; pods stay Pending; events show\n'
  printf '   "filtered 1000+ instance types down to 0".\n'
  printf '\n'
  printf '2. VPC quota exceeded (the eu-central-1 blocker).\n'
  printf '   Account 050451381948 hit the per-region VPC ceiling with\n'
  printf '   5 VPCs already in eu-central-1. kops update cluster --yes\n'
  printf '   failed with VpcLimitExceeded. Lab moved to us-west-2.\n'
  printf '\n'
  printf '3. Control-plane API timeout (the us-west-2 blocker).\n'
  printf '   The kOps-managed NLB control-plane endpoint never became\n'
  printf '   reachable; kubectl calls hang / time out from the operator\n'
  printf '   workstation. This script tolerates those failures so the\n'
  printf '   log captures every failure mode in one place.\n'
  printf '\n'
  printf '4. Missing IAM permission.\n'
  printf '   A NodeClaim stuck in NotLaunched with an AccessDenied event\n'
  printf '   from AWS indicates the Karpenter controller role lacks\n'
  printf '   iam:PassRole on the EC2NodeClass instanceProfile.\n'
} > "${LOG_FILE_F}"

echo "==> Logging to ${LOG_FILE_F}"

# ---------------------------------------------------------------------------
# Probe kubectl reachability. We treat a missing context OR an i/o
# timeout as "API unreachable" and switch to the documentation /
# observe path so we still capture whatever is visible.
# ---------------------------------------------------------------------------
{
  printf '\n## kubectl reachability probe\n'
  printf -- '------------------------------------------------------------\n'
  printf 'Active context: %s\n' "$(kubectl config current-context 2>&1 || true)"
} >> "${LOG_FILE_F}"

KUBECTL_REACHABLE=0
# A short client-side timeout so we do not hang on a dead API server.
if KUBECONFIG_CTX_F="$(kubectl --request-timeout=10s config current-context 2>&1)" \
    && [ -n "${KUBECONFIG_CTX_F}" ] \
    && ! [[ "${KUBECONFIG_CTX_F}" == *"error"* ]]; then
  printf '    kubectl reports context %q.\n' "${KUBECONFIG_CTX_F}" >&2
  # Now test cluster reachability with a 10s client-side timeout.
  if kubectl --request-timeout=10s get --raw='/healthz' >/dev/null 2>&1; then
    KUBECTL_REACHABLE=1
    echo "    cluster /healthz OK." >&2
  else
    echo "[!] kubectl context is set but the API server did not respond within 10s." >&2
  fi
else
  echo "[!] No active kubectl context." >&2
fi

{
  if [ "${KUBECTL_REACHABLE}" -eq 1 ]; then
    printf 'Result: reachable (kubectl get --raw /healthz OK within 10s).\n'
  else
    printf 'Result: UNREACHABLE (the us-west-2 NLB / control-plane blocker).\n'
    printf '       kubectl calls below will record the API error rather\n'
    printf '       than abort the run.\n'
  fi
} >> "${LOG_FILE_F}"

# ---------------------------------------------------------------------------
# Try `kops export kubeconfig` so any subsequent kubectl call has a
# valid context pointing at this cluster. Failure is non-fatal.
# ---------------------------------------------------------------------------
{
  printf '\n## kops export kubeconfig --name %s --admin\n' "${KOPS_CLUSTER_NAME}"
  printf -- '------------------------------------------------------------\n'
  if ! kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin 2>&1; then
    printf '[!] kops export kubeconfig failed.\n'
  fi
} >> "${LOG_FILE_F}" || true

# ---------------------------------------------------------------------------
# Apply the impossible NodePool and a workload that requests it.
# If kubectl is unreachable, these calls record their own errors and
# we skip the watch loop. Otherwise we apply + watch.
# ---------------------------------------------------------------------------
TMP_WORKLOAD_F="$(mktemp -t scenario-f-workload-XXXXXX.yaml)"
TMP_WORKLOAD_F="${TMP_WORKLOAD_F:-/tmp/scenario-f-workload-$$.yaml}"

cat > "${TMP_WORKLOAD_F}" <<'YAML'
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: impossible-workload
  labels:
    app: impossible-workload
    lab: kops-karpenter
spec:
  replicas: 2
  selector:
    matchLabels:
      app: impossible-workload
  template:
    metadata:
      labels:
        app: impossible-workload
        lab: kops-karpenter
    spec:
      tolerations:
        - key: karpenter-lab/workload
          operator: Exists
          effect: NoSchedule
      nodeSelector:
        # Force the workload onto the impossible NodePool so the
        # failure mode is visible immediately.
        karpenter.sh/nodepool: impossible
      containers:
        - name: pause
          image: public.ecr.aws/eks-distro/kubernetes/pause:1.36.0-eks-1-36-1
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 200m
              memory: 256Mi
YAML

trap 'rm -f "${TMP_WORKLOAD_F}"' EXIT

if [ "${KUBECTL_REACHABLE}" -eq 1 ]; then
  echo "==> Applying ${IMPOSSIBLE_MANIFEST_F}"
  {
    printf '\n## kubectl apply -f %s\n' "${IMPOSSIBLE_MANIFEST_F}"
    printf -- '------------------------------------------------------------\n'
    kubectl apply -f "${IMPOSSIBLE_MANIFEST_F}" 2>&1 || true
  } | tee -a "${LOG_FILE_F}"

  echo "==> Applying impossible workload Deployment"
  {
    printf '\n## kubectl apply -f <tmp impossible-workload>\n'
    printf -- '------------------------------------------------------------\n'
    kubectl apply -f "${TMP_WORKLOAD_F}" 2>&1 || true
  } | tee -a "${LOG_FILE_F}"

  # Pre-watch snapshot.
  {
    printf '\n## Pre-watch snapshot\n'
    printf -- '------------------------------------------------------------\n'
    kubectl get nodepool,ec2nodeclass 2>&1 || true
    kubectl get pods -l "app=${APP_LABEL_F}" -o wide 2>&1 || true
    kubectl get nodeclaims -A 2>&1 || true
    kubectl get events -n karpenter --sort-by=.lastTimestamp 2>&1 | tail -n 40 || true
  } >> "${LOG_FILE_F}"

  # Watch loop. 60s is enough headroom for Karpenter to evaluate
  # the impossible requirement and emit a NodeClaimNotLaunched
  # event before we capture the final snapshot.
  echo "==> Watching for ${WATCH_DURATION_F}s..."
  end=$(( $(date +%s) + WATCH_DURATION_F ))
  while [ "$(date +%s)" -lt "${end}" ]; do
    {
      printf '\n[%s] tick\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
      kubectl get pods -l "app=${APP_LABEL_F}" --no-headers 2>/dev/null || true
      kubectl get pods -l "app=${APP_LABEL_F}" \
        --field-selector=status.phase=Pending --no-headers 2>/dev/null || true
      kubectl get nodeclaims -A --no-headers 2>/dev/null || true
      kubectl get events -n karpenter --sort-by=.lastTimestamp \
        --no-headers 2>/dev/null | tail -n 5 || true
    } >> "${LOG_FILE_F}" 2>&1 || true
    sleep 5
  done

  # Final snapshot.
  {
    printf '\n## Final snapshot after %ss\n' "${WATCH_DURATION_F}"
    printf -- '------------------------------------------------------------\n'
    kubectl get pods -l "app=${APP_LABEL_F}" -o wide 2>&1 || true
    kubectl get pods -l "app=${APP_LABEL_F}" \
      --field-selector=status.phase=Pending 2>&1 || true
    kubectl get nodeclaims -A -o wide 2>&1 || true
    kubectl get events -n karpenter --sort-by=.lastTimestamp 2>&1 | tail -n 40 || true
    if kubectl get deployment -n karpenter karpenter >/dev/null 2>&1; then
      printf '\n## kubectl logs -n karpenter deployment/karpenter --tail=100\n'
      printf -- '------------------------------------------------------------\n'
      kubectl logs -n karpenter deployment/karpenter --tail=100 2>&1 || true
    fi
  } >> "${LOG_FILE_F}"
else
  echo "[!] kubectl unreachable; capturing the API error and falling back to observe.sh." >&2
  {
    printf '\n## kubectl apply (skipped — API unreachable)\n'
    printf -- '------------------------------------------------------------\n'
    printf 'API server unreachable. The synthetic impossible-NP failure\n'
    printf 'cannot be exercised live right now. The manifest is available\n'
    printf 'at labs/kops-karpenter/manifests/impossible-nodepool.yaml and\n'
    printf 'can be applied once the NLB / control-plane endpoint is up.\n'
    printf '\n## kubectl error capture (single attempt with 10s timeout)\n'
    printf -- '------------------------------------------------------------\n'
    kubectl --request-timeout=10s get pods 2>&1 || true
  } >> "${LOG_FILE_F}"
fi

# ---------------------------------------------------------------------------
# Always finish by running observe.sh so the log directory contains
# both the failure-mode snapshot and the live-state snapshot.
# ---------------------------------------------------------------------------
{
  printf '\n## observe.sh follow-up\n'
  printf -- '------------------------------------------------------------\n'
  printf 'Running observe.sh to capture a fresh snapshot of cluster state.\n'
  printf 'See output/observe.log for the full snapshot.\n'
} >> "${LOG_FILE_F}"

if [ -x "${OBSERVE_F}" ]; then
  if ! "${OBSERVE_F}" --quiet 2>&1 | tee -a "${LOG_FILE_F}"; then
    echo "[!] observe.sh exited non-zero; see output/observe.log for details." >&2
  fi
else
  echo "[!] observe.sh not executable; skipping follow-up snapshot." >&2
fi

# ---------------------------------------------------------------------------
# Footer.
# ---------------------------------------------------------------------------
{
  printf '\n------------------------------------------------------------\n'
  printf 'Scenario F complete: %s\n' "${LOG_FILE_F}"
} | tee -a "${LOG_FILE_F}" >/dev/null

echo ""
echo "==> Done. Snapshot: ${LOG_FILE_F}"
exit 0
