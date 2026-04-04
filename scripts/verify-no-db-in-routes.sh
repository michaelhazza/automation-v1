#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="No Direct DB in Routes"
VIOLATIONS=0
FILES_SCANNED=0

# Whitelist (known exceptions with justified reasons)
WHITELIST=(
  "server/routes/mcp.ts"
  "server/routes/webhooks/ghlWebhook.ts"
  "server/routes/githubWebhook.ts"
  "server/routes/webhooks.ts"
)

is_whitelisted() {
  local file="$1"
  for w in "${WHITELIST[@]}"; do
    [[ "$file" == *"$w" ]] && return 0
  done
  return 1
}

echo "[GUARD] $GUARD_NAME"

while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  is_whitelisted "$file" && continue

  echo "❌ $file:$lineno"
  echo "  $content"
  echo "  → Move database queries to a service in server/services/"
  echo ""
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rn "import.*db.*from.*['\"].*\/db" "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $FILES_SCANNED files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 2  # Tier 2: warning (many existing violations)
fi

exit 0
