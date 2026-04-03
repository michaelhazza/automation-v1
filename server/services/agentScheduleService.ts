import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subaccountAgents, agents, orgAgentConfigs, organisations } from '../db/schema/index.js';
import { agentExecutionService } from './agentExecutionService.js';
import { setHandoffJobSender } from './skillExecutor.js';
import { setTriggerJobSender } from './triggerService.js';

// ---------------------------------------------------------------------------
// Agent Schedule Service — manages cron-based agent scheduling via pg-boss
// ---------------------------------------------------------------------------

// pg-boss instance — lazy-loaded
let boss: PgBoss | null = null;

// Type for pg-boss (imported dynamically)
type PgBoss = {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(name: string, data?: object, options?: object): Promise<string | null>;
  schedule(name: string, cron: string, data?: object, options?: object): Promise<void>;
  unschedule(name: string): Promise<void>;
  work(name: string, handler: (job: { data: Record<string, unknown> }) => Promise<void>): Promise<string>;
  getSchedules(): Promise<Array<{ name: string; cron: string }>>;
};

const AGENT_RUN_QUEUE = 'agent-scheduled-run';
const AGENT_ORG_RUN_QUEUE = 'agent-org-scheduled-run';
const AGENT_HANDOFF_QUEUE = 'agent-handoff-run';
const AGENT_TRIGGERED_QUEUE = 'agent-triggered-run';

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;

  try {
    const PgBossModule = await import('pg-boss');
    const PgBossClass = PgBossModule.default ?? PgBossModule;
    const { env } = await import('../lib/env.js');

    boss = new (PgBossClass as unknown as new (config: { connectionString: string; noScheduling?: boolean }) => PgBoss)({
      connectionString: env.DATABASE_URL,
    });

    await boss.start();
    return boss;
  } catch (err) {
    // pg-boss not available — fall back to simple interval-based scheduling
    console.warn('[AgentScheduler] pg-boss not available, using fallback scheduler:', err instanceof Error ? err.message : String(err));
    return createFallbackScheduler();
  }
}

// Simple fallback scheduler for environments where pg-boss isn't installed
const activeIntervals = new Map<string, NodeJS.Timeout>();

function createFallbackScheduler(): PgBoss {
  return {
    async start() {},
    async stop() {
      for (const interval of activeIntervals.values()) clearInterval(interval);
      activeIntervals.clear();
    },
    async send(name: string, data?: object) {
      // Execute immediately for fallback
      const handler = fallbackHandlers.get(name);
      if (handler && data) {
        handler({ data: data as Record<string, unknown> }).catch(err => {
          console.error(`[FallbackScheduler] Error in ${name}:`, err);
        });
      }
      return 'fallback-job';
    },
    async schedule(name: string, cron: string, data?: object) {
      // Parse simple cron patterns for the fallback
      const intervalMs = parseCronToMs(cron);
      if (activeIntervals.has(name)) clearInterval(activeIntervals.get(name)!);

      const handler = fallbackHandlers.get(AGENT_RUN_QUEUE);
      if (handler && data) {
        const interval = setInterval(() => {
          handler({ data: data as Record<string, unknown> }).catch(err => {
            console.error(`[FallbackScheduler] Error in ${name}:`, err);
          });
        }, intervalMs);
        activeIntervals.set(name, interval);
      }
    },
    async unschedule(name: string) {
      const interval = activeIntervals.get(name);
      if (interval) {
        clearInterval(interval);
        activeIntervals.delete(name);
      }
    },
    async work(_name: string, handler: (job: { data: Record<string, unknown> }) => Promise<void>) {
      fallbackHandlers.set(_name, handler);
      return 'fallback-worker';
    },
    async getSchedules() {
      return Array.from(activeIntervals.keys()).map(name => ({ name, cron: '' }));
    },
  };
}

const fallbackHandlers = new Map<string, (job: { data: Record<string, unknown> }) => Promise<void>>();

function parseCronToMs(cron: string): number {
  // Simple parser for common patterns
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 3600000; // default 1 hour

  const [min, hour] = parts;

  // Every N minutes: */N * * * *
  if (min.startsWith('*/')) {
    const n = parseInt(min.slice(2), 10);
    return n * 60 * 1000;
  }

  // Every N hours: 0 */N * * *
  if (min === '0' && hour.startsWith('*/')) {
    const n = parseInt(hour.slice(2), 10);
    return n * 60 * 60 * 1000;
  }

  // Specific time daily: M H * * *
  if (!min.includes('*') && !hour.includes('*') && parts[2] === '*') {
    return 24 * 60 * 60 * 1000; // once daily
  }

  // Default: every hour
  return 3600000;
}

export const agentScheduleService = {
  /**
   * Initialize the schedule worker and register all active schedules.
   * Called once on server startup.
   */
  async initialize() {
    const pgboss = await getBoss();

    // Wire up the handoff job sender so skillExecutor can enqueue handoffs
    setHandoffJobSender(async (name: string, data: object) => {
      return pgboss.send(name, data);
    });

    // Wire up the trigger job sender so triggerService can enqueue triggered runs
    setTriggerJobSender(async (name: string, data: object) => {
      return pgboss.send(name, data);
    });

    // Register the worker that processes scheduled agent runs
    await pgboss.work(AGENT_RUN_QUEUE, async (job) => {
      const data = job.data as {
        subaccountAgentId: string;
        agentId: string;
        subaccountId: string;
        organisationId: string;
      };

      console.log(`[AgentScheduler] Running scheduled agent: ${data.agentId} for subaccount ${data.subaccountId}`);

      try {
        await agentExecutionService.executeRun({
          agentId: data.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: data.subaccountAgentId,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'scheduled',
          executionMode: 'api',
          triggerContext: { source: 'schedule' },
        });
      } catch (err) {
        console.error(`[AgentScheduler] Scheduled run failed:`, err);
      }
    });

    // Register the worker that processes org-level scheduled agent runs
    await pgboss.work(AGENT_ORG_RUN_QUEUE, async (job) => {
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
        console.log(`[AgentScheduler] Org execution disabled, dropping org scheduled run for agent ${data.agentId}`);
        return; // Drop silently, don't retry
      }

      console.log(`[AgentScheduler] Running org-level scheduled agent: ${data.agentId} for org ${data.organisationId}`);

      try {
        await agentExecutionService.executeRun({
          agentId: data.agentId,
          organisationId: data.organisationId,
          executionScope: 'org',
          orgAgentConfigId: data.orgAgentConfigId,
          runType: 'scheduled',
          executionMode: 'api',
          triggerContext: { source: 'org-schedule' },
        });
      } catch (err) {
        console.error(`[AgentScheduler] Org scheduled run failed:`, err);
      }
    });

    // Register the worker that processes agent handoff runs
    await pgboss.work(AGENT_HANDOFF_QUEUE, async (job) => {
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

      console.log(`[AgentScheduler] Running handoff agent: ${data.agentId} for task ${data.taskId} (depth: ${data.handoffDepth})`);

      try {
        await agentExecutionService.executeRun({
          agentId: data.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: data.subaccountAgentId,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'triggered',
          executionMode: 'api',
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
      } catch (err) {
        console.error(`[AgentScheduler] Handoff run failed:`, err);
      }
    });

    // Register the worker that processes event-triggered agent runs
    await pgboss.work(AGENT_TRIGGERED_QUEUE, async (job) => {
      const data = job.data as {
        subaccountAgentId: string;
        subaccountId: string;
        organisationId: string;
        triggerContext: Record<string, unknown>;
      };

      // Look up agentId from the subaccountAgentId
      const { db } = await import('../db/index.js');
      const { subaccountAgents } = await import('../db/schema/index.js');
      const { eq } = await import('drizzle-orm');
      const [saLink] = await db.select().from(subaccountAgents).where(eq(subaccountAgents.id, data.subaccountAgentId)).limit(1);
      if (!saLink) {
        console.error(`[AgentScheduler] Triggered run: subaccountAgent ${data.subaccountAgentId} not found`);
        return;
      }

      console.log(`[AgentScheduler] Running triggered agent: ${saLink.agentId} for subaccount ${data.subaccountId}`);

      try {
        await agentExecutionService.executeRun({
          agentId: saLink.agentId,
          subaccountId: data.subaccountId,
          subaccountAgentId: data.subaccountAgentId,
          organisationId: data.organisationId,
          executionScope: 'subaccount',
          runType: 'triggered',
          executionMode: 'api',
          triggerContext: data.triggerContext,
        });
      } catch (err) {
        console.error(`[AgentScheduler] Triggered run failed:`, err);
      }
    });

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
        console.error(`[AgentScheduler] Failed to register schedule for ${sa.id}:`, err);
      }
    }

    console.log(`[AgentScheduler] Registered ${registered} active subaccount schedules`);

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
        console.error(`[AgentScheduler] Failed to register org schedule for ${config.id}:`, err);
      }
    }

    console.log(`[AgentScheduler] Registered ${orgRegistered} active org schedules`);
  },

  /**
   * Register or update a single schedule.
   */
  async registerSchedule(
    subaccountAgentId: string,
    cron: string,
    data: { subaccountAgentId: string; agentId: string; subaccountId: string; organisationId: string }
  ) {
    const pgboss = await getBoss();
    const scheduleName = `${AGENT_RUN_QUEUE}:${subaccountAgentId}`;

    await pgboss.schedule(scheduleName, cron, data, {
      tz: 'UTC',
    });
  },

  /**
   * Remove a schedule.
   */
  async unregisterSchedule(subaccountAgentId: string) {
    const pgboss = await getBoss();
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
    const pgboss = await getBoss();
    const scheduleName = `${AGENT_ORG_RUN_QUEUE}:${orgAgentConfigId}`;
    await pgboss.schedule(scheduleName, cron, data, { tz: 'UTC' });
  },

  /**
   * Remove an org-level schedule.
   */
  async unregisterOrgSchedule(orgAgentConfigId: string) {
    const pgboss = await getBoss();
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
   * Clean shutdown — stop pg-boss.
   */
  async shutdown() {
    if (boss) {
      await boss.stop();
      boss = null;
    }
  },
};
