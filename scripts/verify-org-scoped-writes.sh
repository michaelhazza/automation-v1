#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GUARD_NAME="Org-Scoped Writes"
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

# Non-org-scoped tables (safe to update by id only)
SAFE_TABLES=(
  "budgetReservations"
  "llmRequests"
  "llmUsage"
  "users"
  "organisations"
  "agentRuns"
  "agentRunSteps"
  "dataSources"
  "dataSourceChunks"
  "formSubmissions"
  "portalSessions"
)

is_org_scoped() {
  local table="$1"
  for t in "${ORG_SCOPED_TABLES[@]}"; do
    [[ "$table" == "$t" ]] && return 0
  done
  return 1
}

echo "[GUARD] $GUARD_NAME"

# Find update/delete with single eq(*.id, *) — no and()
# Pattern: .where(eq( without and( on the same line, referencing .id
while IFS= read -r line; do
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  # Skip if already using and()
  echo "$content" | grep -q 'and(' && continue

  # Skip comment lines
  echo "$content" | grep -qE '^\s*//' && continue

  # Check if this involves an org-scoped table
  is_violation=false
  for table in "${ORG_SCOPED_TABLES[@]}"; do
    if echo "$content" | grep -q "${table}\.id"; then
      is_violation=true
      break
    fi
  done

  if $is_violation; then
    echo "❌ $file:$lineno"
    echo "  $content"
    echo "  → Add organisationId to WHERE clause: .where(and(eq(table.id, id), eq(table.organisationId, organisationId)))"
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(grep -rn '\.where(eq(' "$ROOT_DIR/server/services/" --include='*.ts' 2>/dev/null | grep '\.id,' | grep -v 'and(' || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/services/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

echo ""
echo "Summary: $FILES_SCANNED files scanned, $VIOLATIONS violations found"

if [ $VIOLATIONS -gt 0 ]; then
  exit 1  # Tier 1: hard fail
fi

exit 0
