#!/usr/bin/env bash
set -euo pipefail

# Gate: Run the visibility parity harness test.
# This invokes the TypeScript parity harness that verifies RLS predicates
# match the application-level visibility filter for all canonical tables.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="visibility-parity"
GUARD_NAME="Visibility Parity (P3B)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

HARNESS_FILE="$ROOT_DIR/server/services/__tests__/visibilityParityHarness.ts"

if [ ! -f "$HARNESS_FILE" ]; then
  emit_violation "$GUARD_ID" "warning" "$HARNESS_FILE" "0" \
    "Visibility parity harness does not exist yet" \
    "Create server/services/__tests__/visibilityParityHarness.ts before P3B"
  emit_summary "0" "1"
  exit 2
fi

cd "$ROOT_DIR"
if npx tsx "$HARNESS_FILE" 2>&1; then
  emit_summary "1" "0"
  exit 0
else
  emit_violation "$GUARD_ID" "error" "$HARNESS_FILE" "0" \
    "Visibility parity harness failed" \
    "Fix visibility predicate drift between RLS policies and application-level filters"
  emit_summary "1" "1"
  exit_code=$(check_baseline "$GUARD_ID" "1" 1)
  exit "$exit_code"
fi
