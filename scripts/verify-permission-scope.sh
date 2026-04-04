#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Permission Scope"
VIOLATIONS=0
FILES_SCANNED=0

echo "[GUARD] $GUARD_NAME"

# Find files with :subaccountId routes that only use requireOrgPermission (not requireSubaccountPermission)
while IFS= read -r file; do
  FILES_SCANNED=$((FILES_SCANNED + 1))

  if grep -q ':subaccountId' "$file" 2>/dev/null; then
    has_subaccount_perm=false
    has_org_perm=false
    grep -q 'requireSubaccountPermission' "$file" 2>/dev/null && has_subaccount_perm=true
    grep -q 'requireOrgPermission' "$file" 2>/dev/null && has_org_perm=true

    if ! $has_subaccount_perm && $has_org_perm; then
      lineno=$(grep -n ':subaccountId' "$file" | head -1 | cut -d: -f1)
      echo "❌ $file:$lineno"
      echo "  Route has :subaccountId but uses requireOrgPermission instead of requireSubaccountPermission"
      echo "  → Use requireSubaccountPermission() for routes scoped to a subaccount"
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
