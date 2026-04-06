#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="rate-limiting"
GUARD_NAME="Rate Limiting on Sensitive Endpoints"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0

emit_header "$GUARD_NAME"

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

  has_endpoint=false
  grep -q "$path" "$full_path" 2>/dev/null && has_endpoint=true

  if $has_endpoint; then
    has_rate_limit=false

    while IFS= read -r line_info; do
      lineno=$(echo "$line_info" | cut -d: -f1)

      # Check suppression
      is_suppressed "$full_path" "$lineno" "$GUARD_ID" && { has_rate_limit=true; break; }

      # Check surrounding lines (10 before/after) for rate limiting
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
      emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
        "Sensitive endpoint '$path' missing rate limiting" \
        "Add rate limiting middleware: router.post('/$path', rateLimit({ windowMs: 15*60*1000, max: 5 }), handler)"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

emit_summary "${#REQUIRED_ENDPOINTS[@]}" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
