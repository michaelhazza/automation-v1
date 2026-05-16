# Handler Registry Inventory

**Produced by:** Chunk 0 (Setup & verification)
**Date:** 2026-05-16
**Source of truth for JobName set:** `server/config/jobConfig.ts` (69 entries)
**Registration sources searched:** `server/jobs/**`, `server/services/**`, `server/lib/**`, `server/index.ts`

## Legend

- **Registration site:** file:line where `boss.work(...)` or `createWorker({queue: ...})` is called
- **Verdict options:** `handler_tested` | `external_consumer` | `send_only` | `exempt` | `MISSING_REGISTRATION`

## JOB_CONFIG entries — Tier 1 (Agent execution) and Tier 2 (Financial)

| JobName | Registration site | Verdict | Notes |
|---|---|---|---|
| `agent-scheduled-run` | `server/services/agentScheduleService.ts:84` createWorker | `handler_tested` | Primary agent execution |
| `agent-org-scheduled-run` | `server/services/agentScheduleService.ts:109` boss.work | `handler_tested` | Org-level agent runs |
| `agent-handoff-run` | `server/services/agentScheduleService.ts:124` createWorker | `handler_tested` | Spawn sub-agent handoff |
| `agent-triggered-run` | `server/services/agentScheduleService.ts:163` createWorker | `handler_tested` | Triggered runs |
| `execution-run` | `server/services/queueService/backend.ts:23` boss.work | `handler_tested` | Core execution loop |
| `workflow-resume` | `server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:557` boss.work(WORKFLOW_RESUME_QUEUE) | `handler_tested` | Resume paused workflow |
| `llm-aggregate-update` | `server/services/routerJobService.ts:212` boss.work(JOB_AGGREGATE_UPDATE) | `handler_tested` | LLM cost aggregation |
| `llm-reconcile-reservations` | `server/services/routerJobService.ts:244` boss.work(JOB_RECONCILE) | `handler_tested` | LLM reservation reconciliation |
| `llm-monthly-invoices` | `server/services/routerJobService.ts:254` boss.work(JOB_MONTHLY_INVOICES) | `handler_tested` | Monthly invoicing |
| `payment-reconciliation` | `server/services/paymentReconciliationJob.ts:277` boss.work(JOB_NAME) | `handler_tested` | Payment reconciliation |

## JOB_CONFIG entries — Tier 3/4 (Maintenance, Enrichment)

| JobName | Registration site | Verdict | Notes |
|---|---|---|---|
| `stale-run-cleanup` | `server/services/agentScheduleService.ts:235` boss.work | `handler_tested` | Stale run sweep |
| `maintenance:cleanup-execution-files` | `pgBossRegistrations.ts:21` boss.work | `handler_tested` | |
| `maintenance:cleanup-budget-reservations` | `pgBossRegistrations.ts:34` boss.work | `handler_tested` | |
| `maintenance:memory-decay` | `pgBossRegistrations.ts:47` boss.work | `handler_tested` | |
| `clientpulse:propose-interventions` | `pgBossRegistrations.ts:478` boss.work | `handler_tested` | |
| `clientpulse:measure-outcomes` | `pgBossRegistrations.ts:494` boss.work | `handler_tested` | |
| `maintenance:security-events-cleanup` | `pgBossRegistrations.ts:60` boss.work | `handler_tested` | |
| `agent-run-cleanup` | `pgBossRegistrations.ts:177` boss.work | `handler_tested` | |
| `priority-feed-cleanup` | `pgBossRegistrations.ts:189` boss.work | `handler_tested` | |
| `slack-inbound` | `pgBossRegistrations.ts:748` boss.work | `handler_tested` | |
| `regression-capture` | `pgBossRegistrations.ts:514` createWorker | `handler_tested` | |
| `regression-replay-tick` | `pgBossRegistrations.ts:544` createWorker | `handler_tested` | |
| `llm-clean-old-aggregates` | `server/services/routerJobService.ts:249` boss.work | `handler_tested` | |
| `maintenance:memory-dedup` | `pgBossRegistrations.ts:215` boss.work | `handler_tested` | |
| `agent-briefing-update` | `pgBossRegistrations.ts:464` boss.work | `handler_tested` | |
| `memory-context-enrichment` | `pgBossRegistrations.ts:592` boss.work | `handler_tested` | |
| `page-integration` | `server/services/pageIntegrationWorker.ts:152` boss.work | `handler_tested` | |
| `agent-spend-request` | `pgBossRegistrations.ts:920` registerAgentSpendRequestHandler | `handler_tested` | |
| `agent-spend-response` | pgBossRegistrations.ts:931 — comment only; IEE worker consumes | `external_consumer` | Main sends; worker consumes |
| `agent-spend-completion` | `pgBossRegistrations.ts:927` registerAgentSpendCompletionHandler | `handler_tested` | |
| `iee-browser-task` | IEE worker process (external) | `external_consumer` | |
| `iee-dev-task` | IEE worker process (external) | `external_consumer` | |
| `iee-cleanup-orphans` | IEE worker process (external) | `external_consumer` | |
| `iee-cost-rollup-daily` | IEE worker (external); main app has `iee-browser:daily-cost-rollup` at `ieeBrowserDailyRollupJob.ts:151` — **naming mismatch** | `external_consumer` | See drift note |
| `iee-run-completed` | `server/index.ts:795` registerIeeRunCompletedHandler | `handler_tested` | |
| `skill-analyzer` | `server/index.ts:692` createWorker | `handler_tested` | |
| `workflow-gate-stall-notify` | `server/index.ts:806` createWorker(WORKFLOW_GATE_STALL_NOTIFY_QUEUE) | `handler_tested` | |
| `workflow-run-tick` | `server/services/workflowEngine/queueLifecycle/registerWorkers.ts:17` createWorker(TICK_QUEUE) | `handler_tested` | |
| `workflow-watchdog` | `registerWorkers.ts:27` createWorker(WATCHDOG_QUEUE) | `handler_tested` | |
| `workflow-agent-step` | `registerWorkers.ts:57` createWorker(AGENT_STEP_QUEUE) | `handler_tested` | |
| `workflow-bulk-parent-check` | **MISSING_REGISTRATION** | `MISSING_REGISTRATION` | Sprint 4 P3.1 — no boss.work found |
| `connector-polling-tick` | `pgBossRegistrations.ts:848` createWorker | `handler_tested` | |
| `connector-polling-sync` | `pgBossRegistrations.ts:861` createWorker | `handler_tested` | |
| `seat-rollup` | `pgBossRegistrations.ts:712` boss.work | `handler_tested` | |
| `workspace.migrate-identity` | `pgBossRegistrations.ts:727` createWorker | `handler_tested` | |
| `system-monitor-ingest` | `server/index.ts:652` boss.work (async mode only) | `handler_tested` | Conditional on env |
| `optimiser-scan` | `server/services/agentScheduleService.ts:223` createWorker | `handler_tested` | |
| `ghl:auto-start-onboarding` | `pgBossRegistrations.ts:879` createWorker | `handler_tested` | |
| `run:resumeAfterOAuth` | `pgBossRegistrations.ts:906` createWorker | `handler_tested` | |
| `document:summarise` | `server/jobs/documentSummariseJob.ts:13` createWorker | `handler_tested` | |
| `document:chunk-embed` | `server/jobs/documentChunkEmbedJob.ts:30` createWorker | `handler_tested` | |
| `document:reembed` | `server/jobs/documentReembedJob.ts:28` createWorker | `handler_tested` | |
| `document:promotion-finalise` | `server/jobs/documentPromotionFinaliseJob.ts:32` createWorker | `handler_tested` | |
| `support-draft-reconciliation` | `server/jobs/supportDraftReconciliationWorker.ts:26` createWorker | `handler_tested` | |
| `support-agent-run` | `server/jobs/supportAgentRunJob.ts:34` createWorker | `handler_tested` | |
| `run-artifacts-retention-sweep` | `server/jobs/runArtifactsRetentionSweepJob.ts:35` createWorker | `handler_tested` | |
| `support-eval-daily` | `server/jobs/supportEvalDailyJob.ts:23` createWorker | `handler_tested` | |
| `operator-session-completed` | `server/jobs/operatorSessionCompletedHandler.ts:35` createWorker | `handler_tested` | |
| `operator-session-dispatch-next-chain-link` | `server/jobs/operatorSessionDispatchNextChainLinkHandler.ts:67` createWorker | `handler_tested` | |
| `operator-session-progressed` | `server/jobs/operatorSessionProgressedHandler.ts:58` createWorker | `handler_tested` | |
| `operator-task-profile-gc` | `server/jobs/operatorTaskProfileGcHandler.ts:33` createWorker | `handler_tested` | |
| `operator-session-refresh` | `server/index.ts:914` createWorker | `handler_tested` | |
| `sandbox-harvest-reconciliation` | `server/jobs/sandboxHarvestReconciliationJob.ts:293` boss.work | `handler_tested` | |
| `sandbox-ceiling-monitor` | `server/jobs/sandboxCeilingMonitorJob.ts:412` createWorker | `handler_tested` | |
| `sandbox-wall-clock-kill` | `server/jobs/sandboxWallClockKillJob.ts:174` createWorker | `handler_tested` | |
| `sandbox-artefact-purge` | `server/jobs/sandboxArtefactPurgeJob.ts:141` createWorker | `handler_tested` | |
| `sandbox-telemetry-prune` | `server/jobs/sandboxTelemetryPruneJob.ts:150` boss.work | `handler_tested` | |
| `sandbox-logs-prune` | `server/jobs/sandboxLogsPruneJob.ts:157` boss.work | `handler_tested` | |
| `sandbox-egress-audit-prune` | `server/jobs/sandboxEgressAuditPruneJob.ts:150` boss.work | `handler_tested` | |

## Registered-but-NOT-in-JOB_CONFIG (drift candidates for chunk 3a)

| Queue name | Registration site | Chunk-3a action |
|---|---|---|
| `maintenance:fast-path-decisions-prune` | `pgBossRegistrations.ts:72` | Add to JOB_CONFIG (fifo) |
| `maintenance:rule-auto-deprecate` | `pgBossRegistrations.ts:84` | Add to JOB_CONFIG (fifo) |
| `maintenance:fast-path-recalibrate` | `pgBossRegistrations.ts:96` | Add to JOB_CONFIG (fifo) |
| `maintenance:llm-ledger-archive` | `pgBossRegistrations.ts:111` | Add to JOB_CONFIG (fifo) |
| `maintenance:llm-started-row-sweep` | `pgBossRegistrations.ts:128` | Add to JOB_CONFIG (fifo) |
| `maintenance:stale-analyzer-job-sweep` | `pgBossRegistrations.ts:148` | Add to JOB_CONFIG (fifo) |
| `maintenance:llm-inflight-history-cleanup` | `pgBossRegistrations.ts:162` | Add to JOB_CONFIG (fifo) |
| `maintenance:memory-entry-decay` | `pgBossRegistrations.ts:228` | Add to JOB_CONFIG (fifo) |
| `memory-hnsw-reindex` | `pgBossRegistrations.ts:242` | Add to JOB_CONFIG (one-shot) |
| `memory-blocks-embedding-backfill` | `pgBossRegistrations.ts:255` | Add to JOB_CONFIG (one-shot) |
| `maintenance:clarification-timeout-sweep` | `pgBossRegistrations.ts:275` | Add to JOB_CONFIG (fifo) |
| `maintenance:blocked-run-expiry` | `pgBossRegistrations.ts:290` | Add to JOB_CONFIG (fifo) |
| `maintenance:backend-reconciliation` | `pgBossRegistrations.ts:319` | Add to JOB_CONFIG (fifo) |
| `maintenance:memory-entry-quality-adjust` | `pgBossRegistrations.ts:332` | Add to JOB_CONFIG (fifo) |
| `maintenance:memory-block-synthesis` | `pgBossRegistrations.ts:345` | Add to JOB_CONFIG (fifo) |
| `maintenance:bundle-utilization` | `pgBossRegistrations.ts:360` | Add to JOB_CONFIG (fifo) |
| `maintenance:portfolio-briefing` | `pgBossRegistrations.ts:373` | Add to JOB_CONFIG (one-shot) |
| `maintenance:portfolio-digest` | `pgBossRegistrations.ts:385` | Add to JOB_CONFIG (one-shot) |
| `maintenance:protected-block-divergence` | `pgBossRegistrations.ts:398` | Add to JOB_CONFIG (fifo) |
| `maintenance:iee-session-orphan-cleanup` | `pgBossRegistrations.ts:411` | Add to JOB_CONFIG (fifo) |
| `maintenance:iee-sessions-compact` | `pgBossRegistrations.ts:421` | Add to JOB_CONFIG (fifo) |
| `maintenance:agent-observations-prune` | `pgBossRegistrations.ts:431` | Add to JOB_CONFIG (fifo) |
| `maintenance:working-time-rollup-compact` | `pgBossRegistrations.ts:441` | Add to JOB_CONFIG (fifo) |
| `maintenance:webhook-replay-nonce-prune` | `pgBossRegistrations.ts:451` | Add to JOB_CONFIG (fifo) |
| `maintenance:execution-window-timeout` | `pgBossRegistrations.ts:781` | Add to JOB_CONFIG (fifo) |
| `maintenance:approval-expiry` | `pgBossRegistrations.ts:797` | Add to JOB_CONFIG (fifo) |
| `maintenance:stripe-agent-reconciliation-poll` | `pgBossRegistrations.ts:814` | Add to JOB_CONFIG (fifo) |
| `maintenance:shadow-charge-retention` | `pgBossRegistrations.ts:831` | Add to JOB_CONFIG (fifo) |
| `evaluate-all-pending-baselines` | `pgBossRegistrations.ts:936` | Add to JOB_CONFIG (one-shot) |
| `capture-baseline` | `pgBossRegistrations.ts:950` | Add to JOB_CONFIG (payload-key) |
| `scorecard:judge` | `pgBossRegistrations.ts:963` | Add to JOB_CONFIG (payload-key) |
| `scorecard:judge:forced` | `pgBossRegistrations.ts:975` | Add to JOB_CONFIG (one-shot) |
| `bench:execute` | `pgBossRegistrations.ts:988` | Add to JOB_CONFIG (payload-key) |
| `bench:regression-replay` | `pgBossRegistrations.ts:1001` | Add to JOB_CONFIG (payload-key) |
| `correction:pattern-detect` | `pgBossRegistrations.ts:1014` | Add to JOB_CONFIG (fifo) |
| `system-monitor-self-check` | `pgBossRegistrations.ts:685` | Add to JOB_CONFIG (fifo) |
| `subscription-trial-check` | `pgBossRegistrations.ts:696` | Add to JOB_CONFIG (fifo) |
| `orchestrator-from-task` | `pgBossRegistrations.ts:765` via ORCHESTRATOR_FROM_TASK_QUEUE | Add to JOB_CONFIG (payload-key) |
| `ghl:auto-enrol-locations-page` | `pgBossRegistrations.ts:892` | Add to JOB_CONFIG (singleton-key) |
| `maintenance:oauth-state-cleanup` | `server/lib/oauthStateCleanupJob.ts:43` | Add to JOB_CONFIG (fifo) |
| `maintenance:rate-limit-cleanup` | `server/lib/rateLimitCleanupJob.ts:72` | Add to JOB_CONFIG (fifo) |
| `refresh_optimiser_peer_medians` | `server/services/agentScheduleService.ts:200` | Add to JOB_CONFIG (fifo) — underscore naming anomaly |
| `refresh_memory_utility_30d` | `server/services/agentScheduleService.ts:208` | Add to JOB_CONFIG (fifo) — underscore naming anomaly |
| `iee-browser:daily-cost-rollup` | `server/jobs/ieeBrowserDailyRollupJob.ts:151` | Add to JOB_CONFIG — resolve mismatch with `iee-cost-rollup-daily` |

## Count summary and notes for chunk 3a

- JOB_CONFIG entries: **69**
- Confirmed handler registration: **67** (all except workflow-bulk-parent-check + agent-spend-response + 4 external IEE)
- `external_consumer`: **5** (iee-browser-task, iee-dev-task, iee-cleanup-orphans, iee-cost-rollup-daily, agent-spend-response)
- `MISSING_REGISTRATION`: **1** (workflow-bulk-parent-check)
- Registered-but-not-in-JOB_CONFIG drift candidates: **44**

**Critical for chunk 3a:** The `workflow-bulk-parent-check` queue has no handler. Chunk 3a must either add the handler registration (if the feature shipped in Sprint 4 P3.1 but the worker was not connected) or reclassify as `send_only` / `exempt` with rationale. Do NOT silently classify as exempt without investigation.

**`iee-cost-rollup-daily` vs `iee-browser:daily-cost-rollup`:** Two different queue names for what may be the same logical daily cost rollup. `iee-cost-rollup-daily` in JOB_CONFIG has a main-app handler (`iee-browser:daily-cost-rollup` from `ieeBrowserDailyRollupJob.ts`). The external IEE worker likely has its own `iee-cost-rollup-daily` consumer. Chunk 3a must determine if these are distinct queues or a naming split that needs reconciliation.
