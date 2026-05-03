/**
 * workflowGateStallNotifyServicePure.test.ts
 *
 * Unit tests for pure stall-and-notify helpers.
 * No DB, no pg-boss, no side-effects.
 *
 * Run via: npx vitest run server/services/__tests__/workflowGateStallNotifyServicePure.test.ts
 * Or:      npx tsx server/services/__tests__/workflowGateStallNotifyServicePure.test.ts
 */

import { describe, expect, test } from 'vitest';
import {
  buildStallJobName,
  computeStallSchedule,
  isStallFireStale,
  STALL_CADENCES,
} from '../workflowGateStallNotifyServicePure.js';

// ── buildStallJobName ────────────────────────────────────────────────────────

describe('buildStallJobName', () => {
  test('produces stall-notify-${gateId}-${cadence} format', () => {
    const gateId = '550e8400-e29b-41d4-a716-446655440000';
    expect(buildStallJobName(gateId, '24h')).toBe(`stall-notify-${gateId}-24h`);
    expect(buildStallJobName(gateId, '72h')).toBe(`stall-notify-${gateId}-72h`);
    expect(buildStallJobName(gateId, '7d')).toBe(`stall-notify-${gateId}-7d`);
  });

  test('each cadence produces a distinct job name for the same gateId', () => {
    const gateId = 'abc-123';
    const names = STALL_CADENCES.map((c) => buildStallJobName(gateId, c));
    const unique = new Set(names);
    expect(unique.size).toBe(STALL_CADENCES.length);
  });

  test('different gateIds produce different names for the same cadence', () => {
    const name1 = buildStallJobName('gate-A', '24h');
    const name2 = buildStallJobName('gate-B', '24h');
    expect(name1).not.toBe(name2);
  });
});

// ── computeStallSchedule ─────────────────────────────────────────────────────

describe('computeStallSchedule', () => {
  test('returns exactly 3 entries', () => {
    const entries = computeStallSchedule();
    expect(entries).toHaveLength(3);
  });

  test('covers all three cadences', () => {
    const entries = computeStallSchedule();
    const cadences = entries.map((e) => e.cadence).sort();
    expect(cadences).toEqual(['24h', '72h', '7d']);
  });

  test('24h entry fires after 86400 seconds', () => {
    const entries = computeStallSchedule();
    const entry24 = entries.find((e) => e.cadence === '24h')!;
    expect(entry24.startAfterSeconds).toBe(24 * 60 * 60); // 86400
  });

  test('72h entry fires after 259200 seconds', () => {
    const entries = computeStallSchedule();
    const entry72 = entries.find((e) => e.cadence === '72h')!;
    expect(entry72.startAfterSeconds).toBe(72 * 60 * 60); // 259200
  });

  test('7d entry fires after 604800 seconds', () => {
    const entries = computeStallSchedule();
    const entry7d = entries.find((e) => e.cadence === '7d')!;
    expect(entry7d.startAfterSeconds).toBe(7 * 24 * 60 * 60); // 604800
  });

  test('startAfterSeconds are all positive and ordered ascending', () => {
    const entries = computeStallSchedule().sort((a, b) => a.startAfterSeconds - b.startAfterSeconds);
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].startAfterSeconds).toBeGreaterThan(0);
      if (i > 0) {
        expect(entries[i].startAfterSeconds).toBeGreaterThan(entries[i - 1].startAfterSeconds);
      }
    }
  });
});

// ── isStallFireStale ─────────────────────────────────────────────────────────

describe('isStallFireStale', () => {
  const createdAt = new Date('2026-01-01T12:00:00.000Z');
  const expectedIso = createdAt.toISOString();

  // Truth table:
  //   resolvedAt | createdAt matches? | stale?
  //   non-null   | yes                | true  (gate already resolved)
  //   non-null   | no                 | true  (gate already resolved)
  //   null       | yes                | false (gate still open, same row)
  //   null       | no                 | true  (gate was recreated — impossible but defensive)

  test('resolvedAt non-null AND createdAt matches → stale', () => {
    expect(isStallFireStale(new Date(), createdAt, expectedIso)).toBe(true);
  });

  test('resolvedAt non-null AND createdAt does not match → stale', () => {
    const differentCreatedAt = new Date('2026-02-01T00:00:00.000Z');
    expect(isStallFireStale(new Date(), differentCreatedAt, expectedIso)).toBe(true);
  });

  test('resolvedAt null AND createdAt matches exactly → NOT stale', () => {
    expect(isStallFireStale(null, createdAt, expectedIso)).toBe(false);
  });

  test('resolvedAt null AND createdAt does not match expectedIso → stale', () => {
    const differentCreatedAt = new Date('2026-02-01T00:00:00.000Z');
    expect(isStallFireStale(null, differentCreatedAt, expectedIso)).toBe(true);
  });

  test('resolvedAt null AND expectedIso is a different timestamp → stale', () => {
    const differentExpected = new Date('2025-12-31T11:59:59.000Z').toISOString();
    expect(isStallFireStale(null, createdAt, differentExpected)).toBe(true);
  });

  test('resolvedAt null AND createdAt.toISOString() matches expectedIso exactly → NOT stale', () => {
    // Millisecond precision must match
    const precise = new Date('2026-01-01T12:00:00.123Z');
    const preciseIso = precise.toISOString();
    expect(isStallFireStale(null, precise, preciseIso)).toBe(false);
  });
});
