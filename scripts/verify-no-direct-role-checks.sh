#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="no-direct-role-checks"
GUARD_NAME="No Direct Role Checks in Routes"

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

while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  is_whitelisted "$file" && continue

  # Skip comment lines
  echo "$content" | grep -qE '^\s*//' && continue

  if echo "$content" | grep -qE 'req\.user[!]?\.role\s*(===|!==)'; then
    is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

    emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
      "$content" \
      "Use middleware: requireSystemAdmin, requireOrgPermission('permission'), or requireSubaccountPermission('permission')"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn 'req\.user.\?\.role' "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
