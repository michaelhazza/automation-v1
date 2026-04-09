#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-idempotency-strategy-declared.sh
#
# Introduced by P0.2 Slice B of docs/improvements-roadmap-spec.md.
#
# Enforces the Execution Model contract: every entry in
# server/config/actionRegistry.ts ACTION_REGISTRY must declare an
# `idempotencyStrategy` field. This is the structural enforcement of the
# at-least-once execution guarantee — handlers that don't declare a
# strategy may be unsafe under retry.
#
# The check counts entries (top-level keys in ACTION_REGISTRY) and counts
# `idempotencyStrategy:` field occurrences within the registry literal.
# If they don't match, at least one entry is missing the field.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="idempotency-strategy-declared"
GUARD_NAME="Action Registry idempotencyStrategy declared on every entry"

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

# Count top-level entries: lines matching `^  <name>: {$` after the
# `export const ACTION_REGISTRY = {` line.
# We use awk to find the boundaries of the const declaration and count
# entries within it.
ENTRY_COUNT=$(awk '
  /^export const ACTION_REGISTRY/ { inside=1; depth=0; next }
  inside && /^\};?$/ { inside=0 }
  inside && /^  [a-z_][a-zA-Z0-9_]*: \{$/ { count++ }
  END { print count+0 }
' "$REGISTRY_FILE")

# Count idempotencyStrategy occurrences inside the registry literal
# (excluding the interface declaration at the top of the file).
STRATEGY_COUNT=$(awk '
  /^export const ACTION_REGISTRY/ { inside=1; next }
  inside && /^\};?$/ { inside=0 }
  inside && /idempotencyStrategy:/ { count++ }
  END { print count+0 }
' "$REGISTRY_FILE")

echo "  Entries:                $ENTRY_COUNT"
echo "  idempotencyStrategy:    $STRATEGY_COUNT"

if [ "$ENTRY_COUNT" -eq 0 ]; then
  echo "[GUARD] $GUARD_NAME: zero entries detected — registry parse failed?"
  emit_summary "$FILES_SCANNED" 1
  exit 1
fi

if [ "$STRATEGY_COUNT" -lt "$ENTRY_COUNT" ]; then
  MISSING=$((ENTRY_COUNT - STRATEGY_COUNT))
  emit_violation "$GUARD_ID" "error" "server/config/actionRegistry.ts" "0" \
    "$MISSING / $ENTRY_COUNT entries missing idempotencyStrategy field" \
    "Add idempotencyStrategy: 'read_only' | 'keyed_write' | 'locked' to every ACTION_REGISTRY entry. See docs/improvements-roadmap-spec.md → Execution Model section for the contract."
  VIOLATIONS=$((VIOLATIONS + 1))

  # Helpful: list which entries don't have the field.
  echo ""
  echo "  Entries missing idempotencyStrategy:"
  awk '
    /^export const ACTION_REGISTRY/ { inside=1; next }
    inside && /^\};?$/ { inside=0 }
    inside && /^  ([a-z_][a-zA-Z0-9_]*): \{$/ {
      name = $1
      gsub(":", "", name)
      current_entry = name
      found = 0
      next
    }
    inside && /idempotencyStrategy:/ { found = 1 }
    inside && /^  \},$/ {
      if (current_entry != "" && !found) {
        print "    - " current_entry
      }
      current_entry = ""
      found = 0
    }
  ' "$REGISTRY_FILE"
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
