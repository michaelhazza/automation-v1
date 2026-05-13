#!/usr/bin/env bash
# verify-execution-capability-references.sh — CI gate for § 3.2 item 2.
#
# Asserts that the capability literals 'long_running' and 'session_identity'
# appear ONLY in their canonical definition site and a small set of approved
# reference locations. Any occurrence outside the allow-list is a violation
# (a caller is hardcoding a capability string rather than importing the type).
#
# Allow-list (paths whose occurrences are always permitted):
#   1. server/services/executionBackends/types.ts       — canonical union definition
#   2. server/services/executionBackends/*.ts            — adapter capability declarations
#   3. Any path containing __tests__/ or .test.ts       — test fixtures
#   4. Any path under docs/, tasks/, scripts/__tests__/ — spec/brief/plan/docs
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
#   - server/services/executionBackends/ (types.ts + adapter files)
#   - __tests__/ directories (test fixtures)
#   - .test.ts files
#   - docs/, tasks/, scripts/__tests__/ (documentation / spec / plans)
ALLOWLIST_PATTERN="server/services/executionBackends/|__tests__/|\.test\.ts|^docs/|^tasks/|scripts/__tests__/"

# Scan all TypeScript files under server/, client/, shared/, scripts/.
# Paths in the grep output are absolute; convert to relative for the allow-list filter.
hits=$(
  grep -rn --include='*.ts' \
    "'long_running'\|'session_identity'" \
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
  echo "[FAIL] verify-execution-capability-references: capability literals 'long_running' / 'session_identity' found outside the allow-list:"
  echo "$hits" | while IFS= read -r line; do
    echo "  $line"
  done
  echo ""
  echo "These literals must only appear in:"
  echo "  - server/services/executionBackends/types.ts (canonical union)"
  echo "  - server/services/executionBackends/*.ts (adapter declarations)"
  echo "  - __tests__/ directories or *.test.ts files (test fixtures)"
  echo "  - docs/, tasks/, scripts/__tests__/ (documentation)"
  echo ""
  echo "Import the ExecutionCapability type and declare the capability in the adapter's"
  echo "'capabilities' array rather than hardcoding the string literal at call sites."
  FAIL=1
fi

if [ $FAIL -eq 0 ]; then
  echo "[PASS] verify-execution-capability-references: all 'long_running' / 'session_identity' references are in approved locations"
  exit 0
else
  exit 1
fi
