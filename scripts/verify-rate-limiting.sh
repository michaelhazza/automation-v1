#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Rate Limiting on Sensitive Endpoints"
VIOLATIONS=0

echo "[GUARD] $GUARD_NAME"

# Define sensitive endpoints that must have rate limiting
# Format: "file|path_pattern|method"
REQUIRED_ENDPOINTS=(
  "server/routes/auth.ts|forgot-password|post"
  "server/routes/auth.ts|reset-password|post"
  "server/routes/users.ts|invite|post"
  "server/routes/systemUsers.ts|invite|post"
  "server/routes/systemUsers.ts|reset-password|post"
)

for entry in "${REQUIRED_ENDPOINTS[@]}"; do
  IFS='|' read -r file path method <<< "$entry"
  full_path="$ROOT_DIR/$file"

  if [ ! -f "$full_path" ]; then
    continue
  fi

  # Check if the endpoint exists and has rate limiting
  # Look for the path pattern near a route definition
  has_endpoint=$(grep -c "$path" "$full_path" 2>/dev/null || echo "0")

  if [ "$has_endpoint" -gt 0 ]; then
    # Check if rate limiting is applied near that endpoint
    # Look for rateLimit, rateLimiter, slidingWindow within a few lines of the endpoint
    has_rate_limit=false

    # Get line numbers of the endpoint
    while IFS= read -r line_info; do
      lineno=$(echo "$line_info" | cut -d: -f1)
      # Check surrounding lines (10 lines before and after) for rate limiting
      start=$((lineno - 10))
      [ $start -lt 1 ] && start=1
      end=$((lineno + 10))

      context=$(sed -n "${start},${end}p" "$full_path" 2>/dev/null || true)
      if echo "$context" | grep -qiE 'rateLimit|rateLimiter|slidingWindow'; then
        has_rate_limit=true
        break
      fi
    done < <(grep -n "$path" "$full_path" 2>/dev/null || true)

    if ! $has_rate_limit; then
      lineno=$(grep -n "$path" "$full_path" | head -1 | cut -d: -f1)
      echo "❌ $file:$lineno"
      echo "  Sensitive endpoint '$path' missing rate limiting"
      echo "  → Add rate limiting middleware to prevent brute-force and abuse"
      echo ""
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

echo ""
echo "Summary: ${#REQUIRED_ENDPOINTS[@]} endpoints checked, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 2  # Tier 2: warning
fi

exit 0
