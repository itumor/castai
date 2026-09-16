#!/usr/bin/env bash
#
# tests/test-cluster.sh
#
# Plain bash assertions for lib/cluster.sh. No test framework — uses a tiny
# assert helper and exits non-zero on the first failure.
#
# Coverage:
#   - cluster::stop refuses to delete a cluster named "production-cluster".
#   - cluster::stop accepts a cluster named "16926-castai-token-rotation-e2e".
#   - Dry-run mode prints "eksctl create cluster" and "eksctl delete cluster"
#     commands without executing any AWS calls.
#   - configs/e2e-token-rotation.yaml is valid YAML and contains the
#     expected cluster name and region.
#
# The tests run in a fully offline mode: AWS creds are stubbed and
# E2E_CLUSTER_DRY_RUN is set to "true" so no AWS / EKS calls happen.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LIB_DIR="${E2E_DIR}/lib"

# Stub AWS credentials so cluster::load_credentials is happy.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-AKIA-TEST-STUB-KEY-ID}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-TEST-STUB-SECRET-ACCESS-KEY}"
export E2E_CLUSTER_DRY_RUN="true"

# shellcheck source=lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=lib/cluster.sh
source "${LIB_DIR}/cluster.sh"

TESTS_RUN=0
TESTS_FAILED=0

# ---------------------------------------------------------------------------
# Tiny assertion helpers.
# ---------------------------------------------------------------------------

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

_assert_command_succeeds() {
    local label="$1"
    shift
    TESTS_RUN=$((TESTS_RUN + 1))
    if "$@" >/dev/null 2>&1; then
        _green "PASS" >&2
        printf '  %s\n' "${label}" >&2
    else
        local rc=$?
        _red "FAIL" >&2
        printf '  %s (rc=%d)\n' "${label}" "${rc}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
}

_assert_command_fails() {
    local label="$1"
    shift
    TESTS_RUN=$((TESTS_RUN + 1))
    if "$@" >/dev/null 2>&1; then
        _red "FAIL" >&2
        printf '  %s (expected non-zero exit, got 0)\n' "${label}" >&2
        TESTS_FAILED=$((TESTS_FAILED + 1))
    else
        _green "PASS" >&2
        printf '  %s\n' "${label}" >&2
    fi
}

# Run a command and capture stdout+stderr into a temp file, plus the exit
# code in a side variable. We avoid `$()` command substitution because it
# runs the function in a subshell, so side-variable assignments made by
# `printf -v` would not propagate to the caller.
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

# ---------------------------------------------------------------------------
# Test 1: cluster::stop refuses to delete a cluster that lacks the prefix.
# ---------------------------------------------------------------------------

printf '\n[1] cluster::stop refuses production-cluster\n' >&2

stop_rc=0
stop_output=""
_capture_with_rc stop_rc stop_output cluster::stop production-cluster eu-central-1

_assert_not_eq \
    "cluster::stop exits non-zero on unsafe name" \
    "0" \
    "${stop_rc}"

_assert_contains \
    "rejects 'production-cluster' with a safety message" \
    "Refusing to operate on cluster 'production-cluster'" \
    "${stop_output}"

_assert_contains \
    "safety message mentions the E2E prefix" \
    "16926-castai-token-rotation-" \
    "${stop_output}"

# Direct exercise of the safety guard so a regression is caught even if
# cluster::stop is restructured later.
_assert_command_fails \
    "cluster::assert_safe_name rejects 'production-cluster'" \
    cluster::assert_safe_name production-cluster

_assert_command_succeeds \
    "cluster::assert_safe_name accepts '16926-castai-token-rotation-e2e'" \
    cluster::assert_safe_name 16926-castai-token-rotation-e2e

_assert_command_succeeds \
    "cluster::assert_safe_name accepts '16926-castai-token-rotation-foo-bar'" \
    cluster::assert_safe_name 16926-castai-token-rotation-foo-bar

_assert_command_fails \
    "cluster::assert_safe_name rejects empty name" \
    cluster::assert_safe_name ""

# ---------------------------------------------------------------------------
# Test 2: cluster::stop accepts the canonical E2E cluster name.
#
# With E2E_CLUSTER_DRY_RUN=true the function never calls AWS, so we just
# verify it exits 0 and emits the expected dry-run lines.
# ---------------------------------------------------------------------------

printf '\n[2] cluster::stop accepts 16926-castai-token-rotation-e2e in dry-run\n' >&2

E2E_CLUSTER_DRY_RUN=true
stop2_rc=0
stop2_output=""
_capture_with_rc stop2_rc stop2_output cluster::stop 16926-castai-token-rotation-e2e eu-central-1

_assert_eq \
    "cluster::stop exits 0 in dry-run" \
    "0" \
    "${stop2_rc}"

_assert_contains \
    "dry-run prints 'eksctl delete cluster' for the E2E cluster" \
    "eksctl delete cluster --name 16926-castai-token-rotation-e2e --region eu-central-1" \
    "${stop2_output}"

_assert_contains \
    "dry-run completes without errors" \
    "Dry-run: cluster '16926-castai-token-rotation-e2e' stop sequence complete" \
    "${stop2_output}"

_assert_contains \
    "dry-run cleanup prints 'kubectl config delete-context'" \
    "kubectl config delete-context 16926-castai-token-rotation-e2e" \
    "${stop2_output}"

_assert_not_contains \
    "no live 'eksctl get cluster' result is printed" \
    "EKS cluster" \
    "${stop2_output}"

# ---------------------------------------------------------------------------
# Test 3: dry-run mode prints eksctl create cluster without executing it.
# ---------------------------------------------------------------------------

printf '\n[3] cluster::start dry-run prints create command\n' >&2

E2E_CLUSTER_DRY_RUN=true
start_rc=0
start_output=""
_capture_with_rc start_rc start_output cluster::start 16926-castai-token-rotation-e2e eu-central-1

_assert_eq \
    "cluster::start exits 0 in dry-run" \
    "0" \
    "${start_rc}"

_assert_contains \
    "dry-run prints 'eksctl create cluster'" \
    "eksctl create cluster -f ${E2E_CLUSTER_CONFIG}" \
    "${start_output}"

_assert_contains \
    "dry-run prints the kubeconfig write step" \
    "eksctl utils write-kubeconfig --cluster=16926-castai-token-rotation-e2e --region=eu-central-1" \
    "${start_output}"

_assert_contains \
    "dry-run emits the dry-run completion marker" \
    "Dry-run: cluster '16926-castai-token-rotation-e2e' creation skipped" \
    "${start_output}"

_assert_not_contains \
    "no live readiness message is printed in dry-run" \
    "Cluster '16926-castai-token-rotation-e2e' is ready" \
    "${start_output}"

# ---------------------------------------------------------------------------
# Test 4: configs/e2e-token-rotation.yaml is valid YAML with the right
# cluster name and region.
# ---------------------------------------------------------------------------

printf '\n[4] configs/e2e-token-rotation.yaml is valid and correct\n' >&2

CONFIG_FILE="${E2E_DIR}/configs/e2e-token-rotation.yaml"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -f "${CONFIG_FILE}" ]]; then
    _green "PASS" >&2
    printf '  config file exists: %s\n' "${CONFIG_FILE}" >&2
else
    _red "FAIL" >&2
    printf '  config file missing: %s\n' "${CONFIG_FILE}" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if ! python3 -c 'import yaml' >/dev/null 2>&1; then
    _red "FAIL" >&2
    printf '  python3 yaml module is required for YAML validation\n' >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
else
    parsed="$(python3 - "${CONFIG_FILE}" <<'PY'
import sys
import yaml
with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)
metadata = doc.get("metadata", {})
print("name=" + str(metadata.get("name", "")))
print("region=" + str(metadata.get("region", "")))
print("version=" + str(metadata.get("version", "")))
print("apiVersion=" + str(doc.get("apiVersion", "")))
print("kind=" + str(doc.get("kind", "")))
mngs = doc.get("managedNodeGroups", [])
if mngs:
    ng = mngs[0]
    print("ng.name=" + str(ng.get("name", "")))
    print("ng.instanceType=" + str(ng.get("instanceType", "")))
    print("ng.amiFamily=" + str(ng.get("amiFamily", "")))
    print("ng.minSize=" + str(ng.get("minSize", "")))
    print("ng.desiredCapacity=" + str(ng.get("desiredCapacity", "")))
    print("ng.maxSize=" + str(ng.get("maxSize", "")))
    print("ng.volumeSize=" + str(ng.get("volumeSize", "")))
iam = doc.get("iam", {})
print("iam.withOIDC=" + str(iam.get("withOIDC", False)))
print("karpenter=" + str(doc.get("karpenter") is not None))
PY
)"
    _assert_contains \
        "apiVersion is eksctl.io/v1alpha5" \
        "apiVersion=eksctl.io/v1alpha5" \
        "${parsed}"
    _assert_contains \
        "kind is ClusterConfig" \
        "kind=ClusterConfig" \
        "${parsed}"
    _assert_contains \
        "metadata.name is 16926-castai-token-rotation-e2e" \
        "name=16926-castai-token-rotation-e2e" \
        "${parsed}"
    _assert_contains \
        "metadata.region is eu-central-1" \
        "region=eu-central-1" \
        "${parsed}"
    _assert_contains \
        "metadata.version is 1.36" \
        "version=1.36" \
        "${parsed}"
    _assert_contains \
        "nodegroup name is system-ng" \
        "ng.name=system-ng" \
        "${parsed}"
    _assert_contains \
        "nodegroup instance type is t3.xlarge" \
        "ng.instanceType=t3.xlarge" \
        "${parsed}"
    _assert_contains \
        "nodegroup AMI family is AmazonLinux2023" \
        "ng.amiFamily=AmazonLinux2023" \
        "${parsed}"
    _assert_contains \
        "nodegroup minSize is 2" \
        "ng.minSize=2" \
        "${parsed}"
    _assert_contains \
        "nodegroup desiredCapacity is 2" \
        "ng.desiredCapacity=2" \
        "${parsed}"
    _assert_contains \
        "nodegroup maxSize is 4" \
        "ng.maxSize=4" \
        "${parsed}"
    _assert_contains \
        "nodegroup volumeSize is 30" \
        "ng.volumeSize=30" \
        "${parsed}"
    _assert_contains \
        "iam.withOIDC is True" \
        "iam.withOIDC=True" \
        "${parsed}"
    _assert_contains \
        "karpenter section is absent" \
        "karpenter=False" \
        "${parsed}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

printf '\n' >&2
if (( TESTS_FAILED == 0 )); then
    _green "All ${TESTS_RUN} assertions passed." >&2
    exit 0
fi
_red "${TESTS_FAILED} of ${TESTS_RUN} assertions failed." >&2
exit 1
