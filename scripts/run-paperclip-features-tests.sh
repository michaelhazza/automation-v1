#!/usr/bin/env bash
# QA Tests for Paperclip-Inspired Features (12 features)
# Validates structural correctness, schema alignment, and route registration

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

echo "=== Paperclip Features QA Tests ==="
echo ""

# ─────────────────────────────────────────────────────────────────────���────────
echo "--- Feature 1: Goal Hierarchy System ---"
# ──────────────────────────────────────────────────────────────────────────────

# Schema
check "goals schema file exists" "[ -f server/db/schema/goals.ts ]"
check "goals schema exports Goal type" "grep -q 'export type Goal' server/db/schema/goals.ts"
check "goals schema has organisationId" "grep -q 'organisation_id' server/db/schema/goals.ts"
check "goals schema has subaccountId" "grep -q 'subaccount_id' server/db/schema/goals.ts"
check "goals schema has parentGoalId" "grep -q 'parent_goal_id' server/db/schema/goals.ts"
check "goals schema has deletedAt" "grep -q 'deletedAt\|deleted_at' server/db/schema/goals.ts"
check "goals schema has status enum" "grep -q 'planned\|active\|completed\|archived' server/db/schema/goals.ts"
check "goals schema has level enum" "grep -q 'mission\|objective\|key_result' server/db/schema/goals.ts"
check "goals exported from schema index" "grep -q \"from './goals'\" server/db/schema/index.ts"

# Migration
check "goals migration exists" "[ -f migrations/0057_goals_system.sql ]"
check "goals migration creates table" "grep -q 'CREATE TABLE goals' migrations/0057_goals_system.sql"
check "goals migration adds goal_id to tasks" "grep -q 'ADD COLUMN goal_id' migrations/0057_goals_system.sql"

# Routes
check "goals route file exists" "[ -f server/routes/goals.ts ]"
check "goals route has GET list" "grep -q 'GET.*goals' server/routes/goals.ts || grep -q \"get.*goals\" server/routes/goals.ts || grep -q \"'/api/subaccounts/:subaccountId/goals'\" server/routes/goals.ts"
check "goals route has POST create" "grep -q \"post.*goals\" server/routes/goals.ts || grep -q 'POST' server/routes/goals.ts"
check "goals route has authenticate" "grep -q 'authenticate' server/routes/goals.ts"
check "goals route has resolveSubaccount" "grep -q 'resolveSubaccount' server/routes/goals.ts"
check "goals route registered in server/index.ts" "grep -q 'goalsRouter' server/index.ts"

# Tasks schema updated
check "tasks schema has goalId" "grep -q 'goal_id\|goalId' server/db/schema/tasks.ts"

# Projects schema updated
check "projects schema has goalId" "grep -q 'goal_id\|goalId' server/db/schema/projects.ts"

# Client
check "goals client page exists" "[ -f client/src/pages/GoalsPage.tsx ]"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 2: Org Chart Visualisation ---"
# ──────────────────────────────────────────────────────────────────────────────

check "org chart page exists" "[ -f client/src/pages/OrgChartPage.tsx ]"
check "org chart has SVG rendering" "grep -q 'svg\|SVG\|path\|<path' client/src/pages/OrgChartPage.tsx"
check "org chart has zoom controls" "grep -q 'zoom\|scale\|Zoom' client/src/pages/OrgChartPage.tsx"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 3: Inbox Enhancements ---"
# ──────────────────────────────────────────────────────────────────────────────

check "inbox read states schema exists" "[ -f server/db/schema/inboxReadStates.ts ]"
check "inbox read states has userId" "grep -q 'user_id' server/db/schema/inboxReadStates.ts"
check "inbox read states has entityType" "grep -q 'entity_type' server/db/schema/inboxReadStates.ts"
check "inbox read states has isRead" "grep -q 'is_read' server/db/schema/inboxReadStates.ts"
check "inbox read states has isArchived" "grep -q 'is_archived' server/db/schema/inboxReadStates.ts"
check "inbox read states exported from index" "grep -q \"from './inboxReadStates'\" server/db/schema/index.ts"
check "inbox route file exists" "[ -f server/routes/inbox.ts ]"
check "inbox service file exists" "[ -f server/services/inboxService.ts ]"
check "inbox route has mark-read" "grep -q 'mark-read\|markRead' server/routes/inbox.ts"
check "inbox route registered in server/index.ts" "grep -q 'inboxRouter' server/index.ts"
check "inbox migration exists" "[ -f migrations/0060_inbox_feedback_attachments.sql ]"
check "inbox migration creates table" "grep -q 'CREATE TABLE inbox_read_states' migrations/0060_inbox_feedback_attachments.sql"

# Inbox filtering enhancements
check "subaccounts schema has includeInOrgInbox" "grep -q 'include_in_org_inbox\|includeInOrgInbox' server/db/schema/subaccounts.ts"
check "inbox service supports orgWide filter" "grep -q 'orgWide\|includeInOrgInbox' server/services/inboxService.ts"
check "inbox service supports sortBy" "grep -q 'sortBy' server/services/inboxService.ts"
check "inbox service supports subaccountIds filter" "grep -q 'subaccountIds' server/services/inboxService.ts"
check "inbox service enriches subaccount names" "grep -q 'subaccountName' server/services/inboxService.ts"
check "inbox route accepts sortBy param" "grep -q 'sortBy' server/routes/inbox.ts"
check "inbox route accepts subaccountId param" "grep -q 'subaccountId' server/routes/inbox.ts"
check "subaccounts route accepts includeInOrgInbox" "grep -q 'includeInOrgInbox' server/routes/subaccounts.ts"
check "org inbox visibility migration exists" "[ -f migrations/0064_inbox_org_visibility.sql ]"
check "org inbox visibility migration adds column" "grep -q 'include_in_org_inbox' migrations/0064_inbox_org_visibility.sql"
check "inbox page has subaccount filter" "grep -q 'subaccount\|Subaccount\|subaccountFilter\|filterSubaccount' client/src/pages/InboxPage.tsx"
check "inbox page has sort controls" "grep -q 'sortBy\|sortDirection\|Sort\|sort' client/src/pages/InboxPage.tsx"
check "subaccount detail has org inbox toggle" "grep -q 'includeInOrgInbox\|include_in_org_inbox\|Org Inbox\|org inbox\|Organisation Inbox' client/src/pages/AdminSubaccountDetailPage.tsx"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 4: Agent Instruction Versioning ---"
# ──────────────────────────────────────────────────────────────────────────────

check "prompt revisions schema exists" "[ -f server/db/schema/agentPromptRevisions.ts ]"
check "prompt revisions has agentId" "grep -q 'agent_id' server/db/schema/agentPromptRevisions.ts"
check "prompt revisions has revisionNumber" "grep -q 'revision_number' server/db/schema/agentPromptRevisions.ts"
check "prompt revisions has promptHash" "grep -q 'prompt_hash' server/db/schema/agentPromptRevisions.ts"
check "prompt revisions exported from index" "grep -q \"from './agentPromptRevisions'\" server/db/schema/index.ts"
check "prompt revisions route exists" "[ -f server/routes/agentPromptRevisions.ts ]"
check "prompt revisions migration exists" "[ -f migrations/0058_agent_prompt_revisions.sql ]"
check "agent service creates revisions on prompt change" "grep -q 'prompt_revision\|promptRevision\|agentPromptRevisions\|revision' server/services/agentService.ts"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 5: Concurrency Policies ---"
# ──────────────────────────────────────────────────────────────────────────────

check "subaccountAgents has concurrencyPolicy" "grep -q 'concurrency_policy\|concurrencyPolicy' server/db/schema/subaccountAgents.ts"
check "subaccountAgents has catchUpPolicy" "grep -q 'catch_up_policy\|catchUpPolicy' server/db/schema/subaccountAgents.ts"
check "subaccountAgents has maxConcurrentRuns" "grep -q 'max_concurrent_runs\|maxConcurrentRuns' server/db/schema/subaccountAgents.ts"
check "orgAgentConfigs has concurrencyPolicy" "grep -q 'concurrency_policy\|concurrencyPolicy' server/db/schema/orgAgentConfigs.ts"
check "concurrency migration exists" "[ -f migrations/0059_concurrency_and_projects.sql ]"
check "concurrency migration adds columns" "grep -q 'concurrency_policy' migrations/0059_concurrency_and_projects.sql"
check "subaccountAgents route accepts concurrency fields" "grep -q 'concurrencyPolicy' server/routes/subaccountAgents.ts"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 6: Projects Gap Fixes ---"
# ──────────────────────────────────────────────────────────────────────────────

check "projects schema has targetDate" "grep -q 'target_date\|targetDate' server/db/schema/projects.ts"
check "projects schema has budgetCents" "grep -q 'budget_cents\|budgetCents' server/db/schema/projects.ts"
check "tasks route passes projectId to service" "grep -q 'projectId' server/routes/tasks.ts"
check "task service filters by projectId" "grep -q 'projectId' server/services/taskService.ts"
check "agentRuns has projectId" "grep -q 'project_id.*cost\|projectId' server/db/schema/agentRuns.ts"
check "costAggregates has projectId" "grep -q 'project_id\|projectId' server/db/schema/costAggregates.ts"
check "projects route accepts targetDate" "grep -q 'targetDate' server/routes/projects.ts"
check "projects route accepts budgetCents" "grep -q 'budgetCents' server/routes/projects.ts"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 7: HTTP/Webhook Agent Adapter ---"
# ──────────────────────────────────────────────────────────────────────────────

check "webhook adapter config schema exists" "[ -f server/db/schema/webhookAdapterConfigs.ts ]"
check "webhook adapter config has endpointUrl" "grep -q 'endpoint_url' server/db/schema/webhookAdapterConfigs.ts"
check "webhook adapter config has authType" "grep -q 'auth_type' server/db/schema/webhookAdapterConfigs.ts"
check "webhook adapter config has retryBackoffMs" "grep -q 'retry_backoff_ms\|retryBackoffMs' server/db/schema/webhookAdapterConfigs.ts"
check "webhook adapter config exported from index" "grep -q \"from './webhookAdapterConfigs'\" server/db/schema/index.ts"
check "webhook adapter route exists" "[ -f server/routes/webhookAdapter.ts ]"
check "webhook adapter service exists" "[ -f server/services/webhookAdapterService.ts ]"
check "webhook adapter has callback endpoint" "grep -q 'callback\|agent-callback' server/routes/webhookAdapter.ts"
check "webhook adapter migration exists" "[ -f migrations/0061_webhook_adapter_branding_governance.sql ]"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 8: File Attachments ---"
# ──────────────────────────────────────────────────────────────────────────────

check "task attachments schema exists" "[ -f server/db/schema/taskAttachments.ts ]"
check "task attachments has fileName" "grep -q 'file_name' server/db/schema/taskAttachments.ts"
check "task attachments has storageKey" "grep -q 'storage_key' server/db/schema/taskAttachments.ts"
check "task attachments has idempotencyKey" "grep -q 'idempotency_key' server/db/schema/taskAttachments.ts"
check "task attachments has deletedAt" "grep -q 'deleted_at\|deletedAt' server/db/schema/taskAttachments.ts"
check "task attachments exported from index" "grep -q \"from './taskAttachments'\" server/db/schema/index.ts"
check "attachments route exists" "[ -f server/routes/attachments.ts ]"
check "storage service exists" "[ -f server/lib/storageService.ts ]"
check "attachments migration in 0060" "grep -q 'CREATE TABLE task_attachments' migrations/0060_inbox_feedback_attachments.sql"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 9: Feedback Voting ---"
# ──────────────────────────────────────────────────────────────────────────────

check "feedback votes schema exists" "[ -f server/db/schema/feedbackVotes.ts ]"
check "feedback votes has vote field" "grep -q \"'vote'\" server/db/schema/feedbackVotes.ts"
check "feedback votes has entityType" "grep -q 'entity_type' server/db/schema/feedbackVotes.ts"
check "feedback votes has unique constraint" "grep -q 'userEntityUniq\|user_entity_uniq\|UNIQUE' server/db/schema/feedbackVotes.ts"
check "feedback votes exported from index" "grep -q \"from './feedbackVotes'\" server/db/schema/index.ts"
check "feedback route exists" "[ -f server/routes/feedback.ts ]"
check "feedback migration in 0060" "grep -q 'CREATE TABLE feedback_votes' migrations/0060_inbox_feedback_attachments.sql"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 11: Per-Org Branding ---"
# ──────────────────────────────────────────────────────────────────────────────

check "organisations has logoUrl" "grep -q 'logo_url\|logoUrl' server/db/schema/organisations.ts"
check "organisations has brandColor" "grep -q 'brand_color\|brandColor' server/db/schema/organisations.ts"
check "org service validates brandColor hex" "grep -q 'hex\|#[0-9a-fA-F]' server/services/organisationService.ts"
check "branding migration in 0061" "grep -q 'logo_url' migrations/0061_webhook_adapter_branding_governance.sql"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Feature 12: Agent Hiring Approval Gate ---"
# ──────────────────────────────────────────────────────────────────────────────

check "organisations has requireAgentApproval" "grep -q 'require_agent_approval\|requireAgentApproval' server/db/schema/organisations.ts"
check "governance migration in 0061" "grep -q 'require_agent_approval' migrations/0061_webhook_adapter_branding_governance.sql"

echo ""

# ──────────────────────────────────────────────────────────────────────────────
echo "--- Cross-Cutting Concerns ---"
# ──────────────────────────────────────────────────────────────────────────────

check "audit events has correlationId" "grep -q 'correlation_id\|correlationId' server/db/schema/auditEvents.ts"
check "correlation migration in 0061" "grep -q 'correlation_id' migrations/0061_webhook_adapter_branding_governance.sql"

# Soft-delete checks on all new schemas
check "goals schema has deletedAt" "grep -q 'deletedAt\|deleted_at' server/db/schema/goals.ts"
check "task attachments schema has deletedAt" "grep -q 'deletedAt\|deleted_at' server/db/schema/taskAttachments.ts"

# Org scoping on new routes
check "goals route scopes by org" "grep -q 'orgId\|organisationId\|req.orgId' server/routes/goals.ts"
check "inbox route scopes by org" "grep -q 'orgId\|organisationId\|req.orgId' server/routes/inbox.ts"
check "feedback route scopes by org" "grep -q 'orgId\|organisationId\|req.orgId' server/routes/feedback.ts"
check "attachments route scopes by org" "grep -q 'orgId\|organisationId\|req.orgId' server/routes/attachments.ts"

echo ""
echo "=== Paperclip Features QA Results: $PASS passed, $FAIL failed ==="
if [ $FAIL -gt 0 ]; then
  echo "[QA FAILED] $FAIL checks failed"
  exit 1
fi
echo "[QA PASSED] All $PASS checks passed"
