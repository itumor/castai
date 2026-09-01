#!/usr/bin/env bash
#
# scenario-e.sh — wrapper for scenario E (spot vs on-demand).
#
# Delegates to scenario-e-spot.sh in the same directory. The wrapper
# exists so the lab invokes a stable, short filename
# (`scenario-e.sh`) regardless of how the implementation script is named
# internally.
#
# All arguments are forwarded to the underlying script.
#
# Exit codes match scenario-e-spot.sh.

set -euo pipefail

WRAPPER_DIR_E="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_E="${WRAPPER_DIR_E}/scenario-e-spot.sh"

if [ ! -x "${TARGET_E}" ]; then
  echo "[!] Required target script missing or not executable: ${TARGET_E}" >&2
  exit 1
fi

exec "${TARGET_E}" "$@"
