/**
 * computeStaffActivityPulsePure.test.ts — weighted-sum scorer for Staff
 * Activity Pulse (§2.0b). DB reads are covered by integration tests; this
 * file exercises only the math.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/computeStaffActivityPulsePure.test.ts
 */

import { computeStaffActivityPulse, type MutationRow } from '../computeStaffActivityPulsePure.js';
import type { StaffActivityDefinition } from '../orgConfigService.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const baseConfig: StaffActivityDefinition = {
  countedMutationTypes: [
    { type: 'contact_created', weight: 1.0 },
    { type: 'contact_updated', weight: 0.5 },
    { type: 'opportunity_stage_changed', weight: 2.0 },
    { type: 'message_sent_outbound', weight: 1.5 },
  ],
  excludedUserKinds: ['automation', 'contact', 'unknown'],
  automationUserResolution: { strategy: 'outlier_by_volume', threshold: 0.6, cacheMonths: 1 },
  lookbackWindowsDays: [7, 30, 90],
  churnFlagThresholds: { zeroActivityDays: 14, weekOverWeekDropPct: 50 },
};

const now = new Date('2026-04-10T12:00:00Z');

function m(daysAgo: number, mutationType: string, externalUserKind: MutationRow['externalUserKind'] = 'staff'): MutationRow {
  return {
    occurredAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    mutationType,
    externalUserKind,
    externalUserId: 'user-1',
  };
}

test('empty mutation list → zero score, zero counts', () => {
  const result = computeStaffActivityPulse([], baseConfig, now);
  assert(result.numericValue === 0, `got ${result.numericValue}`);
  assert(Object.keys(result.jsonPayload.countsByType).length === 0, 'no counts');
  assert(result.jsonPayload.windows.length === 3, '3 windows');
});

test('weights applied per mutation type', () => {
  const result = computeStaffActivityPulse(
    [
      m(1, 'contact_created'), // 1.0
      m(1, 'contact_updated'), // 0.5
      m(1, 'opportunity_stage_changed'), // 2.0
    ],
    baseConfig,
    now,
  );
  // 30-day window: 3.5
  assert(result.numericValue === 3.5, `expected 3.5, got ${result.numericValue}`);
  assert(result.jsonPayload.countsByType.contact_created === 1, 'contact_created count');
});

test('excluded user kinds do not contribute', () => {
  const result = computeStaffActivityPulse(
    [
      m(1, 'contact_created', 'staff'),
      m(1, 'contact_created', 'automation'),
      m(1, 'contact_created', 'contact'),
      m(1, 'contact_created', 'unknown'),
    ],
    baseConfig,
    now,
  );
  assert(result.numericValue === 1.0, `only staff row counts, got ${result.numericValue}`);
  assert(result.jsonPayload.excludedUserMutationCount === 3, 'excluded count');
});

test('unconfigured mutation type contributes zero (not penalised)', () => {
  const result = computeStaffActivityPulse(
    [
      m(1, 'contact_created'),
      m(1, 'workflow_edited'), // not in baseConfig.countedMutationTypes
    ],
    baseConfig,
    now,
  );
  assert(result.numericValue === 1.0, `workflow_edited not counted, got ${result.numericValue}`);
  assert(
    result.jsonPayload.countsByType.workflow_edited === undefined,
    'unconfigured types do not appear in countsByType',
  );
});

test('lookback window respected — mutation outside longest window dropped', () => {
  const result = computeStaffActivityPulse(
    [
      m(95, 'contact_created'), // outside 90-day window
      m(1, 'contact_created'),
    ],
    baseConfig,
    now,
  );
  assert(result.numericValue === 1.0, 'only within-window counts');
  // 90-day window should still show raw count 1
  const w90 = result.jsonPayload.windows.find((w) => w.days === 90);
  assert(w90?.weightedScore === 1.0, `w90 got ${w90?.weightedScore}`);
});

test('per-window scoring — 7d vs 30d vs 90d', () => {
  const mutations: MutationRow[] = [
    m(2, 'contact_created'), // inside all three
    m(20, 'contact_created'), // inside 30+90 only
    m(60, 'contact_created'), // inside 90 only
  ];
  const result = computeStaffActivityPulse(mutations, baseConfig, now);
  const w7 = result.jsonPayload.windows.find((w) => w.days === 7);
  const w30 = result.jsonPayload.windows.find((w) => w.days === 30);
  const w90 = result.jsonPayload.windows.find((w) => w.days === 90);
  assert(w7?.weightedScore === 1.0, `w7 expected 1, got ${w7?.weightedScore}`);
  assert(w30?.weightedScore === 2.0, `w30 expected 2, got ${w30?.weightedScore}`);
  assert(w90?.weightedScore === 3.0, `w90 expected 3, got ${w90?.weightedScore}`);
});

test('falls back to longest window when 30-day not configured', () => {
  const config: StaffActivityDefinition = {
    ...baseConfig,
    lookbackWindowsDays: [7, 14],
  };
  const result = computeStaffActivityPulse(
    [m(1, 'contact_created'), m(10, 'contact_created')],
    config,
    now,
  );
  // 14-day window includes both = 2.0
  assert(result.numericValue === 2.0, `expected longest=14d score 2, got ${result.numericValue}`);
});

test('algorithm tag stable (schema contract)', () => {
  const result = computeStaffActivityPulse([], baseConfig, now);
  assert(result.jsonPayload.algorithm === 'weighted_sum_v1', 'algorithm version tag');
});

console.log('');
console.log(`computeStaffActivityPulsePure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
