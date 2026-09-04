#!/usr/bin/env bash
# run_tests.sh — entrypoint for the castai-billing-export test suite.
#
# Changes to the project directory, runs the Python unittest suite, and
# propagates the Python exit code to the caller.

set -euo pipefail

# Resolve project directory as the parent of this script.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[run_tests] project: $PROJECT_DIR"
echo "[run_tests] running: python3 tests/test_export.py"

python3 tests/test_export.py
