#!/usr/bin/env bash
#
# scenario-d.sh — wrapper for scenario D (scheduling constraints).
#
# Delegates to scenario-d-constraints.sh in the same directory. The wrapper
# exists so the lab invokes a stable, short filename
# (`scenario-d.sh`) regardless of how the implementation script is named
# internally.
#
# All arguments are forwarded to the underlying script.
#
# Exit codes match scenario-d-constraints.sh.

set -euo pipefail

WRAPPER_DIR_D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_D="${WRAPPER_DIR_D}/scenario-d-constraints.sh"

if [ ! -x "${TARGET_D}" ]; then
  echo "[!] Required target script missing or not executable: ${TARGET_D}" >&2
  exit 1
fi

exec "${TARGET_D}" "$@"
