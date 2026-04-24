import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
  assert.equal(err.code, 'RECONCILIATION_REQUIRED');
  assert.equal(err.statusCode, 409);
  assert.equal(err.name, 'ReconciliationRequiredError');
  assert.ok(err instanceof Error);
});

test('ReconciliationRequiredError carries idempotencyKey and optional runtimeKey', () => {
  const err1 = new ReconciliationRequiredError({ idempotencyKey: 'k_1' });
  assert.equal(err1.idempotencyKey, 'k_1');
  assert.equal(err1.existingRuntimeKey, null);

  const err2 = new ReconciliationRequiredError({
    idempotencyKey:     'k_2',
    existingRuntimeKey: 'rt_xyz',
  });
  assert.equal(err2.idempotencyKey, 'k_2');
  assert.equal(err2.existingRuntimeKey, 'rt_xyz');
});

test('ReconciliationRequiredError default message calls out double-bill risk', () => {
  const err = new ReconciliationRequiredError({ idempotencyKey: 'k_1' });
  assert.match(err.message, /double-bill/, 'message must explain the risk');
  assert.match(err.message, /provisional 'started' row/);
});

test('ReconciliationRequiredError accepts custom message override', () => {
  const err = new ReconciliationRequiredError({
    idempotencyKey: 'k_1',
    message:        'custom',
  });
  assert.equal(err.message, 'custom');
});

test('isReconciliationRequiredError — positive case', () => {
  const err = new ReconciliationRequiredError({ idempotencyKey: 'k' });
  assert.equal(isReconciliationRequiredError(err), true);
});

test('isReconciliationRequiredError — negative cases', () => {
  assert.equal(isReconciliationRequiredError(new Error('other')), false);
  assert.equal(isReconciliationRequiredError('string'), false);
  assert.equal(isReconciliationRequiredError(null), false);
  assert.equal(isReconciliationRequiredError(undefined), false);
  assert.equal(isReconciliationRequiredError({ code: 'RECONCILIATION_REQUIRED' }), false);  // duck-type not enough
});
