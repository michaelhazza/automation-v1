#!/usr/bin/env bash
set -euo pipefail

# verify-rls-contract-compliance.sh
#
# Sprint 2 P1.1 Layer 1 gate. Enforces the "no raw db outside services"
# contract that makes RLS effective. Specifically:
#
#   1. No file outside server/services/** and the short allow-list may
#      import `db` from '../db/index.js' / './db/index.js' / '@/db' etc.
#      Services are the only layer allowed to issue queries, because
#      services run inside the ALS-managed org-scoped transaction opened
#      in `authenticate` (Layer 1) and inherit `app.organisation_id`.
#
#   2. Route handlers and middleware may NOT call drizzle's `.execute()`
#      or `.transaction()` — those must come from services.
#
# Allow-list exists for a small number of bootstrap / admin / MCP paths
# that operate outside the HTTP request lifecycle and use
# `withAdminConnection` explicitly.
#
# This gate is the enforcement mechanism behind the Layer 1 fail-closed
# guarantee: if a route ever issues a query outside a service, it will
# run without the ALS context and be blocked by RLS — but we want to
# catch that at CI time, not at runtime.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GUARD_ID="rls-contract-compliance"
GUARD_NAME="RLS Contract Compliance (no raw db outside services)"

source "$SCRIPT_DIR/lib/guard-utils.sh"

emit_header "$GUARD_NAME"

# Allow-list: paths that may import `db` directly because they either
# operate outside the request lifecycle (migrations, scripts, pg-boss
# workers that open their own tx via createWorker), are the db module
# itself, or are authorised admin-bypass helpers.
ALLOWLIST_DIRS=(
  "server/services/"
  "server/db/"
  "server/lib/adminDbConnection.ts"
  "server/lib/orgScopedDb.ts"
  "server/lib/createWorker.ts"
  "server/lib/reportingAgentRunHook.ts"
  "server/lib/resolveSubaccount.ts"
  "server/lib/runCostBreaker.ts"
  "server/middleware/auth.ts"
  "server/middleware/subdomainResolution.ts"
  "server/instrumentation.ts"
  "server/index.ts"
  "server/tools/"
  "server/processors/"
  "server/websocket/"
  "server/jobs/"
  "migrations/"
  "scripts/"
)

# Whitelist: files with documented exemptions. Each must carry a
# guard-ignore-next-line comment explaining why.
WHITELIST=(
  "server/routes/mcp.ts"
  "server/routes/webhooks/ghlWebhook.ts"
  "server/routes/githubWebhook.ts"
  "server/routes/webhooks.ts"
  "server/routes/subaccounts.ts"
  "server/routes/processes.ts"
  "server/routes/agentPromptRevisions.ts"
  "server/routes/processConnectionMappings.ts"
  "server/routes/permissionSets.ts"
  "server/routes/agentRuns.ts"
  "server/routes/webhookAdapter.ts"
  "server/routes/integrationConnections.ts"
  "server/routes/agentTriggers.ts"
  "server/routes/systemProcesses.ts"
  "server/routes/subaccountEngines.ts"
  "server/routes/systemExecutions.ts"
  "server/routes/systemUsers.ts"
  "server/routes/githubApp.ts"
  "server/routes/portal.ts"
  "server/routes/systemEngines.ts"
  "server/routes/projects.ts"
  "server/routes/llmUsage.ts"
)

is_allowlisted_path() {
  local rel="$1"
  for prefix in "${ALLOWLIST_DIRS[@]}"; do
    [[ "$rel" == "$prefix"* ]] && return 0
  done
  return 1
}

is_whitelisted() {
  local rel="$1"
  for w in "${WHITELIST[@]}"; do
    [[ "$rel" == "$w" ]] && return 0
  done
  return 1
}

VIOLATIONS=0

# ── Rule 1: no raw db import outside allow-list ────────────────────────────
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  rel="${file#$ROOT_DIR/}"

  # Skip the db module itself and allow-list entries.
  is_allowlisted_path "$rel" && continue
  is_whitelisted "$rel" && continue
  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  emit_violation "$GUARD_ID" "error" "$rel" "$lineno" \
    "Direct \`db\` import outside services. RLS fail-closes on queries issued without the ALS tx." \
    "Move the query into a server/services/** function or, for admin-bypass paths, wrap it in withAdminConnection()."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE "from ['\"]([^'\"]*\/)?db(\/index(\.js)?)?['\"]" "$ROOT_DIR/server/" --include='*.ts' 2>/dev/null | grep -E "\\bdb\\b" || true)

# ── Rule 2: no .transaction() calls in routes or middleware ─────────────────
# Routes and middleware must not open transactions directly. The
# authenticate middleware owns the request-level tx; any nested tx must
# be opened inside a service.
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file=$(echo "$line" | cut -d: -f1)
  lineno=$(echo "$line" | cut -d: -f2)
  content=$(echo "$line" | cut -d: -f3-)

  rel="${file#$ROOT_DIR/}"

  # The middleware/auth.ts file is explicitly allowed — it opens the
  # request-level transaction. Nothing else in middleware or routes may.
  [[ "$rel" == "server/middleware/auth.ts" ]] && continue
  is_whitelisted "$rel" && continue
  is_suppressed "$file" "$lineno" "$GUARD_ID" && continue

  emit_violation "$GUARD_ID" "error" "$rel" "$lineno" \
    "Route/middleware calls db.transaction() directly. Nested tx must live in services." \
    "Move the transaction into a service, or use the ALS-managed request tx via getOrgScopedDb()."
  VIOLATIONS=$((VIOLATIONS + 1))
done < <(grep -rnE "db\.transaction\s*\(" "$ROOT_DIR/server/routes/" "$ROOT_DIR/server/middleware/" --include='*.ts' 2>/dev/null || true)

FILES_SCANNED=$(find "$ROOT_DIR/server/" -name '*.ts' -not -path '*/node_modules/*' | wc -l)

emit_summary "$FILES_SCANNED" "$VIOLATIONS"

exit_code=$(check_baseline "$GUARD_ID" "$VIOLATIONS" 1)
exit "$exit_code"
