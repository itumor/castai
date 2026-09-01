#!/usr/bin/env bash
#
# validate-cluster.sh
#
# Print a snapshot of the kOps + Karpenter lab cluster: kOps state,
# Kubernetes nodes, Karpenter pods/CRDs/objects, and Karpenter-related
# events. All output is captured to a log file so the operator can
# inspect it after the fact (or share it during troubleshooting).
#
# Flags:
#   --quiet         Suppress the live on-screen echo; only the log file
#                   is produced. Useful when running from CI or from
#                   another script.
#   --output-dir    Directory for the log file. Defaults to
#                   labs/kops-karpenter/output. Created if missing.
#   -h, --help      Show usage.
#
# Exit codes:
#   0  snapshot captured successfully
#   1  prerequisite missing (kops/kubectl) or kubeconfig not usable
#   2  one or more diagnostic sections failed (snapshot still captured)
#   3  invalid arguments

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths and argument parsing.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT_VC="$(cd "${LAB_DIR}/../.." && pwd)"
ENV_FILE_VC="${REPO_ROOT_VC}/.env"
HELPER_VC="${SCRIPT_DIR}/_lib-source-env.sh"
DEFAULT_OUTPUT_DIR="${LAB_DIR}/output"
OUTPUT_DIR="${DEFAULT_OUTPUT_DIR}"
LOG_FILE=""
QUIET=0

# Source AWS credentials from the repo-root .env via the shared helper.
# Only AWS_* variables are forwarded into this shell, so non-AWS secrets
# (e.g. CAST AI tokens) defined in .env never enter the environment of
# this script or any of its child processes.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_VC}"
  source_aws_credentials_from_env "${ENV_FILE_VC}"
fi

usage() {
  cat <<'EOF'
Usage: validate-cluster.sh [--quiet] [--output-dir DIR]

  --quiet          Do not echo live output to stdout; only produce the
                   log file under --output-dir.
  --output-dir     Directory for the captured snapshot log. Defaults to
                   labs/kops-karpenter/output. Created if missing.
  -h, --help       Show this help.

Log file name:
  <output-dir>/validate-cluster.log   (overwritten on each run)
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --quiet)
      QUIET=1
      shift
      ;;
    --output-dir)
      [ "$#" -ge 2 ] || { echo "[!] --output-dir requires a value" >&2; exit 3; }
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --output-dir=*)
      OUTPUT_DIR="${1#--output-dir=}"
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
# Prerequisite tool checks.
# ---------------------------------------------------------------------------
for cmd in kops kubectl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[!] Required command not found on PATH: $cmd" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Ensure output directory and log file exist.
# ---------------------------------------------------------------------------
if ! mkdir -p "${OUTPUT_DIR}"; then
  echo "[!] Could not create output directory: ${OUTPUT_DIR}" >&2
  exit 1
fi
LOG_FILE="${OUTPUT_DIR%/}/validate-cluster.log"

# tee_to_log writes a section header + body to the log file and, when
# not --quiet, also echoes it to stdout so the operator sees live
# progress.
tee_to_log() {
  local header="$1"
  shift
  {
    printf '\n%s\n' "${header}"
    printf -- '------------------------------------------------------------\n'
    "$@"
  } | tee -a "${LOG_FILE}"
}

# run_section runs a command and captures its output. Returns the
# command's exit code so the caller can track partial failures.
# In --quiet mode, only the log file gets the output.
run_section() {
  local header="$1"
  shift
  if [ "${QUIET}" -eq 1 ]; then
    {
      printf '\n%s\n' "${header}"
      printf -- '------------------------------------------------------------\n'
      "$@"
    } >> "${LOG_FILE}" 2>&1
  else
    tee_to_log "${header}" "$@"
  fi
}

# ---------------------------------------------------------------------------
# Resolve kOps variables from the environment when available so kops
# commands can pass --state / --name without making the operator re-export
# them by hand. If any of the canonical variables are unset, source them
# from `bootstrap-state-store.sh --print-exports` (same pattern used by
# create-cluster.sh) so a single source of truth is maintained.
# ---------------------------------------------------------------------------
need_source=0
for var in KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME; do
  if [ -z "${!var:-}" ]; then
    need_source=1
    break
  fi
done

if [ "${need_source}" -eq 1 ]; then
  BOOTSTRAP_VC="${SCRIPT_DIR}/bootstrap-state-store.sh"
  if [ ! -x "${BOOTSTRAP_VC}" ]; then
    echo "[!] Some kOps env vars are unset and ${BOOTSTRAP_VC} is missing or not executable." >&2
    echo "    Set KOPS_STATE_STORE, KOPS_DISCOVERY_STORE, and KOPS_CLUSTER_NAME" >&2
    echo "    manually, or fix the bootstrap script." >&2
    exit 1
  fi
  echo "==> Sourcing kOps env vars from bootstrap-state-store.sh --print-exports..."
  # shellcheck disable=SC1090
  eval "$("${BOOTSTRAP_VC}" --print-exports)"
else
  export KOPS_STATE_STORE KOPS_DISCOVERY_STORE KOPS_CLUSTER_NAME
fi

: "${KOPS_CLUSTER_NAME:=kops-karpenter-lab.k8s.local}"
export KOPS_CLUSTER_NAME

echo "    KOPS_STATE_STORE     = ${KOPS_STATE_STORE}"
echo "    KOPS_DISCOVERY_STORE = ${KOPS_DISCOVERY_STORE}"
echo "    KOPS_CLUSTER_NAME    = ${KOPS_CLUSTER_NAME}"

# ---------------------------------------------------------------------------
# Confirm kubeconfig is usable. A missing or invalid kubeconfig is the
# single most common reason this script fails, so check explicitly
# before running any kubectl command.
# ---------------------------------------------------------------------------
echo "==> Checking kubeconfig/context..."
KUBECONFIG_CTX="$(kubectl config current-context 2>&1 || true)"
if [ -z "${KUBECONFIG_CTX}" ] || [[ "${KUBECONFIG_CTX}" == *"error"* ]]; then
  echo "[!] No active kubectl context. Export kubeconfig first:" >&2
  echo "    kops export kubeconfig --name \"\${KOPS_CLUSTER_NAME}\" --admin" >&2
  exit 1
fi
echo "    Active context: ${KUBECONFIG_CTX}"

# ---------------------------------------------------------------------------
# Reset log file and write header.
# ---------------------------------------------------------------------------
{
  printf 'kOps + Karpenter lab — cluster validation snapshot\n'
  printf 'Generated:  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Context:    %s\n' "${KUBECONFIG_CTX}"
  printf 'Cluster:    %s\n' "${KOPS_CLUSTER_NAME}"
} > "${LOG_FILE}"

# Track partial failures so we can exit non-zero at the end if any
# section broke, while still keeping the log file complete.
failed_sections=0

# Each section runs even if the previous one failed (|| true + counter)
# so the operator gets a complete snapshot rather than only the first
# failure.
run_section "## kops get cluster" \
  kops get cluster --name "${KOPS_CLUSTER_NAME}" \
  || failed_sections=$((failed_sections + 1))

run_section "## kops get instancegroups" \
  kops get instancegroups --name "${KOPS_CLUSTER_NAME}" \
  || failed_sections=$((failed_sections + 1))

run_section "## kubectl get nodes -o wide" \
  kubectl get nodes -o wide \
  || failed_sections=$((failed_sections + 1))

run_section "## kubectl get pods -n karpenter" \
  kubectl get pods -n karpenter \
  || failed_sections=$((failed_sections + 1))

run_section "## kubectl get crd | grep karpenter" \
  bash -c "kubectl get crd | grep -i karpenter || echo '(no Karpenter CRDs found)'" \
  || failed_sections=$((failed_sections + 1))

run_section "## kubectl get nodepool,ec2nodeclass" \
  kubectl get nodepool,ec2nodeclass \
  || failed_sections=$((failed_sections + 1))

run_section "## kubectl get events -n karpenter --sort-by=.lastTimestamp" \
  kubectl get events -n karpenter --sort-by=.lastTimestamp \
  || failed_sections=$((failed_sections + 1))

# ---------------------------------------------------------------------------
# Footer.
# ---------------------------------------------------------------------------
{
  printf '\n------------------------------------------------------------\n'
  printf 'Snapshot complete: %s\n' "${LOG_FILE}"
  if [ "${failed_sections}" -gt 0 ]; then
    printf '%d section(s) reported errors. See log for details.\n' "${failed_sections}"
  fi
} | tee -a "${LOG_FILE}"

# Final summary line for the operator.
if [ "${QUIET}" -eq 0 ]; then
  echo ""
  if [ "${failed_sections}" -gt 0 ]; then
    echo "[!] ${failed_sections} section(s) had errors. Log: ${LOG_FILE}"
  else
    echo "==> Snapshot captured: ${LOG_FILE}"
  fi
fi

if [ "${failed_sections}" -gt 0 ]; then
  exit 2
fi
exit 0
