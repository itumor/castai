#!/usr/bin/env bash
#
# lib/rotate-token.sh
#
# Token rotation library for the CAST AI token rotation E2E harness.
# Implements Chunk 4 of the plan:
#   - request a fresh cluster token via POST /v1/kubernetes/external-clusters/{id}/token
#   - update all five per-component secrets in place with the new token
#   - perform a concurrent rollout restart of all five deployments
#   - wait concurrently for all rollouts to complete (5 minute timeout each)
#   - collect component pod logs to artifacts/ on failure
#
# Public API:
#   rotate_token::rotate [skip_secret_name]
#       Runs the full rotation. If skip_secret_name is non-empty, the named
#       secret is left untouched (failure-simulation mode). All other
#       secrets are updated and all five deployments are restart-rolled.
#   rotate_token::simulate_missed_secret <secret_name>
#       Convenience wrapper that calls rotate_token::rotate with the
#       supplied secret name as the skipped one.
#
# Dry-run:
#   All live mutations (API calls, kubectl apply, kubectl rollout) are
#   skipped when ROTATE_TOKEN_DRY_RUN=true. Each function prints the
#   command it would have run instead. Dry-run mode does NOT require
#   APPROVE_LIVE_RUN.
#
# Approval gate:
#   Live mutations require APPROVE_LIVE_RUN=true. Otherwise the script
#   aborts with a clear message.

if [[ -n "${E2E_ROTATE_TOKEN_LOADED:-}" ]]; then
    return 0
fi
E2E_ROTATE_TOKEN_LOADED=1

# -----------------------------------------------------------------------------
# Path resolution (works whether the lib is sourced from run.sh or tests).
# -----------------------------------------------------------------------------
ROTATE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROTATE_E2E_DIR="$(cd "${ROTATE_LIB_DIR}/.." && pwd)"
ROTATE_ARTIFACTS_DIR="${ROTATE_ARTIFACTS_DIR:-${ROTATE_E2E_DIR}/artifacts}"

if [[ -z "${E2E_LOGGING_LOADED:-}" ]]; then
    # shellcheck source=lib/logging.sh
    source "${ROTATE_E2E_DIR}/lib/logging.sh"
fi

if [[ -z "${E2E_CASTAI_INSTALL_LOADED:-}" ]]; then
    # shellcheck source=lib/castai-install.sh
    source "${ROTATE_E2E_DIR}/lib/castai-install.sh"
fi

# -----------------------------------------------------------------------------
# Configuration (override via env vars if needed).
# -----------------------------------------------------------------------------
# Reuse the same namespace as the install library so secrets and
# deployments live in one place.
ROTATE_NAMESPACE="${ROTATE_NAMESPACE:-${CASTAI_NAMESPACE:-castai-agent}}"

# Dry-run switch. When true, every mutating call prints the command it
# would run instead of executing it. Mirrors the pattern used by
# CASTAI_DRY_RUN and E2E_CLUSTER_DRY_RUN in sibling libraries.
ROTATE_TOKEN_DRY_RUN="${ROTATE_TOKEN_DRY_RUN:-false}"

# Rollout timeout per deployment (5 minutes as specified by the plan).
ROTATE_ROLLOUT_TIMEOUT="${ROTATE_ROLLOUT_TIMEOUT:-300s}"

# In-memory storage of the new token captured from the rotation endpoint.
# Like CASTAI_CURRENT_TOKEN this stays in memory only and is NEVER
# persisted to disk.
ROTATE_NEW_TOKEN=""

# Fake token used by the dry-run code path. Matches the convention used
# by castai-install.sh (clearly labelled so it cannot be mistaken for a
# real token).
ROTATE_FAKE_TOKEN="dry-run-fake-rotated-token-bbbbbbbbbbbbbb"

# Token injected into the skipped secret during failure-simulation
# mode. CAST AI does not expose a synchronous token-revocation API, so
# the harness deliberately breaks the skipped secret with an obvious
# placeholder. When the component restarts it reads this value, fails
# authentication, and logs the customer symptom "401 Authorization
# Required". The string is intentionally not secret-shaped and is
# sanitized by name in report artifacts.
ROTATE_SIMULATION_INVALID_TOKEN="simulated-invalid-token-401-test-do-not-use"

# HTTP status of the most recent token-endpoint call. Stored as a
# module-level variable (and persisted to the state file) so the
# run.sh report can surface the real response code instead of an
# "unknown" placeholder.
ROTATE_TOKEN_ENDPOINT_STATUS=""

# Per-component deployments that consume the rotated secret. Each is
# restarted as part of the rotation so the new API_KEY is re-read.
# Order must match the castai::install.sh kind registry so the
# parallel-array lookup below stays aligned.
#
# Scope: only castai-agent and castai-cluster-controller are installed
# by this harness (see configs/castai-full-values.yaml). The rotation
# library still updates every per-component secret (see
# CASTAI_PER_COMPONENT_SECRETS in castai-install.sh) but only the
# deployments actually running in the cluster are restarted here.
ROTATE_COMPONENT_DEPLOYMENTS=(
    "castai-agent"
    "castai-cluster-controller"
)

# Best-effort components for the rotation scenario. Restart/wait
# failures on these are logged as warnings but do not fail the whole
# rotation. The list is intentionally empty now that only the two
# critical components are installed; the array is kept for backwards
# compatibility with rotate_token::_is_best_effort callers.
ROTATE_BEST_EFFORT_COMPONENTS=()

# Parallel array of label selectors used to discover a component's
# pods when collecting logs on failure. Order must match
# ROTATE_COMPONENT_DEPLOYMENTS. bash 3.2 has no associative arrays
# so we keep the mapping implicit via index.
ROTATE_COMPONENT_POD_SELECTORS=(
    "app.kubernetes.io/name=castai-agent"
    "app.kubernetes.io/name=castai-cluster-controller"
)

# -----------------------------------------------------------------------------
# Approval gate
# -----------------------------------------------------------------------------

# Refuses to perform a live mutation unless APPROVE_LIVE_RUN=true.
# In dry-run mode this is a no-op so test scripts can exercise every path.
rotate_token::_require_live_approval() {
    if [[ "${ROTATE_TOKEN_DRY_RUN}" == "true" ]]; then
        return 0
    fi
    if [[ "${APPROVE_LIVE_RUN:-}" != "true" ]]; then
        log_error "Live rotation requested but APPROVE_LIVE_RUN is not 'true'."
        log_error "Set APPROVE_LIVE_RUN=true after human review to proceed."
        log_error "Live mutations covered: CAST AI API, Kubernetes Secret apply, Deployment rollout."
        return 1
    fi
    return 0
}

# -----------------------------------------------------------------------------
# State file helpers
# -----------------------------------------------------------------------------

rotate_token::_ensure_artifacts_dir() {
    if [[ ! -d "${ROTATE_ARTIFACTS_DIR}" ]]; then
        mkdir -p "${ROTATE_ARTIFACTS_DIR}"
    fi
}

# Read a key from the state file written by castai-install.sh. Empty if
# the key is absent or jq is unavailable.
rotate_token::_state_get() {
    local key="$1"
    if [[ -f "${CASTAI_STATE_FILE:-${ROTATE_ARTIFACTS_DIR}/e2e-state.json}" ]] \
            && command -v jq >/dev/null 2>&1; then
        jq -r --arg k "${key}" '.[$k] // empty' "${CASTAI_STATE_FILE:-${ROTATE_ARTIFACTS_DIR}/e2e-state.json}" 2>/dev/null
    fi
}

# Write a key into the state file. Preserves any existing keys. Used
# to record non-secret metadata such as the token endpoint response
# code so the run.sh report can read it later.
rotate_token::_state_set() {
    local key="$1"
    local value="$2"
    local state_file="${CASTAI_STATE_FILE:-${ROTATE_ARTIFACTS_DIR}/e2e-state.json}"
    rotate_token::_ensure_artifacts_dir
    if ! command -v jq >/dev/null 2>&1; then
        log_warn "rotate_token::_state_set: jq not available; cannot persist ${key}"
        return 1
    fi
    local tmp
    tmp="$(mktemp)"
    if [[ -f "${state_file}" ]]; then
        if ! jq --arg k "${key}" --arg v "${value}" '.[$k] = $v' "${state_file}" > "${tmp}" 2>/dev/null; then
            rm -f "${tmp}"
            log_warn "rotate_token::_state_set: failed to update state file ${state_file}"
            return 1
        fi
    else
        if ! jq -n --arg k "${key}" --arg v "${value}" '{($k): $v}' > "${tmp}" 2>/dev/null; then
            rm -f "${tmp}"
            log_warn "rotate_token::_state_set: failed to create state file ${state_file}"
            return 1
        fi
    fi
    mv "${tmp}" "${state_file}"
    return 0
}

# -----------------------------------------------------------------------------
# CAST AI API: request a fresh cluster token
# -----------------------------------------------------------------------------

# rotate_token::_request_new_token <cluster_id>
#   Calls POST /v1/kubernetes/external-clusters/{clusterId}/token and
#   stores the new token in ROTATE_NEW_TOKEN as a side effect. Returns
#   0 on success and 1 on failure (terminal or HTTP non-2xx).
#   NOTE: Must run in the caller's shell so ROTATE_NEW_TOKEN is visible
#   to subsequent calls. Do not wrap this in $().
rotate_token::_request_new_token() {
    local cluster_id="$1"

    if [[ -z "${cluster_id}" ]]; then
        log_error "rotate_token::_request_new_token: cluster_id is required"
        return 1
    fi

    log_step "Requesting fresh cluster token via POST /v1/kubernetes/external-clusters/${cluster_id}/token"

    if [[ "${ROTATE_TOKEN_DRY_RUN}" == "true" ]]; then
        local masked
        masked="$(mask_value "${CASTAI_API_KEY:-}")"
        log_info "[DRY-RUN] would execute: curl -sS -X POST -H 'X-API-Key: ${masked}' -H 'Accept: application/json' -H 'Content-Type: application/json' ${CASTAI_API_BASE:-}/v1/kubernetes/external-clusters/${cluster_id}/token"
        log_info "[DRY-RUN] assuming response 200 with fake token (token never logged)"
        ROTATE_NEW_TOKEN="${ROTATE_FAKE_TOKEN}"
        ROTATE_TOKEN_ENDPOINT_STATUS="200 (dry-run)"
        # Persist so the run.sh report can read it from the state file
        # even when invoked from a different shell scope.
        rotate_token::_state_set "token_endpoint_status" "${ROTATE_TOKEN_ENDPOINT_STATUS}"
        log_info "Token endpoint responded with HTTP 200 (dry-run)"
        return 0
    fi

    # Reuse the install library's approval gate / base URL. We inline
    # the curl call here so the response body stays in *this* shell
    # (castai::_api_call would set CASTAI_LAST_BODY inside a $()
    # subshell, which we could not read from here).
    castai::_require_live_approval || return 1
    if [[ -z "${CASTAI_API_BASE:-}" || -z "${CASTAI_API_KEY:-}" ]]; then
        log_error "CASTAI_API_BASE and CASTAI_API_KEY are required for live token rotation"
        return 1
    fi

    local url="${CASTAI_API_BASE}/v1/kubernetes/external-clusters/${cluster_id}/token"
    local tmp_body status
    tmp_body="$(mktemp)"
    status="$(curl -sS -o "${tmp_body}" -w '%{http_code}' \
        -X POST \
        -H "X-API-Key: ${CASTAI_API_KEY}" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        "${url}" || true)"
    if [[ "${status}" != "200" && "${status}" != "201" ]]; then
        log_error "POST .../${cluster_id}/token returned HTTP ${status}"
        if [[ -s "${tmp_body}" ]]; then
            log_error "Response: $(sanitize_text "$(cat "${tmp_body}")")"
        fi
        rm -f "${tmp_body}"
        return 1
    fi

    # The response is documented to contain a "clusterToken" field, but we
    # also accept a "token" alias in case the API surface changes.
    local parsed_token
    parsed_token="$(jq -r '.clusterToken // .token // empty' "${tmp_body}" 2>/dev/null || true)"
    rm -f "${tmp_body}"
    if [[ -z "${parsed_token}" ]]; then
        log_error "Token rotation response missing clusterToken"
        return 1
    fi
    ROTATE_NEW_TOKEN="${parsed_token}"
    ROTATE_TOKEN_ENDPOINT_STATUS="${status}"
    rotate_token::_state_set "token_endpoint_status" "${status}"
    log_info "New cluster token captured in memory (never persisted)"
    log_info "Token endpoint responded with HTTP ${status}"
    return 0
}

# -----------------------------------------------------------------------------
# Secret updates
# -----------------------------------------------------------------------------

# rotate_token::_update_secret <secret_name> <new_token>
#   Updates a single per-component secret in place. Uses
#   `kubectl create secret generic --dry-run=client -o yaml | kubectl apply -f -`
#   so re-runs are idempotent (apply replaces the existing secret rather
#   than failing with "already exists"). In dry-run mode the command is
#   printed and no API or Kubernetes call is made.
rotate_token::_update_secret() {
    local secret_name="$1"
    local new_token="$2"

    if [[ -z "${secret_name}" || -z "${new_token}" ]]; then
        log_error "rotate_token::_update_secret: usage: rotate_token::_update_secret <secret_name> <new_token>"
        return 1
    fi

    if [[ "${ROTATE_TOKEN_DRY_RUN}" == "true" ]]; then
        log_info "[DRY-RUN] would execute: kubectl create secret generic ${secret_name} --namespace=${ROTATE_NAMESPACE} --from-literal=API_KEY=<new-token> --dry-run=client -o yaml | kubectl apply -f -"
        return 0
    fi

    log_info "Updating secret ${secret_name} in namespace ${ROTATE_NAMESPACE}"
    kubectl create secret generic "${secret_name}" \
        --namespace="${ROTATE_NAMESPACE}" \
        --from-literal="API_KEY=${new_token}" \
        --dry-run=client -o yaml | kubectl apply -f -
}

# Update every per-component secret except the skipped one. The skipped
# secret (when provided) is logged explicitly so post-mortem artifacts
# make it obvious which component is supposed to fail.
#
# In failure-simulation mode the skipped secret is overwritten with an
# intentionally invalid token. CAST AI does not synchronously revoke the
# previous token when a new one is issued, so leaving the old token in
# place would not reproduce the customer symptom. The placeholder value
# forces the component to authenticate with a bad token and surface the
# expected "401 Authorization Required" log line.
rotate_token::_update_all_secrets() {
    local skip_secret="${1:-}"
    local new_token="${ROTATE_NEW_TOKEN}"
    if [[ -z "${new_token}" ]]; then
        log_error "rotate_token::_update_all_secrets: no new token in memory"
        return 1
    fi

    local secret updated=0 skipped=0
    for secret in "${CASTAI_PER_COMPONENT_SECRETS[@]}"; do
        if [[ -n "${skip_secret}" && "${secret}" == "${skip_secret}" ]]; then
            skipped=$((skipped + 1))
            log_warn "Failure-simulation mode: replacing secret ${secret} with an invalid token"
            if ! rotate_token::_update_secret "${secret}" "${ROTATE_SIMULATION_INVALID_TOKEN}"; then
                log_error "Failed to inject invalid token into secret ${secret}"
                return 1
            fi
            continue
        fi
        if ! rotate_token::_update_secret "${secret}" "${new_token}"; then
            log_error "Failed to update secret ${secret}"
            return 1
        fi
        updated=$((updated + 1))
    done

    log_info "Updated ${updated} per-component secret(s) (skipped=${skipped}) in namespace ${ROTATE_NAMESPACE}"
}

# -----------------------------------------------------------------------------
# Rollout restart + concurrent wait
# -----------------------------------------------------------------------------

# Collect logs from every component's pods into artifacts/ for
# post-mortem analysis. Called when a rollout fails.
rotate_token::_collect_failure_logs() {
    rotate_token::_ensure_artifacts_dir
    local deployment selector i
    for i in "${!ROTATE_COMPONENT_DEPLOYMENTS[@]}"; do
        deployment="${ROTATE_COMPONENT_DEPLOYMENTS[$i]}"
        selector="${ROTATE_COMPONENT_POD_SELECTORS[$i]}"
        local log_file="${ROTATE_ARTIFACTS_DIR}/${deployment}-failure.log"
        log_warn "Collecting failure logs for ${deployment} -> ${log_file}"
        if [[ "${ROTATE_TOKEN_DRY_RUN}" == "true" ]]; then
            {
                printf '[DRY-RUN] would execute: kubectl -n %s logs --tail=200 -l %s --all-containers=true --timestamps=true\n' \
                    "${ROTATE_NAMESPACE}" "${selector}"
            } > "${log_file}" 2>/dev/null || true
            continue
        fi
        # `kubectl logs -l ...` only emits logs from currently-running
        # pods; capture both stdout and stderr so errors during eviction
        # are preserved. Sanitize before writing so tokens never land in
        # artifacts.
        local raw
        raw="$(kubectl -n "${ROTATE_NAMESPACE}" logs --tail=200 -l "${selector}" \
                --all-containers=true --timestamps=true 2>&1 || true)"
        sanitize_text "${raw}" > "${log_file}" 2>/dev/null || true
    done
}

# Rotate-token helpers around the castai install kind registry. Kept
# here (instead of going through castai::*) so the rotate library
# keeps a single dependency direction and stays usable when only
# rotate-token.sh is sourced in a test.

# rotate_token::_kind_of <component>
#   Echoes the Kubernetes kind ("deployment" or "daemonset") of the
#   named umbrella-chart component, sourced from the castai install
#   registry when available. Falls back to "deployment" for unknown
#   names so the rotate command still runs (and fails informatively)
#   on components the harness does not yet know about.
rotate_token::_kind_of() {
    local component="$1"
    if declare -F castai::_kind_of >/dev/null 2>&1; then
        castai::_kind_of "${component}"
        return 0
    fi
    printf 'deployment'
    return 0
}

# rotate_token::_is_best_effort <component>
#   Returns 0 when the component is best-effort (restart/wait
#   failures are logged as warnings instead of failing the rotation).
#   Returns 1 for critical components and unknown names.
rotate_token::_is_best_effort() {
    local component="$1"
    local c
    if [[ ${#ROTATE_BEST_EFFORT_COMPONENTS[@]} -eq 0 ]]; then
        return 1
    fi
    for c in "${ROTATE_BEST_EFFORT_COMPONENTS[@]}"; do
        if [[ "${c}" == "${component}" ]]; then
            return 0
        fi
    done
    return 1
}

# Kick off concurrent `kubectl rollout restart` jobs for every
# component. Background jobs MUST be spawned in the same shell that
# will eventually call wait() on them; PIDs from inside a $()
# command substitution get reparented to init and wait() refuses to
# track them. Callers should background this function's work inside
# their own shell and wait on the resulting PIDs. In dry-run mode the
# would-be command is logged and a trivial subshell is spawned so the
# wait() pattern is still exercisable.
rotate_token::_kick_off_restart() {
    local deployment kind
    for deployment in "${ROTATE_COMPONENT_DEPLOYMENTS[@]}"; do
        kind="$(rotate_token::_kind_of "${deployment}")"
        if [[ "${ROTATE_TOKEN_DRY_RUN}" == "true" ]]; then
            log_info "[DRY-RUN] would execute: kubectl rollout restart ${kind}/${deployment} --namespace=${ROTATE_NAMESPACE}"
            (exit 0) &
        else
            log_info "Triggering rollout restart for ${kind}/${deployment}"
            kubectl rollout restart "${kind}/${deployment}" \
                --namespace="${ROTATE_NAMESPACE}" &
        fi
    done
}

# Wait for every component's rollout to complete concurrently. Each
# `kubectl rollout status` runs in its own background process with the
# shared timeout. The kind of each component is read from the castai
# install registry so the same function handles Deployments and
# DaemonSets correctly. Best-effort component failures are logged as
# warnings and never cause the rotation to fail; only a failure on a
# critical component (castai-agent, castai-cluster-controller)
# triggers the overall failure path. Returns non-zero on a critical
# component failure and triggers failure-log collection. In dry-run
# mode the would-be command is logged and a stub background job
# (write 0 to the rc file) is used so the wait pattern is still
# exercised end-to-end.
rotate_token::_wait_for_rollouts() {
    local -a status_pids=()
    local -a status_deployments=()
    local deployment kind exit_code pid rc_file

    rc_file="$(mktemp)"
    # Clean up rc files when this function returns. The glob is expanded
    # at trap-fire time, so ${rc_file}.* picks up every per-deployment rc
    # file regardless of how many there are.
    # shellcheck disable=SC2064
    trap "rm -f ${rc_file}.* 2>/dev/null || true" RETURN

    for deployment in "${ROTATE_COMPONENT_DEPLOYMENTS[@]}"; do
        kind="$(rotate_token::_kind_of "${deployment}")"
        log_info "Waiting for ${kind}/${deployment} rollout (timeout ${ROTATE_ROLLOUT_TIMEOUT})"
        if [[ "${ROTATE_TOKEN_DRY_RUN}" == "true" ]]; then
            log_info "[DRY-RUN] would execute: kubectl rollout status ${kind}/${deployment} --namespace=${ROTATE_NAMESPACE} --timeout=${ROTATE_ROLLOUT_TIMEOUT}"
            (
                printf '0\n' > "${rc_file}.${deployment}"
            ) &
            status_pids+=("$!")
        else
            (
                if kubectl rollout status "${kind}/${deployment}" \
                        --namespace="${ROTATE_NAMESPACE}" \
                        --timeout="${ROTATE_ROLLOUT_TIMEOUT}"; then
                    printf '0\n' > "${rc_file}.${deployment}"
                else
                    printf '1\n' > "${rc_file}.${deployment}"
                fi
            ) &
            status_pids+=("$!")
        fi
        status_deployments+=("${deployment}")
    done

    # Wait for all rollout checks. Iterate explicitly so we can collect
    # individual PIDs without losing their exit codes. Individual rc
    # codes are read from the rc files below; the wait() exit status
    # is intentionally ignored because one slow background job could
    # otherwise taint the whole wait loop.
    for pid in "${status_pids[@]}"; do
        wait "${pid}" 2>/dev/null || true
    done

    # Aggregate per-deployment rc files. Best-effort failures are
    # downgraded to warnings so a flaky spot-handler/kvisor rollout
    # does not fail the whole rotation.
    local failed=0 warned=0
    for deployment in "${status_deployments[@]}"; do
        if [[ -f "${rc_file}.${deployment}" ]]; then
            exit_code="$(cat "${rc_file}.${deployment}" 2>/dev/null || echo 1)"
        else
            exit_code=1
        fi
        if (( exit_code != 0 )); then
            if rotate_token::_is_best_effort "${deployment}"; then
                warned=$((warned + 1))
                log_warn "Best-effort component ${deployment} rollout did not complete; continuing"
            else
                failed=$((failed + 1))
                log_error "Critical component ${deployment} rollout did not complete"
            fi
        fi
    done

    if (( failed > 0 )); then
        log_error "One or more critical components failed to roll out (failed=${failed}, best-effort warnings=${warned})"
        rotate_token::_collect_failure_logs
        return 1
    fi

    if (( warned > 0 )); then
        log_warn "Rotation completed with ${warned} best-effort rollout warning(s) (not treated as failure)"
    fi
    log_info "All ${#ROTATE_COMPONENT_DEPLOYMENTS[@]} components rolled out successfully (best-effort warnings=${warned})"
    return 0
}

# -----------------------------------------------------------------------------
# Public entrypoint: rotate_token::rotate
# -----------------------------------------------------------------------------

# rotate_token::rotate [skip_secret_name]
#   Reads cluster_id from artifacts/e2e-state.json, requests a fresh
#   token, updates every per-component secret (optionally skipping one),
#   and triggers a concurrent rollout restart + wait.
rotate_token::rotate() {
    local skip_secret="${1:-}"

    rotate_token::_require_live_approval || return 1

    local cluster_id
    cluster_id="$(rotate_token::_state_get cluster_id)"
    if [[ -z "${cluster_id}" ]]; then
        log_error "rotate_token::rotate: cluster_id not found in state file (${CASTAI_STATE_FILE:-e2e-state.json})"
        log_error "Run castai::register_cluster first."
        return 1
    fi

    log_step "Rotating CAST AI cluster token for cluster $(mask_value "${cluster_id}")"
    if [[ -n "${skip_secret}" ]]; then
        log_warn "Failure-simulation mode active: secret '${skip_secret}' will NOT be updated"
    fi

    # 1. Request new token. The function sets ROTATE_NEW_TOKEN as a
    # side effect in this shell; do not wrap it in $().
    rotate_token::_request_new_token "${cluster_id}" || return 1

    # 2. Update every per-component secret (skipping the failure target).
    rotate_token::_update_all_secrets "${skip_secret}" || return 1

    # 3. Kick off concurrent rollout restart. The helper backgrounds
    # every `kubectl rollout restart` in *this* shell so the PIDs stay
    # children of rotate_token::rotate and wait() can reap them. Dry-run
    # mode spawns trivial subshells so the concurrency pattern is still
    # exercised end-to-end.
    rotate_token::_kick_off_restart || return 1
    # Reap every background job started above. `wait` without args
    # blocks until all children exit and returns the exit code of the
    # last one; we ignore that code and rely on the rollout-status
    # checks below to detect per-deployment failures.
    wait 2>/dev/null || true

    # 4. Wait for every rollout to finish.
    rotate_token::_wait_for_rollouts || return 1

    log_info "Token rotation completed successfully"
    return 0
}

# rotate_token::simulate_missed_secret <secret_name>
#   Thin wrapper that calls rotate_token::rotate with the supplied secret
#   name as the one to skip. Used by the failure-simulation mode to
#   reproduce the customer failure where a component keeps using the
#   stale token.
rotate_token::simulate_missed_secret() {
    local skip_secret="$1"

    if [[ -z "${skip_secret}" ]]; then
        log_error "rotate_token::simulate_missed_secret: usage: rotate_token::simulate_missed_secret <secret_name>"
        return 1
    fi

    # Allow caller to pass any secret name; validation of "is this a
    # known component secret" is left to the rotation loop so the public
    # surface is forgiving when the catalog grows.
    rotate_token::rotate "${skip_secret}"
}
