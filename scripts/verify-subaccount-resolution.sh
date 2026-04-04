#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="subaccount-resolution"
GUARD_NAME="Subaccount Resolution"

source "$SCRIPT_DIR/lib/guard-utils.sh"

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

emit_header "$GUARD_NAME"

while IFS= read -r file; do
  is_whitelisted "$file" && continue

  FILES_SCANNED=$((FILES_SCANNED + 1))

  if grep -q ':subaccountId' "$file" 2>/dev/null; then
    if ! grep -q 'resolveSubaccount' "$file" 2>/dev/null; then
      lineno=$(grep -n ':subaccountId' "$file" | head -1 | cut -d: -f1)

      # Check for file-level suppression (on line 1 or 2)
      is_suppressed "$file" 1 "$GUARD_ID" && continue
      is_suppressed "$file" 2 "$GUARD_ID" && continue

      emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
        "Route has :subaccountId parameter but no resolveSubaccount call" \
        "Add: const subaccount = await resolveSubaccount(req.params.subaccountId, req.orgId!);"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done < <(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null)

TOTAL_FILES=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$TOTAL_FILES" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
