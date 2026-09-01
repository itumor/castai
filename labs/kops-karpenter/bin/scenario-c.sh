#!/usr/bin/env bash
#
# scenario-c.sh — wrapper for scenario C (scale down / consolidation).
#
# Delegates to scenario-c-scale-down.sh in the same directory. The wrapper
# exists so the lab invokes a stable, short filename
# (`scenario-c.sh`) regardless of how the implementation script is named
# internally.
#
# All arguments are forwarded to the underlying script.
#
# Exit codes match scenario-c-scale-down.sh.

set -euo pipefail

WRAPPER_DIR_C="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_C="${WRAPPER_DIR_C}/scenario-c-scale-down.sh"

if [ ! -x "${TARGET_C}" ]; then
  echo "[!] Required target script missing or not executable: ${TARGET_C}" >&2
  exit 1
fi

exec "${TARGET_C}" "$@"
