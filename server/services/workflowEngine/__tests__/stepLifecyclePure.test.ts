import { describe, test, expect } from 'vitest';
import { buildFailStepRunColumnSet } from '../stepLifecyclePure.js';

describe('buildFailStepRunColumnSet', () => {
  test('column-parity: returns exactly the column-name set that failStepRunInternal writes', () => {
    const result = buildFailStepRunColumnSet('test_reason', 1, new Date());
    expect(Object.keys(result).sort()).toEqual(
      ['completedAt', 'error', 'status', 'updatedAt', 'version'],
    );
  });

  test('sets status to "failed"', () => {
    const result = buildFailStepRunColumnSet('some_reason', 0, new Date());
    expect(result.status).toBe('failed');
  });

  test('sets error to the provided reason string', () => {
    const result = buildFailStepRunColumnSet('approval_timed_out', 0, new Date());
    expect(result.error).toBe('approval_timed_out');
  });

  test('increments version by 1', () => {
    const result = buildFailStepRunColumnSet('reason', 5, new Date());
    expect(result.version).toBe(6);
  });

  test('sets completedAt and updatedAt to the provided now', () => {
    const now = new Date('2026-05-19T00:00:00Z');
    const result = buildFailStepRunColumnSet('reason', 0, now);
    expect(result.completedAt).toBe(now);
    expect(result.updatedAt).toBe(now);
  });
});
