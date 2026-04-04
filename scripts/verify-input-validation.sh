#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Input Validation"
VIOLATIONS=0
FILES_SCANNED=0

echo "[GUARD] $GUARD_NAME"

# Find POST/PATCH handlers that destructure req.body without validation
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
      echo "❌ $relative_file:$lineno"
      echo "  POST/PATCH handler accesses req.body without schema validation"
      echo "  → Add Zod schema validation using validateBody() middleware or inline z.object().parse()"
      echo ""
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done < <(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null)

TOTAL_FILES=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $TOTAL_FILES files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 2  # Tier 2: warning
fi

exit 0
