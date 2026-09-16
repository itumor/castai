#!/usr/bin/env bash
#
# lib/verify-components.sh
#
# Component verification library for the CAST AI token rotation E2E
# harness. Implements the post-rotation checks described in Chunk 4 of
# the plan:
#   - inspect every component pod's log tail for the "401 Authorization
#     Required" symptom (happy path: must be absent; failure-simulation:
#     present only in the expected component)
#   - confirm every component deployment is Ready
#   - poll the CAST AI API for cluster status = ready|connected and a
#     recent lastHeartbeatTime (< 5 minutes)
#
# Public API:
#   verify_components::check_logs_for_401 [expected_failing_component]
#       Tails last 50 log lines from every component pod. In default
#       (happy-path) mode fails on ANY 401. In failure-simulation mode
#       (expected_failing_component non-empty) fails unless the 401 is
#       present *only* on the named component.
#   verify_components::check_rollout_status
#       Verifies every component deployment reports Ready.
#   verify_components::check_castai_api
#       Polls GET /v1/kubernetes/external-clusters/{clusterId} up to 12
#       times every 10 seconds. Verifies status is "ready"/"connected"
#       and lastHeartbeatTime is within the last 5 minutes when present.
#   verify_components::run [expected_failing_component]
#       Orchestrates all of the above and prints a pass/fail summary.
#       Returns 0 only when every check passes.
#
# Dry-run:
#   Every live read/write (kubectl logs, kubectl get, curl) is skipped
#   when VERIFY_COMPONENTS_DRY_RUN=true. Each function prints the
#   check it would have run instead. Dry-run does NOT require
#   APPROVE_LIVE_RUN.
#
# Approval gate:
#   Reads against CAST AI API or Kubernetes do not require
#   APPROVE_LIVE_RUN. Callers are expected to have already gated the
#   *rotation* behind APPROVE_LIVE_RUN; verification follows.

if [[ -n "${E2E_VERIFY_COMPONENTS_LOADED:-}" ]]; then
    return 0
fi
E2E_VERIFY_COMPONENTS_LOADED=1

# -----------------------------------------------------------------------------
# Path resolution (works whether the lib is sourced from run.sh or tests).
# -----------------------------------------------------------------------------
VERIFY_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_E2E_DIR="$(cd "${VERIFY_LIB_DIR}/.." && pwd)"
VERIFY_ARTIFACTS_DIR="${VERIFY_ARTIFACTS_DIR:-${VERIFY_E2E_DIR}/artifacts}"

if [[ -z "${E2E_LOGGING_LOADED:-}" ]]; then
    # shellcheck source=lib/logging.sh
    source "${VERIFY_E2E_DIR}/lib/logging.sh"
fi

if [[ -z "${E2E_CASTAI_INSTALL_LOADED:-}" ]]; then
    # shellcheck source=lib/castai-install.sh
    source "${VERIFY_E2E_DIR}/lib/castai-install.sh"
fi

# -----------------------------------------------------------------------------
# Configuration (override via env vars if needed).
# -----------------------------------------------------------------------------
VERIFY_NAMESPACE="${VERIFY_NAMESPACE:-${CASTAI_NAMESPACE:-castai-agent}}"
VERIFY_COMPONENTS_DRY_RUN="${VERIFY_COMPONENTS_DRY_RUN:-false}"

# How many log lines to collect per pod when checking for 401s. The
# plan specifies "last 50 lines".
VERIFY_LOG_TAIL_LINES="${VERIFY_LOG_TAIL_LINES:-50}"

# API polling: 12 attempts, 10 seconds apart, per the plan.
VERIFY_API_MAX_ATTEMPTS="${VERIFY_API_MAX_ATTEMPTS:-12}"
VERIFY_API_SLEEP_SECONDS="${VERIFY_API_SLEEP_SECONDS:-10}"

# Heartbeat freshness threshold: 5 minutes (per the plan).
VERIFY_HEARTBEAT_MAX_AGE_SECONDS="${VERIFY_HEARTBEAT_MAX_AGE_SECONDS:-300}"

# The string we hunt for in component logs. Matches the symptom seen on
# ngm-sim2-eks.
VERIFY_401_MARKER="401 Authorization Required"

# Component deployments to verify. Mirrors the rotation library so the
# two stay in lock-step. Order MUST stay aligned with
# VERIFY_COMPONENT_POD_SELECTORS (bash 3.2 has no associative arrays).
#
# Scope: only castai-agent and castai-cluster-controller are installed
# by this harness (see configs/castai-full-values.yaml), so this list
# is intentionally narrow. Verifying logs on absent deployments would
# produce spurious "DRY-RUN would scan" lines without exercising real
# component pods.
VERIFY_COMPONENT_DEPLOYMENTS=(
    "castai-agent"
    "castai-cluster-controller"
)

# Per-component pod label selector (parallel array). Bash 3.2 does not
# have associative arrays so we keep the mapping implicit via index.
VERIFY_COMPONENT_POD_SELECTORS=(
    "app.kubernetes.io/name=castai-agent"
    "app.kubernetes.io/name=castai-cluster-controller"
)

# File holding per-deployment rollout status (deployment<TAB>status
# lines) so run::write_report can render the actual status rather than
# a hardcoded "Ready". Lives under artifacts/ so live runs and
# dry-runs both produce the same surface for downstream consumers.
VERIFY_ROLLOUT_STATUS_FILE="${VERIFY_ROLLOUT_STATUS_FILE:-${VERIFY_ARTIFACTS_DIR}/rollout-status.tsv}"

# Track per-component 401 hit counts so the orchestrator can produce a
# readable summary even when checks run in isolation.
declare -a VERIFY_401_HIT_COUNTS=()

# -----------------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------------

verify_components::_ensure_artifacts_dir() {
    if [[ ! -d "${VERIFY_ARTIFACTS_DIR}" ]]; then
        mkdir -p "${VERIFY_ARTIFACTS_DIR}"
    fi
}

# Cross-platform "now in seconds since epoch". GNU date supports
# +%s, macOS /usr/bin/date supports it too. Fall back to a perl
# one-liner only if absolutely necessary.
verify_components::_now_epoch() {
    date -u +%s 2>/dev/null || perl -e 'print time'
}

# Tail the most recent N log lines from every pod matching a label
# selector. Echoes the combined log buffer on stdout. Sanitizes known
# env-var secrets before returning so callers can safely embed the
# result in artifacts/log output. In dry-run mode a placeholder block
# is emitted.
verify_components::_collect_logs() {
    local selector="$1"
    local label="$2"

    if [[ "${VERIFY_COMPONENTS_DRY_RUN}" == "true" ]]; then
        printf '[DRY-RUN] would execute: kubectl -n %s logs --tail=%s -l %s --all-containers=true --timestamps=true\n' \
            "${VERIFY_NAMESPACE}" "${VERIFY_LOG_TAIL_LINES}" "${selector}"
        return 0
    fi

    local raw
    raw="$(kubectl -n "${VERIFY_NAMESPACE}" logs --tail="${VERIFY_LOG_TAIL_LINES}" \
            -l "${selector}" --all-containers=true --timestamps=true 2>&1 || true)"
    sanitize_text "${raw}"
}

# Count occurrences of the 401 marker in a string. Uses grep -c on a
# here-string for portability with bash 3.2. We capture grep's stdout
# into a local variable so a 0-match exit code does not trigger the
# fallback `printf '0'` and produce "0\n0" on the function's stdout.
verify_components::_count_401s() {
    local text="${1-}"
    if [[ -z "${text}" ]]; then
        printf '0'
        return 0
    fi
    local hits
    hits="$(printf '%s' "${text}" | grep -c "${VERIFY_401_MARKER}" 2>/dev/null || true)"
    # Force a single numeric value even when hits is empty.
    if [[ -z "${hits}" ]]; then
        printf '0'
    else
        printf '%s' "${hits}"
    fi
}

# -----------------------------------------------------------------------------
# Log scan
# -----------------------------------------------------------------------------

# verify_components::check_logs_for_401 [expected_failing_component]
#
# Tail last 50 lines from each component pod and look for the 401 marker.
# In default (happy-path) mode returns 0 only if NO component saw a 401.
# In failure-simulation mode (expected_failing_component non-empty)
# returns 0 only if *exactly* the expected component has 401 hits and
# every other component is clean. Echoes a per-component summary table
# on stdout so the orchestrator can include it in the report.
verify_components::check_logs_for_401() {
    local expected_failing="${1:-}"

    log_step "Scanning component pod logs for '${VERIFY_401_MARKER}' (expected_failing=$(mask_value "${expected_failing}"))"

    local i deployment selector log_text hits
    local total_violations=0
    VERIFY_401_HIT_COUNTS=()

    for i in "${!VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
        deployment="${VERIFY_COMPONENT_DEPLOYMENTS[$i]}"
        selector="${VERIFY_COMPONENT_POD_SELECTORS[$i]}"

        if [[ "${VERIFY_COMPONENTS_DRY_RUN}" == "true" ]]; then
            log_info "[DRY-RUN] would scan logs for component ${deployment} (selector=${selector})"
            log_info "[DRY-RUN] component ${deployment}: 401 hits would be reported"
            VERIFY_401_HIT_COUNTS+=(0)
            printf 'component=%s selector=%s hits=0 dry_run=true\n' "${deployment}" "${selector}"
            continue
        fi

        log_text="$(verify_components::_collect_logs "${selector}" "${deployment}")"
        hits="$(verify_components::_count_401s "${log_text}")"
        VERIFY_401_HIT_COUNTS+=("${hits}")

        if (( hits > 0 )); then
            log_warn "Component ${deployment} produced ${hits} '${VERIFY_401_MARKER}' line(s)"
            # Persist the offending snippet to artifacts/ so the post-mortem
            # has the exact evidence (already sanitized by collect_logs).
            verify_components::_ensure_artifacts_dir
            {
                printf 'component=%s selector=%s\n' "${deployment}" "${selector}"
                printf '%s\n' "${log_text}"
            } > "${VERIFY_ARTIFACTS_DIR}/${deployment}-401.log" 2>/dev/null || true
        else
            log_info "Component ${deployment} has no '${VERIFY_401_MARKER}' lines"
        fi

        printf 'component=%s selector=%s hits=%s\n' "${deployment}" "${selector}" "${hits}"
    done

    # Evaluate the policy based on the hit map.
    if [[ -z "${expected_failing}" ]]; then
        # Happy-path: any 401 is a failure.
        for i in "${!VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
            if (( VERIFY_401_HIT_COUNTS[i] > 0 )); then
                total_violations=$((total_violations + VERIFY_401_HIT_COUNTS[i]))
            fi
        done
        if (( total_violations > 0 )); then
            log_error "Happy-path check failed: ${total_violations} unexpected '${VERIFY_401_MARKER}' occurrence(s)"
            return 1
        fi
        log_info "Happy-path check passed: no '${VERIFY_401_MARKER}' occurrences"
        return 0
    fi

    # Failure-simulation: only the expected component may have 401s.
    local expected_index=-1
    for i in "${!VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
        if [[ "${VERIFY_COMPONENT_DEPLOYMENTS[$i]}" == "${expected_failing}" ]]; then
            expected_index="${i}"
            break
        fi
    done
    if (( expected_index < 0 )); then
        # Fall back to matching the per-component secret name. This lets
        # callers pass either the deployment ("castai-cluster-controller")
        # or the secret ("castai-cluster-controller-token").
        for i in "${!VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
            if [[ "${CASTAI_PER_COMPONENT_SECRETS[$i]}" == "${expected_failing}" ]]; then
                expected_index="${i}"
                expected_failing="${VERIFY_COMPONENT_DEPLOYMENTS[$i]}"
                break
            fi
        done
    fi
    if (( expected_index < 0 )); then
        log_error "Failure-simulation check: expected failing component '${expected_failing}' is not a known component"
        return 1
    fi

    local unexpected=0
    for i in "${!VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
        if (( i == expected_index )); then
            if (( VERIFY_401_HIT_COUNTS[i] == 0 )); then
                log_error "Failure-simulation check failed: expected '${VERIFY_401_MARKER}' on ${expected_failing} but found none"
                return 1
            fi
            continue
        fi
        if (( VERIFY_401_HIT_COUNTS[i] > 0 )); then
            unexpected=$((unexpected + VERIFY_401_HIT_COUNTS[i]))
            log_error "Failure-simulation check failed: unexpected '${VERIFY_401_MARKER}' on ${VERIFY_COMPONENT_DEPLOYMENTS[$i]}"
        fi
    done

    if (( unexpected > 0 )); then
        return 1
    fi
    log_info "Failure-simulation check passed: only ${expected_failing} produced '${VERIFY_401_MARKER}'"
    return 0
}

# -----------------------------------------------------------------------------
# Rollout status
# -----------------------------------------------------------------------------

# verify_components::_kind_of <component>
#   Echoes the Kubernetes kind ("deployment" or "daemonset") of the
#   named umbrella-chart component, sourced from the castai install
#   registry when available. Falls back to "deployment" for unknown
#   names. castai-spot-handler and castai-kvisor-agent are DaemonSets
#   in the umbrella chart; the rest are Deployments.
verify_components::_kind_of() {
    local component="$1"
    if declare -F castai::_kind_of >/dev/null 2>&1; then
        castai::_kind_of "${component}"
        return 0
    fi
    # Local fallback mirroring the castai install registry so this
    # library still works when only verify-components.sh is sourced
    # (e.g. in tests that do not pull in castai-install.sh).
    case "${component}" in
        castai-spot-handler|castai-kvisor-agent) printf 'daemonset' ;;
        *) printf 'deployment' ;;
    esac
}

# verify_components::check_rollout_status
#   Runs `kubectl rollout status` against every component with a
#   short timeout (60s per component). This is a sanity check that
#   the components are still Ready after rotation; the rotation
#   library itself does the long-wait concurrent rollout with a 5
#   minute timeout. The kind of each component (Deployment vs
#   DaemonSet) is read from the castai install registry so the same
#   function handles both correctly. Best-effort components
#   (spot-handler, evictor, workload-autoscaler, kvisor) downgrade
#   a rollout failure from ERROR to WARN so the rotation run is not
#   failed by a flaky ancillary component.
verify_components::check_rollout_status() {
    local deployment kind
    log_step "Verifying every component reports Ready"

    # Reset the status file so each run produces a fresh, accurate
    # snapshot regardless of prior state on disk.
    verify_components::_ensure_artifacts_dir
    : > "${VERIFY_ROLLOUT_STATUS_FILE}"

    local rc=0 status
    for deployment in "${VERIFY_COMPONENT_DEPLOYMENTS[@]}"; do
        kind="$(verify_components::_kind_of "${deployment}")"
        if [[ "${VERIFY_COMPONENTS_DRY_RUN}" == "true" ]]; then
            log_info "[DRY-RUN] would execute: kubectl rollout status ${kind}/${deployment} --namespace=${VERIFY_NAMESPACE} --timeout=60s"
            status="Ready (dry-run)"
            printf 'component=%s ready=true dry_run=true\n' "${deployment}"
        elif kubectl rollout status "${kind}/${deployment}" \
                --namespace="${VERIFY_NAMESPACE}" \
                --timeout=60s >/dev/null 2>&1; then
            log_info "Component ${deployment} (${kind}) is Ready"
            status="Ready"
            printf 'component=%s ready=true\n' "${deployment}"
        else
            if castai::_is_critical "${deployment}" 2>/dev/null; then
                log_error "Critical component ${deployment} (${kind}) is NOT Ready"
                status="NotReady"
                rc=1
            else
                log_warn "Best-effort component ${deployment} (${kind}) is NOT Ready; continuing"
                status="NotReady (best-effort)"
            fi
            printf 'component=%s ready=false\n' "${deployment}"
        fi
        # Persist as TSV: deployment<TAB>status. Append-only so the
        # file's line order matches VERIFY_COMPONENT_DEPLOYMENTS.
        printf '%s\t%s\n' "${deployment}" "${status}" >> "${VERIFY_ROLLOUT_STATUS_FILE}"
    done

    return "${rc}"
}

# verify_components::read_rollout_status <deployment>
#   Reads the recorded status for a single deployment from the TSV
#   status file. Returns "Unknown" when no record exists.
verify_components::read_rollout_status() {
    local deployment="$1"
    if [[ -z "${deployment}" ]]; then
        die "verify_components::read_rollout_status: usage: verify_components::read_rollout_status <deployment>"
    fi
    if [[ ! -r "${VERIFY_ROLLOUT_STATUS_FILE}" ]]; then
        printf 'Unknown'
        return 0
    fi
    local status
    status="$(awk -F '\t' -v dep="${deployment}" '$1 == dep { print $2; exit }' "${VERIFY_ROLLOUT_STATUS_FILE}")"
    if [[ -z "${status}" ]]; then
        printf 'Unknown'
    else
        printf '%s' "${status}"
    fi
    return 0
}

# -----------------------------------------------------------------------------
# API verification
# -----------------------------------------------------------------------------

# verify_components::check_castai_api
#   Poll GET /v1/kubernetes/external-clusters/{clusterId} up to 12 times
#   every 10 seconds. Verify status is "ready"/"connected" and
#   lastHeartbeatTime is within the last 5 minutes when present. Returns
#   0 on success, 1 on terminal failure, 2 on exhausted retries.
verify_components::check_castai_api() {
    local cluster_id
    cluster_id="$(jq -r '.cluster_id // empty' "${CASTAI_STATE_FILE:-${VERIFY_ARTIFACTS_DIR}/e2e-state.json}" 2>/dev/null || true)"
    if [[ -z "${cluster_id}" ]]; then
        log_error "check_castai_api: cluster_id not found in state file (${CASTAI_STATE_FILE:-e2e-state.json})"
        return 1
    fi

    local endpoint="/v1/kubernetes/external-clusters/${cluster_id}"
    log_step "Polling ${endpoint} (max ${VERIFY_API_MAX_ATTEMPTS} attempts, every ${VERIFY_API_SLEEP_SECONDS}s)"

    local attempt=1 last_status last_heartbeat now heartbeat_age rc=2
    while (( attempt <= VERIFY_API_MAX_ATTEMPTS )); do
        log_info "Attempt ${attempt}/${VERIFY_API_MAX_ATTEMPTS}"
        if [[ "${VERIFY_COMPONENTS_DRY_RUN}" == "true" ]]; then
            log_info "[DRY-RUN] would execute: GET ${CASTAI_API_BASE:-}${endpoint}"
            log_info "[DRY-RUN] assuming status=connected and heartbeat=now (dry-run)"
            printf 'cluster_id=%s status=connected heartbeat=now dry_run=true\n' "${cluster_id}"
            return 0
        fi

        local http_status
        # Invoke castai::_api_call directly (NOT via $()) so the
        # module-level CASTAI_LAST_BODY survives into this shell.
        if ! castai::_api_call GET "${endpoint}"; then
            log_warn "API call failed; retrying in ${VERIFY_API_SLEEP_SECONDS}s"
            sleep "${VERIFY_API_SLEEP_SECONDS}"
            attempt=$((attempt + 1))
            continue
        fi
        http_status="${CASTAI_LAST_STATUS}"
        if [[ "${http_status}" != "200" ]]; then
            log_warn "GET ${endpoint} returned HTTP ${http_status}; retrying"
            sleep "${VERIFY_API_SLEEP_SECONDS}"
            attempt=$((attempt + 1))
            continue
        fi

        last_status="$(printf '%s' "${CASTAI_LAST_BODY}" | jq -r '.status // empty')"
        last_heartbeat="$(printf '%s' "${CASTAI_LAST_BODY}" | jq -r '.lastHeartbeatTime // empty')"
        log_info "Cluster status=$(mask_value "${last_status}") lastHeartbeatTime=$(mask_value "${last_heartbeat}")"

        case "${last_status}" in
            ready|connected)
                # Heartbeat freshness check is best-effort: if the field
                # is missing we fall back to status alone (the plan says
                # "if the field exists").
                if [[ -n "${last_heartbeat}" ]]; then
                    now="$(verify_components::_now_epoch)"
                    heartbeat_epoch="$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "${last_heartbeat}" '+%s' 2>/dev/null \
                                    || date -u -d "${last_heartbeat}" '+%s' 2>/dev/null \
                                    || printf '%s' "${now}")"
                    heartbeat_age=$((now - heartbeat_epoch))
                    if (( heartbeat_age < 0 )); then
                        # Clock skew tolerance: treat future timestamps as fresh.
                        log_warn "lastHeartbeatTime is in the future (age=${heartbeat_age}s); treating as fresh"
                        heartbeat_age=0
                    fi
                    if (( heartbeat_age > VERIFY_HEARTBEAT_MAX_AGE_SECONDS )); then
                        log_error "lastHeartbeatTime is ${heartbeat_age}s old (max ${VERIFY_HEARTBEAT_MAX_AGE_SECONDS}s)"
                        return 1
                    fi
                    log_info "lastHeartbeatTime age=${heartbeat_age}s (OK)"
                else
                    log_info "lastHeartbeatTime field missing; relying on status only"
                fi
                rc=0
                printf 'cluster_id=%s status=%s heartbeat=%s\n' "${cluster_id}" "${last_status}" "${last_heartbeat:-absent}"
                return 0
                ;;
            disconnected|error|failed)
                log_error "Cluster is ${last_status} (terminal failure)"
                log_error "Response: $(castai::_sanitize_body "${CASTAI_LAST_BODY}")"
                return 1
                ;;
            "")
                log_warn "Response missing status field; retrying"
                ;;
            *)
                log_info "Cluster status is '${last_status}' (transitional); retrying"
                ;;
        esac

        sleep "${VERIFY_API_SLEEP_SECONDS}"
        attempt=$((attempt + 1))
    done

    log_error "Cluster did not reach ready/connected within ${VERIFY_API_MAX_ATTEMPTS} attempts"
    return "${rc}"
}

# -----------------------------------------------------------------------------
# Orchestrator
# -----------------------------------------------------------------------------

# verify_components::run [expected_failing_component]
#   Runs all checks in order. Returns 0 only if every check passes.
#   Prints a final pass/fail summary. expected_failing_component, when
#   non-empty, switches the log scan into failure-simulation mode.
verify_components::run() {
    local expected_failing="${1:-}"

    log_step "Verifying post-rotation component health"

    local -a results=()
    local label pass overall_rc=0

    if label="logs"; verify_components::check_logs_for_401 "${expected_failing}"; then
        results+=("${label}=PASS")
    else
        results+=("${label}=FAIL")
        overall_rc=1
    fi

    if label="rollout"; verify_components::check_rollout_status; then
        results+=("${label}=PASS")
    else
        results+=("${label}=FAIL")
        overall_rc=1
    fi

    if label="api"; verify_components::check_castai_api; then
        results+=("${label}=PASS")
    else
        results+=("${label}=FAIL")
        overall_rc=1
    fi

    if (( overall_rc == 0 )); then
        log_info "All verification checks passed: ${results[*]}"
        pass="PASS"
    else
        log_error "One or more verification checks failed: ${results[*]}"
        pass="FAIL"
    fi
    printf 'OVERALL=%s\n' "${pass}"
    printf '%s\n' "${results[@]}"
    return "${overall_rc}"
}
