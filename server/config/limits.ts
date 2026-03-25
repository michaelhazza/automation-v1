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

/** Model used for internal extraction / summarisation (not the agent's model) */
export const EXTRACTION_MODEL = 'claude-sonnet-4-6';

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
