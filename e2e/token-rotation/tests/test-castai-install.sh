#!/usr/bin/env bash
#
# tests/test-castai-install.sh
#
# Plain-bash assertions for lib/castai-install.sh.
#
# Coverage:
#   - castai::register_cluster returns a fake cluster ID and token in
#     dry-run mode without touching the network.
#   - castai::create_secrets prints `kubectl create secret` commands for
#     all five per-component secrets in dry-run mode.
#   - castai::install_chart prints `helm upgrade --install` in dry-run
#     mode with the expected chart and values file.
#   - The values file contains all five expected apiKeySecretRef
#     references.
#   - The chart-version file contains a non-empty semantic version.
#
# Run with:  ./e2e/token-rotation/tests/test-castai-install.sh
#
# The tests never hit the CAST AI API or Kubernetes. Dry-run mode keeps
# the harness fully offline so the suite is safe to run inside CI.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${TEST_DIR}/.." && pwd)"
LIB_DIR="${E2E_DIR}/lib"
CONFIGS_DIR="${E2E_DIR}/configs"

# Required env for castai::_require_live_approval / castai::_api_call when
# not in dry-run. In dry-run none of these are actually read.
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-AKIA-TEST-STUB-KEY-ID}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-TEST-STUB-SECRET-ACCESS-KEY}"
export CASTAI_API_KEY="${CASTAI_API_KEY:-castai-token-test-fixture}"
export CASTAI_API_BASE="${CASTAI_API_BASE:-https://api.eu.cast.ai}"
export CASTAI_ORG_ID="${CASTAI_ORG_ID:-01234567-89ab-cdef-0123-456789abcdef}"
export APPROVE_LIVE_RUN="${APPROVE_LIVE_RUN:-}"

# shellcheck source=../lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=../lib/castai-install.sh
source "${LIB_DIR}/castai-install.sh"

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

# Reset dry-run state and ensure the artifacts/state file is fresh for
# each test that uses it.
_reset_castai_state() {
    CASTAI_DRY_RUN="true"
    # In-memory token reset.
    CASTAI_CURRENT_TOKEN=""
    # Remove the state file so register_cluster starts clean.
    rm -f "${CASTAI_STATE_FILE}"
}

# -----------------------------------------------------------------------------
# Test 1: castai::register_cluster in dry-run mode returns a fake cluster ID
# and token without making network calls.
# -----------------------------------------------------------------------------

printf '\n[1] castai::register_cluster dry-run produces fake IDs and tokens\n' >&2

_reset_castai_state
reg_rc=0
reg_output=""
_capture_with_rc reg_rc reg_output castai::register_cluster \
    "16926-castai-token-rotation-e2e" "eu-central-1" "111122223333"

_assert_eq \
    "castai::register_cluster dry-run exits 0" \
    "0" \
    "${reg_rc}"

_assert_contains \
    "stdout contains CLUSTER_ID marker" \
    "CLUSTER_ID=" \
    "${reg_output}"

_assert_contains \
    "stdout contains INITIAL_TOKEN marker" \
    "INITIAL_TOKEN=" \
    "${reg_output}"

_assert_not_contains \
    "stdout does not leak the real CAST AI token value" \
    "castai-token-test-fixture" \
    "${reg_output}"

_assert_contains \
    "log output mentions POST /v1/kubernetes/external-clusters" \
    "POST /v1/kubernetes/external-clusters" \
    "${reg_output}"

_assert_contains \
    "log output is dry-run" \
    "DRY-RUN" \
    "${reg_output}"

# Extract the captured cluster ID and verify it was persisted to state.
captured_id="$(printf '%s' "${reg_output}" | sed -n 's/^CLUSTER_ID=//p' | head -n1)"
captured_token="$(printf '%s' "${reg_output}" | sed -n 's/^INITIAL_TOKEN=//p' | head -n1)"
_assert_eq \
    "captured cluster ID matches state file cluster_id" \
    "${captured_id}" \
    "$(castai::_state_get cluster_id)"

_assert_eq \
    "captured initial token is held in CASTAI_CURRENT_TOKEN" \
    "${captured_token}" \
    "${CASTAI_CURRENT_TOKEN:-}"

# -----------------------------------------------------------------------------
# Test 2: castai::create_secrets prints kubectl create secret commands for
# all five per-component secrets in dry-run mode.
# -----------------------------------------------------------------------------

printf '\n[2] castai::create_secrets dry-run prints five kubectl create commands\n' >&2

_reset_castai_state
secrets_rc=0
secrets_output=""
_capture_with_rc secrets_rc secrets_output castai::create_secrets "test-token-value"

_assert_eq \
    "castai::create_secrets dry-run exits 0" \
    "0" \
    "${secrets_rc}"

for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
    _assert_contains \
        "dry-run prints kubectl create secret for ${secret}" \
        "kubectl create secret generic ${secret} --namespace=${CASTAI_NAMESPACE}" \
        "${secrets_output}"
done

_assert_contains \
    "dry-run advertises DRY-RUN" \
    "DRY-RUN" \
    "${secrets_output}"

_assert_eq \
    "dry-run emits exactly one line per secret plus a namespace line" \
    "${#CASTAI_PER_COMPONENT_SECRETS[@]}" \
    "$(printf '%s' "${secrets_output}" | grep -c "kubectl create secret generic")"

# -----------------------------------------------------------------------------
# Test 3: castai::install_chart in dry-run prints helm upgrade --install
# with the expected chart, version file content, and values file.
# -----------------------------------------------------------------------------

printf '\n[3] castai::install_chart dry-run prints helm upgrade --install\n' >&2

_reset_castai_state
chart_version="$(castai::_chart_version)"
install_rc=0
install_output=""
_capture_with_rc install_rc install_output castai::install_chart

_assert_eq \
    "castai::install_chart dry-run exits 0" \
    "0" \
    "${install_rc}"

_assert_contains \
    "dry-run prints helm repo add" \
    "helm repo add ${CASTAI_HELM_REPO_NAME}" \
    "${install_output}"

_assert_contains \
    "dry-run prints helm repo update" \
    "helm repo update ${CASTAI_HELM_REPO_NAME}" \
    "${install_output}"

_assert_contains \
    "dry-run prints helm upgrade --install command" \
    "helm upgrade --install ${CASTAI_RELEASE_NAME} ${CASTAI_CHART}" \
    "${install_output}"

_assert_contains \
    "dry-run pins the chart version from castai-chart-version.txt" \
    "--version ${chart_version}" \
    "${install_output}"

_assert_contains \
    "dry-run references the values file" \
    "--values ${CASTAI_VALUES_FILE}" \
    "${install_output}"

_assert_contains \
    "dry-run uses the castai-agent namespace" \
    "--namespace ${CASTAI_NAMESPACE}" \
    "${install_output}"

_assert_contains \
    "dry-run creates the namespace if missing" \
    "--create-namespace" \
    "${install_output}"

# -----------------------------------------------------------------------------
# Test 4: configs/castai-full-values.yaml is valid YAML and references all
# five expected secrets.
# -----------------------------------------------------------------------------

printf '\n[4] configs/castai-full-values.yaml is valid and references all secrets\n' >&2

VALUES_FILE="${CONFIGS_DIR}/castai-full-values.yaml"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -f "${VALUES_FILE}" ]]; then
    _green "PASS" >&2
    printf '  values file exists: %s\n' "${VALUES_FILE}" >&2
else
    _red "FAIL" >&2
    printf '  values file missing: %s\n' "${VALUES_FILE}" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

if ! python3 -c 'import yaml' >/dev/null 2>&1; then
    _red "FAIL" >&2
    printf '  python3 yaml module is required for YAML validation\n' >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
else
    parsed="$(python3 - "${VALUES_FILE}" <<'PY'
import sys, yaml
with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f)
global_castai = (doc.get("global") or {}).get("castai") or {}
print("global.castai.apiKeySecretRef=" + str(global_castai.get("apiKeySecretRef", "")))
print("global.castai.apiURL=" + str(global_castai.get("apiURL", "")))
print("global.castai.provider=" + str(global_castai.get("provider", "")))
tags = doc.get("tags") or {}
print("tags.full=" + str(tags.get("full", "")))
print("tags.readonly=" + str(tags.get("readonly", "")))
print("tags.node-autoscaler=" + str(tags.get("node-autoscaler", "")))
print("tags.workload-autoscaler=" + str(tags.get("workload-autoscaler", "")))
auto = doc.get("autoscaler") or {}
# Installed components: agent (top-level apiKeySecretRef) and
# cluster-controller (under .castai.apiKeySecretRef).
print("autoscaler.castai-agent.enabled=" + str(((auto.get("castai-agent") or {}).get("enabled", ""))))
print("autoscaler.castai-agent.apiKeySecretRef=" + str(((auto.get("castai-agent") or {}).get("apiKeySecretRef", ""))))
print("autoscaler.castai-cluster-controller.enabled=" + str(((auto.get("castai-cluster-controller") or {}).get("enabled", ""))))
print("autoscaler.castai-cluster-controller.replicas=" + str(((auto.get("castai-cluster-controller") or {}).get("replicas", ""))))
print("autoscaler.castai-cluster-controller.castai.apiKeySecretRef=" + str((((auto.get("castai-cluster-controller") or {}).get("castai") or {}).get("apiKeySecretRef", ""))))
# Disabled components: every other subchart must have enabled: false.
# castai-evictor must also have crdUpgrade.enabled: false so the
# pre-install hook Job is never rendered.
for name in ("castai-spot-handler", "castai-kvisor", "castai-pod-mutator",
             "castai-pod-pinner", "castai-live", "castai-workload-autoscaler",
             "castai-workload-autoscaler-exporter"):
    print(f"autoscaler.{name}.enabled=" + str(((auto.get(name) or {}).get("enabled", ""))))
evictor = auto.get("castai-evictor") or {}
print("autoscaler.castai-evictor.enabled=" + str(evictor.get("enabled", "")))
print("autoscaler.castai-evictor.crdUpgrade.enabled=" + str(((evictor.get("crdUpgrade") or {}).get("enabled", ""))))
PY
)"
    _assert_contains \
        "global.castai.apiKeySecretRef = castai-agent-token" \
        "global.castai.apiKeySecretRef=castai-agent-token" \
        "${parsed}"
    _assert_contains \
        "global.castai.apiURL = https://api.eu.cast.ai" \
        "global.castai.apiURL=https://api.eu.cast.ai" \
        "${parsed}"
    _assert_contains \
        "global.castai.provider = eks" \
        "global.castai.provider=eks" \
        "${parsed}"
    _assert_contains \
        "tags.full = false (no full mode tag)" \
        "tags.full=False" \
        "${parsed}"
    _assert_contains \
        "tags.readonly = false" \
        "tags.readonly=False" \
        "${parsed}"
    _assert_contains \
        "tags.node-autoscaler = false" \
        "tags.node-autoscaler=False" \
        "${parsed}"
    _assert_contains \
        "tags.workload-autoscaler = false" \
        "tags.workload-autoscaler=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-agent.enabled = true (only agent + cc are installed)" \
        "autoscaler.castai-agent.enabled=True" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-agent.apiKeySecretRef = castai-agent-token" \
        "autoscaler.castai-agent.apiKeySecretRef=castai-agent-token" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-cluster-controller.enabled = true" \
        "autoscaler.castai-cluster-controller.enabled=True" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-cluster-controller.replicas = 1 (single replica for 2-node cluster)" \
        "autoscaler.castai-cluster-controller.replicas=1" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-cluster-controller.castai.apiKeySecretRef = castai-cluster-controller-token" \
        "autoscaler.castai-cluster-controller.castai.apiKeySecretRef=castai-cluster-controller-token" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-evictor.enabled = false" \
        "autoscaler.castai-evictor.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-evictor.crdUpgrade.enabled = false (no pre-install CRD upgrade hook)" \
        "autoscaler.castai-evictor.crdUpgrade.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-spot-handler.enabled = false" \
        "autoscaler.castai-spot-handler.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-kvisor.enabled = false" \
        "autoscaler.castai-kvisor.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-pod-mutator.enabled = false" \
        "autoscaler.castai-pod-mutator.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-pod-pinner.enabled = false" \
        "autoscaler.castai-pod-pinner.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-live.enabled = false" \
        "autoscaler.castai-live.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-workload-autoscaler.enabled = false" \
        "autoscaler.castai-workload-autoscaler.enabled=False" \
        "${parsed}"
    _assert_contains \
        "autoscaler.castai-workload-autoscaler-exporter.enabled = false" \
        "autoscaler.castai-workload-autoscaler-exporter.enabled=False" \
        "${parsed}"
fi

# -----------------------------------------------------------------------------
# Test 5: configs/castai-chart-version.txt contains a non-empty semver.
# -----------------------------------------------------------------------------

printf '\n[5] configs/castai-chart-version.txt contains a non-empty semver\n' >&2

CHART_VERSION_FILE="${CONFIGS_DIR}/castai-chart-version.txt"
TESTS_RUN=$((TESTS_RUN + 1))
if [[ -f "${CHART_VERSION_FILE}" ]]; then
    _green "PASS" >&2
    printf '  chart version file exists: %s\n' "${CHART_VERSION_FILE}" >&2
else
    _red "FAIL" >&2
    printf '  chart version file missing: %s\n' "${CHART_VERSION_FILE}" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

version="$(grep -vE '^\s*(#|$)' "${CHART_VERSION_FILE}" | head -n1 | tr -d '[:space:]')"
_assert_eq \
    "chart version is non-empty" \
    "yes" \
    "$( [[ -n "${version}" ]] && echo yes || echo no )"

_assert_eq \
    "chart version matches semver (MAJOR.MINOR.PATCH)" \
    "yes" \
    "$( [[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] && echo yes || echo no )"

# -----------------------------------------------------------------------------
# Test 6: castai::verify_connected in dry-run returns 0 and advertises
# the polling endpoint (the spec's 12 retries / 10 seconds).
# -----------------------------------------------------------------------------

printf '\n[6] castai::verify_connected dry-run short-circuits without API calls\n' >&2

_reset_castai_state
# Pre-populate state with a fake cluster ID so verify_connected does not
# bail at the cluster_id lookup step.
castai::_state_set "cluster_id" "11111111-2222-3333-4444-555555555555"

verify_rc=0
verify_output=""
_capture_with_rc verify_rc verify_output castai::verify_connected

_assert_eq \
    "castai::verify_connected dry-run exits 0" \
    "0" \
    "${verify_rc}"

_assert_contains \
    "verify_connected dry-run mentions DRY-RUN" \
    "DRY-RUN" \
    "${verify_output}"

_assert_contains \
    "verify_connected dry-run logs the polling attempt count" \
    "Attempt 1/" \
    "${verify_output}"

# -----------------------------------------------------------------------------
# Test 7: kind registry correctly identifies DaemonSets vs Deployments
# in the umbrella chart and tracks critical vs best-effort components.
# -----------------------------------------------------------------------------

printf '\n[7] castai kind registry identifies Deployments vs DaemonSets\n' >&2

_assert_eq \
    "castai::_kind_of castai-agent is deployment" \
    "deployment" \
    "$(castai::_kind_of castai-agent)"

_assert_eq \
    "castai::_kind_of castai-cluster-controller is deployment" \
    "deployment" \
    "$(castai::_kind_of castai-cluster-controller)"

_assert_eq \
    "castai::_kind_of unknown component falls back to deployment" \
    "deployment" \
    "$(castai::_kind_of castai-unknown-thing)"

_assert_command_succeeds \
    "castai::_is_critical castai-agent returns 0" \
    bash -c 'set -e; source "'"${LIB_DIR}"'/castai-install.sh"; castai::_is_critical castai-agent'

_assert_command_succeeds \
    "castai::_is_critical castai-cluster-controller returns 0" \
    bash -c 'set -e; source "'"${LIB_DIR}"'/castai-install.sh"; castai::_is_critical castai-cluster-controller'

_assert_command_fails \
    "castai::_is_critical castai-spot-handler returns 1 (component not installed)" \
    bash -c 'source "'"${LIB_DIR}"'/castai-install.sh"; castai::_is_critical castai-spot-handler'

_assert_eq \
    "CASTAI_COMPONENT_NAMES has an entry for every kind" \
    "${#CASTAI_COMPONENT_NAMES[@]}" \
    "${#CASTAI_COMPONENT_KINDS[@]}"

_assert_eq \
    "CASTAI_COMPONENT_KINDS has an entry for every name" \
    "${#CASTAI_COMPONENT_NAMES[@]}" \
    "${#CASTAI_COMPONENT_CRITICALITY[@]}"

_assert_eq \
    "CASTAI_COMPONENT_NAMES contains exactly the two installed components" \
    "2" \
    "${#CASTAI_COMPONENT_NAMES[@]}"

_assert_eq \
    "CASTAI_CRITICAL_COMPONENTS contains exactly castai-agent and castai-cluster-controller" \
    "2" \
    "${#CASTAI_CRITICAL_COMPONENTS[@]}"

# -----------------------------------------------------------------------------
# Test 8: helm install no longer uses --wait (so a slow DaemonSet
# rollout does not block the install itself). The timeout knob is
# bumped to at least 15 minutes.
# -----------------------------------------------------------------------------

printf '\n[8] helm install drops --wait and uses a long --timeout\n' >&2

_reset_castai_state
helm_install_rc=0
helm_install_output=""
_capture_with_rc helm_install_rc helm_install_output castai::install_chart

_assert_eq \
    "castai::install_chart dry-run still exits 0" \
    "0" \
    "${helm_install_rc}"

_assert_not_contains \
    "helm upgrade --install no longer includes --wait" \
    "--wait" \
    "${helm_install_output}"

_assert_contains \
    "helm upgrade --install now uses --timeout" \
    "--timeout ${CASTAI_HELM_INSTALL_TIMEOUT}" \
    "${helm_install_output}"

# Verify the timeout is at least 15 minutes so even slow clusters do
# not abort the install prematurely.
TESTS_RUN=$((TESTS_RUN + 1))
helm_timeout_minutes="$(printf '%s' "${CASTAI_HELM_INSTALL_TIMEOUT}" | sed -E 's/^([0-9]+)m?$/\1/')"
if awk -v t="${helm_timeout_minutes}" 'BEGIN { exit (t+0 >= 15) ? 0 : 1 }'; then
    _green "PASS" >&2
    printf '  CASTAI_HELM_INSTALL_TIMEOUT=%s is >= 15m\n' "${CASTAI_HELM_INSTALL_TIMEOUT}" >&2
else
    _red "FAIL" >&2
    printf '  CASTAI_HELM_INSTALL_TIMEOUT=%s is below 15m\n' "${CASTAI_HELM_INSTALL_TIMEOUT}" >&2
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

# -----------------------------------------------------------------------------
# Test 9: castai::wait_for_ready in dry-run is kind-aware (emits
# deployment/<name> for Deployments and daemonset/<name> for DaemonSets)
# and uses the best-effort timeout for non-critical components.
# -----------------------------------------------------------------------------

printf '\n[9] castai::wait_for_ready dry-run is kind-aware\n' >&2

_reset_castai_state
wait_rc=0
wait_output=""
_capture_with_rc wait_rc wait_output castai::wait_for_ready 300s

_assert_eq \
    "castai::wait_for_ready dry-run exits 0" \
    "0" \
    "${wait_rc}"

_assert_contains \
    "wait_for_ready mentions deployment/castai-agent" \
    "deployment/castai-agent" \
    "${wait_output}"

_assert_contains \
    "wait_for_ready mentions deployment/castai-cluster-controller" \
    "deployment/castai-cluster-controller" \
    "${wait_output}"

_assert_not_contains \
    "wait_for_ready does NOT emit daemonset/castai-spot-handler" \
    "daemonset/castai-spot-handler" \
    "${wait_output}"

_assert_not_contains \
    "wait_for_ready does NOT emit daemonset/castai-kvisor-agent" \
    "daemonset/castai-kvisor-agent" \
    "${wait_output}"

_assert_not_contains \
    "wait_for_ready does NOT emit deployment/castai-spot-handler" \
    "deployment/castai-spot-handler" \
    "${wait_output}"

_assert_not_contains \
    "wait_for_ready does NOT emit deployment/castai-kvisor-agent" \
    "deployment/castai-kvisor-agent" \
    "${wait_output}"

_assert_not_contains \
    "wait_for_ready does NOT emit deployment/castai-evictor" \
    "deployment/castai-evictor" \
    "${wait_output}"

_assert_not_contains \
    "wait_for_ready does NOT emit deployment/castai-workload-autoscaler" \
    "deployment/castai-workload-autoscaler" \
    "${wait_output}"

_assert_contains \
    "critical castai-agent uses the requested 300s timeout" \
    "deployment/castai-agent --namespace=${CASTAI_NAMESPACE} --timeout=300s" \
    "${wait_output}"

_assert_contains \
    "critical castai-cluster-controller uses the requested 300s timeout" \
    "deployment/castai-cluster-controller --namespace=${CASTAI_NAMESPACE} --timeout=300s" \
    "${wait_output}"

# -----------------------------------------------------------------------------
# Test 10: live paths refuse to run without APPROVE_LIVE_RUN.
# -----------------------------------------------------------------------------

printf '\n[10] live mutations abort without APPROVE_LIVE_RUN\n' >&2

_reset_castai_state
# Referenced by castai::_require_live_approval after dry-run is flipped off.
# shellcheck disable=SC2034
CASTAI_DRY_RUN="false"
unset APPROVE_LIVE_RUN

live_rc=0
live_output=""
_capture_with_rc live_rc live_output castai::register_cluster \
    "16926-castai-token-rotation-e2e" "eu-central-1" "111122223333"

_assert_not_eq \
    "live castai::register_cluster exits non-zero without APPROVE_LIVE_RUN" \
    "0" \
    "${live_rc}"

_assert_contains \
    "live path explains APPROVE_LIVE_RUN requirement" \
    "APPROVE_LIVE_RUN" \
    "${live_output}"

_assert_contains \
    "live path calls out CAST AI API mutation category" \
    "CAST AI API" \
    "${live_output}"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------

printf '\n' >&2
if (( TESTS_FAILED == 0 )); then
    _green "All ${TESTS_RUN} assertions passed." >&2
    exit 0
fi
_red "${TESTS_FAILED} of ${TESTS_RUN} assertions failed." >&2
exit 1
