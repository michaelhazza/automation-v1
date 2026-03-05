import { env } from '../lib/env.js';
import { db } from '../db/index.js';
import { tasks, executions } from '../db/schema/index.js';
import { eq, and, isNull } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | LLMContentBlock[];
}

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
}

// ---------------------------------------------------------------------------
// Token budget helpers (1 token ≈ 4 chars)
// ---------------------------------------------------------------------------

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[Content truncated to fit context window]';
}

// ---------------------------------------------------------------------------
// Task tool definition for agent-to-task chaining
// ---------------------------------------------------------------------------

export function buildTaskTools(orgTasks: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>): AnthropicTool[] {
  if (orgTasks.length === 0) return [];

  return [
    {
      name: 'trigger_task',
      description: 'Trigger an automation task/workflow. Use this when the user asks you to run, execute, or trigger a specific automation. Always confirm with the user before triggering unless they explicitly asked you to do it.',
      input_schema: {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The ID of the task to trigger',
            enum: orgTasks.map((t) => t.id),
          },
          task_name: {
            type: 'string',
            description: 'The human-readable name of the task being triggered',
          },
          input_data: {
            type: 'string',
            description: 'JSON string of input data to pass to the task. Use {} if no input is needed.',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of why you are triggering this task',
          },
        },
        required: ['task_id', 'task_name', 'input_data', 'reason'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Fetch available tasks for an organisation (for tool use context)
// ---------------------------------------------------------------------------

export async function getOrgTasksForTools(
  organisationId: string
): Promise<Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>> {
  const rows = await db
    .select({
      id: tasks.id,
      name: tasks.name,
      description: tasks.description,
      inputSchema: tasks.inputSchema,
    })
    .from(tasks)
    .where(and(eq(tasks.organisationId, organisationId), eq(tasks.status, 'active'), isNull(tasks.deletedAt)));

  return rows;
}

// ---------------------------------------------------------------------------
// Execute a triggered task (creates an execution record)
// ---------------------------------------------------------------------------

export async function executeTriggerredTask(
  organisationId: string,
  taskId: string,
  userId: string,
  inputDataStr: string
): Promise<{ executionId: string; taskName: string; status: string }> {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organisationId, organisationId), isNull(tasks.deletedAt)));

  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status !== 'active') throw new Error(`Task ${task.name} is not active`);

  let inputData: unknown = {};
  try {
    inputData = JSON.parse(inputDataStr);
  } catch {
    inputData = {};
  }

  const { queueService } = await import('./queueService.js');

  const [execution] = await db
    .insert(executions)
    .values({
      organisationId,
      taskId,
      triggeredByUserId: userId,
      status: 'pending',
      inputData: inputData as Record<string, unknown>,
      engineType: 'agent_triggered',
      taskSnapshot: task as unknown as Record<string, unknown>,
      isTestExecution: false,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await queueService.enqueueExecution(execution.id);

  return { executionId: execution.id, taskName: task.name, status: 'queued' };
}

// ---------------------------------------------------------------------------
// Core LLM call (Anthropic Messages API via fetch)
// ---------------------------------------------------------------------------

export async function callAnthropic(params: {
  modelId: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools?: AnthropicTool[];
  temperature: number;
  maxTokens: number;
}): Promise<LLMResponse> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw { statusCode: 503, message: 'ANTHROPIC_API_KEY is not configured. Please set it in your environment.' };
  }

  const body: Record<string, unknown> = {
    model: params.modelId,
    max_tokens: params.maxTokens,
    temperature: params.temperature,
    system: params.systemPrompt,
    messages: params.messages,
  };

  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const err = await response.json() as { error?: { message?: string } };
      errorDetail = err?.error?.message ?? response.statusText;
    } catch {
      errorDetail = response.statusText;
    }
    throw { statusCode: response.status >= 500 ? 503 : 400, message: `Anthropic API error: ${errorDetail}` };
  }

  const data = await response.json() as {
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    stop_reason: string;
  };

  const textBlock = data.content.find((b) => b.type === 'text');
  const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use');

  return {
    content: textBlock?.text ?? '',
    toolCalls: toolUseBlocks.length > 0
      ? toolUseBlocks.map((b) => ({ id: b.id!, name: b.name!, input: b.input! }))
      : undefined,
    stopReason: data.stop_reason,
  };
}

// ---------------------------------------------------------------------------
// Build the formatted system prompt including data source context
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  masterPrompt: string,
  dataSourceContents: Array<{ name: string; description: string | null; content: string; contentType: string }>,
  orgTasks: Array<{ id: string; name: string; description: string | null }>,
  maxDataTokens = 60000
): string {
  const parts: string[] = [masterPrompt.trim()];

  if (dataSourceContents.length > 0) {
    parts.push('\n\n---\n## Your Knowledge Base\n');
    parts.push('The following data has been provided for your context. Use it to answer questions accurately.\n');

    let usedTokens = 0;
    for (const ds of dataSourceContents) {
      const header = `\n### ${ds.name}${ds.description ? `\n${ds.description}` : ''}\n\`\`\`${ds.contentType === 'json' ? 'json' : ds.contentType === 'csv' ? 'csv' : ds.contentType === 'markdown' ? 'markdown' : 'text'}\n`;
      const footer = '\n```\n';
      const available = maxDataTokens - usedTokens;
      if (available <= 0) {
        parts.push(`\n### ${ds.name}\n[Content omitted — context window budget reached]\n`);
        continue;
      }
      const truncated = truncateToTokenBudget(ds.content, available - approxTokens(header + footer));
      parts.push(header + truncated + footer);
      usedTokens += approxTokens(header + truncated + footer);
    }
  }

  if (orgTasks.length > 0) {
    parts.push('\n---\n## Available Automations\n');
    parts.push('You can trigger the following automation tasks when appropriate:\n');
    for (const t of orgTasks) {
      parts.push(`- **${t.name}** (id: \`${t.id}\`)${t.description ? `: ${t.description}` : ''}`);
    }
    parts.push('\nUse the `trigger_task` tool to execute any of these. Always explain what you\'re about to do before triggering.\n');
  }

  return parts.join('');
}

export const llmService = {
  approxTokens,
  truncateToTokenBudget,
  buildTaskTools,
  getOrgTasksForTools,
  executeTriggerredTask,
  callAnthropic,
  buildSystemPrompt,
};
