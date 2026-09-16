#!/usr/bin/env bash
#
# tests/test-rotate-token.sh
#
# Plain bash assertions for lib/rotate-token.sh.
#
# Coverage:
#   - rotate_token::rotate in dry-run mode prints POST /token,
#     kubectl patch (kubectl create secret) commands for every secret,
#     and kubectl rollout restart for every deployment.
#   - rotate_token::simulate_missed_secret in dry-run mode prints
#     updates for every secret except the skipped one.
#   - Live paths abort without APPROVE_LIVE_RUN=true.
#
# All tests run in dry-run mode so they never touch the CAST AI API or
# Kubernetes. Stub credentials and an isolated state file keep each
# test self-contained.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${TEST_DIR}/.." && pwd)"
LIB_DIR="${E2E_DIR}/lib"

# Required env for castai::_require_live_approval when not in dry-run.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-AKIA-TEST-STUB-KEY-ID}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-TEST-STUB-SECRET-ACCESS-KEY}"
export CASTAI_API_KEY="${CASTAI_API_KEY:-castai-token-test-fixture}"
export CASTAI_API_BASE="${CASTAI_API_BASE:-https://api.eu.cast.ai}"
export CASTAI_ORG_ID="${CASTAI_ORG_ID:-01234567-89ab-cdef-0123-456789abcdef}"
export APPROVE_LIVE_RUN="${APPROVE_LIVE_RUN:-}"

# Use an isolated state file so tests don't clobber a real state file.
TEST_TMPDIR="$(mktemp -d)"
export CASTAI_STATE_FILE="${TEST_TMPDIR}/e2e-state.json"
export ROTATE_ARTIFACTS_DIR="${TEST_TMPDIR}/artifacts"
mkdir -p "${ROTATE_ARTIFACTS_DIR}"

# Use an isolated artifacts dir for verify-components too in case tests
# in the same process load both libraries.
export VERIFY_ARTIFACTS_DIR="${TEST_TMPDIR}/artifacts"

# shellcheck source=../lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=../lib/castai-install.sh
source "${LIB_DIR}/castai-install.sh"
# shellcheck source=../lib/rotate-token.sh
source "${LIB_DIR}/rotate-token.sh"

TESTS_RUN=0
TESTS_FAILED=0

_red()   { printf '\033[31m%s\033[0m' "$*"; }
_green() { printf '\033[32m%s\033[0m' "$*"; }

_assert_eq() {
    local label="$1"
    local expected="$2"
    local actual="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "${expected}" != "${actual}" ]]; then
        _red "FAIL" >&2
        printf '  %s\n  expected: %q\n  actual:   %q\n' "${label}" "${expected}" "${actual}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    else
        _green "PASS" >&2
        printf '  %s\n' "${label}" >&2
    fi
}

_assert_not_eq() {
    local label="$1"
    local unexpected="$2"
    local actual="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "${unexpected}" == "${actual}" ]]; then
        _red "FAIL" >&2
        printf '  %s\n  unexpected match: %q\n  actual:           %q\n' "${label}" "${unexpected}" "${actual}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    else
        _green "PASS" >&2
        printf '  %s\n' "${label}" >&2
    fi
}

_assert_contains() {
    local label="$1"
    local needle="$2"
    local haystack="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "${haystack}" != *"${needle}"* ]]; then
        _red "FAIL" >&2
        printf '  %s\n  expected to contain: %q\n  actual:              %s\n' "${label}" "${needle}" "${haystack}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    else
        _green "PASS" >&2
        printf '  %s\n' "${label}" >&2
    fi
}

_assert_not_contains() {
    local label="$1"
    local needle="$2"
    local haystack="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "${haystack}" == *"${needle}"* ]]; then
        _red "FAIL" >&2
        printf '  %s\n  expected NOT to contain: %q\n  actual:                  %s\n' "${label}" "${needle}" "${haystack}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    else
        _green "PASS" >&2
        printf '  %s\n' "${label}" >&2
    fi
}

# Run a function and capture stdout+stderr plus the exit code. Uses a
# temp file because `$()` runs in a subshell, so printf -v side variables
# would not propagate to the caller.
_capture_with_rc() {
    local rc_var="$1"
    local output_var="$2"
    shift 2
    local tmp rc
    tmp="$(mktemp)"
    "$@" >"${tmp}" 2>&1
    rc=$?
    printf -v "${rc_var}" '%s' "${rc}"
    printf -v "${output_var}" '%s' "$(cat "${tmp}")"
    rm -f "${tmp}"
}

_reset_state() {
    export ROTATE_TOKEN_DRY_RUN="true"
    rm -f "${CASTAI_STATE_FILE}"
}

_seed_state() {
    castai::_state_set "cluster_id" "11111111-2222-3333-4444-555555555555"
}

# -----------------------------------------------------------------------------
# Test 1: rotate_token::rotate in dry-run mode prints POST /token,
# kubectl create secret (patch in spirit) commands for every secret,
# and kubectl rollout restart for every deployment.
# -----------------------------------------------------------------------------

printf '\n[1] rotate_token::rotate dry-run prints POST + secret updates + rollout restart\n' >&2

_reset_state
_seed_state

rotate_rc=0
rotate_output=""
_capture_with_rc rotate_rc rotate_output rotate_token::rotate

_assert_eq \
    "rotate_token::rotate dry-run exits 0" \
    "0" \
    "${rotate_rc}"

_assert_contains \
    "dry-run prints POST /v1/kubernetes/external-clusters/{id}/token" \
    "POST /v1/kubernetes/external-clusters/11111111-2222-3333-4444-555555555555/token" \
    "${rotate_output}"

_assert_contains \
    "dry-run prints DRY-RUN banner" \
    "DRY-RUN" \
    "${rotate_output}"

# Every per-component secret should appear in the would-be kubectl
# create secret output.
for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
    _assert_contains \
        "dry-run updates secret ${secret}" \
        "kubectl create secret generic ${secret} --namespace=${ROTATE_NAMESPACE}" \
        "${rotate_output}"
done

# Every component should appear in the would-be kubectl rollout restart
# output. castai-spot-handler and castai-kvisor-agent are DaemonSets
# in the umbrella chart; the rest are Deployments. We resolve the
# expected kind from the castai install registry so the test stays
# in lock-step with lib/castai-install.sh.
for deployment in "${ROTATE_COMPONENT_DEPLOYMENTS[@]}"; do
    kind="$(castai::_kind_of "${deployment}")"
    _assert_contains \
        "dry-run triggers rollout restart for ${deployment} (${kind})" \
        "kubectl rollout restart ${kind}/${deployment} --namespace=${ROTATE_NAMESPACE}" \
        "${rotate_output}"
    _assert_contains \
        "dry-run waits for rollout status of ${deployment} (${kind})" \
        "kubectl rollout status ${kind}/${deployment} --namespace=${ROTATE_NAMESPACE}" \
        "${rotate_output}"
done

_assert_not_contains \
    "dry-run output never includes the real CAST AI token" \
    "castai-token-test-fixture" \
    "${rotate_output}"

# -----------------------------------------------------------------------------
# Test 2: rotate_token::simulate_missed_secret prints updates for every
# secret except the skipped one.
# -----------------------------------------------------------------------------

printf '\n[2] rotate_token::simulate_missed_secret skips the named secret\n' >&2

_reset_state
_seed_state

skip_rc=0
skip_output=""
_capture_with_rc skip_rc skip_output rotate_token::simulate_missed_secret "castai-cluster-controller-token"

_assert_eq \
    "simulate_missed_secret dry-run exits 0" \
    "0" \
    "${skip_rc}"

_assert_contains \
    "dry-run announces failure-simulation mode" \
    "Failure-simulation mode" \
    "${skip_output}"

_assert_contains \
    "dry-run names the skipped secret" \
    "castai-cluster-controller-token" \
    "${skip_output}"

# The four non-skipped secrets should still be present.
for secret in "castai-agent-token" "castai-spot-handler-token" "castai-evictor-token" "castai-workload-autoscaler-token"; do
    _assert_contains \
        "dry-run still updates ${secret}" \
        "kubectl create secret generic ${secret} --namespace=${ROTATE_NAMESPACE}" \
        "${skip_output}"
done

# The skipped secret is now overwritten with an intentionally invalid
# token so the component surfaces the customer symptom. Verify the
# dry-run output announces the replacement and includes the kubectl
# create command for the skipped secret.
_assert_contains \
    "dry-run announces invalid-token injection for skipped secret" \
    "replacing secret castai-cluster-controller-token with an invalid token" \
    "${skip_output}"

_assert_contains \
    "dry-run still creates the skipped secret with invalid token" \
    "kubectl create secret generic castai-cluster-controller-token --namespace=${ROTATE_NAMESPACE}" \
    "${skip_output}"

# The invalid token placeholder is exported as a clearly labeled
# constant so it cannot be mistaken for a real cluster token.
_assert_eq \
    "ROTATE_SIMULATION_INVALID_TOKEN is a labeled placeholder" \
    "simulated-invalid-token-401-test-do-not-use" \
    "${ROTATE_SIMULATION_INVALID_TOKEN}"

# The rollout restart list must still cover every deployment (failure
# simulation still restarts them all - the bug surfaces in the new pods
# picking up the invalid secret). Use the castai kind registry so the
# test matches the new deployment/daemonset split.
for deployment in "${ROTATE_COMPONENT_DEPLOYMENTS[@]}"; do
    kind="$(castai::_kind_of "${deployment}")"
    _assert_contains \
        "dry-run still triggers rollout restart for ${deployment} (${kind})" \
        "kubectl rollout restart ${kind}/${deployment} --namespace=${ROTATE_NAMESPACE}" \
        "${skip_output}"
done

# -----------------------------------------------------------------------------
# Test 3: live paths refuse to run without APPROVE_LIVE_RUN.
# -----------------------------------------------------------------------------

printf '\n[3] live rotation aborts without APPROVE_LIVE_RUN\n' >&2

_reset_state
_seed_state
unset APPROVE_LIVE_RUN
export ROTATE_TOKEN_DRY_RUN="false"

live_rc=0
live_output=""
_capture_with_rc live_rc live_output rotate_token::rotate

_assert_not_eq \
    "live rotate exits non-zero without APPROVE_LIVE_RUN" \
    "0" \
    "${live_rc}"

_assert_contains \
    "live path explains APPROVE_LIVE_RUN requirement" \
    "APPROVE_LIVE_RUN" \
    "${live_output}"

_assert_contains \
    "live path mentions CAST AI API mutation" \
    "CAST AI API" \
    "${live_output}"

# Re-enable dry-run for any later tests.
export ROTATE_TOKEN_DRY_RUN="true"

# -----------------------------------------------------------------------------
# Test 4: rotate_token::rotate in dry-run without a state file errors out.
# -----------------------------------------------------------------------------

printf '\n[4] rotate_token::rotate dry-run without state file aborts\n' >&2

rm -f "${CASTAI_STATE_FILE}"
export ROTATE_TOKEN_DRY_RUN="true"

noid_rc=0
noid_output=""
_capture_with_rc noid_rc noid_output rotate_token::rotate

_assert_not_eq \
    "rotate without cluster_id exits non-zero" \
    "0" \
    "${noid_rc}"

_assert_contains \
    "error message mentions cluster_id" \
    "cluster_id" \
    "${noid_output}"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

printf '\n' >&2
if (( TESTS_FAILED == 0 )); then
    _green "All ${TESTS_RUN} assertions passed." >&2
    rm -rf "${TEST_TMPDIR}"
    exit 0
fi
_red "${TESTS_FAILED} of ${TESTS_RUN} assertions failed." >&2
rm -rf "${TEST_TMPDIR}"
exit 1
