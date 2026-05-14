import type { AgentRunRequest } from '../agentExecutionService.js';
import type { SubaccountAgent } from '../../db/schema/index.js';
import type { ReviewCodeVerdict } from './reflectionLoopPure.js';
import type { PreToolDecision } from '../../../shared/types/agentExecutionCheckpoint.js';

// ---------------------------------------------------------------------------
// Middleware types for the agentic execution pipeline
// ---------------------------------------------------------------------------

export type {
  PreToolDecision,
  SerialisablePreToolDecision,
  SerialisableMiddlewareContext,
  AgentRunCheckpoint,
} from '../../../shared/types/agentExecutionCheckpoint.js';

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
  /**
   * Sprint 3 P2.2 — latest parsed verdict from `review_code`. `null` before
   * the first invocation, `'APPROVE'` or `'BLOCKED'` after. Read by
   * `reflectionLoopMiddleware` to decide whether a subsequent
   * `write_patch` should be allowed to proceed.
   */
  lastReviewCodeVerdict?: ReviewCodeVerdict | null;
  /**
   * Sprint 3 P2.2 — number of times `review_code` has been invoked on this
   * run. Used to enforce `MAX_REFLECTION_ITERATIONS` before escalating to
   * HITL. Incremented inside the reflection middleware.
   */
  reviewCodeIterations?: number;
  /**
   * Sprint 3 P2.3 — latest assistant text content returned by the LLM.
   * Populated by `runAgenticLoop` immediately before the preTool pipeline
   * runs so middlewares (notably `decisionTimeGuidanceMiddleware` and the
   * confidence extractor) can read the `tool_intent` block without a
   * contract widening to include the full message array.
   */
  lastAssistantText?: string;
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

/**
 * Return shape of every postTool middleware. Sprint 3 P2.2 widens the
 * union with two new variants so the reflection loop can drive behaviour
 * without reaching into `runAgenticLoop` directly:
 *
 *   - `inject_message` — append a user-role message to the conversation
 *     and re-run the LLM without executing additional tool calls. Used by
 *     the reflection loop to surface the critique back to the agent.
 *   - `escalate_to_review` — halt the run, create a HITL review item, and
 *     transition the agent run to `awaiting_review`. The middleware does
 *     NOT call `reviewService` directly (that would create a circular
 *     dependency); the loop in `runAgenticLoop` handles the escalation
 *     outside the middleware boundary.
 */
export type PostToolResult =
  | { action: 'continue'; content?: string }
  | { action: 'stop'; reason: string; status: string }
  | { action: 'inject_message'; message: string }
  | { action: 'escalate_to_review'; reason: string };

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
  ): PostToolResult | Promise<PostToolResult>;
}

export interface MiddlewarePipeline {
  preCall: PreCallMiddleware[];
  preTool: PreToolMiddleware[];
  postTool: PostToolMiddleware[];
}

// AgentRunCheckpoint, SerialisableMiddlewareContext, SerialisablePreToolDecision,
// and PreToolDecision have been extracted to shared/types/agentExecutionCheckpoint.ts
// and are re-exported above. Schema files (agentRunSnapshots.ts) import from shared
// directly to satisfy the schema-leaf rule (no schema → services imports).
