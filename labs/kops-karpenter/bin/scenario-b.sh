#!/usr/bin/env bash
#
# scenario-b.sh — wrapper for scenario B (scale up).
#
# Delegates to scenario-b-scale-up.sh in the same directory. The wrapper
# exists so the lab invokes a stable, short filename
# (`scenario-b.sh`) regardless of how the implementation script is named
# internally.
#
# All arguments are forwarded to the underlying script.
#
# Exit codes match scenario-b-scale-up.sh.

set -euo pipefail

WRAPPER_DIR_B="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_B="${WRAPPER_DIR_B}/scenario-b-scale-up.sh"

if [ ! -x "${TARGET_B}" ]; then
  echo "[!] Required target script missing or not executable: ${TARGET_B}" >&2
  exit 1
fi

exec "${TARGET_B}" "$@"
