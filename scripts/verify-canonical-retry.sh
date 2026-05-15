#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-canonical-retry.sh  (P5)
#
# Invariant: retry loops must go through server/lib/withBackoff.ts.
# Raw retry counter declarations in server/ TypeScript code are flagged.
#
# Flagged patterns (declarations):
#   - retryCount = <expr>     e.g. let retryCount = 0
#   - retryAttempts = <expr>  e.g. let retryAttempts = 0
#   - retries = <digit>       e.g. const retries = 3
#
# DB schema columns and function parameters named retryCount are NOT
# violations — only declarations of retry-counter local variables are.
# The gate excludes server/lib/withBackoff.ts (the canonical location).
#
# Suppression:
#   // guard-ignore: canonical-retry reason="<rationale, ≤120 chars>"
#   // guard-ignore-next-line: canonical-retry reason="<rationale, ≤120 chars>"
#
# Exit codes: 0=pass, 1=new violations or past-grace baseline expiry, 2=within baseline or within-grace expiry warning
# Warning-first rollout promoted to error 2026-05-15 (post-7-day soak from PR #307); exit-1 path was already in place via check_expiring_baseline.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="canonical-retry"
GUARD_NAME="Canonical Retry (use withBackoff)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
VIOLATION_KEYS=""
declare -A SEEN_FILES

emit_header "$GUARD_NAME"

is_file_suppressed() {
  local file="$1"
  local first_line
  first_line=$(sed -n '1p' "$file" 2>/dev/null || echo "")
  if echo "$first_line" | grep -qE "guard-ignore-file:\s*${GUARD_ID}\s+reason=\"[^\"]+\""; then
    return 0
  fi
  return 1
}

while IFS=: read -r file lineno line_content; do
  [ -z "$file" ] && continue

  # Exclude withBackoff.ts (canonical implementation)
  rel_path="${file#$ROOT_DIR/}"
  [[ "$rel_path" == "server/lib/withBackoff.ts" ]] && continue

  # Exclude test files
  [[ "$rel_path" == *"/__tests__/"* ]] && continue
  [[ "$rel_path" == *".test.ts" ]] && continue

  SEEN_FILES["$file"]=1

  if is_file_suppressed "$file" || is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    continue
  fi

  # Only flag declarations (let/const/var assignments), not references.
  # The grep pattern already targets assignment forms; skip DB schema columns
  # by excluding lines that contain .integer( or similar drizzle schema calls.
  if echo "$line_content" | grep -qE '(integer|text|varchar|boolean)\s*\('; then
    continue
  fi
  # Skip function parameter declarations (type annotations in signatures)
  if echo "$line_content" | grep -qE 'retryCount\s*:\s*(number|string)'; then
    continue
  fi

  emit_violation "$GUARD_ID" "warning" "$rel_path" "$lineno" \
    "Raw retry counter declaration — use server/lib/withBackoff.ts instead" \
    "$(format_suppression $GUARD_ID | head -1)"
  VIOLATIONS=$((VIOLATIONS + 1))
  VIOLATION_KEYS="${VIOLATION_KEYS}${rel_path}:${lineno}:Raw retry counter declaration — use server/lib/withBackoff.ts instead
"
done < <(grep -rnE '\b(let|const|var)\s+(retryCount|retryAttempts)\s*=|retries\s*=\s*[0-9]+' \
           "$ROOT_DIR/server" \
           --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=${#SEEN_FILES[@]}

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_expiring_baseline "$GUARD_ID" "$VIOLATION_KEYS")
exit "$exit_code"
