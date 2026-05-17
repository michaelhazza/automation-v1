import type { SkillExecutionContext } from '../context.js';
import { taskService } from '../../taskService.js';

// ---------------------------------------------------------------------------
// Read Workspace
// ---------------------------------------------------------------------------

export async function executeReadWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const limit = Math.min(Number(input.limit ?? 20), 50);
  const includeActivities = Boolean(input.include_activities);

  try {
    // Single-task lookup by ID
    if (input.task_id) {
      const task = await taskService.getTask(String(input.task_id), context.organisationId);
      return { success: true, item: serializeTask(task), total: 1 };
    }

    // Subtask listing by parent
    if (input.parent_task_id) {
      const parentId = String(input.parent_task_id);
      const allItems = await taskService.listTasks(context.organisationId, context.subaccountId!, {});
      const subtasks = allItems.filter(t => (t as { parentTaskId?: string | null }).parentTaskId === parentId);
      return {
        success: true,
        items: subtasks.map(serializeTask),
        total: subtasks.length,
        allDone: subtasks.length > 0 && subtasks.every(t => t.status === 'done'),
        // Task status enum (server/db/schema/tasks.ts) has no 'blocked' value today;
        // field reserved for a future status. Always false at runtime under the current schema.
        anyBlocked: false,
      };
    }

    // Standard filtered listing
    const filters: { status?: string; assignedAgentId?: string } = {};
    if (input.status) filters.status = String(input.status);
    if (input.assigned_to_me) filters.assignedAgentId = context.agentId;

    const items = await taskService.listTasks(context.organisationId, context.subaccountId!, filters);
    const sliced = items.slice(0, limit);

    if (includeActivities) {
      const enriched = await Promise.all(sliced.map(async (item) => {
        const activities = await taskService.listActivities(item.id, context.organisationId);
        return {
          ...serializeTask(item),
          activities: activities.slice(0, 5).map(a => ({
            type: a.activityType,
            message: a.message,
            createdAt: a.createdAt,
          })),
        };
      }));
      return { success: true, items: enriched, total: items.length };
    }

    return { success: true, items: sliced.map(serializeTask), total: items.length };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to read board: ${errMsg}` };
  }
}

function serializeTask(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    brief: item.brief,
    status: item.status,
    priority: item.priority,
    isSubTask: (item as { isSubTask?: boolean }).isSubTask ?? false,
    parentTaskId: (item as { parentTaskId?: string | null }).parentTaskId ?? null,
    assignedAgent: item.assignedAgent,
    createdAt: item.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Write Workspace (add activity)
// ---------------------------------------------------------------------------

export async function executeWriteWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const activityType = String(input.activity_type ?? 'progress') as 'progress' | 'note' | 'completed' | 'blocked';
  const message = String(input.message ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!message) return { success: false, error: 'message is required' };

  try {
    const activity = await taskService.addActivity(taskId, context.organisationId, {
      activityType,
      message,
      agentId: context.agentId,
    });

    return { success: true, activity_id: activity.id, _updated_task: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to write to board: ${errMsg}` };
  }
}
