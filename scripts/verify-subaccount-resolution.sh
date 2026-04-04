#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Subaccount Resolution"
VIOLATIONS=0
FILES_SCANNED=0

# Whitelist (known exceptions)
WHITELIST=()

is_whitelisted() {
  local file="$1"
  for w in "${WHITELIST[@]+"${WHITELIST[@]}"}"; do
    [[ "$file" == *"$w" ]] && return 0
  done
  return 1
}

echo "[GUARD] $GUARD_NAME"

# Find files with :subaccountId routes that don't call resolveSubaccount
while IFS= read -r file; do
  is_whitelisted "$file" && continue

  FILES_SCANNED=$((FILES_SCANNED + 1))

  if grep -q ':subaccountId' "$file" 2>/dev/null; then
    if ! grep -q 'resolveSubaccount' "$file" 2>/dev/null; then
      lineno=$(grep -n ':subaccountId' "$file" | head -1 | cut -d: -f1)
      echo "❌ $file:$lineno"
      echo "  Route has :subaccountId parameter but no resolveSubaccount call"
      echo "  → Add resolveSubaccount(req.params.subaccountId, req.orgId!) to validate tenant ownership"
      echo ""
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done < <(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null)

TOTAL_FILES=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $TOTAL_FILES files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 1  # Tier 1: hard fail
fi

exit 0
