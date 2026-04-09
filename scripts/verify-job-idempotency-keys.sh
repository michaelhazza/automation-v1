#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-job-idempotency-keys.sh
#
# Introduced by Sprint 2 P1.1 Layer 3 of docs/improvements-roadmap-spec.md.
#
# Enforces the Execution Model contract at the job-queue layer: every
# entry in server/config/jobConfig.ts JOB_CONFIG must declare an
# `idempotencyStrategy` field. pg-boss delivers at-least-once; without
# an explicit dedup strategy per job, a retried delivery can double-fire
# side effects.
#
# Valid strategies:
#   'singleton-key' — enqueue site passes singletonKey in options
#   'payload-key'   — payload carries an idempotencyKey (or equivalent)
#   'one-shot'      — job fires at most once per source event
#   'fifo'          — every enqueue is a distinct unit; handler is idempotent
#                     over the underlying state
#
# The check is a structural parallel to
# verify-idempotency-strategy-declared.sh (ACTION_REGISTRY entries). It
# counts JOB_CONFIG entries and counts `idempotencyStrategy:` field
# occurrences inside the object literal; a mismatch means at least one
# entry is missing the field.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="job-idempotency-keys"
GUARD_NAME="JOB_CONFIG idempotencyStrategy declared on every job"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

CONFIG_FILE="$ROOT_DIR/server/config/jobConfig.ts"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "[GUARD] $GUARD_NAME: jobConfig.ts not found at $CONFIG_FILE — failing"
  emit_summary 0 1
  exit 1
fi

FILES_SCANNED=1

# Count top-level entries — lines matching `^  '<name>': {$` inside the
# `export const JOB_CONFIG = {` literal. Job names are quoted kebab-case.
ENTRY_COUNT=$(awk "
  /^export const JOB_CONFIG/ { inside=1; next }
  inside && /^} as const;/ { inside=0 }
  inside && /^  '[a-z][a-zA-Z0-9:_-]*': \{\$/ { count++ }
  END { print count+0 }
" "$CONFIG_FILE")

# Count idempotencyStrategy occurrences inside the object literal. Matches
# only field declarations on property lines, not the comment / type alias
# at the top of the file.
STRATEGY_COUNT=$(awk "
  /^export const JOB_CONFIG/ { inside=1; next }
  inside && /^} as const;/ { inside=0 }
  inside && /idempotencyStrategy:/ { count++ }
  END { print count+0 }
" "$CONFIG_FILE")

echo "  JOB_CONFIG entries:     $ENTRY_COUNT"
echo "  idempotencyStrategy:    $STRATEGY_COUNT"

if [ "$ENTRY_COUNT" -eq 0 ]; then
  echo "[GUARD] $GUARD_NAME: zero entries detected — JOB_CONFIG parse failed?"
  emit_summary "$FILES_SCANNED" 1
  exit 1
fi

if [ "$STRATEGY_COUNT" -lt "$ENTRY_COUNT" ]; then
  MISSING=$((ENTRY_COUNT - STRATEGY_COUNT))
  emit_violation "$GUARD_ID" "error" "server/config/jobConfig.ts" "0" \
    "$MISSING / $ENTRY_COUNT JOB_CONFIG entries missing idempotencyStrategy field" \
    "Add idempotencyStrategy: 'singleton-key' | 'payload-key' | 'one-shot' | 'fifo' to every JOB_CONFIG entry. See docs/improvements-roadmap-spec.md Sprint 2 P1.1 Layer 3 for the contract."
  VIOLATIONS=$((VIOLATIONS + 1))

  # Helpful: list which entries don't have the field.
  echo ""
  echo "  Entries missing idempotencyStrategy:"
  awk "
    /^export const JOB_CONFIG/ { inside=1; next }
    inside && /^} as const;/ { inside=0 }
    inside && /^  '([a-z][a-zA-Z0-9:_-]*)': \{\$/ {
      match(\$0, /'[a-z][a-zA-Z0-9:_-]*'/)
      current_entry = substr(\$0, RSTART+1, RLENGTH-2)
      found = 0
      next
    }
    inside && /idempotencyStrategy:/ { found = 1 }
    inside && /^  \},\$/ {
      if (current_entry != \"\" && !found) {
        print \"    - \" current_entry
      }
      current_entry = \"\"
      found = 0
    }
  " "$CONFIG_FILE"
fi

# Sanity check: every declared strategy must be one of the four valid values.
INVALID=$(grep -nE "idempotencyStrategy: ['\"][^'\"]+['\"]" "$CONFIG_FILE" \
  | grep -vE "idempotencyStrategy: ['\"](singleton-key|payload-key|one-shot|fifo)['\"]" \
  || true)

if [ -n "$INVALID" ]; then
  echo ""
  echo "  Invalid idempotencyStrategy values:"
  echo "$INVALID" | while IFS= read -r line; do
    echo "    $line"
  done
  VIOLATIONS=$((VIOLATIONS + 1))
  emit_violation "$GUARD_ID" "error" "server/config/jobConfig.ts" "0" \
    "JOB_CONFIG contains invalid idempotencyStrategy values" \
    "Valid strategies: 'singleton-key' | 'payload-key' | 'one-shot' | 'fifo'"
fi

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
