#!/usr/bin/env bash
#
# lib/report.sh
#
# Reporting library for the CAST AI token rotation E2E harness.
# Implements Chunk 5 of the plan: produce a markdown report at
# artifacts/report-<timestamp>.md with all required sections.
#
# Public API:
#   report::init                       Initialize the report file. Creates the
#                                      artifacts directory and writes the
#                                      header. Safe to call more than once
#                                      (each call replaces the report file).
#   report::section <title>            Append a markdown ## section header.
#   report::add_kv <key> <value>       Append a "- **key**: value" bullet.
#                                      Value is sanitized through
#                                      sanitize_text + a token-shape regex.
#   report::add_table <headers_name> <rows_name>
#                                      Append a markdown table. headers_name
#                                      and rows_name are names of bash
#                                      arrays defined in the caller scope.
#                                      Headers become the column titles.
#                                      Rows are strings with cells separated
#                                      by a literal '|' character; each row
#                                      becomes a single table row.
#   report::add_log_snippet <title> <log_text>
#                                      Append a fenced (```text) code block
#                                      containing the snippet, with any
#                                      token-shaped strings replaced by ***.
#   report::finalize <verdict> [summary]
#                                      Append the overall verdict section
#                                      (PASS or FAIL) and close the report.
#                                      Verdict is also stashed for callers
#                                      that want to read it via
#                                      report::get_verdict.
#   report::get_path                   Print the current report file path on
#                                      stdout.
#   report::get_verdict                Print the current verdict on stdout.
#
# Dry-run safety:
#   report.sh never performs network calls. The file writes are local
#   and deterministic. No approval gate is required because writing to
#   artifacts/ is a local, non-mutating-with-respect-to-AWS/CAST AI/K8s
#   operation.

if [[ -n "${E2E_REPORT_LOADED:-}" ]]; then
    return 0
fi
E2E_REPORT_LOADED=1

# -----------------------------------------------------------------------------
# Path resolution (works whether the lib is sourced from run.sh or tests).
# -----------------------------------------------------------------------------
REPORT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_E2E_DIR="$(cd "${REPORT_LIB_DIR}/.." && pwd)"

if [[ -z "${E2E_LOGGING_LOADED:-}" ]]; then
    # shellcheck source=lib/logging.sh
    source "${REPORT_E2E_DIR}/lib/logging.sh"
fi

# -----------------------------------------------------------------------------
# Module state.
# -----------------------------------------------------------------------------
# Default location: artifacts/ under the E2E directory. Can be overridden
# via REPORT_DIR for tests.
REPORT_DIR="${REPORT_DIR:-${REPORT_E2E_DIR}/artifacts}"
# Current report file path. Empty until report::init runs.
REPORT_PATH=""
# Current verdict. PENDING until report::finalize runs.
REPORT_VERDICT="PENDING"

# -----------------------------------------------------------------------------
# Internal helpers
# -----------------------------------------------------------------------------

# Append a chunk of text to the report file. Aborts if the file path
# has not been initialized by report::init. A leading "--" is dropped so
# callers can safely use "--" to make printf treat a leading dash as
# literal data.
_report_write() {
    if [[ -z "${REPORT_PATH}" ]]; then
        die "_report_write: REPORT_PATH is empty; call report::init first"
    fi
    if [[ "${1:-}" == "--" ]]; then
        shift
    fi
    printf '%s' "$@" >> "${REPORT_PATH}"
}

# Sanitize a log snippet. We use two layers:
#   1. The global sanitize_text helper masks known env-var secrets
#      (CASTAI_API_KEY, AWS_SECRET_ACCESS_KEY, ...).
#   2. A token-shape regex masks long random-looking strings that appear
#      either as Bearer tokens, inside JSON / quoted values, or in
#      k=v style assignments.
#
# The regex is intentionally conservative: it only matches 24+ char runs
# of [A-Za-z0-9_-] when they are clearly token-shaped (Bearer prefix,
# JSON string value, or quoted assignment value). That avoids eating
# cluster IDs (UUIDs already use hyphens but are 36 chars and surrounded
# by quotes - we accept the small risk of masking them).
report::_sanitize_log() {
    local text="${1-}"
    if [[ -z "${text}" ]]; then
        printf ''
        return 0
    fi
    # Layer 1: env-var secrets.
    text="$(sanitize_text "${text}")"
    # Layer 2: Bearer <token>.
    text="$(printf '%s' "${text}" | sed -E 's/(Bearer[[:space:]]+)[A-Za-z0-9_.-]{16,}/\1***/g')"
    # Layer 3: quoted JSON string values that look like tokens (24+ chars
    # of [A-Za-z0-9_-]).
    text="$(printf '%s' "${text}" | sed -E 's/"([A-Za-z0-9_-]{24,})"/"***"/g')"
    # Layer 4: API_KEY=<token> and similar key=value forms (token in the
    # value position only - keys like API_KEY are preserved so readers
    # still see what field contained a secret).
    text="$(printf '%s' "${text}" | sed -E 's/(API_KEY=)[A-Za-z0-9_.-]{16,}/\1***/g')"
    # Layer 5: clusterToken: "<value>".
    text="$(printf '%s' "${text}" | sed -E 's/(clusterToken["[:space:]]*[:=][[:space:]]*")[^"]+(")/\1***\2/g')"
    printf '%s' "${text}"
}

# Read a bash array by name into a destination array. Both names must
# be identifier-shaped strings. Works on bash 3.2 (no namerefs).
#
# Important: the destination must already be a GLOBAL (module-level)
# array. We deliberately do not support a `local -a` destination here,
# because bash 3.2 + `set -u` mishandles `eval` that assigns into a
# local scope; macOS /usr/bin/bash then hangs the caller. Callers in
# this library use the globals __report_table_headers and
# __report_table_rows for that reason.
#
# Args: dest_global_name src_array_name
_report_copy_array_by_name() {
    local dest_var="$1"
    local src_name="$2"
    # Empty destination first so a previous call's contents do not leak.
    # Using eval to assign to a global works on every bash version we
    # support. dest_var is always a module-global identifier we control.
    eval "${dest_var}=()"
    # Count elements in the source. ${#name[@]} works under `set -u`
    # because it evaluates to 0 when the array is unset (no "unbound
    # variable" error). src_name is a caller-controlled identifier; we
    # restrict it to identifier-shaped strings in the public API.
    local count
    # shellcheck disable=SC2086
    count=$(eval "printf '%s' \"\${#${src_name}[@]}\"")
    if (( count == 0 )); then
        return 0
    fi
    # Copy by index. Safe: src_name and dest_var are caller-controlled
    # identifier-shaped strings, restricted in the public API.
    local i=0
    while (( i < count )); do
        # shellcheck disable=SC1087
        eval "${dest_var}[${i}]=\"\${${src_name}[${i}]}\""
        i=$((i + 1))
    done
    return 0
}

# -----------------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------------

# report::init
#   Create the artifacts directory and a fresh report file. Safe to call
#   multiple times - each call replaces the report file path with a new
#   timestamped name.
report::init() {
    mkdir -p "${REPORT_DIR}"
    local timestamp
    timestamp="$(date -u +%Y%m%d-%H%M%S)"
    REPORT_PATH="${REPORT_DIR}/report-${timestamp}.md"
    {
        printf '# CAST AI Token Rotation E2E Report\n\n'
        printf -- '- **Generated (UTC)**: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf -- '- **E2E directory**: %s\n' "${REPORT_E2E_DIR}"
    } > "${REPORT_PATH}"
    log_info "Report file initialized: ${REPORT_PATH}"
    return 0
}

# report::section <title>
report::section() {
    local title="${1-}"
    if [[ -z "${title}" ]]; then
        die "report::section: usage: report::section <title>"
    fi
    _report_write $'\n''## '"${title}"$'\n\n'
}

# report::add_kv <key> <value>
report::add_kv() {
    local key="${1-}"
    local value="${2-}"
    if [[ -z "${key}" ]]; then
        die "report::add_kv: usage: report::add_kv <key> <value>"
    fi
    local sanitized
    sanitized="$(report::_sanitize_log "${value}")"
    _report_write -- "- **${key}**: ${sanitized}"$'\n'
    return 0
}

# report::add_table <headers_name> <rows_name>
#   headers_name must reference a bash array of column titles. rows_name
#   must reference a bash array of row strings; each row string's cells
#   are separated by a literal '|' character.
#
# Uses module-global arrays (__report_table_headers / __report_table_rows)
# instead of `local -a` inside this function because bash 3.2 on macOS
# mishandles `local -a x` followed by an eval-based array copy when
# `set -u` is active (the eval reads the caller-scoped variable but
# assigns into the local scope, producing an "unbound variable" error
# that hangs the caller under `set -uo pipefail`).
report::add_table() {
    local headers_name="${1-}"
    local rows_name="${2-}"
    if [[ -z "${headers_name}" || -z "${rows_name}" ]]; then
        die "report::add_table: usage: report::add_table <headers_array_name> <rows_array_name>"
    fi

    __report_table_headers=()
    __report_table_rows=()
    _report_copy_array_by_name __report_table_headers "${headers_name}"
    _report_copy_array_by_name __report_table_rows "${rows_name}"

    if (( ${#__report_table_headers[@]} == 0 )); then
        log_warn "report::add_table: headers array '${headers_name}' is empty; skipping"
        return 0
    fi

    # Header row.
    local hdr="|"
    local sep="|"
    local col
    for col in "${__report_table_headers[@]}"; do
        hdr+=" ${col} |"
        sep+=" --- |"
    done

    _report_write "${hdr}"$'\n'
    _report_write "${sep}"$'\n'

    if (( ${#__report_table_rows[@]} == 0 )); then
        # Emit a single placeholder row so the table still has valid
        # markdown structure when there is no data.
        local placeholder="|"
        local i
        for ((i = 0; i < ${#__report_table_headers[@]}; i++)); do
            placeholder+=" _none_ |"
        done
        _report_write "${placeholder}"$'\n'
        return 0
    fi

    local row line cell
    # cells split is also done into a module-global so we avoid
    # `local -a cells` + array assignment inside the loop on bash 3.2.
    for row in "${__report_table_rows[@]}"; do
        # Split on '|'. Disable glob expansion while splitting so '*' in
        # cells is not expanded by bash.
        __report_table_cells=()
        local IFS='|'
        # shellcheck disable=SC2206
        __report_table_cells=( ${row} )
        unset IFS
        line="|"
        for cell in "${__report_table_cells[@]}"; do
            line+=" ${cell} |"
        done
        _report_write "${line}"$'\n'
    done
}

# report::add_log_snippet <title> <log_text>
report::add_log_snippet() {
    local title="${1-}"
    local snippet="${2-}"
    if [[ -z "${title}" ]]; then
        die "report::add_log_snippet: usage: report::add_log_snippet <title> <log_text>"
    fi
    local sanitized
    sanitized="$(report::_sanitize_log "${snippet}")"
    _report_write $'\n''### '"${title}"$'\n\n'
    _report_write $'```text\n'
    _report_write "${sanitized}"$'\n'
    _report_write $'```\n'
}

# report::finalize <verdict> [summary]
#   Append the overall verdict section. verdict is one of PASS or FAIL.
#   summary is an optional one-line human description.
report::finalize() {
    local verdict="${1:-PENDING}"
    local summary="${2:-}"

    REPORT_VERDICT="${verdict}"

    {
        printf '\n## Overall Verdict\n\n'
        printf -- '- **Verdict**: %s\n' "${verdict}"
        if [[ -n "${summary}" ]]; then
            printf -- '- **Summary**: %s\n' "${summary}"
        fi
        printf -- '- **Report file**: %s\n' "${REPORT_PATH}"
        printf -- '- **Closed (UTC)**: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >> "${REPORT_PATH}"
    log_info "Report finalized with verdict ${verdict}: ${REPORT_PATH}"
    return 0
}

# report::get_path
report::get_path() {
    printf '%s' "${REPORT_PATH}"
}

# report::get_verdict
report::get_verdict() {
    printf '%s' "${REPORT_VERDICT}"
}
