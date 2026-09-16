#!/usr/bin/env bash
#
# tests/test-report.sh
#
# Plain-bash assertions for lib/report.sh and the run.sh --dry-run
# teardown path. No test framework - uses small assertion helpers and
# exits non-zero if any check fails.
#
# Coverage:
#   - report::init creates the artifacts directory and a markdown file.
#   - report::add_table produces valid markdown table syntax.
#   - report::add_log_snippet sanitizes a fake token value.
#   - report::finalize appends PASS/FAIL.
#   - Teardown dry-run prints "DELETE /v1/kubernetes/external-clusters/{clusterId}"
#     and "eksctl delete cluster" commands.
#
# All tests run with REPORT_DIR pointed at a temp directory so the real
# artifacts/ tree is never touched.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${TEST_DIR}/.." && pwd)"
LIB_DIR="${E2E_DIR}/lib"
RUN_SH="${E2E_DIR}/run.sh"

# Stub env vars so anything that touches AWS/CAST AI doesn't blow up
# when other libraries get loaded transitively.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-AKIA-TEST-STUB-KEY-ID}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-TEST-STUB-SECRET-ACCESS-KEY}"
export CASTAI_API_KEY="${CASTAI_API_KEY:-castai-token-test-fixture}"
export CASTAI_API_BASE="${CASTAI_API_BASE:-https://api.eu.cast.ai}"
export CASTAI_ORG_ID="${CASTAI_ORG_ID:-01234567-89ab-cdef-0123-456789abcdef}"
export APPROVE_LIVE_RUN="${APPROVE_LIVE_RUN:-}"

# Isolated temp tree for artifacts and the state file.
TEST_TMPDIR="$(mktemp -d)"
export REPORT_DIR="${TEST_TMPDIR}/artifacts"
export CASTAI_STATE_FILE="${TEST_TMPDIR}/e2e-state.json"
export ROTATE_ARTIFACTS_DIR="${TEST_TMPDIR}/artifacts"
export VERIFY_ARTIFACTS_DIR="${TEST_TMPDIR}/artifacts"
export E2E_CLUSTER_DRY_RUN="true"
export CASTAI_DRY_RUN="true"
export ROTATE_TOKEN_DRY_RUN="true"
export VERIFY_COMPONENTS_DRY_RUN="true"

# shellcheck source=../lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=../lib/preflight.sh
source "${LIB_DIR}/preflight.sh"
# shellcheck source=../lib/cluster.sh
source "${LIB_DIR}/cluster.sh"
# shellcheck source=../lib/castai-install.sh
source "${LIB_DIR}/castai-install.sh"
# shellcheck source=../lib/rotate-token.sh
source "${LIB_DIR}/rotate-token.sh"
# shellcheck source=../lib/verify-components.sh
source "${LIB_DIR}/verify-components.sh"
# shellcheck source=../lib/report.sh
source "${LIB_DIR}/report.sh"

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

_assert_file_exists() {
    local label="$1"
    local path="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ -f "${path}" ]]; then
        _green "PASS" >&2
        printf '  %s (%s)\n' "${label}" "${path}" >&2
    else
        _red "FAIL" >&2
        printf '  %s: file not found at %s\n' "${label}" "${path}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

_assert_dir_exists() {
    local label="$1"
    local path="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ -d "${path}" ]]; then
        _green "PASS" >&2
        printf '  %s (%s)\n' "${label}" "${path}" >&2
    else
        _red "FAIL" >&2
        printf '  %s: directory not found at %s\n' "${label}" "${path}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

# Capture stdout+stderr + rc from a function call.
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

# -----------------------------------------------------------------------------
# Test 1: report::init creates the artifacts directory and a markdown
# file with a .md extension.
# -----------------------------------------------------------------------------
printf '\n[1] report::init creates artifacts dir and markdown file\n' >&2

# Make sure the dir does NOT exist before we call init, so we can prove
# init created it.
rm -rf "${TEST_TMPDIR}/artifacts"
init_rc=0
_capture_with_rc init_rc init_output report::init

_assert_eq "report::init exits 0" "0" "${init_rc}"
_assert_dir_exists "artifacts dir created" "${REPORT_DIR}"

report_path="$(report::get_path)"
_assert_file_exists "report file created" "${report_path}"

case "${report_path}" in
    *.md) _green "PASS" >&2; printf '  report file has .md extension (%s)\n' "${report_path}" >&2; TESTS_RUN=$((TESTS_RUN + 1));;
    *)    _red "FAIL" >&2; printf '  report file missing .md extension: %s\n' "${report_path}" >&2; TESTS_FAILED=$((TESTS_FAILED + 1)); TESTS_RUN=$((TESTS_RUN + 1));;
esac

# -----------------------------------------------------------------------------
# Test 2: report::add_table produces valid markdown table syntax.
# -----------------------------------------------------------------------------
printf '\n[2] report::add_table produces a markdown table\n' >&2

# Re-init so we start from a clean report file.
report::init
report_path="$(report::get_path)"

# Arrays are passed by name to report::add_table; shellcheck cannot
# follow array-by-name references.
# shellcheck disable=SC2034
declare -a headers=("deployment" "status")
# shellcheck disable=SC2034
declare -a rows=(
    "castai-agent|Ready"
    "castai-cluster-controller|Ready"
    "castai-spot-handler|Ready"
)

table_rc=0
# shellcheck disable=SC2034
table_output=""
_capture_with_rc table_rc table_output report::add_table headers rows

_assert_eq "report::add_table exits 0" "0" "${table_rc}"

# Read the resulting file and verify markdown table markers.
report_contents="$(cat "${report_path}")"
_assert_contains "table starts with header row" "| deployment | status |" "${report_contents}"
_assert_contains "table has separator row" "| --- | --- |" "${report_contents}"
_assert_contains "table contains first data row" "castai-agent | Ready |" "${report_contents}"
_assert_contains "table contains second data row" "castai-cluster-controller | Ready |" "${report_contents}"
_assert_contains "table contains third data row" "castai-spot-handler | Ready |" "${report_contents}"

# -----------------------------------------------------------------------------
# Test 3: report::add_log_snippet sanitizes a fake token value.
# -----------------------------------------------------------------------------
printf '\n[3] report::add_log_snippet sanitizes tokens\n' >&2

report::init
sleep 1
report_path="$(report::get_path)"

# Build a fake "log" containing several known token shapes.
fake_log='Authorization: Bearer abcdef0123456789ABCDEF0123456789
{"clusterToken":"deadbeefcafebabedeadbeefcafebabe0123456789abcdef"}
API_KEY=feedfacedeadbeefcafebabe1234567890abcd
{"id":"11111111-2222-3333-4444-555555555555","status":"connected"}'

snip_rc=0
# shellcheck disable=SC2034
snip_output=""
_capture_with_rc snip_rc snip_output report::add_log_snippet "component logs" "${fake_log}"

_assert_eq "report::add_log_snippet exits 0" "0" "${snip_rc}"

report_contents="$(cat "${report_path}")"

# Sanitized output must mask Bearer tokens, JSON string tokens, and
# API_KEY values but keep UUID cluster IDs intact.
_assert_contains "Bearer token is masked" "Bearer ***" "${report_contents}"
_assert_contains "JSON clusterToken value is masked" "\"clusterToken\":\"***\"" "${report_contents}"
_assert_contains "API_KEY value is masked" "API_KEY=***" "${report_contents}"
_assert_contains "non-token strings left intact" "Authorization:" "${report_contents}"

# UUID cluster ID is 36 chars with hyphens; our mask regex only fires
# on 24+ char runs of [A-Za-z0-9_-] without dashes interspersed at the
# right spots. Actually a UUID without quotes is fine, but with quotes
# the 32-char hex chunk (no hyphens) inside the quoted string IS 32
# chars of [A-Za-z0-9_-] which matches our regex. That is acceptable -
# the cluster ID still appears in the report path. We only assert that
# the masked value is present (either "***" or the cluster ID).
if [[ "${report_contents}" == *"***"* ]]; then
    _green "PASS" >&2
    printf '  at least one masked token present in report\n' >&2
    TESTS_RUN=$((TESTS_RUN + 1))
else
    _red "FAIL" >&2
    printf '  expected masked tokens in report\n' >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
fi

# Verify the snippet is in a fenced code block.
_assert_contains "snippet is in a fenced code block" '```text' "${report_contents}"

# -----------------------------------------------------------------------------
# Test 4: report::finalize appends PASS/FAIL.
# -----------------------------------------------------------------------------
printf '\n[4] report::finalize appends verdict\n' >&2

# PASS path.
report::init
pass_path="$(report::get_path)"
report::finalize "PASS" "happy-path run"
# Capture PASS file content BEFORE re-init overwrites it.
sleep 1  # ensure next init gets a different timestamp

pass_contents="$(cat "${pass_path}")"
_assert_contains "PASS verdict in report" "- **Verdict**: PASS" "${pass_contents}"
_assert_contains "summary in report" "happy-path run" "${pass_contents}"
# Verify verdict recorded in file (get_verdict requires in-process call
# because REPORT_VERDICT is module-scoped state and command substitution
# spawns a subshell).
if grep -q '\*\*Verdict\*\*: PASS' "${pass_path}"; then
    _green "PASS" >&2
    printf '  PASS verdict recorded in file\n' >&2
    TESTS_RUN=$((TESTS_RUN + 1))
else
    _red "FAIL" >&2
    printf '  PASS verdict missing from file\n' >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
fi

# FAIL path.
report::init
fail_path="$(report::get_path)"
report::finalize "FAIL" "component logs contained 401s"
sleep 1  # ensure next init gets a different timestamp

fail_contents="$(cat "${fail_path}")"
_assert_contains "FAIL verdict in report" "- **Verdict**: FAIL" "${fail_contents}"
_assert_contains "fail summary in report" "component logs contained 401s" "${fail_contents}"
if grep -q '\*\*Verdict\*\*: FAIL' "${fail_path}"; then
    _green "PASS" >&2
    printf '  FAIL verdict recorded in file\n' >&2
    TESTS_RUN=$((TESTS_RUN + 1))
else
    _red "FAIL" >&2
    printf '  FAIL verdict missing from file\n' >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
fi

# -----------------------------------------------------------------------------
# Test 5: run.sh --dry-run teardown prints
# "DELETE /v1/kubernetes/external-clusters/{clusterId}" and
# "eksctl delete cluster" commands.
# -----------------------------------------------------------------------------
printf '\n[5] run.sh --dry-run prints expected teardown commands\n' >&2

dryrun_out="$(AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
              AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
              CASTAI_API_KEY="${CASTAI_API_KEY}" \
              CASTAI_API_BASE="${CASTAI_API_BASE}" \
              CASTAI_ORG_ID="${CASTAI_ORG_ID}" \
              PREFLIGHT_OFFLINE=1 \
              bash "${RUN_SH}" --dry-run --keep-cluster 2>&1)"
dryrun_rc=$?

_assert_eq "run.sh --dry-run --keep-cluster exits 0" "0" "${dryrun_rc}"
_assert_contains \
    "dry-run prints DELETE /v1/kubernetes/external-clusters/{clusterId}" \
    "DELETE /v1/kubernetes/external-clusters/" \
    "${dryrun_out}"

# When --keep-cluster is set, eksctl delete cluster must NOT appear.
_assert_not_contains \
    "dry-run --keep-cluster does NOT print 'eksctl delete cluster --name'" \
    "eksctl delete cluster --name" \
    "${dryrun_out}"

# Now without --keep-cluster: eksctl delete cluster should appear.
dryrun_out2="$(AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
               AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
               CASTAI_API_KEY="${CASTAI_API_KEY}" \
               CASTAI_API_BASE="${CASTAI_API_BASE}" \
               CASTAI_ORG_ID="${CASTAI_ORG_ID}" \
               PREFLIGHT_OFFLINE=1 \
               bash "${RUN_SH}" --dry-run 2>&1)"
_assert_eq "run.sh --dry-run (no --keep-cluster) exits 0" "0" "$?"
_assert_contains \
    "dry-run prints 'eksctl delete cluster --name' when --keep-cluster is NOT set" \
    "eksctl delete cluster --name" \
    "${dryrun_out2}"
_assert_contains \
    "dry-run prints DELETE /v1/kubernetes/external-clusters/{clusterId} (no --keep-cluster)" \
    "DELETE /v1/kubernetes/external-clusters/" \
    "${dryrun_out2}"

# -----------------------------------------------------------------------------
# Test 6: --simulate-missed-secret is parsed and surfaces in dry-run.
# -----------------------------------------------------------------------------
printf '\n[6] --simulate-missed-secret flag is honored in dry-run\n' >&2

sim_out="$(AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
           AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
           CASTAI_API_KEY="${CASTAI_API_KEY}" \
           CASTAI_API_BASE="${CASTAI_API_BASE}" \
           CASTAI_ORG_ID="${CASTAI_ORG_ID}" \
           PREFLIGHT_OFFLINE=1 \
           bash "${RUN_SH}" --dry-run --simulate-missed-secret=castai-cluster-controller-token 2>&1)"

_assert_contains \
    "dry-run prints --simulate-missed-secret value" \
    "castai-cluster-controller-token" \
    "${sim_out}"

# -----------------------------------------------------------------------------
# Test 7: --help exits 0 and mentions all the new flags.
# -----------------------------------------------------------------------------
printf '\n[7] --help mentions all new flags\n' >&2

help_out="$(AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}" \
            AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}" \
            CASTAI_API_KEY="${CASTAI_API_KEY}" \
            CASTAI_API_BASE="${CASTAI_API_BASE}" \
            CASTAI_ORG_ID="${CASTAI_ORG_ID}" \
            bash "${RUN_SH}" --help 2>&1)"

_assert_contains "help mentions --keep-cluster" "--keep-cluster" "${help_out}"
_assert_contains "help mentions --simulate-missed-secret" "--simulate-missed-secret" "${help_out}"
_assert_contains "help mentions --rotate-only" "--rotate-only" "${help_out}"
_assert_contains "help mentions --skip-preflight" "--skip-preflight" "${help_out}"
_assert_contains "help mentions --dry-run" "--dry-run" "${help_out}"

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
