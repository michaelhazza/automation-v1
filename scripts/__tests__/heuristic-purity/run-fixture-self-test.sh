#!/usr/bin/env bash
# Heuristic-purity gate self-test.
# Points the gate at the fixture directory and asserts it catches the violation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GATE="$ROOT_DIR/scripts/verify-heuristic-purity.sh"

if [ ! -f "$GATE" ]; then
  echo "[FAIL] Gate script not found at $GATE" >&2
  exit 1
fi

OUTPUT="$(HEURISTIC_PURITY_SCAN_DIR="$SCRIPT_DIR" bash "$GATE" 2>&1 || true)"
echo "$OUTPUT"

COUNT_LINE="$(echo "$OUTPUT" | grep -E '^\[GATE\] heuristic-purity: violations=' || true)"
if [ -z "$COUNT_LINE" ]; then
  echo "[FAIL] Gate did not emit the [GATE] count line" >&2
  exit 1
fi

VIOLATIONS="${COUNT_LINE##*violations=}"
if [ "$VIOLATIONS" -lt 1 ]; then
  echo "[FAIL] Expected >=1 violation on fixture-with-violation.ts, got $VIOLATIONS" >&2
  exit 1
fi

if ! echo "$OUTPUT" | grep -q "fixture-with-violation.ts"; then
  echo "[FAIL] Violation count >0 but fixture-with-violation.ts not named" >&2
  exit 1
fi

# Verify the clean fixture was NOT flagged
if echo "$OUTPUT" | grep -q "fixture-no-violation.ts"; then
  echo "[FAIL] fixture-no-violation.ts should not be flagged" >&2
  exit 1
fi

echo "[PASS] heuristic-purity self-test: $VIOLATIONS violation(s) reported on fixture"
exit 0
