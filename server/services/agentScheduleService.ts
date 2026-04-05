import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents, orgAgentConfigs, organisations } from '../db/schema/index.js';
import { agentExecutionService } from './agentExecutionService.js';
import { setHandoffJobSender } from './skillExecutor.js';
import { setTriggerJobSender } from './triggerService.js';
import { getPgBoss } from '../lib/pgBossInstance.js';
import { getJobConfig } from '../config/jobConfig.js';
import { isNonRetryable, isTimeoutError, getRetryCount, withTimeout } from '../lib/jobErrors.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';

// ---------------------------------------------------------------------------
// Agent Schedule Service — manages cron-based agent scheduling via pg-boss
// ---------------------------------------------------------------------------

const AGENT_RUN_QUEUE = 'agent-scheduled-run';
const AGENT_ORG_RUN_QUEUE = 'agent-org-scheduled-run';
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';
const AGENT_TRIGGERED_QUEUE = 'agent-triggered-run';

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

    // Register the worker that processes scheduled agent runs
    await pgboss.work(AGENT_RUN_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        logger.warn('job_retry', { queue: AGENT_RUN_QUEUE, jobId: job.id, retryCount });
      }
      try {
        await withTimeout((async () => {
          const data = job.data as {
            subaccountAgentId: string;
            agentId: string;
            subaccountId: string;
            organisationId: string;
          };

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
        })(), 270_000);
      } catch (err) {
        if (isNonRetryable(err)) {
          logger.error('job_non_retryable_failure', { queue: AGENT_RUN_QUEUE, jobId: job.id, error: String(err) });
          await pgboss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          logger.error('job_timeout', { queue: AGENT_RUN_QUEUE, jobId: job.id, retryCount });
        }
        throw err;
      }
    });

    // Register the worker that processes org-level scheduled agent runs
    await pgboss.work(AGENT_ORG_RUN_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        logger.warn('job_retry', { queue: AGENT_ORG_RUN_QUEUE, jobId: job.id, retryCount });
      }
      try {
        await withTimeout((async () => {
          const jobId = job.id;
          const data = job.data as {
            orgAgentConfigId: string;
            agentId: string;
            organisationId: string;
          };

          // Check kill switch before executing
          const [org] = await db
            .select({ orgExecutionEnabled: organisations.orgExecutionEnabled })
            .from(organisations)
            .where(eq(organisations.id, data.organisationId));
          if (org && !org.orgExecutionEnabled) {
            logger.info(`[AgentScheduler] Org execution disabled, dropping org scheduled run for agent ${data.agentId}`);
            return; // Drop silently, don't retry
          }

          logger.info(`[AgentScheduler] Running org-level scheduled agent: ${data.agentId} for org ${data.organisationId}`);

          // Deterministic idempotency key: use pg-boss job ID (unique per cron tick)
          const scheduleTickKey = `org-scheduled:${data.agentId}:${data.organisationId}:${jobId}`;

          await agentExecutionService.executeRun({
            agentId: data.agentId,
            organisationId: data.organisationId,
            executionScope: 'org',
            orgAgentConfigId: data.orgAgentConfigId,
            runType: 'scheduled',
            runSource: 'scheduler',
            executionMode: 'api',
            idempotencyKey: scheduleTickKey,
            triggerContext: { source: 'org-schedule' },
          });
        })(), 270_000);
      } catch (err) {
        if (isNonRetryable(err)) {
          logger.error('job_non_retryable_failure', { queue: AGENT_ORG_RUN_QUEUE, jobId: job.id, error: String(err) });
          await pgboss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          logger.error('job_timeout', { queue: AGENT_ORG_RUN_QUEUE, jobId: job.id, retryCount });
        }
        throw err;
      }
    });

    // Register the worker that processes agent handoff runs
    await pgboss.work(AGENT_HANDOFF_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        logger.warn('job_retry', { queue: AGENT_HANDOFF_QUEUE, jobId: job.id, retryCount });
      }
      try {
        await withTimeout((async () => {
          const data = job.data as {
            taskId: string;
            agentId: string;
            subaccountAgentId: string;
            subaccountId: string;
            organisationId: string;
            sourceRunId: string;
            handoffDepth: number;
            handoffContext?: string;
          };

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
            triggerContext: {
              type: 'handoff',
              sourceRunId: data.sourceRunId,
              handoffDepth: data.handoffDepth,
              handoffContext: data.handoffContext,
            },
          });
        })(), 150_000);
      } catch (err) {
        if (isNonRetryable(err)) {
          logger.error('job_non_retryable_failure', { queue: AGENT_HANDOFF_QUEUE, jobId: job.id, error: String(err) });
          await pgboss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          logger.error('job_timeout', { queue: AGENT_HANDOFF_QUEUE, jobId: job.id, retryCount });
        }
        throw err;
      }
    });

    // Register the worker that processes event-triggered agent runs
    await pgboss.work(AGENT_TRIGGERED_QUEUE, { teamSize: env.QUEUE_CONCURRENCY, teamConcurrency: 1 }, async (job: any) => {
      const retryCount = getRetryCount(job);
      if (retryCount > 0) {
        logger.warn('job_retry', { queue: AGENT_TRIGGERED_QUEUE, jobId: job.id, retryCount });
      }
      try {
        await withTimeout((async () => {
          const data = job.data as {
            subaccountAgentId: string;
            subaccountId: string;
            organisationId: string;
            triggerContext: Record<string, unknown>;
          };

          // Look up agentId from the subaccountAgentId
          const [saLink] = await db.select().from(subaccountAgents).where(eq(subaccountAgents.id, data.subaccountAgentId)).limit(1);
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
        })(), 270_000);
      } catch (err) {
        if (isNonRetryable(err)) {
          logger.error('job_non_retryable_failure', { queue: AGENT_TRIGGERED_QUEUE, jobId: job.id, error: String(err) });
          await pgboss.fail(job.id);
          return;
        }
        if (isTimeoutError(err)) {
          logger.error('job_timeout', { queue: AGENT_TRIGGERED_QUEUE, jobId: job.id, retryCount });
        }
        throw err;
      }
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
      .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
      .where(
        and(
          eq(subaccountAgents.scheduleEnabled, true),
          eq(subaccountAgents.isActive, true),
          eq(agents.status, 'active'),
          isNull(agents.deletedAt)
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
        });
        registered++;
      } catch (err) {
        logger.error(`[AgentScheduler] Failed to register schedule for ${sa.id}`, { error: String(err) });
      }
    }

    logger.info(`[AgentScheduler] Registered ${registered} active subaccount schedules`);

    // Also register org-level agent schedules
    const orgRows = await db
      .select({
        config: orgAgentConfigs,
        agentStatus: agents.status,
      })
      .from(orgAgentConfigs)
      .innerJoin(agents, eq(agents.id, orgAgentConfigs.agentId))
      .where(
        and(
          eq(orgAgentConfigs.scheduleEnabled, true),
          eq(orgAgentConfigs.isActive, true),
          eq(agents.status, 'active'),
          isNull(agents.deletedAt)
        )
      );

    let orgRegistered = 0;
    for (const row of orgRows) {
      const config = row.config;
      if (!config.scheduleCron) continue;

      try {
        await this.registerOrgSchedule(config.id, config.scheduleCron, {
          orgAgentConfigId: config.id,
          agentId: config.agentId,
          organisationId: config.organisationId,
        });
        orgRegistered++;
      } catch (err) {
        logger.error(`[AgentScheduler] Failed to register org schedule for ${config.id}`, { error: String(err) });
      }
    }

    logger.info(`[AgentScheduler] Registered ${orgRegistered} active org schedules`);
  },

  /**
   * Register or update a single schedule.
   */
  async registerSchedule(
    subaccountAgentId: string,
    cron: string,
    data: { subaccountAgentId: string; agentId: string; subaccountId: string; organisationId: string }
  ) {
    const pgboss = await getPgBoss() as any;
    const scheduleName = `${AGENT_RUN_QUEUE}:${subaccountAgentId}`;

    await pgboss.schedule(scheduleName, cron, data, {
      tz: 'UTC',
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

  /**
   * Register or update an org-level agent schedule.
   */
  async registerOrgSchedule(
    orgAgentConfigId: string,
    cron: string,
    data: { orgAgentConfigId: string; agentId: string; organisationId: string }
  ) {
    const pgboss = await getPgBoss() as any;
    const scheduleName = `${AGENT_ORG_RUN_QUEUE}:${orgAgentConfigId}`;
    await pgboss.schedule(scheduleName, cron, data, { tz: 'UTC' });
  },

  /**
   * Remove an org-level schedule.
   */
  async unregisterOrgSchedule(orgAgentConfigId: string) {
    const pgboss = await getPgBoss() as any;
    const scheduleName = `${AGENT_ORG_RUN_QUEUE}:${orgAgentConfigId}`;
    await pgboss.unschedule(scheduleName);
  },

  /**
   * Update schedule for a subaccount agent. Handles enable/disable and cron changes.
   */
  async updateSchedule(
    subaccountAgentId: string,
    data: { scheduleCron?: string; scheduleEnabled?: boolean; scheduleTimezone?: string }
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
      });
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
