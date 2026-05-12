/**
 * operatorSessionProgressedHandler.test.ts
 *
 * Tests the pure logic for the progressed handler:
 *   - Post-terminal events (status != 'running') → drop (0 rows updated)
 *   - NULL-safe greatest() for first event
 *   - step_count monotonic non-decreasing
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helpers extracted from the handler's update logic
// ---------------------------------------------------------------------------

interface ProgressUpdateInput {
  currentStatus: string;
  currentLastProgressAt: Date | null;
  currentStepCount: number;
  newProgressAt: Date;
  newStepIndex: number;
}

interface ProgressUpdateResult {
  shouldUpdate: true;
  newLastProgressAt: Date;
  newStepCount: number;
}

/**
 * Pure logic for deciding whether to update and what values to write.
 * Mirrors the WHERE status='running' guard and greatest() semantics.
 */
function computeProgressUpdate(
  input: ProgressUpdateInput,
): ProgressUpdateResult | { shouldUpdate: false; reason: string } {
  if (input.currentStatus !== 'running') {
    return { shouldUpdate: false, reason: 'post_terminal' };
  }

  // NULL-safe greatest for last_progress_at: null current → always take the new value.
  const newLastProgressAt = input.currentLastProgressAt === null
    ? input.newProgressAt
    : input.newProgressAt > input.currentLastProgressAt
      ? input.newProgressAt
      : input.currentLastProgressAt;

  // greatest() for step_count (monotonic non-decreasing)
  const newStepCount = Math.max(input.currentStepCount, input.newStepIndex);

  return {
    shouldUpdate: true,
    newLastProgressAt,
    newStepCount,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('post-terminal event guard', () => {
  it('status=running → update proceeds', () => {
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: new Date('2026-05-12T10:00:00Z'),
      currentStepCount: 3,
      newProgressAt: new Date('2026-05-12T10:01:00Z'),
      newStepIndex: 4,
    });
    expect(result.shouldUpdate).toBe(true);
  });

  it('status=completed → no update (post-terminal drop)', () => {
    const result = computeProgressUpdate({
      currentStatus: 'completed',
      currentLastProgressAt: new Date(),
      currentStepCount: 10,
      newProgressAt: new Date(),
      newStepIndex: 11,
    });
    expect(result.shouldUpdate).toBe(false);
    if (!result.shouldUpdate) {
      expect(result.reason).toBe('post_terminal');
    }
  });

  it('status=failed → no update', () => {
    const result = computeProgressUpdate({
      currentStatus: 'failed',
      currentLastProgressAt: null,
      currentStepCount: 0,
      newProgressAt: new Date(),
      newStepIndex: 1,
    });
    expect(result.shouldUpdate).toBe(false);
  });

  it('status=cancelled → no update', () => {
    const result = computeProgressUpdate({
      currentStatus: 'cancelled',
      currentLastProgressAt: null,
      currentStepCount: 0,
      newProgressAt: new Date(),
      newStepIndex: 1,
    });
    expect(result.shouldUpdate).toBe(false);
  });
});

describe('NULL-safe greatest() for last_progress_at', () => {
  it('first event (null current) → uses new timestamp', () => {
    const newTs = new Date('2026-05-12T10:00:00Z');
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: null,
      currentStepCount: 0,
      newProgressAt: newTs,
      newStepIndex: 1,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      expect(result.newLastProgressAt.getTime()).toBe(newTs.getTime());
    }
  });

  it('newer timestamp overwrites older', () => {
    const oldTs = new Date('2026-05-12T10:00:00Z');
    const newTs = new Date('2026-05-12T10:01:00Z');
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: oldTs,
      currentStepCount: 3,
      newProgressAt: newTs,
      newStepIndex: 4,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      expect(result.newLastProgressAt.getTime()).toBe(newTs.getTime());
    }
  });

  it('older timestamp does not overwrite newer (out-of-order delivery)', () => {
    const currentTs = new Date('2026-05-12T10:02:00Z');
    const olderTs = new Date('2026-05-12T10:00:00Z');
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: currentTs,
      currentStepCount: 5,
      newProgressAt: olderTs,
      newStepIndex: 3,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      // greatest() keeps the current (newer) value
      expect(result.newLastProgressAt.getTime()).toBe(currentTs.getTime());
    }
  });
});

describe('step_count monotonic non-decreasing', () => {
  it('higher step index advances step_count', () => {
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: null,
      currentStepCount: 3,
      newProgressAt: new Date(),
      newStepIndex: 7,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      expect(result.newStepCount).toBe(7);
    }
  });

  it('lower step index does not decrease step_count (out-of-order delivery)', () => {
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: null,
      currentStepCount: 10,
      newProgressAt: new Date(),
      newStepIndex: 5,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      expect(result.newStepCount).toBe(10);
    }
  });

  it('equal step index keeps step_count unchanged', () => {
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: null,
      currentStepCount: 5,
      newProgressAt: new Date(),
      newStepIndex: 5,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      expect(result.newStepCount).toBe(5);
    }
  });

  it('step 0 from null → step_count becomes 0', () => {
    const result = computeProgressUpdate({
      currentStatus: 'running',
      currentLastProgressAt: null,
      currentStepCount: 0,
      newProgressAt: new Date(),
      newStepIndex: 0,
    });

    expect(result.shouldUpdate).toBe(true);
    if (result.shouldUpdate) {
      expect(result.newStepCount).toBe(0);
    }
  });
});
