#!/usr/bin/env bash
set -euo pipefail

# Run all architecture guards and capture current violation counts as the new baseline.
# Usage: bash scripts/update-guard-baselines.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE_FILE="$SCRIPT_DIR/guard-baselines.json"

GUARDS=(
  "no-db-in-routes|verify-no-db-in-routes.sh"
  "async-handler|verify-async-handler.sh"
  "subaccount-resolution|verify-subaccount-resolution.sh"
  "org-scoped-writes|verify-org-scoped-writes.sh"
  "no-direct-role-checks|verify-no-direct-role-checks.sh"
  "org-id-source|verify-org-id-source.sh"
  "permission-scope|verify-permission-scope.sh"
  "rate-limiting|verify-rate-limiting.sh"
  "input-validation|verify-input-validation.sh"
)

echo "Updating guard baselines..."
echo ""

FIRST=true
echo "{" > "$BASELINE_FILE"

for entry in "${GUARDS[@]}"; do
  IFS='|' read -r guard_id script <<< "$entry"

  # Run guard and extract violation count from summary line
  output=$(bash "$SCRIPT_DIR/$script" 2>/dev/null || true)
  count=$(echo "$output" | grep -oP '\d+ violations found' | grep -oP '^\d+' || echo "0")

  if $FIRST; then
    FIRST=false
  else
    echo "," >> "$BASELINE_FILE"
  fi

  printf '  "%s": %s' "$guard_id" "$count" >> "$BASELINE_FILE"
  echo "  $guard_id: $count violations"
done

echo "" >> "$BASELINE_FILE"
echo "}" >> "$BASELINE_FILE"

echo ""
echo "Baselines written to $BASELINE_FILE"
