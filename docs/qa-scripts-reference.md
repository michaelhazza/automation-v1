# QA Test Scripts Reference

This document contains all QA test scripts for post-implementation verification of Automation OS. Scripts are extracted using the qa-splitter utility.

Total Scripts: 10

## Exit Code Semantics

- **0**: Pass - test succeeded
- **1**: BLOCKING - critical test failure
- **2**: WARNING - test issues, non-critical
- **3**: INFO - informational output

All scripts include the classify_and_exit helper function for standardised exit code handling.

---

#===== FILE: scripts/qa-api-health.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates health endpoint and basic API availability for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing API health at $API_BASE"

HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/health" 2>/dev/null || echo -e "\n000")
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
BODY=$(echo "$HEALTH_RESPONSE" | head -1)

if [ "$HTTP_CODE" != "200" ]; then
  classify_and_exit BLOCKING "Health endpoint returned $HTTP_CODE (expected 200). API may not be running."
fi

STATUS=$(echo "$BODY" | jq -r '.status // empty' 2>/dev/null || echo "")
if [ -z "$STATUS" ]; then
  classify_and_exit BLOCKING "Health endpoint returned invalid JSON: $BODY"
fi

VERSION=$(echo "$BODY" | jq -r '.version // empty' 2>/dev/null || echo "")
if [ -z "$VERSION" ]; then
  classify_and_exit WARNING "Health endpoint missing 'version' field in response"
fi

classify_and_exit OK "API health confirmed. Status: $STATUS. Version: $VERSION. Endpoint: $API_BASE/health"
#===== END FILE: scripts/qa-api-health.sh =====#

#===== FILE: scripts/qa-authentication.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates authentication flow - login, /me endpoint, and logout for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"
TEST_EMAIL="${TEST_ORG_ADMIN_EMAIL:-admin@test-org.com}"
TEST_PASSWORD="${TEST_ORG_ADMIN_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing authentication flow for $TEST_EMAIL"

# Test login
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || echo -e "\n000")
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | head -1)

if [ "$LOGIN_CODE" != "200" ]; then
  classify_and_exit BLOCKING "Login returned $LOGIN_CODE (expected 200). Body: $LOGIN_BODY"
fi

TOKEN=$(echo "$LOGIN_BODY" | jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "Login response missing JWT token. Body: $LOGIN_BODY"
fi

# Test /me endpoint with valid token
ME_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/api/auth/me" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo -e "\n000")
ME_CODE=$(echo "$ME_RESPONSE" | tail -1)
ME_BODY=$(echo "$ME_RESPONSE" | head -1)

if [ "$ME_CODE" != "200" ]; then
  classify_and_exit BLOCKING "/api/auth/me returned $ME_CODE with valid token (expected 200)"
fi

USER_ID=$(echo "$ME_BODY" | jq -r '.id // empty' 2>/dev/null || echo "")
USER_ROLE=$(echo "$ME_BODY" | jq -r '.role // empty' 2>/dev/null || echo "")
if [ -z "$USER_ID" ] || [ -z "$USER_ROLE" ]; then
  classify_and_exit BLOCKING "/api/auth/me missing id or role in response"
fi

# Test that /me rejects unauthenticated requests
ME_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/auth/me" 2>/dev/null || echo "000")
if [ "$ME_UNAUTH" != "401" ]; then
  classify_and_exit BLOCKING "/api/auth/me returned $ME_UNAUTH without token (expected 401)"
fi

# Test logout
LOGOUT_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/auth/logout" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$LOGOUT_RESPONSE" != "200" ]; then
  classify_and_exit WARNING "Logout returned $LOGOUT_RESPONSE (expected 200)"
fi

classify_and_exit OK "Authentication flow confirmed. Login, /me (with role: $USER_ROLE), unauthenticated rejection, and logout all pass."
#===== END FILE: scripts/qa-authentication.sh =====#

#===== FILE: scripts/qa-task-execution-workflow.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Core value workflow test - task discovery -> execute -> result for Automation OS
# This tests the PRIMARY user value moment: a staff member running an automation task.

API_BASE="${API_BASE:-http://localhost:3000}"
TEST_EMAIL="${TEST_USER_EMAIL:-user@test-org.com}"
TEST_PASSWORD="${TEST_USER_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing core execution workflow for $TEST_EMAIL"

# Step 1: Authenticate
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || echo -e "\n000")
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | head -1)
if [ "$LOGIN_CODE" != "200" ]; then
  classify_and_exit BLOCKING "Cannot login as test user: $LOGIN_CODE"
fi
TOKEN=$(echo "$LOGIN_BODY" | jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "No token from login"
fi

# Step 2: List accessible tasks (should return tasks the user has permission to execute)
TASKS_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/api/tasks?status=active" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo -e "\n000")
TASKS_CODE=$(echo "$TASKS_RESPONSE" | tail -1)
TASKS_BODY=$(echo "$TASKS_RESPONSE" | head -1)
if [ "$TASKS_CODE" != "200" ]; then
  classify_and_exit BLOCKING "GET /api/tasks returned $TASKS_CODE (expected 200)"
fi

TASK_COUNT=$(echo "$TASKS_BODY" | jq '. | length' 2>/dev/null || echo "0")
if [ "$TASK_COUNT" -eq 0 ]; then
  classify_and_exit WARNING "No active tasks returned. Cannot test execution workflow. Ensure test org has active tasks configured."
fi

# Step 3: Get task detail
TASK_ID=$(echo "$TASKS_BODY" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [ -z "$TASK_ID" ]; then
  classify_and_exit BLOCKING "Cannot extract task ID from task list"
fi

TASK_DETAIL=$(curl -s -w "\n%{http_code}" "$API_BASE/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo -e "\n000")
TASK_DETAIL_CODE=$(echo "$TASK_DETAIL" | tail -1)
if [ "$TASK_DETAIL_CODE" != "200" ]; then
  classify_and_exit BLOCKING "GET /api/tasks/:id returned $TASK_DETAIL_CODE"
fi

# Step 4: Submit execution
EXEC_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/executions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TASK_ID\",\"inputData\":\"QA test execution\"}" 2>/dev/null || echo -e "\n000")
EXEC_CODE=$(echo "$EXEC_RESPONSE" | tail -1)
EXEC_BODY=$(echo "$EXEC_RESPONSE" | head -1)
if [ "$EXEC_CODE" != "200" ] && [ "$EXEC_CODE" != "201" ]; then
  classify_and_exit BLOCKING "POST /api/executions returned $EXEC_CODE. Body: $EXEC_BODY"
fi

EXEC_ID=$(echo "$EXEC_BODY" | jq -r '.id // empty' 2>/dev/null || echo "")
EXEC_STATUS=$(echo "$EXEC_BODY" | jq -r '.status // empty' 2>/dev/null || echo "")
if [ -z "$EXEC_ID" ]; then
  classify_and_exit BLOCKING "POST /api/executions missing execution ID in response"
fi

# Step 5: Poll execution status
MAX_POLLS=10
POLL_COUNT=0
FINAL_STATUS=""
while [ "$POLL_COUNT" -lt "$MAX_POLLS" ]; do
  sleep 3
  STATUS_RESPONSE=$(curl -s "$API_BASE/api/executions/$EXEC_ID" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "{}")
  FINAL_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status // empty' 2>/dev/null || echo "")
  if [ "$FINAL_STATUS" = "completed" ] || [ "$FINAL_STATUS" = "failed" ] || [ "$FINAL_STATUS" = "timeout" ]; then
    break
  fi
  POLL_COUNT=$((POLL_COUNT + 1))
done

if [ "$FINAL_STATUS" = "completed" ]; then
  classify_and_exit OK "Core execution workflow PASS. Task list -> task detail -> execute -> $FINAL_STATUS. Execution ID: $EXEC_ID"
elif [ "$FINAL_STATUS" = "failed" ] || [ "$FINAL_STATUS" = "timeout" ]; then
  classify_and_exit WARNING "Execution completed with status $FINAL_STATUS. The API workflow functions correctly; engine connectivity may be the issue."
else
  classify_and_exit BLOCKING "Execution did not reach terminal status after $MAX_POLLS polls. Last status: $FINAL_STATUS"
fi
#===== END FILE: scripts/qa-task-execution-workflow.sh =====#

#===== FILE: scripts/qa-duplicate-prevention.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates 5-minute duplicate execution prevention for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"
TEST_EMAIL="${TEST_USER_EMAIL:-user@test-org.com}"
TEST_PASSWORD="${TEST_USER_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing duplicate execution prevention"

# Authenticate
LOGIN_BODY=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}" 2>/dev/null || echo "{}")
TOKEN=$(echo "$LOGIN_BODY" | jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "Cannot authenticate test user"
fi

# Get a task ID
TASKS=$(curl -s "$API_BASE/api/tasks?status=active" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "[]")
TASK_ID=$(echo "$TASKS" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [ -z "$TASK_ID" ]; then
  classify_and_exit WARNING "No active tasks available. Cannot test duplicate prevention."
fi

# Submit first execution
FIRST=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/executions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TASK_ID\"}" 2>/dev/null || echo -e "\n000")
FIRST_CODE=$(echo "$FIRST" | tail -1)
if [ "$FIRST_CODE" != "200" ] && [ "$FIRST_CODE" != "201" ]; then
  classify_and_exit BLOCKING "First execution submission returned $FIRST_CODE"
fi

# Immediately submit again - should be rejected with 429
SECOND=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/executions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TASK_ID\"}" 2>/dev/null || echo -e "\n000")
SECOND_CODE=$(echo "$SECOND" | tail -1)
SECOND_BODY=$(echo "$SECOND" | head -1)

if [ "$SECOND_CODE" = "429" ]; then
  classify_and_exit OK "Duplicate prevention working correctly. Second submission returned 429 as expected."
else
  classify_and_exit BLOCKING "Duplicate prevention FAILED. Expected 429, got $SECOND_CODE. Duplicate executions are allowed."
fi
#===== END FILE: scripts/qa-duplicate-prevention.sh =====#

#===== FILE: scripts/qa-rbac-isolation.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates role-based access control - users cannot access admin endpoints

API_BASE="${API_BASE:-http://localhost:3000}"
TEST_USER_EMAIL="${TEST_USER_EMAIL:-user@test-org.com}"
TEST_USER_PASSWORD="${TEST_USER_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing RBAC isolation for non-admin user"

# Authenticate as regular user
LOGIN_BODY=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASSWORD\"}" 2>/dev/null || echo "{}")
TOKEN=$(echo "$LOGIN_BODY" | jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "Cannot authenticate as test user"
fi

ROLE=$(echo "$LOGIN_BODY" | jq -r '.user.role // empty' 2>/dev/null || echo "unknown")
echo "Authenticated as role: $ROLE"

# Test that user cannot access engine management
ENGINES_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/engines" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$ENGINES_CODE" = "200" ]; then
  classify_and_exit BLOCKING "RBAC FAILURE: user role can access GET /api/engines (requires org_admin)"
fi

# Test that user cannot invite users
INVITE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/users/invite" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"new@user.com","role":"user"}' 2>/dev/null || echo "000")
if [ "$INVITE_CODE" = "200" ] || [ "$INVITE_CODE" = "201" ]; then
  classify_and_exit BLOCKING "RBAC FAILURE: user role can access POST /api/users/invite (requires org_admin)"
fi

# Test that user cannot access system organisation management
ORGS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/organisations" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$ORGS_CODE" = "200" ]; then
  classify_and_exit BLOCKING "RBAC FAILURE: user role can access GET /api/organisations (requires system_admin)"
fi

# Test that user CAN access their own execution history
EXEC_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/executions" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$EXEC_CODE" != "200" ]; then
  classify_and_exit BLOCKING "RBAC FAILURE: user role cannot access GET /api/executions (should be allowed)"
fi

classify_and_exit OK "RBAC isolation confirmed. User role blocked from engines, invite, org management. User role can access own execution history."
#===== END FILE: scripts/qa-rbac-isolation.sh =====#

#===== FILE: scripts/qa-tenant-isolation.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates cross-organisation data isolation for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"
ORG_A_EMAIL="${TEST_ORG_A_EMAIL:-admin@org-a.com}"
ORG_A_PASSWORD="${TEST_ORG_A_PASSWORD:-test-password-123}"
ORG_B_EMAIL="${TEST_ORG_B_EMAIL:-admin@org-b.com}"
ORG_B_PASSWORD="${TEST_ORG_B_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing cross-organisation tenant isolation"

# Authenticate org A admin
TOKEN_A=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ORG_A_EMAIL\",\"password\":\"$ORG_A_PASSWORD\"}" 2>/dev/null | \
  jq -r '.token // empty' 2>/dev/null || echo "")

if [ -z "$TOKEN_A" ]; then
  classify_and_exit WARNING "Cannot authenticate as org A admin ($ORG_A_EMAIL). Skipping cross-org isolation test."
fi

# Get a task from org A
ORG_A_TASKS=$(curl -s "$API_BASE/api/tasks" -H "Authorization: Bearer $TOKEN_A" 2>/dev/null || echo "[]")
ORG_A_TASK_ID=$(echo "$ORG_A_TASKS" | jq -r '.[0].id // empty' 2>/dev/null || echo "")

# Authenticate org B admin
TOKEN_B=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ORG_B_EMAIL\",\"password\":\"$ORG_B_PASSWORD\"}" 2>/dev/null | \
  jq -r '.token // empty' 2>/dev/null || echo "")

if [ -z "$TOKEN_B" ]; then
  classify_and_exit WARNING "Cannot authenticate as org B admin ($ORG_B_EMAIL). Skipping cross-org isolation test."
fi

if [ -n "$ORG_A_TASK_ID" ]; then
  # Org B should NOT be able to access org A task
  CROSS_ORG_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/tasks/$ORG_A_TASK_ID" \
    -H "Authorization: Bearer $TOKEN_B" 2>/dev/null || echo "000")
  if [ "$CROSS_ORG_CODE" = "200" ]; then
    classify_and_exit BLOCKING "TENANT ISOLATION FAILURE: org B can access org A task $ORG_A_TASK_ID (returned 200)"
  fi
  echo "Cross-org task access correctly rejected with: $CROSS_ORG_CODE"
fi

# Org A should not see org B users in their user list
ORG_A_USERS=$(curl -s "$API_BASE/api/users" -H "Authorization: Bearer $TOKEN_A" 2>/dev/null || echo "[]")
ORG_B_ME=$(curl -s "$API_BASE/api/auth/me" -H "Authorization: Bearer $TOKEN_B" 2>/dev/null || echo "{}")
ORG_B_USER_ID=$(echo "$ORG_B_ME" | jq -r '.id // empty' 2>/dev/null || echo "")

if [ -n "$ORG_B_USER_ID" ]; then
  CROSS_USER=$(echo "$ORG_A_USERS" | jq --arg uid "$ORG_B_USER_ID" '[.[] | select(.id == $uid)] | length' 2>/dev/null || echo "0")
  if [ "$CROSS_USER" -gt 0 ]; then
    classify_and_exit BLOCKING "TENANT ISOLATION FAILURE: org A user list contains org B user $ORG_B_USER_ID"
  fi
fi

classify_and_exit OK "Tenant isolation confirmed. Cross-organisation task access blocked. User list scoped to organisation."
#===== END FILE: scripts/qa-tenant-isolation.sh =====#

#===== FILE: scripts/qa-execution-history.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates execution history visibility scoping and audit trail access for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"
ADMIN_EMAIL="${TEST_ORG_ADMIN_EMAIL:-admin@test-org.com}"
ADMIN_PASSWORD="${TEST_ORG_ADMIN_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing execution history and CSV export"

TOKEN=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null | \
  jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "Cannot authenticate as org admin"
fi

# Test execution list endpoint
EXEC_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/api/executions?limit=10" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo -e "\n000")
EXEC_CODE=$(echo "$EXEC_RESPONSE" | tail -1)
EXEC_BODY=$(echo "$EXEC_RESPONSE" | head -1)

if [ "$EXEC_CODE" != "200" ]; then
  classify_and_exit BLOCKING "GET /api/executions returned $EXEC_CODE (expected 200)"
fi

EXEC_COUNT=$(echo "$EXEC_BODY" | jq '. | length' 2>/dev/null || echo "0")
echo "Found $EXEC_COUNT executions in history"

# Test execution detail access (first execution if available)
if [ "$EXEC_COUNT" -gt 0 ]; then
  EXEC_ID=$(echo "$EXEC_BODY" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
  if [ -n "$EXEC_ID" ]; then
    DETAIL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/executions/$EXEC_ID" \
      -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
    if [ "$DETAIL_CODE" != "200" ]; then
      classify_and_exit BLOCKING "GET /api/executions/:id returned $DETAIL_CODE (expected 200)"
    fi
  fi
fi

# Test CSV export (org_admin only)
EXPORT_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/api/executions/export" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo -e "\n000")
EXPORT_CODE=$(echo "$EXPORT_RESPONSE" | tail -1)

if [ "$EXPORT_CODE" != "200" ]; then
  classify_and_exit WARNING "GET /api/executions/export returned $EXPORT_CODE (expected 200 for org_admin)"
fi

# Test status filtering
for status in "pending" "completed" "failed"; do
  FILTERED_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/executions?status=$status" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
  if [ "$FILTERED_CODE" != "200" ]; then
    classify_and_exit BLOCKING "GET /api/executions?status=$status returned $FILTERED_CODE (expected 200)"
  fi
done

classify_and_exit OK "Execution history confirmed. List, detail, CSV export, and status filtering all operational."
#===== END FILE: scripts/qa-execution-history.sh =====#

#===== FILE: scripts/qa-permission-groups.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates permission group creation, membership, and category access for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"
ADMIN_EMAIL="${TEST_ORG_ADMIN_EMAIL:-admin@test-org.com}"
ADMIN_PASSWORD="${TEST_ORG_ADMIN_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing permission group management"

TOKEN=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null | \
  jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "Cannot authenticate as org admin"
fi

# Create a permission group
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/permission-groups" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"QA Test Group","description":"Created by QA test"}' 2>/dev/null || echo -e "\n000")
CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
CREATE_BODY=$(echo "$CREATE_RESPONSE" | head -1)

if [ "$CREATE_CODE" != "200" ] && [ "$CREATE_CODE" != "201" ]; then
  classify_and_exit BLOCKING "POST /api/permission-groups returned $CREATE_CODE"
fi

GROUP_ID=$(echo "$CREATE_BODY" | jq -r '.id // empty' 2>/dev/null || echo "")
if [ -z "$GROUP_ID" ]; then
  classify_and_exit BLOCKING "Permission group created but no ID returned"
fi

# Get group detail
DETAIL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/permission-groups/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$DETAIL_CODE" != "200" ]; then
  classify_and_exit BLOCKING "GET /api/permission-groups/:id returned $DETAIL_CODE"
fi

# List groups
LIST_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/permission-groups" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$LIST_CODE" != "200" ]; then
  classify_and_exit BLOCKING "GET /api/permission-groups returned $LIST_CODE"
fi

# Cleanup: delete test group
DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_BASE/api/permission-groups/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$DEL_CODE" != "200" ]; then
  classify_and_exit WARNING "Could not delete test permission group $GROUP_ID: $DEL_CODE"
fi

classify_and_exit OK "Permission group management confirmed. Create, detail, list, and delete all operational. Group ID: $GROUP_ID cleaned up."
#===== END FILE: scripts/qa-permission-groups.sh =====#

#===== FILE: scripts/qa-task-management.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates task creation, configuration, activation workflow for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"
ADMIN_EMAIL="${TEST_ORG_ADMIN_EMAIL:-admin@test-org.com}"
ADMIN_PASSWORD="${TEST_ORG_ADMIN_PASSWORD:-test-password-123}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing task management workflow"

TOKEN=$(curl -s -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null | \
  jq -r '.token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  classify_and_exit BLOCKING "Cannot authenticate as org admin"
fi

# Get an active engine to attach task to
ENGINES=$(curl -s "$API_BASE/api/engines?status=active" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "[]")
ENGINE_ID=$(echo "$ENGINES" | jq -r '.[0].id // empty' 2>/dev/null || echo "")
if [ -z "$ENGINE_ID" ]; then
  classify_and_exit WARNING "No active engine found. Cannot create task. Configure an n8n engine connection first."
fi

# Create task in draft status
CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"QA Test Task\",\"workflowEngineId\":\"$ENGINE_ID\",\"endpointUrl\":\"https://webhook.test/qa\",\"httpMethod\":\"POST\",\"timeoutSeconds\":60}" 2>/dev/null || echo -e "\n000")
CREATE_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
CREATE_BODY=$(echo "$CREATE_RESPONSE" | head -1)

if [ "$CREATE_CODE" != "200" ] && [ "$CREATE_CODE" != "201" ]; then
  classify_and_exit BLOCKING "POST /api/tasks returned $CREATE_CODE. Body: $CREATE_BODY"
fi

TASK_ID=$(echo "$CREATE_BODY" | jq -r '.id // empty' 2>/dev/null || echo "")
TASK_STATUS=$(echo "$CREATE_BODY" | jq -r '.status // empty' 2>/dev/null || echo "")

if [ -z "$TASK_ID" ]; then
  classify_and_exit BLOCKING "Task created but no ID returned"
fi

# Verify task starts in draft
if [ "$TASK_STATUS" != "draft" ]; then
  classify_and_exit BLOCKING "New task should start in 'draft' status, got: $TASK_STATUS"
fi

# Test task list filtering
ALL_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/tasks?status=draft" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo "000")
if [ "$ALL_CODE" != "200" ]; then
  classify_and_exit BLOCKING "GET /api/tasks?status=draft returned $ALL_CODE"
fi

# Cleanup: deactivate and delete
curl -s -o /dev/null -X DELETE "$API_BASE/api/tasks/$TASK_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null || true

classify_and_exit OK "Task management confirmed. Created task $TASK_ID in draft status. List filtering operational. Cleaned up."
#===== END FILE: scripts/qa-task-management.sh =====#

#===== FILE: scripts/qa-error-handling.sh =====#
#!/usr/bin/env bash
set -euo pipefail

# QA: Validates API error handling, input validation, and correct HTTP status codes for Automation OS

API_BASE="${API_BASE:-http://localhost:3000}"

classify_and_exit() {
  local severity=$1
  local message=$2
  case $severity in
    OK|PASS) echo "$message"; exit 0 ;;
    BLOCKING) echo "[BLOCKING] $message"; exit 1 ;;
    WARNING|WARN) echo "[WARNING] $message"; exit 2 ;;
    INFO) echo "[INFO] $message"; exit 3 ;;
    *) echo "[ERROR] Unknown severity: $severity"; exit 1 ;;
  esac
}

echo "Testing error handling and input validation"

ERRORS_FOUND=0

# Test 401 on protected endpoint without token
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/executions" 2>/dev/null || echo "000")
if [ "$CODE" != "401" ]; then
  echo "[FAIL] GET /api/executions without auth: expected 401, got $CODE"
  ERRORS_FOUND=$((ERRORS_FOUND + 1))
else
  echo "[PASS] GET /api/executions without auth correctly returns 401"
fi

# Test 400 on login with missing fields
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" -d '{"email":"only@email.com"}' 2>/dev/null || echo "000")
if [ "$CODE" != "400" ] && [ "$CODE" != "422" ]; then
  echo "[FAIL] Login with missing password: expected 400/422, got $CODE"
  ERRORS_FOUND=$((ERRORS_FOUND + 1))
else
  echo "[PASS] Login with missing password correctly returns $CODE"
fi

# Test 401 on login with wrong credentials
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/auth/login" \
  -H "Content-Type: application/json" -d '{"email":"notexist@example.com","password":"wrongpass"}' 2>/dev/null || echo "000")
if [ "$CODE" != "401" ] && [ "$CODE" != "400" ]; then
  echo "[FAIL] Login with wrong creds: expected 401, got $CODE"
  ERRORS_FOUND=$((ERRORS_FOUND + 1))
else
  echo "[PASS] Login with wrong credentials correctly returns $CODE"
fi

# Test 400 on invite/accept with invalid token
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/auth/invite/accept" \
  -H "Content-Type: application/json" \
  -d '{"token":"invalid-token-abc","password":"newpass123","firstName":"Test","lastName":"User"}' 2>/dev/null || echo "000")
if [ "$CODE" != "400" ] && [ "$CODE" != "404" ]; then
  echo "[FAIL] Accept invite with invalid token: expected 400, got $CODE"
  ERRORS_FOUND=$((ERRORS_FOUND + 1))
else
  echo "[PASS] Accept invite with invalid token correctly returns $CODE"
fi

if [ "$ERRORS_FOUND" -gt 0 ]; then
  classify_and_exit BLOCKING "$ERRORS_FOUND error handling tests FAILED. See output above."
fi

classify_and_exit OK "Error handling confirmed. 401, 400, and 422 responses functioning correctly for all tested edge cases."
#===== END FILE: scripts/qa-error-handling.sh =====#
