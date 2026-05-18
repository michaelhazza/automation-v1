#!/usr/bin/env bash
# OS-parity harness for quality gates.
#
# File-scanning gates: sets GATE_ROOT to a seeded fixture directory, runs the gate,
# asserts exit-code is non-zero (gate fired) AND stdout names the seeded fixture file.
#
# Non-file-scanning gates: runs against repo root, asserts exit ∈ {0,1,2,3}
# and stdout is non-empty.
#
# Gates without a fixture (complex fixture setup, no file-scanning surface, or
# excluded per spec §6.1 escape hatch): logged as excluded-with-rationale.
#
# Usage: bash scripts/test-gate-portability.sh
# Exit: 0 = all checks pass, 1 = one or more checks failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_DIR="${SCRIPT_DIR}/__tests__/gate-portability/fixtures"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

check_file_scanning_gate() {
  local gate_script="$1"
  local fixture_dir="$2"
  local seeded_file_pattern="$3"   # substring expected in stdout when fixture fires
  local gate_name="${gate_script##*/}"

  if [ ! -d "$fixture_dir" ]; then
    echo "[SKIP] $gate_name — no fixture at $fixture_dir (excluded-with-rationale)"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    return
  fi

  local output exit_code=0
  output=$(GATE_ROOT="$fixture_dir" bash "$gate_script" 2>&1) || exit_code=$?

  local pass=true
  if [ "$exit_code" -eq 0 ]; then
    echo "[FAIL] $gate_name — fixture did not trigger gate (exit 0)"
    pass=false
  fi

  if [ -n "$seeded_file_pattern" ] && ! echo "$output" | grep -q "$seeded_file_pattern"; then
    echo "[FAIL] $gate_name — stdout does not name seeded fixture file ('$seeded_file_pattern' not found)"
    pass=false
  fi

  if $pass; then
    echo "[PASS] $gate_name — fixture triggered gate (exit $exit_code) and stdout names seeded file"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

check_non_file_scanning_gate() {
  local gate_script="$1"
  local gate_name="${gate_script##*/}"

  local output exit_code=0
  output=$(bash "$gate_script" 2>&1) || exit_code=$?

  # Exit must be in {0,1,2,3}
  if [ "$exit_code" -gt 3 ]; then
    echo "[FAIL] $gate_name — unexpected exit code $exit_code (expected 0-3)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  # Stdout must be non-empty
  if [ -z "$output" ]; then
    echo "[FAIL] $gate_name — empty stdout"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  echo "[PASS] $gate_name — exit $exit_code, non-empty stdout"
  PASS_COUNT=$((PASS_COUNT + 1))
}

skip_gate() {
  local gate_script="$1"
  local reason="$2"
  local gate_name="${gate_script##*/}"
  echo "[SKIP] $gate_name — excluded-with-rationale: $reason"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

echo "=== Gate Portability Harness ==="
echo ""
echo "--- File-scanning gates (fixture injection + stdout validation) ---"

# The two confirmed bug-affected gates from Wave 6 Chunk 0 audit.
# Fixtures seeded with exactly one known violation each.
check_file_scanning_gate \
  "$SCRIPT_DIR/verify-with-org-tx-or-scoped-db.sh" \
  "$FIXTURES_DIR/verify-with-org-tx-or-scoped-db" \
  "seededViolation"

check_file_scanning_gate \
  "$SCRIPT_DIR/verify-no-direct-boss-work.sh" \
  "$FIXTURES_DIR/verify-no-direct-boss-work" \
  "seededBossWork"

echo ""
echo "--- Non-file-scanning gates (exit code + non-empty stdout) ---"

# Architecture + contract gates (bash/grep only — no GATE_ROOT surface)
check_non_file_scanning_gate "$SCRIPT_DIR/verify-rls-coverage.sh"
check_non_file_scanning_gate "$SCRIPT_DIR/verify-rls-contract-compliance.sh"
check_non_file_scanning_gate "$SCRIPT_DIR/verify-rls-protected-tables.sh"

echo ""
echo "--- Excluded gates (no fixture or non-GATE_ROOT-able surface) ---"

# Remaining file-scanning and pure-Node gates: excluded-with-rationale per spec §6.1
# escape hatch. These gates use npx tools (madge, jscpd, knip, depcheck) or have
# complex fixture requirements that exceed the portability harness scope.
# Wave 6 Chunk 0 audit confirmed only 2 gates have the POSIX-path bug;
# remaining gates use either cygpath-shim, pure-Node enumeration, or bash-only grep.
skip_gate "$SCRIPT_DIR/verify-no-new-cycles.sh"         "uses npx madge — pure-Node, no bash find pipeline"
skip_gate "$SCRIPT_DIR/verify-duplicate-blocks.sh"      "uses npx jscpd — pure-Node, no bash find pipeline"
skip_gate "$SCRIPT_DIR/verify-knip-config.sh"           "reads known config file paths — no GATE_ROOT surface"
skip_gate "$SCRIPT_DIR/verify-no-missing-deps.sh"       "uses npx depcheck — pure-Node, no bash find pipeline"
skip_gate "$SCRIPT_DIR/verify-no-orphan-react-component.sh" "ts-morph starting from known App.tsx — no GATE_ROOT surface"

echo ""
echo "=== Portability Results: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT excluded ==="

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "[FAIL] $FAIL_COUNT portability checks failed"
  exit 1
fi

echo "[PASS] All portability checks passed (excluding $SKIP_COUNT gates with rationale)"
