#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="org-scoped-writes"
GUARD_NAME="Org-Scoped Writes"

source "$SCRIPT_DIR/lib/guard-utils.sh"

VIOLATIONS=0
FILES_SCANNED=0

# Known org-scoped tables (have organisationId FK)
ORG_SCOPED_TABLES=(
  "agents"
  "skills"
  "processes"
  "processCategories"
  "tasks"
  "subaccounts"
  "agentTriggers"
  "workflowEngines"
  "projects"
  "pageProjects"
  "integrationConnections"
  "boardConfigs"
  "permissionSets"
)

emit_header "$GUARD_NAME"

# Find update/delete with single eq(*.id, *) — no and()
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  # Skip if already using and()
  echo "$content" | grep -q 'and(' && continue

  # Skip comment lines
  echo "$content" | grep -qE '^\s*//' && continue

  # Check if this involves an org-scoped table
  matched_table=""
  for table in "${ORG_SCOPED_TABLES[@]}"; do
    if echo "$content" | grep -q "${table}\.id"; then
      matched_table="$table"
      break
    fi
  done

  if [ -n "$matched_table" ]; then
    is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

    emit_violation "$GUARD_ID" "error" "$file" "$lineno" \
      "$content" \
      ".where(and(eq(${matched_table}.id, id), eq(${matched_table}.organisationId, organisationId)))"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn '\.where(eq(' "$ROOT_DIR/server/services/" --include='*.ts' 2>/dev/null | grep '\.id,' | grep -v 'and(' || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/services/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
