#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# verify-risk-tier-assigned.sh
#
# Introduced by synthetos-foundation-refactor chunk 4.
#
# Enforces that every entry in server/config/actionRegistry.ts has a
# `riskTier` field (§4.2.5, §4.2.7, §9.1).
#
# Bash wrapper around the TypeScript harness, mirroring the pattern
# established by verify-visibility-parity.sh.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="risk-tier-assigned"
GUARD_NAME="Risk Tier Assigned (synthetos-foundation-refactor §4.2.5)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

HARNESS_FILE="$ROOT_DIR/scripts/verify-risk-tier-assigned.ts"

if [ ! -f "$HARNESS_FILE" ]; then
  emit_violation "$GUARD_ID" "error" "$HARNESS_FILE" "0" \
    "Risk-tier harness does not exist at $HARNESS_FILE" \
    "Restore scripts/verify-risk-tier-assigned.ts (synthetos-foundation-refactor chunk 4)"
  emit_summary "0" "1"
  exit 1
fi

cd "$ROOT_DIR"
if npx tsx "$HARNESS_FILE" 2>&1; then
  emit_summary "1" "0"
  exit 0
else
  emit_violation "$GUARD_ID" "error" "$HARNESS_FILE" "0" \
    "One or more ACTION_REGISTRY entries are missing a valid riskTier" \
    "Assign riskTier to every entry in server/config/actionRegistry.ts using the §4.2.3 rubric"
  emit_summary "1" "1"
  exit_code=$(check_baseline "$GUARD_ID" "1" 1)
  exit "$exit_code"
fi
