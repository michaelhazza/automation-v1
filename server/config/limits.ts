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

// ── Context data source retrieval limits (spec §8.3) ───────────────────────

/**
 * Maximum number of read_data_source `op: 'read'` calls allowed per agent run.
 * Prevents runaway loops and caps the cumulative tool-call cost of context
 * retrieval. The list op is unlimited because it's cheap.
 */
export const MAX_READ_DATA_SOURCE_CALLS_PER_RUN = 20;

/**
 * Maximum tokens returned by a single read_data_source `op: 'read'` call.
 * Enforced as a hard ceiling: even if the caller passes a larger `limit`,
 * the response is clamped to this value. Sources larger than this must be
 * walked via the offset/limit continuation pattern.
 *
 * Chosen to be well under the smallest typical context window so a single
 * read never blows the conversation.
 */
export const MAX_READ_DATA_SOURCE_TOKENS_PER_CALL = 15000;

/**
 * Maximum tokens rendered into the "## Your Knowledge Base" block via the
 * pre-prompt budget walk in loadRunContextData. Matches the existing
 * maxDataTokens default in llmService.buildSystemPrompt — the upstream walk
 * is the primary enforcement, the downstream truncation is a safety net.
 */
export const MAX_EAGER_BUDGET = 60000;

/**
 * Maximum number of lazy manifest entries rendered INTO the system prompt's
 * "## Available Context Sources" block. Entries beyond this cap are still
 * accessible via read_data_source op='list' — the cap only affects inline
 * visibility in the prompt to keep runs with large manifests compact.
 */
export const MAX_LAZY_MANIFEST_ITEMS_IN_PROMPT = 25;

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

// ── Phase 1B: Dominance-ratio confidence gating ────────────────────────────

/**
 * Minimum ratio of top-1 score / top-2 score before the retrieval is
 * considered confident. Below this threshold, reranking and graph expansion
 * are skipped to prevent amplifying ambiguous results.
 */
export const DOMINANCE_THRESHOLD = 1.2;

/**
 * Minimum absolute combined_score the top result must reach before graph
 * expansion is allowed. Prevents expansion from weak seeds — a dominant
 * result that is still low-quality overall should not trigger relational
 * expansion. Complements DOMINANCE_THRESHOLD (relative) with an absolute floor.
 */
export const EXPANSION_MIN_SCORE = 0.05;

// ── Phase 2D: Agent briefing ────────────────────────────────────────────────

/** Hard token cap for stored briefings. Anything above is truncated. */
export const BRIEFING_TOKEN_HARD_CAP = 1200;

/** Number of recent high-quality memory entries to feed the briefing LLM. */
export const BRIEFING_MEMORY_ENTRIES_LIMIT = 5;

/** Minimum quality score for memory entries included in briefing context. */
export const BRIEFING_MEMORY_QUALITY_THRESHOLD = 0.5;

// ── Agent Beliefs (Phase 1) ────────────────────────────────────────────────

/** Max beliefs extracted per run. */
export const BELIEFS_MAX_PER_EXTRACTION = 10;

/** Max active beliefs per agent-subaccount pair. Excess soft-deleted by confidence. */
export const BELIEFS_MAX_ACTIVE = 50;

/** Max character length for a single belief value. Enforced by truncation at merge. */
export const BELIEFS_MAX_VALUE_LENGTH = 500;

/** Beliefs below this confidence are soft-deleted during post-merge cleanup. */
export const BELIEFS_CONFIDENCE_FLOOR = 0.1;

/** Confidence boost per reinforcement (same value confirmed again). */
export const BELIEFS_CONFIDENCE_BOOST = 0.05;

/** Agent-written beliefs cannot exceed this confidence. User overrides stay at 1.0. */
export const BELIEFS_CONFIDENCE_CEILING = 0.9;

/** Minimum LLM confidence to honour a 'remove' action. LLMs infer absence poorly. */
export const BELIEFS_REMOVE_MIN_CONFIDENCE = 0.8;

/** On value change (update), confidence is capped at this level. Prevents oscillation. */
export const BELIEFS_UPDATE_CONFIDENCE_CAP = 0.7;

/** Max tokens for the full belief set injected into the prompt. */
export const BELIEFS_TOKEN_BUDGET = 1500;

// ── Phase 2A: Vector memory search ──────────────────────────────────────────

/** Max memory entries returned by vector search */
export const VECTOR_SEARCH_LIMIT = 5;

/** Minimum cosine similarity for a result to be included (legacy, used as fallback) */
export const VECTOR_SIMILARITY_THRESHOLD = 0.75;

/** Only search entries created within this many days */
export const VECTOR_SEARCH_RECENCY_DAYS = 90;

/** Max chars of the compiled summary included alongside semantic results */
export const ABBREVIATED_SUMMARY_LENGTH = 500;

/** Minimum task context length (chars) required to run vector search */
export const MIN_QUERY_CONTEXT_LENGTH = 20;

// ── Hybrid Search / RRF (Phase B2) ────────────────────────────────────────

/** Retrieve N * multiplier from each source for RRF fusion */
export const RRF_OVER_RETRIEVE_MULTIPLIER = 4;

/** RRF constant k (higher = more weight to lower-ranked results) */
export const RRF_K = 60;

/** Minimum RRF score to include in results (drops low-quality tail) */
export const RRF_MIN_SCORE = 0.005;

/** Hard cap on candidate pool for hybrid search */
export const MAX_MEMORY_SCAN = 1000;

/** Max chars for embedding input (context + content) */
export const MAX_EMBEDDING_INPUT_CHARS = 2000;

/** Max chars for query text passed to plainto_tsquery */
export const MAX_QUERY_TEXT_CHARS = 500;

/** Scoring weights per retrieval profile */
export const RRF_WEIGHTS = {
  general:  { rrf: 0.70, quality: 0.15, recency: 0.15 },
  factual:  { rrf: 0.80, quality: 0.15, recency: 0.05 },
  temporal: { rrf: 0.50, quality: 0.10, recency: 0.40 },
} as const;

export type RetrievalProfile = keyof typeof RRF_WEIGHTS;

// ── Reranking (Phase B3) ──────────────────────────────────────────────────

/** Reranker provider: 'cohere' | 'none' */
export const RERANKER_PROVIDER = (process.env.RERANKER_PROVIDER ?? 'none') as 'cohere' | 'none';

/** Reranker model name */
export const RERANKER_MODEL = process.env.RERANKER_MODEL ?? 'rerank-v3.5';

/** Final result count after reranking */
export const RERANKER_TOP_N = 5;

/** Over-retrieve this many from hybrid search before reranking */
export const RERANKER_CANDIDATE_COUNT = 20;

/** Abort reranker if slower than this (ms) */
export const RERANKER_TIMEOUT_MS = 500;

/** Max rerank API calls per agent run */
export const RERANKER_MAX_CALLS_PER_RUN = 3;

// ── Query Expansion / HyDE (Phase B4) ─────────────────────────────────────

/** Queries shorter than this (chars) trigger HyDE */
export const HYDE_THRESHOLD = 100;

/** Max tokens for HyDE response */
export const HYDE_MAX_TOKENS = 200;

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

// ── MCP Client limits ──────────────────────────────────────────────────────

/** Max MCP tools merged into an agent's tool set per run */
export const MAX_MCP_TOOLS_PER_RUN = 30;

/** Max MCP tool calls per agent run (separate from total tool call limit) */
export const MAX_MCP_CALLS_PER_RUN = 10;

/** Connection timeout (ms) per MCP server */
export const MCP_CONNECT_TIMEOUT_MS = 10_000;

/** Per-call timeout (ms) for MCP tool invocations */
export const MCP_CALL_TIMEOUT_MS = 30_000;

/** Max response size (bytes) from an MCP tool before truncation */
export const MAX_MCP_RESPONSE_SIZE = 100_000;

/** Consecutive failures before circuit breaker opens */
export const MCP_CIRCUIT_BREAKER_THRESHOLD = 3;

/** Circuit breaker open duration (ms) */
export const MCP_CIRCUIT_BREAKER_DURATION_MS = 5 * 60 * 1000;

/** Warm cache TTL (ms) for discovered tools */
export const MCP_TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Allowed commands for stdio MCP servers */
export const MCP_ALLOWED_COMMANDS = new Set(['npx', 'node', 'docker', 'uvx', 'python3']);

// ── Sprint 2 — P1.1 Layer 3 security event retention ───────────────────────

/**
 * Default retention window (days) for tool_call_security_events rows. The
 * nightly security-events-cleanup pg-boss job prunes rows older than this.
 * Per-org overrides live on organisations.security_event_retention_days —
 * NULL uses this default.
 */
export const DEFAULT_SECURITY_EVENT_RETENTION_DAYS = 30;

/**
 * Upper bound on per-org security event retention. Prevents an org from
 * configuring a runaway retention window that blows up the table.
 */
export const MAX_SECURITY_EVENT_RETENTION_DAYS = 365;

// ── Sprint 2 — P1.2 regression capture ─────────────────────────────────────

/**
 * Default cap on the number of regression_cases rows per agent. When a
 * new case would exceed the cap the oldest `active` case is retired so
 * the suite keeps the most recent rejections. Per-agent overrides live
 * on agents.regression_case_cap — NULL uses this default.
 */
export const DEFAULT_REGRESSION_CASE_CAP = 50;

// ── Sprint 3 — P2.2 reflection loop enforcement ────────────────────────────

/**
 * Maximum number of `review_code` iterations before the reflection loop
 * middleware escalates to HITL. Mirrors the prompt-level rule in
 * `server/skills/review_code.md`. Consumed by
 * `reflectionLoopMiddleware` in the postTool pipeline.
 */
export const MAX_REFLECTION_ITERATIONS = 3;

// ── Sprint 3 — P2.3 confidence scoring + decision-time guidance ────────────

/**
 * Default confidence threshold below which the policy engine upgrades an
 * `auto` decision to `review`. A policy rule can override this via
 * `policy_rules.confidence_threshold`. When the agent's `tool_intent`
 * confidence score is >= this value the gate level is unchanged; below
 * triggers the upgrade. Backward-compat default when no `tool_intent`
 * block is emitted is `confidence = 1.0` (no upgrade).
 */
export const CONFIDENCE_GATE_THRESHOLD = 0.7;

// ── Sprint 3 — P2.1 (Sprint 3A) agent run checkpoint + cleanup ─────────────

/**
 * Default retention window (days) for terminal `agent_runs` rows. The
 * daily `agent-run-cleanup` pg-boss job prunes terminal runs older than
 * this (messages cascade). Per-org overrides live on
 * organisations.run_retention_days — NULL uses this default. Non-terminal
 * runs are never pruned (they are resume targets).
 */
export const DEFAULT_RUN_RETENTION_DAYS = 90;

/**
 * Serialisation version stamped on every checkpoint payload. Bumped when
 * the shape of `SerialisableMiddlewareContext` changes in a non-backward-
 * compatible way. Sprint 3A ships version 1 and writes the field without
 * runtime enforcement — the forward-compat guard lands in Sprint 3B
 * alongside the async resume refactor.
 */
export const MIDDLEWARE_CONTEXT_VERSION = 1;

// ── Sprint 5 — P4.1 Topics → Actions deterministic filter ───────────────────

/**
 * Confidence threshold above which the topic filter performs hard removal
 * of non-matching tools. Below this threshold, tools are soft-reordered
 * (matching tools appear first, but all remain visible).
 *
 * Set conservatively high — keyword classifiers rarely hit this, which
 * is intentional. Hard removal should be rare and deliberate.
 */
export const HARD_REMOVAL_CONFIDENCE_THRESHOLD = 0.85;

/**
 * Below this confidence, the preTool middleware blocks the tool call and
 * forces `ask_clarifying_question` instead. Catches the case where the
 * LLM is guessing which tool to use — clarification is better than a
 * wrong execution.
 *
 * Decision matrix:
 *   >= 0.7:        proceed normally (P2.3 Slice B gate still applies)
 *   >= 0.5 < 0.7:  proceed, but policy engine upgrades auto → review
 *   < 0.5:         block, force clarification
 */
export const MIN_TOOL_ACTION_CONFIDENCE = 0.5;

// ── Sprint 5 — P4.3 Plan-then-execute complexity thresholds ─────────────────

/** Word count threshold for triggering plan-then-execute mode. */
export const PLAN_MODE_WORD_COUNT_THRESHOLD = 300;

/** Skill count threshold for triggering plan-then-execute mode. */
export const PLAN_MODE_SKILL_COUNT_THRESHOLD = 15;

// ── Sprint 5 — P4.4 Semantic critique gate ──────────────────────────────────

/**
 * When true, the critique gate only logs disagreements to
 * llmRequests.metadataJson without blocking. Flip to false to enable
 * active rerouting — requires 2-4 weeks of shadow-mode data first.
 */
export const CRITIQUE_GATE_SHADOW_MODE = true;

// ── Playbook agent_decision step ─────────────────────────────────────────────

/**
 * Maximum number of times the engine will retry a decision step whose agent
 * run returned an invalid output (parse failure or unknown branch). After this
 * many retries the engine falls back to `defaultBranchId` if set, otherwise
 * the step fails. Spec: docs/playbook-agent-decision-step-spec.md §11, §25.3.
 */
export const MAX_DECISION_RETRIES = 3;

/**
 * Default timeout for a decision step if no per-step `timeoutSeconds` is set.
 * Decision steps are single-shot LLM calls; 60 s is generous for any model tier.
 * Spec: docs/playbook-agent-decision-step-spec.md §25.3.
 */
export const DEFAULT_DECISION_STEP_TIMEOUT_SECONDS = 60;

/**
 * Maximum number of branches allowed per `agent_decision` step (phase 1 cap).
 * Keeps prompt size bounded and skip-set computation fast.
 * Spec: docs/playbook-agent-decision-step-spec.md §9, §23.2, §25.3.
 */
export const MAX_DECISION_BRANCHES_PER_STEP = 8;

/**
 * Maximum characters of the prior agent output included in the retry envelope.
 * Limits how much injected content can re-enter the conversation (§22.2).
 * The `failureDetail` on the persisted failure row is a separate, shorter field.
 * Spec: docs/playbook-agent-decision-step-spec.md §11, §22.2, §25.3.
 */
export const DECISION_RETRY_RAW_OUTPUT_TRUNCATE_CHARS = 1000;
