import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  scheduledTasks,
  scheduledTaskRuns,
  agents,
} from '../db/schema/index.js';
import { taskService } from './taskService.js';
import { agentExecutionService, type AgentRunRequest } from './agentExecutionService.js';
import { DEFAULT_RETRY_POLICY } from '../config/limits.js';

// ---------------------------------------------------------------------------
// Scheduled Task Service — CRUD + occurrence firing + retry logic
// ---------------------------------------------------------------------------

// Dynamically import rrule to avoid bundling issues
async function getRRule() {
  const mod = await import('rrule');
  return mod.RRule ?? (mod as { default: { RRule: unknown } }).default?.RRule ?? mod;
}

export const scheduledTaskService = {
  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(
    organisationId: string,
    subaccountId: string,
    data: {
      title: string;
      description?: string;
      brief?: string;
      priority?: string;
      assignedAgentId: string;
      rrule: string;
      timezone?: string;
      scheduleTime: string;
      retryPolicy?: { maxRetries: number; backoffMinutes: number; pauseAfterConsecutiveFailures: number };
      tokenBudgetPerRun?: number;
      endsAt?: Date;
      endsAfterRuns?: number;
    },
    userId?: string
  ) {
    // Validate agent exists and is linked to subaccount
    const nextRunAt = await this.computeNextOccurrence(data.rrule, data.timezone ?? 'UTC', data.scheduleTime);

    const [created] = await db
      .insert(scheduledTasks)
      .values({
        organisationId,
        subaccountId,
        title: data.title,
        description: data.description ?? null,
        brief: data.brief ?? null,
        priority: (data.priority ?? 'normal') as 'low' | 'normal' | 'high' | 'urgent',
        assignedAgentId: data.assignedAgentId,
        createdByUserId: userId ?? null,
        rrule: data.rrule,
        timezone: data.timezone ?? 'UTC',
        scheduleTime: data.scheduleTime,
        retryPolicy: data.retryPolicy ?? DEFAULT_RETRY_POLICY,
        tokenBudgetPerRun: data.tokenBudgetPerRun ?? 30000,
        nextRunAt,
        endsAt: data.endsAt ?? null,
        endsAfterRuns: data.endsAfterRuns ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created;
  },

  async update(
    id: string,
    organisationId: string,
    data: {
      title?: string;
      description?: string;
      brief?: string;
      priority?: string;
      assignedAgentId?: string;
      rrule?: string;
      timezone?: string;
      scheduleTime?: string;
      retryPolicy?: { maxRetries: number; backoffMinutes: number; pauseAfterConsecutiveFailures: number };
      tokenBudgetPerRun?: number;
      endsAt?: Date | null;
      endsAfterRuns?: number | null;
    }
  ) {
    const [existing] = await db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organisationId, organisationId)));

    if (!existing) throw { statusCode: 404, message: 'Scheduled task not found' };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) update.title = data.title;
    if (data.description !== undefined) update.description = data.description;
    if (data.brief !== undefined) update.brief = data.brief;
    if (data.priority !== undefined) update.priority = data.priority;
    if (data.assignedAgentId !== undefined) update.assignedAgentId = data.assignedAgentId;
    if (data.rrule !== undefined) update.rrule = data.rrule;
    if (data.timezone !== undefined) update.timezone = data.timezone;
    if (data.scheduleTime !== undefined) update.scheduleTime = data.scheduleTime;
    if (data.retryPolicy !== undefined) update.retryPolicy = data.retryPolicy;
    if (data.tokenBudgetPerRun !== undefined) update.tokenBudgetPerRun = data.tokenBudgetPerRun;
    if (data.endsAt !== undefined) update.endsAt = data.endsAt;
    if (data.endsAfterRuns !== undefined) update.endsAfterRuns = data.endsAfterRuns;

    // Recompute nextRunAt if schedule changed
    if (data.rrule || data.timezone || data.scheduleTime) {
      const rrule = data.rrule ?? existing.rrule;
      const timezone = data.timezone ?? existing.timezone;
      const scheduleTime = data.scheduleTime ?? existing.scheduleTime;
      update.nextRunAt = await this.computeNextOccurrence(rrule, timezone, scheduleTime);
    }

    const [updated] = await db
      .update(scheduledTasks)
      .set(update)
      .where(eq(scheduledTasks.id, id))
      .returning();

    return updated;
  },

  async delete(id: string, organisationId: string) {
    const [deleted] = await db
      .delete(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organisationId, organisationId)))
      .returning();

    if (!deleted) throw { statusCode: 404, message: 'Scheduled task not found' };
    return deleted;
  },

  async toggleActive(id: string, organisationId: string, isActive: boolean) {
    const [existing] = await db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organisationId, organisationId)));

    if (!existing) throw { statusCode: 404, message: 'Scheduled task not found' };

    const update: Record<string, unknown> = { isActive, updatedAt: new Date() };

    if (isActive) {
      // Recompute next run when resuming
      update.nextRunAt = await this.computeNextOccurrence(existing.rrule, existing.timezone, existing.scheduleTime);
      update.consecutiveFailures = 0;
    }

    const [updated] = await db
      .update(scheduledTasks)
      .set(update)
      .where(eq(scheduledTasks.id, id))
      .returning();

    return updated;
  },

  async list(organisationId: string, subaccountId: string) {
    const results = await db
      .select({
        st: scheduledTasks,
        agentName: agents.name,
      })
      .from(scheduledTasks)
      .leftJoin(agents, eq(agents.id, scheduledTasks.assignedAgentId))
      .where(
        and(
          eq(scheduledTasks.organisationId, organisationId),
          eq(scheduledTasks.subaccountId, subaccountId)
        )
      )
      .orderBy(desc(scheduledTasks.createdAt));

    return results.map(r => ({
      ...r.st,
      assignedAgentName: r.agentName,
    }));
  },

  async getDetail(id: string, organisationId: string) {
    const [st] = await db
      .select({
        st: scheduledTasks,
        agentName: agents.name,
      })
      .from(scheduledTasks)
      .leftJoin(agents, eq(agents.id, scheduledTasks.assignedAgentId))
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organisationId, organisationId)));

    if (!st) throw { statusCode: 404, message: 'Scheduled task not found' };

    const runs = await db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.scheduledTaskId, id))
      .orderBy(desc(scheduledTaskRuns.scheduledFor))
      .limit(20);

    // Compute next 5 occurrences
    const upcoming = await this.computeUpcomingOccurrences(
      st.st.rrule,
      st.st.timezone,
      st.st.scheduleTime,
      5
    );

    return {
      ...st.st,
      assignedAgentName: st.agentName,
      runs,
      upcoming,
    };
  },

  // ─── Occurrence Computation ────────────────────────────────────────────────

  async computeNextOccurrence(
    rruleStr: string,
    timezone: string,
    scheduleTime: string,
    after?: Date
  ): Promise<Date | null> {
    try {
      const RRule = await getRRule();
      const rule = RRule.fromString(rruleStr);
      const afterDate = after ?? new Date();
      const next = rule.after(afterDate, false);
      if (!next) return null;

      // Apply the time component
      const [hours, minutes] = scheduleTime.split(':').map(Number);
      next.setHours(hours, minutes, 0, 0);

      // If the computed time is in the past, get the next one
      if (next <= afterDate) {
        const following = rule.after(next, false);
        if (following) {
          following.setHours(hours, minutes, 0, 0);
          return following;
        }
      }

      return next;
    } catch (err) {
      console.error('[ScheduledTask] Failed to compute next occurrence:', err);
      return null;
    }
  },

  async computeUpcomingOccurrences(
    rruleStr: string,
    timezone: string,
    scheduleTime: string,
    count: number
  ): Promise<Date[]> {
    try {
      const RRule = await getRRule();
      const rule = RRule.fromString(rruleStr);
      const now = new Date();
      const dates = rule.between(now, new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), true).slice(0, count);

      const [hours, minutes] = scheduleTime.split(':').map(Number);
      return dates.map(d => {
        d.setHours(hours, minutes, 0, 0);
        return d;
      });
    } catch {
      return [];
    }
  },

  // ─── Fire Occurrence ───────────────────────────────────────────────────────

  async fireOccurrence(scheduledTaskId: string): Promise<void> {
    const [st] = await db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, scheduledTaskId));

    if (!st || !st.isActive) return;

    // Check end conditions
    if (st.endsAfterRuns && st.totalRuns >= st.endsAfterRuns) {
      await db.update(scheduledTasks).set({ isActive: false, updatedAt: new Date() }).where(eq(scheduledTasks.id, st.id));
      return;
    }
    if (st.endsAt && new Date() > st.endsAt) {
      await db.update(scheduledTasks).set({ isActive: false, updatedAt: new Date() }).where(eq(scheduledTasks.id, st.id));
      return;
    }

    const occurrence = st.totalRuns + 1;

    // Create the run record
    const [run] = await db
      .insert(scheduledTaskRuns)
      .values({
        scheduledTaskId: st.id,
        occurrence,
        status: 'pending',
        scheduledFor: st.nextRunAt ?? new Date(),
        createdAt: new Date(),
      })
      .returning();

    // Create a task card on the board
    const taskTitle = st.title.includes('#{n}')
      ? st.title.replace('#{n}', String(occurrence))
      : `${st.title} #${occurrence}`;

    try {
      const task = await taskService.createTask(
        st.organisationId,
        st.subaccountId,
        {
          title: taskTitle,
          description: st.description ?? undefined,
          brief: st.brief ?? undefined,
          priority: st.priority as 'low' | 'normal' | 'high' | 'urgent',
          status: 'inbox',
          assignedAgentId: st.assignedAgentId,
        }
      );

      // Update the run with the task reference
      await db.update(scheduledTaskRuns).set({
        taskId: task.id,
        status: 'running',
        startedAt: new Date(),
      }).where(eq(scheduledTaskRuns.id, run.id));

      // Find the subaccount agent link
      const { subaccountAgents } = await import('../db/schema/index.js');
      const [saLink] = await db
        .select()
        .from(subaccountAgents)
        .where(
          and(
            eq(subaccountAgents.subaccountId, st.subaccountId),
            eq(subaccountAgents.agentId, st.assignedAgentId),
            eq(subaccountAgents.isActive, true)
          )
        );

      if (!saLink) {
        await this.handleRunCompletion(run.id, 'failed', 'Agent not linked to subaccount or inactive');
        return;
      }

      // Execute the agent run
      const result = await agentExecutionService.executeRun({
        agentId: st.assignedAgentId,
        subaccountId: st.subaccountId,
        subaccountAgentId: saLink.id,
        organisationId: st.organisationId,
        executionScope: 'subaccount',
        runType: 'scheduled',
        runSource: 'scheduler',
        executionMode: 'api',
        taskId: task.id,
        triggerContext: {
          source: 'scheduled_task',
          scheduledTaskId: st.id,
          scheduledTaskRunId: run.id,
          occurrence,
        },
      });

      await db.update(scheduledTaskRuns).set({
        agentRunId: result.runId,
      }).where(eq(scheduledTaskRuns.id, run.id));

      if (result.status === 'completed') {
        await this.handleRunCompletion(run.id, 'completed');
      } else {
        await this.handleRunCompletion(run.id, 'failed', result.summary ?? `Run ended with status: ${result.status}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.handleRunCompletion(run.id, 'failed', errMsg);
    }

    // Compute and store next occurrence
    const nextRunAt = await this.computeNextOccurrence(st.rrule, st.timezone, st.scheduleTime);
    await db.update(scheduledTasks).set({
      lastRunAt: new Date(),
      totalRuns: occurrence,
      nextRunAt,
      updatedAt: new Date(),
    }).where(eq(scheduledTasks.id, st.id));
  },

  // ─── Run Completion + Retry Logic ──────────────────────────────────────────

  async handleRunCompletion(
    scheduledTaskRunId: string,
    status: 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const [run] = await db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.id, scheduledTaskRunId));

    if (!run) return;

    if (status === 'completed') {
      await db.update(scheduledTaskRuns).set({
        status: 'completed',
        completedAt: new Date(),
      }).where(eq(scheduledTaskRuns.id, run.id));

      // Reset consecutive failures
      await db.update(scheduledTasks).set({
        consecutiveFailures: 0,
        updatedAt: new Date(),
      }).where(eq(scheduledTasks.id, run.scheduledTaskId));

      return;
    }

    // Failed — check retry policy
    const [st] = await db
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, run.scheduledTaskId));

    if (!st) return;

    const policy = (st.retryPolicy as typeof DEFAULT_RETRY_POLICY) ?? DEFAULT_RETRY_POLICY;
    const currentAttempt = run.attempt;

    if (currentAttempt <= policy.maxRetries) {
      // Retry: update status and will be picked up by retry handler
      await db.update(scheduledTaskRuns).set({
        status: 'retrying',
        attempt: currentAttempt + 1,
        errorMessage,
      }).where(eq(scheduledTaskRuns.id, run.id));

      // Schedule retry with backoff (fire-and-forget — the scheduler will pick it up)
      const backoffMs = policy.backoffMinutes * 60 * 1000 * Math.pow(2, currentAttempt - 1);
      setTimeout(() => {
        this.retryOccurrence(run.id).catch(err =>
          console.error(`[ScheduledTask] Retry failed:`, err)
        );
      }, backoffMs);
    } else {
      // All retries exhausted
      await db.update(scheduledTaskRuns).set({
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      }).where(eq(scheduledTaskRuns.id, run.id));

      // Increment consecutive failures
      const newConsecutive = st.consecutiveFailures + 1;
      const updates: Record<string, unknown> = {
        totalFailures: st.totalFailures + 1,
        consecutiveFailures: newConsecutive,
        updatedAt: new Date(),
      };

      // Auto-pause after N consecutive failures
      if (newConsecutive >= policy.pauseAfterConsecutiveFailures) {
        updates.isActive = false;
        console.warn(`[ScheduledTask] Auto-paused ${st.id} after ${newConsecutive} consecutive failures`);
      }

      await db.update(scheduledTasks).set(updates).where(eq(scheduledTasks.id, st.id));
    }
  },

  async retryOccurrence(scheduledTaskRunId: string): Promise<void> {
    const [run] = await db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.id, scheduledTaskRunId));

    if (!run || run.status !== 'retrying') return;

    // Re-fire the agent against the same task
    const [st] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, run.scheduledTaskId));
    if (!st || !run.taskId) return;

    const { subaccountAgents } = await import('../db/schema/index.js');
    const [saLink] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, st.subaccountId),
          eq(subaccountAgents.agentId, st.assignedAgentId),
          eq(subaccountAgents.isActive, true)
        )
      );

    if (!saLink) {
      await this.handleRunCompletion(run.id, 'failed', 'Agent not linked to subaccount (retry)');
      return;
    }

    try {
      await db.update(scheduledTaskRuns).set({ status: 'running', startedAt: new Date() }).where(eq(scheduledTaskRuns.id, run.id));

      const result = await agentExecutionService.executeRun({
        agentId: st.assignedAgentId,
        subaccountId: st.subaccountId,
        subaccountAgentId: saLink.id,
        organisationId: st.organisationId,
        executionScope: 'subaccount',
        runType: 'scheduled',
        runSource: 'scheduler',
        executionMode: 'api',
        taskId: run.taskId,
        triggerContext: {
          source: 'scheduled_task_retry',
          scheduledTaskId: st.id,
          scheduledTaskRunId: run.id,
          attempt: run.attempt,
        },
      });

      await db.update(scheduledTaskRuns).set({ agentRunId: result.runId }).where(eq(scheduledTaskRuns.id, run.id));

      if (result.status === 'completed') {
        await this.handleRunCompletion(run.id, 'completed');
      } else {
        await this.handleRunCompletion(run.id, 'failed', result.summary ?? `Retry ended with status: ${result.status}`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.handleRunCompletion(run.id, 'failed', errMsg);
    }
  },
};
