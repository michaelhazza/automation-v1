/**
 * toolCallsLogProjectionServicePure — Sprint 3 P2.1 Sprint 3A pure projection.
 *
 * Given the ordered list of `agent_run_messages` rows for a run, derive the
 * legacy `agent_run_snapshots.toolCallsLog` array that older UI readers
 * expect. Sprint 3A keeps the inline writer in `runAgenticLoop` as the
 * authoritative source; this projection exists so Sprint 3B can drop the
 * inline writer once every reader has migrated to `agent_run_messages`
 * directly without breaking the dashboards that still read the legacy blob.
 *
 * Shape of a legacy log entry (see runAgenticLoop):
 *   {
 *     tool:       string,          // tool name
 *     input:      object,          // tool input
 *     output:     string,          // serialised tool result
 *     durationMs: number,          // wall-clock duration
 *     iteration:  number,          // loop iteration index
 *     retried:    boolean,         // executeWithRetry fired?
 *   }
 *
 * Lossy fields (durationMs, retried) default to 0 / false because the raw
 * `agent_run_messages` rows do not carry them. Consumers that need live
 * values should read the inline writer output; the projection is for the
 * Sprint 3B path where the inline writer is removed and the dashboard
 * fallback is "best-effort historical log".
 *
 * Contract: docs/improvements-roadmap-spec.md §P2.1.
 */

import type { AgentRunMessageRole } from './agentRunMessageServicePure.js';

/**
 * Lightweight structural view of an `agent_run_messages` row. We do not
 * import the Drizzle `AgentRunMessage` row type here because doing so would
 * drag Drizzle's inferred types into a pure module; callers construct this
 * shape from their tx result set.
 */
export interface ProjectionMessageRow {
  sequenceNumber: number;
  role: AgentRunMessageRole;
  /** Provider-neutral content blocks, string, or object — mirrors the column. */
  content: unknown;
}

/** Shape of the projected legacy log entry. */
export interface ProjectedToolCallLogEntry {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
  iteration: number;
  retried: boolean;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
}

function isToolUseBlock(value: unknown): value is ToolUseBlock {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'tool_use' &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.input === 'object' &&
    v.input !== null
  );
}

function isToolResultBlock(value: unknown): value is ToolResultBlock {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.type === 'tool_result' && typeof v.tool_use_id === 'string';
}

/** Normalise a tool_result.content field to the serialised-string form. */
function stringifyResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/**
 * Pure projection: walk the ordered messages, pair each `tool_use` block
 * with its matching `tool_result` block (by `id` / `tool_use_id`), and
 * emit one legacy log entry per pair. Unmatched `tool_use` blocks (where
 * the tool was skipped before producing a result) emit an entry with an
 * empty `output` so the timeline still records the attempt.
 *
 * Ordering: entries are emitted in the order their `tool_use` blocks
 * appear in the message stream. This matches the order the live-log
 * writer uses.
 */
export function projectToolCallsLog(
  messages: ReadonlyArray<ProjectionMessageRow>,
): ProjectedToolCallLogEntry[] {
  // Copy-and-sort to tolerate callers that pass rows in arbitrary order.
  const sorted = [...messages].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // First pass: collect tool_use blocks in order, tagged with the
  // iteration index (the count of assistant messages we have seen so
  // far). Second pass: index tool_result blocks by tool_use_id so we
  // can join without an O(n^2) scan.
  interface PendingCall {
    id: string;
    name: string;
    input: Record<string, unknown>;
    iteration: number;
  }
  const pendingCalls: PendingCall[] = [];
  const resultsById = new Map<string, string>();

  // `assistantIndex` is a PROJECTION HEURISTIC, not a ground-truth
  // iteration counter. The legacy toolCallsLog shape carries a zero-
  // based `iteration` field, and in the inline writer every LLM turn
  // bumps iteration by one before appending tool call rows. Because
  // `agent_run_messages` captures one assistant row per LLM turn, we
  // can reconstruct "LLM turn N" by counting assistant rows in the
  // ordered stream. This aligns with the loop's iteration counter
  // for every run that reaches the projection path (fresh runs and
  // runs resumed via `resumeAgentRun`, which replays stored messages
  // back into the same monotonically-advancing sequence). A future
  // sprint that allows multi-assistant-message turns would need to
  // widen this heuristic (e.g. by stamping iteration on the row itself).
  let assistantIndex = 0;
  for (const msg of sorted) {
    if (msg.role === 'assistant') {
      const currentIteration = assistantIndex;
      assistantIndex++;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (isToolUseBlock(block)) {
            pendingCalls.push({
              id: block.id,
              name: block.name,
              input: block.input,
              iteration: currentIteration,
            });
          }
        }
      }
      continue;
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (isToolResultBlock(block)) {
          resultsById.set(block.tool_use_id, stringifyResultContent(block.content));
        }
      }
    }
    // System messages and plain-text user messages have no tool info —
    // nothing to project.
  }

  // Join — one entry per tool_use block, matched to its result or blank.
  return pendingCalls.map((call) => ({
    tool: call.name,
    input: call.input,
    output: resultsById.get(call.id) ?? '',
    // Lossy: not stored in agent_run_messages. Default to sentinel values
    // so legacy consumers get a valid shape.
    durationMs: 0,
    iteration: call.iteration,
    retried: false,
  }));
}
