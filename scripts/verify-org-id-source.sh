#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Org ID Source"
VIOLATIONS=0
FILES_SCANNED=0

echo "[GUARD] $GUARD_NAME"

while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  # Skip comment lines
  echo "$content" | grep -qE '^\s*//' && continue

  # Skip fallback patterns: req.orgId ?? req.user!.organisationId (system admin cross-org)
  echo "$content" | grep -qE 'req\.orgId\s*\?\?' && continue

  echo "❌ $file:$lineno"
  echo "  $content"
  echo "  → Use req.orgId instead of req.user.organisationId (set by authenticate middleware, handles system admin org switching)"
  echo ""
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rn 'req\.user.\?\.organisationId' "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $FILES_SCANNED files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 2  # Tier 2: warning
fi

exit 0
