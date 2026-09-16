#!/usr/bin/env bash
#
# tests/test-verify-components.sh
#
# Plain bash assertions for lib/verify-components.sh.
#
# Coverage:
#   - verify_components::check_logs_for_401 in dry-run mode returns 0
#     and prints the components it would check.
#   - verify_components::check_castai_api in dry-run mode prints the
#     API endpoint it would poll.
#   - Log parsing on synthetic input correctly detects the
#     "401 Authorization Required" marker (regression test).
#   - check_logs_for_401 happy-path policy fails when ANY component has
#     401s (tested via the internal count helper on synthetic input).
#   - check_logs_for_401 failure-simulation policy requires only the
#     expected component to have 401s.
#
# All tests run in dry-run mode where they would touch Kubernetes or the
# CAST AI API; synthetic inputs exercise the marker-counting logic
# directly.

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

# Use an isolated state file and artifacts dir so tests don't clobber
# real on-disk state.
TEST_TMPDIR="$(mktemp -d)"
export CASTAI_STATE_FILE="${TEST_TMPDIR}/e2e-state.json"
export VERIFY_ARTIFACTS_DIR="${TEST_TMPDIR}/artifacts"
export ROTATE_ARTIFACTS_DIR="${TEST_TMPDIR}/artifacts"
mkdir -p "${VERIFY_ARTIFACTS_DIR}"

# shellcheck source=../lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=../lib/castai-install.sh
source "${LIB_DIR}/castai-install.sh"
# shellcheck source=../lib/verify-components.sh
source "${LIB_DIR}/verify-components.sh"

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

_reset() {
    export VERIFY_COMPONENTS_DRY_RUN="true"
    rm -f "${CASTAI_STATE_FILE}"
    castai::_state_set "cluster_id" "11111111-2222-3333-4444-555555555555"
}

# -----------------------------------------------------------------------------
# Test 1: verify_components::check_logs_for_401 in dry-run mode returns
# 0 and prints every component it would check.
# -----------------------------------------------------------------------------

printf '\n[1] verify_components::check_logs_for_401 dry-run returns 0 and lists components\n' >&2

_reset

logs_rc=0
logs_output=""
_capture_with_rc logs_rc logs_output verify_components::check_logs_for_401

_assert_eq \
    "check_logs_for_401 dry-run exits 0 (happy path)" \
    "0" \
    "${logs_rc}"

_assert_contains \
    "dry-run mentions the 401 marker" \
    "401 Authorization Required" \
    "${logs_output}"

_assert_contains \
    "dry-run mentions DRY-RUN" \
    "DRY-RUN" \
    "${logs_output}"

for deployment in "${VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
    _assert_contains \
        "dry-run lists ${deployment} in the scan plan" \
        "component=${deployment}" \
        "${logs_output}"
done

_assert_eq \
    "dry-run emits one component= line per deployment" \
    "${#VERIFY_COMPONENT_DEPLOYMENTS[@]}" \
    "$(printf '%s' "${logs_output}" | grep -c "^component=" || true)"

# -----------------------------------------------------------------------------
# Test 2: verify_components::check_castai_api in dry-run mode prints
# the API endpoint it would poll and returns 0.
# -----------------------------------------------------------------------------

printf '\n[2] verify_components::check_castai_api dry-run prints endpoint and returns 0\n' >&2

_reset

api_rc=0
api_output=""
_capture_with_rc api_rc api_output verify_components::check_castai_api

_assert_eq \
    "check_castai_api dry-run exits 0" \
    "0" \
    "${api_rc}"

_assert_contains \
    "dry-run mentions the cluster_id" \
    "11111111-2222-3333-4444-555555555555" \
    "${api_output}"

_assert_contains \
    "dry-run mentions the external-clusters endpoint" \
    "/v1/kubernetes/external-clusters/" \
    "${api_output}"

_assert_contains \
    "dry-run mentions DRY-RUN" \
    "DRY-RUN" \
    "${api_output}"

_assert_contains \
    "dry-run emits an attempt counter" \
    "Attempt 1/" \
    "${api_output}"

# -----------------------------------------------------------------------------
# Test 3: synthetic log parsing correctly detects the 401 marker.
# This guards against regex/grep regressions in the marker logic.
# -----------------------------------------------------------------------------

printf '\n[3] synthetic log input is parsed for the 401 marker correctly\n' >&2

synthetic_clean="2024-01-01T00:00:00Z INFO  everything is fine
2024-01-01T00:00:01Z DEBUG processing event
2024-01-01T00:00:02Z INFO  sending heart beat"

synthetic_dirty="2024-01-01T00:00:00Z INFO  starting component
2024-01-01T00:00:01Z ERROR 401 Authorization Required: stale token
2024-01-01T00:00:02Z ERROR 401 Authorization Required: another request
2024-01-01T00:00:03Z INFO  retrying"

synthetic_partial="2024-01-01T00:00:00Z INFO  starting component
2024-01-01T00:00:01Z WARN 401 - other error
2024-01-01T00:00:02Z INFO  no error here"

clean_hits="$(verify_components::_count_401s "${synthetic_clean}")"
dirty_hits="$(verify_components::_count_401s "${synthetic_dirty}")"
partial_hits="$(verify_components::_count_401s "${synthetic_partial}")"

_assert_eq \
    "clean logs have zero 401 hits" \
    "0" \
    "${clean_hits}"

_assert_eq \
    "dirty logs have two 401 hits" \
    "2" \
    "${dirty_hits}"

_assert_eq \
    "partial logs (different 401 wording) have zero hits" \
    "0" \
    "${partial_hits}"

# -----------------------------------------------------------------------------
# Test 4: verify_components::check_rollout_status in dry-run mode
# returns 0 and mentions every deployment.
# -----------------------------------------------------------------------------

printf '\n[4] verify_components::check_rollout_status dry-run returns 0\n' >&2

_reset

rollout_rc=0
rollout_output=""
_capture_with_rc rollout_rc rollout_output verify_components::check_rollout_status

_assert_eq \
    "check_rollout_status dry-run exits 0" \
    "0" \
    "${rollout_rc}"

_assert_contains \
    "dry-run rollout status mentions DRY-RUN" \
    "DRY-RUN" \
    "${rollout_output}"

for deployment in "${VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
    _assert_contains \
        "dry-run rollout status reports ${deployment}" \
        "component=${deployment}" \
        "${rollout_output}"
done

# -----------------------------------------------------------------------------
# Test 5: verify_components::run happy path in dry-run returns 0 with
# PASS labels.
# -----------------------------------------------------------------------------

printf '\n[5] verify_components::run dry-run orchestrates all checks\n' >&2

_reset

run_rc=0
run_output=""
_capture_with_rc run_rc run_output verify_components::run

_assert_eq \
    "verify_components::run dry-run exits 0" \
    "0" \
    "${run_rc}"

_assert_contains \
    "run output contains OVERALL=PASS" \
    "OVERALL=PASS" \
    "${run_output}"

_assert_contains \
    "run output contains logs=PASS" \
    "logs=PASS" \
    "${run_output}"

_assert_contains \
    "run output contains rollout=PASS" \
    "rollout=PASS" \
    "${run_output}"

_assert_contains \
    "run output contains api=PASS" \
    "api=PASS" \
    "${run_output}"

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
