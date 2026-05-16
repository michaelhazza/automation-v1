import { eq, and, isNull } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db/index.js';
import { subaccountAgents, agents, systemAgents, subaccounts, agentRuns } from '../db/schema/index.js';
import { isActive } from '../lib/queryHelpers.js';
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
// Pure helper — exported for testability
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic stagger offset in minutes [0, 359] for a subaccount.
 * Uses the first 4 hex chars of sha256(subaccountId) mod 360 to spread daily
 * optimiser scans across a 6-hour window starting at 06:00 UTC.
 */
export function computeStaggerMinutes(subaccountId: string): number {
  const hashHex = createHash('sha256').update(subaccountId).digest('hex');
  return parseInt(hashHex.slice(0, 4), 16) % 360;
}

// ---------------------------------------------------------------------------
// Agent Schedule Service — manages cron-based agent scheduling via pg-boss
// ---------------------------------------------------------------------------

const AGENT_RUN_QUEUE = 'agent-scheduled-run';
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';
const AGENT_TRIGGERED_QUEUE = 'agent-triggered-run';
const OPTIMISER_SCAN_QUEUE = 'optimiser-scan';
// AGENT_ORG_RUN_QUEUE removed — org agents now run via AGENT_RUN_QUEUE through the org subaccount

export const agentScheduleService = {
  /**
   * Initialize the schedule worker and register all active schedules.
   * Called once on server startup.
   */
  async initialize() {
    const pgboss = await getPgBoss() as any;

    // Wire up the handoff job sender so skillExecutor can enqueue handoffs
    setHandoffJobSender(async (name: string, data: object, options?: import('pg-boss').SendOptions) => {
      return pgboss.send(name, data, { ...getJobConfig(name as any), ...options });
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
      runId?: string;
    }>({
      queue: AGENT_HANDOFF_QUEUE,
      boss: pgboss,
      concurrency: env.QUEUE_CONCURRENCY,
      timeoutMs: 150_000,
      handler: async (job) => {
        const data = job.data;
        logger.info(`[AgentScheduler] Running handoff agent: ${data.agentId} for task ${data.taskId} (depth: ${data.handoffDepth})`);

        if (data.runId) {
          const [existingRun] = await db
            .select({ id: agentRuns.id, status: agentRuns.status })
            .from(agentRuns)
            .where(eq(agentRuns.id, data.runId))
            .limit(1);

          if (!existingRun) {
            logger.error(`[AgentScheduler] Handoff run row missing for runId ${data.runId} — atomicity breach; failing job`, {
              runId: data.runId,
              agentId: data.agentId,
              taskId: data.taskId,
              severity: 'critical',
            });
            throw new Error(`[Handoff] Pre-created agent_runs row missing for runId ${data.runId}`);
          }

          const TERMINAL_STATUSES = new Set([
            'completed', 'failed', 'timeout', 'cancelled', 'loop_detected',
            'budget_exceeded', 'completed_with_uncertainty',
            'paused_chain_failure', 'paused_budget_exceeded', 'paused_wall_clock_exceeded',
          ]);

          if (TERMINAL_STATUSES.has(existingRun.status)) {
            logger.info(`[AgentScheduler] Handoff run ${data.runId} already in terminal status '${existingRun.status}' — treating as duplicate enqueue, exiting cleanly`, {
              runId: data.runId,
              status: existingRun.status,
            });
            return;
          }

          // pg-boss at-least-once delivery: a retry that arrives while the
          // first attempt is still in flight (status='running' or any other
          // in-flight status) is a duplicate dispatch, not a failure. Exit
          // cleanly so the retry does not fail / DLQ a healthy in-flight
          // run. The first attempt remains the authoritative executor;
          // pg-boss treats the retry as completed when this handler returns.
          if (existingRun.status !== 'pending') {
            logger.info(`[AgentScheduler] Handoff run ${data.runId} already in-flight status '${existingRun.status}' — treating as duplicate dispatch, exiting cleanly`, {
              runId: data.runId,
              status: existingRun.status,
              agentId: data.agentId,
              taskId: data.taskId,
            });
            return;
          }
        }

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
          // AE2 / spec §5.2 step 1: when the payload carries a pre-created
          // runId, hand it down so persistAndAnnounce claims the existing
          // `pending` row instead of inserting a duplicate. Without this
          // the parent's spawn poll-loop polls the wrong runId.
          preCreatedRunId: data.runId,
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

    // ── Optimiser peer-medians nightly refresh ─────────────────────────
    const PEER_MEDIANS_QUEUE = 'refresh_optimiser_peer_medians';
    await pgboss.work(PEER_MEDIANS_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
      const { refreshOptimiserPeerMediansJob } = await import('../jobs/refreshOptimiserPeerMedians.js');
      await refreshOptimiserPeerMediansJob(job);
    });
    await pgboss.schedule(PEER_MEDIANS_QUEUE, '0 0 * * *', null, { tz: 'UTC' });

    // ── Memory-utility MV nightly refresh ─────────────────────────────
    const MEMORY_UTILITY_QUEUE = 'refresh_memory_utility_30d';
    await pgboss.work(MEMORY_UTILITY_QUEUE, { teamSize: 1, teamConcurrency: 1 }, async (job: any) => {
      const { refreshMemoryUtility30dJob } = await import('../jobs/refreshMemoryUtility30dJob.js');
      await refreshMemoryUtility30dJob(job);
    });
    await pgboss.schedule(MEMORY_UTILITY_QUEUE, '0 16 * * *', null, { tz: 'UTC' });

    // ── Optimiser scan — daily per-subaccount scan ─────────────────────
    // createWorker opens db.transaction + withOrgTx, satisfying the ALS
    // requirement that getOrgScopedDb() reads inside runOptimiserScan.
    await createWorker<{
      subaccountId: string;
      organisationId: string;
      agentId: string;
      subaccountAgentId: string;
    }>({
      queue: OPTIMISER_SCAN_QUEUE,
      boss: pgboss,
      concurrency: 1,
      timeoutMs: 540_000, // 9 min hard ceiling — scan has its own circuit breaker
      handler: async (job) => {
        const { handleOptimiserScan } = await import('../jobs/runOptimiserScanJob.js');
        await handleOptimiserScan(job);
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

    // Register all active schedules (non-optimiser SAs)
    await this.registerAllActiveSchedules();
    // Self-heal optimiser schedules on startup (optimiser SAs use a separate queue)
    await this.registerAllOptimiserSchedules();
  },

  /**
   * Register all active agent schedules from the database.
   */
  async registerAllActiveSchedules() {
    // LEFT JOIN system_agents filtered to the optimiser slug so we can exclude those
    // rows from AGENT_RUN_QUEUE registration. Optimiser SAs use OPTIMISER_SCAN_QUEUE
    // and are re-registered at startup via registerOptimiserSchedule (called by the
    // subaccount-create hook and backfill script). isNull(systemAgents.id) retains all
    // non-optimiser rows (join miss → null id).
    const rows = await db
      .select({
        sa: subaccountAgents,
        agentStatus: agents.status,
      })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
      .leftJoin(
        systemAgents,
        and(eq(agents.systemAgentId, systemAgents.id), eq(systemAgents.slug, 'subaccount-optimiser')),
      )
      .where(
        and(
          eq(subaccountAgents.scheduleEnabled, true),
          eq(subaccountAgents.isActive, true),
          eq(agents.status, 'active'),
          isNull(systemAgents.id), // exclude optimiser SAs — they use OPTIMISER_SCAN_QUEUE
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
   * Startup self-heal for optimiser schedules. Sweeps all optimiser-enabled
   * subaccounts and calls registerOptimiserSchedule for each, so pg-boss
   * schedules are restored even after a pg-boss table wipe or environment reset.
   *
   * Mirrors registerAllActiveSchedules but for OPTIMISER_SCAN_QUEUE. Called from
   * initialize() after the non-optimiser sweep.
   */
  async registerAllOptimiserSchedules() {
    const [optimiserSystemAgent] = await db
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(eq(systemAgents.slug, 'subaccount-optimiser'))
      .limit(1);

    if (!optimiserSystemAgent) {
      logger.warn('[AgentScheduler] Optimiser system agent not found — skipping startup optimiser sweep');
      return;
    }

    const rows = await db
      .select({ subaccountId: subaccountAgents.subaccountId, organisationId: subaccountAgents.organisationId })
      .from(subaccountAgents)
      .innerJoin(agents, and(eq(agents.id, subaccountAgents.agentId), isActive(agents)))
      .where(
        and(
          eq(subaccountAgents.scheduleEnabled, true),
          eq(subaccountAgents.isActive, true),
          eq(agents.status, 'active'),
          eq(agents.systemAgentId, optimiserSystemAgent.id),
        )
      );

    let newCount = 0;
    let existingCount = 0;
    let failedCount = 0;
    for (const row of rows) {
      try {
        const result = await this.registerOptimiserSchedule(row.subaccountId, row.organisationId);
        if (result.wasNew) newCount++;
        else existingCount++;
      } catch (err) {
        logger.error(`[AgentScheduler] Failed to re-register optimiser schedule for subaccount ${row.subaccountId}`, { error: String(err) });
        failedCount++;
      }
    }

    logger.info('optimiser.startup.recovery_summary', {
      totalOptimiserEnabled: rows.length,
      schedulesRegistered: newCount,
      schedulesSkipped: existingCount,
      schedulesFailed: failedCount,
    });
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
   * Register (or self-heal) the daily optimiser schedule for a subaccount.
   *
   * Invariant 14: this is the ONLY writer for (subaccount_agents × optimiser).
   * Both the backfill script and the subaccount-create hook call this function.
   * The INSERT ... ON CONFLICT DO NOTHING makes it safe to re-run idempotently.
   *
   * Schedule name: `${OPTIMISER_SCAN_QUEUE}:${subaccountAgentId}` (invariant 13).
   * Cron: stagger offset [0,359] maps to a (minute, hour) pair in the 06:00–11:59
   * UTC window: minute = offset % 60, hour = 6 + floor(offset / 60).
   */
  async registerOptimiserSchedule(subaccountId: string, organisationId: string): Promise<{
    subaccountAgentId: string;
    cron: string;
    scheduleName: string;
    wasNew: boolean;
  }> {
    // 1. Resolve the optimiser system_agents row by slug
    const [systemAgent] = await db
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(eq(systemAgents.slug, 'subaccount-optimiser'))
      .limit(1);

    if (!systemAgent) {
      throw { statusCode: 500, message: 'Optimiser system agent not found', errorCode: 'OPTIMISER_SCHEDULE_AGENT_MISSING' };
    }

    // 2. Resolve the subaccount to confirm it belongs to this org
    const [subaccount] = await db
      .select({ id: subaccounts.id, organisationId: subaccounts.organisationId })
      .from(subaccounts)
      .where(and(eq(subaccounts.id, subaccountId), eq(subaccounts.organisationId, organisationId)))
      .limit(1);

    if (!subaccount) {
      throw { statusCode: 404, message: 'Subaccount not found', errorCode: 'SUBACCOUNT_NOT_FOUND' };
    }

    // 3. Resolve the agents row for this org that links to the system agent
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.systemAgentId, systemAgent.id),
          eq(agents.organisationId, subaccount.organisationId),
          isActive(agents),
        )
      )
      .limit(1);

    if (!agent) {
      throw { statusCode: 500, message: 'Optimiser agent not found for organisation', errorCode: 'OPTIMISER_SCHEDULE_AGENT_MISSING' };
    }

    // 4. Compute staggered cron — offset in [0,359] spans 06:00–11:59 UTC
    const offset = computeStaggerMinutes(subaccountId);
    const minute = offset % 60;
    const hour = 6 + Math.floor(offset / 60);
    const cron = `${minute} ${hour} * * *`;

    // 5. INSERT subaccount_agents ON CONFLICT DO NOTHING (idempotent)
    const inserted = await db
      .insert(subaccountAgents)
      .values({
        subaccountId,
        agentId: agent.id,
        organisationId: subaccount.organisationId,
        scheduleCron: cron,
        scheduleEnabled: true,
        // Hardcoded UTC: subaccounts schema has no timezone column; spec §6 notes per-subaccount timezone is a future enhancement
        scheduleTimezone: 'UTC',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: subaccountAgents.id });

    let subaccountAgentId: string;
    let wasNew: boolean;

    if (inserted.length > 0) {
      subaccountAgentId = inserted[0].id;
      wasNew = true;
    } else {
      // Row already existed — fetch the existing id
      const [existing] = await db
        .select({ id: subaccountAgents.id, scheduleCron: subaccountAgents.scheduleCron, scheduleTimezone: subaccountAgents.scheduleTimezone })
        .from(subaccountAgents)
        .where(
          and(
            eq(subaccountAgents.subaccountId, subaccountId),
            eq(subaccountAgents.agentId, agent.id),
          )
        )
        .limit(1);

      if (!existing) {
        throw { statusCode: 500, message: 'Failed to resolve existing subaccount agent after conflict', errorCode: 'OPTIMISER_SCHEDULE_AGENT_MISSING' };
      }

      subaccountAgentId = existing.id;
      wasNew = false;

      // Self-heal: update DB if cron formula changed.
      // Do NOT call updateSchedule() — it calls registerSchedule() which hardcodes AGENT_RUN_QUEUE.
      // The pg-boss schedule is re-registered unconditionally below (step 6) on OPTIMISER_SCAN_QUEUE.
      if (existing.scheduleCron !== cron) {
        await db
          .update(subaccountAgents)
          .set({ scheduleCron: cron, scheduleEnabled: true, scheduleTimezone: 'UTC', updatedAt: new Date() })
          .where(eq(subaccountAgents.id, subaccountAgentId));
      }
    }

    // Optimiser uses a dedicated queue so jobs reach runOptimiserScan, not the LLM agent loop.
    const scheduleName = `${OPTIMISER_SCAN_QUEUE}:${subaccountAgentId}`;

    // 6. Register (or re-register) the pg-boss schedule on the optimiser-scan queue
    const pgboss = await getPgBoss() as any;
    await pgboss.schedule(
      scheduleName,
      cron,
      {
        subaccountAgentId,
        agentId: agent.id,
        subaccountId,
        organisationId: subaccount.organisationId,
      },
      { tz: 'UTC' },
    );

    if (wasNew) {
      logger.info('optimiser.schedule.registered', { subaccountId, cron, scheduleName });
    } else {
      logger.info('optimiser.schedule.skipped_duplicate', { subaccountId, cron, scheduleName });
    }

    return { subaccountAgentId, cron, scheduleName, wasNew };
  },

  /**
   * Clean shutdown — lifecycle managed by pgBossInstance.
   */
  async shutdown() {
    // Lifecycle managed by pgBossInstance — see stopPgBoss()
  },
};
