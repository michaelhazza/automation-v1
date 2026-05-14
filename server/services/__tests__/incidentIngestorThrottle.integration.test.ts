/**
 * incidentIngestorThrottle.integration.test.ts
 *
 * Integration tests verifying throttle behaviour when wired into recordIncident
 * (sync branch). The throttle check now lives in recordIncident's else-branch;
 * ingestInline is a pure write path that the async-worker calls directly
 * without hitting the throttle (spec §1.7, 2026-04-28 pre-test backend hardening).
 *
 * Uses vitest fake timers for deterministic time control. The DB upsert is
 * mocked at the module boundary so no real database is required even when
 * NODE_ENV=integration.
 */

// Must be set before any module imports so env-based config is picked up.
process.env.NODE_ENV ??= 'test';
process.env.SYSTEM_INCIDENT_THROTTLE_MS ??= '1000';
process.env.SYSTEM_INCIDENT_INGEST_ENABLED ??= 'true';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentInput } from '../incidentIngestorPure.js';

const SKIP = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';
if (SKIP) {
  // env.ts validates DATABASE_URL at module load. Provide a placeholder so the
  // dynamic imports below do not crash on the skip path.
  process.env.DATABASE_URL ??= 'postgres://placeholder/skip';
  process.env.JWT_SECRET ??= 'skip-placeholder-jwt';
  process.env.EMAIL_FROM ??= 'skip@placeholder.example';
}

// vi.mock is hoisted to the top of the file — applies regardless of SKIP.
// The dynamic imports below pick up these mocked modules.
vi.mock('../../db/index.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
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
}));

vi.mock('../../lib/pgBossInstance.js', () => ({
  getPgBoss: async () => ({
    send: async () => undefined,
  }),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    info: () => undefined,
  },
}));

let recordIncident: Awaited<typeof import('../incidentIngestor.js')>['recordIncident'];
let ingestInline: Awaited<typeof import('../incidentIngestor.js')>['ingestInline'];
let __resetForTest: Awaited<typeof import('../incidentIngestor.js')>['__resetForTest'];
let getThrottledCount: Awaited<typeof import('../incidentIngestorThrottle.js')>['getThrottledCount'];
let resetThrottle: Awaited<typeof import('../incidentIngestorThrottle.js')>['__resetForTest'];

if (!SKIP) {
  ({ recordIncident, ingestInline, __resetForTest } = await import('../incidentIngestor.js'));
  ({ getThrottledCount, __resetForTest: resetThrottle } = await import('../incidentIngestorThrottle.js'));
}

function makeInput(suffix = 'A') {
  return {
    source: 'self',
    summary: `Test incident ${suffix}`,
    severity: 'low',
    correlationId: `corr-${suffix}`,
  } satisfies IncidentInput;
}

describe.skipIf(SKIP)('recordIncident (sync branch) throttle integration', () => {
  beforeEach(() => {
    __resetForTest();
    resetThrottle();
  });

  afterEach(() => {
    __resetForTest();
    resetThrottle();
  });

  it('burst dedup: 1000 sequential calls with the same fingerprint → 1 real call + 999 throttled (via getThrottledCount)', async () => {
    const input = makeInput('A');
    const CALLS = 1000;

    for (let i = 0; i < CALLS; i++) {
      await recordIncident(input);
    }

    expect(getThrottledCount(), `expected getThrottledCount()=999, got ${getThrottledCount()}`).toBe(999);
  });

  it('cross-fingerprint independence: 100 calls each for A and B → only 2 real calls (198 throttled)', async () => {
    const inputA = makeInput('alpha');
    const inputB = makeInput('beta');
    const CALLS_EACH = 100;

    for (let i = 0; i < CALLS_EACH; i++) {
      await recordIncident(inputA);
    }
    for (let i = 0; i < CALLS_EACH; i++) {
      await recordIncident(inputB);
    }

    const expected = (CALLS_EACH - 1) + (CALLS_EACH - 1);
    expect(getThrottledCount(), `expected getThrottledCount()=${expected}, got ${getThrottledCount()}`).toBe(expected);
  });

  it('throttle window expiry: call once, advance fake clock past 1 second, call again → 2 real calls (1 throttled in between)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      const input = makeInput('expiry');

      await recordIncident(input);
      expect(getThrottledCount(), 'first call should not be throttled').toBe(0);

      await recordIncident(input);
      expect(getThrottledCount(), 'second call within window should be throttled').toBe(1);

      vi.advanceTimersByTime(1001);

      await recordIncident(input);
      expect(getThrottledCount(), 'call after window expiry should not be throttled (count stays at 1)').toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(SKIP)('ingestInline (async-worker path) bypasses throttle (spec §1.7 MUST)', () => {
  beforeEach(() => {
    __resetForTest();
    resetThrottle();
  });

  afterEach(() => {
    __resetForTest();
    resetThrottle();
  });

  it('1000 direct ingestInline calls with the same fingerprint → getThrottledCount() stays at 0', async () => {
    const input = makeInput('async-worker');
    const CALLS = 1000;

    for (let i = 0; i < CALLS; i++) {
      await ingestInline(input);
    }

    expect(getThrottledCount(), `expected getThrottledCount()=0 on ingestInline path, got ${getThrottledCount()}`).toBe(0);
  });

  it('cross-fingerprint ingestInline calls → still 0 throttled (proves no throttle is consulted for any fingerprint on this path)', async () => {
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
