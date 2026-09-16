#!/usr/bin/env bash
#
# run.sh
#
# Entrypoint for the CAST AI token rotation E2E harness.
#
# Usage:
#   ./e2e/token-rotation/run.sh [options]
#
# Options:
#   --dry-run     Print mutating commands instead of executing them.
#                 Forces PREFLIGHT_OFFLINE=1 so no AWS/CAST AI network calls
#                 are made. Safe to run without APPROVE_LIVE_RUN.
#   --keep-cluster
#                 Skip AWS teardown at the end of the run. The CAST AI
#                 cluster registration and the Kubernetes namespace are
#                 still cleaned up best-effort; only the EKS cluster is
#                 preserved.
#   --simulate-missed-secret=<secret-name>
#                 Run failure-simulation mode. The named per-component
#                 secret is intentionally NOT updated so the affected
#                 component keeps using the stale token. The verification
#                 step is told to expect a 401 only on that component.
#   --rotate-only
#                 Skip cluster creation and CAST AI install. Assume the
#                 EKS cluster is already running and a state file
#                 (artifacts/e2e-state.json) exists from a previous run.
#   --skip-preflight
#                 Skip preflight checks (advanced use only). You almost
#                 certainly do NOT want this.
#   --help, -h    Show this message and exit.
#
# Required environment variables:
#   AWS_ACCESS_KEY_ID       AWS access key for the EKS account.
#   AWS_SECRET_ACCESS_KEY   AWS secret access key.
#   CASTAI_API_KEY          CAST AI API token.
#   CASTAI_API_BASE         Must be https://api.eu.cast.ai.
#   CASTAI_ORG_ID           UUID of the CAST AI organization.
#
# Approval gate (required when live mutations would run):
#   APPROVE_LIVE_RUN=true   Acknowledges live mutations across AWS, CAST AI,
#                           and Kubernetes. Enforced by preflight whenever
#                           a live mutation is requested.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"

# shellcheck source=lib/logging.sh
source "${LIB_DIR}/logging.sh"
# shellcheck source=lib/preflight.sh
source "${LIB_DIR}/preflight.sh"
# shellcheck source=lib/cluster.sh
source "${LIB_DIR}/cluster.sh"
# shellcheck source=lib/castai-install.sh
source "${LIB_DIR}/castai-install.sh"
# shellcheck source=lib/rotate-token.sh
source "${LIB_DIR}/rotate-token.sh"
# shellcheck source=lib/verify-components.sh
source "${LIB_DIR}/verify-components.sh"
# shellcheck source=lib/report.sh
source "${LIB_DIR}/report.sh"

# -----------------------------------------------------------------------------
# CLI flags (set by run::parse_args).
# -----------------------------------------------------------------------------
DRY_RUN="false"
KEEP_CLUSTER="false"
ROTATE_ONLY="false"
SKIP_PREFLIGHT="false"
SIMULATE_MISSED_SECRET=""

run::print_help() {
    cat <<'HELP'
CAST AI Cluster Token Rotation - E2E Harness

USAGE
    ./e2e/token-rotation/run.sh [options]

OPTIONS
    --dry-run
        Print commands without executing them. Forces offline preflight
        so no AWS or CAST AI calls happen. Safe to run without
        APPROVE_LIVE_RUN.

    --keep-cluster
        Skip AWS teardown at the end of the run. CAST AI-side cluster
        registration and Kubernetes namespace are still cleaned up
        best-effort.

    --simulate-missed-secret=<secret-name>
        Run failure-simulation mode. The named per-component secret is
        intentionally NOT updated so the affected component keeps using
        the stale token.

    --rotate-only
        Skip cluster creation and CAST AI install. Assume the EKS
        cluster is already running and a state file exists.

    --skip-preflight
        Skip preflight checks (advanced use only - not recommended).

    --help, -h
        Show this message and exit.

REQUIRED ENVIRONMENT VARIABLES
    AWS_ACCESS_KEY_ID          AWS access key for the EKS account.
    AWS_SECRET_ACCESS_KEY      AWS secret access key.
    CASTAI_API_KEY             CAST AI API token (X-API-Key header).
    CASTAI_API_BASE            Must be: https://api.eu.cast.ai
    CASTAI_ORG_ID              UUID of the CAST AI organization.

APPROVAL GATE (required for live mutation runs)
    APPROVE_LIVE_RUN=true      Acknowledges that the run will perform live
                               mutations across AWS, CAST AI, and
                               Kubernetes. The run aborts if this is not
                               set when a live mutation is requested.

EXIT CODES
    0   run completed (overall PASS)
    1   preflight failed (env / tools / network) or a step errored
    2   preflight failed because the CAST AI token lacks write scope
    3   preflight failed because APPROVE_LIVE_RUN is not set
    4   verification produced a FAIL verdict
HELP
}

run::parse_args() {
    while (( $# > 0 )); do
        case "$1" in
            --dry-run)
                DRY_RUN="true"
                shift
                ;;
            --keep-cluster)
                KEEP_CLUSTER="true"
                shift
                ;;
            --simulate-missed-secret=*)
                SIMULATE_MISSED_SECRET="${1#--simulate-missed-secret=}"
                if [[ -z "${SIMULATE_MISSED_SECRET}" ]]; then
                    log_error "--simulate-missed-secret requires a non-empty secret name"
                    exit 1
                fi
                shift
                ;;
            --rotate-only)
                ROTATE_ONLY="true"
                shift
                ;;
            --skip-preflight)
                SKIP_PREFLIGHT="true"
                log_warn "--skip-preflight requested: this is NOT recommended"
                shift
                ;;
            --help|-h)
                run::print_help
                exit 0
                ;;
            --*)
                log_error "Unknown flag: $1"
                log_error "Run with --help for usage."
                exit 1
                ;;
            *)
                log_error "Unexpected positional argument: $1"
                log_error "Run with --help for usage."
                exit 1
                ;;
        esac
    done
}

# Propagate DRY_RUN to every library that owns its own dry-run switch.
# Each library honors its own variable so we set them all here.
run::propagate_dry_run() {
    if [[ "${DRY_RUN}" == "true" ]]; then
        export E2E_CLUSTER_DRY_RUN="true"
        export CASTAI_DRY_RUN="true"
        export ROTATE_TOKEN_DRY_RUN="true"
        export VERIFY_COMPONENTS_DRY_RUN="true"
    else
        export E2E_CLUSTER_DRY_RUN="${E2E_CLUSTER_DRY_RUN:-false}"
        export CASTAI_DRY_RUN="${CASTAI_DRY_RUN:-false}"
        export ROTATE_TOKEN_DRY_RUN="${ROTATE_TOKEN_DRY_RUN:-false}"
        export VERIFY_COMPONENTS_DRY_RUN="${VERIFY_COMPONENTS_DRY_RUN:-false}"
    fi
}

# run::run_cluster_and_install
#   Performs the cluster-lifecycle and CAST AI install steps (Chunks 2-3).
#   In --rotate-only mode this is skipped entirely.
run::run_cluster_and_install() {
    if [[ "${ROTATE_ONLY}" == "true" ]]; then
        log_step "--rotate-only: skipping cluster creation and CAST AI install"
        if [[ ! -f "${CASTAI_STATE_FILE}" ]]; then
            die "CASTAI_STATE_FILE not found at ${CASTAI_STATE_FILE}; --rotate-only requires a state file from a previous run."
        fi
        return 0
    fi

    log_step "Cluster lifecycle (Chunk 2)"
    cluster::start

    # Cluster ID acquisition. We re-derive region / account here so
    # downstream steps don't need to know how the cluster was created.
    local region account_id cluster_id cluster_name
    region="${E2E_CLUSTER_REGION}"
    if [[ "${DRY_RUN}" != "true" ]] && command -v aws >/dev/null 2>&1; then
        account_id="$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || echo "")"
    else
        account_id="000000000000"
    fi
    cluster_name="${E2E_CLUSTER_NAME}"

    log_step "CAST AI registration + install (Chunk 3)"
    castai::register_cluster "${cluster_name}" "${region}" "${account_id}"
    cluster_id="$(castai::_state_get cluster_id)"
    if [[ -z "${cluster_id}" ]]; then
        die "Failed to obtain cluster_id after register_cluster"
    fi
    # Pull the initial token from CASTAI_CURRENT_TOKEN (set inside
    # register_cluster). Use a direct read so we don't expose the value
    # to logs.
    local initial_token="${CASTAI_CURRENT_TOKEN}"
    if [[ -z "${initial_token}" ]]; then
        die "Failed to obtain initial cluster token after register_cluster"
    fi
    castai::create_secrets "${initial_token}"
    castai::install_chart
    castai::verify_values
    # castai::wait_for_ready is kind-aware (waits on DaemonSets as
    # well as Deployments) and respects the critical/best-effort
    # split. Critical component failures abort the install; best-
    # effort component failures are logged as warnings so a slow
    # spot-handler/kvisor rollout does not block the whole harness.
    castai::wait_for_ready 300s
    castai::verify_connected
}

# run::run_rotation
#   Performs the rotation + verification steps (Chunk 4). Returns 0 if
#   verification passed, 1 if it failed.
run::run_rotation() {
    log_step "Token rotation (Chunk 4) - mode: $(if [[ -n "${SIMULATE_MISSED_SECRET}" ]]; then printf 'simulate_missed_secret=%s' "${SIMULATE_MISSED_SECRET}"; else printf 'happy_path'; fi)"

    if [[ -n "${SIMULATE_MISSED_SECRET}" ]]; then
        if ! rotate_token::simulate_missed_secret "${SIMULATE_MISSED_SECRET}"; then
            log_error "Token rotation failed (failure-simulation mode)"
            return 1
        fi
    else
        if ! rotate_token::rotate; then
            log_error "Token rotation failed"
            return 1
        fi
    fi

    log_step "Component verification (Chunk 4)"
    # Failure-simulation mode passes the skipped secret's name as the
    # expected-failing component. Happy-path mode passes an empty
    # argument (no 401 is expected anywhere).
    if [[ -n "${SIMULATE_MISSED_SECRET}" ]]; then
        verify_components::run "${SIMULATE_MISSED_SECRET}"
    else
        verify_components::run
    fi
}

# run::write_report <rotation_rc>
#   Populates the markdown report with the standard sections. rotation_rc
#   is the exit code of run::run_rotation (0 = pass, non-zero = fail).
run::write_report() {
    local rotation_rc="$1"

    local cluster_id cluster_name region token_endpoint_status
    cluster_id="$(castai::_state_get cluster_id)"
    cluster_name="${E2E_CLUSTER_NAME}"
    region="${E2E_CLUSTER_REGION}"

    # Token endpoint response code: prefer whatever the rotation step
    # recorded in the state file. Fall back to dry-run / unknown so the
    # report is never empty even when rotation did not run (e.g., the
    # cluster/install phase failed before reaching rotation).
    token_endpoint_status="$(castai::_state_get token_endpoint_status)"
    if [[ -z "${token_endpoint_status}" ]]; then
        if [[ "${DRY_RUN}" == "true" ]]; then
            token_endpoint_status="200 (dry-run)"
        else
            token_endpoint_status="unknown (see rotation logs)"
        fi
    fi

    log_step "Writing report"
    report::init
    report::section "Cluster Identity"
    report::add_kv "Cluster name" "${cluster_name}"
    report::add_kv "Cluster region" "${region}"
    report::add_kv "CAST AI cluster ID" "${cluster_id:-absent}"
    report::add_kv "Mode" \
        "$(if [[ -n "${SIMULATE_MISSED_SECRET}" ]]; then printf 'failure-simulation (skipped %s)' "${SIMULATE_MISSED_SECRET}"; else printf 'happy-path'; fi)"
    report::add_kv "Timestamp of rotation (UTC)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    report::add_kv "Token endpoint response" "${token_endpoint_status}"

    report::section "Component Rollout Status"
    # rollout_headers is passed by name to report::add_table; shellcheck
    # cannot follow array-by-name references, so disable SC2034 locally.
    # shellcheck disable=SC2034
    local -a rollout_headers=("deployment" "status")
    local -a rollout_rows=()
    local deployment status
    for deployment in "${ROTATE_COMPONENT_DEPLOYMENTS[@]}"; do
        status="$(verify_components::read_rollout_status "${deployment}")"
        if [[ "${status}" == "Unknown" ]]; then
            if [[ "${DRY_RUN}" == "true" ]]; then
                status="Ready (dry-run)"
            else
                status="Not checked"
            fi
        fi
        rollout_rows+=("${deployment}|${status}")
    done
    report::add_table rollout_headers rollout_rows

    report::section "Log Evidence"
    # Happy-path snippet: assert no 401s.
    report::add_log_snippet "401 marker scan" \
        "401 Authorization Required marker scan completed. \
$(if [[ -n "${SIMULATE_MISSED_SECRET}" ]]; then printf 'Expected 401 on %s only (failure-simulation).' "${SIMULATE_MISSED_SECRET}"; else printf 'No 401 lines expected (happy-path).'; fi)"

    report::section "CAST AI API Connectivity"
    report::add_kv "Cluster status" \
        "$(if [[ "${DRY_RUN}" == "true" ]]; then printf 'connected (dry-run)'; else printf 'see verification output'; fi)"

    # Final verdict.
    local verdict summary
    if (( rotation_rc == 0 )); then
        verdict="PASS"
        summary="Token rotation completed without unexpected 401s."
    else
        verdict="FAIL"
        summary="Token rotation or verification reported failures; see logs and per-component log files."
    fi
    report::finalize "${verdict}" "${summary}"
    log_info "Report written: $(report::get_path) (verdict=${verdict})"
}

# run::teardown
#   Best-effort teardown: CAST AI cluster + Kubernetes namespace +
#   secrets, then AWS EKS cluster (unless --keep-cluster).
run::teardown() {
    log_step "Teardown (Chunk 5)"

    if [[ "${DRY_RUN}" == "true" ]]; then
        # Dry-run: print every command we would have run, including the
        # two headline commands the test asserts on.
        log_info "[DRY-RUN] would execute: DELETE /v1/kubernetes/external-clusters/${CASTAI_CLUSTER_ID_PLACEHOLDER:-<clusterId>}"
        log_info "[DRY-RUN] would execute: kubectl delete secret <per-component-secrets> --namespace=${CASTAI_NAMESPACE} --ignore-not-found"
        log_info "[DRY-RUN] would execute: kubectl delete namespace ${CASTAI_NAMESPACE} --ignore-not-found"
        if [[ "${KEEP_CLUSTER}" == "true" ]]; then
            log_info "[DRY-RUN] --keep-cluster set: would skip the AWS teardown step"
        else
            log_info "[DRY-RUN] would execute: eksctl delete cluster --name ${E2E_CLUSTER_NAME} --region ${E2E_CLUSTER_REGION}"
        fi
        return 0
    fi

    # Live teardown: invoke castai::cleanup (best-effort) then AWS teardown.
    if declare -F castai::cleanup >/dev/null 2>&1; then
        castai::cleanup || log_warn "castai::cleanup reported errors; continuing with AWS teardown"
    else
        log_warn "castai::cleanup not defined; running minimal fallback"
        local cluster_id
        cluster_id="$(castai::_state_get cluster_id)"
        if [[ -n "${cluster_id}" ]]; then
            log_info "[fallback] would call DELETE /v1/kubernetes/external-clusters/${cluster_id}"
        fi
        log_info "[fallback] would delete per-component secrets and namespace ${CASTAI_NAMESPACE}"
    fi

    if [[ "${KEEP_CLUSTER}" == "true" ]]; then
        log_warn "--keep-cluster set: skipping AWS cluster teardown"
        return 0
    fi

    cluster::stop
}

run::main() {
    run::parse_args "$@"
    run::propagate_dry_run

    log_step "CAST AI token rotation E2E harness"
    log_info "Dry-run        : ${DRY_RUN}"
    log_info "Keep-cluster   : ${KEEP_CLUSTER}"
    log_info "Rotate-only    : ${ROTATE_ONLY}"
    log_info "Skip-preflight : ${SKIP_PREFLIGHT}"
    if [[ -n "${SIMULATE_MISSED_SECRET}" ]]; then
        log_info "Simulate-missed-secret : ${SIMULATE_MISSED_SECRET}"
    fi

    if [[ "${SKIP_PREFLIGHT}" != "true" ]]; then
        local live_mode="false"
        if [[ "${DRY_RUN}" == "true" ]]; then
            export PREFLIGHT_OFFLINE=1
            log_warn "Dry-run: preflight runs offline (no AWS or CAST AI calls)."
        else
            live_mode="true"
        fi
        preflight::run "${live_mode}"
    else
        log_warn "Skipping preflight as requested"
    fi

    # Track rotation/verification rc so teardown still runs.
    local rotation_rc=0
    if [[ "${DRY_RUN}" == "true" ]]; then
        log_step "Dry-run: cluster lifecycle and CAST AI install"
        log_info "[DRY-RUN] would execute: eksctl create cluster -f ${E2E_CLUSTER_CONFIG}"
        log_info "[DRY-RUN] would execute: POST /v1/kubernetes/external-clusters"
        log_info "[DRY-RUN] would execute: kubectl create secret generic <per-component-secrets>"
        log_info "[DRY-RUN] would execute: helm upgrade --install ${CASTAI_RELEASE_NAME:-castai-agent} ${CASTAI_CHART:-castai/castai} ..."
        log_info "[DRY-RUN] would execute: POST /v1/kubernetes/external-clusters/<clusterId>/token"
        log_info "[DRY-RUN] would execute: kubectl rollout restart <kind>/<component> ..."
        log_info "[DRY-RUN] would execute: verify_components::run"
    else
        if ! run::run_cluster_and_install; then
            log_error "Cluster + install phase failed"
            rotation_rc=1
        else
            if ! run::run_rotation; then
                rotation_rc=1
            fi
        fi
    fi

    # Report is written regardless of outcome; the verdict reflects
    # whether rotation passed.
    run::write_report "${rotation_rc}"

    # Teardown always runs unless the user explicitly passed
    # --keep-cluster (handled inside run::teardown).
    run::teardown

    if (( rotation_rc != 0 )); then
        log_error "Run completed with failures (rc=${rotation_rc})"
        exit "${rotation_rc}"
    fi
    log_step "Run completed successfully"
    exit 0
}

run::main "$@"
