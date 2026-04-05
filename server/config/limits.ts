// ---------------------------------------------------------------------------
// Centralised configuration constants for the autonomous agent system
// ---------------------------------------------------------------------------

/** Maximum iterations in the agentic tool-call loop */
export const MAX_LOOP_ITERATIONS = 25;

/** Maximum handoff depth before chain is rejected */
export const MAX_HANDOFF_DEPTH = 5;

/** Maximum number of times a tool can be called with identical input before loop detection triggers */
export const MAX_TOOL_REPEATS = 3;

// ── Token & context limits ──────────────────────────────────────────────────

/** Max tokens for the wrap-up/summary call when a budget or timeout fires */
export const WRAP_UP_MAX_TOKENS = 1024;

/** Max tokens for the memory insight extraction LLM call */
export const EXTRACTION_MAX_TOKENS = 1024;

/** Max tokens for the memory summary regeneration LLM call */
export const SUMMARY_MAX_TOKENS = 2048;

/** Max tokens for the board summary generation LLM call */
export const BOARD_SUMMARY_MAX_TOKENS = 512;

/** Rough token estimation split: proportion attributed to input */
export const TOKEN_INPUT_RATIO = 0.7;

/** Rough token estimation split: proportion attributed to output */
export const TOKEN_OUTPUT_RATIO = 0.3;

// ── Model defaults ──────────────────────────────────────────────────────────

// EXTRACTION_MODEL removed — internal extraction calls now use executionPhase: 'execution'
// and the resolver picks the cheapest economy model dynamically.

// ── Pagination & list limits ────────────────────────────────────────────────

/** Default page size for memory entry listing */
export const DEFAULT_ENTRY_LIMIT = 50;

/** Maximum page size for memory entry listing */
export const MAX_ENTRY_LIMIT = 100;

/** Default task limit for workspace read skill */
export const DEFAULT_TASK_READ_LIMIT = 20;

/** Maximum task limit for workspace read skill */
export const MAX_TASK_READ_LIMIT = 50;

/** Max other in-progress tasks shown in board context */
export const MAX_CROSS_AGENT_TASKS = 5;

// ── Input validation ────────────────────────────────────────────────────────

/** Maximum character length for a manually edited memory summary */
export const MAX_SUMMARY_LENGTH = 10_000;

/** Maximum character length for a task title created via skill */
export const MAX_TASK_TITLE_LENGTH = 500;

/** Maximum character length for a task description created via skill */
export const MAX_TASK_DESCRIPTION_LENGTH = 5_000;

/** Maximum character length for tool call output stored in logs */
export const MAX_TOOL_OUTPUT_LOG_LENGTH = 2000;

// ── Memory entry types ──────────────────────────────────────────────────────

export const VALID_ENTRY_TYPES = ['observation', 'decision', 'preference', 'issue', 'pattern'] as const;
export type EntryType = typeof VALID_ENTRY_TYPES[number];

// ── Valid task priorities ───────────────────────────────────────────────────

export const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = typeof VALID_PRIORITIES[number];

// ── Sub-agent spawning ──────────────────────────────────────────────────────

/** Maximum number of sub-agents per spawn call */
export const MAX_SUB_AGENTS = 3;

/** Divisor for child timeout (parent remaining time / this = child timeout) */
export const SUB_AGENT_TIMEOUT_BUFFER = 1.5;

/** Minimum token budget per child to allow spawning */
export const MIN_SUB_AGENT_TOKEN_BUDGET = 5000;

// ── Scheduled tasks ─────────────────────────────────────────────────────────

/** Default retry policy for scheduled tasks */
export const DEFAULT_RETRY_POLICY = {
  maxRetries: 1,
  backoffMinutes: 5,
  pauseAfterConsecutiveFailures: 3,
} as const;

// ── Phase 1A: Memory quality scoring ───────────────────────────────────────

/** Minimum content length (chars) for a memory entry to be scored; shorter = score 0 */
export const MIN_MEMORY_CONTENT_LENGTH = 40;

// ── Phase 1B: Entity extraction ─────────────────────────────────────────────

/** Max entities injected into agent prompt */
export const MAX_PROMPT_ENTITIES = 10;

/** Max entities extracted per run */
export const MAX_ENTITIES_PER_EXTRACTION = 10;

/** Minimum LLM confidence to store an entity (0.0–1.0) */
export const MIN_ENTITY_CONFIDENCE = 0.7;

/** Max attribute keys stored per entity */
export const MAX_ENTITY_ATTRIBUTES = 10;

// ── Phase 1C: Provider fallback ─────────────────────────────────────────────

/** Max retries per provider before moving to the next */
export const PROVIDER_MAX_RETRIES = 2;

/** Backoff delays (ms) between retries */
export const PROVIDER_BACKOFF_MS = [1000, 3000] as const;

/** Ordered fallback chain of provider names */
export const PROVIDER_FALLBACK_CHAIN = ['anthropic', 'openai', 'gemini', 'openrouter'] as const;

/** Timeout (ms) for a single provider call before it's treated as a failure */
export const PROVIDER_CALL_TIMEOUT_MS = 30000;

/** How long (ms) a provider stays in cooldown after exhausting retries */
export const PROVIDER_COOLDOWN_MS = 60000;

// ── Phase 2A: Vector memory search ──────────────────────────────────────────

/** Max memory entries returned by vector search */
export const VECTOR_SEARCH_LIMIT = 5;

/** Minimum cosine similarity for a result to be included */
export const VECTOR_SIMILARITY_THRESHOLD = 0.75;

/** Only search entries created within this many days */
export const VECTOR_SEARCH_RECENCY_DAYS = 90;

/** Max chars of the compiled summary included alongside semantic results */
export const ABBREVIATED_SUMMARY_LENGTH = 500;

/** Minimum task context length (chars) required to run vector search */
export const MIN_QUERY_CONTEXT_LENGTH = 20;

// ── Phase 1A: HITL review gate ───────────────────────────────────────────────

/**
 * How long (ms) the agent blocks waiting for a human to approve/reject a
 * review-gated action before the decision times out as rejected.
 * Default: 30 minutes. Override per-rule via policy_rules.timeout_seconds.
 */
export const HITL_REVIEW_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── Phase 2B: Event-based triggers ──────────────────────────────────────────

/** Max triggered agent runs per minute per workspace before suppression */
export const MAX_TRIGGERED_RUNS_PER_MINUTE = 10;

// ── Tracing limits (Section 7.7) ───────────────────────────────────────────

/** Max spans emitted per agent run before helpers return no-ops */
export const MAX_SPANS_PER_RUN = 500;

/** Max total observations (spans + events) per agent run */
export const MAX_EVENTS_PER_RUN = 1000;

/** Max nesting depth from trace root — flatten if exceeded */
export const MAX_NESTING_DEPTH = 10;

/** Max JSON-serialised metadata size per span (bytes) */
export const MAX_METADATA_SIZE_BYTES = 4096;

/** Max events emitted within a single loop iteration */
export const MAX_EVENTS_PER_ITERATION = 20;
