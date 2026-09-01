#!/usr/bin/env bash
#
# _lib-source-env.sh
#
# Shared helper for the kOps + Karpenter lab scripts. Sources the
# repo-root .env file safely, exporting ONLY a small allow-list of
# AWS-related variables and discarding every other variable defined
# in that file. This is important because the .env also carries
# non-AWS secrets (e.g. CAST AI tokens) that must not be exported
# into the process environment of the lab scripts.
#
# Public function:
#   source_aws_credentials_from_env [path-to-.env]
#
# Behavior:
#   - If the file does not exist, returns silently (exit 0) so callers
#     can rely on this helper unconditionally.
#   - If the file exists but no AWS-related key is defined, prints a
#     short notice and returns.
#   - The .env file is sourced in an isolated subshell that has the
#     `set -a` flag enabled, so all assignments inside the file are
#     auto-exported in that subshell. We then forward only the
#     allow-listed variables back to the parent process via a
#     temporary file that contains only `export KEY=value` lines for
#     the allow-listed variables.
#   - Non-AWS variables (e.g. `TF_VAR_castai_api_token`, `Castai_mcp`)
#     are dropped on the floor and never enter the parent shell's
#     environment.
#   - The temporary file is removed before this function returns.
#
# This file is intentionally not executable; it is meant to be sourced.

# Guard against double-sourcing.
# Note: `return` outside of a function is only valid in sourced files.
# Using `return 0` directly is enough; the `2>/dev/null || true` was
# triggering shellcheck SC2317 (unreachable command) and is not needed.
if [ -n "${__KOPS_LAB_LIB_SOURCED:-}" ]; then
  return 0
fi
__KOPS_LAB_LIB_SOURCED=1

# Allowed AWS-related variable names (exact match against the variable
# name in the .env file). Adding anything here widens the secret-leak
# surface; keep it minimal.
__KOPS_LAB_AWS_VARS=(AWSKEY_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION AWS_REGION)

source_aws_credentials_from_env() {
  local env_file="${1:-}"

  # Default: resolve from this script's location.
  if [ -z "${env_file}" ]; then
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local repo_root
    repo_root="$(cd "${lib_dir}/../.." && pwd)"
    env_file="${repo_root}/.env"
  fi

  if [ ! -f "${env_file}" ]; then
    return 0
  fi

  echo "==> Sourcing AWS credentials from ${env_file}" >&2

  # Build a script that forwards only the allow-listed variables from
  # the .env. The subshell sources the .env with `set -a` so all
  # assignments there are auto-exported; we then print only the
  # variables on the allow-list with `printf %q` so quoting is safe.
  local subshell_output
  subshell_output="$(
    set -a
    # shellcheck disable=SC1090
    source "${env_file}"
    set +a
    for v in "${__KOPS_LAB_AWS_VARS[@]}"; do
      if [ -n "${!v-}" ]; then
        printf 'export %s=%q\n' "${v}" "${!v}"
      fi
    done
  )"

  if [ -z "${subshell_output}" ]; then
    echo "    No AWS credentials found in ${env_file}; relying on ambient environment." >&2
    return 0
  fi

  # Apply the forwarded exports in the current shell. The string
  # contains only lines of the form `export KEY=value` where KEY is in
  # __KOPS_LAB_AWS_VARS, so no non-AWS secret ever reaches the parent
  # environment.
  # `eval` is safe here because the input is constructed from the
  # allow-list only and the values are passed through printf %q.
  eval "${subshell_output}"

  return 0
}
