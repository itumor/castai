#!/usr/bin/env bash
#
# lib/logging.sh
#
# Logging helpers for the CAST AI token rotation E2E harness.
#
# Provides:
#   - log_init <log_file>
#   - log_info / log_warn / log_error / log_debug / log_step
#   - die <message>
#   - mask_value <value>        -> "***" for any non-empty value
#   - dry_run <command...>      -> prints "[DRY-RUN] ..." instead of executing
#
# All output is routed to stderr so that stdout remains clean for
# machine-readable artifacts (e.g. JSON returned by curl/jq).
#
# Requires: bash 4+

if [[ -n "${E2E_LOGGING_LOADED:-}" ]]; then
    return 0
fi
E2E_LOGGING_LOADED=1

# log_level threshold. Numeric; messages below threshold are suppressed.
# Defaults to 20 (INFO). Override with E2E_LOG_LEVEL=10 (DEBUG) or 30 (WARN).
: "${E2E_LOG_LEVEL:=20}"
: "${E2E_LOG_FILE:=/dev/null}"

_log_ts() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

_log_emit() {
    local level_name="$1"
    shift 1
    local line
    line="[$( _log_ts )] [${level_name}] $*"
    printf '%s\n' "$line" >&2
    if [[ "${E2E_LOG_FILE}" != "/dev/null" ]]; then
        printf '%s\n' "$line" >>"${E2E_LOG_FILE}" 2>/dev/null || true
    fi
}

log_init() {
    local log_file="${1:-/dev/null}"
    if [[ "${log_file}" != "/dev/null" ]]; then
        : "${E2E_LOG_FILE:=${log_file}}"
        E2E_LOG_FILE="${log_file}"
        # Ensure parent directory exists.
        local log_dir
        log_dir="$(dirname "${E2E_LOG_FILE}")"
        if [[ ! -d "${log_dir}" ]]; then
            mkdir -p "${log_dir}"
        fi
        : >"${E2E_LOG_FILE}"
    fi
}

log_debug() {
    if (( E2E_LOG_LEVEL <= 10 )); then
        _log_emit "DEBUG" "$@"
    fi
}

log_info() {
    if (( E2E_LOG_LEVEL <= 20 )); then
        _log_emit "INFO " "$@"
    fi
}

log_warn() {
    if (( E2E_LOG_LEVEL <= 30 )); then
        _log_emit "WARN " "$@"
    fi
}

log_error() {
    _log_emit "ERROR" "$@"
}

log_step() {
    _log_emit "STEP " "==> $*"
}

die() {
    log_error "$*"
    exit 1
}

# Replace any non-empty value with *** so secrets never reach logs.
# Empty input is left empty (so callers can detect "var unset" via :+).
mask_value() {
    local value="${1-}"
    if [[ -z "${value}" ]]; then
        printf '%s' ""
    else
        printf '%s' "***"
    fi
}

# Print a command instead of executing it. Used by --dry-run.
# Always echoes to stderr so it shows up alongside other log lines.
dry_run() {
    log_info "[DRY-RUN] would execute: $*"
}

# Sanitize arbitrary text by replacing common secret-shaped tokens.
# Best-effort: rewrites any value of known secret env vars to ***.
sanitize_text() {
    local text="${1-}"
    local var
    for var in CASTAI_API_KEY AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN \
               CASTAI_CLUSTER_TOKEN KUBECONFIG_CONTENT \
               ROTATE_SIMULATION_INVALID_TOKEN; do
        local v="${!var-}"
        if [[ -n "${v}" ]]; then
            # Use a literal placeholder; shell parameter substitution avoids
            # passing the actual value through the command line.
            text="${text//${v}/***}"
        fi
    done
    printf '%s' "${text}"
}
