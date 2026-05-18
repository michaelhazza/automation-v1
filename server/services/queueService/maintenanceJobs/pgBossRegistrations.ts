import { env } from '../../../lib/env.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from '../../../lib/jobErrors.js';
import { logger } from '../../../lib/logger.js';
import {
  SANDBOX_HARVEST_RECONCILIATION_JOB,
  SANDBOX_TELEMETRY_PRUNE_JOB,
  SANDBOX_LOGS_PRUNE_JOB,
  SANDBOX_EGRESS_AUDIT_PRUNE_JOB,
} from '../../../lib/sandboxJobNames.js';
import { WORKFLOW_RESUME_QUEUE } from '../types.js';

export async function registerAllPgBossWorkers(
  boss: any,
  queueService: {
    cleanupExpiredExecutionFiles(): Promise<unknown>;
    cleanupExpiredComputeReservations(): Promise<unknown>;
  },
  _withAdvisoryLock: unknown,
): Promise<void> {
      // pg-boss deduplicates across instances natively — no advisory lock needed
      await (boss as any).work('maintenance:cleanup-execution-files', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          await withTimeout(
            queueService.cleanupExpiredExecutionFiles().then(() => undefined),
            270_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:cleanup-execution-files', jobId: job.id });
          }
          throw err;
        }
      });
      await (boss as any).work('maintenance:cleanup-budget-reservations', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          await withTimeout(
            queueService.cleanupExpiredComputeReservations().then(() => undefined),
            90_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:cleanup-budget-reservations', jobId: job.id });
          }
          throw err;
        }
      });
      await (boss as any).work('maintenance:memory-decay', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryDecay } = await import('../../../jobs/memoryDecayJob.js');
          await withTimeout(runMemoryDecay(), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-decay', jobId: job.id });
          }
          throw err;
        }
      });
      // Sprint 2 P1.1 Layer 3 — tool_call_security_events retention pruner.
      // Admin-bypass sweep that opens its own tx via withAdminConnection.
      await (boss as any).work('maintenance:security-events-cleanup', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runSecurityEventsCleanup } = await import('../../../jobs/securityEventsCleanupJob.js');
          await withTimeout(runSecurityEventsCleanup().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:security-events-cleanup', jobId: job.id });
          }
          throw err;
        }
      });
      // Universal Brief Phase 3 — fast_path_decisions 90-day retention pruner.
      await (boss as any).work('maintenance:fast-path-decisions-prune', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { pruneFastPathDecisions } = await import('../../../jobs/fastPathDecisionsPruneJob.js');
          await withTimeout(pruneFastPathDecisions().then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:fast-path-decisions-prune', jobId: job.id });
          }
          throw err;
        }
      });
      // Universal Brief Phase 6 — nightly rule quality decay + auto-deprecation.
      await (boss as any).work('maintenance:rule-auto-deprecate', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runRuleAutoDeprecate } = await import('../../../jobs/ruleAutoDeprecateJob.js');
          await withTimeout(runRuleAutoDeprecate().then(() => undefined), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:rule-auto-deprecate', jobId: job.id });
          }
          throw err;
        }
      });
      // Universal Brief Phase 3 — nightly recalibration log for classifier drift detection.
      await (boss as any).work('maintenance:fast-path-recalibrate', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runFastPathRecalibrate } = await import('../../../jobs/fastPathRecalibrateJob.js');
          await withTimeout(runFastPathRecalibrate().then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:fast-path-recalibrate', jobId: job.id });
          }
          throw err;
        }
      });
      // LLM observability spec §12 — nightly llm_requests retention sweep.
      // Moves rows older than env.LLM_LEDGER_RETENTION_MONTHS (default 12)
      // to llm_requests_archive in 10k-row chunks. Bounded transaction size;
      // FOR UPDATE SKIP LOCKED makes concurrent runs safe.
      await (boss as any).work('maintenance:llm-ledger-archive', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { archiveOldLedgerRows } = await import('../../../jobs/llmLedgerArchiveJob.js');
          await withTimeout(archiveOldLedgerRows().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:llm-ledger-archive', jobId: job.id });
          }
          throw err;
        }
      });

      // Deferred-items brief §1 — reap aged-out provisional `'started'` rows
      // so a crashed mid-write doesn't permanently block retries under the
      // same idempotencyKey. Cadence: every 2 minutes. Telescopes with the
      // in-memory registry sweep (30s past timeoutMs) — this is the
      // durable-layer backstop (providerTimeoutMs + 60s).
      await (boss as any).work('maintenance:llm-started-row-sweep', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { sweepExpiredStartedRows } = await import('../../../jobs/llmStartedRowSweepJob.js');
          await withTimeout(sweepExpiredStartedRows().then(() => undefined), 110_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:llm-started-row-sweep', jobId: job.id });
          }
          throw err;
        }
      });

      // Skill-analyzer resilience — reap mid-flight skill_analyzer_jobs
      // rows that have stalled (no `updated_at` progress for 15 min). On a
      // worker crash mid-run the DB row stays in `classifying` and the
      // pg-boss job stays `active` for `expireInSeconds` (4 hours). This
      // sweep marks the DB row failed + expires the pg-boss ghost so the
      // built-in retryLimit/retryDelay can pick the job up under the v5
      // resume-seeding contract. See KNOWLEDGE.md (2026-04-24) for the
      // failure mode this codifies.
      await (boss as any).work('maintenance:stale-analyzer-job-sweep', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { sweepStaleAnalyzerJobs } = await import('../../../jobs/staleAnalyzerJobSweepJob.js');
          await withTimeout(sweepStaleAnalyzerJobs().then(() => undefined), 110_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:stale-analyzer-job-sweep', jobId: job.id });
          }
          throw err;
        }
      });

      // Deferred-items brief §6 — purge llm_inflight_history rows older
      // than env.LLM_INFLIGHT_HISTORY_RETENTION_DAYS (default 7).
      await (boss as any).work('maintenance:llm-inflight-history-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { cleanOldInflightHistoryRows } = await import('../../../jobs/llmInflightHistoryCleanupJob.js');
          await withTimeout(cleanOldInflightHistoryRows().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:llm-inflight-history-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      // Sprint 3 P2.1 Sprint 3A — agent_runs retention pruner. Admin-bypass
      // sweep that opens its own tx via withAdminConnection. Cascade on
      // agent_run_snapshots + agent_run_messages removes child rows.
      await (boss as any).work('agent-run-cleanup', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runAgentRunCleanupTick } = await import('../../../jobs/agentRunCleanupJob.js');
          await withTimeout(runAgentRunCleanupTick().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'agent-run-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      await (boss as any).work('priority-feed-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runPriorityFeedCleanup } = await import('../../../jobs/priorityFeedCleanupJob.js');
          await withTimeout(runPriorityFeedCleanup().then(() => undefined), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'priority-feed-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      // Workflows V1 — daily purge of unconsumed workflow_drafts older than 7 days.
      await (boss as any).work('workflow-drafts-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runWorkflowDraftsCleanup } = await import('../../../jobs/workflowDraftsCleanupJob.js');
          await withTimeout(runWorkflowDraftsCleanup().then(() => undefined), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'workflow-drafts-cleanup', jobId: job.id });
          }
          throw err;
        }
      });

      // Agent Intelligence Phase 2B — memory dedup daily sweep
      await (boss as any).work('maintenance:memory-dedup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryDedup } = await import('../../../jobs/memoryDedupJob.js');
          await withTimeout(runMemoryDedup(), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-dedup', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 1 — nightly memory entry quality decay + prune (S1)
      await (boss as any).work('maintenance:memory-entry-decay', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryEntryDecay } = await import('../../../jobs/memoryEntryDecayJob.js');
          const queueSend = (queue: string, data: object) => boss.send(queue, data);
          await withTimeout(runMemoryEntryDecay(queueSend).then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-entry-decay', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 1 — one-shot HNSW reindex after large prune (S1)
      await (boss as any).work('memory-hnsw-reindex', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryHnswReindex } = await import('../../../jobs/memoryHnswReindexJob.js');
          await withTimeout(runMemoryHnswReindex(job.data), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'memory-hnsw-reindex', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 2 — one-shot memory-blocks embedding backfill (S6)
      await (boss as any).work('memory-blocks-embedding-backfill', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryBlocksEmbeddingBackfill } = await import('../../../jobs/memoryBlocksEmbeddingBackfillJob.js');
          await withTimeout(runMemoryBlocksEmbeddingBackfill(), 600_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'memory-blocks-embedding-backfill', jobId: job.id });
          }
          throw err;
        }
      });
      // Enqueue the backfill exactly once. singletonKey prevents re-enqueue on
      // server restart if the job is still pending or already completed.
      await (boss as any).send('memory-blocks-embedding-backfill', {}, {
        singletonKey: 'memory-blocks-embedding-backfill-v1',
        retryLimit: 2,
        retryDelay: 60,
      });

      // Memory & Briefings Phase 2 — clarification timeout sweep (S8)
      await (boss as any).work('maintenance:clarification-timeout-sweep', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runClarificationTimeoutSweep } = await import('../../../jobs/clarificationTimeoutJob.js');
          await withTimeout(runClarificationTimeoutSweep(), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:clarification-timeout-sweep', jobId: job.id });
          }
          throw err;
        }
      });

      // Chunk E — integration block expiry sweep (every 5 minutes).
      // Cancels agent_runs whose blocked_expires_at has passed without the
      // user connecting the required integration.
      await (boss as any).work('maintenance:blocked-run-expiry', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runFn } = await import('../../../jobs/blockedRunExpiryJob.js');
          await withTimeout(runFn().then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:blocked-run-expiry', jobId: job.id });
          }
          throw err;
        }
      });

      // ExecutionBackend reconciliation — generic main-app sweep for stuck
      // delegated runs across every registered delegated adapter.
      //
      // Originally `maintenance:iee-main-app-reconciliation` (IEE-only,
      // wired to the legacy alias). Renamed in Chunk 5 of the
      // ExecutionBackend Adapter Contract refactor to
      // `maintenance:backend-reconciliation` and re-pointed at
      // `reconcileBackends()`, which walks every delegated adapter via
      // the registry. The IEE adapters are still the only delegated
      // backends in V1, so the runtime behaviour is unchanged.
      //
      // See docs/iee-delegation-lifecycle-spec.md Step 4 for the
      // pre-rename context. Class 1 (unemitted events) and Class 3
      // (worker death) are handled by the worker's cleanup-orphans
      // sweep; this sweep catches Class 2 — a parent agent_run stuck in
      // 'delegated' while the canonical backend row is already terminal
      // (event handler crashed post-DB-write, or DLQ exhaustion).
      await (boss as any).work('maintenance:backend-reconciliation', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { reconcileBackends } = await import('../../agentRunFinalizationService.js');
          await withTimeout(reconcileBackends().then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:backend-reconciliation', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 2 — weekly quality-adjust job (S4, feature-flagged)
      await (boss as any).work('maintenance:memory-entry-quality-adjust', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryEntryQualityAdjust } = await import('../../../jobs/memoryEntryQualityAdjustJob.js');
          await withTimeout(runMemoryEntryQualityAdjust().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-entry-quality-adjust', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 4 — weekly memory-block synthesis (S11)
      await (boss as any).work('maintenance:memory-block-synthesis', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMemoryBlockSynthesisSweep } = await import('../../../jobs/memoryBlockSynthesisJob.js');
          await withTimeout(runMemoryBlockSynthesisSweep().then(() => undefined), 900_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:memory-block-synthesis', jobId: job.id });
          }
          throw err;
        }
      });

      // Cached Context Infrastructure Phase 2 — bundle utilization metric computation.
      // Worker registered here; schedule NOT enabled until Phase 6 (pilot validation).
      // To trigger manually: boss.send('maintenance:bundle-utilization', {})
      await (boss as any).work('maintenance:bundle-utilization', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runBundleUtilization } = await import('../../../jobs/bundleUtilizationJob.js');
          await withTimeout(runBundleUtilization(), 300_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:bundle-utilization', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 4 — portfolio briefing + digest rollups (S23)
      await (boss as any).work('maintenance:portfolio-briefing', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runPortfolioRollupSweep } = await import('../../../jobs/portfolioRollupJob.js');
          await withTimeout(runPortfolioRollupSweep({ kind: 'briefing' }).then(() => undefined), 900_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:portfolio-briefing', jobId: job.id });
          }
          throw err;
        }
      });

      await (boss as any).work('maintenance:portfolio-digest', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runPortfolioRollupSweep } = await import('../../../jobs/portfolioRollupJob.js');
          await withTimeout(runPortfolioRollupSweep({ kind: 'digest' }).then(() => undefined), 900_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:portfolio-digest', jobId: job.id });
          }
          throw err;
        }
      });

      // Memory & Briefings Phase 5 — daily protected-block divergence sweep (S24)
      await (boss as any).work('maintenance:protected-block-divergence', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runDivergenceSweep } = await import('../../protectedBlockDivergenceService.js');
          await withTimeout(runDivergenceSweep().then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:protected-block-divergence', jobId: job.id });
          }
          throw err;
        }
      });

      // Agent Workspace Chunk 11 — IEE session orphan cleanup (every 5 min)
      await (boss as any).work('maintenance:iee-session-orphan-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runIeeSessionOrphanCleanup } = await import('../../../jobs/ieeSessionOrphanCleanup.js');
          await withTimeout(runIeeSessionOrphanCleanup().then(() => undefined), 120_000);
        } catch (err) {
          logger.error('job_timeout', { queue: 'maintenance:iee-session-orphan-cleanup', jobId: job.id });
        }
      });

      // Agent Workspace Chunk 11 — IEE sessions summary compaction (5am daily)
      await (boss as any).work('maintenance:iee-sessions-compact', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runIeeSessionsCompact } = await import('../../../jobs/ieeSessionsCompactJob.js');
          await withTimeout(runIeeSessionsCompact().then(() => undefined), 120_000);
        } catch (err) {
          logger.error('job_timeout', { queue: 'maintenance:iee-sessions-compact', jobId: job.id });
        }
      });

      // Agent Workspace Chunk 11 — agent_observations retention prune (5:30am daily)
      await (boss as any).work('maintenance:agent-observations-prune', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runAgentObservationsPrune } = await import('../../../jobs/agentObservationsPruneJob.js');
          await withTimeout(runAgentObservationsPrune().then(() => undefined), 300_000);
        } catch (err) {
          logger.error('job_timeout', { queue: 'maintenance:agent-observations-prune', jobId: job.id });
        }
      });

      // Agent Workspace Chunk 11 — working-time rollup compaction (6am 1st of month)
      await (boss as any).work('maintenance:working-time-rollup-compact', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runWorkingTimeRollupCompact } = await import('../../../jobs/workingTimeRollupCompactJob.js');
          await withTimeout(runWorkingTimeRollupCompact().then(() => undefined), 600_000);
        } catch (err) {
          logger.error('job_timeout', { queue: 'maintenance:working-time-rollup-compact', jobId: job.id });
        }
      });

      // Pre-Test Hardening W3 — webhook_replay_nonces TTL prune (hourly).
      // Timeout raised to 120s on Wave 5 Session K (F-3): the job migrated to
      // the definePruneJob factory which iterates per organisation rather than
      // issuing one cross-org DELETE. Mirrors the timeout used by the other
      // per-org prune jobs (pruneFastPathDecisions at line 75).
      await (boss as any).work('maintenance:webhook-replay-nonce-prune', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runWebhookReplayNoncePrune } = await import('../../../jobs/webhookReplayNoncePruneJob.js');
          await withTimeout(runWebhookReplayNoncePrune().then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:webhook-replay-nonce-prune', jobId: job.id });
          }
          throw err;
        }
      });

      // Agent Intelligence Phase 2D — agent briefing update (event-driven)
      await (boss as any).work('agent-briefing-update', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runAgentBriefingUpdate } = await import('../../../jobs/agentBriefingJob.js');
          await withTimeout(runAgentBriefingUpdate(job.data), 110_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'agent-briefing-update', jobId: job.id });
          }
          throw err;
        }
      });

      // ClientPulse Phase 4 — scenario-detector proposer (event-driven, fires
      // at the tail of compute_churn_risk per sub-account).
      await (boss as any).work('clientpulse:propose-interventions', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runProposeClientPulseInterventions } = await import('../../../jobs/proposeClientPulseInterventionsJob.js');
          await withTimeout(
            runProposeClientPulseInterventions(job.data).then(() => undefined),
            60_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'clientpulse:propose-interventions', jobId: job.id });
          }
          throw err;
        }
      });

      // ClientPulse Phase 4 — hourly outcome-measurement sweep (B2 ship gate).
      await (boss as any).work('clientpulse:measure-outcomes', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runMeasureInterventionOutcomes } = await import('../../../jobs/measureInterventionOutcomeJob.js');
          await withTimeout(
            runMeasureInterventionOutcomes().then(() => undefined),
            300_000,
          );
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'clientpulse:measure-outcomes', jobId: job.id });
          }
          throw err;
        }
      });


      // Sprint 2 P1.2 — HITL rejection → regression capture. Uses
      // createWorker so the handler runs inside the org-scoped tx +
      // ALS context pulled from job.data.organisationId.
      const { createWorker } = await import('../../../lib/createWorker.js');
      await createWorker<{
        reviewItemId: string;
        organisationId: string;
      }>({

        queue: 'regression-capture',
        boss: boss as any,
        handler: async (job) => {
          const { captureRegressionFromRejection } = await import(
            '../../regressionCaptureService.js'
          );
          const result = await captureRegressionFromRejection({
            reviewItemId: job.data.reviewItemId,
            organisationId: job.data.organisationId,
          });
          console.info(
            JSON.stringify({
              event: 'regression_capture_done',
              jobId: job.id,
              status: result.status,
              regressionCaseId: result.regressionCaseId ?? null,
              reason: result.reason ?? null,
            }),
          );
        },
      });

      // Sprint 2 P1.2 — nightly regression replay tick. Admin-bypass
      // (cross-org sweep), so resolveOrgContext returns null and the
      // handler uses withAdminConnection internally.
      await createWorker<Record<string, never>>({
        queue: 'regression-replay-tick',
        boss: boss as any,
        resolveOrgContext: () => null,
        handler: async () => {
          const { runRegressionReplayTick } = await import(
            '../../../jobs/regressionReplayJob.js'
          );
          await runRegressionReplayTick();
        },
      });

      // Workflow resume worker — DB-backed, survives process restarts
      await (boss as any).work(WORKFLOW_RESUME_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
        const retryCount = getRetryCount(job);
        if (retryCount > 0) {
          logger.warn('job_retry', { queue: WORKFLOW_RESUME_QUEUE, jobId: job.id, retryCount });
        }
        try {
          const { workflowRunId, approvedActionId, organisationId, subaccountId, agentId, agentRunId } =
            job.data as {
              workflowRunId: string;
              approvedActionId?: string;
              organisationId: string;
              subaccountId: string;
              agentId: string;
              agentRunId?: string;
            };

          const { resumeFlow } = await import('../../flowExecutorService.js');
          await withTimeout(
            resumeFlow(workflowRunId, { organisationId, subaccountId, agentId, agentRunId }, approvedActionId),
            270_000, // 300 - 30
          );
        } catch (err) {
          if (isNonRetryable(err)) {
            logger.error('job_non_retryable_failure', { queue: WORKFLOW_RESUME_QUEUE, jobId: job.id, error: String(err) });
            await (boss as any).fail(job.id);
            return;
          }
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: WORKFLOW_RESUME_QUEUE, jobId: job.id, retryCount });
          }
          throw err;
        }
      });

      // Context enrichment worker (Phase B1) — async embedding context generation
      await (boss as any).work('memory-context-enrichment', { teamSize: 3, teamConcurrency: 1 }, async (job: any) => {
        const retryCount = getRetryCount(job);
        if (retryCount > 0) {
          logger.warn('job_retry', { queue: 'memory-context-enrichment', jobId: job.id, retryCount });
        }
        try {
          const { processContextEnrichment } = await import('../../workspaceMemoryService.js');
          await withTimeout(
            processContextEnrichment(job.data),
            90_000,
          );
        } catch (err) {
          if (isNonRetryable(err)) {
            logger.error('job_non_retryable_failure', { queue: 'memory-context-enrichment', jobId: job.id, error: String(err) });
            await (boss as any).fail(job.id);
            return;
          }
          throw err;
        }
      });

      await boss.schedule('maintenance:cleanup-execution-files',  '0 * * * *',   {});
      await boss.schedule('maintenance:cleanup-budget-reservations', '*/5 * * * *', {});
      await boss.schedule('maintenance:memory-decay', '0 3 * * *', {}); // 3am daily
      await boss.schedule('maintenance:security-events-cleanup', '30 3 * * *', {}); // 3:30am daily
      // Universal Brief Phase 3 — fast_path_decisions 90-day retention pruner + recalibrator
      await boss.schedule('maintenance:fast-path-decisions-prune', '30 3 * * *', {}); // 3:30am UTC daily
      await boss.schedule('maintenance:fast-path-recalibrate', '0 4 * * *', {}); // 4am UTC daily
      await boss.schedule('maintenance:rule-auto-deprecate', '0 3 * * *', {}); // 3am UTC daily
      // LLM observability spec §12 — retention archival at 03:45 UTC so it
      // runs after the 03:00 memory-decay and 03:30 security-events sweeps
      // without contending on the same connection pool.
      await boss.schedule('maintenance:llm-ledger-archive', '45 3 * * *', {});
      // Deferred-items brief §1 — reap aged-out provisional 'started' rows
      // every 2 minutes. Cadence matches the in-flight clarification sweep.
      await boss.schedule('maintenance:llm-started-row-sweep', '*/2 * * * *', {});
      // Skill-analyzer resilience — sweep stalled mid-flight rows every
      // 10 min. Threshold: 15-min `updated_at` silence (see
      // staleAnalyzerJobSweepJobPure.ts header).
      await boss.schedule('maintenance:stale-analyzer-job-sweep', '*/10 * * * *', {});
      // Deferred-items brief §6 — daily 04:15 UTC cleanup of
      // llm_inflight_history rows older than the retention window.
      await boss.schedule('maintenance:llm-inflight-history-cleanup', '15 4 * * *', {});
      // Sprint 3 P2.1 Sprint 3A — daily agent_runs retention prune at
      // 04:00 UTC. Staggered out of the 03:00 slot so memory-decay has
      // a clean shot at the same per-org row set without contending on
      // the same connection pool — the cleanup sweep is admin-bypass +
      // cross-org and can briefly hold longer locks.
      await boss.schedule('agent-run-cleanup', '0 4 * * *', {});
      await boss.schedule('regression-replay-tick', '0 4 * * 0', {}); // 4am every Sunday
      await boss.schedule('priority-feed-cleanup', '0 5 * * *', {}); // 5am daily
      await boss.schedule('workflow-drafts-cleanup', '0 3 * * *', {}); // 3am daily
      await boss.schedule('maintenance:memory-dedup', '30 4 * * *', {}); // 4:30am daily
      // Memory & Briefings Phase 1 — nightly quality decay + prune (5:30am daily)
      await boss.schedule('maintenance:memory-entry-decay', '30 5 * * *', {});
      // Memory & Briefings Phase 2 — clarification timeout sweep (every 2 minutes)
      await boss.schedule('maintenance:clarification-timeout-sweep', '*/2 * * * *', {});
      // Chunk E — integration block expiry sweep (every 5 minutes)
      await boss.schedule('maintenance:blocked-run-expiry', '*/5 * * * *', {});
      // ExecutionBackend reconciliation — generic main-app sweep across
      // every registered delegated adapter (every 2 minutes). Renamed
      // from `maintenance:iee-main-app-reconciliation` in Chunk 5 of the
      // ExecutionBackend Adapter Contract refactor; runtime behaviour
      // unchanged because the IEE adapters are still the only delegated
      // backends in V1.
      //
      // One-cycle unschedule shim — pg-boss will keep firing the old
      // schedule indefinitely if we leave the row in `pgboss.schedule`,
      // even though no worker subscribes to the old queue any more.
      // Best-effort unschedule of the old name first; remove this line
      // after the first deploy has drained the previous schedule row.
      await boss.unschedule('maintenance:iee-main-app-reconciliation').catch(() => undefined);
      await boss.schedule('maintenance:backend-reconciliation', '*/2 * * * *', {});
      // Memory & Briefings Phase 2 — weekly quality adjust (S4, Sun 05:45)
      await boss.schedule('maintenance:memory-entry-quality-adjust', '45 5 * * 0', {});
      // Memory & Briefings Phase 4 — weekly memory-block synthesis (Sun 06:00)
      await boss.schedule('maintenance:memory-block-synthesis', '0 6 * * 0', {});
      // Memory & Briefings Phase 4 — portfolio briefing (Mon 08:00) + digest (Fri 18:00)
      await boss.schedule('maintenance:portfolio-briefing', '0 8 * * 1', {});
      await boss.schedule('maintenance:portfolio-digest', '0 18 * * 5', {});
      // Memory & Briefings Phase 5 — daily protected-block divergence sweep (4am)
      await boss.schedule('maintenance:protected-block-divergence', '0 4 * * *', {});
      // ClientPulse Phase 4 — hourly outcome-measurement cron (B2 ship gate).
      await boss.schedule('clientpulse:measure-outcomes', '7 * * * *', {});
      // Agent Workspace Chunk 11 — maintenance jobs
      await boss.schedule('maintenance:iee-session-orphan-cleanup', '*/5 * * * *', {});  // every 5 min
      await boss.schedule('maintenance:iee-sessions-compact',       '0 5 * * *',   {});  // 5am daily
      await boss.schedule('maintenance:agent-observations-prune',   '30 5 * * *',  {});  // 5:30am daily
      await boss.schedule('maintenance:working-time-rollup-compact','0 6 1 * *',   {});  // 6am 1st of month
      await boss.schedule('maintenance:webhook-replay-nonce-prune', '0 * * * *',   {});  // hourly

      // Skill idempotency keys — nightly retention sweep (05:30 UTC daily per job file header).
      // Inner job bounded by MAX_ROWS_PER_RUN=10_000 (1k batches); outer 570s timeout is defence-in-depth.
      await boss.schedule('maintenance:skill-idempotency-keys-cleanup', '30 5 * * *', {});
      await (boss as any).work('maintenance:skill-idempotency-keys-cleanup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runSkillIdempotencyKeysCleanup } = await import('../../../jobs/skillIdempotencyKeysCleanupJob.js');
          await withTimeout(runSkillIdempotencyKeysCleanup(), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:skill-idempotency-keys-cleanup', jobId: job.id });
          }
          logger.error('job_error', { queue: 'maintenance:skill-idempotency-keys-cleanup', error: String(err) });
          throw err;
        }
      });

      // System Monitor — self-check (every 5 minutes). Rethrow so pg-boss retries / DLQs (normalised with sibling system-monitor-* workers below).
      await boss.schedule('system-monitor-self-check', '*/5 * * * *', {});
      await (boss as any).work('system-monitor-self-check', { teamSize: 1, teamConcurrency: 1 }, async () => {
        try {
          const { runSystemMonitorSelfCheck } = await import('../../../jobs/systemMonitorSelfCheckJob.js');
          await runSystemMonitorSelfCheck();
        } catch (err) {
          logger.error('job_error', { queue: 'system-monitor-self-check', error: String(err) });
          throw err;
        }
      });

      // System Monitor — sweep tick (every 5 minutes per phase-A-1-2-spec.md §4.9). 270s timeout per spec §16 budget.
      await boss.schedule('system-monitor-sweep', '*/5 * * * *', {});
      await (boss as any).work('system-monitor-sweep', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { handleSystemMonitorSweep } = await import('../../../jobs/systemMonitorSweepJob.js');
          await withTimeout(handleSystemMonitorSweep(job), 270_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'system-monitor-sweep', jobId: job.id });
          }
          logger.error('job_error', { queue: 'system-monitor-sweep', error: String(err) });
          throw err;
        }
      });

      // System Monitor — synthetic checks tick (every minute per phase-A-1-2-spec.md §8.4). 55s timeout — must finish under the every-minute cadence.
      await boss.schedule('system-monitor-synthetic-checks', '* * * * *', {});
      await (boss as any).work('system-monitor-synthetic-checks', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { handleSyntheticChecksTick } = await import('../../../jobs/systemMonitorSyntheticChecksJob.js');
          await withTimeout(handleSyntheticChecksTick(), 55_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'system-monitor-synthetic-checks', jobId: job.id });
          }
          logger.error('job_error', { queue: 'system-monitor-synthetic-checks', error: String(err) });
          throw err;
        }
      });

      // System Monitor — baseline refresh tick (every 15 minutes per phase-A-1-2-spec.md §4.9.2). 270s timeout.
      await boss.schedule('system-monitor-baseline-refresh', '*/15 * * * *', {});
      await (boss as any).work('system-monitor-baseline-refresh', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { handleBaselineRefresh } = await import('../../../jobs/systemMonitorBaselineRefreshJob.js');
          await withTimeout(handleBaselineRefresh(), 270_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'system-monitor-baseline-refresh', jobId: job.id });
          }
          logger.error('job_error', { queue: 'system-monitor-baseline-refresh', error: String(err) });
          throw err;
        }
      });

      // System Monitor — triage (event-driven, enqueued from sweep + ingest paths; no schedule).
      // teamSize: 4 + teamConcurrency: 4 per phase-A-1-2-implementation-plan.md §11 (parallel-incident triage).
      // Producer wiring (boss.send('system-monitor-triage', ...)) tracked in tasks/todo.md Wave-6 follow-up.
      await (boss as any).work('system-monitor-triage', { teamSize: 4, teamConcurrency: 4 }, async (job: any) => {
        try {
          const { handleSystemMonitorTriage } = await import('../../../jobs/systemMonitorTriageJob.js');
          await withTimeout(handleSystemMonitorTriage(job), 270_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'system-monitor-triage', jobId: job.id });
          }
          logger.error('job_error', { queue: 'system-monitor-triage', error: String(err) });
          throw err;
        }
      });

      // ClientPulse — trial expiry check (6am daily)
      await boss.schedule('subscription-trial-check', '0 6 * * *', {});
      await (boss as any).work('subscription-trial-check', { teamSize: 1, teamConcurrency: 1 }, async () => {
        try {
          const { subscriptionService } = await import('../../subscriptionService.js');
          const expired = await subscriptionService.getExpiredTrials();
          for (const sub of expired) {
            await subscriptionService.expireTrial(sub.id);
            console.log(JSON.stringify({ event: 'trial_expired', orgSubscriptionId: sub.id, organisationId: sub.organisationId }));
          }
        } catch (err) {
          console.error(JSON.stringify({ event: 'subscription-trial-check:error', error: String(err) }));
          throw err;
        }
      });

      // Workspace seat rollup (agents-as-employees D9) — hourly billing snapshot
      await boss.schedule('seat-rollup', '0 * * * *', {});
      await (boss as any).work('seat-rollup', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runSeatRollup } = await import('../../../jobs/seatRollupJob.js');
          await withTimeout(runSeatRollup().then(() => undefined), 270_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'seat-rollup', jobId: job.id });
          }
          throw err;
        }
      });

      // Workspace identity migration — per-identity job dispatched by workspaceMigrationService.start()
      // Uses createWorker so the handler runs inside an org-scoped tx pulled from job.data.organisationId.
      // T2 carry-forward (PR #327, audit 2026-05-15; helper extracted Wave 5 Session K):
      // clamp env-derived concurrency to [1, 32]; non-numeric / zero / negative
      // values silently fall back to MIGRATION_CONCURRENCY_DEFAULT (8). Helper
      // is pure and unit-tested at clampMigrationConcurrency.test.ts.
      const { clampMigrationConcurrency } = await import('./clampMigrationConcurrency.js');
      const migrationConcurrency = clampMigrationConcurrency(process.env.WORKSPACE_MIGRATION_CONCURRENCY);
      await createWorker<import('../../workspace/workspaceMigrationService.js').MigrateIdentityJob>({
        queue: 'workspace.migrate-identity',
        boss: boss as any,
        concurrency: migrationConcurrency,
        timeoutMs: 270_000,
        handler: async (job) => {
          const { processIdentityMigration, WORKSPACE_MIGRATE_IDENTITY_RETRY_LIMIT } = await import('../../workspace/workspaceMigrationService.js');
          const { resolveMigrationAdapter } = await import('../migrationAdapter.js');
          const adapter = await resolveMigrationAdapter(job.data.targetBackend);
          // Codex P1 round 2 (2026-04-30): forward pg-boss retry counter so
          // the failure path defers writing the (`ON CONFLICT DO NOTHING`-locked)
          // `subaccount.migration_completed` row until the final attempt. See
          // workspaceMigrationService.persistTerminalFailure for rationale.
          await processIdentityMigration(job.data, { adapter }, {
            retrycount: getRetryCount(job as unknown as { retrycount?: number } & Record<string, unknown>),
            retryLimit: WORKSPACE_MIGRATE_IDENTITY_RETRY_LIMIT,
          });
        },
      });

      // Feature 4 — Slack inbound message processing (event-driven, no schedule)
      await (boss as any).work('slack-inbound', { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 2 }, async (job: any) => {
        try {
          const { processSlackInbound } = await import('../../../jobs/slackInboundJob.js');
          await withTimeout(processSlackInbound(job.data).then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'slack-inbound', jobId: job.id });
          }
          throw err;
        }
      });

      // Orchestrator capability-aware routing (docs/orchestrator-capability-routing-spec.md §7)
      // — processes task-created events that pass the eligibility predicate.
      {
        const { ORCHESTRATOR_FROM_TASK_QUEUE, setOrchestratorJobSender } = await import('../../../jobs/orchestratorFromTaskJob.js');
        setOrchestratorJobSender((name, data) => boss.send(name, data));
        await (boss as any).work(ORCHESTRATOR_FROM_TASK_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 4 }, async (job: any) => {
          try {
            const { processOrchestratorFromTask } = await import('../../../jobs/orchestratorFromTaskJob.js');
            await withTimeout(processOrchestratorFromTask(job.data).then(() => undefined), 180_000);
          } catch (err) {
            if (isTimeoutError(err)) {
              logger.error('job_timeout', { queue: ORCHESTRATOR_FROM_TASK_QUEUE, jobId: job.id });
            }
            throw err;
          }
        });
      }

      // Agentic Commerce — execution-window timeout sweep (every minute).
      // Transitions approved agent_charges past expires_at → failed/execution_timeout.
      // Admin-bypass cross-org sweep; teamSize=1 (pg-boss deduplicates across instances).
      await (boss as any).work('maintenance:execution-window-timeout', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runExecutionWindowTimeoutSweep } = await import('../../../jobs/executionWindowTimeoutJob.js');
          await withTimeout(runExecutionWindowTimeoutSweep().then(() => undefined), 55_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:execution-window-timeout', jobId: job.id });
          }
          throw err;
        }
      });
      await boss.schedule('maintenance:execution-window-timeout', '* * * * *', {});

      // Agentic Commerce — approval-expiry sweep (every minute).
      // Transitions pending_approval agent_charges past approval_expires_at → denied/approval_expired.
      // Admin-bypass cross-org sweep; teamSize=1.
      await (boss as any).work('maintenance:approval-expiry', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runApprovalExpirySweep } = await import('../../../jobs/approvalExpiryJob.js');
          await withTimeout(runApprovalExpirySweep().then(() => undefined), 55_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:approval-expiry', jobId: job.id });
          }
          throw err;
        }
      });
      await boss.schedule('maintenance:approval-expiry', '* * * * *', {});

      // Agentic Commerce — Stripe agent reconciliation poll (every 5 minutes).
      // Polls Stripe for executed agent_charges that haven't received a webhook
      // confirmation within 30 minutes. Drives equivalent transitions on terminal results.
      // Admin-bypass cross-org sweep; teamSize=1.
      await (boss as any).work('maintenance:stripe-agent-reconciliation-poll', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runStripeAgentReconciliationPoll } = await import('../../../jobs/stripeAgentReconciliationPollJob.js');
          await withTimeout(runStripeAgentReconciliationPoll().then(() => undefined), 270_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:stripe-agent-reconciliation-poll', jobId: job.id });
          }
          throw err;
        }
      });
      await boss.schedule('maintenance:stripe-agent-reconciliation-poll', '*/5 * * * *', {});

      // Agentic Commerce — shadow charge retention purge (daily 03:30 UTC).
      // Deletes shadow_settled agent_charges rows past the per-org retention window.
      // Retention job is the ONLY DB path that may delete agent_charges rows.
      // Sets app.spend_caller = 'retention_purge' before each DELETE.
      await (boss as any).work('maintenance:shadow-charge-retention', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runShadowChargeRetentionSweep } = await import('../../../jobs/shadowChargeRetentionJob.js');
          await withTimeout(runShadowChargeRetentionSweep().then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'maintenance:shadow-charge-retention', jobId: job.id });
          }
          throw err;
        }
      });
      await boss.schedule('maintenance:shadow-charge-retention', '30 3 * * *', {});

      // Canonical Data Platform P1 — connector polling tick (every-minute cron).
      // Cross-org sweep: selects connections due for sync across all orgs and
      // fan-outs one connector-polling-sync job per connection via boss.send().
      // Admin-bypass: resolveOrgContext → null (no org-scoped tx).
      await createWorker<Record<string, never>>({
        queue: 'connector-polling-tick',
        boss: boss as any,
        resolveOrgContext: () => null,
        handler: async () => {
          const { runConnectorPollingTick } = await import('../../../jobs/connectorPollingTick.js');
          await runConnectorPollingTick(boss as any);
        },
      });
      await boss.schedule('connector-polling-tick', '* * * * *', {});

      // Canonical Data Platform P1 — per-connection sync job (on-demand)
      // Acquires a lease, runs the adapter, records ingestion stats.
      await createWorker<{
        organisationId: string;
        connectionId: string;
      }>({
        queue: 'connector-polling-sync',
        boss: boss as any,
        handler: async (job) => {
          const { runConnectorPollingSync } = await import('../../../jobs/connectorPollingSync.js');
          await runConnectorPollingSync(job.data);
        },
      });

      // Pre-launch hardening D-P0-1 — GHL auto-start onboarding (event-driven).
      // Dequeued after subaccount creation from webhook/OAuth-callback paths.
      // The default resolveOrgContext reads `organisationId` from the payload and
      // opens an org-scoped tx with `app.organisation_id` set, so the FORCE-RLS
      // tenant-table reads inside subaccountOnboardingService (now using
      // getOrgScopedDb) pass policy checks.
      await createWorker<import('../../../jobs/ghlAutoStartOnboardingJob.js').GhlAutoStartOnboardingPayload>({
        queue: 'ghl:auto-start-onboarding',
        boss: boss as any,
        handler: async (job) => {
          const { ghlAutoStartOnboardingWorker } = await import('../../../jobs/ghlAutoStartOnboardingJob.js');
          await ghlAutoStartOnboardingWorker(job.data);
        },
      });

      // Phase 3 D.5 — GHL auto-enrol locations page (paginated background job).
      // Triggered when autoEnrolAgencyLocations detects > MAX_GHL_LOCATIONS_TO_ENROL.
      // Uses singletonKey to prevent concurrent runs per connection.
      // Does NOT use createWorker's org-scoped tx — uses withAdminConnection directly.
      await (boss as any).work(
        'ghl:auto-enrol-locations-page',
        { teamSize: 1, teamConcurrency: 1 },
        async (job: any) => {
          const { ghlAutoEnrolLocationsPageWorker } = await import('../../../jobs/ghlAutoEnrolLocationsPageJob.js');
          await ghlAutoEnrolLocationsPageWorker(job.data);
        },
      );

      // Pre-launch hardening C-P0-2 — OAuth resume restart (event-driven).
      // Dequeued after a successful OAuth token exchange when a pendingRunId was
      // stored on the state nonce. Default resolveOrgContext reads organisationId
      // from the payload and opens an org-scoped tx with the GUC set so that
      // WorkflowRunPauseStopService (now using getOrgScopedDb) can read workflow_runs.
      await createWorker<import('../../../jobs/resumeRunAfterOAuthJob.js').ResumeRunAfterOAuthPayload>({
        queue: 'run:resumeAfterOAuth',
        boss: boss as any,
        handler: async (job) => {
          const { resumeRunAfterOAuthWorker } = await import('../../../jobs/resumeRunAfterOAuthJob.js');
          await resumeRunAfterOAuthWorker(job.data);
        },
      });

      // Agentic Commerce — agent-spend-request handler (worker→main, Chunk 11)
      // Receives WorkerSpendRequest, recomputes idempotency key, calls proposeCharge,
      // emits WorkerSpendResponse on agent-spend-response by correlationId.
      {
        const { registerAgentSpendRequestHandler } = await import('../../../jobs/agentSpendRequestHandler.js');
        await registerAgentSpendRequestHandler(boss as any);
      }

      // Agentic Commerce — agent-spend-completion handler (worker→main, Chunk 11)
      // Receives WorkerSpendCompletion after worker fills merchant form.
      // Implements invariant 20: sets provider_charge_id or transitions executed → failed only.
      {
        const { registerAgentSpendCompletionHandler } = await import('../../../jobs/agentSpendCompletionHandler.js');
        await registerAgentSpendCompletionHandler(boss as any);
      }

      // Agentic Commerce — agent-spend-response queue (main→worker, Chunk 11)
      // Consumed by the IEE worker; main app does not register a handler for this queue.
      // Declared here for documentation completeness. The worker polls by correlationId.

      // F3 §4 — daily fallback: evaluate pending baselines and enqueue capture jobs.
      await (boss as any).work('evaluate-all-pending-baselines', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { evaluateAllPendingBaselinesHandler } = await import('../../../jobs/evaluateAllPendingBaselines.js');
          await withTimeout(evaluateAllPendingBaselinesHandler(job).then(() => undefined), 570_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'evaluate-all-pending-baselines', jobId: job.id });
          }
          throw err;
        }
      });
      await boss.schedule('evaluate-all-pending-baselines', '0 6 * * *', {});

      // F3 §5 — per-baseline capture worker (event-driven; enqueued by subscriber + cron).
      await (boss as any).work('capture-baseline', { teamSize: 4, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { captureBaselineJobHandler } = await import('../../../jobs/captureBaselineJob.js');
          await withTimeout(captureBaselineJobHandler(job).then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'capture-baseline', jobId: job.id });
          }
          throw err;
        }
      });

      // Trust & Verification Layer — scorecard judge workers (spec §12.3)
      await (boss as any).work('scorecard:judge', { teamSize: 4, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { scorecardJudgeJobHandler } = await import('../../../jobs/scorecardJudgeJob.js');
          await withTimeout(scorecardJudgeJobHandler(job).then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'scorecard:judge', jobId: job.id });
          }
          throw err;
        }
      });

      await (boss as any).work('scorecard:judge:forced', { teamSize: 4, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { scorecardJudgeJobHandler } = await import('../../../jobs/scorecardJudgeJob.js');
          await withTimeout(scorecardJudgeJobHandler(job).then(() => undefined), 60_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'scorecard:judge:forced', jobId: job.id });
          }
          throw err;
        }
      });

      // Trust & Verification Layer — bench execute worker (spec §12.4)
      await (boss as any).work('bench:execute', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { benchExecuteJobHandler } = await import('../../../jobs/benchExecuteJob.js');
          await withTimeout(benchExecuteJobHandler(job).then(() => undefined), 300_000); // 5 min
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'bench:execute', jobId: job.id });
          }
          throw err;
        }
      });

      // Closed-Loop Skill Improvement — failure post-mortem RCA job (Chunk 3, spec §9.1)
      await (boss as any).work('failure:post-mortem', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { failurePostMortemJobHandler } = await import('../../../jobs/failurePostMortemJob.js');
          await withTimeout(failurePostMortemJobHandler(job).then(() => undefined), 90_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'failure:post-mortem', jobId: job.id });
          }
          throw err;
        }
      });

      // Closed-Loop Skill Improvement — amendment regression replay (Chunk 7, spec §9.2)
      await (boss as any).work('amendment:regression-replay', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { regressionReplayJobHandler } = await import('../../../jobs/amendmentRegressionReplayJob.js');
          await withTimeout(regressionReplayJobHandler(job).then(() => undefined), 5 * 60 * 1000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'amendment:regression-replay', jobId: job.id });
          }
          throw err;
        }
      });

      // Trust & Verification Layer — bench regression replay worker (spec §12.4)
      await (boss as any).work('bench:regression-replay', { teamSize: 2, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { benchRegressionReplayJobHandler } = await import('../../../jobs/benchRegressionReplayJob.js');
          await withTimeout(benchRegressionReplayJobHandler(job).then(() => undefined), 120_000);
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'bench:regression-replay', jobId: job.id });
          }
          throw err;
        }
      });

      // Trust & Verification Layer — correction pattern detector (daily sweep, spec §13.3)
      await (boss as any).work('correction:pattern-detect', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
        try {
          const { runCorrectionPatternDetector } = await import('../../../jobs/correctionPatternDetectorJob.js');
          await withTimeout(runCorrectionPatternDetector().then(() => undefined), 300_000); // 5 min max
        } catch (err) {
          if (isTimeoutError(err)) {
            logger.error('job_timeout', { queue: 'correction:pattern-detect', jobId: job.id });
          }
          throw err;
        }
      });
      await boss.schedule('correction:pattern-detect', '0 5 * * *', {}); // 5am daily

      // Spec B — Sandbox Isolation: execution-scoped pg-boss jobs (C11a)
      {
        const { registerSandboxHarvestReconciliationJob } = await import('../../../jobs/sandboxHarvestReconciliationJob.js');
        await registerSandboxHarvestReconciliationJob(boss as any);
        await boss.schedule(SANDBOX_HARVEST_RECONCILIATION_JOB, '*/5 * * * *', {}); // every 5 minutes
      }
      {
        const { registerSandboxCeilingMonitorJob } = await import('../../../jobs/sandboxCeilingMonitorJob.js');
        await registerSandboxCeilingMonitorJob(boss as any);
        // No schedule — enqueued ad-hoc at sandbox start via boss.send with singletonKey.
      }
      {
        const { registerSandboxWallClockKillJob } = await import('../../../jobs/sandboxWallClockKillJob.js');
        await registerSandboxWallClockKillJob(boss as any);
        // No schedule — one-shot, scheduled at sandbox start with startAfter = wallClockMs + buffer.
      }
      {
        const { registerSandboxArtefactPurgeJob } = await import('../../../jobs/sandboxArtefactPurgeJob.js');
        await registerSandboxArtefactPurgeJob(boss as any);
        // No schedule — event-driven, enqueued on run soft-delete.
      }

      // Spec B — Sandbox Isolation: retention-scoped pg-boss jobs (C11b)
      // Distinct cron times to avoid contention (telemetry 02:00, logs 02:30, egress 03:00 UTC).
      {
        const { registerSandboxTelemetryPruneJob } = await import('../../../jobs/sandboxTelemetryPruneJob.js');
        await registerSandboxTelemetryPruneJob(boss as any);
        await boss.schedule(SANDBOX_TELEMETRY_PRUNE_JOB, '0 2 * * *', {}); // daily 02:00 UTC
      }
      {
        const { registerSandboxLogsPruneJob } = await import('../../../jobs/sandboxLogsPruneJob.js');
        await registerSandboxLogsPruneJob(boss as any);
        await boss.schedule(SANDBOX_LOGS_PRUNE_JOB, '30 2 * * *', {}); // daily 02:30 UTC
      }
      {
        const { registerSandboxEgressAuditPruneJob } = await import('../../../jobs/sandboxEgressAuditPruneJob.js');
        await registerSandboxEgressAuditPruneJob(boss as any);
        await boss.schedule(SANDBOX_EGRESS_AUDIT_PRUNE_JOB, '0 3 * * *', {}); // daily 03:00 UTC
      }
}
