import { env } from '../lib/env.js';
import { taskService } from './taskService.js';
import { executeTriggerredProcess } from './llmService.js';

// ---------------------------------------------------------------------------
// Skill Executor — executes tool calls for autonomous agent runs
// ---------------------------------------------------------------------------

interface SkillExecutionContext {
  runId: string;
  organisationId: string;
  subaccountId: string;
  agentId: string;
  orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>;
}

interface SkillExecutionParams {
  skillName: string;
  input: Record<string, unknown>;
  context: SkillExecutionContext;
}

export const skillExecutor = {
  async execute(params: SkillExecutionParams): Promise<unknown> {
    const { skillName, input, context } = params;

    switch (skillName) {
      case 'web_search':
        return executeWebSearch(input);
      case 'read_workspace':
        return executeReadWorkspace(input, context);
      case 'write_workspace':
        return executeWriteWorkspace(input, context);
      case 'trigger_process':
        return executeTriggerProcess(input, context);
      case 'create_task':
        return executeCreateTask(input, context);
      case 'move_task':
        return executeMoveTask(input, context);
      case 'add_deliverable':
        return executeAddDeliverable(input, context);
      default:
        return { success: false, error: `Unknown skill: ${skillName}` };
    }
  },
};

// ---------------------------------------------------------------------------
// Web Search (Tavily)
// ---------------------------------------------------------------------------

async function executeWebSearch(input: Record<string, unknown>): Promise<unknown> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Web search is not configured (TAVILY_API_KEY not set)' };
  }

  const query = String(input.query ?? '');
  const maxResults = Math.min(Number(input.max_results ?? 5), 10);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { success: false, error: `Search API error: ${errorText}` };
    }

    const data = await response.json() as {
      answer?: string;
      results?: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
      }>;
    };

    return {
      success: true,
      answer: data.answer ?? null,
      results: (data.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        relevance_score: r.score,
      })),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Search failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Read Workspace
// ---------------------------------------------------------------------------

async function executeReadWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const filters: { status?: string; assignedAgentId?: string } = {};

  if (input.status) filters.status = String(input.status);
  if (input.assigned_to_me) filters.assignedAgentId = context.agentId;

  const limit = Math.min(Number(input.limit ?? 20), 50);
  const includeActivities = Boolean(input.include_activities);

  try {
    const items = await taskService.listTasks(
      context.organisationId,
      context.subaccountId,
      filters
    );

    const sliced = items.slice(0, limit);

    if (includeActivities) {
      const enriched = await Promise.all(sliced.map(async (item) => {
        const activities = await taskService.listActivities(item.id);
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          brief: item.brief,
          status: item.status,
          priority: item.priority,
          assignedAgent: item.assignedAgent,
          createdAt: item.createdAt,
          activities: activities.slice(0, 5).map(a => ({
            type: a.activityType,
            message: a.message,
            createdAt: a.createdAt,
          })),
        };
      }));
      return { success: true, items: enriched, total: items.length };
    }

    return {
      success: true,
      items: sliced.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        brief: item.brief,
        status: item.status,
        priority: item.priority,
        assignedAgent: item.assignedAgent,
        createdAt: item.createdAt,
      })),
      total: items.length,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to read board: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Write Workspace (add activity)
// ---------------------------------------------------------------------------

async function executeWriteWorkspace(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const activityType = String(input.activity_type ?? 'progress') as 'progress' | 'note' | 'completed' | 'blocked';
  const message = String(input.message ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!message) return { success: false, error: 'message is required' };

  try {
    const activity = await taskService.addActivity(taskId, {
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

// ---------------------------------------------------------------------------
// Trigger Task
// ---------------------------------------------------------------------------

async function executeTriggerProcess(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const processId = String(input.process_id ?? '');
  const inputData = String(input.input_data ?? '{}');
  const reason = String(input.reason ?? '');

  if (!processId) return { success: false, error: 'process_id is required' };

  try {
    // Use a system user ID placeholder for autonomous runs
    const result = await executeTriggerredProcess(
      context.organisationId,
      processId,
      context.agentId, // use agentId as the triggerer for autonomous runs
      inputData
    );

    return {
      success: true,
      execution_id: result.executionId,
      process_name: result.processName,
      status: result.status,
      message: `Process "${result.processName}" has been queued. Execution ID: ${result.executionId}`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to trigger process: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Create Task
// ---------------------------------------------------------------------------

async function executeCreateTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const title = String(input.title ?? '');
  if (!title) return { success: false, error: 'title is required' };

  try {
    const item = await taskService.createTask(
      context.organisationId,
      context.subaccountId,
      {
        title,
        description: input.description ? String(input.description) : undefined,
        brief: input.brief ? String(input.brief) : undefined,
        priority: (input.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
        status: input.status ? String(input.status) : 'inbox',
        assignedAgentId: input.assigned_agent_id ? String(input.assigned_agent_id) : undefined,
        createdByAgentId: context.agentId,
      }
    );

    return {
      success: true,
      task_id: item.id,
      title: item.title,
      status: item.status,
      _created_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Move Task
// ---------------------------------------------------------------------------

async function executeMoveTask(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const status = String(input.status ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!status) return { success: false, error: 'status is required' };

  try {
    // Get current item to find subaccount
    const item = await taskService.getTask(taskId, context.organisationId);
    const position = await taskService._nextPosition(item.subaccountId, status);

    const updated = await taskService.moveTask(
      taskId,
      context.organisationId,
      { status, position }
    );

    return {
      success: true,
      task_id: updated.id,
      new_status: updated.status,
      _updated_task: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to move task: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Add Deliverable
// ---------------------------------------------------------------------------

async function executeAddDeliverable(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const taskId = String(input.task_id ?? '');
  const title = String(input.title ?? '');
  const deliverableType = String(input.deliverable_type ?? 'artifact') as 'file' | 'url' | 'artifact';
  const description = String(input.description ?? '');

  if (!taskId) return { success: false, error: 'task_id is required' };
  if (!title) return { success: false, error: 'title is required' };

  try {
    const deliverable = await taskService.addDeliverable(taskId, {
      deliverableType,
      title,
      description: description || undefined,
    });

    // Also log an activity
    await taskService.addActivity(taskId, {
      activityType: 'deliverable_added',
      message: `Deliverable added: "${title}"`,
      agentId: context.agentId,
    });

    return {
      success: true,
      deliverable_id: deliverable.id,
      _created_deliverable: true,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to add deliverable: ${errMsg}` };
  }
}
