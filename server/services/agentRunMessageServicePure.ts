/**
 * agentRunMessageServicePure — Sprint 3 P2.1 Sprint 3A pure helpers.
 *
 * The impure service (`agentRunMessageService.ts`) does the Drizzle
 * insert/select work; this file holds the decision-and-shape logic
 * that can be unit-tested without touching the DB.
 *
 * Two responsibilities:
 *
 *   1. `validateMessageShape` — asserts the `role`, `content`, and
 *      `toolCallId` tuple is structurally well-formed before we
 *      persist it. Throws a descriptive error on violation so the
 *      caller fails fast instead of writing a broken row.
 *
 *   2. `computeNextSequenceNumber` — given the current max sequence
 *      number for a run (null for a fresh run), returns the next
 *      value. Exists so the resume-path and the normal append path
 *      share a single source of truth for the "start at 0" rule.
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.1.
 */

export type AgentRunMessageRole = 'assistant' | 'user' | 'system';

/**
 * The shape the service accepts for a single message. Mirrors the
 * columns of `agent_run_messages`. Kept structural so tests can
 * build objects without importing the Drizzle row type.
 */
export interface MessageShapeInput {
  role: AgentRunMessageRole;
  /**
   * Provider-neutral content blocks. A non-null, non-array value is
   * allowed (for plain-text messages) but must not be `undefined`.
   */
  content: unknown;
  /**
   * Optional top-level tool_call_id. Must be null or a non-empty
   * string — the empty string is rejected explicitly because it
   * round-trips badly through the partial index defined in migration
   * 0084.
   */
  toolCallId?: string | null;
}

/**
 * Validate the structural shape of a message before insert. Throws
 * with a descriptive message on violation; returns cleanly on
 * success.
 */
export function validateMessageShape(input: MessageShapeInput): void {
  const { role, content, toolCallId } = input;

  if (role !== 'assistant' && role !== 'user' && role !== 'system') {
    throw new Error(
      `agentRunMessageService: invalid role ${JSON.stringify(role)} — expected 'assistant' | 'user' | 'system'.`,
    );
  }

  if (content === undefined || content === null) {
    throw new Error(
      `agentRunMessageService: content must not be null or undefined (role=${role}).`,
    );
  }

  // An empty array of blocks is almost always a bug — the LLM
  // returned an empty response or the tool-results batch was
  // skipped. Reject so the caller notices. A non-empty array, an
  // object, or a string are all fine.
  if (Array.isArray(content) && content.length === 0) {
    throw new Error(
      `agentRunMessageService: content must be a non-empty array (role=${role}).`,
    );
  }

  if (toolCallId !== undefined && toolCallId !== null) {
    if (typeof toolCallId !== 'string' || toolCallId.length === 0) {
      throw new Error(
        `agentRunMessageService: toolCallId must be null or a non-empty string (got ${JSON.stringify(
          toolCallId,
        )}).`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// §4.8 Run-trace role-aware masking projection
// ---------------------------------------------------------------------------

/**
 * Roles recognised by the masking projection.
 *
 * - 'system_admin' — sees everything, even when scoped into an org.
 * - 'org_admin'    — sees tool names + output summaries; inputs visible.
 * - 'user'         — workspace user; tool inputs redacted, outputs truncated.
 *
 * Any unrecognised role string falls back to the most restrictive tier
 * ('user') so future roles are safe-by-default.
 */
export type RunTraceRole = 'system_admin' | 'org_admin' | 'user';

/** Result shape for a single masked tool-call pair. */
export interface RunTraceToolCallProjection {
  toolName: string;
  /** Tool call arguments — '<redacted>' for workspace_user; full object otherwise. */
  input: Record<string, unknown> | '<redacted>';
  /** Tool result body — truncated to TOOL_RESULT_TRUNCATE_CHARS for workspace_user; full string otherwise. */
  output: string | '<redacted>';
  /** Present and true only when the field is visible but was truncated (not when redacted). */
  outputTruncated?: true;
  durationMs: number;
  iteration: number;
}

/** Maximum characters for truncated tool result output (workspace_user tier). */
export const TOOL_RESULT_TRUNCATE_CHARS = 200;

/** The redaction sentinel token, per spec §4.8. */
export const REDACTION_TOKEN = '<redacted>' as const;

/**
 * Normalise a caller-supplied role string to the three recognised tiers.
 * Unknown strings fall back to 'user' (most restrictive — safe by default).
 */
export function normaliseRunTraceRole(role: string): RunTraceRole {
  if (role === 'system_admin' || role === 'org_admin' || role === 'user') {
    return role;
  }
  return 'user';
}

/**
 * Project a single tool-call log entry into its role-masked form.
 *
 * Masking rules per spec §4.8:
 *   - workspace_user ('user'):  input → '<redacted>'; output → first 200 chars + truncated flag
 *   - org_admin:                input visible; output visible
 *   - system_admin:             everything visible
 *
 * Mask-over-truncate precedence: if a field is masked, it emits '<redacted>'
 * with NO truncated flag (truncated is only present when the field is visible
 * but partial).
 */
export function projectMessageForRole(
  entry: {
    tool?: string;
    name?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    durationMs?: number;
    iteration?: number;
  },
  role: string,
): RunTraceToolCallProjection {
  const tier = normaliseRunTraceRole(role);
  const toolName = entry.tool ?? entry.name ?? '(unknown)';
  const rawInput = entry.input ?? {};
  const rawOutput =
    typeof entry.output === 'string'
      ? entry.output
      : entry.output == null
        ? ''
        : JSON.stringify(entry.output);
  const durationMs = typeof entry.durationMs === 'number' ? entry.durationMs : 0;
  const iteration = typeof entry.iteration === 'number' ? entry.iteration : 0;

  if (tier === 'user') {
    // Input: masked (takes precedence over any truncation).
    // Output: truncated to first TOOL_RESULT_TRUNCATE_CHARS chars.
    const outputVisible = rawOutput.slice(0, TOOL_RESULT_TRUNCATE_CHARS);
    const outputTruncated = rawOutput.length > TOOL_RESULT_TRUNCATE_CHARS;
    return {
      toolName,
      input: REDACTION_TOKEN,
      output: outputVisible,
      ...(outputTruncated ? { outputTruncated: true as const } : {}),
      durationMs,
      iteration,
    };
  }

  // org_admin and system_admin: all fields visible.
  return {
    toolName,
    input: rawInput,
    output: rawOutput,
    durationMs,
    iteration,
  };
}

/**
 * Project an ordered array of tool-call log entries for a given user role.
 * Returns a new array; does not mutate the input.
 */
export function projectForRole(
  entries: ReadonlyArray<{
    tool?: string;
    name?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    durationMs?: number;
    iteration?: number;
  }>,
  role: string,
): RunTraceToolCallProjection[] {
  return entries.map((entry) => projectMessageForRole(entry, role));
}

// ---------------------------------------------------------------------------
// Sequence number arithmetic
// ---------------------------------------------------------------------------

/**
 * Given the current maximum sequence number for a run, return the
 * next value to use. `null` means the run has no messages yet →
 * start at 0. Otherwise return `currentMax + 1`.
 *
 * Throws on negative or non-integer inputs — the underlying column
 * is `integer NOT NULL CHECK (sequence_number >= 0)` and we want the
 * failure at the application layer rather than at the DB round
 * trip.
 */
export function computeNextSequenceNumber(currentMax: number | null): number {
  if (currentMax === null) return 0;
  if (!Number.isInteger(currentMax)) {
    throw new Error(
      `agentRunMessageService: currentMax must be an integer (got ${currentMax}).`,
    );
  }
  if (currentMax < 0) {
    throw new Error(
      `agentRunMessageService: currentMax must be >= 0 (got ${currentMax}).`,
    );
  }
  return currentMax + 1;
}
