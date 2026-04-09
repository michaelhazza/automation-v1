import { env } from '../lib/env.js';
import { db } from '../db/index.js';
import { processes, executions, executionPayloads } from '../db/schema/index.js';
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
// Response Mode → temperature mapping
// ---------------------------------------------------------------------------

export type ResponseMode = 'balanced' | 'precise' | 'expressive' | 'highly_creative';
export type OutputSize = 'standard' | 'extended' | 'maximum';

const RESPONSE_MODE_TEMPERATURE: Record<ResponseMode, number> = {
  balanced: 0.7,
  precise: 0,
  expressive: 0.85,
  highly_creative: 1,
};

const OUTPUT_SIZE_MAX_TOKENS: Record<OutputSize, number> = {
  standard: 4096,
  extended: 8192,
  maximum: 16384,
};

/** Resolve a response mode to a temperature value. */
export function resolveTemperature(responseMode: ResponseMode | string, fallback = 0.7): number {
  return RESPONSE_MODE_TEMPERATURE[responseMode as ResponseMode] ?? fallback;
}

/** Resolve an output size to a max_tokens value. */
export function resolveMaxTokens(outputSize: OutputSize | string, fallback = 4096): number {
  return OUTPUT_SIZE_MAX_TOKENS[outputSize as OutputSize] ?? fallback;
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
// Process tool definition for agent-to-process chaining
// ---------------------------------------------------------------------------

export function buildProcessTools(orgProcesses: Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>): AnthropicTool[] {
  if (orgProcesses.length === 0) return [];

  return [
    {
      name: 'trigger_process',
      description: 'Trigger an automation process/workflow. Use this when the user asks you to run, execute, or trigger a specific automation. Always confirm with the user before triggering unless they explicitly asked you to do it.',
      input_schema: {
        type: 'object',
        properties: {
          process_id: {
            type: 'string',
            description: 'The ID of the process to trigger',
            enum: orgProcesses.map((t) => t.id),
          },
          process_name: {
            type: 'string',
            description: 'The human-readable name of the process being triggered',
          },
          input_data: {
            type: 'string',
            description: 'JSON string of input data to pass to the process. Use {} if no input is needed.',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of why you are triggering this process',
          },
        },
        required: ['process_id', 'process_name', 'input_data', 'reason'],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Fetch available processes for an organisation (for tool use context)
// ---------------------------------------------------------------------------

export async function getOrgProcessesForTools(
  organisationId: string
): Promise<Array<{ id: string; name: string; description: string | null; inputSchema: string | null }>> {
  const rows = await db
    .select({
      id: processes.id,
      name: processes.name,
      description: processes.description,
      inputSchema: processes.inputSchema,
    })
    .from(processes)
    .where(and(eq(processes.organisationId, organisationId), eq(processes.status, 'active'), isNull(processes.deletedAt)));

  return rows;
}

// ---------------------------------------------------------------------------
// Execute a triggered process (creates an execution record)
// ---------------------------------------------------------------------------

export async function executeTriggerredProcess(
  organisationId: string,
  processId: string,
  userId: string,
  inputDataStr: string,
  options?: {
    subaccountId?: string;
    triggerType?: 'manual' | 'agent' | 'scheduled' | 'webhook';
    triggerSourceId?: string;
    configOverrides?: Record<string, unknown>;
  }
): Promise<{ executionId: string; processName: string; status: string }> {
  // Support system processes (no orgId) and org processes
  const [process] = await db
    .select()
    .from(processes)
    .where(and(eq(processes.id, processId), isNull(processes.deletedAt)));

  if (!process) throw new Error(`Process ${processId} not found`);
  if (process.organisationId && process.organisationId !== organisationId) {
    throw new Error(`Process ${processId} not found`);
  }
  if (process.status !== 'active') throw new Error(`Process ${process.name} is not active`);

  let inputData: unknown = {};
  try {
    inputData = JSON.parse(inputDataStr);
  } catch {
    inputData = {};
  }

  const { queueService } = await import('./queueService.js');

  const [execution] = await db.transaction(async (tx) => {
    const [exec] = await tx
      .insert(executions)
      .values({
        organisationId,
        processId,
        triggeredByUserId: userId,
        subaccountId: options?.subaccountId ?? null,
        status: 'pending',
        inputData: inputData as Record<string, unknown>,
        engineType: 'agent_triggered',
        isTestExecution: false,
        triggerType: options?.triggerType ?? 'agent',
        triggerSourceId: options?.triggerSourceId ?? null,
        resolvedConfig: options?.configOverrides ?? null,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    await tx.insert(executionPayloads)
      .values({ executionId: exec.id, processSnapshot: process as unknown as Record<string, unknown> })
      .onConflictDoNothing();
    return [exec];
  });

  await queueService.enqueueExecution(execution.id);

  return { executionId: execution.id, processName: process.name, status: 'queued' };
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

// Sprint 3 P2.3 — `tool_intent` convention.
//
// Every tool call the agent emits must be preceded by a `<tool_intent>`
// block in the assistant message so the confidence gate in
// `policyEngineService.evaluatePolicy` can upgrade low-confidence `auto`
// decisions to `review`. The snippet below is appended to every system
// prompt built by `buildSystemPrompt`. It is intentionally short —
// P2.3's thesis is that targeted decision-time guidance beats a bloated
// master prompt, so this is the minimum viable contract: format,
// placement, consequence of omission.
//
// The parser `extractToolIntentConfidence` in
// `agentExecutionServicePure.ts` treats a missing or malformed block as
// "unknown confidence" → auto-upgrade to review (fail closed).
const TOOL_INTENT_CONVENTION_SNIPPET = `

---
## Tool-Intent Convention

Before every tool call you emit, include a \`<tool_intent>\` block in the
same assistant message declaring your self-reported confidence for the
call on a 0..1 scale. Format:

\`\`\`
<tool_intent>
{ "tool": "<tool_slug>", "confidence": 0.0-1.0, "reason": "<one sentence>" }
</tool_intent>
\`\`\`

For plans that chain multiple tools, emit an array inside the same
block. The LAST \`<tool_intent>\` block in your message is authoritative
(you may revise mid-reasoning).

Confidence scoring rubric:
- 0.9–1.0 — you have verified every input, the tool is well understood,
  and there is a strong precedent for this action in the conversation.
- 0.7–0.89 — you are confident but some input was inferred rather than
  explicitly stated.
- 0.5–0.69 — you are proceeding on assumptions that a reviewer should
  sanity-check.
- Below 0.5 — you are guessing; this should almost never be combined
  with an \`auto\`-gated tool.

Omitting the block, malformed JSON, or a missing \`confidence\` field
causes the platform to treat the call as "unknown confidence" and route
it through human review regardless of the policy rule's default. This is
a fail-closed safety rail — it is not a punishment for sloppy output,
it is how the system protects users when it does not know what you
know.
`;

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
    parts.push('\n---\n## Available Processes\n');
    parts.push('You can trigger the following automation processes when appropriate:\n');
    for (const t of orgTasks) {
      parts.push(`- **${t.name}** (id: \`${t.id}\`)${t.description ? `: ${t.description}` : ''}`);
    }
    parts.push('\nUse the `trigger_process` tool to execute any of these. Always explain what you\'re about to do before triggering.\n');
  }

  // Sprint 3 P2.3 — append the tool_intent convention to every system
  // prompt. Kept at the end so the operator's master prompt retains
  // primacy over the convention snippet for human readability.
  parts.push(TOOL_INTENT_CONVENTION_SNIPPET);

  return parts.join('');
}

export const llmService = {
  approxTokens,
  truncateToTokenBudget,
  buildProcessTools,
  getOrgProcessesForTools,
  executeTriggerredProcess,
  callAnthropic,
  buildSystemPrompt,
  resolveTemperature,
  resolveMaxTokens,
};
