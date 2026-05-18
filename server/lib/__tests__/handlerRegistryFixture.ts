import type { JobName } from '../../config/jobConfig.js';

type HandlerFn = (job: { id: string; data: unknown }) => Promise<void>;

export const HANDLER_REGISTRY: Record<JobName, { handler: HandlerFn | null; registrationSite: string }> = {
  // ── Tier 1: Agent execution ──────────────────────────────────────────
  'agent-scheduled-run': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:84',
  },
  'agent-org-scheduled-run': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:109',
  },
  'agent-handoff-run': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:124',
  },
  'agent-triggered-run': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:163',
  },
  'execution-run': {
    handler: null,
    registrationSite: 'server/services/queueService/backend.ts:23',
  },
  'workflow-resume': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:557',
  },

  // ── Tier 2: Financial / billing ──────────────────────────────────────
  'llm-aggregate-update': {
    handler: null,
    registrationSite: 'server/services/routerJobService.ts:212',
  },
  'llm-reconcile-reservations': {
    handler: null,
    registrationSite: 'server/services/routerJobService.ts:244',
  },
  'llm-monthly-invoices': {
    handler: null,
    registrationSite: 'server/services/routerJobService.ts:254',
  },
  'payment-reconciliation': {
    handler: null,
    registrationSite: 'server/services/paymentReconciliationJob.ts:277',
  },

  // ── Tier 3: Maintenance ───────────────────────────────────────────────
  'stale-run-cleanup': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:235',
  },
  'maintenance:cleanup-execution-files': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:21',
  },
  'maintenance:cleanup-budget-reservations': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:34',
  },
  'maintenance:memory-decay': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:47',
  },
  'clientpulse:propose-interventions': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:478',
  },
  'clientpulse:measure-outcomes': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:494',
  },
  'maintenance:security-events-cleanup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:60',
  },
  'agent-run-cleanup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:177',
  },
  'priority-feed-cleanup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:189',
  },
  'slack-inbound': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:748',
  },
  'regression-capture': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:514',
  },
  'regression-replay-tick': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:544',
  },
  'llm-clean-old-aggregates': {
    handler: null,
    registrationSite: 'server/services/routerJobService.ts:249',
  },
  'maintenance:memory-dedup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:215',
  },
  'agent-briefing-update': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:464',
  },
  'memory-context-enrichment': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:592',
  },
  'page-integration': {
    handler: null,
    registrationSite: 'server/services/pageIntegrationWorker.ts:152',
  },

  // ── Agentic Commerce ──────────────────────────────────────────────────
  'agent-spend-request': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:920',
  },
  'agent-spend-response': {
    // external_consumer — IEE worker consumes this queue; no main-app handler
    handler: null,
    registrationSite: 'external:iee-worker',
  },
  'agent-spend-completion': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:927',
  },

  // ── IEE queues (post worker retirement 2026-05-17) ────────────────────
  // The standalone iee-worker process was retired — see
  // tasks/builds/iee-worker-retirement/spec.md. iee-browser-task is now
  // consumed inside the e2b sandbox harness; iee-dev-task and
  // iee-cleanup-orphans have no live consumer (adapter fail-closes);
  // iee-cost-rollup-daily moved to a main-server handler.
  'iee-browser-task': {
    handler: null,
    registrationSite: 'external:e2b-iee-browser-sandbox',
  },
  'iee-dev-task': {
    handler: null,
    registrationSite: 'retired:iee-worker-retired-2026-05-17',
  },
  'iee-cleanup-orphans': {
    handler: null,
    registrationSite: 'retired:iee-worker-retired-2026-05-17',
  },
  'iee-cost-rollup-daily': {
    handler: null,
    registrationSite: 'server/index.ts:805',
  },
  'iee-run-completed': {
    handler: null,
    registrationSite: 'server/index.ts:795',
  },

  // ── Skill analyzer ────────────────────────────────────────────────────
  'skill-analyzer': {
    handler: null,
    registrationSite: 'server/index.ts:692',
  },

  // ── Workflow gates + engine ───────────────────────────────────────────
  'workflow-gate-stall-notify': {
    handler: null,
    registrationSite: 'server/index.ts:806',
  },
  'workflow-run-tick': {
    handler: null,
    registrationSite: 'server/services/workflowEngine/queueLifecycle/registerWorkers.ts:17',
  },
  'workflow-watchdog': {
    handler: null,
    registrationSite: 'server/services/workflowEngine/queueLifecycle/registerWorkers.ts:27',
  },
  'workflow-agent-step': {
    handler: null,
    registrationSite: 'server/services/workflowEngine/queueLifecycle/registerWorkers.ts:57',
  },
  // ── Canonical Data Platform ───────────────────────────────────────────
  'connector-polling-tick': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:848',
  },
  'connector-polling-sync': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:861',
  },

  // ── Workspace ─────────────────────────────────────────────────────────
  'seat-rollup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:712',
  },
  'workspace.migrate-identity': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:727',
  },

  // ── System monitoring ─────────────────────────────────────────────────
  'system-monitor-ingest': {
    handler: null,
    registrationSite: 'server/index.ts:652',
  },

  // ── Optimiser ─────────────────────────────────────────────────────────
  'optimiser-scan': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:223',
  },

  // ── GHL ───────────────────────────────────────────────────────────────
  'ghl:auto-start-onboarding': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:879',
  },

  // ── OAuth resume ──────────────────────────────────────────────────────
  'run:resumeAfterOAuth': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:906',
  },

  // ── Document pipeline ─────────────────────────────────────────────────
  'document:summarise': {
    handler: null,
    registrationSite: 'server/jobs/documentSummariseJob.ts:13',
  },
  'document:chunk-embed': {
    handler: null,
    registrationSite: 'server/jobs/documentChunkEmbedJob.ts:30',
  },
  'document:reembed': {
    handler: null,
    registrationSite: 'server/jobs/documentReembedJob.ts:28',
  },
  'document:promotion-finalise': {
    handler: null,
    registrationSite: 'server/jobs/documentPromotionFinaliseJob.ts:32',
  },

  // ── Support desk ──────────────────────────────────────────────────────
  'support-draft-reconciliation': {
    handler: null,
    registrationSite: 'server/jobs/supportDraftReconciliationWorker.ts:26',
  },
  'support-agent-run': {
    handler: null,
    registrationSite: 'server/jobs/supportAgentRunJob.ts:34',
  },
  'run-artifacts-retention-sweep': {
    handler: null,
    registrationSite: 'server/jobs/runArtifactsRetentionSweepJob.ts:35',
  },
  'support-eval-daily': {
    handler: null,
    registrationSite: 'server/jobs/supportEvalDailyJob.ts:23',
  },

  // ── Operator backend ──────────────────────────────────────────────────
  'operator-session-completed': {
    handler: null,
    registrationSite: 'server/jobs/operatorSessionCompletedHandler.ts:35',
  },
  'operator-session-dispatch-next-chain-link': {
    handler: null,
    registrationSite: 'server/jobs/operatorSessionDispatchNextChainLinkHandler.ts:67',
  },
  'operator-session-progressed': {
    handler: null,
    registrationSite: 'server/jobs/operatorSessionProgressedHandler.ts:58',
  },
  'operator-task-profile-gc': {
    handler: null,
    registrationSite: 'server/jobs/operatorTaskProfileGcHandler.ts:33',
  },
  'operator-session-refresh': {
    handler: null,
    registrationSite: 'server/index.ts:914',
  },

  // ── Sandbox isolation ─────────────────────────────────────────────────
  'sandbox-harvest-reconciliation': {
    handler: null,
    registrationSite: 'server/jobs/sandboxHarvestReconciliationJob.ts:293',
  },
  'sandbox-ceiling-monitor': {
    handler: null,
    registrationSite: 'server/jobs/sandboxCeilingMonitorJob.ts:412',
  },
  'sandbox-wall-clock-kill': {
    handler: null,
    registrationSite: 'server/jobs/sandboxWallClockKillJob.ts:174',
  },
  'sandbox-artefact-purge': {
    handler: null,
    registrationSite: 'server/jobs/sandboxArtefactPurgeJob.ts:141',
  },
  'sandbox-telemetry-prune': {
    handler: null,
    registrationSite: 'server/jobs/sandboxTelemetryPruneJob.ts:150',
  },
  'sandbox-logs-prune': {
    handler: null,
    registrationSite: 'server/jobs/sandboxLogsPruneJob.ts:157',
  },
  'sandbox-egress-audit-prune': {
    handler: null,
    registrationSite: 'server/jobs/sandboxEgressAuditPruneJob.ts:150',
  },

  // ── Drift-candidate queues (reconciled in Wave-4 MC7) ────────────────
  'maintenance:fast-path-decisions-prune': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:72',
  },
  'maintenance:rule-auto-deprecate': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:84',
  },
  'maintenance:fast-path-recalibrate': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:96',
  },
  'maintenance:llm-ledger-archive': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:111',
  },
  'maintenance:llm-started-row-sweep': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:128',
  },
  'maintenance:stale-analyzer-job-sweep': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:148',
  },
  'maintenance:llm-inflight-history-cleanup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:162',
  },
  'maintenance:memory-entry-decay': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:228',
  },
  'memory-hnsw-reindex': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:242',
  },
  'memory-blocks-embedding-backfill': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:255',
  },
  'maintenance:clarification-timeout-sweep': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:275',
  },
  'maintenance:blocked-run-expiry': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:290',
  },
  'maintenance:backend-reconciliation': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:319',
  },
  'maintenance:memory-entry-quality-adjust': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:332',
  },
  'maintenance:memory-block-synthesis': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:345',
  },
  'maintenance:bundle-utilization': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:360',
  },
  'maintenance:portfolio-briefing': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:373',
  },
  'maintenance:portfolio-digest': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:385',
  },
  'maintenance:protected-block-divergence': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:398',
  },
  'maintenance:iee-session-orphan-cleanup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:411',
  },
  'maintenance:iee-sessions-compact': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:421',
  },
  'maintenance:agent-observations-prune': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:431',
  },
  'maintenance:working-time-rollup-compact': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:441',
  },
  'maintenance:webhook-replay-nonce-prune': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:455',
  },
  'maintenance:execution-window-timeout': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:781',
  },
  'maintenance:approval-expiry': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:797',
  },
  'maintenance:stripe-agent-reconciliation-poll': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:814',
  },
  'maintenance:shadow-charge-retention': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:831',
  },
  'evaluate-all-pending-baselines': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:936',
  },
  'capture-baseline': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:950',
  },
  'scorecard:judge': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:963',
  },
  'scorecard:judge:forced': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:975',
  },
  'bench:execute': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:988',
  },
  'bench:regression-replay': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:1001',
  },
  'correction:pattern-detect': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:1014',
  },
  'system-monitor-self-check': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:685',
  },
  'subscription-trial-check': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:696',
  },
  'orchestrator-from-task': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:765',
  },
  'ghl:auto-enrol-locations-page': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts:892',
  },
  'maintenance:oauth-state-cleanup': {
    handler: null,
    registrationSite: 'server/lib/oauthStateCleanupJob.ts:43',
  },
  'maintenance:rate-limit-cleanup': {
    handler: null,
    registrationSite: 'server/lib/rateLimitCleanupJob.ts:72',
  },
  'refresh_optimiser_peer_medians': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:200',
  },
  'refresh_memory_utility_30d': {
    handler: null,
    registrationSite: 'server/services/agentScheduleService.ts:208',
  },
  'iee-browser:daily-cost-rollup': {
    handler: null,
    registrationSite: 'server/jobs/ieeBrowserDailyRollupJob.ts:151',
  },
  'workflow-drafts-cleanup': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts',
  },
  'failure:post-mortem': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts',
  },
  'agent-run-resume-from-waitpoint': {
    handler: null,
    registrationSite: 'server/services/queueService/maintenanceJobs/pgBossRegistrations.ts',
  },
} satisfies Record<JobName, { handler: HandlerFn | null; registrationSite: string }>;
