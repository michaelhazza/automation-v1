#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="input-validation"
GUARD_NAME="Input Validation"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

while IFS= read -r file; do
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if grep -qE '\.(post|patch)\(' "$file" 2>/dev/null; then
    has_validation=false
    has_body_access=false
    grep -qE 'validateBody|z\.object|\.parse\(|\.safeParse\(' "$file" 2>/dev/null && has_validation=true
    grep -q 'req\.body' "$file" 2>/dev/null && has_body_access=true

    if $has_body_access && ! $has_validation; then
      lineno=$(grep -nE 'req\.body' "$file" | head -1 | cut -d: -f1)
      relative_file=${file#"$ROOT_DIR/"}

      # Check suppression on the first req.body line
      is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

      emit_violation "$GUARD_ID" "warning" "$relative_file" "$lineno" \
        "POST/PATCH handler accesses req.body without schema validation" \
        "Add: const body = validateBody(req, z.object({ field: z.string() })); or use validateBody() middleware"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done < <(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null)

TOTAL_FILES=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$TOTAL_FILES" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
