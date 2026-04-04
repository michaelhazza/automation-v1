#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="No Direct Role Checks in Routes"
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

# Find direct role checks: req.user.role or req.user!.role used for === or !== comparisons
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  is_whitelisted "$file" && continue

  # Skip comment lines
  echo "$content" | grep -qE '^\s*//' && continue

  # Skip lines that pass role as a parameter (not access control)
  # e.g., someService.method(..., req.user!.role, ...)
  # We flag === and !== comparisons (actual access control decisions)
  if echo "$content" | grep -qE 'req\.user[!]?\.role\s*(===|!==)'; then
    echo "❌ $file:$lineno"
    echo "  $content"
    echo "  → Use requireSystemAdmin or requireOrgPermission() middleware instead of direct role check"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn 'req\.user.\?\.role' "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $FILES_SCANNED files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 2  # Tier 2: warning (many existing violations)
fi

exit 0
