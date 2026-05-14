#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-idempotency-strategy-declared.sh
#
# Introduced by P0.2 Slice B of docs/improvements-roadmap-spec.md.
#
# Enforces the Execution Model contract: every entry in ACTION_REGISTRY must
# declare an `idempotencyStrategy` field. This is the structural enforcement
# of the at-least-once execution guarantee.
#
# Hardened in refactor-action-registry Chunk 2: the awk text-counting body
# has been replaced by a TypeScript runtime-loading harness
# (scripts/verify-idempotency-strategy-declared.ts) that loads the registry
# directly from source via tsx and checks the invariant per-entry. No
# `npm run build:server` step required (matches verify-risk-tier-assigned.ts).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="idempotency-strategy-declared"
GUARD_NAME="Action Registry idempotencyStrategy declared on every entry"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=1

emit_header "$GUARD_NAME"

gate_failed=0
npx tsx "$ROOT_DIR/scripts/verify-idempotency-strategy-declared.ts" || gate_failed=1

if [ "$gate_failed" -eq 1 ]; then
  emit_violation "$GUARD_ID" "error" "server/config/actionRegistry" "0" \
    "One or more entries missing or invalid idempotencyStrategy (see stderr above)" \
    "Add idempotencyStrategy: 'read_only' | 'keyed_write' | 'locked' | 'state_based' to every ACTION_REGISTRY entry. See docs/improvements-roadmap-spec.md → Execution Model section."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
