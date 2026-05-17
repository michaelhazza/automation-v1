#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify-no-raw-console.sh  (Phase 3 — B.2)
#
# Invariant: new server/**/*.ts files must not use raw console.log/warn/error/
# debug/info. Use the structured logger in server/lib/logger.ts instead.
#
# This gate is forward-looking: it enforces the invariant on files NOT in the
# pre-existing allowlist. Files that were already using raw console before this
# gate was introduced are grandfathered by the per-file allowlist below.
# To remove a file from the grandfathered list, migrate it to the structured
# logger and delete its entry from LEGACY_ALLOWLIST.
#
# A file may also opt out by including the line:
#   // allowed-raw-console: <reason>
# anywhere in the file (use for legitimate low-level bootstrap code).
#
# Known-bad fixture: scripts/fixtures/verify-no-raw-console-bad.txt
#   — references server/services/exampleService.ts with console.log
#
# Exit codes: 0 = clean, 1 = first violation found
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Structural allowlist (paths always exempt) ───────────────────────────────
# Bootstrap / logger internals — raw console is the only option here.
ALWAYS_EXEMPT_PATTERNS=(
  "server/index.ts"
  "server/lib/logger.ts"
)

# ── Legacy grandfathered files ───────────────────────────────────────────────
# Files that used raw console before B.2 was introduced. Migrate to logger and
# remove entries here to tighten the gate over time.
LEGACY_ALLOWLIST=(
  "server/adapters/index.ts"
  "server/config/actionRegistry.ts"
  "server/config/modelRegistry.ts"
  "server/jobs/agentRunCleanupJob.ts"
  "server/jobs/connectorPollingTick.ts"
  "server/jobs/memoryBlocksEmbeddingBackfillJob.ts"
  "server/jobs/memoryDecayJob.ts"
  "server/jobs/memoryDedupJob.ts"
  "server/jobs/memoryEntryDecayJob.ts"
  "server/jobs/memoryHnswReindexJob.ts"
  "server/jobs/priorityFeedCleanupJob.ts"
  "server/jobs/regressionReplayJob.ts"
  "server/jobs/securityEventsCleanupJob.ts"
  "server/jobs/skillAnalyzerJob.ts"
  "server/jobs/skillAnalyzerJob/orchestrator.ts"
  "server/jobs/skillAnalyzerJob/stage3Embed.ts"
  "server/jobs/skillAnalyzerJob/stage5Classify.ts"
  "server/jobs/slackInboundJob.ts"
  "server/lib/adminDbConnection.ts"
  "server/lib/createWorker.ts"
  "server/lib/embeddings.ts"
  "server/lib/env.ts"
  "server/lib/rateLimiter.ts"
  "server/lib/reranker.ts"
  "server/lib/transactionalEmailProvider.ts"
  "server/routes/githubApp.ts"
  "server/routes/oauthIntegrations.ts"
  "server/routes/public/pageTracking.ts"
  "server/routes/reviewItems.ts"
  "server/routes/systemUsers.ts"
  "server/routes/webhooks/ghlWebhook.ts"
  "server/routes/webhooks/slackWebhook.ts"
  "server/routes/webhooks/teamworkWebhook.ts"
  "server/services/adapters/apiAdapter.ts"
  "server/services/agentExecutionService.ts"
  "server/services/agentExecutionService/runLifecycle/complete.ts"
  "server/services/agentExecutionServicePure.ts"
  "server/services/agentRunHandoffService.ts"
  "server/services/agentService.ts"
  "server/services/agentService/agentDataSources.ts"
  "server/services/agentService/externalFetchers.ts"
  "server/services/agentService/scheduledTaskDataSources.ts"
  "server/services/auditService.ts"
  "server/services/authService.ts"
  "server/services/boardService.ts"
  "server/services/clientPulseHighRiskService.ts"
  "server/services/computeBudgetService.ts"
  "server/services/connectionTokenService.ts"
  "server/services/connectionTokenValidation.ts"
  "server/services/connectorPollingService.ts"
  "server/services/costAggregateService.ts"
  "server/services/emailService.ts"
  "server/services/executionLayerService.ts"
  "server/services/hierarchyTemplateService.ts"
  "server/services/intelligenceSkillExecutor.ts"
  "server/services/llmResolver.ts"
  "server/services/llmRouter.ts"
  "server/services/llmRouter/routeCall.ts"
  "server/services/middleware/proposeAction.ts"
  "server/services/middleware/workspaceLimitCheck.ts"
  "server/services/orgMemoryService.ts"
  "server/services/organisationService.ts"
  "server/services/paymentReconciliationJob.ts"
  "server/services/permissionSeedService.ts"
  "server/services/pricingService.ts"
  "server/services/pulseLaneClassifier.ts"
  "server/services/queueService.ts"
  "server/services/queueService/enqueueHelpers.ts"
  "server/services/queueService/maintenanceJobs/intervalFallback.ts"
  "server/services/queueService/maintenanceJobs/pgBossRegistrations.ts"
  "server/services/queueService/maintenanceJobs/start.ts"
  "server/services/reviewAuditService.ts"
  "server/services/reviewService.ts"
  "server/services/routerJobService.ts"
  "server/services/runContextLoader.ts"
  "server/services/scheduledTaskService.ts"
  "server/services/securityAuditSentinelValidation.ts"
  "server/services/skillExecutor.ts"
  "server/services/skillExecutor/gating.ts"
  "server/services/skillExecutor/pipeline.ts"
  "server/services/skillExecutor/handlers/web.ts"
  "server/services/skillParserService.ts"
  "server/services/slackConversationService.ts"
  "server/services/systemAgentRegistryValidator.ts"
  "server/services/systemTemplateService.ts"
  "server/services/triggerService.ts"
  "server/services/userService.ts"
  "server/services/workspaceMemoryService.ts"
  "server/services/workspaceMemoryService/enrichmentJob.ts"
  "server/services/workspaceMemoryService/entities.ts"
  "server/services/workspaceMemoryService/extract.ts"
  "server/services/workspaceMemoryService/hybridRetrieval.ts"
  "server/websocket/emitters.ts"
  "server/websocket/index.ts"
)

is_exempt() {
  local rel_path="$1"

  # Always-exempt structural paths
  for pattern in "${ALWAYS_EXEMPT_PATTERNS[@]}"; do
    [[ "$rel_path" == "$pattern" ]] && return 0
  done

  # Test files
  [[ "$rel_path" == *"/__tests__/"* ]] && return 0
  [[ "$rel_path" == *".test.ts" ]] && return 0
  [[ "$rel_path" == *".integration.test.ts" ]] && return 0
  [[ "$rel_path" == *".unit.ts" ]] && return 0
  [[ "$rel_path" == server/tests/* ]] && return 0

  # Legacy grandfathered
  for entry in "${LEGACY_ALLOWLIST[@]}"; do
    [[ "$rel_path" == "$entry" ]] && return 0
  done

  return 1
}

# Scan server/ for raw console usage
while IFS= read -r match; do
  # match is "path:lineno:content"
  file=$(echo "$match" | cut -d: -f1)
  lineno=$(echo "$match" | cut -d: -f2)
  rel_path="${file#$ROOT_DIR/}"

  # Check per-file opt-out marker
  if grep -q "// allowed-raw-console:" "$file" 2>/dev/null; then
    continue
  fi

  is_exempt "$rel_path" && continue

  echo "verify-no-raw-console.sh: raw console call in server/ outside allowlist at ${rel_path}:${lineno}: use server/lib/logger.ts instead"
  exit 1
done < <(grep -rn "console\.\(log\|warn\|error\|debug\|info\)" "$ROOT_DIR/server/" --include="*.ts" 2>/dev/null || true)

exit 0
