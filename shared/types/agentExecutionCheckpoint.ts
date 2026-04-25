// Persisted in agent_run_snapshots.checkpoint JSONB. Read by server resume path
// and AgentRunLivePage debug surface. Schema files import this directly; services
// may import from here OR from server/services/middleware/types (which re-exports).

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
 * String literal union mirroring `ReviewCodeVerdict` from
 * server/services/middleware/reflectionLoopPure.ts. Defined here
 * so `SerialisableMiddlewareContext` has no transitive server import.
 * Both definitions are structurally identical; TypeScript unifies them.
 */
type ReviewCodeVerdict = 'APPROVE' | 'BLOCKED';

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
