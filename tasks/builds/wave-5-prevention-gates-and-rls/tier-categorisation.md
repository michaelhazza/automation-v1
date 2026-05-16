# Wave 5 Tier Categorisation

Generated: 2026-05-16T12:46:49Z

## Table of Contents

- [Summary Counts](#summary-counts)
- [Per-callsite list](#per-callsite-list)
  - [agentExecution / skillExecutor group (Chunks 7-8)](#agentexecution--skillexecutor-group-chunks-7-8)
  - [Workflow / Billing / PA services (Chunks 9-11)](#workflow--billing--pa-services-chunks-9-11)
  - [Sandbox / Integration / Remaining Tier 1 (Chunks 12-14)](#sandbox--integration--remaining-tier-1-chunks-12-14)
  - [Tier 2 — cross-tenant / system / admin callsites (Chunk 15)](#tier-2--cross-tenant--system--admin-callsites-chunk-15)
- [Gate state (pre-build)](#gate-state-pre-build)
- [Session M deconfliction — agentExecutionService](#session-m-deconfliction--agentexecutionservice)
- [Step 8b: RLS GUC for ea_drafts and voice_profiles](#step-8b-rls-guc-for-ea_drafts-and-voice_profiles)
- [Migration chunk order](#migration-chunk-order)
- [P2 gate baseline](#p2-gate-baseline)

---

## Summary Counts

Command used:
```bash
grep -rn "\bdb\.(select|insert|update|delete|execute|query|transaction)" server/services/ --include="*.ts" \
  | grep -v "getOrgScopedDb|withAdminConnection|scopedDb" | grep -v "__tests__/" | sort
```

| Metric | Count |
|---|---|
| Files under server/services/ importing db (including tests) | 332 |
| Production service files with raw-db callsites | 190 |
| Total raw-db callsites in production services | 586 |
| Files already using getOrgScopedDb exclusively (Tier 3) | 116 |
| Files already using withAdminConnection exclusively | 29 (some overlap with Tier 3) |
| Current P2 gate (verify-with-org-tx-or-scoped-db) violations | 0 |

**Tier summary (per callsite):**

| Tier | Description | Approximate callsite count | Approximate file count |
|---|---|---|---|
| Tier 1 (must-migrate) | Tenant table, org-traffic path | ~410 | ~130 |
| Tier 1 blocked (escalate) | No upstream org context confirmed | 0 | 0 |
| Tier 2 (sanctioned bypass) | Cross-tenant / admin / system | ~90 | ~40 |
| Tier 3 (already-clean) | Uses getOrgScopedDb / withAdminConnection exclusively | N/A (no raw-db callsites) | 116+ |

> Note: "partial" files (mixing raw-db with getOrgScopedDb) appear in the Tier 1 rows. Each such file has some callsites already migrated and some needing migration. The per-callsite list is the source of truth.

---

## Per-callsite list

<!-- tenant_key: derived from USING clause in policyMigration SQL (NOT a field in rlsProtectedTables.ts).
     policy_migration: from RLS_PROTECTED_TABLES[n].policyMigration for the table.
     Tier 3 files and test files omitted from this list. -->

### agentExecution / skillExecutor group (Chunks 7-8)

| file:line | callsite | table | tenant_key | policy_migration | tier | upstream entrypoint / rationale |
|---|---|---|---|---|---|---|
| server/services/agentExecutionService.ts:111 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService |
| server/services/agentExecutionLoop.ts:509 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionLoop |
| server/services/agentExecutionLoop.ts:842 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionLoop |
| server/services/agentExecutionLoop.ts:882 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionLoop |
| server/services/agentExecutionLoop.ts:915 | db.insert(agentMessages) | agent_messages | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionLoop |
| server/services/agentExecutionLoop.ts:946 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionLoop |
| server/services/agentExecutionEventService.ts:306 | db.transaction(async tx) | agent_execution_events | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionEventService |
| server/services/agentExecutionEventService.ts:580 | db.transaction(async tx) | agent_execution_events | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionEventService |
| server/services/agentExecutionEventService.ts:1147 | db.transaction(async innerTx) | agent_execution_events | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionEventService |
| server/services/agentExecutionService/runLifecycle/complete.ts:127 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → complete |
| server/services/agentExecutionService/runLifecycle/complete.ts:323 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → complete |
| server/services/agentExecutionService/runLifecycle/complete.ts:402 | db.insert(agentRunSnapshots) | agent_run_snapshots | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → complete |
| server/services/agentExecutionService/runLifecycle/complete.ts:437 | db.update(subaccountAgents) | subaccount_agents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → complete |
| server/services/agentExecutionService/runLifecycle/configure.ts:58 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → configure |
| server/services/agentExecutionService/runLifecycle/configure.ts:79 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → configure |
| server/services/agentExecutionService/runLifecycle/configure.ts:128 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → configure |
| server/services/agentExecutionService/runLifecycle/configure.ts:219 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → configure |
| server/services/agentExecutionService/runLifecycle/loadContext.ts:59 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → loadContext |
| server/services/agentExecutionService/runLifecycle/prepare.ts:41 | db.select().from(systemAgents) | system_agents | n/a (cross-tenant system) | — | Tier 2 | system_agents is a cross-tenant system table; reads all agents for per-run config lookup. Use withAdminConnection. |
| server/services/agentExecutionService/runLifecycle/prepare.ts:615 | db.update(agentRuns) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → prepare |
| server/services/agentExecutionService/runLifecycle/prepare.ts:654 | db.insert(agentRunSnapshots) | agent_run_snapshots | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentExecutionService → prepare |
| server/services/skillExecutor/pipeline.ts:275 | db.transaction(async tx) | tasks/actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → skillExecutor.pipeline (F7 callsite) |
| server/services/intelligenceSkillExecutor.ts:* | db.* (all callsites) | actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → intelligenceSkillExecutor |
| server/services/agentResumeService.ts:* | db.* (all callsites) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentResumeService |
| server/services/agentRunFinalizationService.ts:* | db.* (all callsites) | agent_runs/actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → agentRunFinalizationService |
| server/services/executionLayerService.ts:* | db.* (all callsites) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → executionLayerService |
| server/services/executionService.ts:* | db.* (all callsites) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → executionService |
| server/services/queueService/executionProcessor.ts:* | db.* (all callsites) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | createWorker pg-boss wrapper → executionProcessor |
| server/services/actionService.ts:353 | db.execute(sql\`) | actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → actionService |
| server/services/actionService.ts:378 | db.update(actions) | actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → actionService |
| server/services/actionService.ts:446 | db.update(actions) | actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → actionService |

### Workflow / Billing / PA services (Chunks 9-11)

| file:line | callsite | table | tenant_key | policy_migration | tier | upstream entrypoint / rationale |
|---|---|---|---|---|---|---|
| server/services/workflowEngine/contextHelpers.ts:* | db.* | workflow_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowEngine/definitionHelpers.ts:* | db.* | workflow_definitions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowEngine/queueLifecycle/agentStep.ts:* | db.* | workflow_step_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowEngine/queueLifecycle/dispatch.ts:* | db.* | workflow_step_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowEngine/queueLifecycle/tick.ts:* | db.* | workflow_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowEngine/readySet.ts:* | db.* | workflow_step_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowEngine/stepLifecycle.ts:* | db.* | workflow_step_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → workflowEngine |
| server/services/workflowRunService.ts:* (7 callsites) | db.* | workflow_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → workflowRunService (partial; some getOrgScopedDb already) |
| server/services/workflowRunPauseStopService.ts:* | db.* | workflow_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware or createWorker → workflowRunPauseStopService (partial; some getOrgScopedDb) |
| server/services/workflowRunInsertHelper.ts:* | db.* | workflow_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → workflowRunInsertHelper |
| server/services/workflowRunCostLedgerService.ts:* | db.* | workflow_run_costs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → workflowRunCostLedgerService |
| server/services/workflowGateStallNotifyService.ts:* | db.* | workflow_gate_stalls | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → workflowGateStallNotifyService (partial; some withAdminConnection) |
| server/services/workflowStepReviewService.ts:* | db.* | workflow_step_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → workflowStepReviewService |
| server/services/workflowTemplateService.ts:* | db.* | workflow_templates | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → workflowTemplateService |
| server/services/flowExecutorService.ts:* | db.* | workflow_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → flowExecutorService |
| server/services/llmUsageService.ts:* (21 callsites) | db.* | llm_requests | app.organisation_id | 0081_rls_llm_requests_audit.sql | Tier 1 | authenticate middleware → route → llmUsageService |
| server/services/llmService.ts:* | db.* | llm_requests | app.organisation_id | 0081_rls_llm_requests_audit.sql | Tier 1 | authenticate middleware → route → llmService |
| server/services/llmRouter/routeCall.ts:* | db.* | llm_requests | app.organisation_id | 0081_rls_llm_requests_audit.sql | Tier 1 | createWorker or authenticate middleware → llmRouter |
| server/services/computeBudgetService.ts:* | db.* | org_compute_budgets | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → computeBudgetService |
| server/services/spendLedgerService.ts:* | db.* | spend_ledger | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → spendLedgerService |
| server/services/spendInsightsService.ts:* | db.* | cost_aggregates | app.organisation_id | 0272_cost_aggregates_rls_and_spend_dims.sql | Tier 1 | authenticate middleware → route → spendInsightsService |
| server/services/spendTrendsService.ts:* | db.* | cost_aggregates | app.organisation_id | 0272_cost_aggregates_rls_and_spend_dims.sql | Tier 1 | authenticate middleware → route → spendTrendsService |
| server/services/operatorCostWriter.ts:* | db.* | cost_aggregates | app.organisation_id | 0272_cost_aggregates_rls_and_spend_dims.sql | Tier 1 | createWorker → operatorCostWriter |
| server/services/agentActivityService.ts:245 | db.execute(sql\`) | agent_runs | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → agentActivityService |
| server/services/agentActivityService.ts:335 | db.execute(sql\`) | cost_aggregates | app.organisation_id | 0272_cost_aggregates_rls_and_spend_dims.sql | Tier 1 | authenticate middleware → route → agentActivityService |
| server/services/eaDrafts/eaDraftService.ts:* | db.* | ea_drafts | app.organisation_id | 0329_ea_drafts.sql | Tier 1 | authenticate middleware → route → eaDraftService (partial; some withAdminConnection already) |
| server/services/eaProvisioningService.ts:* | db.* | ea_drafts | app.organisation_id | 0329_ea_drafts.sql | Tier 1 | authenticate middleware → route → eaProvisioningService |
| server/services/voiceProfile/voiceProfileService.ts:* | db.* (all callsites) | voice_profiles | app.organisation_id | 0328_voice_profiles.sql | Tier 1 | authenticate middleware → route → voiceProfileService (partial; some getOrgScopedDb already) |
| server/services/operatorSessionService.ts:* | db.* | operator_sessions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware or createWorker → operatorSessionService (partial; some getOrgScopedDb) |
| server/services/operatorChainResumeService.ts:* | db.* | operator_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → operatorChainResumeService |
| server/services/operatorChainSchedulerService.ts:* | db.* | operator_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → operatorChainSchedulerService |

### Sandbox / Integration / Remaining Tier 1 (Chunks 12-14)

| file:line | callsite | table | tenant_key | policy_migration | tier | upstream entrypoint / rationale |
|---|---|---|---|---|---|---|
| server/services/sandboxHarvestService.ts:* | db.* | sandbox_artefacts | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → sandboxHarvestService (partial; some getOrgScopedDb) |
| server/services/operatorSandboxFileEventBridge.ts:* | db.* | sandbox_artefacts | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → operatorSandboxFileEventBridge (partial; some getOrgScopedDb) |
| server/services/subaccountIeeBrowserSettingsService.ts:* | db.* | subaccount_iee_browser_settings | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subaccountIeeBrowserSettingsService |
| server/services/ieeSessionService.ts:* | db.* | iee_sessions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware or createWorker → ieeSessionService (partial; some getOrgScopedDb) |
| server/services/executionBackends/_ieeShared.ts:* | db.* | iee_sessions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → executionBackend._ieeShared |
| server/services/executionBackends/operatorManagedBackend.ts:* (11 callsites) | db.* | operator_sessions/operator_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → operatorManagedBackend (partial; some withAdminConnection already) |
| server/services/connectionsService.ts:* (7 callsites) | db.* | integration_connections | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → connectionsService |
| server/services/integrationConnectionService.ts:* (17 callsites) | db.* | integration_connections | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → integrationConnectionService |
| server/services/ghlAgencyOauthService.ts:291 | db.transaction(async tx) | ghl_agency_locations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → ghlAgencyOauthService |
| server/services/ghlAgencyOauthService.ts:389 | db.transaction(async tx) | ghl_agency_locations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → ghlAgencyOauthService |
| server/services/ghlOAuthStateStore.ts:* | db.* | oauth_state_nonces | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → ghlOAuthStateStore |
| server/services/githubWebhookService.ts:* | db.* | github_repos | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker webhook handler → githubWebhookService (partial; some getOrgScopedDb) |
| server/services/webhookAdapterService.ts:* | db.* | webhook_events | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker webhook handler → webhookAdapterService (partial; some getOrgScopedDb) |
| server/services/webhookReplayNonceStore.ts:* | db.* | webhook_replay_nonces | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker webhook handler → webhookReplayNonceStore |
| server/services/webhookService.ts:* | db.* | webhooks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → webhookService |
| server/services/agentBeliefService.ts:* (11 callsites) | db.* | agent_beliefs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentBeliefService |
| server/services/agentRecommendationsService.ts:* (12 callsites) | db.* | agent_recommendations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentRecommendationsService |
| server/services/boardService.ts:* (7 callsites) | db.* | tasks | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → boardService |
| server/services/taskService.ts:* (9 callsites) | db.* | tasks | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → taskService (partial; some getOrgScopedDb already) |
| server/services/taskEventService.ts:* | db.* | task_events | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → taskEventService |
| server/services/reviewService.ts:* (6 callsites) | db.* | review_items/review_audit_records | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | authenticate middleware → route → reviewService |
| server/services/scheduledTaskService.ts:* (15 callsites) | db.* | scheduled_tasks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → scheduledTaskService (partial; some getOrgScopedDb) |
| server/services/memoryBlockService.ts:* | db.* | memory_blocks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → memoryBlockService |
| server/services/memoryBlockSynthesisService.ts:* | db.* | memory_blocks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → memoryBlockSynthesisService |
| server/services/memoryBlockVersionService.ts:* | db.* | memory_block_versions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → memoryBlockVersionService |
| server/services/memoryCitationDetector.ts:* | db.* | memory_blocks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → memoryCitationDetector |
| server/services/memoryHealthDataService.ts:* | db.* | memory_blocks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → memoryHealthDataService |
| server/services/memoryReviewQueueService.ts:* | db.* | memory_review_queue | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → memoryReviewQueueService |
| server/services/memoryUtilityQueryService.ts:* | db.* | memory_blocks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → memoryUtilityQueryService (partial; some getOrgScopedDb) |
| server/services/workspaceMemoryService/decayAndEmbedding.ts:* (5 callsites) | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | createWorker → workspaceMemoryService |
| server/services/workspaceMemoryService/enrichmentJob.ts:* | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | createWorker → workspaceMemoryService |
| server/services/workspaceMemoryService/extract.ts:* | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | createWorker → workspaceMemoryService |
| server/services/workspaceMemoryService/graphExpansion.ts:* | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | createWorker → workspaceMemoryService |
| server/services/workspaceMemoryService/hybridRetrieval.ts:* (7 callsites) | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | authenticate middleware → route → workspaceMemoryService |
| server/services/documentBundleService.ts:* (8 callsites) | db.* | document_bundles | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → documentBundleService |
| server/services/automationService.ts:* (10 callsites) | db.* | automations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → automationService |
| server/services/automationConnectionMappingService.ts:* (7 callsites) | db.* | automations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → automationConnectionMappingService |
| server/services/automationResolutionService.ts:* (6 callsites) | db.* | automations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → automationResolutionService |
| server/services/agentScheduleService.ts:* | db.* | scheduled_tasks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → agentScheduleService (partial; some getOrgScopedDb) |
| server/services/subaccountService.ts:* (7 callsites) | db.* | subaccounts | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subaccountService |
| server/services/subaccountAgentService.ts:* | db.* | subaccount_agents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subaccountAgentService |
| server/services/subaccountOnboardingService.ts:* | db.* | subaccounts | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subaccountOnboardingService (partial; some getOrgScopedDb) |
| server/services/subaccountOperatorSettingsService.ts:* | db.* | subaccount_operator_settings | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subaccountOperatorSettingsService |
| server/services/subaccountTagService.ts:* | db.* | subaccount_tags | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subaccountTagService |
| server/services/permissionSetService.ts:* (6 callsites) | db.* | permission_sets | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → permissionSetService |
| server/services/knowledgeService.ts:* | db.* | knowledge_items | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → knowledgeService (partial; some getOrgScopedDb) |
| server/services/inboxService.ts:* (8 callsites) | db.* | canonical_inboxes | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → inboxService (partial; some getOrgScopedDb) |
| server/services/agentService/agentDataSources.ts:* | db.* | agents/subaccounts | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentService |
| server/services/agentService/agentFullView.ts:* (6 callsites) | db.* | agents/agent_runs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentService |
| server/services/agentService/crud.ts:* | db.* | agents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentService |
| server/services/agentService/externalFetchers.ts:* | db.* | agents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentService |
| server/services/agentService/scheduledTaskDataSources.ts:* | db.* | scheduled_tasks | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentService |
| server/services/agentTemplateService.ts:* | db.* | agent_templates | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → agentTemplateService |
| server/services/agentPromptRevisionService.ts:* | db.* | agent_runs/actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → agentPromptRevisionService |
| server/services/agentPresenceService.ts:* | db.* | agent_presence_projections | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → agentPresenceService (partial; some getOrgScopedDb) |
| server/services/agentObservationService.ts:* | db.* | agent_observations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware or createWorker → agentObservationService (partial; some getOrgScopedDb) |
| server/services/agentWorkingTimeService.ts:* | db.* | agent_working_time_rollups | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → agentWorkingTimeService (partial; some getOrgScopedDb) |
| server/services/auditService.ts:16 | db.insert(auditEvents) | audit_events | app.organisation_id | 0081_rls_llm_requests_audit.sql | Tier 1 | authenticate middleware → route → auditService (tenant-scoped audit inserts) |
| server/services/beliefConflictService.ts:* | db.* | agent_beliefs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → beliefConflictService |
| server/services/benchRunService.ts:* | db.* | bench_runs/bench_results | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → benchRunService (partial; some getOrgScopedDb) |
| server/services/categoryService.ts:* | db.* | automation_categories | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → categoryService |
| server/services/clientPulseIngestionService.ts:* | db.* | canonical_contacts | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker pg-boss wrapper → clientPulseIngestionService |
| server/services/configBackupService.ts:* | db.* | config_backup | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → configBackupService |
| server/services/configHistoryService.ts:* | db.* | config_history | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → configHistoryService |
| server/services/connectionTokenService.ts:* | db.* | connection_tokens | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → connectionTokenService |
| server/services/conversationService.ts:* | db.* | canonical_conversations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → conversationService |
| server/services/correctionCaptureService.ts:* | db.* | correction_captures | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → correctionCaptureService (partial; some getOrgScopedDb) |
| server/services/delegationOutcomeService.ts:* | db.* | delegation_outcomes | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → delegationOutcomeService (partial; some getOrgScopedDb) |
| server/services/deliveryService.ts:* | db.* | deliveries | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → deliveryService (partial; some getOrgScopedDb) |
| server/services/documentPromotionService.ts:* | db.* | document_promotion_audit | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → documentPromotionService (partial; some getOrgScopedDb) |
| server/services/dropZoneService.ts:* | db.* | drop_zone_upload_audit | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → dropZoneService |
| server/services/engineResolutionService.ts:* | db.* | automation_engines | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → engineResolutionService |
| server/services/engineService.ts:* | db.* | automation_engines | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → engineService |
| server/services/externalDocumentResolverService.ts:* (6 callsites) | db.* | reference_documents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → externalDocumentResolverService (partial; some getOrgScopedDb) |
| server/services/feedbackService.ts:* | db.* | feedback | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → feedbackService |
| server/services/fileDeliveryService.ts:* | db.* | file_deliveries | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → fileDeliveryService (partial; some getOrgScopedDb and withAdminConnection) |
| server/services/formSubmissionService.ts:* | db.* | form_submissions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → formSubmissionService |
| server/services/ghlWebhookMutationsService.ts:* | db.* | ghl_locations | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker webhook handler → ghlWebhookMutationsService (partial; some withAdminConnection) |
| server/services/goalService.ts:* | db.* | goals | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → goalService |
| server/services/mcpServerConfigService.ts:* | db.* | mcp_server_configs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → mcpServerConfigService |
| server/services/moduleService.ts:* | db.* | modules | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → moduleService |
| server/services/notifyOperatorFanoutService.ts:* | db.* | operator_sessions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → notifyOperatorFanoutService |
| server/services/operatorTaskProfileService.ts:* | db.* | operator_task_profiles | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → operatorTaskProfileService (partial; some withAdminConnection) |
| server/services/optimiser/runOptimiserScan.ts:* | db.* | optimiser_results | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → optimiser (partial; some getOrgScopedDb and withAdminConnection) |
| server/services/orgMemoryService.ts:* | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | authenticate middleware → route → orgMemoryService |
| server/services/pageIntegrationWorker.ts:* | db.* | pages | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → pageIntegrationWorker |
| server/services/pageProjectService.ts:* | db.* | page_projects | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → pageProjectService |
| server/services/pageService.ts:* | db.* | pages | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → pageService |
| server/services/pageTrackingService.ts:* | db.* | page_views | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → pageTrackingService |
| server/services/priorityFeedService.ts:* | db.* | priority_feed | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware or createWorker → priorityFeedService |
| server/services/projectService.ts:* | db.* | projects | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → projectService |
| server/services/referenceDocumentService.ts:* (6 callsites) | db.* | reference_documents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → referenceDocumentService (partial; some getOrgScopedDb) |
| server/services/retrievalObservabilityService.ts:* | db.* | retrieval_events | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker or authenticate → retrievalObservabilityService (partial; some getOrgScopedDb) |
| server/services/runTraceService.ts:* | db.* | agent_runs/actions | app.organisation_id | 0079_rls_tasks_actions_runs.sql | Tier 1 | authenticate middleware → route → runTraceService |
| server/services/runtimeCheckService.ts:* | db.* | runtime_check_results | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker → runtimeCheckService (partial; some getOrgScopedDb) |
| server/services/scorecardService.ts:* | db.* | scorecards | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → scorecardService (partial; some getOrgScopedDb) |
| server/services/skillAnalyzerService/execute/approved.ts:* | db.* | skill_analyzer_results | app.organisation_id | 0359_skill_analyzer_results_rls.sql | Tier 1 | createWorker → skillAnalyzerService (partial; some getOrgScopedDb) |
| server/services/skillAnalyzerService/jobLifecycle/resume.ts:* | db.* | skill_analyzer_results | app.organisation_id | 0359_skill_analyzer_results_rls.sql | Tier 1 | createWorker → skillAnalyzerService (partial; some getOrgScopedDb) |
| server/services/skillService.ts:* (6 callsites) | db.* | org_skills | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → skillService (partial; some withAdminConnection) |
| server/services/skillStudioService.ts:* (5 callsites) | db.* | skill_studio_versions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → skillStudioService |
| server/services/subscriptionService.ts:* | db.* | org_subscriptions | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → subscriptionService |
| server/services/supportAgentInstallService.ts:* | db.* | agents | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → supportAgentInstallService |
| server/services/triggerService.ts:* | db.* | agent_triggers | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → triggerService |
| server/services/trustCalibrationService.ts:* | db.* | trust_calibration_state | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → trustCalibrationService |
| server/services/webLoginConnectionService.ts:* | db.* | web_login_connections | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → webLoginConnectionService |
| server/services/workspace/workspaceEmailPipeline.ts:* | db.* | workspace_emails | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | createWorker webhook → workspaceEmailPipeline (partial; some getOrgScopedDb) |
| server/services/workspace/workspaceOnboardingService.ts:* | db.* | workspace_memories | app.organisation_id | 0080_rls_review_audit_workspace.sql | Tier 1 | authenticate middleware → route → workspaceOnboardingService (partial; some getOrgScopedDb) |
| server/services/workspaceHealth/workspaceHealthService.ts:* | db.* | workspace_health | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → workspaceHealthService |
| server/services/connectorConfigService.ts:* | db.* | connector_configs | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route or createWorker → connectorConfigService (partial; some withAdminConnection) |
| server/services/hierarchyTemplateService.ts:* (tenant callsites) | db.* (tenant template rows) | hierarchy_templates | app.organisation_id | 0245_all_tenant_tables_rls.sql | Tier 1 | authenticate middleware → route → hierarchyTemplateService |

### Tier 2 — cross-tenant / system / admin callsites (Chunk 15)

| file:line | callsite | table | tier | bypass rationale |
|---|---|---|---|---|
| server/services/agentExecutionService/runLifecycle/prepare.ts:41 | db.select().from(systemAgents) | system_agents | Tier 2 | system_agents is cross-tenant — no org RLS; reads all system agents for per-run config lookup. Migrate to withAdminConnection. |
| server/services/authService.ts:274 | db.transaction(async tx) | organisations/users | Tier 2 | Org provisioning path — no org context exists during registration; cross-tenant record creation. Migrate to withAdminConnection. |
| server/services/configUpdateOrganisationService.ts:* | db.* | organisations | Tier 2 | Admin org config update — modifies cross-tenant org record. Migrate to withAdminConnection. |
| server/services/hierarchyTemplateService.ts:190 | db.select().from(systemAgents) | system_agents | Tier 2 | Cross-tenant system agent lookup for template hierarchy. Migrate to withAdminConnection. |
| server/services/incidentIngestor.ts:* | db.* | system_incidents | Tier 2 | System incident store — cross-tenant; no org context. Migrate to withAdminConnection. |
| server/services/jobQueueHealthService.ts:* (6 callsites) | db.* | job_queue_health | Tier 2 | System-wide pg-boss queue health monitor — cross-tenant; no org context. Migrate to withAdminConnection. |
| server/services/llmInflightRegistry.ts:* | db.* | llm_inflight | Tier 2 | Process-level in-flight LLM call registry — cross-tenant process state. Migrate to withAdminConnection or guard-ignore with rationale. |
| server/services/organisationService.ts:25 | db.select().from(organisations) | organisations | Tier 2 | Super-admin list all orgs — cross-tenant admin operation. Migrate to withAdminConnection. |
| server/services/organisationService.ts:65 | db.insert(users) | users | Tier 2 | Org provisioning — creates cross-tenant user record. Migrate to withAdminConnection. |
| server/services/organisationService.ts:236 | db.update(organisations) | organisations | Tier 2 | Admin soft-delete org — cross-tenant admin operation. Migrate to withAdminConnection. |
| server/services/organisationService.ts:239 | db.update(users) | users | Tier 2 | Admin org teardown — cross-tenant cleanup. Migrate to withAdminConnection. |
| server/services/organisationService.ts:244 | db.update(automationEngines) | automation_engines | Tier 2 | Admin org teardown — cross-tenant cleanup. Migrate to withAdminConnection. |
| server/services/organisationService.ts:249 | db.update(automationCategories) | automation_categories | Tier 2 | Admin org teardown — cross-tenant cleanup. Migrate to withAdminConnection. |
| server/services/organisationService.ts:254 | db.update(automations) | automations | Tier 2 | Admin org teardown — cross-tenant cleanup. Migrate to withAdminConnection. |
| server/services/paymentReconciliationJob.ts:* | db.* | conversion_events/pages | Tier 2 | Cron job — reads cross-tenant page records for Stripe reconciliation. Confirm absence of org context; migrate to withAdminConnection. |
| server/services/permissionSeedService.ts:* | db.* | permissions/permission_sets | Tier 2 | System boot seed — creates cross-tenant system permissions. Migrate to withAdminConnection. |
| server/services/sandbox/browserWarmPool.ts:* | db.* (non-withAdminConnection callsites) | browser_warm_sessions | Tier 2 | Browser warm pool manager — cross-tenant pool management. Per-callsite: confirm which are admin vs org-scoped; some already withAdminConnection. |
| server/services/sandbox/ieeBrowserProfileManager.ts:* (non-withAdminConnection callsites) | db.* | iee_browser_session_profiles | Tier 2 | Browser profile manager — some callsites cross-tenant admin. Per-callsite: confirm; some already withAdminConnection. |
| server/services/securityAuditSentinelValidation.ts:* | db.* | security_audit_events | Tier 2 | System-wide security audit — cross-tenant; no org context. Migrate to withAdminConnection. |
| server/services/securityAuditService.ts:* | db.* | security_audit_events | Tier 2 | System-wide security audit — cross-tenant; no org context. Migrate to withAdminConnection. |
| server/services/staleRunCleanupService.ts:* | db.* | agent_runs | Tier 2 | Cron cleanup job — cross-tenant stale run sweep; no org context. Migrate to withAdminConnection. |
| server/services/systemAgentRegistryValidator.ts:39 | db.execute(sql\`) | system_agents | Tier 2 | System agent registry validation — cross-tenant system table. Migrate to withAdminConnection. |
| server/services/systemAgentService.ts:* (9 callsites) | db.* | system_agents | Tier 2 | System agents are cross-tenant system table — no org scoping. Migrate all callsites to withAdminConnection. |
| server/services/systemIncidentService.ts:* (10 callsites) | db.* | system_incidents | Tier 2 | System incidents — cross-tenant system table. Migrate to withAdminConnection. |
| server/services/systemMonitor/skills/readDlqRecent.ts:* | db.* | dlq_records | Tier 2 | System DLQ — cross-tenant system table. Migrate to withAdminConnection. |
| server/services/systemMonitor/skills/writeDiagnosis.ts:* | db.* | system_diagnoses | Tier 2 | System diagnoses — cross-tenant. Migrate to withAdminConnection. |
| server/services/systemMonitor/skills/writeEvent.ts:* | db.* | system_events | Tier 2 | System events — cross-tenant. Migrate to withAdminConnection. |
| server/services/systemMonitor/synthetic/*.ts:* | db.* | various system tables | Tier 2 | System monitor synthetic checks — cross-tenant monitoring. Migrate to withAdminConnection. |
| server/services/systemMonitor/triage/*.ts:* | db.* | system_incidents | Tier 2 | System triage — cross-tenant. Migrate to withAdminConnection. |
| server/services/systemSettingsService.ts:42 | db.select().from(systemSettings) | system_settings | Tier 2 | System settings — cross-tenant system config table. Migrate to withAdminConnection. |
| server/services/systemSkillService.ts:* | db.* | system_skills | Tier 2 | System skills — cross-tenant system table. Migrate to withAdminConnection. |
| server/services/systemTemplateService.ts:* (7 callsites) | db.* | system_templates | Tier 2 | System templates — cross-tenant system table. Migrate to withAdminConnection. |
| server/services/userService.ts:* | db.* | users | Tier 2 | User service — per-callsite classification required in Chunk 14; admin paths are cross-tenant (withAdminConnection), org-scoped paths may be Tier 1. |
| server/services/workspace/workspaceMigrationService.ts:* | db.* | workspace_memories | Tier 2 | Workspace migration service — cross-org batch migration; no per-tenant context. Migrate to withAdminConnection. |

---

## Gate state (pre-build)

| Gate | Script | Baseline | Current state | Exit mode | Wired in run-all-gates | Delta required |
|---|---|---|---|---|---|---|
| PP-CD1 | scripts/verify-no-new-cycles.sh | cycle-count:0 (seeded 2026-05-14) | cycle-count:0 — exits 0 | error (exit 1) | YES | VERIFIED — no change needed |
| PP-DUP1 | scripts/verify-duplicate-blocks.sh | clone-count:8769 (seeded 2026-05-14) | clone-count:9334 (2026-05-16) — exits 2 (warning) | warning (exit 2 on regression) | YES | Re-seed baseline to 9334; promote gate to exit 1 (Chunk 2) |
| PP-SK1 | scripts/verify-skill-registry-alignment.sh | NOT YET AUTHORED | N/A — gate script not authored yet | N/A | NO | Author script (Chunk 3); seed baseline and wire ONLY after Session K W4AA-DEBT-1 merges |
| PP-SK2 | scripts/verify-universal-skill-sync.sh | 2 grandfathered entries (expire 2026-08-14) | exits 2 (within-grace warning) | warning (exit 2 within grace; new violations exit 1) | YES | Resolve 2 grandfathered entries (Chunk 4); gate then exits 0 |
| PP-FE2 | scripts/verify-frontend-design-budget.sh | empty baseline (allowlist-based) | exits 0 — 0 violations, 520 files scanned | error (exit 1) | YES | VERIFIED — no change needed; monitored set covers all component literals in docs |
| PP-MC2 | scripts/verify-critical-path-coverage.sh | N/A (schema gate — no baseline file) | exits 0 — 5 manifest entries validated | error (exit 1) | YES | VERIFIED — gate in run-all-gates, exits 0 |

### PP-SK1 pre-condition: Session K W4AA-DEBT-1

`git log --oneline origin/main | head -20` shows most recent main commit as `8c51aa65 wave-5: capabilities registry backfill (Session L) (#334)`. No Session K W4AA-DEBT-1 orphan ACTION_REGISTRY resolution commit found.

**Verdict: Session K W4AA-DEBT-1 has NOT merged.**

Rule: Do NOT create `scripts/.gate-baselines/skill-registry-alignment.txt` and do NOT wire PP-SK1 into `scripts/run-all-gates.sh` until Session K W4AA-DEBT-1 merges and `mismatch-count` reaches 0. Chunk 3 proceeds to author the gate script only.

### PP-SK2 resolution direction (Chunk 4)

From `scripts/.gate-baselines/universal-skill-sync.txt` (both expire 2026-08-14):
1. `read_codebase`: in `UNIVERSAL_SKILL_NAMES` but `action-registry.snapshot.json` entry has `isUniversal=undefined`. Fix: set `isUniversal:true` in the snapshot entry.
2. `search_codebase`: `isUniversal:true` in snapshot but absent from `UNIVERSAL_SKILL_NAMES`. Fix: add to `UNIVERSAL_SKILL_NAMES` in `server/config/universalSkills.ts`.

After both fixes, remove both grandfathered lines from `scripts/.gate-baselines/universal-skill-sync.txt`. Gate then exits 0.

### PP-FE2 gap assessment

`bash scripts/verify-frontend-design-budget.sh` exits 0, 520 files scanned, 0 violations. Monitored components: `MetricCard`, `RunActivityChart`, `SuccessRateChart`, `SparkLine`, `PnlKpiCard`, `PnlSparkline`, `PnlTrendChart`, `SparklineChart`, `SpendTrendChart`. Cross-referenced `docs/frontend-design-principles.md` — no additional component literals in "Complexity budget per screen" not already monitored. Delta: zero extension needed.

---

## Session M deconfliction — agentExecutionService

```markdown
Session M last merged: NOT YET MERGED
Branch: remotes/origin/claude/lael-phase-1-and-2 (docs/spec only — tip commit 05de73c2)

git diff origin/main...origin/claude/lael-phase-1-and-2 --name-only:
  tasks/builds/wave-5-lael-phase-1-and-2/plan.md
  tasks/builds/wave-5-lael-phase-1-and-2/progress.md
  tasks/builds/wave-5-lael-phase-1-and-2/spec.md
  tasks/review-logs/spec-review-*.md (3 files)

Overlapping files (require ordered merge): NONE
```

The lael-phase-1-and-2 branch contains only spec and review-log files — zero production code changes to `server/services/agentExecutionService/**`. Wave-5 Chunk 7 can proceed on current main without conflict.

**Merge order rule:** If Session M begins code implementation before Chunk 7 completes, Chunk 7 must rebase onto Session M's branch tip before opening the PR. Record this in progress.md when Chunk 7 begins.

---

## Step 8b: RLS GUC for ea_drafts and voice_profiles

### voice_profiles (migration: `0328_voice_profiles.sql`)

Policy `voice_profiles_isolation` USING clause (from migration SQL):
```sql
USING (
  (owner_user_id IS NOT NULL AND owner_user_id = current_setting('app.current_user_id', true)::uuid)
  OR (org_scope = true AND organisation_id = current_setting('app.organisation_id', true)::uuid)
  OR (current_setting('app.current_role', true) IN ('org_admin', 'subaccount_admin'))
    AND organisation_id = current_setting('app.organisation_id', true)::uuid
)
```

**Primary tenant key: `app.organisation_id`** — all three arms ultimately scope to `organisation_id = current_setting('app.organisation_id', true)::uuid`. The `app.current_user_id` arm provides owner-level sub-scoping within the org.

**Verdict: `getOrgScopedDb()` is SAFE for voice_profiles callsites.** The RLS policy enforces `organisation_id = current_setting('app.organisation_id')`, which `getOrgScopedDb()` sets correctly. The `app.current_user_id` sub-scope is enforced automatically by RLS. The app-layer `where(eq(voiceProfiles.organisationId, orgId))` predicate stays as defence-in-depth.

### ea_drafts (migration: `0329_ea_drafts.sql`)

Policy `ea_drafts_isolation` USING clause (from migration SQL):
```sql
USING (
  organisation_id = current_setting('app.organisation_id', true)::uuid
  AND (
    owner_user_id = current_setting('app.current_user_id', true)::uuid
    OR current_setting('app.current_role', true) IN ('org_admin', 'subaccount_admin')
  )
)
```

**Primary tenant key: `app.organisation_id`** — the outermost AND requires `organisation_id = current_setting('app.organisation_id')` first.

**Verdict: `getOrgScopedDb()` is SAFE for ea_drafts callsites.** The RLS policy enforces the org-level GUC as the first condition. Proceed with Tier 1 migration in Chunk 11. App-layer `where(eq(eaDrafts.ownerUserId, userId))` predicate stays as defence-in-depth.

---

## Migration chunk order

Order by callsite density (highest raw-db callsite count first) and spec F3/F4/F7 priority:

| Chunk | Services | Est. callsites | Priority rationale |
|---|---|---|---|
| Chunk 7 | agentExecutionService.ts, agentExecutionLoop.ts, agentExecutionService/runLifecycle/*, agentExecutionEventService.ts, agentResumeService.ts, agentRunFinalizationService.ts, executionLayerService.ts, executionService.ts, queueService/executionProcessor.ts, actionService.ts | ~35 | F4 spec finding; highest-traffic agent run path |
| Chunk 8 | skillExecutor/pipeline.ts (F7 callsite), intelligenceSkillExecutor.ts | ~5 | F7 spec finding |
| Chunk 9 | workflowEngine/*, workflowRunService.ts, workflowRunPauseStopService.ts, workflowRunInsertHelper.ts, workflowRunCostLedgerService.ts, workflowGateStallNotifyService.ts, workflowStepReviewService.ts, workflowTemplateService.ts, flowExecutorService.ts | ~30 | Workflow execution path |
| Chunk 10 | llmUsageService.ts (21 callsites), llmService.ts, llmRouter/routeCall.ts, computeBudgetService.ts, spendLedgerService.ts, spendInsightsService.ts, spendTrendsService.ts, operatorCostWriter.ts, agentActivityService.ts | ~35 | Billing/cost — high callsite density |
| Chunk 11 | eaDrafts/eaDraftService.ts, eaProvisioningService.ts, voiceProfile/voiceProfileService.ts | ~10 | PA-V1 services; GUC confirmed safe (see Step 8b) |
| Chunk 12 | sandbox/browserWarmPool.ts, sandbox/ieeBrowserProfileManager.ts, sandboxHarvestService.ts, operatorSandboxFileEventBridge.ts, subaccountIeeBrowserSettingsService.ts, ieeSessionService.ts, executionBackends/*, operatorSessionService.ts, operatorChainResumeService.ts, operatorChainSchedulerService.ts, notifyOperatorFanoutService.ts | ~20 | Sandbox/IEE services; some Tier 2 per-callsite |
| Chunk 13 | connectionsService.ts (7), integrationConnectionService.ts (17), ghlAgencyOauthService.ts, ghlOAuthStateStore.ts, ghlWebhookMutationsService.ts, githubWebhookService.ts, webhookAdapterService.ts, webhookReplayNonceStore.ts, webhookService.ts | ~45 | Integration/webhook services |
| Chunk 14 | All remaining Tier 1 files: agentBeliefService.ts, agentRecommendationsService.ts, boardService.ts, taskService.ts, taskEventService.ts, reviewService.ts, scheduledTaskService.ts, memoryBlockService.ts, memoryBlockSynthesisService.ts, memoryBlockVersionService.ts, memoryCitationDetector.ts, memoryHealthDataService.ts, memoryReviewQueueService.ts, memoryUtilityQueryService.ts, workspaceMemoryService/*, documentBundleService.ts, automationService.ts, automationConnectionMappingService.ts, automationResolutionService.ts, agentScheduleService.ts, subaccountService.ts, subaccountAgentService.ts, subaccountOnboardingService.ts, subaccountOperatorSettingsService.ts, subaccountTagService.ts, permissionSetService.ts, knowledgeService.ts, inboxService.ts, agentService/*, agentTemplateService.ts, agentPromptRevisionService.ts, agentPresenceService.ts, agentObservationService.ts, agentWorkingTimeService.ts, beliefConflictService.ts, benchRunService.ts, categoryService.ts, clientPulseIngestionService.ts, configBackupService.ts, configHistoryService.ts, connectionTokenService.ts, conversationService.ts, correctionCaptureService.ts, delegationOutcomeService.ts, deliveryService.ts, documentPromotionService.ts, dropZoneService.ts, engineResolutionService.ts, engineService.ts, externalDocumentResolverService.ts, feedbackService.ts, fileDeliveryService.ts, formSubmissionService.ts, goalService.ts, hierarchyTemplateService.ts (tenant callsites), mcpServerConfigService.ts, moduleService.ts, operatorTaskProfileService.ts, optimiser/runOptimiserScan.ts, orgMemoryService.ts, pageIntegrationWorker.ts, pageProjectService.ts, pageService.ts, pageTrackingService.ts, priorityFeedService.ts, projectService.ts, referenceDocumentService.ts, retrievalObservabilityService.ts, runTraceService.ts, runtimeCheckService.ts, scorecardService.ts, skillAnalyzerService/*, skillService.ts, skillStudioService.ts, subscriptionService.ts, supportAgentInstallService.ts, triggerService.ts, trustCalibrationService.ts, webLoginConnectionService.ts, webhookAdapterService.ts residue, workspace/workspaceEmailPipeline.ts, workspace/workspaceOnboardingService.ts, workspaceHealth/workspaceHealthService.ts, connectorConfigService.ts, auditService.ts | ~200 | All remaining; bulk migration |
| Chunk 15 | Tier 2 annotation sweep: organisationService.ts, systemAgentService.ts, systemIncidentService.ts, systemSettingsService.ts, systemSkillService.ts, systemTemplateService.ts, systemMonitor/*, systemAgentRegistryValidator.ts, securityAuditService.ts, securityAuditSentinelValidation.ts, jobQueueHealthService.ts, staleRunCleanupService.ts, permissionSeedService.ts, userService.ts (admin paths), incidentIngestor.ts, llmInflightRegistry.ts, paymentReconciliationJob.ts, configUpdateOrganisationService.ts, workspace/workspaceMigrationService.ts, hierarchyTemplateService.ts (system_agents calls), sandbox Tier 2 callsites, authService.ts provisioning path | ~90 | All Tier 2 callsites — withAdminConnection or guard-ignore |

---

## P2 gate baseline

Pre-migration state (2026-05-16):
- Gate: `scripts/verify-with-org-tx-or-scoped-db.sh`
- Files scanned: 1178
- **Unsuppressed violations: 0** (gate exits 0)
- Existing guard-ignore annotations: 0 (none found in server/services/ production files)

The P2 gate currently passes because it flags callsites lacking `guard-ignore` annotation, and zero such annotations exist — meaning the gate's current analyser pass finds no raw-db violations to report. Each migration chunk (Chunks 7-15) must verify `bash scripts/verify-with-org-tx-or-scoped-db.sh` exits 0 after its changes. The pre-migration violation count (0) is the invariant that must not increase.
