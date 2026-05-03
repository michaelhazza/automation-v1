/**
 * workflowPublishServicePure.test.ts — unit tests for the pure decision
 * helper extracted from workflowPublishService.
 *
 * Run via:
 *   npx vitest run server/services/__tests__/workflowPublishServicePure.test.ts
 */

import { expect, test, describe } from 'vitest';
import { decidePublishOutcome } from '../workflowPublishService.js';

const PAST = new Date('2025-01-01T00:00:00Z').toISOString();
const NOW = new Date('2025-06-01T00:00:00Z').toISOString();
const FUTURE = new Date('2025-12-31T00:00:00Z').toISOString();

const noErrors = { validatorOk: true, validatorErrors: [] };
const withErrors = {
  validatorOk: false,
  validatorErrors: [{ rule: 'four_as_vocabulary' as const, message: 'bad type', severity: 'error' as const }],
};

// ─── concurrent_publish ───────────────────────────────────────────────────────

describe('concurrent_publish', () => {
  test('expected timestamp is earlier than current → concurrent_publish', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: PAST,
      currentTimestamp: NOW,
      currentUserId: 'user-abc',
      ...noErrors,
    });
    expect(outcome).toBe('concurrent_publish');
  });

  test('expected timestamp equals current → ok (no conflict)', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: NOW,
      currentTimestamp: NOW,
      currentUserId: null,
      ...noErrors,
    });
    expect(outcome).toBe('ok');
  });

  test('expected timestamp is later than current → ok (no conflict; caller has newer view)', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: FUTURE,
      currentTimestamp: NOW,
      currentUserId: null,
      ...noErrors,
    });
    expect(outcome).toBe('ok');
  });

  test('no expectedTimestamp provided → skip concurrency check', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: undefined,
      currentTimestamp: NOW,
      currentUserId: null,
      ...noErrors,
    });
    expect(outcome).toBe('ok');
  });
});

// ─── validation_failed ────────────────────────────────────────────────────────

describe('validation_failed', () => {
  test('validator returns errors → validation_failed', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: undefined,
      currentTimestamp: NOW,
      currentUserId: null,
      ...withErrors,
    });
    expect(outcome).toBe('validation_failed');
  });

  test('concurrent conflict takes priority over validation_failed', () => {
    // If both a concurrent conflict and validation errors exist, the client
    // should be informed of the conflict so it can reload before re-validating.
    const outcome = decidePublishOutcome({
      expectedTimestamp: PAST,
      currentTimestamp: NOW,
      currentUserId: 'user-xyz',
      ...withErrors,
    });
    expect(outcome).toBe('concurrent_publish');
  });
});

// ─── ok ───────────────────────────────────────────────────────────────────────

describe('ok', () => {
  test('no conflict, no validation errors → ok', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: undefined,
      currentTimestamp: NOW,
      currentUserId: null,
      ...noErrors,
    });
    expect(outcome).toBe('ok');
  });

  test('expectedTimestamp matches current and no errors → ok', () => {
    const outcome = decidePublishOutcome({
      expectedTimestamp: NOW,
      currentTimestamp: NOW,
      currentUserId: null,
      ...noErrors,
    });
    expect(outcome).toBe('ok');
  });
});
