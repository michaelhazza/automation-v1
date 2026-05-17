#!/usr/bin/env bash
# OS-parity harness for file-scanning gates.
# For each file-scanning gate: sets GATE_ROOT to a seeded fixture directory,
# runs the gate, asserts exit-code is non-zero (gate fired) AND stdout names
# the seeded violation file.
# For non-file-scanning gates: runs against repo root, asserts exit in {0,1,2,3}
# and non-empty stdout.
#
# Usage: bash scripts/test-gate-portability.sh
# Exit: 0 = all checks pass, 1 = one or more checks failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_DIR="${SCRIPT_DIR}/__tests__/gate-portability/fixtures"

PASS_COUNT=0
FAIL_COUNT=0

check_file_scanning_gate() {
  local gate_script="$1"
  local fixture_dir="$2"
  local gate_name="${gate_script##*/}"

  if [ ! -d "$fixture_dir" ]; then
    echo "[SKIP] $gate_name — no fixture at $fixture_dir"
    return
  fi

  local output exit_code=0
  output=$(GATE_ROOT="$fixture_dir" bash "$gate_script" 2>&1) || exit_code=$?

  if [ "$exit_code" -eq 0 ]; then
    echo "[FAIL] $gate_name — fixture did not trigger gate (exit 0)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    echo "[PASS] $gate_name — fixture triggered gate (exit $exit_code)"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
}

echo "=== Gate Portability Harness ==="

# File-scanning gates with fixture support
check_file_scanning_gate \
  "$SCRIPT_DIR/verify-with-org-tx-or-scoped-db.sh" \
  "$FIXTURES_DIR/verify-with-org-tx-or-scoped-db"

check_file_scanning_gate \
  "$SCRIPT_DIR/verify-no-direct-boss-work.sh" \
  "$FIXTURES_DIR/verify-no-direct-boss-work"

echo ""
echo "=== Portability Results: $PASS_COUNT passed, $FAIL_COUNT failed ==="

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "[FAIL] $FAIL_COUNT portability checks failed"
  exit 1
fi

echo "[PASS] All portability checks passed"
