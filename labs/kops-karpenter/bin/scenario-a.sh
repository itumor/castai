#!/usr/bin/env bash
#
# scenario-a.sh — wrapper for scenario A (initial provisioning trigger).
#
# Delegates to scenario-a-provision.sh in the same directory. The wrapper
# exists so the lab invokes a stable, short filename
# (`scenario-a.sh`) regardless of how the implementation script is named
# internally.
#
# All arguments are forwarded to the underlying script.
#
# Exit codes match scenario-a-provision.sh.

set -euo pipefail

WRAPPER_DIR_A="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_A="${WRAPPER_DIR_A}/scenario-a-provision.sh"

if [ ! -x "${TARGET_A}" ]; then
  echo "[!] Required target script missing or not executable: ${TARGET_A}" >&2
  exit 1
fi

exec "${TARGET_A}" "$@"
