/**
 * useTaskEventStreamPure.ts — pure helpers for task event stream management.
 *
 * Separated for unit-testability (no React, no fetch, no socket.io).
 * Tests: client/src/hooks/__tests__/useTaskEventStreamPure.test.ts
 *
 * Spec: docs/workflows-dev-spec.md §8 client ordering invariant.
 */

import type { TaskEventEnvelope } from '../../../shared/types/taskEvent';

// ─── Cursor type ──────────────────────────────────────────────────────────────

export interface EventCursor {
  taskSequence: number;
  eventSubsequence: number;
}

// ─── Cursor comparison ─────────────────────────────────────────────────────

/**
 * Compare two (taskSequence, eventSubsequence) cursors.
 *
 * Returns:
 *   -1 when a < b
 *    0 when a === b
 *    1 when a > b
 */
export function compareCursors(
  a: [number, number],
  b: [number, number],
): -1 | 0 | 1 {
  if (a[0] < b[0]) return -1;
  if (a[0] > b[0]) return 1;
  if (a[1] < b[1]) return -1;
  if (a[1] > b[1]) return 1;
  return 0;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge a buffer of already-applied events with an incoming batch, returning
 * the deduplicated set in (taskSequence, eventSubsequence) order.
 *
 * Events with cursors <= the maximum applied cursor are treated as duplicates
 * only if they already appear in `applied`. Events in `incoming` that are not
 * in `applied` are appended even if their cursors precede some applied events
 * (out-of-order arrival from the 1-second buffer — let the caller sort).
 *
 * Returns the merged array sorted by cursor.
 */
export function mergeEventsByCursor(
  applied: TaskEventEnvelope[],
  incoming: TaskEventEnvelope[],
): TaskEventEnvelope[] {
  const seen = new Set<string>(applied.map((e) => e.eventId));

  const merged = [...applied];
  for (const ev of incoming) {
    if (!seen.has(ev.eventId)) {
      merged.push(ev);
      seen.add(ev.eventId);
    }
  }

  return merged.sort((a, b) =>
    compareCursors(
      [a.taskSequence, a.eventSubsequence],
      [b.taskSequence, b.eventSubsequence],
    ),
  );
}

// ─── Gap detection ─────────────────────────────────────────────────────────

/**
 * Detect whether there is a gap between the last applied event and the first
 * event in the incoming batch.
 *
 * A gap exists when:
 *   incoming[0].taskSequence > lastAppliedSequence + 1
 *
 * i.e. at least one sequence number has been skipped entirely.
 * Within-sequence gaps (missing eventSubsequence) are not detected here —
 * they require schema knowledge the pure layer doesn't have.
 *
 * Returns null when there is no gap or the incoming batch is empty.
 * Returns [lastAppliedSequence, incoming[0].taskSequence] when a gap is found.
 */
export function detectGap(
  applied: TaskEventEnvelope[],
  incoming: TaskEventEnvelope[],
): [number, number] | null {
  if (incoming.length === 0) return null;

  const lastApplied = applied.length > 0
    ? applied[applied.length - 1].taskSequence
    : 0;

  const firstIncoming = incoming[0].taskSequence;

  // No gap when sequences are contiguous or the incoming event is a duplicate
  if (firstIncoming <= lastApplied + 1) return null;

  return [lastApplied, firstIncoming];
}

// ─── Cursor extraction ─────────────────────────────────────────────────────

/**
 * Extract the replay cursor from the last event in an applied list.
 * Returns { taskSequence: 0, eventSubsequence: 0 } when the list is empty.
 */
export function getCursor(applied: TaskEventEnvelope[]): EventCursor {
  if (applied.length === 0) {
    return { taskSequence: 0, eventSubsequence: 0 };
  }
  const last = applied[applied.length - 1];
  return {
    taskSequence: last.taskSequence,
    eventSubsequence: last.eventSubsequence,
  };
}
