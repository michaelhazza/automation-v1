#!/usr/bin/env bash
# verify-operator-event-registry.sh — CI gate for spec §4.7 namespace discipline.
#
# Asserts that naked 'operator-session.*' string literals only appear in the
# registry file and a small set of approved reference locations. Any occurrence
# outside the allow-list is a violation (a caller is hardcoding an event name
# string rather than importing from the registry).
#
# Allow-list (paths whose occurrences are always permitted):
#   1. shared/types/operatorBackendEvents.ts  — SINGLE SOURCE OF TRUTH (the registry)
#   2. Any path containing __tests__/ or .test.ts — test fixtures
#   3. Any path under docs/, tasks/, scripts/__tests__/ — spec/brief/plan/docs
#   4. .sh files — gate scripts themselves (matched by .sh: in grep output lines)
#   5. .md files — documentation / runbooks (matched by .md: in grep output lines)
#
# Exit codes (per gate convention):
#   0 — all checks pass
#   1 — one or more violations detected (blocking)
#
# CRLF-safe: grep patterns do not rely on line endings.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FAIL=0

# Build the grep command and filter hits against the allow-list.
# Allow-list paths (as ERE patterns for grep -vE on the output lines):
#   - shared/types/operatorBackendEvents.ts (the registry file itself)
#   - shared/types/runTraceEvent.ts (consumer-side type registry; string literals are discriminated union members, not emit sites)
#   - __tests__/ directories (test fixtures)
#   - .test.ts files
#   - docs/, tasks/, scripts/__tests__/ (documentation / spec / plans)
#   - .sh files (gate scripts)
#   - .md files (documentation / runbooks)
ALLOWLIST_PATTERN="shared/types/operatorBackendEvents\.ts|shared/types/runTraceEvent\.ts|__tests__/|\.test\.ts|^docs/|^tasks/|scripts/__tests__/|\.sh:|\.md:"

# Scan all TypeScript files under server/, client/, shared/, scripts/.
# Paths in the grep output are absolute; convert to relative for the allow-list filter.
hits=$(
  grep -rn --include='*.ts' \
    "operator-session\\." \
    "$ROOT_DIR/server/" \
    "$ROOT_DIR/client/" \
    "$ROOT_DIR/shared/" \
    "$ROOT_DIR/scripts/" \
    2>/dev/null \
  | sed "s|^$ROOT_DIR/||" \
  | grep -vE "$ALLOWLIST_PATTERN" \
  || true
)

if [ -n "$hits" ]; then
  echo "[FAIL] verify-operator-event-registry: naked 'operator-session.*' literals found outside the allow-list:"
  echo "$hits" | while IFS= read -r line; do
    echo "  $line"
  done
  echo ""
  echo "These literals must only appear in:"
  echo "  - shared/types/operatorBackendEvents.ts (the event registry — single source of truth)"
  echo "  - __tests__/ directories or *.test.ts files (test fixtures)"
  echo "  - docs/, tasks/, scripts/__tests__/ (documentation)"
  echo ""
  echo "Import the OperatorSessionEventName type and use event name constants from the"
  echo "registry rather than hardcoding 'operator-session.*' string literals at call sites."
  FAIL=1
fi

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-operator-event-registry: all 'operator-session.*' references are in approved locations"
  exit 0
else
  exit 1
fi
