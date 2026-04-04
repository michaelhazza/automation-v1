#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Async Handler Wrapping"
VIOLATIONS=0
FILES_SCANNED=0

# Whitelist (known exceptions)
WHITELIST=(
  "server/routes/mcp.ts"
  "server/routes/githubWebhook.ts"
  "server/routes/webhooks/ghlWebhook.ts"
)

is_whitelisted() {
  local file="$1"
  for w in "${WHITELIST[@]}"; do
    [[ "$file" == *"$w" ]] && return 0
  done
  return 1
}

echo "[GUARD] $GUARD_NAME"

# Find async route handlers not wrapped in asyncHandler
# Look for route method calls (.get(, .post(, etc.) followed by async (req without asyncHandler
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  is_whitelisted "$file" && continue

  # Skip if asyncHandler is on the same line
  echo "$content" | grep -q 'asyncHandler' && continue

  # Only flag lines that look like route handler definitions
  if echo "$content" | grep -qE '\.(get|post|put|patch|delete|all)\(|router\.(get|post|put|patch|delete|all)'; then
    echo "❌ $file:$lineno"
    echo "  $content"
    echo "  → Wrap handler in asyncHandler() to ensure errors are caught and standardized"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn 'async (req' "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null | grep -v 'asyncHandler' | grep -v '^\s*//' | grep -v 'node_modules' || true)

# Also check for async handlers on lines following route definitions
# Pattern: route definition on one line, bare async on next
while IFS= read -r file; do
  is_whitelisted "$file" && continue

  # Use awk to find route definitions followed by async (req without asyncHandler
  while IFS= read -r match; do
    [ -z "$match" ] && continue
    lineno=$(echo "$match" | cut -d: -f1)
    content=$(echo "$match" | cut -d: -f2-)

    echo "❌ $file:$lineno"
    echo "  $content"
    echo "  → Wrap handler in asyncHandler() to ensure errors are caught and standardized"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(awk '
    /\.(get|post|put|patch|delete|all)\(/ && !/asyncHandler/ && !/async/ { route_line=NR; next }
    route_line && NR == route_line+1 && /async\s*\(req/ && !/asyncHandler/ {
      print NR ":" $0
      route_line=0
      next
    }
    { route_line=0 }
  ' "$file" 2>/dev/null || true)
done < <(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' 2>/dev/null)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $FILES_SCANNED files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 1  # Tier 1: hard fail
fi

exit 0
