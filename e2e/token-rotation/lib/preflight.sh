#!/usr/bin/env bash
#
# lib/preflight.sh
#
# Preflight validation for the CAST AI token rotation E2E harness.
#
# Public entrypoint:
#   preflight::run [--offline] [--allow-no-write-scope] <live_mode>
#
# Arguments:
#   --offline                 Skip network calls (used by tests and --dry-run).
#                             Validates env vars + binaries + offline token-shape
#                             only. Never hits AWS or CAST AI.
#   --allow-no-write-scope    In live mode, do not require POST write-scope
#                             verification. Used by callers that explicitly
#                             accept read-only tokens for selected operations.
#   <live_mode>               "true" or "false". When true, requires
#                             APPROVE_LIVE_RUN=true and (unless --allow-no-
#                             write-scope) verifies the CAST AI token can
#                             reach write endpoints.
#
# Exit codes:
#   0   preflight passed
#   1   preflight failed (env / tools / network / approval)
#   2   preflight failed because write scope is required but missing
#
# Env vars consumed:
#   CASTAI_API_BASE, CASTAI_API_KEY, CASTAI_ORG_ID
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  (aws cli auth)
#   APPROVE_LIVE_RUN                          (gate)
#   AWS_REGION                                (informational, default eu-central-1)
#   PREFLIGHT_OFFLINE=1                       (skip network, equivalent to --offline)

if [[ -n "${E2E_PREFLIGHT_LOADED:-}" ]]; then
    return 0
fi
E2E_PREFLIGHT_LOADED=1

# Required tools, in dependency order.
PREFLIGHT_REQUIRED_BINARIES=(aws eksctl kubectl helm curl jq)

# Required env vars (always checked, offline or not).
PREFLIGHT_REQUIRED_ENV=(
    AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY
    CASTAI_API_KEY
    CASTAI_API_BASE
    CASTAI_ORG_ID
)

# The only CAST AI API base we currently support for this harness.
PREFLIGHT_REQUIRED_CASTAI_BASE="https://api.eu.cast.ai"

# Mutation categories surfaced to the human approver.
PREFLIGHT_MUTATION_CATEGORIES=(
    "AWS          (EKS create/delete, IAM, CloudFormation, ELB, EBS)"
    "CAST AI      (POST /v1/kubernetes/external-clusters, /token, DELETE /v1/kubernetes/external-clusters/{id})"
    "Kubernetes   (Secret apply/patch, Deployment rollout restart, Namespace create/delete)"
)

# -----------------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------------

_preflight_require_bin() {
    local bin_name="$1"
    if ! command -v "${bin_name}" >/dev/null 2>&1; then
        die "Required binary not found on PATH: ${bin_name}"
    fi
}

_preflight_require_env() {
    local var_name="$1"
    if [[ -z "${!var_name:-}" ]]; then
        die "Required environment variable is empty or unset: ${var_name}"
    fi
}

# Execute a CAST AI HTTP request. Echoes the HTTP status code.
# Args: method path [data]
_preflight_curl_exec() {
    local method="$1"
    local path="$2"
    local data="${3:-}"
    local url="${CASTAI_API_BASE}${path}"
    local args=(
        -sS -o /tmp/e2e-preflight-resp.json
        -w "%{http_code}"
        -X "${method}"
        -H "X-API-Key: ${CASTAI_API_KEY}"
        -H "Accept: application/json"
        -H "Content-Type: application/json"
    )
    if [[ -n "${data}" ]]; then
        args+=( --data "${data}" )
    fi
    args+=( "${url}" )
    curl "${args[@]}"
}

# Print the (masked) response body from the last _preflight_curl_exec call.
_preflight_response_body() {
    if [[ -r /tmp/e2e-preflight-resp.json ]]; then
        sanitize_text "$(cat /tmp/e2e-preflight-resp.json)"
    else
        printf '%s' ""
    fi
}

# -----------------------------------------------------------------------------
# Public entrypoint
# -----------------------------------------------------------------------------

# preflight::run [--offline] [--allow-no-write-scope] <live_mode>
preflight::run() {
    local offline=0
    local allow_no_write_scope=0
    local live_mode=""

    while (( $# > 0 )); do
        case "$1" in
            --offline)
                offline=1
                shift
                ;;
            --allow-no-write-scope)
                allow_no_write_scope=1
                shift
                ;;
            --help|-h)
                cat <<'USAGE'
preflight::run [--offline] [--allow-no-write-scope] <live_mode>

Runs the token rotation E2E preflight. Returns 0 on success, non-zero on
failure. See the header of lib/preflight.sh for env vars consumed.
USAGE
                return 0
                ;;
            --*)
                die "preflight::run: unknown flag: $1"
                ;;
            *)
                live_mode="$1"
                shift
                ;;
        esac
    done

    if [[ -z "${live_mode}" ]]; then
        die "preflight::run: <live_mode> argument required (true|false)"
    fi

    if [[ -n "${PREFLIGHT_OFFLINE:-}" && "${PREFLIGHT_OFFLINE}" != "0" && "${PREFLIGHT_OFFLINE}" != "false" ]]; then
        offline=1
    fi

    log_step "Preflight starting (live_mode=${live_mode}, offline=${offline})"

    # 1. Required binaries.
    log_step "Checking required binaries"
    local bin
    for bin in "${PREFLIGHT_REQUIRED_BINARIES[@]}"; do
        if command -v "${bin}" >/dev/null 2>&1; then
            log_debug "  found: ${bin}"
        else
            die "Missing required binary: ${bin}. Install it and re-run."
        fi
    done

    # 2. Required env vars.
    log_step "Checking required environment variables"
    local var
    for var in "${PREFLIGHT_REQUIRED_ENV[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            die "Missing or empty required env var: ${var}"
        fi
        log_debug "  set: ${var}=$(mask_value "${!var}")"
    done

    # 3. CAST AI base must be the EU endpoint we test against.
    log_step "Verifying CASTAI_API_BASE"
    if [[ "${CASTAI_API_BASE}" != "${PREFLIGHT_REQUIRED_CASTAI_BASE}" ]]; then
        die "CASTAI_API_BASE must be ${PREFLIGHT_REQUIRED_CASTAI_BASE}, got: ${CASTAI_API_BASE}"
    fi
    log_info "CASTAI_API_BASE = ${CASTAI_API_BASE} (OK)"

    # 4. CAST AI org id format sanity (UUID shape, non-empty).
    log_step "Verifying CASTAI_ORG_ID"
    if ! [[ "${CASTAI_ORG_ID}" =~ ^[0-9a-fA-F-]{8,64}$ ]]; then
        die "CASTAI_ORG_ID does not look like a valid UUID: $(mask_value "${CASTAI_ORG_ID}")"
    fi
    log_info "CASTAI_ORG_ID format OK"

    # Network checks below are skipped in offline mode.
    if (( offline == 1 )); then
        log_warn "Offline mode: skipping AWS STS and CAST AI API verification"
        if [[ "${live_mode}" == "true" ]]; then
            _preflight_assert_approval_gate
        fi
        log_step "Preflight completed (offline)"
        return 0
    fi

    # 5. AWS identity.
    log_step "Verifying AWS credentials via 'aws sts get-caller-identity'"
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        die "aws sts get-caller-identity failed. Check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION."
    fi
    local aws_account
    aws_account="$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null || true)"
    log_info "AWS identity OK (account=$(mask_value "${aws_account}"))"

    # 6. CAST AI token can call GET /v1/organizations.
    log_step "Verifying CAST AI token via GET /v1/organizations"
    local org_status
    org_status="$(_preflight_curl_exec GET /v1/organizations)"
    if [[ "${org_status}" != "200" ]]; then
        log_error "GET /v1/organizations returned HTTP ${org_status}"
        log_error "Response: $(_preflight_response_body)"
        die "CAST AI token cannot read organizations (HTTP ${org_status}). Check CASTAI_API_KEY."
    fi
    log_info "CAST AI token authenticated (organizations endpoint reachable)"

    # 7. Live-mode gate + write-scope check.
    if [[ "${live_mode}" == "true" ]]; then
        _preflight_assert_approval_gate
        if (( allow_no_write_scope == 0 )); then
            _preflight_assert_write_scope
        fi
    fi

    log_step "Preflight completed (online)"
    return 0
}

# Print the mutation categories and assert APPROVE_LIVE_RUN=true. Aborts
# otherwise. Safe to call from any preflight path that is about to perform
# a live mutation.
_preflight_assert_approval_gate() {
    log_step "Live mutations requested; checking APPROVE_LIVE_RUN gate"
    log_warn "This run will perform live mutations in the following categories:"
    local cat
    for cat in "${PREFLIGHT_MUTATION_CATEGORIES[@]}"; do
        log_warn "  - ${cat}"
    done

    local approve="${APPROVE_LIVE_RUN:-}"
    if [[ "${approve}" != "true" ]]; then
        die "APPROVE_LIVE_RUN is not 'true' (current value: '$(mask_value "${approve}")'). Refusing to perform live mutations. Re-run with APPROVE_LIVE_RUN=true after human review."
    fi
    log_info "APPROVE_LIVE_RUN=true confirmed"
}

# Verify the CAST AI token has write scope by calling a write endpoint with a
# deliberately invalid body. We treat any non-2xx that is NOT 401/403 as
# evidence the token reached the handler (scope OK, body rejected). A 401/403
# means the token lacks scope.
#
# Args: none. Exits non-zero on failure.
_preflight_assert_write_scope() {
    log_step "Verifying CAST AI token write scope via POST /v1/kubernetes/external-clusters"

    # Minimal body that is missing required fields on purpose, so the server
    # will reject it with 400 (validation error) rather than creating a cluster.
    # The whole point is to reach the write code path with the token.
    local body='{"name":"e2e-preflight-probe","region":"eu-central-1"}'

    local status
    status="$(_preflight_curl_exec POST /v1/kubernetes/external-clusters "${body}")"

    case "${status}" in
        401|403)
            log_error "Token rejected with HTTP ${status} on a write endpoint."
            log_error "Response: $(_preflight_response_body)"
            return 2
            ;;
        2*)
            log_info "Token reached write handler (HTTP ${status}, validation error expected)."
            return 0
            ;;
        400|422)
            log_info "Token reached write handler (HTTP ${status}, validation error expected)."
            return 0
            ;;
        *)
            log_warn "Unexpected HTTP ${status} from write probe. Treating as scope-uncertain."
            log_warn "Response: $(_preflight_response_body)"
            return 1
            ;;
    esac
}
