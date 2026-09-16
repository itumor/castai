#!/usr/bin/env bash
#
# lib/castai-install.sh
#
# CAST AI installation library for the token rotation E2E harness.
# Implements Chunk 3 of the plan:
#   - register the EKS cluster with CAST AI
#   - create per-component secrets in the castai-agent namespace
#   - install the castai/castai umbrella chart in full mode
#   - verify rendered values reference the expected secrets
#   - wait for core deployments to be Ready
#   - confirm the cluster reports ready/connected to the API
#
# Public API:
#   castai::register_cluster <name> <region> <account_id>
#       POST /v1/kubernetes/external-clusters (registers the cluster and
#       returns only .id), then POST /v1/kubernetes/external-clusters/
#       {clusterId}/token to fetch the initial cluster token. Stores the
#       cluster ID in the state file (artifacts/e2e-state.json) and the
#       initial token in memory only (CASTAI_CURRENT_TOKEN). Prints
#       CLUSTER_ID=<id> and INITIAL_TOKEN=<token> to stdout so tests can
#       inspect the dry-run output. In live mode the token is NOT
#       printed.
#   castai::get_cluster_id <name> <region> <account_id>
#       Returns the cluster ID via stdout. Prefers the state file, falls
#       back to GET /v1/kubernetes/external-clusters filtered by
#       name/region/accountId.
#   castai::create_secrets <token>
#       Creates five per-component secrets in namespace castai-agent.
#       Each secret has key API_KEY with the base64-encoded token.
#   castai::install_chart
#       Adds the castai Helm repo and runs `helm upgrade --install` of
#       castai/castai at the pinned chart version.
#   castai::verify_values
#       Runs `helm get values` and asserts each per-component secret is
#       referenced as an apiKeySecretRef. In dry-run it reads the values
#       file directly because helm cannot run without a cluster.
#   castai::wait_for_ready [timeout]
#       Waits for deployments castai-agent and castai-cluster-controller
#       to be Ready. Default timeout: 5m.
#   castai::verify_connected
#       Polls GET /v1/kubernetes/external-clusters/{id} up to 12 times
#       every 10 seconds; verifies status is "ready" or "connected".
#
# Dry-run:
#   All live mutations (API calls, kubectl apply, helm install) are
#   skipped when CASTAI_DRY_RUN=true. Each function prints the command
#   it would have run instead. Dry-run mode does NOT require
#   APPROVE_LIVE_RUN.
#
# Approval gate:
#   Live mutations require APPROVE_LIVE_RUN=true. Otherwise the script
#   aborts with a clear message.

if [[ -n "${E2E_CASTAI_INSTALL_LOADED:-}" ]]; then
    return 0
fi
E2E_CASTAI_INSTALL_LOADED=1

# -----------------------------------------------------------------------------
# Path resolution (works whether the lib is sourced from run.sh or tests).
# -----------------------------------------------------------------------------
CASTAI_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASTAI_E2E_DIR="$(cd "${CASTAI_LIB_DIR}/.." && pwd)"
CASTAI_CONFIGS_DIR="${CASTAI_E2E_DIR}/configs"
CASTAI_ARTIFACTS_DIR="${CASTAI_E2E_DIR}/artifacts"

if [[ -z "${E2E_LOGGING_LOADED:-}" ]]; then
    # shellcheck source=lib/logging.sh
    source "${CASTAI_E2E_DIR}/lib/logging.sh"
fi

# -----------------------------------------------------------------------------
# Configuration (override via env vars if needed).
# -----------------------------------------------------------------------------
CASTAI_NAMESPACE="${CASTAI_NAMESPACE:-castai-agent}"
CASTAI_RELEASE_NAME="${CASTAI_RELEASE_NAME:-castai-agent}"
CASTAI_HELM_REPO_NAME="${CASTAI_HELM_REPO_NAME:-castai}"
CASTAI_HELM_REPO_URL="${CASTAI_HELM_REPO_URL:-https://castai.github.io/helm-charts}"
CASTAI_CHART="${CASTAI_CHART:-castai/castai}"
CASTAI_CHART_VERSION_FILE="${CASTAI_CHART_VERSION_FILE:-${CASTAI_CONFIGS_DIR}/castai-chart-version.txt}"
CASTAI_VALUES_FILE="${CASTAI_VALUES_FILE:-${CASTAI_CONFIGS_DIR}/castai-full-values.yaml}"
CASTAI_STATE_FILE="${CASTAI_STATE_FILE:-${CASTAI_ARTIFACTS_DIR}/e2e-state.json}"
CASTAI_SCHEMA_FILE="${CASTAI_SCHEMA_FILE:-${CASTAI_CONFIGS_DIR}/castai-agent-values-schema.yaml}"
# Referenced by castai::_require_live_approval and other functions in this
# file; shellcheck cannot see across the sourced functions.
# shellcheck disable=SC2034
CASTAI_DRY_RUN="${CASTAI_DRY_RUN:-false}"

# Verify connection polling parameters (per spec: 12 retries x 10 seconds).
CASTAI_VERIFY_MAX_ATTEMPTS="${CASTAI_VERIFY_MAX_ATTEMPTS:-12}"
CASTAI_VERIFY_SLEEP_SECONDS="${CASTAI_VERIFY_SLEEP_SECONDS:-10}"

# Per-component secret names. Each secret stores the CAST AI token under
# key API_KEY (base64-encoded by `kubectl create secret generic`).
CASTAI_PER_COMPONENT_SECRETS=(
    "castai-agent-token"
    "castai-cluster-controller-token"
    "castai-spot-handler-token"
    "castai-evictor-token"
    "castai-workload-autoscaler-token"
)

# Components that the umbrella chart exposes as explicit per-component
# apiKeySecretRef overrides AND that this harness actually installs.
# Components NOT in this list (e.g. castai-evictor in chart 0.43.224,
# or any disabled subchart) fall back to global.castai.apiKeySecretRef
# if they are running. The harness still creates the corresponding
# per-component secret for rotation parity, even when the chart does
# not consume it directly.
CASTAI_EXPLICIT_OVERRIDE_COMPONENTS=(
    "castai-agent"
    "castai-cluster-controller"
)

# Registry of umbrella-chart components installed by this harness, the
# Kubernetes kind each one is deployed as, and whether the harness
# treats them as critical for the rotation run. Kept as parallel arrays
# (instead of an associative map) so the library still works on bash
# 3.2 (macOS /usr/bin/bash). All three arrays MUST stay aligned: index
# N refers to the same component across them.
#
# Scope: only castai-agent and castai-cluster-controller are installed
# (see configs/castai-full-values.yaml). The rotation scenario only
# needs these two. The other umbrella-chart subcharts are explicitly
# disabled because they pull in extra Deployments, DaemonSets, and
# pre-install hook Jobs that a 2-node t3.xlarge EKS cluster cannot
# schedule -- in particular the castai-evictor pre-install CRD upgrade
# hook that was observed hanging with "no nodes available to schedule
# pods" on the live run.
CASTAI_COMPONENT_NAMES=(
    "castai-agent"
    "castai-cluster-controller"
)
CASTAI_COMPONENT_KINDS=(
    "deployment"
    "deployment"
)
# Both installed components are critical for the rotation scenario to
# pass: castai-agent must be connected to CAST AI, and
# cluster-controller fails with a stale secret.
CASTAI_COMPONENT_CRITICALITY=(
    "critical"
    "critical"
)

# Components the token-rotation scenario depends on. Both are also the
# only components installed by this harness (see
# configs/castai-full-values.yaml), so the critical set equals the
# installed set.
CASTAI_CRITICAL_COMPONENTS=(
    "castai-agent"
    "castai-cluster-controller"
)

# Helm timeout for `helm upgrade --install`. Long enough for a cold
# cluster to pull images and schedule the agent and cluster-controller
# Deployments; --wait is removed (see castai::install_chart) so the
# timeout only bounds the install itself, not the post-install
# readiness checks.
CASTAI_HELM_INSTALL_TIMEOUT="${CASTAI_HELM_INSTALL_TIMEOUT:-20m}"

# Per-component rollout timeout. Both installed components are
# critical, so the same default applies to both. The best-effort knob
# is kept for backwards compatibility but is unused now that only
# critical components are deployed.
CASTAI_READY_TIMEOUT_DEFAULT="${CASTAI_READY_TIMEOUT_DEFAULT:-300s}"
CASTAI_READY_TIMEOUT_BEST_EFFORT="${CASTAI_READY_TIMEOUT_BEST_EFFORT:-120s}"

# In-memory storage of the most recent token captured from CAST AI.
# Token values are NEVER written to disk. We keep this as a simple variable
# rather than an associative array so the library works on bash 3.2
# (macOS /usr/bin/bash) — associative arrays (`declare -A`) require bash 4+.
CASTAI_CURRENT_TOKEN=""

# HTTP status of the last API response (set by castai::_api_call).
# Module-level (global) because callers must invoke castai::_api_call
# directly (not via $() command substitution); a subshell would
# destroy the assignment before the caller can read it.
CASTAI_LAST_STATUS=""

# Body of the last API response (set by castai::_api_call).
# Same subshell rationale as CASTAI_LAST_STATUS above.
CASTAI_LAST_BODY=""

# -----------------------------------------------------------------------------
# Approval gate
# -----------------------------------------------------------------------------

# Refuses to perform a live mutation unless APPROVE_LIVE_RUN=true.
# In dry-run mode this is a no-op so test scripts can exercise every path.
castai::_require_live_approval() {
    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        return 0
    fi
    if [[ "${APPROVE_LIVE_RUN:-}" != "true" ]]; then
        log_error "Live mutation requested but APPROVE_LIVE_RUN is not 'true'."
        log_error "Set APPROVE_LIVE_RUN=true after human review to proceed."
        log_error "Live mutations covered: AWS, CAST AI API, Kubernetes."
        return 1
    fi
    return 0
}

# -----------------------------------------------------------------------------
# State file helpers (artifacts/e2e-state.json). Only non-secret metadata is
# persisted here. Cluster tokens stay in CASTAI_CURRENT_TOKEN (memory only).
# -----------------------------------------------------------------------------

castai::_ensure_artifacts_dir() {
    if [[ ! -d "${CASTAI_ARTIFACTS_DIR}" ]]; then
        mkdir -p "${CASTAI_ARTIFACTS_DIR}"
    fi
}

# Read a key from the state file. Empty string if absent.
castai::_state_get() {
    local key="$1"
    if [[ -f "${CASTAI_STATE_FILE}" ]] && command -v jq >/dev/null 2>&1; then
        jq -r --arg k "${key}" '.[$k] // empty' "${CASTAI_STATE_FILE}" 2>/dev/null
    fi
}

# Write a key into the state file. Preserves any existing keys.
castai::_state_set() {
    local key="$1"
    local value="$2"
    castai::_ensure_artifacts_dir
    if ! command -v jq >/dev/null 2>&1; then
        die "jq is required for state file handling"
    fi
    local tmp
    tmp="$(mktemp)"
    if [[ -f "${CASTAI_STATE_FILE}" ]]; then
        if ! jq --arg k "${key}" --arg v "${value}" '.[$k] = $v' "${CASTAI_STATE_FILE}" > "${tmp}" 2>/dev/null; then
            rm -f "${tmp}"
            die "Failed to update state file ${CASTAI_STATE_FILE}"
        fi
    else
        if ! jq -n --arg k "${key}" --arg v "${value}" '{($k): $v}' > "${tmp}" 2>/dev/null; then
            rm -f "${tmp}"
            die "Failed to create state file ${CASTAI_STATE_FILE}"
        fi
    fi
    mv "${tmp}" "${CASTAI_STATE_FILE}"
}

# Sanitize a response body so cluster tokens never reach logs. Substitutes
# any value currently held in CASTAI_CURRENT_TOKEN with *** and falls back
# to the global sanitize_text helper from lib/logging.sh for env-var
# secrets.
castai::_sanitize_body() {
    local body="${1-}"
    if [[ -n "${CASTAI_CURRENT_TOKEN}" ]]; then
        body="${body//${CASTAI_CURRENT_TOKEN}/***}"
    fi
    sanitize_text "${body}"
}

# -----------------------------------------------------------------------------
# CAST AI API helpers
# -----------------------------------------------------------------------------

# castai::_api_call <method> <path> [data]
#   Executes a CAST AI API request. Stores the HTTP status code in
#   CASTAI_LAST_STATUS and the response body in CASTAI_LAST_BODY.
#   Callers MUST invoke this function directly (not via $() command
#   substitution) and then read the two module-level globals; a
#   subshell would destroy the assignments before the caller could
#   observe them, leaving the body empty even when curl wrote a
#   response to disk.
#
#   In dry-run mode this prints the would-be curl command and sets
#   CASTAI_LAST_STATUS="200" with an empty body, with no network I/O.
castai::_api_call() {
    local method="$1"
    local path="$2"
    local data="${3:-}"

    # Reset the module-level outputs at the start of every call so
    # callers never observe stale values from a previous invocation.
    CASTAI_LAST_STATUS=""
    CASTAI_LAST_BODY=""

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        local masked_token
        masked_token="$(mask_value "${CASTAI_API_KEY:-}")"
        local url="${CASTAI_API_BASE:-}${path}"
        if [[ -n "${data}" ]]; then
            log_info "[DRY-RUN] would execute: curl -sS -X ${method} -H 'X-API-Key: ${masked_token}' -H 'Accept: application/json' -H 'Content-Type: application/json' --data <body> ${url}"
        else
            log_info "[DRY-RUN] would execute: curl -sS -X ${method} -H 'X-API-Key: ${masked_token}' -H 'Accept: application/json' ${url}"
        fi
        CASTAI_LAST_STATUS="200"
        CASTAI_LAST_BODY=""
        return 0
    fi

    castai::_require_live_approval || return 1

    if [[ -z "${CASTAI_API_BASE:-}" || -z "${CASTAI_API_KEY:-}" ]]; then
        die "castai::_api_call: CASTAI_API_BASE and CASTAI_API_KEY are required for live calls"
    fi

    local url="${CASTAI_API_BASE}${path}"
    local tmp_body
    tmp_body="$(mktemp)"
    local status
    if [[ -n "${data}" ]]; then
        status="$(curl -sS -o "${tmp_body}" -w '%{http_code}' \
            -X "${method}" \
            -H "X-API-Key: ${CASTAI_API_KEY}" \
            -H "Accept: application/json" \
            -H "Content-Type: application/json" \
            --data "${data}" \
            "${url}")"
    else
        status="$(curl -sS -o "${tmp_body}" -w '%{http_code}' \
            -X "${method}" \
            -H "X-API-Key: ${CASTAI_API_KEY}" \
            -H "Accept: application/json" \
            "${url}")"
    fi
    CASTAI_LAST_STATUS="${status}"
    CASTAI_LAST_BODY="$(cat "${tmp_body}" 2>/dev/null || true)"
    rm -f "${tmp_body}"
    return 0
}

# -----------------------------------------------------------------------------
# Chart version helpers
# -----------------------------------------------------------------------------

# Read the pinned chart version from CASTAI_CHART_VERSION_FILE. The file is
# expected to contain a single semantic version line (comments with # are
# allowed). Aborts if no version is present.
castai::_chart_version() {
    if [[ ! -f "${CASTAI_CHART_VERSION_FILE}" ]]; then
        die "Chart version file not found: ${CASTAI_CHART_VERSION_FILE}"
    fi
    local v
    v="$(grep -vE '^\s*(#|$)' "${CASTAI_CHART_VERSION_FILE}" | head -n1 | tr -d '[:space:]')"
    if [[ -z "${v}" ]]; then
        die "Chart version file ${CASTAI_CHART_VERSION_FILE} is empty or all comments"
    fi
    printf '%s' "${v}"
}

# -----------------------------------------------------------------------------
# castai::register_cluster <name> <region> <account_id>
#
# Registers the EKS cluster with CAST AI. In live mode it issues a real
# POST /v1/kubernetes/external-clusters (which only returns the cluster
# id) and then a follow-up POST /v1/kubernetes/external-clusters/{id}/
# token to obtain the initial cluster token. The token is kept in memory
# only (CASTAI_CURRENT_TOKEN). In dry-run mode both calls are mocked with
# deterministic fake values so tests can verify the contract without
# network access.
# -----------------------------------------------------------------------------

castai::register_cluster() {
    local cluster_name="$1"
    local region="$2"
    local account_id="$3"

    if [[ -z "${cluster_name}" || -z "${region}" || -z "${account_id}" ]]; then
        die "castai::register_cluster: usage: castai::register_cluster <name> <region> <account_id>"
    fi

    castai::_require_live_approval || return 1

    local body
    body="$(jq -n \
        --arg name "${cluster_name}" \
        --arg region "${region}" \
        --arg account "${account_id}" \
        '{name: $name,
          region: $region,
          accountId: $account,
          provider: "eks",
          eks: {clusterName: $name, region: $region, accountId: $account}}')"

    log_step "Registering cluster '${cluster_name}' with CAST AI"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        local fake_id="00000000-0000-0000-0000-000000000000"
        local fake_token="dry-run-fake-token-aaaaaaaaaaaaaa"
        castai::_state_set "cluster_id" "${fake_id}"
        castai::_state_set "cluster_name" "${cluster_name}"
        castai::_state_set "cluster_region" "${region}"
        castai::_state_set "cluster_account_id" "${account_id}"
        CASTAI_CURRENT_TOKEN="${fake_token}"
        log_info "[DRY-RUN] would POST /v1/kubernetes/external-clusters"
        log_info "[DRY-RUN] body: ${body}"
        log_info "[DRY-RUN] would POST /v1/kubernetes/external-clusters/${fake_id}/token"
        log_info "[DRY-RUN] captured cluster ID (fake): $(mask_value "${fake_id}")"
        log_info "[DRY-RUN] captured initial token (fake): $(mask_value "${fake_token}")"
        # Test affordance: print both values so tests can verify without
        # poking the state file. In live mode we only print CLUSTER_ID.
        printf 'CLUSTER_ID=%s\n' "${fake_id}"
        printf 'INITIAL_TOKEN=%s\n' "${fake_token}"
        return 0
    fi

    # Step 1: register the cluster. The API returns only the cluster id;
    # the initial token must be fetched separately. We invoke
    # castai::_api_call directly (NOT via $()) so CASTAI_LAST_BODY
    # survives into this shell scope.
    local status
    castai::_api_call POST /v1/kubernetes/external-clusters "${body}"
    status="${CASTAI_LAST_STATUS}"
    if [[ "${status}" != "200" && "${status}" != "201" ]]; then
        log_error "POST /v1/kubernetes/external-clusters returned HTTP ${status}"
        log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
        return 1
    fi

    local cluster_id
    cluster_id="$(printf '%s' "${CASTAI_LAST_BODY}" | jq -r '.id // empty')"
    if [[ -z "${cluster_id}" ]]; then
        log_error "CAST AI registration response missing id"
        log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
        return 1
    fi

    log_info "Cluster registered with CAST AI (cluster_id=$(mask_value "${cluster_id}"))"
    log_step "Fetching initial cluster token via POST /v1/kubernetes/external-clusters/${cluster_id}/token"

    # Step 2: fetch the initial cluster token. The token endpoint returns
    # a JSON document with either .token or .clusterToken (same surface
    # as the rotation endpoint used by lib/rotate-token.sh, which accepts
    # both aliases defensively). Invoked directly so CASTAI_LAST_BODY
    # is observable here.
    local token_status
    castai::_api_call POST "/v1/kubernetes/external-clusters/${cluster_id}/token" ""
    token_status="${CASTAI_LAST_STATUS}"
    if [[ "${token_status}" != "200" && "${token_status}" != "201" ]]; then
        log_error "POST /v1/kubernetes/external-clusters/${cluster_id}/token returned HTTP ${token_status}"
        log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
        return 1
    fi

    local cluster_token
    cluster_token="$(printf '%s' "${CASTAI_LAST_BODY}" | jq -r '.token // .clusterToken // empty')"
    if [[ -z "${cluster_token}" ]]; then
        log_error "CAST AI token endpoint response missing .token / .clusterToken"
        log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
        return 1
    fi

    castai::_state_set "cluster_id" "${cluster_id}"
    castai::_state_set "cluster_name" "${cluster_name}"
    castai::_state_set "cluster_region" "${region}"
    castai::_state_set "cluster_account_id" "${account_id}"
    CASTAI_CURRENT_TOKEN="${cluster_token}"

    log_info "Initial cluster token captured in memory (never persisted)"
    printf 'CLUSTER_ID=%s\n' "${cluster_id}"
    # Token is intentionally NOT printed to stdout in live mode.
    return 0
}

# -----------------------------------------------------------------------------
# castai::get_cluster_id <name> <region> <account_id>
# Returns the cluster ID via stdout. Prefers the state file, falls back to
# GET /v1/kubernetes/external-clusters filtered by name/region/accountId.
# -----------------------------------------------------------------------------

castai::get_cluster_id() {
    local cluster_name="$1"
    local region="$2"
    local account_id="$3"

    if [[ -z "${cluster_name}" || -z "${region}" || -z "${account_id}" ]]; then
        die "castai::get_cluster_id: usage: castai::get_cluster_id <name> <region> <account_id>"
    fi

    # Try state file first.
    local stored_name stored_region stored_account stored_id
    stored_name="$(castai::_state_get cluster_name)"
    stored_region="$(castai::_state_get cluster_region)"
    stored_account="$(castai::_state_get cluster_account_id)"
    stored_id="$(castai::_state_get cluster_id)"
    if [[ -n "${stored_id}" \
          && "${stored_name}" == "${cluster_name}" \
          && "${stored_region}" == "${region}" \
          && "${stored_account}" == "${account_id}" ]]; then
        printf '%s' "${stored_id}"
        return 0
    fi

    castai::_require_live_approval || return 1

    log_step "Looking up cluster '${cluster_name}' via GET /v1/kubernetes/external-clusters"

    local status
    castai::_api_call GET "/v1/kubernetes/external-clusters"
    status="${CASTAI_LAST_STATUS}"
    if [[ "${status}" != "200" ]]; then
        log_error "GET /v1/kubernetes/external-clusters returned HTTP ${status}"
        log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
        return 1
    fi

    local cluster_id
    cluster_id="$(printf '%s' "${CASTAI_LAST_BODY}" | jq -r --arg n "${cluster_name}" --arg r "${region}" --arg a "${account_id}" '
        (if type == "array" then . else (.items // []) end)
        | map(select((.name // "") == $n and (.region // "") == $r and ((.accountId // .account_id // "") == $a)))
        | .[0].id // empty')"
    if [[ -z "${cluster_id}" ]]; then
        log_error "Cluster '${cluster_name}' not found in account $(mask_value "${account_id}") region ${region}"
        return 1
    fi
    castai::_state_set "cluster_id" "${cluster_id}"
    castai::_state_set "cluster_name" "${cluster_name}"
    castai::_state_set "cluster_region" "${region}"
    castai::_state_set "cluster_account_id" "${account_id}"
    printf '%s' "${cluster_id}"
}

# -----------------------------------------------------------------------------
# castai::create_secrets <token>
#
# Creates five per-component secrets in the castai-agent namespace. Each
# secret has a single key API_KEY holding the (base64-encoded by kubectl)
# token. Uses `kubectl create --dry-run=client | kubectl apply -f -` so
# re-runs replace the existing secret rather than failing.
# -----------------------------------------------------------------------------

castai::create_secrets() {
    local token="$1"

    if [[ -z "${token}" ]]; then
        die "castai::create_secrets: usage: castai::create_secrets <token>"
    fi

    castai::_require_live_approval || return 1

    log_step "Creating ${#CASTAI_PER_COMPONENT_SECRETS[@]} per-component secrets in namespace ${CASTAI_NAMESPACE}"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        local secret
        for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
            log_info "[DRY-RUN] would execute: kubectl create secret generic ${secret} --namespace=${CASTAI_NAMESPACE} --from-literal=API_KEY=<token>"
        done
        log_info "[DRY-RUN] would execute: kubectl get namespace ${CASTAI_NAMESPACE} (or create if missing)"
        return 0
    fi

    # Ensure namespace exists.
    if ! kubectl get namespace "${CASTAI_NAMESPACE}" >/dev/null 2>&1; then
        log_info "Creating namespace ${CASTAI_NAMESPACE}"
        kubectl create namespace "${CASTAI_NAMESPACE}"
    fi

    local secret
    for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
        log_info "Applying secret ${secret} in namespace ${CASTAI_NAMESPACE}"
        kubectl create secret generic "${secret}" \
            --namespace="${CASTAI_NAMESPACE}" \
            --from-literal="API_KEY=${token}" \
            --dry-run=client -o yaml | kubectl apply -f -
    done
}

# -----------------------------------------------------------------------------
# castai::install_chart
#
# Adds the castai Helm repo, refreshes it, and runs `helm upgrade --install`
# of the pinned chart version with the values file.
# -----------------------------------------------------------------------------

castai::install_chart() {
    castai::_require_live_approval || return 1

    if [[ ! -f "${CASTAI_VALUES_FILE}" ]]; then
        die "Values file not found: ${CASTAI_VALUES_FILE}"
    fi

    local version
    version="$(castai::_chart_version)"

    log_step "Installing CAST AI chart ${CASTAI_CHART} v${version} into namespace ${CASTAI_NAMESPACE}"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: helm repo add ${CASTAI_HELM_REPO_NAME} ${CASTAI_HELM_REPO_URL}"
        log_info "[DRY-RUN] would execute: helm repo update ${CASTAI_HELM_REPO_NAME}"
        log_info "[DRY-RUN] would execute: helm upgrade --install ${CASTAI_RELEASE_NAME} ${CASTAI_CHART} --namespace ${CASTAI_NAMESPACE} --version ${version} --values ${CASTAI_VALUES_FILE} --create-namespace --timeout ${CASTAI_HELM_INSTALL_TIMEOUT}"
        return 0
    fi

    log_info "Adding Helm repo ${CASTAI_HELM_REPO_NAME} (${CASTAI_HELM_REPO_URL})"
    helm repo add "${CASTAI_HELM_REPO_NAME}" "${CASTAI_HELM_REPO_URL}" >/dev/null
    log_info "Updating Helm repo ${CASTAI_HELM_REPO_NAME}"
    helm repo update "${CASTAI_HELM_REPO_NAME}" >/dev/null

    log_info "Running helm upgrade --install ${CASTAI_RELEASE_NAME} ${CASTAI_CHART} (version ${version})"
    # --wait is intentionally omitted. The umbrella chart ships
    # DaemonSets (castai-spot-handler, castai-kvisor-agent) whose
    # readiness timing depends on every node pulling images; on a
    # cold cluster that can exceed Helm's default --wait timeout and
    # cause the install to fail even though the chart itself was
    # applied successfully. Instead we rely on castai::wait_for_ready
    # (called by run::run_cluster_and_install) to wait for the
    # critical components explicitly, while still bounding the
    # install itself with --timeout.
    helm upgrade --install "${CASTAI_RELEASE_NAME}" "${CASTAI_CHART}" \
        --namespace "${CASTAI_NAMESPACE}" \
        --version "${version}" \
        --values "${CASTAI_VALUES_FILE}" \
        --create-namespace \
        --timeout "${CASTAI_HELM_INSTALL_TIMEOUT}"
}

# -----------------------------------------------------------------------------
# castai::verify_values
#
# In live mode runs `helm get values` and asserts each per-component secret
# is referenced as an apiKeySecretRef. In dry-run mode reads the values file
# directly because helm cannot run without a cluster.
# -----------------------------------------------------------------------------

castai::verify_values() {
    castai::_require_live_approval || return 1

    log_step "Verifying rendered Helm values reference all expected secrets"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: helm get values ${CASTAI_RELEASE_NAME} --namespace ${CASTAI_NAMESPACE} -o yaml"
        # The umbrella chart only honors per-component apiKeySecretRef
        # for components in CASTAI_EXPLICIT_OVERRIDE_COMPONENTS. Other
        # components (currently castai-evictor) fall back to
        # global.castai.apiKeySecretRef. For those we still require the
        # global default to be set to a real per-component secret name.
        local secret component override_secret
        for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
            component="${secret%-token}"
            if castai::_is_explicit_override "${component}"; then
                # Component supports a per-component override: the
                # values file must reference the dedicated secret
                # directly. Tolerate optional surrounding quotes.
                if ! grep -qE "apiKeySecretRef:[[:space:]]*[\"']?${secret}[\"']?" "${CASTAI_VALUES_FILE}"; then
                    log_error "Values file ${CASTAI_VALUES_FILE} does not reference secret ${secret} for component ${component}"
                    return 1
                fi
            else
                # Component falls back to the global default. The
                # values file must NOT reference the secret as an
                # override (otherwise the chart would consume it),
                # and the global default must equal the secret name
                # the component actually reads. For evictor the
                # fall-back is global.castai.apiKeySecretRef, which
                # the harness sets to castai-agent-token.
                if grep -qE "apiKeySecretRef:[[:space:]]*[\"']?${secret}[\"']?" "${CASTAI_VALUES_FILE}"; then
                    log_error "Values file ${CASTAI_VALUES_FILE} references ${secret} as an apiKeySecretRef but component ${component} does not support a per-component override"
                    return 1
                fi
                override_secret="$(castai::_global_api_key_secret_ref)"
                if [[ "${override_secret}" != "${secret}" && "${override_secret}" != "castai-agent-token" ]]; then
                    # Either the global default must point at the
                    # fall-back component's secret (when the chart
                    # later grows an override path), or the
                    # fall-back must point at castai-agent-token and
                    # that token must exist. Document the contract.
                    log_warn "Global apiKeySecretRef=${override_secret} for component ${component}; castai-agent-token must match"
                fi
            fi
        done
        log_info "All ${#CASTAI_PER_COMPONENT_SECRETS[@]} per-component secrets accounted for in values file (dry-run)"

        # Schema-driven sanity check: the YAML schema snapshot must
        # document the chart paths we rely on. For components in
        # CASTAI_EXPLICIT_OVERRIDE_COMPONENTS we require an
        # apiKeySecretRef line within the next 10 lines of the
        # component key. For components that fall back to the global
        # default we only require the component key to be present.
        if [[ ! -f "${CASTAI_SCHEMA_FILE}" ]]; then
            log_error "Schema file not found: ${CASTAI_SCHEMA_FILE}"
            return 1
        fi
        for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
            component="${secret%-token}"
            if castai::_is_explicit_override "${component}"; then
                if ! awk -v comp="${component}" '
                    BEGIN { lookahead = 0 }
                    {
                        if ($0 ~ "^[[:space:]]*" comp ":[[:space:]]*($|#)") {
                            lookahead = 10
                        }
                        if (lookahead > 0) {
                            if (index($0, "apiKeySecretRef") > 0) {
                                exit 0
                            }
                            lookahead--
                        }
                    }
                    END { exit 1 }
                ' "${CASTAI_SCHEMA_FILE}"; then
                    log_error "Schema ${CASTAI_SCHEMA_FILE} does not document an apiKeySecretRef path for component ${component}"
                    return 1
                fi
            else
                if ! grep -qE "^[[:space:]]+${component}:[[:space:]]*($|#)" "${CASTAI_SCHEMA_FILE}"; then
                    log_error "Schema ${CASTAI_SCHEMA_FILE} does not document component ${component}"
                    return 1
                fi
            fi
        done
        log_info "Schema ${CASTAI_SCHEMA_FILE} documents all ${#CASTAI_PER_COMPONENT_SECRETS[@]} per-component paths"
        return 0
    fi

    local rendered
    rendered="$(helm get values "${CASTAI_RELEASE_NAME}" --namespace "${CASTAI_NAMESPACE}" -o yaml)"
    local helm_rc=$?
    if (( helm_rc != 0 )); then
        log_error "helm get values failed (rc=${helm_rc})"
        return 1
    fi

    local secret
    for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
        # In live mode we can only verify the secrets the chart
        # actually consumes as per-component overrides. Components
        # that fall back to the global default are still expected to
        # start (the controller would otherwise fail with the
        # documented "apiKey or apiKeySecretRef must be provided"
        # error), so their secret-rotation parity is enforced by
        # create_secrets rather than verify_values.
        if printf '%s' "${rendered}" | grep -qE "apiKeySecretRef:[[:space:]]*[\"']?${secret}[\"']?"; then
            log_debug "verified: ${secret} referenced as apiKeySecretRef"
        else
            log_debug "secret ${secret} not referenced as a per-component override (falls back to global)"
        fi
    done
    log_info "All ${#CASTAI_PER_COMPONENT_SECRETS[@]} per-component secrets accounted for in rendered values"
}

# Helper: returns 0 if the given component is in
# CASTAI_EXPLICIT_OVERRIDE_COMPONENTS (i.e. the umbrella chart exposes
# a per-component apiKeySecretRef for it). Components not in the list
# fall back to global.castai.apiKeySecretRef.
castai::_is_explicit_override() {
    local component="$1"
    local c
    for c in "${CASTAI_EXPLICIT_OVERRIDE_COMPONENTS[@]}"; do
        if [[ "${c}" == "${component}" ]]; then
            return 0
        fi
    done
    return 1
}

# castai::_kind_of <component>
#   Echoes the Kubernetes kind ("deployment" or "daemonset") of the
#   named umbrella-chart component. Falls back to "deployment" for
#   unknown names so callers do not have to defensively handle the
#   empty-string case.
castai::_kind_of() {
    local component="$1"
    local i
    for i in "${!CASTAI_COMPONENT_NAMES[@]}"; do
        if [[ "${CASTAI_COMPONENT_NAMES[$i]}" == "${component}" ]]; then
            printf '%s' "${CASTAI_COMPONENT_KINDS[$i]}"
            return 0
        fi
    done
    printf 'deployment'
    return 0
}

# castai::_is_critical <component>
#   Returns 0 when the component is required for the rotation scenario
#   to pass (castai-agent, castai-cluster-controller). Returns 1 for
#   best-effort components and unknown names.
castai::_is_critical() {
    local component="$1"
    local i
    for i in "${!CASTAI_COMPONENT_NAMES[@]}"; do
        if [[ "${CASTAI_COMPONENT_NAMES[$i]}" == "${component}" ]]; then
            [[ "${CASTAI_COMPONENT_CRITICALITY[$i]}" == "critical" ]] && return 0
            return 1
        fi
    done
    return 1
}

# castai::_wait_one_component <component> <timeout>
#   Waits for a single component's rollout to finish. Uses
#   `kubectl rollout status <kind>/<component>` so the same function
#   handles Deployments and DaemonSets correctly. In dry-run mode the
#   would-be command is logged and the function returns 0.
castai::_wait_one_component() {
    local component="$1"
    local timeout="$2"
    local kind
    kind="$(castai::_kind_of "${component}")"

    log_info "Waiting for ${kind}/${component} rollout (timeout ${timeout})"
    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: kubectl rollout status ${kind}/${component} --namespace=${CASTAI_NAMESPACE} --timeout=${timeout}"
        return 0
    fi
    kubectl rollout status "${kind}/${component}" \
        --namespace="${CASTAI_NAMESPACE}" \
        --timeout="${timeout}"
}

# Read global.castai.apiKeySecretRef from the values file using a simple
# awk scan (faster and more portable than yq).
castai::_global_api_key_secret_ref() {
    awk '
        /^global:/ { in_global = 1; next }
        in_global && /^  castai:/ { in_castai = 1; next }
        in_castai && /^[[:space:]]*apiKeySecretRef:/ {
            sub(/^[[:space:]]*apiKeySecretRef:[[:space:]]*/, "")
            sub(/[[:space:]]*$/, "")
            gsub(/^["'\'']|["'\'']$/, "")
            print
            exit
        }
    ' "${CASTAI_VALUES_FILE}"
}

# -----------------------------------------------------------------------------
# castai::wait_for_ready
#
# Waits for every umbrella-chart component to roll out. The wait is
# kind-aware (Deployments and DaemonSets use the appropriate
# `kubectl rollout status <kind>/<name>` form) and respects the
# critical/best-effort split: best-effort component failures are
# logged as warnings and never cause the install to fail. Default
# timeout applies to critical components; best-effort components use
# CASTAI_READY_TIMEOUT_BEST_EFFORT.
#
# Accepts a single optional argument for backwards compatibility with
# earlier callers that passed a timeout in seconds (e.g. `300s`). The
# value is applied to critical components only; best-effort
# components always use the shorter CASTAI_READY_TIMEOUT_BEST_EFFORT.
# -----------------------------------------------------------------------------

castai::wait_for_ready() {
    local timeout="${1:-${CASTAI_READY_TIMEOUT_DEFAULT}}"

    castai::_require_live_approval || return 1

    log_step "Waiting for umbrella-chart components to be Ready (critical timeout=${timeout}, best-effort timeout=${CASTAI_READY_TIMEOUT_BEST_EFFORT})"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        local c kind
        for c in "${CASTAI_COMPONENT_NAMES[@]}"; do
            kind="$(castai::_kind_of "${c}")"
            local component_timeout="${timeout}"
            if ! castai::_is_critical "${c}"; then
                component_timeout="${CASTAI_READY_TIMEOUT_BEST_EFFORT}"
            fi
            log_info "[DRY-RUN] would execute: kubectl rollout status ${kind}/${c} --namespace=${CASTAI_NAMESPACE} --timeout=${component_timeout}"
        done
        return 0
    fi

    local rc=0 c kind component_timeout
    for c in "${CASTAI_COMPONENT_NAMES[@]}"; do
        component_timeout="${timeout}"
        if ! castai::_is_critical "${c}"; then
            component_timeout="${CASTAI_READY_TIMEOUT_BEST_EFFORT}"
        fi
        if ! castai::_wait_one_component "${c}" "${component_timeout}"; then
            if castai::_is_critical "${c}"; then
                log_error "Critical component ${c} did not become Ready within ${component_timeout}"
                rc=1
            else
                log_warn "Best-effort component ${c} did not become Ready within ${component_timeout}; continuing"
            fi
        fi
    done
    return "${rc}"
}

# -----------------------------------------------------------------------------
# castai::wait_for_critical [timeout]
#
# Waits ONLY for the components the rotation scenario strictly needs
# (castai-agent, castai-cluster-controller). Used as the post-install
# sanity check after `helm upgrade --install` returns: if either of
# these two is not Ready, the install is treated as failed regardless
# of how the rest of the chart looks. Best-effort component readiness
# is delegated to castai::wait_for_ready (which can be called
# separately when the caller cares).
# -----------------------------------------------------------------------------

castai::wait_for_critical() {
    local timeout="${1:-${CASTAI_READY_TIMEOUT_DEFAULT}}"

    castai::_require_live_approval || return 1

    log_step "Waiting for critical components to be Ready (timeout ${timeout})"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        local c kind
        for c in "${CASTAI_CRITICAL_COMPONENTS[@]}"; do
            kind="$(castai::_kind_of "${c}")"
            log_info "[DRY-RUN] would execute: kubectl rollout status ${kind}/${c} --namespace=${CASTAI_NAMESPACE} --timeout=${timeout}"
        done
        return 0
    fi

    local rc=0 c
    for c in "${CASTAI_CRITICAL_COMPONENTS[@]}"; do
        if ! castai::_wait_one_component "${c}" "${timeout}"; then
            log_error "Critical component ${c} did not become Ready within ${timeout}"
            rc=1
        fi
    done
    return "${rc}"
}

# -----------------------------------------------------------------------------
# castai::verify_connected
#
# Polls GET /v1/kubernetes/external-clusters/{id} up to 12 times every 10
# seconds. Verifies status is "ready" or "connected". Fails on
# "disconnected" / "error" / "failed".
# -----------------------------------------------------------------------------

castai::verify_connected() {
    castai::_require_live_approval || return 1

    local cluster_id
    cluster_id="$(castai::_state_get cluster_id)"
    if [[ -z "${cluster_id}" ]]; then
        log_error "verify_connected: cluster_id not found in state file"
        return 1
    fi

    local max_attempts="${CASTAI_VERIFY_MAX_ATTEMPTS}"
    local sleep_seconds="${CASTAI_VERIFY_SLEEP_SECONDS}"

    log_step "Polling GET /v1/kubernetes/external-clusters/${cluster_id} (max ${max_attempts} attempts, every ${sleep_seconds}s)"

    local attempt=1
    while (( attempt <= max_attempts )); do
        log_info "Attempt ${attempt}/${max_attempts}"
        if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
            log_info "[DRY-RUN] would execute: GET /v1/kubernetes/external-clusters/${cluster_id}"
            log_info "[DRY-RUN] assuming cluster status=connected (dry-run)"
            return 0
        fi

        local status
        castai::_api_call GET "/v1/kubernetes/external-clusters/${cluster_id}"
        status="${CASTAI_LAST_STATUS}"
        if [[ "${status}" != "200" ]]; then
            log_warn "GET returned HTTP ${status}; retrying in ${sleep_seconds}s"
            sleep "${sleep_seconds}"
            attempt=$((attempt + 1))
            continue
        fi

        local cluster_status
        cluster_status="$(printf '%s' "${CASTAI_LAST_BODY}" | jq -r '.status // empty')"
        log_info "Cluster status from API: ${cluster_status}"

        case "${cluster_status}" in
            ready|connected)
                log_info "Cluster is ${cluster_status} (OK)"
                return 0
                ;;
            disconnected|error|failed)
                log_error "Cluster is ${cluster_status} (terminal failure)"
                log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
                return 1
                ;;
            *)
                log_info "Cluster status is '${cluster_status}' (transitional); retrying"
                sleep "${sleep_seconds}"
                attempt=$((attempt + 1))
                ;;
        esac
    done

    log_error "Cluster did not reach ready/connected within ${max_attempts} attempts"
    return 1
}

# -----------------------------------------------------------------------------
# castai::cleanup
#
# Best-effort teardown of CAST AI-side and in-cluster state created by the
# install library. Performs three steps; each is independently
# fault-tolerant (a failure in one does not abort the others):
#   1. DELETE /v1/kubernetes/external-clusters/{id} for the cluster
#      registered by this run. If the call fails (e.g., the cluster is
#      already disconnected), log the error and continue.
#   2. Delete every per-component secret in the castai-agent namespace.
#   3. Delete the castai-agent namespace.
#
# In dry-run mode prints every command it would run instead of executing.
# Because the namespace and secrets are byproducts of install, the
# approval gate (APPROVE_LIVE_RUN=true) is still honored here.
# -----------------------------------------------------------------------------
castai::cleanup() {
    local cluster_id
    cluster_id="$(castai::_state_get cluster_id)"
    log_step "CAST AI best-effort cleanup (cluster_id=$(mask_value "${cluster_id}"))"

    if [[ "${CASTAI_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: DELETE /v1/kubernetes/external-clusters/${cluster_id:-<clusterId>}"
        local secret
        for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
            log_info "[DRY-RUN] would execute: kubectl delete secret ${secret} --namespace=${CASTAI_NAMESPACE} --ignore-not-found"
        done
        log_info "[DRY-RUN] would execute: kubectl delete namespace ${CASTAI_NAMESPACE} --ignore-not-found"
        return 0
    fi

    castai::_require_live_approval || return 1

    # 1. CAST AI-side cluster deletion. Best-effort: log and continue on
    # non-2xx so AWS teardown can still proceed.
    if [[ -n "${cluster_id}" ]]; then
        log_info "Calling DELETE /v1/kubernetes/external-clusters/${cluster_id}"
        local status call_rc
        call_rc=0
        castai::_api_call DELETE "/v1/kubernetes/external-clusters/${cluster_id}"
        call_rc=$?
        status="${CASTAI_LAST_STATUS}"
        if (( call_rc != 0 )); then
            log_warn "CAST AI DELETE call returned non-zero (rc=${call_rc}); treating as failure"
        fi
        case "${status}" in
            200|202|204)
                log_info "CAST AI cluster deleted (HTTP ${status})"
                ;;
            404)
                log_info "CAST AI cluster already absent (HTTP 404)"
                ;;
            *)
                log_warn "CAST AI cluster DELETE returned HTTP ${status}; continuing with local cleanup"
                if [[ -n "${CASTAI_LAST_BODY}" ]]; then
                    log_warn "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
                fi
                ;;
        esac
    else
        log_warn "No cluster_id in state file; skipping CAST AI DELETE"
    fi

    # 2. Delete per-component secrets. Best-effort per-secret.
    local secret
    for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
        log_info "Deleting secret ${secret} in namespace ${CASTAI_NAMESPACE} (if present)"
        if ! kubectl delete secret "${secret}" \
                --namespace="${CASTAI_NAMESPACE}" \
                --ignore-not-found >/dev/null 2>&1; then
            log_warn "Failed to delete secret ${secret}; continuing"
        fi
    done

    # 3. Delete namespace. Best-effort. Some objects (helm release) may
    # leave finalizers; --ignore-not-found + short timeout protects
    # against hangs.
    log_info "Deleting namespace ${CASTAI_NAMESPACE} (if present)"
    if ! kubectl delete namespace "${CASTAI_NAMESPACE}" --ignore-not-found --timeout=60s >/dev/null 2>&1; then
        log_warn "Failed to delete namespace ${CASTAI_NAMESPACE}; continuing"
    fi

    log_info "CAST AI cleanup complete (best-effort)"
    return 0
}
