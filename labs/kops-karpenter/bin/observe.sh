#!/usr/bin/env bash
#
# observe.sh
#
# Phase 3 step 2: observability helper for the kOps + Karpenter lab.
#
# Captures a snapshot of the cluster's current state — kOps state,
# Kubernetes nodes, Karpenter pods/CRDs/NodePools/NodeClaims, recent
# Karpenter events, and the controller's tail logs — and writes it to
# `labs/kops-karpenter/output/observe.log`.
#
# This script is deliberately tolerant of failure. Every section runs
# inside a `|| true` shell so a broken API endpoint still produces a
# log file with the partial output. Sections that error append a
# `[!] section failed: ...` marker to the log so the reader can see
# which call could not be completed.
#
# Behavior:
#   - Sources AWS credentials from /Users/eramadan/castai/.env via
#     the shared `_lib-source-env.sh` helper. Only AWS_* variables
#     are forwarded; CAST AI tokens and other non-AWS secrets stay
#     out of the environment.
#   - Sets the kubectl context to the kOps cluster (no-op when a
#     context is already selected).
#   - Writes the snapshot to labs/kops-karpenter/output/observe.log.
#
# Flags:
#   --quiet           Suppress live stdout; only the log file is
#                     produced.
#   --output-dir DIR  Override the output directory. Defaults to
#                     labs/kops-karpenter/output.
#   -h, --help        Show usage.
#
# Exit codes:
#   0  log file was produced (sections may still have failed; check
#      the file for `[!] section failed` markers).
#   1  prerequisite missing (kops / kubectl) or output dir unwritable.
#   3  invalid arguments.
#
# Verification (run from the repo root): see the lab's task spec
# for the exact one-liner; this script must pass `bash -n` and a
# lint pass with no error-level output.

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths.
# ---------------------------------------------------------------------------
SCRIPT_DIR_O="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_O="$(cd "${SCRIPT_DIR_O}/.." && pwd)"
REPO_ROOT_O="$(cd "${LAB_DIR_O}/../.." && pwd)"
ENV_FILE_O="${REPO_ROOT_O}/.env"
HELPER_O="${SCRIPT_DIR_O}/_lib-source-env.sh"
BOOTSTRAP_O="${SCRIPT_DIR_O}/bootstrap-state-store.sh"
DEFAULT_OUTPUT_DIR_O="${LAB_DIR_O}/output"
OUTPUT_DIR_O="${DEFAULT_OUTPUT_DIR_O}"
LOG_FILE_O=""
QUIET_O=0

usage() {
  cat <<'EOF'
Usage: observe.sh [--quiet] [--output-dir DIR]

  --quiet         Do not echo live output to stdout; only produce
                  the log file under --output-dir.
  --output-dir    Directory for the captured snapshot log.
                  Defaults to labs/kops-karpenter/output.
  -h, --help      Show this help.

Log file name:
  <output-dir>/observe.log   (overwritten on each run)
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --quiet)
      QUIET_O=1
      shift
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || { echo "[!] --output-dir requires a value" >&2; exit 3; }
      OUTPUT_DIR_O="$2"
      shift 2
      ;;
    --output-dir=*)
      OUTPUT_DIR_O="${1#--output-dir=}"
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
  source "${HELPER_O}"
  source_aws_credentials_from_env "${ENV_FILE_O}"
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
if ! mkdir -p "${OUTPUT_DIR_O}"; then
  echo "[!] Could not create output directory: ${OUTPUT_DIR_O}" >&2
  exit 1
fi
LOG_FILE_O="${OUTPUT_DIR_O%/}/observe.log"

# ---------------------------------------------------------------------------
# Resolve kOps variables. Same pattern used by validate-cluster.sh:
# prefer the ambient environment, fall back to bootstrap-state-store.sh
# --print-exports so the operator does not have to re-export by hand.
# ---------------------------------------------------------------------------
need_source_o=0
for var in KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME; do
  if [ -z "${!var:-}" ]; then
    need_source_o=1
    break
  fi
done

if [ "${need_source_o}" -eq 1 ]; then
  if [ ! -x "${BOOTSTRAP_O}" ]; then
    echo "[!] Some kOps env vars are unset and ${BOOTSTRAP_O} is missing or not executable." >&2
    echo "    Set KOPS_STATE_STORE, KOPS_DISCOVERY_STORE, and KOPS_CLUSTER_NAME manually," >&2
    echo "    or fix the bootstrap script." >&2
    exit 1
  fi
  echo "==> Sourcing kOps env vars from bootstrap-state-store.sh --print-exports..."
  # shellcheck disable=SC1090
  eval "$("${BOOTSTRAP_O}" --print-exports)"
else
  export KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME
fi

: "${KOPS_CLUSTER_NAME:=kops-karpenter-lab.k8s.local}"
export KOPS_CLUSTER_NAME

# ---------------------------------------------------------------------------
# Set kubectl context to the kOps cluster. `kops export kubeconfig`
# writes the admin kubeconfig to ~/.kube/config (or to the file
# pointed at by $KUBECONFIG) and selects the cluster context. We do
# not require this to succeed; if the API endpoint is unreachable
# (the Phase 2 NLB / VPC quota blocker) the failure is recorded in
# the log below and we fall through to kubectl calls so each one
# can record its own error.
#
# The kubeconfig-export output is captured to a temp file first;
# the log file is reset and the header is written AFTERWARDS so the
# operator sees the timestamp + cluster name at the top of the log
# rather than buried below a verbose `kops export` trace.
# ---------------------------------------------------------------------------
TMP_KUBECONFIG_LOG_O="$(mktemp -t observe-kops-export-XXXXXX.log)"
TMP_KUBECONFIG_LOG_O="${TMP_KUBECONFIG_LOG_O:-/tmp/observe-kops-export-$$.log}"

echo "==> Setting kubectl context to ${KOPS_CLUSTER_NAME}..."
if kops export kubeconfig --name "${KOPS_CLUSTER_NAME}" --admin >"${TMP_KUBECONFIG_LOG_O}" 2>&1; then
  echo "    kubeconfig exported successfully."
else
  echo "[!] kops export kubeconfig failed; kubectl calls below will record their own errors." >&2
fi

# ---------------------------------------------------------------------------
# Reset log file and write header. The header is written BEFORE the
# first observation section so a partially-failed run still has a
# usable timestamp + cluster name marker at the top.
# ---------------------------------------------------------------------------
{
  printf 'kOps + Karpenter lab — observability snapshot\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Cluster:    %s\n' "${KOPS_CLUSTER_NAME}"
  printf 'Context:    %s\n' "$(kubectl config current-context 2>&1 || true)"
  printf '\n## kops export kubeconfig --name %s --admin\n' "${KOPS_CLUSTER_NAME}"
  printf -- '------------------------------------------------------------\n'
  cat "${TMP_KUBECONFIG_LOG_O}"
} > "${LOG_FILE_O}"

rm -f "${TMP_KUBECONFIG_LOG_O}"

# Each section runs through run_section so we get a consistent
# header + body + failure marker.
run_section() {
  local header="$1"
  shift
  {
    printf '\n%s\n' "${header}"
    printf -- '------------------------------------------------------------\n'
    "$@"
  } >> "${LOG_FILE_O}" 2>&1 || {
    printf '[!] section failed: %s\n' "${header}" >> "${LOG_FILE_O}"
  }
}

# ---------------------------------------------------------------------------
# Sections. Every section is allowed to fail (its output still gets
# captured by run_section's `|| { ... }`) so a broken cluster API
# does not abort the rest of the snapshot.
# ---------------------------------------------------------------------------
run_section "## kops get cluster" \
  kops get cluster --name "${KOPS_CLUSTER_NAME}"

run_section "## kops get instancegroups" \
  kops get instancegroups --name "${KOPS_CLUSTER_NAME}"

run_section "## kubectl get nodes -o wide" \
  kubectl get nodes -o wide

run_section "## kubectl get pods -n karpenter -o wide" \
  kubectl get pods -n karpenter -o wide

run_section "## kubectl get events -n karpenter --sort-by=.lastTimestamp" \
  kubectl get events -n karpenter --sort-by=.lastTimestamp

run_section "## kubectl get nodepool,ec2nodeclass" \
  kubectl get nodepool,ec2nodeclass

run_section "## kubectl get nodeclaims -A" \
  kubectl get nodeclaims -A

# Only fetch Karpenter controller logs when the deployment exists.
# `kubectl logs deployment/karpenter` returns a non-zero exit code
# if the deployment is missing; in that case we record a marker
# instead of a stack trace.
run_section "## kubectl logs -n karpenter deployment/karpenter --tail=200" \
  bash -c '
    if kubectl get deployment -n karpenter karpenter >/dev/null 2>&1; then
      kubectl logs -n karpenter deployment/karpenter --tail=200
    else
      echo "(no karpenter deployment found in namespace karpenter; skipping logs)"
      exit 0
    fi
  '

# ---------------------------------------------------------------------------
# Footer.
# ---------------------------------------------------------------------------
{
  printf '\n------------------------------------------------------------\n'
  printf 'Observation complete: %s\n' "${LOG_FILE_O}"
} | tee -a "${LOG_FILE_O}" >/dev/null

if [ "${QUIET_O}" -eq 0 ]; then
  echo ""
  echo "==> Snapshot captured: ${LOG_FILE_O}"
fi

exit 0
