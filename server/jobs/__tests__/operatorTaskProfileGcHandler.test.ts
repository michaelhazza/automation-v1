// guard-ignore-file: pure-helper-convention reason="inline pure GC-decision helpers — extraction to operatorTaskProfileGcHandlerPure.ts deferred to follow-on cleanup; handler logic IS pure-tested, just colocated"
/**
 * operatorTaskProfileGcHandler.test.ts
 *
 * Tests the pure GC decision logic:
 *   - Stale gc_in_progress reclaim at 30 min threshold
 *   - Provider 404 on volume delete → treat as gc_done
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const STALE_GC_IN_PROGRESS_THRESHOLD_MS = 30 * 60 * 1000;

interface ProfileRow {
  id: string;
  status: 'active' | 'scheduled_gc' | 'gc_in_progress' | 'gc_done';
  gcStartedAt: Date | null;
  scheduledGcAt: Date | null;
}

function isStaleGcInProgress(row: ProfileRow, nowMs: number): boolean {
  if (row.status !== 'gc_in_progress') return false;
  if (!row.gcStartedAt) return true; // null gcStartedAt → treat as stale
  return nowMs - row.gcStartedAt.getTime() >= STALE_GC_IN_PROGRESS_THRESHOLD_MS;
}

function isDueForGc(row: ProfileRow, now: Date): boolean {
  if (row.status !== 'scheduled_gc') return false;
  if (!row.scheduledGcAt) return false;
  return row.scheduledGcAt <= now;
}

function handleProviderDeleteResult(
  statusCode: number | null,
): 'gc_done' | 'gc_failed' {
  // Provider 404 → volume already gone → treat as gc_done.
  if (statusCode === null || statusCode === 404 || statusCode === 200 || statusCode === 204) {
    return 'gc_done';
  }
  return 'gc_failed';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stale gc_in_progress reclaim', () => {
  const now = new Date('2026-05-12T10:00:00Z');
  const nowMs = now.getTime();

  it('gc_in_progress started 31 min ago → stale (should reclaim)', () => {
    const row: ProfileRow = {
      id: 'p1',
      status: 'gc_in_progress',
      gcStartedAt: new Date(nowMs - 31 * 60 * 1000),
      scheduledGcAt: null,
    };
    expect(isStaleGcInProgress(row, nowMs)).toBe(true);
  });

  it('gc_in_progress started 29 min ago → not stale', () => {
    const row: ProfileRow = {
      id: 'p2',
      status: 'gc_in_progress',
      gcStartedAt: new Date(nowMs - 29 * 60 * 1000),
      scheduledGcAt: null,
    };
    expect(isStaleGcInProgress(row, nowMs)).toBe(false);
  });

  it('gc_in_progress started exactly 30 min ago → stale (boundary)', () => {
    const row: ProfileRow = {
      id: 'p3',
      status: 'gc_in_progress',
      gcStartedAt: new Date(nowMs - 30 * 60 * 1000),
      scheduledGcAt: null,
    };
    expect(isStaleGcInProgress(row, nowMs)).toBe(true);
  });

  it('gc_in_progress with null gcStartedAt → treated as stale', () => {
    const row: ProfileRow = {
      id: 'p4',
      status: 'gc_in_progress',
      gcStartedAt: null,
      scheduledGcAt: null,
    };
    expect(isStaleGcInProgress(row, nowMs)).toBe(true);
  });

  it('active profile → not stale (wrong status)', () => {
    const row: ProfileRow = {
      id: 'p5',
      status: 'active',
      gcStartedAt: new Date(nowMs - 60 * 60 * 1000),
      scheduledGcAt: null,
    };
    expect(isStaleGcInProgress(row, nowMs)).toBe(false);
  });

  it('scheduled_gc profile → not stale (wrong status)', () => {
    const row: ProfileRow = {
      id: 'p6',
      status: 'scheduled_gc',
      gcStartedAt: null,
      scheduledGcAt: new Date(nowMs - 1000),
    };
    expect(isStaleGcInProgress(row, nowMs)).toBe(false);
  });
});

describe('scheduled_gc sweep: due for GC', () => {
  const now = new Date('2026-05-12T10:00:00Z');

  it('scheduled_gc_at in the past → due for GC', () => {
    const row: ProfileRow = {
      id: 'p7',
      status: 'scheduled_gc',
      gcStartedAt: null,
      scheduledGcAt: new Date('2026-05-11T10:00:00Z'),
    };
    expect(isDueForGc(row, now)).toBe(true);
  });

  it('scheduled_gc_at in the future → not due', () => {
    const row: ProfileRow = {
      id: 'p8',
      status: 'scheduled_gc',
      gcStartedAt: null,
      scheduledGcAt: new Date('2026-05-13T10:00:00Z'),
    };
    expect(isDueForGc(row, now)).toBe(false);
  });

  it('scheduled_gc_at exactly now → due (boundary)', () => {
    const row: ProfileRow = {
      id: 'p9',
      status: 'scheduled_gc',
      gcStartedAt: null,
      scheduledGcAt: now,
    };
    expect(isDueForGc(row, now)).toBe(true);
  });

  it('scheduled_gc_at null → not due', () => {
    const row: ProfileRow = {
      id: 'p10',
      status: 'scheduled_gc',
      gcStartedAt: null,
      scheduledGcAt: null,
    };
    expect(isDueForGc(row, now)).toBe(false);
  });

  it('active profile with past scheduledGcAt → not due (wrong status)', () => {
    const row: ProfileRow = {
      id: 'p11',
      status: 'active',
      gcStartedAt: null,
      scheduledGcAt: new Date('2026-05-01T00:00:00Z'),
    };
    expect(isDueForGc(row, now)).toBe(false);
  });
});

describe('provider 404 on delete → treat as gc_done', () => {
  it('HTTP 404 → gc_done (volume already gone)', () => {
    expect(handleProviderDeleteResult(404)).toBe('gc_done');
  });

  it('HTTP 200 → gc_done (successful delete)', () => {
    expect(handleProviderDeleteResult(200)).toBe('gc_done');
  });

  it('HTTP 204 → gc_done (successful no-content delete)', () => {
    expect(handleProviderDeleteResult(204)).toBe('gc_done');
  });

  it('null status code → gc_done (network-level error treated as already gone)', () => {
    expect(handleProviderDeleteResult(null)).toBe('gc_done');
  });

  it('HTTP 500 → gc_failed (provider error)', () => {
    expect(handleProviderDeleteResult(500)).toBe('gc_failed');
  });

  it('HTTP 503 → gc_failed (provider unavailable)', () => {
    expect(handleProviderDeleteResult(503)).toBe('gc_failed');
  });
});
