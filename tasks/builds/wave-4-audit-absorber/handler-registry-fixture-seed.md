# Handler Registry Fixture Seed

**Produced by:** Chunk 0 (Setup & verification)
**Date:** 2026-05-16
**Consumer:** Chunk 3b — TypeScript fixture file `server/lib/__tests__/handlerRegistryFixture.ts`

## Format

Each row: `JobName | handler import path | registrationSite | proposed verdict | rationale`

Verdicts: `handler_tested` | `external_consumer` | `send_only` | `exempt`

Note: This seed covers the 69 JOB_CONFIG entries. Chunk 3a will add the 44 drift candidates after reconciling them into JOB_CONFIG. Chunk 3b's fixture will include the full post-3a set.

## JOB_CONFIG fixture rows (chunk 3b seed)

| JobName | Handler import path | Registration site | Proposed verdict | Rationale |
|---|---|---|---|---|
| `agent-scheduled-run` | `../services/agentScheduleService.js` | `agentScheduleService.ts:84` | `handler_tested` | Primary agent execution; createWorker path |
| `agent-org-scheduled-run` | `../services/agentScheduleService.js` | `agentScheduleService.ts:109` | `handler_tested` | Org agent runs; boss.work path |
| `agent-handoff-run` | `../services/agentScheduleService.js` | `agentScheduleService.ts:124` | `handler_tested` | Handoff runs; createWorker path |
| `agent-triggered-run` | `../services/agentScheduleService.js` | `agentScheduleService.ts:163` | `handler_tested` | Triggered runs; createWorker path |
| `execution-run` | `../services/queueService/backend.js` | `queueService/backend.ts:23` | `handler_tested` | Core execution loop |
| `workflow-resume` | `../services/queueService/maintenanceJobs/pgBossRegistrations.js` | `pgBossRegistrations.ts:557` | `handler_tested` | Resumes paused workflows |
| `llm-aggregate-update` | `../services/routerJobService.js` | `routerJobService.ts:212` | `handler_tested` | LLM cost aggregation |
| `llm-reconcile-reservations` | `../services/routerJobService.js` | `routerJobService.ts:244` | `handler_tested` | LLM reservation reconciliation |
| `llm-monthly-invoices` | `../services/routerJobService.js` | `routerJobService.ts:254` | `handler_tested` | Monthly invoicing |
| `payment-reconciliation` | `../services/paymentReconciliationJob.js` | `paymentReconciliationJob.ts:277` | `handler_tested` | Payment reconciliation |
| `stale-run-cleanup` | `../services/agentScheduleService.js` | `agentScheduleService.ts:235` | `handler_tested` | Stale run sweep |
| `maintenance:cleanup-execution-files` | `../services/queueService/maintenanceJobs/pgBossRegistrations.js` | `pgBossRegistrations.ts:21` | `handler_tested` | Execution file cleanup |
| `maintenance:cleanup-budget-reservations` | `../services/queueService/maintenanceJobs/pgBossRegistrations.js` | `pgBossRegistrations.ts:34` | `handler_tested` | Budget reservation cleanup |
| `maintenance:memory-decay` | `../jobs/memoryDecayJob.js` | `pgBossRegistrations.ts:47` | `handler_tested` | Memory decay sweep |
| `clientpulse:propose-interventions` | `../jobs/proposeClientPulseInterventionsJob.js` | `pgBossRegistrations.ts:478` | `handler_tested` | ClientPulse proposer |
| `clientpulse:measure-outcomes` | `../jobs/measureInterventionOutcomeJob.js` | `pgBossRegistrations.ts:494` | `handler_tested` | ClientPulse outcome measurement |
| `maintenance:security-events-cleanup` | `../jobs/securityEventsCleanupJob.js` | `pgBossRegistrations.ts:60` | `handler_tested` | Security event retention |
| `agent-run-cleanup` | `../jobs/agentRunCleanupJob.js` | `pgBossRegistrations.ts:177` | `handler_tested` | Agent run retention |
| `priority-feed-cleanup` | `../jobs/priorityFeedCleanupJob.js` | `pgBossRegistrations.ts:189` | `handler_tested` | Priority feed cleanup |
| `slack-inbound` | `../jobs/slackInboundJob.js` | `pgBossRegistrations.ts:748` | `handler_tested` | Slack inbound processing |
| `regression-capture` | `../services/regressionCaptureService.js` | `pgBossRegistrations.ts:514` | `handler_tested` | Regression capture |
| `regression-replay-tick` | `../jobs/regressionReplayJob.js` | `pgBossRegistrations.ts:544` | `handler_tested` | Regression replay |
| `llm-clean-old-aggregates` | `../services/routerJobService.js` | `routerJobService.ts:249` | `handler_tested` | Old aggregate cleanup |
| `maintenance:memory-dedup` | `../jobs/memoryDedupJob.js` | `pgBossRegistrations.ts:215` | `handler_tested` | Memory deduplication |
| `agent-briefing-update` | `../jobs/agentBriefingJob.js` | `pgBossRegistrations.ts:464` | `handler_tested` | Agent briefing update |
| `memory-context-enrichment` | `../services/workspaceMemoryService.js` | `pgBossRegistrations.ts:592` | `handler_tested` | Memory context enrichment |
| `page-integration` | `../services/pageIntegrationWorker.js` | `pageIntegrationWorker.ts:152` | `handler_tested` | Page integration |
| `agent-spend-request` | `../jobs/agentSpendRequestHandler.js` | `pgBossRegistrations.ts:920` | `handler_tested` | Agentic commerce spend request |
| `agent-spend-response` | `[external IEE worker]` | pgBossRegistrations.ts:931 (comment) | `external_consumer` | Main app sends; IEE worker consumes |
| `agent-spend-completion` | `../jobs/agentSpendCompletionHandler.js` | `pgBossRegistrations.ts:927` | `handler_tested` | Spend completion |
| `iee-browser-task` | `[external IEE worker]` | IEE worker process | `external_consumer` | Browser task execution |
| `iee-dev-task` | `[external IEE worker]` | IEE worker process | `external_consumer` | Dev task execution |
| `iee-cleanup-orphans` | `[external IEE worker]` | IEE worker process | `external_consumer` | IEE orphan cleanup |
| `iee-cost-rollup-daily` | `[external IEE worker]` | IEE worker process | `external_consumer` | IEE cost rollup (see naming drift note) |
| `iee-run-completed` | `../jobs/ieeRunCompletedHandler.js` | `server/index.ts:795` | `handler_tested` | IEE completion event |

| JobName | Handler import path | Registration site | Proposed verdict | Rationale |
|---|---|---|---|---|
| `skill-analyzer` | `../jobs/skillAnalyzerJobWithIncidentEmission.js` | `server/index.ts:692` | `handler_tested` | Skill analyzer |
| `workflow-gate-stall-notify` | `../jobs/workflowGateStallNotifyJob.js` | `server/index.ts:806` | `handler_tested` | Gate stall notification |
| `workflow-run-tick` | `../services/workflowEngine/queueLifecycle/tick.js` | `registerWorkers.ts:17` | `handler_tested` | Workflow engine tick |
| `workflow-watchdog` | `../services/workflowEngine/queueLifecycle/watchdog.js` | `registerWorkers.ts:27` | `handler_tested` | Workflow engine watchdog |
| `workflow-agent-step` | `../services/agentExecutionService.js` | `registerWorkers.ts:57` | `handler_tested` | Workflow agent step execution |
| `workflow-bulk-parent-check` | `[UNKNOWN — no boss.work found]` | MISSING | `MISSING_REGISTRATION` | Sprint 4 P3.1 — chunk 3a must investigate |
| `connector-polling-tick` | `../jobs/connectorPollingTick.js` | `pgBossRegistrations.ts:848` | `handler_tested` | Connector polling tick |
| `connector-polling-sync` | `../jobs/connectorPollingSync.js` | `pgBossRegistrations.ts:861` | `handler_tested` | Per-connection sync |
| `seat-rollup` | `../jobs/seatRollupJob.js` | `pgBossRegistrations.ts:712` | `handler_tested` | Workspace seat rollup |
| `workspace.migrate-identity` | `../services/workspace/workspaceMigrationService.js` | `pgBossRegistrations.ts:727` | `handler_tested` | Identity migration |
| `system-monitor-ingest` | `../services/incidentIngestorAsyncWorker.js` | `server/index.ts:652` | `handler_tested` | System monitor ingest (async path) |
| `optimiser-scan` | `../jobs/runOptimiserScanJob.js` | `agentScheduleService.ts:223` | `handler_tested` | Optimiser scan |
| `ghl:auto-start-onboarding` | `../jobs/ghlAutoStartOnboardingJob.js` | `pgBossRegistrations.ts:879` | `handler_tested` | GHL onboarding |
| `run:resumeAfterOAuth` | `../jobs/resumeRunAfterOAuthJob.js` | `pgBossRegistrations.ts:906` | `handler_tested` | OAuth resume |
| `document:summarise` | `../jobs/documentSummariseJob.js` | `documentSummariseJob.ts:13` | `handler_tested` | Document summarisation |
| `document:chunk-embed` | `../jobs/documentChunkEmbedJob.js` | `documentChunkEmbedJob.ts:30` | `handler_tested` | Document chunk embedding |
| `document:reembed` | `../jobs/documentReembedJob.js` | `documentReembedJob.ts:28` | `handler_tested` | Document re-embedding |
| `document:promotion-finalise` | `../jobs/documentPromotionFinaliseJob.js` | `documentPromotionFinaliseJob.ts:32` | `handler_tested` | Document promotion finalise |
| `support-draft-reconciliation` | `../jobs/supportDraftReconciliationWorker.js` | `supportDraftReconciliationWorker.ts:26` | `handler_tested` | Support draft reconciliation |
| `support-agent-run` | `../jobs/supportAgentRunJob.js` | `supportAgentRunJob.ts:34` | `handler_tested` | Support agent run |
| `run-artifacts-retention-sweep` | `../jobs/runArtifactsRetentionSweepJob.js` | `runArtifactsRetentionSweepJob.ts:35` | `handler_tested` | Run artifacts retention |
| `support-eval-daily` | `../jobs/supportEvalDailyJob.js` | `supportEvalDailyJob.ts:23` | `handler_tested` | Support eval daily |
| `operator-session-completed` | `../jobs/operatorSessionCompletedHandler.js` | `operatorSessionCompletedHandler.ts:35` | `handler_tested` | Operator session terminal event |
| `operator-session-dispatch-next-chain-link` | `../jobs/operatorSessionDispatchNextChainLinkHandler.js` | `operatorSessionDispatchNextChainLinkHandler.ts:67` | `handler_tested` | Operator chain dispatch |
| `operator-session-progressed` | `../jobs/operatorSessionProgressedHandler.js` | `operatorSessionProgressedHandler.ts:58` | `handler_tested` | Operator session progress |
| `operator-task-profile-gc` | `../jobs/operatorTaskProfileGcHandler.js` | `operatorTaskProfileGcHandler.ts:33` | `handler_tested` | Operator task GC |
| `operator-session-refresh` | `../services/executionBackends/operatorManagedBackend.js` | `server/index.ts:914` | `handler_tested` | Token refresh |
| `sandbox-harvest-reconciliation` | `../jobs/sandboxHarvestReconciliationJob.js` | `sandboxHarvestReconciliationJob.ts:293` | `handler_tested` | Sandbox reconciliation |
| `sandbox-ceiling-monitor` | `../jobs/sandboxCeilingMonitorJob.js` | `sandboxCeilingMonitorJob.ts:412` | `handler_tested` | Sandbox ceiling monitor |
| `sandbox-wall-clock-kill` | `../jobs/sandboxWallClockKillJob.js` | `sandboxWallClockKillJob.ts:174` | `handler_tested` | Sandbox wall-clock kill |
| `sandbox-artefact-purge` | `../jobs/sandboxArtefactPurgeJob.js` | `sandboxArtefactPurgeJob.ts:141` | `handler_tested` | Sandbox artefact purge |
| `sandbox-telemetry-prune` | `../jobs/sandboxTelemetryPruneJob.js` | `sandboxTelemetryPruneJob.ts:150` | `handler_tested` | Sandbox telemetry prune |
| `sandbox-logs-prune` | `../jobs/sandboxLogsPruneJob.js` | `sandboxLogsPruneJob.ts:157` | `handler_tested` | Sandbox logs prune |
| `sandbox-egress-audit-prune` | `../jobs/sandboxEgressAuditPruneJob.js` | `sandboxEgressAuditPruneJob.ts:150` | `handler_tested` | Sandbox egress audit prune |

## Notes for chunk 3b

The TypeScript fixture at `server/lib/__tests__/handlerRegistryFixture.ts` derives from this seed. Chunk 3a will expand JOB_CONFIG with the 44 drift candidates; after chunk 3a lands, chunk 3b must add those 44 entries to the fixture as well.

For `workflow-bulk-parent-check` (MISSING_REGISTRATION): chunk 3a must resolve before chunk 3b can assign a handler import path. If the handler does not exist, the fixture entry uses `verdict: 'exempt'` with rationale `'handler not yet implemented'`.
