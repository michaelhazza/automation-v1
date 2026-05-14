#!/usr/bin/env bash
# H1 gate self-test (spec §H1 acceptance: "deliberate-violation fixture must fail").
#
# Points the gate at the fixture directory, runs the gate, and asserts that
# at least one violation was reported on `fixture-with-violation.ts`. Any
# other outcome — gate produced zero violations, gate errored before scanning,
# or violation count was misreported — is a regression in the gate itself.
#
# Run via: bash scripts/__tests__/derived-data-null-safety/run-fixture-self-test.sh
#
# Note: the underlying gate is ADVISORY in Phase 1 (always exits 0). This runner
# parses the gate's `[GATE] derived-data-null-safety: violations=<n>` line and
# returns a non-zero exit code when n=0, so CI / a developer can chain it as a
# real test even while the production gate stays advisory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GATE="$ROOT_DIR/scripts/verify-derived-data-null-safety.sh"

if [ ! -x "$GATE" ] && [ ! -f "$GATE" ]; then
  echo "[FAIL] gate script not found at $GATE" >&2
  exit 1
fi

# Run the gate against the fixture directory only.
# `|| true` so the runner survives a future flip of the gate from advisory
# (`exit 0`) to blocking (`exit 1`) — the runner's job is to assert the
# count line, not propagate the gate's exit code.
OUTPUT="$(DERIVED_DATA_NULL_SAFETY_SCAN_DIR="$SCRIPT_DIR" bash "$GATE" 2>&1 || true)"
echo "$OUTPUT"

# Extract the violation count from the C1-format count line.
COUNT_LINE="$(echo "$OUTPUT" | grep -E '^\[GATE\] derived-data-null-safety: violations=' || true)"
if [ -z "$COUNT_LINE" ]; then
  echo "[FAIL] gate did not emit the [GATE] count line" >&2
  exit 1
fi

VIOLATIONS="${COUNT_LINE##*violations=}"

if [ "$VIOLATIONS" -lt 1 ]; then
  echo "[FAIL] expected >=1 violation on fixture-with-violation.ts, got $VIOLATIONS" >&2
  exit 1
fi

# Confirm the violation specifically named the fixture, not some other file
# that happens to live in the scan dir.
if ! echo "$OUTPUT" | grep -q "fixture-with-violation.ts"; then
  echo "[FAIL] violation count >0 but no violation reported on fixture-with-violation.ts" >&2
  exit 1
fi

echo "[PASS] H1 gate self-test: $VIOLATIONS violation(s) reported on fixture"
exit 0
