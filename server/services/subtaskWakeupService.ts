/**
 * Subtask Wakeup Service
 *
 * When a subtask (isSubTask=true) moves to 'done' or 'blocked', this service
 * finds the orchestrator agent for the same subaccount and triggers a new run —
 * giving it context about what happened so it can decide the next step.
 *
 * 'done'    → orchestrator evaluates completion and proceeds to next subtask or closes parent
 * 'blocked' → orchestrator evaluates the blocker and decides to retry, reassign, or escalate
 *
 * This turns the orchestrator from a timed-polling coordinator into a reactive
 * one: it wakes on state-change events rather than waiting for its next heartbeat.
 */

import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, agents, subaccountAgents, agentRuns } from '../db/schema/index.js';
import { agentExecutionService } from './agentExecutionService.js';
import { logger } from '../lib/logger.js';

// The slug that identifies the orchestrator agent across workspaces.
// If the orchestrator is installed under a different slug, no wakeup fires.
const ORCHESTRATOR_SLUG = 'orchestrator';

export const subtaskWakeupService = {
  /**
   * Called after a task moves to 'done' or 'blocked'. If the task is a subtask,
   * trigger the orchestrator so it can evaluate next steps or handle the blocker.
   *
   * This is fire-and-forget — never awaited in the calling path.
   */
  async notifySubtaskCompleted(taskId: string, subaccountId: string, organisationId: string, newStatus: string = 'done'): Promise<void> {
    // 1. Load the completed task
    const [completedTask] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        isSubTask: tasks.isSubTask,
        parentTaskId: tasks.parentTaskId,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!completedTask?.isSubTask || !completedTask.parentTaskId) {
      // Not a subtask — nothing to do
      return;
    }

    // 2. Load the parent task for context
    const [parentTask] = await db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, completedTask.parentTaskId))
      .limit(1);

    // 3. Find the orchestrator subaccountAgent for this subaccount
    const [saLink] = await db
      .select({
        id: subaccountAgents.id,
        agentId: subaccountAgents.agentId,
        organisationId: subaccountAgents.organisationId,
      })
      .from(subaccountAgents)
      .innerJoin(agents, eq(agents.id, subaccountAgents.agentId))
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.isActive, true),
          eq(agents.slug, ORCHESTRATOR_SLUG)
        )
      )
      .limit(1);

    if (!saLink) {
      logger.info('subtask_wakeup.no_orchestrator', { subaccountId });
      return;
    }

    // 4. Check if the orchestrator is already running for this subaccount.
    //    If so, skip — it will pick up the completion on its current cycle.
    const [runningRun] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.subaccountId, subaccountId),
          eq(agentRuns.agentId, saLink.agentId),
          eq(agentRuns.status, 'running')
        )
      )
      .limit(1);

    if (runningRun) {
      logger.info('subtask_wakeup.orchestrator_already_running', { subaccountId, runId: runningRun.id });
      return;
    }

    // 5. Trigger the orchestrator run with subtask state-change context
    const triggerContext = {
      type: 'subtask_completed',
      subtaskStatus: newStatus,
      completedTaskId: completedTask.id,
      completedTaskTitle: completedTask.title,
      parentTaskId: completedTask.parentTaskId,
      parentTaskTitle: parentTask?.title ?? null,
      parentTaskStatus: parentTask?.status ?? null,
    };

    logger.info('subtask_wakeup.triggering', {
      subaccountId,
      subtaskId: completedTask.id,
      subtaskTitle: completedTask.title,
      subtaskStatus: newStatus,
      parentTaskId: completedTask.parentTaskId,
      parentTaskTitle: parentTask?.title ?? null,
    });

    // Fire and forget — do not block the calling task update
    agentExecutionService.executeRun({
      agentId: saLink.agentId,
      subaccountId,
      subaccountAgentId: saLink.id,
      organisationId: saLink.organisationId,
      runType: 'triggered',
      executionMode: 'api',
      taskId: completedTask.parentTaskId,
      triggerContext,
    }).catch((err: unknown) => {
      logger.error('subtask_wakeup.run_failed', {
        subaccountId,
        completedTaskId: taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  },
};
