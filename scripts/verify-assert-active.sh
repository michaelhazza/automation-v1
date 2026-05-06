#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-assert-active.sh  (Phase 3 — B.1)
#
# Invariant: any file in server/services/**/*.ts or server/routes/**/*.ts that
# fetches rows from a soft-deletable table via db.query.<table>.findFirst or
# db.query.<table>.findMany MUST also reference assertActive( or isActive( in
# the same file, OR carry the escape-hatch comment:
#   // active-check-not-required: <reason>
#
# Soft-deletable tables checked (derived by running
# `git grep "deletedAt" server/db/schema/` at plan time 2026-05-06;
# update this list when adding new soft-deletable schema tables):
#   subaccounts, agents, skills, workflowTemplates, agentTriggers,
#   organisations, tasks, memoryBlocks, documentBundles, goals, projects,
#   permissionSets, subscriptions, users, teams, automations, reports,
#   hierarchyTemplates, modules, systemAgents
#
# Whole-file carve-outs: tasks/builds/pre-launch-phase-3-deferred-backlog/audit/assert-active-allowlist.txt
#
# Known-bad fixture: scripts/fixtures/verify-assert-active-bad.txt
#   — contains `db.query.subaccounts.findFirst` with no assertActive call
#
# Exit codes: 0 = clean, 1 = first violation found
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ALLOWLIST_FILE="$ROOT_DIR/tasks/builds/pre-launch-phase-3-deferred-backlog/audit/assert-active-allowlist.txt"

# Soft-deletable table names as used in drizzle query calls (db.query.<name>)
SOFT_DELETABLE_TABLES=(
  subaccounts
  agents
  skills
  workflowTemplates
  agentTriggers
  organisations
  tasks
  memoryBlocks
  documentBundles
  goals
  projects
  permissionSets
  subscriptions
  users
  teams
  automations
  reports
  hierarchyTemplates
  ieeRuns
  modules
  systemAgents
  agentBeliefs
  agentTestFixtures
  automationCategories
  automationEngines
  clientPulseCanonicalTables
  connectorLocationTokens
  documentBundleAttachments
  documentBundleMembers
  featureRequests
  memoryBlockAttachments
  pageProjects
  referenceDocuments
  subaccountCategories
  systemHierarchyTemplates
  taskAttachments
  taskDeliverables
  workspaceEntities
  workspaceMemories
)

# Build grep alternation pattern for table names
TABLE_PATTERN=$(printf "%s|" "${SOFT_DELETABLE_TABLES[@]}")
TABLE_PATTERN="${TABLE_PATTERN%|}"

# Load allowlist into array (ignore blank lines and comments)
ALLOWLIST=()
if [ -f "$ALLOWLIST_FILE" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^# ]] && continue
    ALLOWLIST+=("$line")
  done < "$ALLOWLIST_FILE"
fi

is_allowlisted() {
  local file="$1"
  local rel="${file#$ROOT_DIR/}"
  for entry in "${ALLOWLIST[@]}"; do
    [[ "$rel" == "$entry" ]] && return 0
  done
  return 1
}

# Scan server/services and server/routes
SEARCH_DIRS=("$ROOT_DIR/server/services" "$ROOT_DIR/server/routes")

for dir in "${SEARCH_DIRS[@]}"; do
  [ -d "$dir" ] || continue

  while IFS= read -r -d '' file; do
    # Skip test files
    [[ "$file" == *"/__tests__/"* ]] && continue
    [[ "$file" == *".test.ts" ]] && continue
    [[ "$file" == *".integration.test.ts" ]] && continue
    [[ "$file" == *".unit.ts" ]] && continue

    # Skip allowlisted files
    is_allowlisted "$file" && continue

    # Skip files with escape-hatch comment
    if grep -q "// active-check-not-required:" "$file" 2>/dev/null; then
      continue
    fi

    # Check if file queries any soft-deletable table via drizzle query API
    if ! grep -qE "db\.query\.($TABLE_PATTERN)\.(findFirst|findMany)" "$file" 2>/dev/null; then
      continue
    fi

    # File queries a soft-deletable table — ensure assertActive or isActive is referenced
    if ! grep -qE "assertActive\(|isActive\(" "$file" 2>/dev/null; then
      rel_path="${file#$ROOT_DIR/}"
      match_line=$(grep -nE "db\.query\.($TABLE_PATTERN)\.(findFirst|findMany)" "$file" | head -1)
      lineno=$(echo "$match_line" | cut -d: -f1)
      echo "verify-assert-active.sh: db.query on soft-deletable table with no assertActive/isActive guard at ${rel_path}:${lineno}"
      exit 1
    fi
  done < <(find "$dir" -name "*.ts" -print0 2>/dev/null)
done

exit 0
