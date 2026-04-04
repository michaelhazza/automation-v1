#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="async-handler"
GUARD_NAME="Async Handler Wrapping"

source "$SCRIPT_DIR/lib/guard-utils.sh"

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

emit_header "$GUARD_NAME"

# Find async route handlers not wrapped in asyncHandler
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  is_whitelisted "$file" && continue

  # Skip if asyncHandler is on the same line
  echo "$content" | grep -q 'asyncHandler' && continue

  # Only flag lines that look like route handler definitions
  if echo "$content" | grep -qE '\.(get|post|put|patch|delete|all)\(|router\.(get|post|put|patch|delete|all)'; then
    is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

    emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
      "$content" \
      "Wrap handler in asyncHandler(): router.post('/path', asyncHandler(async (req, res) => { ... }))"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn 'async (req' "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null | grep -v 'asyncHandler' | grep -v '^\s*//' | grep -v 'node_modules' || true)

# Also check for async handlers on lines following route definitions
while IFS= read -r file; do
  is_whitelisted "$file" && continue

  while IFS= read -r match; do
    [ -z "$match" ] && continue
    lineno=$(echo "$match" | cut -d: -f1)
    content=$(echo "$match" | cut -d: -f2-)

    is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

    emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
      "$content" \
      "Wrap handler in asyncHandler(): router.post('/path', asyncHandler(async (req, res) => { ... }))"
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

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
