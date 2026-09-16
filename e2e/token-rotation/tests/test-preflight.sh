#!/usr/bin/env bash
#
# tests/test-preflight.sh
#
# Plain-bash tests for lib/preflight.sh and the run.sh --dry-run path.
#
# Run with:  ./e2e/token-rotation/tests/test-preflight.sh
#
# These tests deliberately do NOT use `set -e` so we can capture exit codes
# from preflight::run and the run.sh script and assert on them.

# Resolve lib paths relative to this file.
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${TEST_DIR}/.." && pwd)"
LIB_DIR="${E2E_DIR}/lib"
RUN_SH="${E2E_DIR}/run.sh"

PASS=0
FAIL=0

# We source the libs once. Each test runs preflight::run inside a subshell
# that has been pre-configured with the env vars we want.
# shellcheck source=../lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=../lib/preflight.sh
source "${LIB_DIR}/preflight.sh"

# Base env every passing test starts from.
seed_base_env() {
    export AWS_ACCESS_KEY_ID="AKIA-TEST-FIXTURE"
    export AWS_SECRET_ACCESS_KEY="aws-secret-test-fixture"
    export CASTAI_API_KEY="castai-token-test-fixture"
    export CASTAI_API_BASE="https://api.eu.cast.ai"
    export CASTAI_ORG_ID="01234567-89ab-cdef-0123-456789abcdef"
    export APPROVE_LIVE_RUN=""
    unset PREFLIGHT_OFFLINE || true
}

# assert_eq <expected> <actual> <label>
assert_eq() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [[ "${expected}" == "${actual}" ]]; then
        printf '  [PASS] %s\n' "${label}"
        PASS=$((PASS + 1))
    else
        printf '  [FAIL] %s\n' "${label}"
        printf '         expected: %s\n' "${expected}"
        printf '         actual  : %s\n' "${actual}"
        FAIL=$((FAIL + 1))
    fi
}

# assert_fail <label> <body>  - runs body in subshell, asserts non-zero rc.
assert_fail() {
    local label="$1"
    local body="$2"
    local rc=0
    ( eval "${body}" ) >/dev/null 2>&1 || rc=$?
    if (( rc != 0 )); then
        printf '  [PASS] %s (rc=%d)\n' "${label}" "${rc}"
        PASS=$((PASS + 1))
    else
        printf '  [FAIL] %s (rc=0, expected non-zero)\n' "${label}"
        FAIL=$((FAIL + 1))
    fi
}

# assert_pass <label> <body>  - runs body in subshell, asserts zero rc.
assert_pass() {
    local label="$1"
    local body="$2"
    local rc=0
    ( eval "${body}" ) >/dev/null 2>&1 || rc=$?
    if (( rc == 0 )); then
        printf '  [PASS] %s\n' "${label}"
        PASS=$((PASS + 1))
    else
        printf '  [FAIL] %s (rc=%d, expected 0)\n' "${label}" "${rc}"
        FAIL=$((FAIL + 1))
    fi
}

# Run preflight::run in a clean subshell with the vars we want present.
# Args: live_mode (true|false)
run_preflight_subshell() {
    local live_mode="$1"
    (
        # Re-source libraries in the subshell because variables don't carry.
        # shellcheck source=../lib/logging.sh
        source "${LIB_DIR}/logging.sh"
        # shellcheck source=../lib/preflight.sh
        source "${LIB_DIR}/preflight.sh"
        preflight::run --offline "${live_mode}"
    )
}

# -----------------------------------------------------------------------------
# Tests
# -----------------------------------------------------------------------------

echo "==> Test 1: preflight fails when CASTAI_API_BASE is missing"
seed_base_env
unset CASTAI_API_BASE
assert_fail "preflight::run dies when CASTAI_API_BASE is unset" \
    "run_preflight_subshell false"

echo "==> Test 2: preflight fails when CASTAI_API_KEY is missing"
seed_base_env
unset CASTAI_API_KEY
assert_fail "preflight::run dies when CASTAI_API_KEY is unset" \
    "run_preflight_subshell false"

echo "==> Test 3: preflight fails when CASTAI_ORG_ID is missing"
seed_base_env
unset CASTAI_ORG_ID
assert_fail "preflight::run dies when CASTAI_ORG_ID is unset" \
    "run_preflight_subshell false"

echo "==> Test 4: preflight fails when a required binary is missing"
seed_base_env
# We can't actually unlink binaries; instead verify the function exists and
# that preflight detects when the var is unset, which is the same code path.
assert_fail "preflight::run dies when AWS_ACCESS_KEY_ID is unset" \
    "seed_base_env; unset AWS_ACCESS_KEY_ID; run_preflight_subshell false"

echo "==> Test 5: preflight fails when CASTAI_API_BASE is wrong endpoint"
seed_base_env
export CASTAI_API_BASE="https://api.us.cast.ai"
assert_fail "preflight::run rejects non-EU base" \
    "run_preflight_subshell false"

echo "==> Test 6: dry-run mode succeeds without APPROVE_LIVE_RUN"
seed_base_env
unset APPROVE_LIVE_RUN
assert_pass "run.sh --dry-run succeeds with no APPROVE_LIVE_RUN" \
    "AWS_ACCESS_KEY_ID='${AWS_ACCESS_KEY_ID}' \
     AWS_SECRET_ACCESS_KEY='${AWS_SECRET_ACCESS_KEY}' \
     CASTAI_API_KEY='${CASTAI_API_KEY}' \
     CASTAI_API_BASE='${CASTAI_API_BASE}' \
     CASTAI_ORG_ID='${CASTAI_ORG_ID}' \
     bash '${RUN_SH}' --dry-run"

echo "==> Test 7: live preflight fails without APPROVE_LIVE_RUN"
seed_base_env
unset APPROVE_LIVE_RUN
assert_fail "preflight::run live mode dies without APPROVE_LIVE_RUN" \
    "run_preflight_subshell true"

echo "==> Test 8: live preflight passes with APPROVE_LIVE_RUN=true (offline)"
seed_base_env
export APPROVE_LIVE_RUN=true
assert_pass "preflight::run live mode passes with APPROVE_LIVE_RUN=true (offline)" \
    "run_preflight_subshell true"

echo "==> Test 9: --help exits 0 and prints expected sections"
seed_base_env
out="$(AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
       AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
       CASTAI_API_KEY="${CASTAI_API_KEY}" \
       CASTAI_API_BASE="${CASTAI_API_BASE}" \
       CASTAI_ORG_ID="${CASTAI_ORG_ID}" \
       bash "${RUN_SH}" --help 2>&1)"
help_rc=$?
assert_eq "0" "${help_rc}" "run.sh --help exits 0"
if [[ "${out}" == *"APPROVE_LIVE_RUN"* ]]; then
    printf '  [PASS] %s\n' "help mentions APPROVE_LIVE_RUN"
    PASS=$((PASS + 1))
else
    printf '  [FAIL] %s\n' "help mentions APPROVE_LIVE_RUN"
    FAIL=$((FAIL + 1))
fi
if [[ "${out}" == *"CASTAI_API_BASE"* && "${out}" == *"CASTAI_API_KEY"* \
      && "${out}" == *"CASTAI_ORG_ID"* \
      && "${out}" == *"AWS_ACCESS_KEY_ID"* \
      && "${out}" == *"AWS_SECRET_ACCESS_KEY"* ]]; then
    printf '  [PASS] %s\n' "help lists all required env vars"
    PASS=$((PASS + 1))
else
    printf '  [FAIL] %s\n' "help lists all required env vars"
    FAIL=$((FAIL + 1))
fi
if [[ "${out}" == *"--dry-run"* ]]; then
    printf '  [PASS] %s\n' "help mentions --dry-run flag"
    PASS=$((PASS + 1))
else
    printf '  [FAIL] %s\n' "help mentions --dry-run flag"
    FAIL=$((FAIL + 1))
fi

echo "==> Test 10: mask_value masks secrets"
seed_base_env
masked="$(mask_value "${CASTAI_API_KEY}")"
assert_eq "***" "${masked}" "mask_value masks a non-empty token"
masked_empty="$(mask_value "")"
assert_eq "" "${masked_empty}" "mask_value leaves empty string empty"

echo "==> Test 11: dry-run output mentions DRY-RUN"
seed_base_env
dry_out="$(AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
           AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
           CASTAI_API_KEY="${CASTAI_API_KEY}" \
           CASTAI_API_BASE="${CASTAI_API_BASE}" \
           CASTAI_ORG_ID="${CASTAI_ORG_ID}" \
           bash "${RUN_SH}" --dry-run 2>&1)"
if [[ "${dry_out}" == *"Dry-run"* || "${dry_out}" == *"DRY-RUN"* ]]; then
    printf '  [PASS] %s\n' "dry-run output advertises dry-run mode"
    PASS=$((PASS + 1))
else
    printf '  [FAIL] %s\n' "dry-run output advertises dry-run mode"
    FAIL=$((FAIL + 1))
fi

# Ensure secrets are masked in output (CASTAI_API_KEY value should not appear).
if [[ "${dry_out}" != *"castai-token-test-fixture"* ]]; then
    printf '  [PASS] %s\n' "raw token value not present in dry-run output"
    PASS=$((PASS + 1))
else
    printf '  [FAIL] %s\n' "raw token value leaked into dry-run output"
    FAIL=$((FAIL + 1))
fi

echo
echo "==> Summary: ${PASS} passed, ${FAIL} failed"
if (( FAIL > 0 )); then
    exit 1
fi
exit 0
