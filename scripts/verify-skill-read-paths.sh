#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-skill-read-paths.sh
#
# Gate: Every ActionDefinition entry in ACTION_REGISTRY must have readPath.
# liveFetch actions must have liveFetchRationale.
#
# Hardened in refactor-action-registry Chunk 2: the awk/grep text-counting
# body (with its fragile calibration constant) has been replaced by a
# TypeScript runtime-loading harness (scripts/verify-skill-read-paths.ts)
# that loads the registry directly from source via tsx and checks the
# invariant per-entry. The calibration constant is removed entirely. No
# `npm run build:server` step required (matches verify-risk-tier-assigned.ts).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="skill-read-paths"
GUARD_NAME="Action Registry readPath declared on every entry"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=1

emit_header "$GUARD_NAME"

gate_failed=0
npx tsx "$ROOT_DIR/scripts/verify-skill-read-paths.ts" || gate_failed=1

if [ "$gate_failed" -eq 1 ]; then
  emit_violation "$GUARD_ID" "error" "server/config/actionRegistry" "0" \
    "One or more entries missing or invalid readPath / liveFetchRationale (see stderr above)" \
    "Every ACTION_REGISTRY entry must have readPath: 'canonical' | 'liveFetch' | 'none'. liveFetch entries must also have a non-empty liveFetchRationale."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
