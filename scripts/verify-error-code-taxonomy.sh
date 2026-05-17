#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-error-code-taxonomy.sh   (CHATGPT-R3-2 v1)
#
# Counts every `errorCode: '<literal>'` callsite in server/ + shared/
# (excluding tests + fixtures) and rejects any code NOT present in the
# canonical taxonomy at `shared/types/errorCodes.ts`.
#
# Operates in baseline mode: the count of LEGACY callsites that have not yet
# imported the `ErrorCode` type is tracked in `scripts/guard-baselines.json`
# under the `error-code-taxonomy` key. The gate passes when:
#
#   * Every error-code literal is a member of the canonical union, AND
#   * The legacy-callsite count is at or below the recorded baseline.
#
# It fails when:
#
#   * A new error-code literal appears that is NOT in shared/types/errorCodes.ts
#     (i.e. someone added a typo or a new code without registering it), OR
#   * The legacy-callsite count regresses above baseline (someone added a
#     new raw-string callsite for an already-known code instead of importing
#     the typed union).
#
# v2 follow-up (tasks/todo.md CHATGPT-R3-2-V2): migrate the remaining ~420
# callsites to import `ErrorCode` from shared/types/errorCodes.ts. Each
# batch tightens the baseline. Final state — zero legacy callsites — flips
# the gate from baseline mode to strict mode and the baseline entry is
# removed.
#
# Exit codes: 0 = clean, 1 = unknown code OR baseline regression
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="error-code-taxonomy"

source "$SCRIPT_DIR/lib/guard-utils.sh"

CODES_FILE="$ROOT_DIR/shared/types/errorCodes.ts"

if [ ! -f "$CODES_FILE" ]; then
  echo "verify-error-code-taxonomy.sh: canonical taxonomy file missing at shared/types/errorCodes.ts"
  exit 1
fi

# Extract the canonical code list from the const array literal.
KNOWN_CODES=$(sed -nE "s/^[[:space:]]*'([^']+)',?$/\1/p" "$CODES_FILE")

# Collect every literal `errorCode: '<value>'` from production code paths.
# Excluded: __tests__ (test fixtures legitimately raise invented codes for
# negative-path assertions), fixtures, node_modules, dist, .git.
HITS=$(grep -rnE "errorCode\s*:\s*['\"][^'\"]+['\"]" \
  "$ROOT_DIR/server" "$ROOT_DIR/shared" \
  --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=__tests__ --exclude-dir=fixtures \
  2>/dev/null || true)

UNKNOWN_VIOLATIONS=0

while IFS= read -r line; do
  [ -z "$line" ] && continue
  # Pull the literal between the first pair of quotes following errorCode:.
  code=$(echo "$line" | sed -nE "s/.*errorCode\s*:\s*['\"]([^'\"]+)['\"].*/\1/p")
  [ -z "$code" ] && continue

  # Skip the well-known false-positive: `'errorCode' in result` checks (Pure
  # membership test, not a literal code emission).
  if [ "$code" = "errorCode" ]; then
    continue
  fi

  # Membership check — fail immediately on the first unknown code.
  if ! echo "$KNOWN_CODES" | grep -qx -- "$code"; then
    location=$(echo "$line" | cut -d: -f1,2)
    rel_path="${location#$ROOT_DIR/}"
    echo "verify-error-code-taxonomy.sh: unknown error code '$code' at $rel_path — add it to shared/types/errorCodes.ts ERROR_CODES list"
    UNKNOWN_VIOLATIONS=$((UNKNOWN_VIOLATIONS + 1))
  fi
done <<< "$HITS"

if [ "$UNKNOWN_VIOLATIONS" -gt 0 ]; then
  exit 1
fi

# Legacy-callsite count: every literal callsite that has not yet been
# migrated to the typed union. v1 records this count as a baseline so the
# gate can fail on regressions without blocking the PR on the bulk
# migration.
TOTAL_LITERAL_CALLSITES=$(echo "$HITS" | grep -c "errorCode" || true)
# Subtract the `'errorCode' in result` false-positives from the count.
FALSE_POSITIVES=$(echo "$HITS" | grep -c "errorCode\s*:\s*['\"]errorCode['\"]" || true)
LEGACY_COUNT=$((TOTAL_LITERAL_CALLSITES - FALSE_POSITIVES))

# Each legacy callsite counts as a violation against the baseline. The
# guard-util emit_summary contract is `<files_scanned> <violations>`; for a
# baseline-style gate `files_scanned` is the universe we walked (one entry
# per line of HITS) and `violations` is the current legacy count tracked
# against guard-baselines.json.
FILES_SCANNED=$(echo "$HITS" | grep -c "" || true)
emit_summary "$FILES_SCANNED" "$LEGACY_COUNT"
exit_code=$(check_baseline "$GUARD_ID" "$LEGACY_COUNT" 0)
exit "$exit_code"
