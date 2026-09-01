#!/usr/bin/env bash
#
# cleanup.sh
#
# Tear down the kOps + Karpenter lab cluster and delete the
# S3 state/discovery buckets it was using.
#
# This script is the cost-safety counterpart to create-cluster.sh:
# it removes every AWS resource the lab created so the bill stops
# accumulating the moment the operator runs it.
#
# Behavior:
#   - Sources AWS credentials from /Users/eramadan/castai/.env via
#     the shared `_lib-source-env.sh` helper. Only AWS_* variables
#     are forwarded; CAST AI tokens and other non-AWS secrets stay
#     out of the script environment.
#   - Sets AWS_REGION to us-west-2 and KOPS_CLUSTER_NAME to
#     kops-karpenter-lab.k8s.local (the lab defaults). Both can be
#     overridden by exporting the corresponding env vars before
#     invoking the script.
#   - Supports `--dry-run` (no resources are touched; only the plan
#     is printed) and `--yes` (skip the confirmation prompt). The
#     combination `--dry-run --yes` is allowed: it just prints the
#     plan and exits.
#   - Without `--dry-run`:
#       1. Calls `kops delete cluster --name ... --state ... --yes`
#          (the `--yes` is supplied automatically so the script is
#          non-interactive; an explicit `--yes` to the script is a
#          no-op in that case).
#       2. Deletes the S3 state bucket and the discovery bucket
#          (idempotent: `aws s3 rb --force` on a non-existent bucket
#          exits 0 with a "not found" message; the script swallows
#          that).
#   - Idempotent: if the cluster is already deleted, `kops delete
#     cluster` returns "cluster not found" and the script logs that
#     and moves on to bucket cleanup. Same for already-deleted
#     buckets.
#   - Always logs to labs/kops-karpenter/output/cleanup.log so the
#     operator has an auditable trail of what was deleted.
#
# Flags:
#   --dry-run    Print what would be deleted without deleting
#                anything. Exits 0 on success.
#   --yes        Suppress the interactive confirmation prompt (used
#                in CI / non-interactive shells). No-op with --dry-run.
#   -h, --help   Show usage.
#
# Exit codes:
#   0  cleanup plan executed (or dry-run printed) successfully
#   1  prerequisite missing (kops / aws) or credentials missing
#   2  one or more delete steps failed (the log records the failure)
#   3  invalid arguments

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths.
# ---------------------------------------------------------------------------
SCRIPT_DIR_CL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR_CL="$(cd "${SCRIPT_DIR_CL}/.." && pwd)"
REPO_ROOT_CL="$(cd "${LAB_DIR_CL}/../.." && pwd)"
ENV_FILE_CL="${REPO_ROOT_CL}/.env"
HELPER_CL="${SCRIPT_DIR_CL}/_lib-source-env.sh"
LOG_FILE_CL="${LAB_DIR_CL}/output/cleanup.log"

# ---------------------------------------------------------------------------
# Defaults and argument parsing.
# ---------------------------------------------------------------------------
DRY_RUN_CL=0
ASSUME_YES_CL=0

usage() {
  cat <<'EOF'
Usage: cleanup.sh [--dry-run] [--yes]

  --dry-run    Print the deletion plan and exit without modifying any
               AWS resource. Safe to run any time.
  --yes        Suppress the interactive confirmation prompt.
  -h, --help   Show this help.

Defaults (overridable via env):
  AWS_REGION           us-west-2
  KOPS_CLUSTER_NAME    kops-karpenter-lab.k8s.local

State and discovery bucket names are derived from
labs/kops-karpenter/bin/bootstrap-state-store.sh and resolved at
runtime against the AWS account returned by `aws sts get-caller-identity`.

Log file:
  labs/kops-karpenter/output/cleanup.log    (overwritten on each run)
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN_CL=1
      shift
      ;;
    --yes)
      ASSUME_YES_CL=1
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
# AWS_* allow-list is forwarded into this shell, so non-AWS secrets
# (CAST AI tokens) defined in .env never enter the environment.
# ---------------------------------------------------------------------------
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  # shellcheck disable=SC1090,SC1091
  source "${HELPER_CL}"
  source_aws_credentials_from_env "${ENV_FILE_CL}"
fi

# ---------------------------------------------------------------------------
# Prerequisite checks.
# ---------------------------------------------------------------------------
for cmd in kops aws; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[!] Required command not found on PATH: $cmd" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Resolve AWS region and cluster name from the lab defaults. Operators
# can override by exporting the variables before invoking the script.
# ---------------------------------------------------------------------------
: "${AWS_REGION:=us-west-2}"
: "${AWS_DEFAULT_REGION:=${AWS_REGION}}"
export AWS_REGION
export AWS_DEFAULT_REGION

: "${KOPS_CLUSTER_NAME:=kops-karpenter-lab.k8s.local}"
export KOPS_CLUSTER_NAME

# ---------------------------------------------------------------------------
# Verify AWS credentials before doing anything that touches the cloud.
# ---------------------------------------------------------------------------
echo "==> Verifying AWS credentials in region '${AWS_REGION}'..." >&2
if ! CALLER_JSON="$(aws sts get-caller-identity --region "${AWS_REGION}" --output json 2>&1)"; then
  echo "[!] aws sts get-caller-identity failed. Configure credentials or set AWS_* env vars." >&2
  echo "${CALLER_JSON}" >&2
  exit 1
fi

AWS_ACCOUNT_ID_CL="$(printf '%s' "${CALLER_JSON}" | awk -F'"' '/"Account"/{for(i=1;i<=NF;i++) if($i=="Account") {print $(i+2); exit}}')"
if [ -z "${AWS_ACCOUNT_ID_CL}" ] && command -v jq >/dev/null 2>&1; then
  AWS_ACCOUNT_ID_CL="$(printf '%s' "${CALLER_JSON}" | jq -r '.Account // empty')"
fi
if [ -z "${AWS_ACCOUNT_ID_CL}" ]; then
  echo "[!] Could not determine AWS account id from STS response." >&2
  exit 1
fi

# Resolve bucket names from the same convention bootstrap-state-store.sh
# uses. Operators who set KOPS_STATE_STORE / KOPS_DISCOVERY_STORE
# explicitly are honored.
DEFAULT_STATE_STORE="kops-karpenter-lab-state-${AWS_REGION}-${AWS_ACCOUNT_ID_CL}"
: "${KOPS_STATE_STORE:=s3://${DEFAULT_STATE_STORE}}"
: "${KOPS_DISCOVERY_STORE:=${KOPS_STATE_STORE}-discovery}"
export KOPS_STATE_STORE
export KOPS_DISCOVERY_STORE

# Strip s3:// scheme for the `aws s3 rb` call (which wants a bare
# bucket name).
STATE_BUCKET="${KOPS_STATE_STORE#s3://}"
STATE_BUCKET="${STATE_BUCKET%/}"
DISCOVERY_BUCKET="${KOPS_DISCOVERY_STORE#s3://}"
DISCOVERY_BUCKET="${DISCOVERY_BUCKET%/}"

# ---------------------------------------------------------------------------
# Ensure the output directory exists and reset the log file.
# ---------------------------------------------------------------------------
if ! mkdir -p "${LAB_DIR_CL}/output"; then
  echo "[!] Could not create output directory: ${LAB_DIR_CL}/output" >&2
  exit 1
fi

{
  printf 'kOps + Karpenter lab — cleanup\n'
  printf 'Generated:    %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf 'Mode:         %s\n' "$([ "${DRY_RUN_CL}" -eq 1 ] && echo 'dry-run' || echo 'apply')"
  printf 'Cluster:      %s\n' "${KOPS_CLUSTER_NAME}"
  printf 'Region:       %s\n' "${AWS_REGION}"
  printf 'AWS account:  %s\n' "${AWS_ACCOUNT_ID_CL}"
  printf 'State store:  %s (bucket: %s)\n' "${KOPS_STATE_STORE}" "${STATE_BUCKET}"
  printf 'Discovery:    %s (bucket: %s)\n' "${KOPS_DISCOVERY_STORE}" "${DISCOVERY_BUCKET}"
} > "${LOG_FILE_CL}"

echo "==> Logging to ${LOG_FILE_CL}"

# ---------------------------------------------------------------------------
# Confirm whether the cluster exists. `kops get cluster` exits non-zero
# when the cluster is not registered, which is the expected idempotent
# "already gone" state; capture that explicitly.
# ---------------------------------------------------------------------------
CLUSTER_PRESENT_CL=0
if kops get cluster --name "${KOPS_CLUSTER_NAME}" --state "${KOPS_STATE_STORE}" \
     >"${LOG_FILE_CL}.get-cluster.tmp" 2>&1; then
  CLUSTER_PRESENT_CL=1
  {
    printf '\n## kops get cluster --name %s\n' "${KOPS_CLUSTER_NAME}"
    printf -- '------------------------------------------------------------\n'
    cat "${LOG_FILE_CL}.get-cluster.tmp"
  } >> "${LOG_FILE_CL}"
else
  {
    printf '\n## kops get cluster --name %s\n' "${KOPS_CLUSTER_NAME}"
    printf -- '------------------------------------------------------------\n'
    printf '(cluster is not registered in the state store — already deleted)\n'
  } >> "${LOG_FILE_CL}"
fi
rm -f "${LOG_FILE_CL}.get-cluster.tmp"

# ---------------------------------------------------------------------------
# Plan printer. Used in dry-run mode and as the per-step banner in
# apply mode.
# ---------------------------------------------------------------------------
print_plan() {
  cat <<EOF

==> Cleanup plan:
    Cluster:        ${KOPS_CLUSTER_NAME}
    Region:         ${AWS_REGION}
    State bucket:   ${STATE_BUCKET}
    Discovery bkt:  ${DISCOVERY_BUCKET}
EOF
  if [ "${CLUSTER_PRESENT_CL}" -eq 1 ]; then
    printf '    Action:        kops delete cluster --name %s --state %s --yes\n' \
      "${KOPS_CLUSTER_NAME}" "${KOPS_STATE_STORE}"
  else
    printf '    Action:        (skip kops delete — cluster not present)\n'
  fi
  if aws s3api head-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}" \
       >/dev/null 2>&1; then
    printf '    Action:        aws s3 rb s3://%s --force\n' "${STATE_BUCKET}"
  else
    printf '    Action:        (skip state bucket — not found)\n'
  fi
  if aws s3api head-bucket --bucket "${DISCOVERY_BUCKET}" --region "${AWS_REGION}" \
       >/dev/null 2>&1; then
    printf '    Action:        aws s3 rb s3://%s --force\n' "${DISCOVERY_BUCKET}"
  else
    printf '    Action:        (skip discovery bucket — not found)\n'
  fi
}

# ---------------------------------------------------------------------------
# Dry-run mode. Print the plan and exit.
# ---------------------------------------------------------------------------
if [ "${DRY_RUN_CL}" -eq 1 ]; then
  print_plan | tee -a "${LOG_FILE_CL}"
  {
    printf '\n## dry-run: no AWS resources were modified\n'
    printf -- '------------------------------------------------------------\n'
  } >> "${LOG_FILE_CL}"
  echo ""
  echo "==> Dry run complete. Nothing was deleted."
  exit 0
fi

# ---------------------------------------------------------------------------
# Apply mode. Optionally confirm interactively unless --yes was passed.
# ---------------------------------------------------------------------------
print_plan | tee -a "${LOG_FILE_CL}"

if [ "${ASSUME_YES_CL}" -eq 0 ] && [ -t 0 ]; then
  printf 'Proceed with deletion? Type "yes" to continue: '
  read -r CONFIRM_CL
  if [ "${CONFIRM_CL}" != "yes" ]; then
    {
      printf '\n## cancelled by operator (input was %q, not "yes")\n' "${CONFIRM_CL}"
    } >> "${LOG_FILE_CL}"
    echo ""
    echo "[!] Cleanup cancelled. Nothing was deleted."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# 1. Delete the cluster.
# ---------------------------------------------------------------------------
failed_cl=0

{
  printf '\n## kops delete cluster --name %s --state %s --yes\n' \
    "${KOPS_CLUSTER_NAME}" "${KOPS_STATE_STORE}"
  printf -- '------------------------------------------------------------\n'
} >> "${LOG_FILE_CL}"

if [ "${CLUSTER_PRESENT_CL}" -eq 1 ]; then
  echo "==> Deleting cluster ${KOPS_CLUSTER_NAME}..." >&2
  if ! kops delete cluster --name "${KOPS_CLUSTER_NAME}" \
        --state "${KOPS_STATE_STORE}" --yes \
        >> "${LOG_FILE_CL}" 2>&1; then
    printf '[!] kops delete cluster failed; continuing to bucket cleanup.\n' >> "${LOG_FILE_CL}"
    echo "[!] kops delete cluster failed; see ${LOG_FILE_CL}." >&2
    failed_cl=$((failed_cl + 1))
  else
    echo "    kops delete cluster completed." >&2
  fi
else
  printf '(skipped — cluster is not registered in the state store)\n' >> "${LOG_FILE_CL}"
  echo "    (skipped — cluster is not registered in the state store)" >&2
fi

# ---------------------------------------------------------------------------
# 2. Delete the state bucket.
# ---------------------------------------------------------------------------
{
  printf '\n## aws s3 rb s3://%s --force\n' "${STATE_BUCKET}"
  printf -- '------------------------------------------------------------\n'
} >> "${LOG_FILE_CL}"

if aws s3api head-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}" \
     >/dev/null 2>&1; then
  echo "==> Deleting state bucket s3://${STATE_BUCKET}..." >&2
  if ! aws s3 rb "s3://${STATE_BUCKET}" --force >> "${LOG_FILE_CL}" 2>&1; then
    printf '[!] aws s3 rb failed for s3://%s\n' "${STATE_BUCKET}" >> "${LOG_FILE_CL}"
    echo "[!] aws s3 rb failed for s3://${STATE_BUCKET}." >&2
    failed_cl=$((failed_cl + 1))
  else
    echo "    State bucket deleted." >&2
  fi
else
  printf '(skipped — bucket not found)\n' >> "${LOG_FILE_CL}"
  echo "    (skipped — state bucket not found)" >&2
fi

# ---------------------------------------------------------------------------
# 3. Delete the discovery bucket.
# ---------------------------------------------------------------------------
{
  printf '\n## aws s3 rb s3://%s --force\n' "${DISCOVERY_BUCKET}"
  printf -- '------------------------------------------------------------\n'
} >> "${LOG_FILE_CL}"

if aws s3api head-bucket --bucket "${DISCOVERY_BUCKET}" --region "${AWS_REGION}" \
     >/dev/null 2>&1; then
  echo "==> Deleting discovery bucket s3://${DISCOVERY_BUCKET}..." >&2
  if ! aws s3 rb "s3://${DISCOVERY_BUCKET}" --force >> "${LOG_FILE_CL}" 2>&1; then
    printf '[!] aws s3 rb failed for s3://%s\n' "${DISCOVERY_BUCKET}" >> "${LOG_FILE_CL}"
    echo "[!] aws s3 rb failed for s3://${DISCOVERY_BUCKET}." >&2
    failed_cl=$((failed_cl + 1))
  else
    echo "    Discovery bucket deleted." >&2
  fi
else
  printf '(skipped — bucket not found)\n' >> "${LOG_FILE_CL}"
  echo "    (skipped — discovery bucket not found)" >&2
fi

# ---------------------------------------------------------------------------
# 4. Final verification: cluster is gone, buckets are gone.
# ---------------------------------------------------------------------------
{
  printf '\n## verification\n'
  printf -- '------------------------------------------------------------\n'
} >> "${LOG_FILE_CL}"

verify_gone=1

if kops get cluster --name "${KOPS_CLUSTER_NAME}" --state "${KOPS_STATE_STORE}" \
     >> "${LOG_FILE_CL}" 2>&1; then
  printf 'cluster: STILL REGISTERED (this is unexpected).\n' >> "${LOG_FILE_CL}"
  verify_gone=0
else
  printf 'cluster: not found in state store (expected).\n' >> "${LOG_FILE_CL}"
fi

if aws s3api head-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}" \
     >/dev/null 2>&1; then
  printf 'state bucket: still exists (this is unexpected).\n' >> "${LOG_FILE_CL}"
  verify_gone=0
else
  printf 'state bucket: gone (expected).\n' >> "${LOG_FILE_CL}"
fi

if aws s3api head-bucket --bucket "${DISCOVERY_BUCKET}" --region "${AWS_REGION}" \
     >/dev/null 2>&1; then
  printf 'discovery bucket: still exists (this is unexpected).\n' >> "${LOG_FILE_CL}"
  verify_gone=0
else
  printf 'discovery bucket: gone (expected).\n' >> "${LOG_FILE_CL}"
fi

{
  printf '\n------------------------------------------------------------\n'
  printf 'Cleanup complete: %s\n' "${LOG_FILE_CL}"
} | tee -a "${LOG_FILE_CL}" >/dev/null

echo ""
if [ "${failed_cl}" -gt 0 ] || [ "${verify_gone}" -eq 0 ]; then
  echo "[!] Cleanup finished with ${failed_cl} delete failure(s) or stale resources. See ${LOG_FILE_CL}."
  exit 2
fi

echo "==> Done. Cluster and buckets are gone. Log: ${LOG_FILE_CL}"
exit 0
