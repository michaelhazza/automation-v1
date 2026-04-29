/**
 * incidentIngestorThrottle.integration.test.ts
 *
 * Integration tests verifying throttle behaviour when wired into recordIncident
 * (sync branch). The throttle check now lives in recordIncident's else-branch;
 * ingestInline is a pure write path that the async-worker calls directly
 * without hitting the throttle (spec §1.7, 2026-04-28 pre-test backend hardening).
 *
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

// Skip all tests when DATABASE_URL is absent. The test body never touches a
// real DB (the db module is mocked below), but env.ts validates DATABASE_URL
// at module load time — without a value the import crashes before any test
// can run. Setting a placeholder here lets the module load; the { skip: SKIP }
// option on each it() ensures the tests are still marked skipped, not run.
const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';
if (SKIP) {
  process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
  process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
  process.env.EMAIL_FROM ??= 'skip@placeholder.example';
}

// ---------------------------------------------------------------------------
// Module-level mocks — must be applied before the modules under test load.
// We mock the db module so ingestInline never touches a real database.
// Only registered when !SKIP — mock.module is not available in tsx without
// --experimental-vm-modules, and when SKIP=true we never import the modules
// under test, so the mocks are unnecessary anyway.
// ---------------------------------------------------------------------------

if (!SKIP) {
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
}

// ---------------------------------------------------------------------------
// Import modules under test AFTER mocks are registered.
// recordIncident (sync branch) now owns the throttle check; ingestInline is
// a pure write path with no throttle (spec §1.7).
//
// These must be DYNAMIC imports so that:
//   (a) mock.module() interceptions are applied first (static imports are
//       hoisted before any module body code runs, bypassing mock.module), AND
//   (b) when SKIP=true the import is never attempted, avoiding env.ts crash.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentInput } from '../incidentIngestorPure.js';

let recordIncident: Awaited<typeof import('../incidentIngestor.js')>['recordIncident'];
let ingestInline: Awaited<typeof import('../incidentIngestor.js')>['ingestInline'];
let __resetForTest: Awaited<typeof import('../incidentIngestor.js')>['__resetForTest'];
let getThrottledCount: Awaited<typeof import('../incidentIngestorThrottle.js')>['getThrottledCount'];
let resetThrottle: Awaited<typeof import('../incidentIngestorThrottle.js')>['__resetForTest'];

if (!SKIP) {
  ({ recordIncident, ingestInline, __resetForTest } = await import('../incidentIngestor.js'));
  ({ getThrottledCount, __resetForTest: resetThrottle } = await import('../incidentIngestorThrottle.js'));
}

// ---------------------------------------------------------------------------
// Shared fixture — minimal valid IncidentInput. `source` MUST be a real
// SystemIncidentSource value — the previous `test-source-${suffix}` literal
// silently widened to string and bypassed the union check.
// `satisfies IncidentInput` makes any future type drift loud.
// ---------------------------------------------------------------------------
function makeInput(suffix = 'A') {
  return {
    source: 'self',
    summary: `Test incident ${suffix}`,
    severity: 'low',
    correlationId: `corr-${suffix}`,
  } satisfies IncidentInput;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordIncident (sync branch) throttle integration', () => {
  beforeEach(() => {
    __resetForTest();
    resetThrottle();
  });

  afterEach(() => {
    __resetForTest();
    resetThrottle();
  });

  it('burst dedup: 1000 sequential calls with the same fingerprint → 1 real call + 999 throttled (via getThrottledCount)', { skip: SKIP }, async () => {
    const input = makeInput('A');
    const CALLS = 1000;

    for (let i = 0; i < CALLS; i++) {
      await recordIncident(input);
    }

    // The throttle counter tracks how many calls checkThrottle blocked.
    // First call passes through; 999 subsequent calls are throttled.
    expect(getThrottledCount(), `expected getThrottledCount()=999, got ${getThrottledCount()}`).toBe(999);
  });

  it('cross-fingerprint independence: 100 calls each for A and B → only 2 real calls (198 throttled)', { skip: SKIP }, async () => {
    const inputA = makeInput('alpha');
    const inputB = makeInput('beta');
    const CALLS_EACH = 100;

    for (let i = 0; i < CALLS_EACH; i++) {
      await recordIncident(inputA);
    }
    for (let i = 0; i < CALLS_EACH; i++) {
      await recordIncident(inputB);
    }

    // First call for each fingerprint passes through; all subsequent calls are throttled.
    const expected = (CALLS_EACH - 1) + (CALLS_EACH - 1);
    expect(getThrottledCount(), `expected getThrottledCount()=${expected}, got ${getThrottledCount()}`).toBe(expected);
  });

  it('throttle window expiry: call once, advance fake clock past 1 second, call again → 2 real calls (1 throttled in between)', { skip: SKIP }, async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });

    try {
      const input = makeInput('expiry');

      // First call: passes through (not throttled).
      await recordIncident(input);
      expect(getThrottledCount(), 'first call should not be throttled').toBe(0);

      // Second call within the 1-second window: should be throttled.
      await recordIncident(input);
      expect(getThrottledCount(), 'second call within window should be throttled').toBe(1);

      // Advance fake clock past the 1-second throttle window.
      t.mock.timers.tick(1001);

      // Third call after window expires: should pass through again (no new throttle increment).
      await recordIncident(input);
      expect(getThrottledCount(), 'call after window expiry should not be throttled (count stays at 1)').toBe(1);
    } finally {
      t.mock.timers.reset();
    }
  });
});

describe('ingestInline (async-worker path) bypasses throttle (spec §1.7 MUST)', () => {
  beforeEach(() => {
    __resetForTest();
    resetThrottle();
  });

  afterEach(() => {
    __resetForTest();
    resetThrottle();
  });

  it('1000 direct ingestInline calls with the same fingerprint → getThrottledCount() stays at 0', { skip: SKIP }, async () => {
    const input = makeInput('async-worker');
    const CALLS = 1000;

    for (let i = 0; i < CALLS; i++) {
      await ingestInline(input);
    }

    // ingestInline is the path the async-worker calls directly. The throttle
    // MUST NOT fire here — pg-boss provides backpressure for the async path.
    // A regression that re-introduces the throttle inside ingestInline would
    // increment getThrottledCount() above 0 here.
    expect(getThrottledCount(), `expected getThrottledCount()=0 on ingestInline path, got ${getThrottledCount()}`).toBe(0);
  });

  it('cross-fingerprint ingestInline calls → still 0 throttled (proves no throttle is consulted for any fingerprint on this path)', { skip: SKIP }, async () => {
    const inputA = makeInput('async-alpha');
    const inputB = makeInput('async-beta');
    const CALLS_EACH = 100;

    for (let i = 0; i < CALLS_EACH; i++) {
      await ingestInline(inputA);
    }
    for (let i = 0; i < CALLS_EACH; i++) {
      await ingestInline(inputB);
    }

    expect(getThrottledCount(), `expected getThrottledCount()=0 across both fingerprints on ingestInline path, got ${getThrottledCount()}`).toBe(0);
  });
});
