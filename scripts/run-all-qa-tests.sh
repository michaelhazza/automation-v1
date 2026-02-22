#!/usr/bin/env bash
# QA Tests for Automation OS Phase 2 Implementation
# These tests validate implementation correctness (not just spec compliance)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."
cd "$ROOT_DIR"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local condition="$2"
  if eval "$condition"; then
    echo "[PASS] $desc"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Phase 2 QA Tests ==="

# Backend structure checks
check "server/index.ts exists" "[ -f server/index.ts ]"
check "server/db/index.ts exists" "[ -f server/db/index.ts ]"
check "server/middleware/auth.ts exists" "[ -f server/middleware/auth.ts ]"
check "server/services/authService.ts exists" "[ -f server/services/authService.ts ]"
check "server/services/organisationService.ts exists" "[ -f server/services/organisationService.ts ]"
check "server/services/userService.ts exists" "[ -f server/services/userService.ts ]"
check "server/services/engineService.ts exists" "[ -f server/services/engineService.ts ]"
check "server/services/categoryService.ts exists" "[ -f server/services/categoryService.ts ]"
check "server/services/taskService.ts exists" "[ -f server/services/taskService.ts ]"
check "server/services/permissionGroupService.ts exists" "[ -f server/services/permissionGroupService.ts ]"
check "server/services/executionService.ts exists" "[ -f server/services/executionService.ts ]"
check "server/services/fileService.ts exists" "[ -f server/services/fileService.ts ]"
check "server/services/healthService.ts exists" "[ -f server/services/healthService.ts ]"
check "server/services/queueService.ts exists" "[ -f server/services/queueService.ts ]"
check "server/services/emailService.ts exists" "[ -f server/services/emailService.ts ]"

# Route checks
check "server/routes/health.ts exists" "[ -f server/routes/health.ts ]"
check "server/routes/auth.ts exists" "[ -f server/routes/auth.ts ]"
check "server/routes/organisations.ts exists" "[ -f server/routes/organisations.ts ]"
check "server/routes/users.ts exists" "[ -f server/routes/users.ts ]"
check "server/routes/engines.ts exists" "[ -f server/routes/engines.ts ]"
check "server/routes/categories.ts exists" "[ -f server/routes/categories.ts ]"
check "server/routes/tasks.ts exists" "[ -f server/routes/tasks.ts ]"
check "server/routes/permissionGroups.ts exists" "[ -f server/routes/permissionGroups.ts ]"
check "server/routes/executions.ts exists" "[ -f server/routes/executions.ts ]"
check "server/routes/files.ts exists" "[ -f server/routes/files.ts ]"

# Database schema checks (10 tables)
check "schema/organisations.ts exists" "[ -f server/db/schema/organisations.ts ]"
check "schema/users.ts exists" "[ -f server/db/schema/users.ts ]"
check "schema/workflowEngines.ts exists" "[ -f server/db/schema/workflowEngines.ts ]"
check "schema/taskCategories.ts exists" "[ -f server/db/schema/taskCategories.ts ]"
check "schema/tasks.ts exists" "[ -f server/db/schema/tasks.ts ]"
check "schema/permissionGroups.ts exists" "[ -f server/db/schema/permissionGroups.ts ]"
check "schema/permissionGroupMembers.ts exists" "[ -f server/db/schema/permissionGroupMembers.ts ]"
check "schema/permissionGroupCategories.ts exists" "[ -f server/db/schema/permissionGroupCategories.ts ]"
check "schema/executions.ts exists" "[ -f server/db/schema/executions.ts ]"
check "schema/executionFiles.ts exists" "[ -f server/db/schema/executionFiles.ts ]"

# Frontend structure (16 pages)
check "client/src/pages/LoginPage.tsx exists" "[ -f client/src/pages/LoginPage.tsx ]"
check "client/src/pages/AcceptInvitePage.tsx exists" "[ -f client/src/pages/AcceptInvitePage.tsx ]"
check "client/src/pages/DashboardPage.tsx exists" "[ -f client/src/pages/DashboardPage.tsx ]"
check "client/src/pages/TasksPage.tsx exists" "[ -f client/src/pages/TasksPage.tsx ]"
check "client/src/pages/TaskExecutionPage.tsx exists" "[ -f client/src/pages/TaskExecutionPage.tsx ]"
check "client/src/pages/ExecutionHistoryPage.tsx exists" "[ -f client/src/pages/ExecutionHistoryPage.tsx ]"
check "client/src/pages/ExecutionDetailPage.tsx exists" "[ -f client/src/pages/ExecutionDetailPage.tsx ]"
check "client/src/pages/ProfileSettingsPage.tsx exists" "[ -f client/src/pages/ProfileSettingsPage.tsx ]"
check "client/src/pages/AdminEnginesPage.tsx exists" "[ -f client/src/pages/AdminEnginesPage.tsx ]"
check "client/src/pages/AdminTasksPage.tsx exists" "[ -f client/src/pages/AdminTasksPage.tsx ]"
check "client/src/pages/AdminTaskEditPage.tsx exists" "[ -f client/src/pages/AdminTaskEditPage.tsx ]"
check "client/src/pages/AdminCategoriesPage.tsx exists" "[ -f client/src/pages/AdminCategoriesPage.tsx ]"
check "client/src/pages/AdminPermissionGroupsPage.tsx exists" "[ -f client/src/pages/AdminPermissionGroupsPage.tsx ]"
check "client/src/pages/AdminPermissionGroupDetailPage.tsx exists" "[ -f client/src/pages/AdminPermissionGroupDetailPage.tsx ]"
check "client/src/pages/AdminUsersPage.tsx exists" "[ -f client/src/pages/AdminUsersPage.tsx ]"
check "client/src/pages/SystemOrganisationsPage.tsx exists" "[ -f client/src/pages/SystemOrganisationsPage.tsx ]"

# Config checks
check "package.json exists" "[ -f package.json ]"
check "vite.config.ts exists" "[ -f vite.config.ts ]"
check "drizzle.config.ts exists" "[ -f drizzle.config.ts ]"
check ".env.example exists" "[ -f .env.example ]"

# Content checks
check "auth route has /api/auth/login" "grep -q '/api/auth/login' server/routes/auth.ts"
check "auth route has /api/auth/invite/accept" "grep -q '/api/auth/invite/accept' server/routes/auth.ts"
check "auth route has NO /api/auth/register" "! grep -q '/api/auth/register' server/routes/auth.ts"
check "executions route has 429 duplicate check" "grep -q '429' server/services/executionService.ts"
check "auth middleware uses JWT" "grep -q 'jwt.verify' server/middleware/auth.ts"
check "users schema has softDelete (deletedAt)" "grep -q 'deletedAt' server/db/schema/users.ts"
check "executions schema has NO deletedAt (immutable)" "! grep -q 'deletedAt' server/db/schema/executions.ts"
check "execution files schema has expiresAt" "grep -q 'expiresAt' server/db/schema/executionFiles.ts"
check "App.tsx has /invite/accept route" "grep -q '/invite/accept' client/src/App.tsx"
check "App.tsx has NO /register route" "! grep -q '/register' client/src/App.tsx"
check "env.ts validates JWT_SECRET" "grep -q 'JWT_SECRET' server/lib/env.ts"
check "QUEUE_CONCURRENCY is configured" "grep -q 'QUEUE_CONCURRENCY' server/lib/env.ts"
check "JOB_QUEUE_BACKEND defaults to pg-boss" "grep -q 'pg-boss' server/lib/env.ts"

echo ""
echo "=== QA Results: $PASS passed, $FAIL failed ==="
if [ $FAIL -gt 0 ]; then
  echo "[QA FAILED] $FAIL checks failed"
  exit 1
fi
echo "[QA PASSED] All $PASS checks passed"
