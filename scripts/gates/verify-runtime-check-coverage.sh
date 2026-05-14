#!/usr/bin/env bash
# verify-runtime-check-coverage.sh — thin shell wrapper for the .mjs gate.
# The .mjs file handles ESM import and runs the actual check.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/verify-runtime-check-coverage.mjs"
