import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agents,
  subaccountAgents,
  agentRuns,
  tasks,
  taskActivities,
  taskDeliverables,
} from '../db/schema/index.js';
import { agentService } from './agentService.js';
import { skillService } from './skillService.js';
import { taskService } from './taskService.js';
import {
  callAnthropic,
  buildSystemPrompt,
  getOrgProcessesForTools,
  approxTokens,
  type LLMMessage,
  type AnthropicTool,
} from './llmService.js';
import { skillExecutor } from './skillExecutor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentRunRequest {
  agentId: string;
  subaccountId: string;
  subaccountAgentId: string;
  organisationId: string;
  runType: 'scheduled' | 'manual' | 'triggered';
  executionMode?: 'api' | 'headless';
  taskId?: string;
  triggerContext?: Record<string, unknown>;
}

export interface AgentRunResult {
  runId: string;
  status: 'completed' | 'failed' | 'timeout';
  summary: string | null;
  totalToolCalls: number;
  totalTokens: number;
  durationMs: number;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
}

// ---------------------------------------------------------------------------
// Execution service
// ---------------------------------------------------------------------------

export const agentExecutionService = {
  /**
   * Execute a single agent run. This is the main entry point for autonomous execution.
   */
  async executeRun(request: AgentRunRequest): Promise<AgentRunResult> {
    const startTime = Date.now();

    // ── 1. Create the run record ──────────────────────────────────────────
    const [run] = await db
      .insert(agentRuns)
      .values({
        organisationId: request.organisationId,
        subaccountId: request.subaccountId,
        agentId: request.agentId,
        subaccountAgentId: request.subaccountAgentId,
        runType: request.runType,
        executionMode: request.executionMode ?? 'api',
        status: 'running',
        triggerContext: request.triggerContext ?? null,
        taskId: request.taskId ?? null,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    try {
      // ── 2. Load agent config ────────────────────────────────────────────
      const agent = await agentService.getAgent(request.agentId, request.organisationId);

      const [saLink] = await db
        .select()
        .from(subaccountAgents)
        .where(eq(subaccountAgents.id, request.subaccountAgentId));

      if (!saLink) throw new Error('Subaccount agent link not found');

      const tokenBudget = saLink.tokenBudgetPerRun;
      const maxToolCalls = saLink.maxToolCallsPerRun;
      const timeoutMs = saLink.timeoutSeconds * 1000;

      await db.update(agentRuns).set({ tokenBudget }).where(eq(agentRuns.id, run.id));

      // ── 3. Load training data ───────────────────────────────────────────
      const dataSourceContents = await agentService.fetchAgentDataSources(request.agentId);

      // ── 4. Load org processes for trigger_task skill ────────────────────
      const orgProcesses = await getOrgProcessesForTools(request.organisationId);

      // ── 5. Resolve skills → tools + instructions ────────────────────────
      const skillSlugs = (saLink.skillSlugs as string[]) ?? [];
      const { tools: skillTools, instructions: skillInstructions } = await skillService.resolveSkillsForAgent(
        skillSlugs,
        request.organisationId
      );

      // For trigger_task, inject the task enum dynamically
      const enhancedTools = skillTools.map(tool => {
        if (tool.name === 'trigger_task' && orgProcesses.length > 0) {
          return {
            ...tool,
            input_schema: {
              ...tool.input_schema,
              properties: {
                ...tool.input_schema.properties,
                task_id: {
                  ...tool.input_schema.properties.task_id,
                  enum: orgProcesses.map(t => t.id),
                },
              },
            },
          };
        }
        return tool;
      });

      // ── 6. Build task context ─────────────────────────────────────────
      let workspaceContext = '';
      let targetItem: typeof tasks.$inferSelect | null = null;

      if (request.taskId) {
        const item = await taskService.getTask(request.taskId, request.organisationId);
        targetItem = item;
        workspaceContext = buildTaskContext(item);
      } else {
        // Load recent tasks for general awareness
        const recentItems = await taskService.listTasks(
          request.organisationId,
          request.subaccountId,
          {}
        );
        if (recentItems.length > 0) {
          workspaceContext = buildTaskOverviewContext(recentItems.slice(0, 30));
        }
      }

      // ── 7. Build the full system prompt ─────────────────────────────────
      const basePrompt = buildSystemPrompt(
        agent.masterPrompt,
        dataSourceContents,
        orgProcesses,
      );

      const systemPromptParts = [basePrompt];

      // Add subaccount-specific instructions
      if (saLink.customInstructions) {
        systemPromptParts.push(`\n\n---\n## Additional Instructions\n${saLink.customInstructions}`);
      }

      // Add skill instructions
      if (skillInstructions.length > 0) {
        systemPromptParts.push(`\n\n---\n## Your Capabilities\n${skillInstructions.join('\n\n')}`);
      }

      // Add task context
      if (workspaceContext) {
        systemPromptParts.push(`\n\n---\n## Current Board\n${workspaceContext}`);
      }

      // Add autonomous execution instructions
      systemPromptParts.push(buildAutonomousInstructions(request, targetItem));

      const fullSystemPrompt = systemPromptParts.join('');

      // Snapshot the prompt for logging
      await db.update(agentRuns).set({
        systemPromptSnapshot: fullSystemPrompt,
        skillsUsed: skillSlugs,
      }).where(eq(agentRuns.id, run.id));

      // ── 8. Execute the agentic loop ─────────────────────────────────────
      const loopResult = await runAgenticLoop({
        runId: run.id,
        agent,
        systemPrompt: fullSystemPrompt,
        tools: enhancedTools,
        tokenBudget,
        maxToolCalls,
        timeoutMs,
        startTime,
        request,
        orgProcesses,
      });

      // ── 9. Finalise the run ─────────────────────────────────────────────
      const durationMs = Date.now() - startTime;

      await db.update(agentRuns).set({
        status: 'completed',
        toolCallsLog: loopResult.toolCallsLog,
        totalToolCalls: loopResult.totalToolCalls,
        inputTokens: loopResult.inputTokens,
        outputTokens: loopResult.outputTokens,
        totalTokens: loopResult.totalTokens,
        summary: loopResult.summary,
        tasksCreated: loopResult.tasksCreated,
        tasksUpdated: loopResult.tasksUpdated,
        deliverablesCreated: loopResult.deliverablesCreated,
        completedAt: new Date(),
        durationMs,
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id));

      // Update last run time on the subaccount agent link
      await db.update(subaccountAgents).set({
        lastRunAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(subaccountAgents.id, request.subaccountAgentId));

      return {
        runId: run.id,
        status: 'completed',
        summary: loopResult.summary,
        totalToolCalls: loopResult.totalToolCalls,
        totalTokens: loopResult.totalTokens,
        durationMs,
        tasksCreated: loopResult.tasksCreated,
        tasksUpdated: loopResult.tasksUpdated,
        deliverablesCreated: loopResult.deliverablesCreated,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      await db.update(agentRuns).set({
        status: 'failed',
        errorMessage,
        errorDetail: { error: errorMessage, stack: err instanceof Error ? err.stack : undefined },
        completedAt: new Date(),
        durationMs,
        updatedAt: new Date(),
      }).where(eq(agentRuns.id, run.id));

      return {
        runId: run.id,
        status: 'failed',
        summary: null,
        totalToolCalls: 0,
        totalTokens: 0,
        durationMs,
        tasksCreated: 0,
        tasksUpdated: 0,
        deliverablesCreated: 0,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// The agentic loop — calls LLM, handles tool calls, repeats until done
// ---------------------------------------------------------------------------

interface LoopParams {
  runId: string;
  agent: { modelId: string; temperature: number; maxTokens: number };
  systemPrompt: string;
  tools: AnthropicTool[];
  tokenBudget: number;
  maxToolCalls: number;
  timeoutMs: number;
  startTime: number;
  request: AgentRunRequest;
  orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>;
}

interface LoopResult {
  summary: string | null;
  toolCallsLog: object[];
  totalToolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tasksCreated: number;
  tasksUpdated: number;
  deliverablesCreated: number;
}

async function runAgenticLoop(params: LoopParams): Promise<LoopResult> {
  const {
    runId, agent, systemPrompt, tools, tokenBudget,
    maxToolCalls, timeoutMs, startTime, request, orgProcesses,
  } = params;

  const toolCallsLog: object[] = [];
  let totalToolCalls = 0;
  let totalTokensUsed = 0;
  let tasksCreated = 0;
  let tasksUpdated = 0;
  let deliverablesCreated = 0;

  // Start with the initial instruction message
  const initialMessage = buildInitialMessage(request);
  const messages: LLMMessage[] = [{ role: 'user', content: initialMessage }];

  let lastTextContent = '';
  const MAX_ITERATIONS = 25; // safety limit

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      // Soft stop: add a wrap-up message
      messages.push({
        role: 'user',
        content: 'You have reached the time limit for this run. Please provide a brief summary of what you accomplished and stop.',
      });
      const wrapUp = await callAnthropic({
        modelId: agent.modelId,
        systemPrompt,
        messages,
        temperature: agent.temperature,
        maxTokens: Math.min(agent.maxTokens, 1024),
      });
      lastTextContent = wrapUp.content;
      break;
    }

    // Check token budget (soft stop)
    if (totalTokensUsed >= tokenBudget) {
      messages.push({
        role: 'user',
        content: 'You have reached your token budget for this run. Please provide a brief summary of what you accomplished and stop.',
      });
      const wrapUp = await callAnthropic({
        modelId: agent.modelId,
        systemPrompt,
        messages,
        temperature: agent.temperature,
        maxTokens: Math.min(agent.maxTokens, 1024),
      });
      lastTextContent = wrapUp.content;
      // Estimate tokens for the wrap-up
      totalTokensUsed += approxTokens(wrapUp.content) + approxTokens(messages[messages.length - 1].content as string);
      break;
    }

    // Check tool call limit
    if (totalToolCalls >= maxToolCalls) {
      messages.push({
        role: 'user',
        content: 'You have reached the maximum number of tool calls for this run. Please provide a brief summary of what you accomplished and stop.',
      });
      const wrapUp = await callAnthropic({
        modelId: agent.modelId,
        systemPrompt,
        messages,
        temperature: agent.temperature,
        maxTokens: Math.min(agent.maxTokens, 1024),
      });
      lastTextContent = wrapUp.content;
      break;
    }

    // Call LLM
    const response = await callAnthropic({
      modelId: agent.modelId,
      systemPrompt,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
    });

    // Estimate token usage (rough: input + output)
    const estimatedInputTokens = approxTokens(JSON.stringify(messages));
    const estimatedOutputTokens = approxTokens(JSON.stringify(response.content) + JSON.stringify(response.toolCalls ?? ''));
    totalTokensUsed += estimatedInputTokens + estimatedOutputTokens;

    lastTextContent = response.content;

    // No tool calls — agent is done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      break;
    }

    // Build assistant message with tool calls
    const assistantBlocks: LLMMessage['content'] = [];
    if (response.content) assistantBlocks.push({ type: 'text', text: response.content });
    for (const tc of response.toolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    // Execute each tool call
    const toolResults: Array<{ tool_use_id: string; content: string }> = [];

    for (const toolCall of response.toolCalls) {
      totalToolCalls++;
      const toolStart = Date.now();

      let resultContent: string;
      try {
        const result = await skillExecutor.execute({
          skillName: toolCall.name,
          input: toolCall.input,
          context: {
            runId,
            organisationId: request.organisationId,
            subaccountId: request.subaccountId,
            agentId: request.agentId,
            orgProcesses,
          },
        });

        resultContent = typeof result === 'string' ? result : JSON.stringify(result);

        // Track impact
        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (r._created_task) tasksCreated++;
          if (r._updated_task) tasksUpdated++;
          if (r._created_deliverable) deliverablesCreated++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        resultContent = JSON.stringify({ success: false, error: errMsg });
      }

      const toolDurationMs = Date.now() - toolStart;

      toolCallsLog.push({
        tool: toolCall.name,
        input: toolCall.input,
        output: resultContent.length > 2000 ? resultContent.slice(0, 2000) + '...[truncated]' : resultContent,
        durationMs: toolDurationMs,
        iteration,
      });

      toolResults.push({ tool_use_id: toolCall.id, content: resultContent });
    }

    // Add tool results as a user message
    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result' as const,
        tool_use_id: tr.tool_use_id,
        content: tr.content,
      })),
    });
  }

  return {
    summary: lastTextContent || null,
    toolCallsLog,
    totalToolCalls,
    inputTokens: Math.floor(totalTokensUsed * 0.7), // rough split
    outputTokens: Math.floor(totalTokensUsed * 0.3),
    totalTokens: totalTokensUsed,
    tasksCreated,
    tasksUpdated,
    deliverablesCreated,
  };
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

function buildTaskContext(item: Record<string, unknown>): string {
  const parts: string[] = [];
  parts.push(`### Target Task`);
  parts.push(`- **Title**: ${item.title}`);
  parts.push(`- **ID**: ${item.id}`);
  parts.push(`- **Status**: ${item.status}`);
  parts.push(`- **Priority**: ${item.priority}`);
  if (item.description) parts.push(`- **Description**: ${item.description}`);
  if (item.brief) parts.push(`- **Brief**: ${item.brief}`);

  if (item.activities && Array.isArray(item.activities)) {
    parts.push('\n#### Recent Activity');
    for (const act of (item.activities as Array<Record<string, unknown>>).slice(0, 10)) {
      parts.push(`- [${act.activityType}] ${act.message} (${act.createdAt})`);
    }
  }

  if (item.deliverables && Array.isArray(item.deliverables)) {
    parts.push('\n#### Existing Deliverables');
    for (const del of item.deliverables as Array<Record<string, unknown>>) {
      parts.push(`- ${del.title} (${del.deliverableType})`);
    }
  }

  return parts.join('\n');
}

function buildTaskOverviewContext(items: Array<Record<string, unknown>>): string {
  const byStatus: Record<string, Array<Record<string, unknown>>> = {};
  for (const item of items) {
    const status = String(item.status ?? 'unknown');
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(item);
  }

  const parts: string[] = ['### Board Overview'];
  for (const [status, statusItems] of Object.entries(byStatus)) {
    parts.push(`\n**${status}** (${statusItems.length} items):`);
    for (const item of statusItems.slice(0, 5)) {
      const agent = item.assignedAgent as Record<string, unknown> | null;
      parts.push(`- [${item.id}] ${item.title}${item.priority !== 'normal' ? ` (${item.priority})` : ''}${agent ? ` → ${agent.name}` : ''}`);
    }
    if (statusItems.length > 5) {
      parts.push(`  ... and ${statusItems.length - 5} more`);
    }
  }

  return parts.join('\n');
}

function buildAutonomousInstructions(request: AgentRunRequest, targetItem: Record<string, unknown> | null): string {
  const parts: string[] = ['\n\n---\n## Execution Mode: Autonomous Run'];

  parts.push('You are running autonomously (not in a conversation with a user).');
  parts.push(`This is a ${request.runType} run.`);

  if (targetItem) {
    parts.push(`\nYou have been assigned to work on the task: "${targetItem.title}" (ID: ${targetItem.id}).`);
    parts.push('Your workflow:');
    parts.push('1. Read the task details and any existing activities/deliverables');
    parts.push('2. Move the task to "in_progress" if it is not already');
    parts.push('3. Do the work described in the brief/description');
    parts.push('4. Log your progress as activities on the task');
    parts.push('5. When done, attach your output as a deliverable');
    parts.push('6. Move the task to "review" for human approval');
    parts.push('7. Provide a summary of what you did');
  } else {
    parts.push('\nYou are running a general check. Review the board, do your job based on your role, and take appropriate actions.');
    parts.push('Check for tasks assigned to you, look for things that need attention, and proactively do useful work.');
  }

  parts.push('\nIMPORTANT:');
  parts.push('- Always provide a clear summary at the end of your run');
  parts.push('- Log all significant actions as task activities');
  parts.push('- Attach deliverables for any content you produce');
  parts.push('- Move tasks to "review" when ready for human approval — never to "done"');

  return parts.join('\n');
}

function buildInitialMessage(request: AgentRunRequest): string {
  if (request.taskId) {
    return `You have a task assigned to you. Please work on it now. The task details are in your system context above.`;
  }

  const messages: Record<string, string> = {
    scheduled: 'This is your scheduled run. Check the board, review any tasks assigned to you, and do your job. Take actions based on your role and current board state.',
    manual: 'You have been manually triggered. Check the board and take appropriate actions based on your role.',
    triggered: 'You have been triggered by an event. Check the trigger context and board, then take appropriate actions.',
  };

  return messages[request.runType] ?? messages.manual;
}
