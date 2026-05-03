/**
 * useTaskEventStreamPure.test.ts — unit tests for pure helpers.
 *
 * Tests: compareCursors, mergeEventsByCursor, detectGap, getCursor.
 */

import { describe, test, expect } from 'vitest';
import {
  compareCursors,
  mergeEventsByCursor,
  detectGap,
  getCursor,
} from '../useTaskEventStreamPure';
import type { TaskEventEnvelope } from '../../../../shared/types/taskEvent';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEnvelope(seq: number, subseq: number, id?: string): TaskEventEnvelope {
  return {
    eventId: id ?? `task:t1:${seq}:${subseq}:step.started`,
    type: 'task:execution-event',
    entityId: 't1',
    timestamp: '2024-01-01T00:00:00.000Z',
    eventOrigin: 'engine',
    taskSequence: seq,
    eventSubsequence: subseq,
    eventSchemaVersion: 1,
    payload: { kind: 'step.started', payload: { stepId: `s${seq}` } } as unknown as TaskEventEnvelope['payload'],
  };
}

// ─── compareCursors ───────────────────────────────────────────────────────────

describe('compareCursors', () => {
  test('equal cursors return 0', () => {
    expect(compareCursors([1, 0], [1, 0])).toBe(0);
    expect(compareCursors([5, 3], [5, 3])).toBe(0);
  });

  test('lower taskSequence returns -1', () => {
    expect(compareCursors([1, 0], [2, 0])).toBe(-1);
    expect(compareCursors([0, 5], [1, 0])).toBe(-1);
  });

  test('higher taskSequence returns 1', () => {
    expect(compareCursors([3, 0], [2, 9])).toBe(1);
  });

  test('same taskSequence, lower subseq returns -1', () => {
    expect(compareCursors([5, 0], [5, 1])).toBe(-1);
  });

  test('same taskSequence, higher subseq returns 1', () => {
    expect(compareCursors([5, 2], [5, 1])).toBe(1);
  });

  test('first event vs zero cursor', () => {
    expect(compareCursors([0, 0], [0, 0])).toBe(0);
    expect(compareCursors([1, 0], [0, 0])).toBe(1);
  });
});

// ─── mergeEventsByCursor ──────────────────────────────────────────────────────

describe('mergeEventsByCursor', () => {
  test('empty applied + empty incoming = empty', () => {
    expect(mergeEventsByCursor([], [])).toEqual([]);
  });

  test('applies incoming to empty applied', () => {
    const incoming = [makeEnvelope(1, 0), makeEnvelope(2, 0)];
    const result = mergeEventsByCursor([], incoming);
    expect(result).toHaveLength(2);
    expect(result[0].taskSequence).toBe(1);
    expect(result[1].taskSequence).toBe(2);
  });

  test('deduplicates by eventId', () => {
    const e1 = makeEnvelope(1, 0, 'ev-1');
    const result = mergeEventsByCursor([e1], [e1]);
    expect(result).toHaveLength(1);
  });

  test('sorts by (taskSequence, eventSubsequence)', () => {
    const e3 = makeEnvelope(3, 0, 'ev-3');
    const e1 = makeEnvelope(1, 0, 'ev-1');
    const e2b = makeEnvelope(2, 1, 'ev-2b');
    const e2a = makeEnvelope(2, 0, 'ev-2a');
    const result = mergeEventsByCursor([e3, e1], [e2b, e2a]);
    expect(result.map((e) => e.eventId)).toEqual(['ev-1', 'ev-2a', 'ev-2b', 'ev-3']);
  });

  test('out-of-order incoming events are inserted correctly', () => {
    const applied = [makeEnvelope(1, 0, 'ev-1'), makeEnvelope(3, 0, 'ev-3')];
    const incoming = [makeEnvelope(2, 0, 'ev-2')];
    const result = mergeEventsByCursor(applied, incoming);
    expect(result.map((e) => e.eventId)).toEqual(['ev-1', 'ev-2', 'ev-3']);
  });

  test('does not mutate input arrays', () => {
    const applied = [makeEnvelope(1, 0, 'ev-1')];
    const incoming = [makeEnvelope(2, 0, 'ev-2')];
    const originalApplied = [...applied];
    mergeEventsByCursor(applied, incoming);
    expect(applied).toEqual(originalApplied);
  });
});

// ─── detectGap ────────────────────────────────────────────────────────────────

describe('detectGap', () => {
  test('returns null when incoming is empty', () => {
    const applied = [makeEnvelope(5, 0)];
    expect(detectGap(applied, [])).toBeNull();
  });

  test('returns null when applied is empty (first event)', () => {
    const incoming = [makeEnvelope(1, 0)];
    expect(detectGap([], incoming)).toBeNull();
  });

  test('returns null when sequences are contiguous', () => {
    const applied = [makeEnvelope(1, 0), makeEnvelope(2, 0)];
    const incoming = [makeEnvelope(3, 0)];
    expect(detectGap(applied, incoming)).toBeNull();
  });

  test('returns null when incoming is a duplicate', () => {
    const applied = [makeEnvelope(3, 0)];
    const incoming = [makeEnvelope(3, 0)]; // same seq
    expect(detectGap(applied, incoming)).toBeNull();
  });

  test('detects gap when sequences skip', () => {
    const applied = [makeEnvelope(2, 0)];
    const incoming = [makeEnvelope(5, 0)]; // 3 and 4 missing
    const result = detectGap(applied, incoming);
    expect(result).toEqual([2, 5]);
  });

  test('detects gap even when applied is empty and incoming starts at >1', () => {
    // Incoming starts at seq 5 but applied is empty (seq 0 implied)
    // 5 > 0 + 1 so gap is detected
    const incoming = [makeEnvelope(5, 0)];
    const result = detectGap([], incoming);
    // lastApplied = 0; firstIncoming = 5; 5 > 0+1 → gap
    expect(result).toEqual([0, 5]);
  });
});

// ─── getCursor ────────────────────────────────────────────────────────────────

describe('getCursor', () => {
  test('returns zero cursor for empty applied list', () => {
    expect(getCursor([])).toEqual({ taskSequence: 0, eventSubsequence: 0 });
  });

  test('returns cursor of last event', () => {
    const applied = [makeEnvelope(1, 0), makeEnvelope(3, 2)];
    expect(getCursor(applied)).toEqual({ taskSequence: 3, eventSubsequence: 2 });
  });
});
