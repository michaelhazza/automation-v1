/**
 * errorsPure.test.ts — Pure-function tests for AppError constructor.
 *
 * Runnable via:
 *   npx tsx server/lib/__tests__/errorsPure.test.ts
 */

import assert from 'node:assert/strict';
import { AppError } from '../errors.js';

// ─── Test 1: code, statusCode, message set correctly ─────────────────────────

{
  const err = new AppError({
    code: 'RUN_NOT_FOUND',
    statusCode: 404,
    message: 'Run not found',
  });

  assert.equal(err.code, 'RUN_NOT_FOUND', 'code should be set');
  assert.equal(err.statusCode, 404, 'statusCode should be set');
  assert.equal(err.message, 'Run not found', 'message should be set');
  assert.equal(err.name, 'AppError', 'name should be AppError');
  assert.ok(err instanceof Error, 'should be instanceof Error');
  assert.ok(err instanceof AppError, 'should be instanceof AppError');
  console.log('PASS: code, statusCode, message, name set correctly');
}

// ─── Test 2: context set and frozen when provided ────────────────────────────

{
  const err = new AppError({
    code: 'OPTIMISTIC_LOCK_FAILED',
    statusCode: 409,
    message: 'Lock conflict',
    context: { resourceId: 'abc-123', attempt: 3 },
  });

  assert.ok(err.context !== undefined, 'context should be set');
  assert.equal(err.context!['resourceId'], 'abc-123', 'context.resourceId should match');
  assert.equal(err.context!['attempt'], 3, 'context.attempt should match');
  assert.ok(Object.isFrozen(err.context), 'context should be frozen');
  console.log('PASS: context set and frozen');
}

// ─── Test 3: context is undefined when not provided ──────────────────────────

{
  const err = new AppError({
    code: 'LEGACY_ERROR',
    statusCode: 500,
    message: 'Something went wrong',
  });

  assert.equal(err.context, undefined, 'context should be undefined when not provided');
  console.log('PASS: context is undefined when not provided');
}

// ─── Test 4: context immutability — original object mutation does not affect error ──

{
  const ctx: Record<string, unknown> = { foo: 'bar' };
  const err = new AppError({
    code: 'CROSS_TENANT_TOKEN_REFRESH',
    statusCode: 403,
    message: 'Cross-tenant blocked',
    context: ctx,
  });

  // Mutate the original object after construction
  ctx['foo'] = 'mutated';
  ctx['extra'] = 'injected';

  assert.equal(err.context!['foo'], 'bar', 'context should not reflect mutation of source object');
  assert.equal(err.context!['extra'], undefined, 'context should not have injected key');
  console.log('PASS: context is a frozen copy, not a reference');
}

// ─── Test 5: stack trace is present ──────────────────────────────────────────

{
  const err = new AppError({
    code: 'MISSING_PRINCIPAL_CONTEXT',
    statusCode: 500,
    message: 'Principal context not set',
  });

  assert.ok(typeof err.stack === 'string' && err.stack.length > 0, 'stack should be present');
  console.log('PASS: stack trace is present');
}

// ─── Type-level compile check (if this file compiles, the type is correct) ───

{
  // This line must compile without error — verifies AppErrorCode union includes this value.
  const _: import('../../../shared/errorCodes.js').AppErrorCode = 'CROSS_TENANT_TOKEN_REFRESH';
  void _;
}

console.log('\nAll AppError pure tests passed.');
