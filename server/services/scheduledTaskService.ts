import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  scheduledTasks,
  scheduledTaskRuns,
  agents,
} from '../db/schema/index.js';
import { configHistoryService } from './configHistoryService.js';
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

// ---------------------------------------------------------------------------
// Wall-clock → UTC conversion in a target IANA timezone, using only Intl.
// We avoid pulling in date-fns-tz/luxon for one helper. The technique:
//   1. Treat (y,m,d,h,mi) as if it were UTC ("naive UTC").
//   2. Format that instant in the target timezone — the result tells us
//      what wall-clock the naive UTC corresponds to in that zone.
//   3. The delta between the formatted wall-clock and the naive UTC is the
//      zone's UTC offset for that instant. Subtract it.
// Correct across DST boundaries.
// ---------------------------------------------------------------------------
function zonedWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(naiveUtc));
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value);
  const projected = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = projected - naiveUtc;
  return new Date(naiveUtc - offset);
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
      // Phase B2 — onboarding-playbooks spec §5.4.1, §5.4.2.
      taskSlug?: string;
      createdByWorkflowSlug?: string;
      firstRunAt?: Date;
      firstRunAtTz?: string;
      /**
       * When true, fire an immediate run in addition to the recurring cron.
       * Idempotent — resubmitting the same (task, occurrence) is a no-op at
       * the agent run layer via the existing idempotencyKey invariant.
       */
      runNow?: boolean;
    },
    userId?: string
  ) {
    // Uniqueness invariant (spec §5.4.1): if an active task already exists
    // for (subaccountId, taskSlug) return it rather than creating a duplicate.
    // Every call path — UI form, Configuration Assistant chat, playbook
    // action_call, direct API — gets dedup for free.
    if (data.taskSlug) {
      const existing = await this.findActiveBySlug(subaccountId, data.taskSlug);
      if (existing) {
        if (data.runNow) {
          this.enqueueRunNow(existing.id, organisationId).catch((err) => {
            console.error('[ScheduledTask] runNow on existing slug failed:', err);
          });
        }
        return existing;
      }
    }

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
        taskSlug: data.taskSlug ?? null,
        createdByWorkflowSlug: data.createdByWorkflowSlug ?? null,
        firstRunAt: data.firstRunAt ?? null,
        firstRunAtTz: data.firstRunAtTz ?? null,
        retryPolicy: data.retryPolicy ?? DEFAULT_RETRY_POLICY,
        tokenBudgetPerRun: data.tokenBudgetPerRun ?? 30000,
        nextRunAt,
        endsAt: data.endsAt ?? null,
        endsAfterRuns: data.endsAfterRuns ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await configHistoryService.recordHistory({
      entityType: 'scheduled_task',
      entityId: created.id,
      organisationId,
      snapshot: created as unknown as Record<string, unknown>,
      changedBy: userId ?? null,
      changeSource: 'api',
    });

    if (data.runNow) {
      this.enqueueRunNow(created.id, organisationId).catch((err) => {
        console.error('[ScheduledTask] runNow enqueue failed:', err);
      });
    }

    return created;
  },

  // ─── Slug-based lookups (Phase B2) ─────────────────────────────────────────

  /**
   * Returns the active task (if any) matching the given (subaccount, slug)
   * pair. Powers idempotency for `config_create_scheduled_task` (spec §5.5.1)
   * and for the playbook action_call dispatcher's entity-scoped idempotency.
   */
  async findActiveBySlug(
    subaccountId: string,
    taskSlug: string,
  ): Promise<typeof scheduledTasks.$inferSelect | null> {
    const [row] = await db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.subaccountId, subaccountId),
          eq(scheduledTasks.taskSlug, taskSlug),
          eq(scheduledTasks.isActive, true),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Lists every active system-owned task for a playbook slug across an org.
   * Used by lifecycle-management paths (retirement, offboarding).
   * Spec §5.4.2 lifecycle-manageability invariant.
   */
  async listByWorkflowSlug(
    workflowSlug: string,
    organisationId: string,
  ): Promise<(typeof scheduledTasks.$inferSelect)[]> {
    return db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.organisationId, organisationId),
          eq(scheduledTasks.createdByWorkflowSlug, workflowSlug),
          eq(scheduledTasks.isActive, true),
        ),
      );
  },

  /**
   * Deactivates every system-owned task for the given playbook slug in a
   * sub-account. Soft-delete only — the row stays for audit. pg-boss cron
   * deregistration would happen here in a full pg-boss setup; the current
   * RRULE-based scheduler is in-process and the `isActive: false` flag is
   * honoured by `fireOccurrence`, so deactivation is already effective.
   */
  async deactivateByWorkflowSlug(
    workflowSlug: string,
    subaccountId: string,
  ): Promise<void> {
    const rows = await db
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.subaccountId, subaccountId),
          eq(scheduledTasks.createdByWorkflowSlug, workflowSlug),
          eq(scheduledTasks.isActive, true),
        ),
      );
    for (const r of rows) {
      await db
        .update(scheduledTasks)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(scheduledTasks.id, r.id));
      await configHistoryService.recordHistory({
        entityType: 'scheduled_task',
        entityId: r.id,
        organisationId: r.organisationId,
        snapshot: { ...(r as unknown as Record<string, unknown>), isActive: false },
        changedBy: null,
        changeSource: 'api',
        changeSummary: `Deactivated as part of playbook '${workflowSlug}' retirement`,
      });
    }
  },

  /**
   * Enqueue an immediate run of an existing scheduled task. Idempotent via
   * the agent-run `scheduled_task:${id}:${occurrence}` key. We use
   * `setImmediate` rather than `pgBoss.send` because the current scheduler is
   * in-process RRULE-based; migrating to a pg-boss cron queue is out of
   * scope for this phase (spec §5.8 — failure isolation is preserved because
   * the catch around `enqueueRunNow` emits to the server log).
   */
  async enqueueRunNow(scheduledTaskId: string, organisationId: string): Promise<void> {
    setImmediate(() => {
      this.fireOccurrence(scheduledTaskId, organisationId).catch((err) => {
        console.error('[ScheduledTask] runNow fireOccurrence failed:', err);
      });
    });
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

    await configHistoryService.recordHistory({
      entityType: 'scheduled_task',
      entityId: id,
      organisationId,
      snapshot: existing as unknown as Record<string, unknown>,
      changedBy: null,
      changeSource: 'api',
    });

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

    // Detect assignedAgentId change — triggers a cascade on any data sources
    // attached to this scheduled task. See spec §7.6.
    const agentChanged =
      data.assignedAgentId !== undefined &&
      data.assignedAgentId !== existing.assignedAgentId;

    // Lazy imports keep us out of the agentService circular-import chain.
    // Hoisted out of the conditional below so the transaction body can use them.
    const { agentDataSources } = await import('../db/schema/index.js');
    const { auditService } = await import('./auditService.js');
    const { isNull } = await import('drizzle-orm');

    // Wrap the scheduled task update AND the cascade in a single transaction
    // (pr-reviewer Blocker 2). Without this, a cascade failure after the
    // scheduled task UPDATE commits would leave data sources orphaned: the
    // task would point at the new agent but the data sources would still
    // carry the old agentId, so fetchDataSourcesByScope (which filters by
    // agentId) would silently return zero rows for that scheduled task.
    type TxResult = {
      updated: typeof existing;
      auditPayload: {
        cascadedDataSourceCount: number;
        willOverrideNewAgentSources: string[];
      } | null;
    };

    const txResult: TxResult = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(scheduledTasks)
        .set(update)
        .where(eq(scheduledTasks.id, id))
        .returning();

      if (!agentChanged) {
        return { updated: row, auditPayload: null };
      }

      // Count first so the audit metadata is accurate
      const cascadedRows = await tx
        .select({ id: agentDataSources.id, name: agentDataSources.name })
        .from(agentDataSources)
        .where(eq(agentDataSources.scheduledTaskId, id));

      if (cascadedRows.length === 0) {
        return { updated: row, auditPayload: null };
      }

      // Cascade the agentId update to point at the new assigned agent
      await tx
        .update(agentDataSources)
        .set({ agentId: data.assignedAgentId!, updatedAt: new Date() })
        .where(eq(agentDataSources.scheduledTaskId, id));

      // Compute the list of scheduled-task source names that will now
      // override the new agent's OWN agent-level sources at runtime (§3.6).
      // Purely informational — no DB change beyond the cascade above.
      const newAgentOwnSources = await tx
        .select({ name: agentDataSources.name })
        .from(agentDataSources)
        .where(
          and(
            eq(agentDataSources.agentId, data.assignedAgentId!),
            isNull(agentDataSources.subaccountAgentId),
            isNull(agentDataSources.scheduledTaskId),
          )
        );

      const newAgentNames = new Set(
        newAgentOwnSources.map(s => s.name.toLowerCase().trim())
      );
      return {
        updated: row,
        auditPayload: {
          cascadedDataSourceCount: cascadedRows.length,
          willOverrideNewAgentSources: cascadedRows
            .map(s => s.name)
            .filter(n => newAgentNames.has(n.toLowerCase().trim())),
        },
      };
    });

    // Emit the audit event AFTER the transaction commits — auditService.log
    // catches and swallows its own errors, so it's safe to invoke outside
    // the transaction without compromising consistency.
    if (txResult.auditPayload) {
      await auditService.log({
        organisationId,
        actorType: 'system',
        action: 'scheduled_task.assigned_agent_changed',
        entityType: 'scheduled_task',
        entityId: id,
        metadata: {
          oldAgentId: existing.assignedAgentId,
          newAgentId: data.assignedAgentId!,
          cascadedDataSourceCount: txResult.auditPayload.cascadedDataSourceCount,
          willOverrideNewAgentSources: txResult.auditPayload.willOverrideNewAgentSources,
        },
      });
    }

    return txResult.updated;
  },

  async delete(id: string, organisationId: string) {
    const [existing] = await db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organisationId, organisationId)));

    if (existing) {
      await configHistoryService.recordHistory({
        entityType: 'scheduled_task',
        entityId: id,
        organisationId,
        snapshot: existing as unknown as Record<string, unknown>,
        changedBy: null,
        changeSource: 'api',
        changeSummary: 'Entity deleted',
      });
    }

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
      .leftJoin(agents, and(eq(agents.id, scheduledTasks.assignedAgentId), isNull(agents.deletedAt)))
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
      .leftJoin(agents, and(eq(agents.id, scheduledTasks.assignedAgentId), isNull(agents.deletedAt)))
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

      // Apply the wall-clock time component IN THE TARGET TIMEZONE.
      // setHours() would interpret the time in the Node process's local zone,
      // which is wrong on any host whose tz != the user's chosen tz.
      const [hours, minutes] = scheduleTime.split(':').map(Number);
      let nextInTz = zonedWallClockToUtc(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        hours,
        minutes,
        timezone
      );

      // If the computed time is in the past, get the next occurrence
      if (nextInTz <= afterDate) {
        const following = rule.after(next, false);
        if (following) {
          nextInTz = zonedWallClockToUtc(
            following.getUTCFullYear(),
            following.getUTCMonth() + 1,
            following.getUTCDate(),
            hours,
            minutes,
            timezone
          );
          return nextInTz;
        }
      }

      return nextInTz;
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
      return dates.map(d =>
        zonedWallClockToUtc(
          d.getUTCFullYear(),
          d.getUTCMonth() + 1,
          d.getUTCDate(),
          hours,
          minutes,
          timezone
        )
      );
    } catch {
      return [];
    }
  },

  // ─── Fire Occurrence ───────────────────────────────────────────────────────
  //
  // Spec §5.4 — scheduled→workflow dispatch: when a scheduled task fires a
  // workflow run (Chunk 15 scope), read `st.pinnedTemplateVersionId` from the
  // scheduled task row and pass it as `pinnedTemplateVersionId` to
  // WorkflowRunService.startRun. startRun honours the pin via
  // WorkflowScheduleDispatchService.pickVersionForSchedule and throws
  // `pinned_version_unavailable` (422) when the pinned version no longer exists.

  async fireOccurrence(scheduledTaskId: string, organisationId: string): Promise<void> {
    const [st] = await db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, scheduledTaskId), eq(scheduledTasks.organisationId, organisationId)));

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
        st.subaccountId!,
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
            eq(subaccountAgents.subaccountId, st.subaccountId!),
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
        // Dedupe concurrent triggers for the same occurrence (e.g. manual
        // run-now while the scheduler also fires). The key is stable per
        // (scheduledTask, occurrence) so a duplicate fireOccurrence is a no-op
        // at the agent run layer.
        idempotencyKey: `scheduled_task:${st.id}:${occurrence}`,
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

      // Schedule retry with exponential backoff. `currentAttempt` is the
      // attempt that just failed (>= 1), so `Math.pow(2, currentAttempt - 1)`
      // yields 1, 2, 4, … on attempts 1, 2, 3 — the first retry waits
      // exactly `backoffMinutes`, the second waits 2x, etc.
      const backoffMs = policy.backoffMinutes * 60 * 1000 * Math.pow(2, currentAttempt - 1);

      // The in-process timer is the happy path. If the process restarts
      // before the timer fires, reconcileRetryingRuns() (called from
      // server bootstrap) will sweep `retrying` runs whose backoff has
      // elapsed and re-queue them. Without that sweep, a restart between
      // mark-retrying and timer-fire would strand the run permanently.
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
          eq(subaccountAgents.subaccountId, st.subaccountId!),
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
        // Per-attempt idempotency key — prevents a double-fired retry timer
        // (in-process + reconciliation) from creating two agent runs.
        idempotencyKey: `scheduled_task:${st.id}:${run.occurrence}:retry:${run.attempt}`,
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

  // ─── Startup Reconciliation ────────────────────────────────────────────────
  //
  // Sweeps `retrying` runs whose backoff has elapsed and re-queues them.
  // Called from server bootstrap to recover any retries whose in-process
  // setTimeout was lost due to a process restart. Idempotent: re-running
  // the sweep is safe because retryOccurrence guards on `status === 'retrying'`
  // and the agent run idempotencyKey deduplicates duplicate retries.
  async reconcileRetryingRuns(): Promise<{ swept: number; queued: number }> {
    const retrying = await db
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.status, 'retrying'));

    let queued = 0;
    const now = Date.now();
    for (const run of retrying) {
      const [st] = await db
        .select()
        .from(scheduledTasks)
        .where(eq(scheduledTasks.id, run.scheduledTaskId));
      if (!st) continue;

      const policy = (st.retryPolicy as typeof DEFAULT_RETRY_POLICY) ?? DEFAULT_RETRY_POLICY;
      // attempt was incremented when the run was marked retrying, so the
      // failed attempt is `attempt - 1`.
      const failedAttempt = Math.max(1, run.attempt - 1);
      const backoffMs = policy.backoffMinutes * 60 * 1000 * Math.pow(2, failedAttempt - 1);
      const dueAt = (run.startedAt?.getTime() ?? run.createdAt.getTime()) + backoffMs;

      if (dueAt <= now) {
        // Backoff already elapsed — fire immediately.
        this.retryOccurrence(run.id).catch(err =>
          console.error('[ScheduledTask] Reconciled retry failed:', err)
        );
        queued++;
      } else {
        // Backoff still pending — re-arm an in-process timer for the remainder.
        const remaining = dueAt - now;
        setTimeout(() => {
          this.retryOccurrence(run.id).catch(err =>
            console.error('[ScheduledTask] Reconciled retry failed:', err)
          );
        }, remaining);
        queued++;
      }
    }

    if (retrying.length > 0) {
      console.log(`[ScheduledTask] Reconciled ${retrying.length} retrying runs (${queued} re-queued)`);
    }
    return { swept: retrying.length, queued };
  },
};
