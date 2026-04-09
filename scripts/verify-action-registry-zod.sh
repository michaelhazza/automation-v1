#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-action-registry-zod.sh
#
# Introduced by P0.2 Slice A of docs/improvements-roadmap-spec.md.
#
# Enforces that every entry in server/config/actionRegistry.ts uses
# Zod for its parameterSchema, not the legacy hand-rolled
# ParameterSchema interface shape.
#
# The check looks for the legacy literal pattern:
#     parameterSchema: { type: 'object'
# inside the const ACTION_REGISTRY block. If any are found, the gate
# fails.
#
# After Slice A lands, every entry uses:
#     parameterSchema: z.object({...})
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
FILES_SCANNED=0

emit_header "$GUARD_NAME"

REGISTRY_FILE="$ROOT_DIR/server/config/actionRegistry.ts"

if [ ! -f "$REGISTRY_FILE" ]; then
  echo "[GUARD] $GUARD_NAME: registry file not found at $REGISTRY_FILE — failing"
  emit_summary 0 1
  exit 1
fi

FILES_SCANNED=1

# Count legacy parameterSchema literals inside the ACTION_REGISTRY const.
# A legacy entry looks like:
#     parameterSchema: {
#       type: 'object',
#       ...
LEGACY_COUNT=$(awk '
  /^export const ACTION_REGISTRY/ { inside=1; next }
  inside && /^\};?$/ { inside=0 }
  inside && /parameterSchema: \{/ { count++ }
  END { print count+0 }
' "$REGISTRY_FILE")

# Count Zod parameterSchema usages inside the ACTION_REGISTRY const.
# A Zod entry looks like:
#     parameterSchema: z.object({
ZOD_COUNT=$(awk '
  /^export const ACTION_REGISTRY/ { inside=1; next }
  inside && /^\};?$/ { inside=0 }
  inside && /parameterSchema: z\.object\(/ { count++ }
  END { print count+0 }
' "$REGISTRY_FILE")

# Count total entries (top-level keys).
ENTRY_COUNT=$(awk '
  /^export const ACTION_REGISTRY/ { inside=1; next }
  inside && /^\};?$/ { inside=0 }
  inside && /^  [a-z_][a-zA-Z0-9_]*: \{$/ { count++ }
  END { print count+0 }
' "$REGISTRY_FILE")

echo "  Entries:                    $ENTRY_COUNT"
echo "  Legacy parameterSchema:     $LEGACY_COUNT"
echo "  Zod parameterSchema:        $ZOD_COUNT"

if [ "$LEGACY_COUNT" -gt 0 ]; then
  emit_violation "$GUARD_ID" "error" "server/config/actionRegistry.ts" "0" \
    "$LEGACY_COUNT entries still use the legacy 'parameterSchema: { type: \"object\", ... }' shape" \
    "Convert to z.object({...}). See P0.2 Slice A in docs/improvements-roadmap-spec.md for the conversion rules."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ "$ZOD_COUNT" -lt "$ENTRY_COUNT" ]; then
  MISSING=$((ENTRY_COUNT - ZOD_COUNT))
  emit_violation "$GUARD_ID" "error" "server/config/actionRegistry.ts" "0" \
    "$MISSING / $ENTRY_COUNT entries are missing a Zod parameterSchema" \
    "Every ACTION_REGISTRY entry must have parameterSchema: z.object({...})."
  VIOLATIONS=$((VIOLATIONS + 1))
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
