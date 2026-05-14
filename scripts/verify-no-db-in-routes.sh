#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-db-in-routes"
GUARD_NAME="No Direct DB in Routes"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  # Check for a bare guard-ignore that mentions this guard but lacks required T1 shape or legacy shape
  current_line=$(sed -n "${lineno}p" "$file" 2>/dev/null || true)
  if echo "$current_line" | grep -qE "guard-ignore.*${GUARD_ID}" && ! is_suppressed "$file" "$lineno" "$GUARD_ID"; then
    emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
      "Malformed guard-ignore: must be T1 format (guard-ignore ${GUARD_ID}: <ADR-id> <rationale>) or legacy (guard-ignore: ${GUARD_ID} reason=\"...\")" \
      "Fix the suppression comment to match the required format"
    VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi

  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
    "$content" \
    "Move database queries to a service in server/services/"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rn "import.*db.*from.*['\"].*\/db" "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
