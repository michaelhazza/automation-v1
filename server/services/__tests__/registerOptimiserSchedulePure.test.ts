/**
 * registerOptimiserSchedulePure.test.ts
 *
 * Pure-function tests for the optimiser cron-stagger formula.
 * Only tests computeStaggerMinutes — no DB connections.
 *
 * Run via: npx vitest run server/services/__tests__/registerOptimiserSchedulePure.test.ts
 */

import { expect, test, describe, vi } from 'vitest';
import { createHash } from 'crypto';
import { computeStaggerMinutes } from '../agentScheduleService.js';

// ---------------------------------------------------------------------------
// Mock all modules that have side-effects at import time so that importing
// agentScheduleService does not trigger DB connections or env validation.
// ---------------------------------------------------------------------------

vi.mock('../../db/index.js', () => ({
  db: {},
  client: { end: vi.fn() },
}));

vi.mock('../../lib/pgBossInstance.js', () => ({
  getPgBoss: vi.fn(),
}));

vi.mock('../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://mock',
    QUEUE_CONCURRENCY: 1,
  },
}));

vi.mock('../agentExecutionService.js', () => ({
  agentExecutionService: { executeRun: vi.fn() },
}));

vi.mock('../skillExecutor.js', () => ({
  setHandoffJobSender: vi.fn(),
  SKILL_HANDLERS: {},
}));

vi.mock('../triggerService.js', () => ({
  setTriggerJobSender: vi.fn(),
}));

vi.mock('../workspaceMemoryService.js', () => ({
  setContextEnrichmentJobSender: vi.fn(),
}));

vi.mock('../../config/jobConfig.js', () => ({
  getJobConfig: vi.fn(),
}));

vi.mock('../../lib/jobErrors.js', () => ({
  isNonRetryable: vi.fn(),
  isTimeoutError: vi.fn(),
  getRetryCount: vi.fn().mockReturnValue(0),
  withTimeout: vi.fn((p: Promise<unknown>) => p),
}));

vi.mock('../../lib/createWorker.js', () => ({
  createWorker: vi.fn(),
}));

vi.mock('../../lib/orgScopedDb.js', () => ({
  getOrgScopedDb: vi.fn(),
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Reference implementation of the formula (for cross-checking)
// ---------------------------------------------------------------------------
function referenceStagger(subaccountId: string): number {
  const hashHex = createHash('sha256').update(subaccountId).digest('hex');
  return parseInt(hashHex.slice(0, 4), 16) % 360;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeStaggerMinutes', () => {
  test('always returns a value in [0, 359]', () => {
    const ids = [
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
      'test-subaccount-id',
      '1',
    ];
    for (const id of ids) {
      const minutes = computeStaggerMinutes(id);
      expect(minutes, `expected [0,359] for id=${id}`).toBeGreaterThanOrEqual(0);
      expect(minutes, `expected [0,359] for id=${id}`).toBeLessThanOrEqual(359);
    }
  });

  test('is deterministic for the same input', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const first = computeStaggerMinutes(id);
    const second = computeStaggerMinutes(id);
    expect(first).toBe(second);
  });

  test('matches the reference formula', () => {
    const ids = [
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'subaccount-123',
      '00000000-0000-0000-0000-000000000001',
    ];
    for (const id of ids) {
      expect(computeStaggerMinutes(id)).toBe(referenceStagger(id));
    }
  });

  test('different inputs produce different outputs (basic distribution check)', () => {
    // Generate 20 distinct IDs and confirm we get at least 10 distinct values.
    // A uniform hash over [0,359] hitting all the same value for 20 inputs
    // would have probability (1/360)^19 — negligible.
    const ids = Array.from({ length: 20 }, (_, i) => `test-subaccount-${i.toString().padStart(4, '0')}`);
    const values = new Set(ids.map(computeStaggerMinutes));
    expect(values.size, `expected distribution: got ${values.size} distinct values for 20 inputs`).toBeGreaterThan(10);
  });

  test('produces a valid cron string when combined with the 6-hour window', () => {
    const id = 'some-subaccount-id';
    const minutes = computeStaggerMinutes(id);
    const cron = `${minutes} 6 * * *`;
    // Basic cron validation: should match "<number> 6 * * *"
    expect(cron).toMatch(/^\d{1,3} 6 \* \* \*$/);
    const minutePart = parseInt(cron.split(' ')[0], 10);
    expect(minutePart).toBeGreaterThanOrEqual(0);
    expect(minutePart).toBeLessThanOrEqual(359);
  });
});
