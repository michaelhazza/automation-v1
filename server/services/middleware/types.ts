import type { AgentRunRequest } from '../agentExecutionService.js';
import type { SubaccountAgent } from '../../db/schema/index.js';
import type { ReviewCodeVerdict } from './reflectionLoopPure.js';

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
  ): PostToolResult;
}

export interface MiddlewarePipeline {
  preCall: PreCallMiddleware[];
  preTool: PreToolMiddleware[];
  postTool: PostToolMiddleware[];
}

// ---------------------------------------------------------------------------
// Sprint 3 P2.1 Sprint 3A — checkpoint + serialisable middleware context
//
// The checkpoint is the structured payload written to
// `agent_run_snapshots.checkpoint` after every iteration of
// `runAgenticLoop`. It captures just enough state to resume the run on
// a different worker. Sprint 3A lands the write path; Sprint 3B wires
// the resume path to an HTTP endpoint + pg-boss job.
//
// Invariants:
//   * `version: 1` — bumped every time the checkpoint shape changes in
//     a breaking way. The resume path asserts the version before
//     rehydrating.
//   * `messageCursor` — last-written `agent_run_messages.sequence_number`
//     for this run. Resume streams messages `>= 0, <= messageCursor`.
//   * `middlewareContext` — ONLY the serialisable subset of
//     `MiddlewareContext`. Ephemeral fields (Map-backed caches, open
//     handles, startTime / timeoutMs which get recomputed on resume)
//     are explicitly excluded.
//   * `configVersion` — hash of the `agent_runs.configSnapshot` row
//     computed via the existing fingerprint helper (see
//     regressionCaptureServicePure.ts). Resume asserts that
//     `hash(current configSnapshot) === checkpoint.configVersion`
//     before rehydrating — if they differ, the run was configured
//     differently when it was paused and we refuse to resume.
// ---------------------------------------------------------------------------

/**
 * Serialisable subset of `PreToolDecision` — the shape that can
 * survive a JSON round-trip inside `SerialisableMiddlewareContext`.
 * Strips nothing today (all `PreToolDecision` variants are plain
 * data), but the alias exists so future additions that carry
 * promises / closures can diverge cleanly without breaking the
 * checkpoint contract.
 */
export type SerialisablePreToolDecision = PreToolDecision;

/**
 * Serialisable subset of `MiddlewareContext`. Includes only fields
 * that survive a worker restart. Ephemeral fields (Map-backed caches,
 * `startTime`, `timeoutMs`, `tokenBudget`, request handle, agent
 * handle, saLink) are rehydrated on resume from the `agent_runs` row
 * and the live runtime defaults.
 *
 * The `preToolDecisions` field is serialised as a plain object keyed
 * on toolCallId because `Map<K,V>` does not survive JSON round-trip.
 */
export interface SerialisableMiddlewareContext {
  /**
   * Schema version stamp — matches `MIDDLEWARE_CONTEXT_VERSION` in
   * server/config/limits.ts. The resume path asserts equality before
   * rehydrating to reject checkpoints from an older runtime.
   */
  middlewareVersion: number;
  iteration: number;
  tokensUsed: number;
  toolCallsCount: number;
  toolCallHistory: Array<{ name: string; inputHash: string; iteration: number }>;
  /**
   * Sprint 3 P2.2 — last parsed `review_code` verdict for the run.
   * Preserved across resumes so the reflection loop does not lose
   * track of a prior APPROVE / BLOCKED decision.
   */
  lastReviewCodeVerdict?: ReviewCodeVerdict | null;
  /**
   * Sprint 3 P2.2 — count of `review_code` invocations for the run.
   * Preserved so `MAX_REFLECTION_ITERATIONS` is honoured across
   * pauses.
   */
  reviewCodeIterations?: number;
  /**
   * Sprint 3 P2.3 — latest assistant text surface for the confidence
   * extractor. Preserved so a resumed run can re-parse the last
   * tool_intent block without waiting for a new LLM turn.
   */
  lastAssistantText?: string;
  /**
   * Serialised form of `MiddlewareContext.preToolDecisions`. Keys are
   * `toolCallId`; values carry the plain-data `PreToolDecision`
   * union. Empty object for fresh runs.
   */
  preToolDecisions?: Record<string, SerialisablePreToolDecision>;
}

/**
 * Structured checkpoint payload. Written once per iteration to
 * `agent_run_snapshots.checkpoint`. The Sprint 3B resume path reads
 * this, asserts `configVersion`, rehydrates `MiddlewareContext`, and
 * re-enters `runAgenticLoop` at `iteration + 1`.
 */
export interface AgentRunCheckpoint {
  /** Schema version. Bumped on any breaking shape change. */
  version: 1;
  /**
   * Iteration number that JUST COMPLETED. Resume starts at
   * `iteration + 1`. For a run that has not yet completed its first
   * iteration, no checkpoint is written.
   */
  iteration: number;
  /**
   * Total number of tool calls executed across all iterations so
   * far. Mirrors `MiddlewareContext.toolCallsCount`.
   */
  totalToolCalls: number;
  /**
   * Total tokens consumed so far. Mirrors
   * `MiddlewareContext.tokensUsed`. Resume carries this forward so
   * the budget check middleware has an accurate starting count.
   */
  totalTokensUsed: number;
  /**
   * Highest `agent_run_messages.sequence_number` written for this
   * run at the moment the checkpoint was captured. The resume path
   * streams `sequence_number <= messageCursor` to rebuild the
   * in-memory messages array.
   *
   * A value of `-1` is the "no messages written yet" sentinel — the
   * loop initialises the cursor to `-1` and only advances it after a
   * successful append. The resume path treats `< 0` as "skip the
   * stream" rather than issuing a `<= -1` range read. Do NOT clamp
   * this to `0` at write time: that would conflate a fresh run with
   * one that has persisted a single message at sequence 0.
   */
  messageCursor: number;
  /** Serialised middleware context (see above). */
  middlewareContext: SerialisableMiddlewareContext;
  /**
   * Optional — when the checkpoint was captured immediately after
   * executing a specific tool call, the id is recorded here so the
   * resume path can assert the message log lines up exactly.
   */
  lastCompletedToolCallId?: string;
  /**
   * Opaque token that a resumer must present to re-enter the run.
   * Sprint 3A generates it but does not enforce it — Sprint 3B wires
   * the enforcement in the admin resume endpoint.
   */
  resumeToken: string;
  /**
   * Hash of `agent_runs.configSnapshot` computed via the fingerprint
   * helper. The resume path recomputes the hash over the current
   * `configSnapshot` and refuses to resume if the two disagree.
   */
  configVersion: string;
}
