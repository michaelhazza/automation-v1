#!/usr/bin/env bash
# Test: verify the [GATE] parser handles post-emit_summary output correctly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$SCRIPT_DIR/verify-discipline-fixture.sh"

# The canonical parser: grep first, then tail -n 1
output=$(bash "$FIXTURE" 2>&1 | grep -E '^\[GATE\] [a-z0-9-]+: violations=[0-9]+$' | tail -n 1)
if [ "$output" != "[GATE] discipline-fixture: violations=0" ]; then
  echo "FAIL: expected '[GATE] discipline-fixture: violations=0', got: '$output'"
  exit 1
fi

echo "PASS: gate-output-discipline — parser correctly extracts [GATE] line even with post-emit output"
