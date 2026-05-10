#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-action-registry-zod.sh
#
# Introduced by P0.2 Slice A of docs/improvements-roadmap-spec.md.
#
# Enforces that every entry in ACTION_REGISTRY uses Zod for its
# parameterSchema, not the legacy hand-rolled ParameterSchema interface shape.
#
# Hardened in refactor-action-registry Chunk 2: the awk text-counting body
# has been replaced by a TypeScript runtime-loading harness
# (scripts/verify-action-registry-zod.ts) that loads the registry directly
# from source via tsx and checks the invariant per-entry. No `npm run build:server`
# step required (matches verify-risk-tier-assigned.ts pattern).
#
# Suppression: not supported. The conversion is mandatory and
# non-negotiable per the spec.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="action-registry-zod"
GUARD_NAME="Action Registry uses Zod parameterSchema"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=1

emit_header "$GUARD_NAME"

gate_failed=0
npx tsx "$ROOT_DIR/scripts/verify-action-registry-zod.ts" || gate_failed=1

if [ "$gate_failed" -eq 1 ]; then
  emit_violation "$GUARD_ID" "error" "server/config/actionRegistry" "0" \
    "One or more entries use a non-Zod parameterSchema (see stderr above)" \
    "Convert to z.object({...}). See P0.2 Slice A in docs/improvements-roadmap-spec.md."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
