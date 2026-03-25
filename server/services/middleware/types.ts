import type { AgentRunRequest } from '../agentExecutionService.js';
import type { SubaccountAgent } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Middleware types for the agentic execution pipeline
// ---------------------------------------------------------------------------

export interface MiddlewareContext {
  runId: string;
  request: AgentRunRequest;
  agent: { modelId: string; temperature: number; maxTokens: number };
  saLink: SubaccountAgent;
  tokensUsed: number;
  toolCallsCount: number;
  toolCallHistory: Array<{ name: string; inputHash: string; iteration: number }>;
  iteration: number;
  startTime: number;
  tokenBudget: number;
  maxToolCalls: number;
  timeoutMs: number;
}

export type PreCallResult =
  | { action: 'continue' }
  | { action: 'stop'; reason: string; status: string };

export type PreToolResult =
  | { action: 'continue' }
  | { action: 'skip'; reason: string }
  | { action: 'stop'; reason: string; status: string };

export type PostToolResult =
  | { action: 'continue'; content?: string }
  | { action: 'stop'; reason: string; status: string };

export interface PreCallMiddleware {
  name: string;
  execute(ctx: MiddlewareContext): PreCallResult;
}

export interface PreToolMiddleware {
  name: string;
  execute(
    ctx: MiddlewareContext,
    toolCall: { name: string; input: Record<string, unknown> }
  ): PreToolResult;
}

export interface PostToolMiddleware {
  name: string;
  execute(
    ctx: MiddlewareContext,
    toolCall: { name: string; input: Record<string, unknown> },
    result: { content: string; durationMs: number }
  ): PostToolResult;
}

export interface MiddlewarePipeline {
  preCall: PreCallMiddleware[];
  preTool: PreToolMiddleware[];
  postTool: PostToolMiddleware[];
}
