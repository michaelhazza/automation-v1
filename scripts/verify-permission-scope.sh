#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="permission-scope"
GUARD_NAME="Permission Scope"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

while IFS= read -r file; do
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if grep -q ':subaccountId' "$file" 2>/dev/null; then
    has_subaccount_perm=false
    has_org_perm=false
    grep -q 'requireSubaccountPermission' "$file" 2>/dev/null && has_subaccount_perm=true
    grep -q 'requireOrgPermission' "$file" 2>/dev/null && has_org_perm=true

    if ! $has_subaccount_perm && $has_org_perm; then
      lineno=$(grep -n ':subaccountId' "$file" | head -1 | cut -d: -f1)

      # Check suppression on the first :subaccountId line
      is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

      emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
        "Route has :subaccountId but uses requireOrgPermission instead of requireSubaccountPermission" \
        "Replace requireOrgPermission('perm') with requireSubaccountPermission('perm') for subaccount-scoped routes"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done < <(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null)

TOTAL_FILES=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$TOTAL_FILES" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
