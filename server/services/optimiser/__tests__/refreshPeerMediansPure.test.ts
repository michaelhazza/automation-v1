/**
 * refreshPeerMediansPure.test.ts — Pure unit test (no DB).
 *
 * Tests the skipped_locked path of runPeerMediansRefresh by mocking
 * withAdminConnectionGuarded to simulate a non-acquired advisory lock.
 *
 * Runnable via:
 *   npx vitest run server/services/optimiser/__tests__/refreshPeerMediansPure.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must come before any import of the module under test) ─────

vi.mock('../../../lib/rlsBoundaryGuard.js', () => ({
  withAdminConnectionGuarded: vi.fn(),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Lazy imports after mocks are in place ────────────────────────────────────

import { withAdminConnectionGuarded } from '../../../lib/rlsBoundaryGuard.js';
import { logger } from '../../../lib/logger.js';
import { runPeerMediansRefresh } from '../refreshPeerMedians.js';

const mockedGuard = vi.mocked(withAdminConnectionGuarded);
const mockedLogger = vi.mocked(logger);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate the advisory lock NOT being acquired: the callback runs but lock returns false. */
function simulateLockNotAcquired() {
  mockedGuard.mockImplementationOnce(async (_opts, fn) => {
    // Provide a fake tx that returns `acquired: false` for the lock query.
    const fakeTx = {
      execute: vi.fn().mockResolvedValueOnce([{ acquired: false }]),
    };
    return fn(fakeTx as any);
  });
}

/** Simulate the advisory lock being acquired and the REFRESH succeeding. */
function simulateLockAcquired() {
  mockedGuard.mockImplementationOnce(async (_opts, fn) => {
    const fakeTx = {
      execute: vi.fn()
        .mockResolvedValueOnce([{ acquired: true }])  // lock result
        .mockResolvedValueOnce(undefined)              // SET LOCAL ROLE
        .mockResolvedValueOnce(undefined),             // REFRESH MATERIALIZED VIEW
    };
    return fn(fakeTx as any);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runPeerMediansRefresh — skipped_locked path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits skipped_locked when advisory lock is not acquired', async () => {
    simulateLockNotAcquired();

    await runPeerMediansRefresh();

    const infoEvents = mockedLogger.info.mock.calls.map((call) => call[0]);
    expect(infoEvents).toContain('optimiser.peer_medians.refresh.skipped_locked');
  });

  it('emits started before attempting the lock', async () => {
    simulateLockNotAcquired();

    await runPeerMediansRefresh();

    const firstCall = mockedLogger.info.mock.calls[0]?.[0];
    expect(firstCall).toBe('optimiser.peer_medians.refresh.started');
  });

  it('still emits completed (function finished cleanly, just skipped the REFRESH)', async () => {
    simulateLockNotAcquired();

    await runPeerMediansRefresh();

    // The outer try block always emits .completed on a clean return — the lock
    // not being acquired is not an error, the function just skips the REFRESH.
    const infoEvents = mockedLogger.info.mock.calls.map((call) => call[0]);
    expect(infoEvents).toContain('optimiser.peer_medians.refresh.completed');
  });
});

describe('runPeerMediansRefresh — success path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits started and completed when lock is acquired', async () => {
    simulateLockAcquired();

    await runPeerMediansRefresh();

    const infoEvents = mockedLogger.info.mock.calls.map((call) => call[0]);
    expect(infoEvents).toContain('optimiser.peer_medians.refresh.started');
    expect(infoEvents).toContain('optimiser.peer_medians.refresh.completed');
  });

  it('passes durationMs in the completed event', async () => {
    simulateLockAcquired();

    await runPeerMediansRefresh();

    const completedCall = mockedLogger.info.mock.calls.find((call) => call[0] === 'optimiser.peer_medians.refresh.completed');
    expect(completedCall).toBeDefined();
    expect(typeof completedCall?.[1]?.durationMs).toBe('number');
  });
});

describe('runPeerMediansRefresh — failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits failed and re-throws when withAdminConnectionGuarded throws', async () => {
    mockedGuard.mockRejectedValueOnce(new Error('db connection lost'));

    await expect(runPeerMediansRefresh()).rejects.toThrow('db connection lost');

    const errorEvents = mockedLogger.error.mock.calls.map((call) => call[0]);
    expect(errorEvents).toContain('optimiser.peer_medians.refresh.failed');
  });

  it('includes the error message in the failed event payload', async () => {
    mockedGuard.mockRejectedValueOnce(new Error('timeout'));

    await expect(runPeerMediansRefresh()).rejects.toThrow();

    const failedCall = mockedLogger.error.mock.calls.find((call) => call[0] === 'optimiser.peer_medians.refresh.failed');
    expect(failedCall?.[1]?.error).toBe('timeout');
  });
});
