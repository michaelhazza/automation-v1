#!/usr/bin/env bash
# Event-type-registry gate self-test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GATE="$ROOT_DIR/scripts/verify-event-type-registry.sh"

if [ ! -f "$GATE" ]; then
  echo "[FAIL] Gate script not found at $GATE" >&2
  exit 1
fi

OUTPUT="$(EVENT_TYPE_REGISTRY_SCAN_DIR="$SCRIPT_DIR" bash "$GATE" 2>&1 || true)"
echo "$OUTPUT"

COUNT_LINE="$(echo "$OUTPUT" | grep -E '^\[GATE\] event-type-registry: violations=' || true)"
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

if ! echo "$OUTPUT" | grep -q "totally_unknown_event_xyz"; then
  echo "[FAIL] Expected 'totally_unknown_event_xyz' to be flagged" >&2
  exit 1
fi

echo "[PASS] event-type-registry self-test: $VIOLATIONS violation(s) reported on fixture"
exit 0
