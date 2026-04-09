import type { AgentRunRequest } from '../agentExecutionService.js';
import type { SubaccountAgent } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Middleware types for the agentic execution pipeline
// ---------------------------------------------------------------------------

/**
 * Cached decision for a single tool call on a given run. Sprint 2 P1.1 Layer 3
 * requires the preTool middleware to fire exactly once per (runId, toolCallId)
 * tuple even under replays; this cache is the in-memory component of the
 * three-layer idempotency contract. See docs/improvements-roadmap-spec.md
 * §P1.1 Layer 3 ("Idempotency contract — mandatory").
 */
export type PreToolDecision =
  | { action: 'continue' }
  | { action: 'skip'; reason: string; injectMessage?: string }
  | { action: 'stop'; reason: string; status: string }
  | { action: 'inject_message'; message: string }
  | { action: 'block'; reason: string };

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
  // Context pressure warning flags
  _softWarningIssued?: boolean;
  _criticalWarningIssued?: boolean;
  // Cycle detection cooldown flag
  _cycleWarningIssued?: boolean;
  /**
   * In-memory decision cache for the preTool middleware pipeline. Keyed by
   * `toolCallId`. First middleware invocation for a tool call writes to the
   * map; subsequent invocations replay the cached decision without re-calling
   * the underlying policy engine / DB layer. See `PreToolDecision`.
   */
  preToolDecisions: Map<string, PreToolDecision>;
}

export type PreCallResult =
  | { action: 'continue' }
  | { action: 'stop'; reason: string; status: string }
  | { action: 'inject_message'; message: string };

/**
 * Return shape of every preTool middleware. Sprint 2 P1.1 Layer 3 expands the
 * union from the three-variant "continue/skip/stop" shape to the five-variant
 * shape below. New variants:
 *
 *   - `inject_message` — append a user-role message and re-run the LLM without
 *     executing the pending tool call. Reserved for later middlewares that
 *     want to steer the agent; the P1.1 proposeAction middleware does not emit
 *     this today.
 *   - `block` — hard-deny a tool call via the policy / scope layer. Emitted
 *     by the P1.1 Layer 3 proposeAction middleware when the policy engine or
 *     scope validator refuses the call. Semantically equivalent to `skip`
 *     with a `policy_block` / `scope_violation` reason from the executor's
 *     perspective; kept as a distinct variant so post-hoc analysis can
 *     separate "middleware told the agent to back off" from
 *     "policy engine refused".
 */
export type PreToolResult =
  | { action: 'continue' }
  | { action: 'skip'; reason: string; injectMessage?: string }
  | { action: 'stop'; reason: string; status: string }
  | { action: 'inject_message'; message: string }
  | { action: 'block'; reason: string };

export type PostToolResult =
  | { action: 'continue'; content?: string }
  | { action: 'stop'; reason: string; status: string };

export interface PreCallMiddleware {
  name: string;
  execute(ctx: MiddlewareContext): PreCallResult;
}

/**
 * preTool middleware contract. The execute() method is async because some
 * middlewares (notably the P1.1 Layer 3 proposeActionMiddleware) need to call
 * out to the policy engine and the database before returning a decision.
 * Synchronous middlewares may return a plain `PreToolResult` and rely on
 * Promise coercion via `Promise.resolve(...)`.
 */
export interface PreToolMiddleware {
  name: string;
  execute(
    ctx: MiddlewareContext,
    toolCall: { id: string; name: string; input: Record<string, unknown> }
  ): PreToolResult | Promise<PreToolResult>;
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
