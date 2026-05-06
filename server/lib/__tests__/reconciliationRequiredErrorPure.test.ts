import { expect, test } from 'vitest';
import {
  ReconciliationRequiredError,
  isReconciliationRequiredError,
} from '../reconciliationRequiredError.js';

// ---------------------------------------------------------------------------
// Pins the ReconciliationRequiredError contract (deferred-items brief §1).
// Callers of routeCall catch this error and decide how to handle — auto-
// retry inside the router is explicitly rejected.
// ---------------------------------------------------------------------------

test('ReconciliationRequiredError carries code=RECONCILIATION_REQUIRED', () => {
  const err = new ReconciliationRequiredError({ idempotencyKey: 'v1:org:run:...' });
  expect(err.code).toBe('RECONCILIATION_REQUIRED');
  expect(err.statusCode).toBe(409);
  expect(err.name).toBe('ReconciliationRequiredError');
  expect(err instanceof Error).toBeTruthy();
});

test('ReconciliationRequiredError carries idempotencyKey and optional runtimeKey', () => {
  const err1 = new ReconciliationRequiredError({ idempotencyKey: 'k_1' });
  expect(err1.idempotencyKey).toBe('k_1');
  expect(err1.existingRuntimeKey).toBe(null);

  const err2 = new ReconciliationRequiredError({
    idempotencyKey:     'k_2',
    existingRuntimeKey: 'rt_xyz',
  });
  expect(err2.idempotencyKey).toBe('k_2');
  expect(err2.existingRuntimeKey).toBe('rt_xyz');
});

test('ReconciliationRequiredError default message calls out double-bill risk', () => {
  const err = new ReconciliationRequiredError({ idempotencyKey: 'k_1' });
  expect(err.message).toMatch(/double-bill/);
  expect(err.message).toMatch(/provisional 'started' row/);
});

test('ReconciliationRequiredError accepts custom message override', () => {
  const err = new ReconciliationRequiredError({
    idempotencyKey: 'k_1',
    message:        'custom',
  });
  expect(err.message).toBe('custom');
});

test('isReconciliationRequiredError — positive case', () => {
  const err = new ReconciliationRequiredError({ idempotencyKey: 'k' });
  expect(isReconciliationRequiredError(err)).toBe(true);
});

test('isReconciliationRequiredError — negative cases', () => {
  expect(isReconciliationRequiredError(new Error('other'))).toBe(false);
  expect(isReconciliationRequiredError('string')).toBe(false);
  expect(isReconciliationRequiredError(null)).toBe(false);
  expect(isReconciliationRequiredError(undefined)).toBe(false);
  expect(isReconciliationRequiredError({ code: 'RECONCILIATION_REQUIRED' })).toBe(false);  // duck-type not enough
});
