#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="org-id-source"
GUARD_NAME="Org ID Source"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

emit_header "$GUARD_NAME"

while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  # Skip comment lines
  echo "$content" | grep -qE '^\s*//' && continue

  # Skip fallback patterns: req.orgId ?? req.user!.organisationId (system admin cross-org)
  echo "$content" | grep -qE 'req\.orgId\s*\?\?' && continue

  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  emit_violation "$GUARD_ID" "warning" "$file" "$lineno" \
    "$content" \
    "Replace req.user!.organisationId with req.orgId (set by authenticate middleware, handles system admin org switching)"
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rn 'req\.user.\?\.organisationId' "$ROOT_DIR/server/routes/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/routes/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 2)
exit "$exit_code"
