/**
 * incidentIngestorThrottle.integration.test.ts
 *
 * Integration tests verifying throttle behaviour when wired into ingestInline.
 * Uses node:test mock.timers for deterministic time control.
 * The DB upsert is mocked so no real database is required.
 *
 * Runnable via:
 *   NODE_ENV=test npx tsx --test \
 *     server/services/__tests__/incidentIngestorThrottle.integration.test.ts
 */

// Must be set before any module imports so env-based config is picked up.
process.env.NODE_ENV = 'test';
process.env.SYSTEM_INCIDENT_THROTTLE_MS = '1000';
process.env.SYSTEM_INCIDENT_INGEST_ENABLED = 'true';

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Module-level mocks — must be applied before the modules under test load.
// We mock the db module so ingestInline never touches a real database.
// ---------------------------------------------------------------------------

// Mock the db module to avoid real DB calls.
// ingestInline calls db.select().from().where().limit() (suppression check)
// and db.transaction() (the upsert).  We return empty suppression list
// and a no-op transaction.
mock.module('../db/index.js', {
  namedExports: {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        // Provide a minimal tx that satisfies ingestInline's execute calls.
        const tx = {
          execute: async () => [
            {
              id: 'mock-incident-id',
              occurrence_count: 1,
              severity: 'low',
              was_inserted: true,
            },
          ],
        };
        await fn(tx);
      },
    },
  },
});

// Mock pg-boss so notify enqueue is a no-op.
mock.module('../lib/pgBossInstance.js', {
  namedExports: {
    getPgBoss: async () => ({
      send: async () => undefined,
    }),
  },
});

// Mock the logger so log output doesn't pollute test output.
mock.module('../lib/logger.js', {
  namedExports: {
    logger: {
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      info: () => undefined,
    },
  },
});

// Mock env (used by some imports inside incidentIngestor).
mock.module('../lib/env.js', {
  namedExports: {
    env: {},
  },
});

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { ingestInline } from '../incidentIngestor.js';
import { getThrottledCount, __resetForTest } from '../incidentIngestorThrottle.js';

// ---------------------------------------------------------------------------
// Shared fixture — minimal valid IncidentInput.
// ---------------------------------------------------------------------------
function makeInput(suffix = 'A') {
  return {
    source: `test-source-${suffix}` as const,
    summary: `Test incident ${suffix}`,
    severity: 'low' as const,
    correlationId: `corr-${suffix}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ingestInline throttle integration', () => {
  beforeEach(() => {
    __resetForTest();
  });

  afterEach(() => {
    __resetForTest();
  });

  it('burst dedup: 1000 sequential calls with the same fingerprint → 1 real call + 999 throttled', async () => {
    const input = makeInput('A');
    const CALLS = 1000;

    let throttledReturns = 0;
    let realCalls = 0;

    for (let i = 0; i < CALLS; i++) {
      const result = await ingestInline(input);
      if (result && result.status === 'throttled') {
        throttledReturns++;
      } else {
        realCalls++;
      }
    }

    assert.equal(realCalls, 1, `expected 1 real call, got ${realCalls}`);
    assert.equal(throttledReturns, 999, `expected 999 throttled returns, got ${throttledReturns}`);
    assert.equal(
      getThrottledCount(),
      999,
      `expected getThrottledCount()=999, got ${getThrottledCount()}`
    );
  });

  it('cross-fingerprint independence: 100 calls each for A and B → 200 real calls total', async () => {
    const inputA = makeInput('alpha');
    const inputB = makeInput('beta');
    const CALLS_EACH = 100;

    let throttledA = 0;
    let throttledB = 0;

    for (let i = 0; i < CALLS_EACH; i++) {
      const r = await ingestInline(inputA);
      if (r && r.status === 'throttled') throttledA++;
    }
    for (let i = 0; i < CALLS_EACH; i++) {
      const r = await ingestInline(inputB);
      if (r && r.status === 'throttled') throttledB++;
    }

    // First call for each fingerprint passes through; all subsequent calls are throttled.
    const realA = CALLS_EACH - throttledA;
    const realB = CALLS_EACH - throttledB;

    assert.equal(realA, 1, `fingerprint A: expected 1 real call, got ${realA}`);
    assert.equal(realB, 1, `fingerprint B: expected 1 real call, got ${realB}`);
    assert.equal(realA + realB, 2, 'expected exactly 2 real calls total (no cross-fingerprint blocking)');
    assert.equal(
      getThrottledCount(),
      CALLS_EACH - 1 + (CALLS_EACH - 1),
      `expected getThrottledCount()=${(CALLS_EACH - 1) * 2}, got ${getThrottledCount()}`
    );
  });

  it('throttle window expiry: call once, advance fake clock past 1 second, call again → 2 real calls', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });

    try {
      const input = makeInput('expiry');

      // First call: should be a real call.
      const first = await ingestInline(input);
      assert.equal(
        first === undefined || (first as { status: string }).status !== 'throttled',
        true,
        'first call should not be throttled'
      );

      // Second call within the 1-second window: should be throttled.
      const secondImmediate = await ingestInline(input);
      assert.equal(
        secondImmediate !== undefined && (secondImmediate as { status: string }).status === 'throttled',
        true,
        'second call within window should be throttled'
      );

      // Advance fake clock past the 1-second throttle window.
      t.mock.timers.tick(1001);

      // Third call after window expires: should be a real call again.
      const afterExpiry = await ingestInline(input);
      assert.equal(
        afterExpiry === undefined || (afterExpiry as { status: string }).status !== 'throttled',
        true,
        'call after window expiry should not be throttled'
      );

      // Exactly 1 throttled call (the second one), so getThrottledCount() increased by 1.
      assert.equal(getThrottledCount(), 1, 'getThrottledCount() should be 1 after one throttled call');
    } finally {
      t.mock.timers.reset();
    }
  });
});
