import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents } from '../db/schema/index.js';
import { agentExecutionService } from './agentExecutionService.js';
import { setHandoffJobSender } from './skillExecutor.js';
import { setTriggerJobSender } from './triggerService.js';
import { setContextEnrichmentJobSender } from './workspaceMemoryService.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from '../lib/jobErrors.js';
import { createWorker } from '../lib/createWorker.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';

// ---------------------------------------------------------------------------
// Agent Schedule Service — manages cron-based agent scheduling via pg-boss
// ---------------------------------------------------------------------------

const AGENT_RUN_QUEUE = 'agent-scheduled-run';
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';
const AGENT_TRIGGERED_QUEUE = 'agent-triggered-run';
// AGENT_ORG_RUN_QUEUE removed — org agents now run via AGENT_RUN_QUEUE through the org subaccount

export const agentScheduleService = {
  /**
   * Initialize the schedule worker and register all active schedules.
   * Called once on server startup.
   */
  async initialize() {
    const pgboss = await getPgBoss() as any;

    // Wire up the handoff job sender so skillExecutor can enqueue handoffs
    setHandoffJobSender(async (name: string, data: object) => {
      return pgboss.send(name, data, getJobConfig(name as any));
    });

    // Wire up the trigger job sender so triggerService can enqueue triggered runs
    setTriggerJobSender(async (name: string, data: object) => {
      return pgboss.send(name, data, getJobConfig(name as any));
    });

    // Wire up context enrichment job sender for workspace memory (Phase B1)
    setContextEnrichmentJobSender(async (name: string, data: unknown, options?: Record<string, unknown>) => {
      return pgboss.send(name, data, { ...getJobConfig(name as any), ...options });
    });

    // Sprint 3 P2.1 Sprint 3A — the four agent-dispatch workers below use
    // `createWorker`, which opens a `db.transaction` + `withOrgTx` for the
    // full handler. This is required so that `appendMessage` (and any
    // other `getOrgScopedDb` caller in the agentic loop) can see the
    // ALS context — without it, every `agent_run_messages` write would
    // fail-closed with `missing_org_context` and the resume log would
    // be empty for scheduled/handoff/triggered runs.
    //
    // The helper also handles retry classification, timeout, and
    // `boss.fail(job.id)` routing, matching the previous raw `work()`
    // calls' behaviour.

    // Register the worker that processes scheduled agent runs
    await createWorker<{
      subaccountAgentId: string;
      agentId: string;
      subaccountId: string;
      organisationId: string;
    }>({
      queue: AGENT_RUN_QUEUE,
      boss: pgboss,
      concurrency: env.QUEUE_CONCURRENCY,
      handler: async (job) => {
        const data = job.data;
        logger.info(`[AgentScheduler] Running scheduled agent: ${data.agentId} for subaccount ${data.subaccountId}`);

        await agentExecutionService.executeRun({
          agentId: data.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: data.subaccountAgentId,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'scheduled',
          runSource: 'scheduler',
          executionMode: 'api',
          idempotencyKey: `scheduled:${data.subaccountAgentId}:${job.id}`,
          triggerContext: { source: 'schedule' },
        });
      },
    });

    // Temporary: catch any orphan org-scheduled jobs from the old queue.
    // These will drain naturally. Remove this handler once all old schedules
    // have been unregistered. See spec §8e.
    await pgboss.work('agent-org-scheduled-run', { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
      logger.warn('Orphan org-scheduled job received post-migration — dropping', { jobId: job.id, data: job.data });
    });

    // Register the worker that processes agent handoff runs
    await createWorker<{
      taskId: string;
      agentId: string;
      subaccountAgentId: string;
      subaccountId: string;
      organisationId: string;
      sourceRunId: string;
      handoffDepth: number;
      handoffContext?: string;
    }>({
      queue: AGENT_HANDOFF_QUEUE,
      boss: pgboss,
      concurrency: env.QUEUE_CONCURRENCY,
      timeoutMs: 150_000,
      handler: async (job) => {
        const data = job.data;
        logger.info(`[AgentScheduler] Running handoff agent: ${data.agentId} for task ${data.taskId} (depth: ${data.handoffDepth})`);

        await agentExecutionService.executeRun({
          agentId: data.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: data.subaccountAgentId,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'triggered',
          runSource: 'handoff',
          executionMode: 'api',
          idempotencyKey: `handoff:${data.agentId}:${job.id}`,
          taskId: data.taskId,
          handoffDepth: data.handoffDepth,
          parentRunId: data.sourceRunId,
          handoffSourceRunId: data.sourceRunId,
          triggerContext: {
            type: 'handoff',
            sourceRunId: data.sourceRunId,
            handoffDepth: data.handoffDepth,
            handoffContext: data.handoffContext,
          },
        });
      },
    });

    // Register the worker that processes event-triggered agent runs
    await createWorker<{
      subaccountAgentId: string;
      subaccountId: string;
      organisationId: string;
      triggerContext: Record<string, unknown>;
    }>({
      queue: AGENT_TRIGGERED_QUEUE,
      boss: pgboss,
      concurrency: env.QUEUE_CONCURRENCY,
      handler: async (job) => {
        const data = job.data;

        // Look up agentId from the subaccountAgentId — inside withOrgTx.
        const tx = getOrgScopedDb('agentScheduleService.triggeredLookup');
        const [saLink] = await tx
          .select()
          .from(subaccountAgents)
          .where(eq(subaccountAgents.id, data.subaccountAgentId))
          .limit(1);
        if (!saLink) {
          logger.error(`[AgentScheduler] Triggered run: subaccountAgent ${data.subaccountAgentId} not found`);
          return;
        }

        logger.info(`[AgentScheduler] Running triggered agent: ${saLink.agentId} for subaccount ${data.subaccountId}`);

        await agentExecutionService.executeRun({
          agentId: saLink.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: data.subaccountAgentId,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'triggered',
          runSource: 'trigger',
          executionMode: 'api',
          idempotencyKey: `triggered:${data.subaccountAgentId}:${job.id}`,
          triggerContext: data.triggerContext,
        });
      },
    });

    // ── Stale run cleanup — runs every 5 minutes ────────────────────────
    const STALE_CLEANUP_QUEUE = 'stale-run-cleanup';
    await pgboss.work(STALE_CLEANUP_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        logger.warn('job_retry', { queue: STALE_CLEANUP_QUEUE, jobId: job.id, retryCount });
      }
      try {
        await withTimeout((async () => {
          const { staleRunCleanupService } = await import('./staleRunCleanupService.js');
          await staleRunCleanupService.cleanupStaleRuns();
        })(), 210_000);
      } catch (err) {
        if (isNonRetryable(err)) {
          logger.error('job_non_retryable_failure', { queue: STALE_CLEANUP_QUEUE, jobId: job.id, error: String(err) });
          await pgboss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          logger.error('job_timeout', { queue: STALE_CLEANUP_QUEUE, jobId: job.id, retryCount });
        }
        throw err;
      }
    });
    await pgboss.schedule(STALE_CLEANUP_QUEUE, '*/5 * * * *');

    // Register all active schedules
    await this.registerAllActiveSchedules();
  },

  /**
   * Register all active agent schedules from the database.
   */
  async registerAllActiveSchedules() {
    const rows = await db
      .select({
        sa: subaccountAgents,
        agentStatus: agents.status,
      })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isNull(agents.deletedAt)))
      .where(
        and(
          eq(subaccountAgents.scheduleEnabled, true),
          eq(subaccountAgents.isActive, true),
          eq(agents.status, 'active'),
        )
      );

    let registered = 0;
    for (const row of rows) {
      const sa = row.sa;
      if (!sa.scheduleCron) continue;

      try {
        await this.registerSchedule(sa.id, sa.scheduleCron, {
          subaccountAgentId: sa.id,
          agentId: sa.agentId,
          subaccountId: sa.subaccountId,
          organisationId: sa.organisationId,
        }, sa.scheduleTimezone ?? 'UTC');
        registered++;
      } catch (err) {
        logger.error(`[AgentScheduler] Failed to register schedule for ${sa.id}`, { error: String(err) });
      }
    }

    logger.info(`[AgentScheduler] Registered ${registered} active schedules (includes org subaccount agents)`);
  },

  /**
   * Register or update a single schedule.
   */
  async registerSchedule(
    subaccountAgentId: string,
    cron: string,
    data: { subaccountAgentId: string; agentId: string; subaccountId: string; organisationId: string },
    tz: string = 'UTC'
  ) {
    const pgboss = await getPgBoss() as any;
    const scheduleName = `${AGENT_RUN_QUEUE}:${subaccountAgentId}`;

    await pgboss.schedule(scheduleName, cron, data, {
      tz: tz || 'UTC',
    });
  },

  /**
   * Remove a schedule.
   */
  async unregisterSchedule(subaccountAgentId: string) {
    const pgboss = await getPgBoss() as any;
    const scheduleName = `${AGENT_RUN_QUEUE}:${subaccountAgentId}`;
    await pgboss.unschedule(scheduleName);
  },

  // registerOrgSchedule / unregisterOrgSchedule removed — org agents now
  // schedule through the standard registerSchedule() via the org subaccount.

  /**
   * Update schedule for a subaccount agent. Handles enable/disable and cron changes.
   */
  async updateSchedule(
    subaccountAgentId: string,
    data: { scheduleCron?: string | null; scheduleEnabled?: boolean; scheduleTimezone?: string }
  ) {
    const [sa] = await db
      .select()
      .from(subaccountAgents)
      .where(eq(subaccountAgents.id, subaccountAgentId));

    if (!sa) throw { statusCode: 404, message: 'Subaccount agent not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.scheduleCron !== undefined) update.scheduleCron = data.scheduleCron;
    if (data.scheduleEnabled !== undefined) update.scheduleEnabled = data.scheduleEnabled;
    if (data.scheduleTimezone !== undefined) update.scheduleTimezone = data.scheduleTimezone;

    const [updated] = await db
      .update(subaccountAgents)
      .set(update)
      .where(eq(subaccountAgents.id, subaccountAgentId))
      .returning();

    // Update the actual schedule
    if (updated.scheduleEnabled && updated.scheduleCron) {
      await this.registerSchedule(updated.id, updated.scheduleCron, {
        subaccountAgentId: updated.id,
        agentId: updated.agentId,
        subaccountId: updated.subaccountId,
        organisationId: updated.organisationId,
      }, updated.scheduleTimezone ?? 'UTC');
    } else {
      await this.unregisterSchedule(updated.id);
    }

    return updated;
  },

  /**
   * Clean shutdown — lifecycle managed by pgBossInstance.
   */
  async shutdown() {
    // Lifecycle managed by pgBossInstance — see stopPgBoss()
  },
};
