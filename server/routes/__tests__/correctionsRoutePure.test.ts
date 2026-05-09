/**
 * correctionsRoutePure.test.ts
 *
 * Pure tests for the corrections route's eventId-shape validator.
 * Trust & Verification Layer spec §9 (cross-entity guard) and §13.2.
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/correctionsRoutePure.test.ts
 */

import { describe, expect, test } from 'vitest';
import { validateEventIdShape } from '../correctionsRoutePure.js';

describe('validateEventIdShape', () => {
  test('non-empty distinct eventId passes', () => {
    expect(
      validateEventIdShape(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ),
    ).toBe('ok');
  });

  test('eventId === runId is rejected (legacy placeholder path)', () => {
    const id = '33333333-3333-3333-3333-333333333333';
    expect(validateEventIdShape(id, id)).toBe('event_id_equals_run_id');
  });

  test('empty-string eventId is rejected', () => {
    expect(validateEventIdShape('', 'r1')).toBe('event_id_required');
  });

  test('undefined eventId is rejected', () => {
    expect(validateEventIdShape(undefined, 'r1')).toBe('event_id_required');
  });

  test('null eventId is rejected', () => {
    expect(validateEventIdShape(null, 'r1')).toBe('event_id_required');
  });

  test('non-string eventId is rejected', () => {
    expect(validateEventIdShape(123, 'r1')).toBe('event_id_required');
    expect(validateEventIdShape({ id: 'e1' }, 'r1')).toBe('event_id_required');
  });

  test('non-string runId still permits a non-empty eventId', () => {
    // The runId-equality guard only fires when both are strings; a non-string
    // runId means the upstream route already returned 404 from the run lookup.
    expect(validateEventIdShape('e1', undefined)).toBe('ok');
  });
});
