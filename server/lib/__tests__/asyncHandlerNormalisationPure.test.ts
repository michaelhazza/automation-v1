/**
 * asyncHandlerNormalisationPure.test.ts — Pure-function tests for asyncHandler
 * legacy-error normalisation.
 *
 * Tests the normaliseRouteError pure helper that asyncHandler delegates to.
 * This avoids pulling in env/db/logger side effects.
 *
 * Runnable via:
 *   npx tsx server/lib/__tests__/asyncHandlerNormalisationPure.test.ts
 */

import assert from 'node:assert/strict';
import { AppError } from '../errors.js';
import { normaliseRouteError } from '../asyncHandlerNormalisationPure.js';

// ─── Test 1: AppError thrown directly → kind:'appError' ──────────────────────

{
  const thrown = new AppError({
    code: 'RUN_NOT_FOUND',
    statusCode: 404,
    message: 'Run was not found',
  });

  const result = normaliseRouteError(thrown);

  assert.equal(result.kind, 'appError', 'AppError should route to appError kind');
  assert.ok(result.kind === 'appError', 'narrowing guard');
  assert.equal(result.error.code, 'RUN_NOT_FOUND', 'code preserved');
  assert.equal(result.error.statusCode, 404, 'statusCode preserved');
  assert.equal(result.error.message, 'Run was not found', 'message preserved');
  assert.ok(result.error instanceof AppError, 'error is AppError');
  console.log('PASS: AppError routed to appError branch');
}

// ─── Test 2: Duck-typed { statusCode, message, errorCode } → kind:'legacy' ───

{
  const thrown = {
    statusCode: 422,
    message: 'Validation failed',
    errorCode: 'VALIDATION_ERROR',
  };

  const result = normaliseRouteError(thrown);

  assert.equal(result.kind, 'legacy', 'duck-type should route to legacy kind');
  assert.ok(result.kind === 'legacy', 'narrowing guard');
  assert.equal(result.error.statusCode, 422, 'statusCode promoted');
  assert.equal(result.error.message, 'Validation failed', 'message promoted');
  // The errorCode is cast to AppErrorCode at runtime (TypeScript type assertion does not
  // validate at runtime). Whatever string was in errorCode is used as-is.
  assert.equal(result.error.code as string, 'VALIDATION_ERROR', 'errorCode cast and preserved');
  assert.deepEqual(result.error.context, Object.freeze({ legacy: true }), 'context marks as legacy');
  console.log('PASS: duck-typed error normalised to legacy AppError');
}

// ─── Test 3: Duck-typed without errorCode → LEGACY_ERROR ─────────────────────

{
  const thrown = {
    statusCode: 409,
    message: 'Conflict occurred',
  };

  const result = normaliseRouteError(thrown);

  assert.equal(result.kind, 'legacy', 'duck-type without errorCode routes to legacy');
  assert.ok(result.kind === 'legacy', 'narrowing guard');
  assert.equal(result.error.code, 'LEGACY_ERROR', 'missing errorCode → LEGACY_ERROR');
  assert.equal(result.error.statusCode, 409, 'statusCode preserved');
  console.log('PASS: duck-typed error without errorCode → LEGACY_ERROR');
}

// ─── Test 4: True unknown (string) → kind:'unknown' ─────────────────────────

{
  const thrown = 'some unexpected string error';

  const result = normaliseRouteError(thrown);

  assert.equal(result.kind, 'unknown', 'string error routes to unknown kind');
  assert.ok(result.kind === 'unknown', 'narrowing guard');
  assert.equal(result.statusCode, 500, 'true unknown → 500');
  assert.equal(result.code, 'LEGACY_ERROR', 'true unknown → LEGACY_ERROR');
  assert.equal(result.message, 'some unexpected string error', 'string message preserved');
  console.log('PASS: string thrown → unknown kind, 500, LEGACY_ERROR');
}

// ─── Test 5: True unknown (plain Error without statusCode) → kind:'unknown' ───

{
  const thrown = new Error('bare error without statusCode');

  const result = normaliseRouteError(thrown);

  assert.equal(result.kind, 'unknown', 'bare Error (no statusCode) routes to unknown');
  assert.ok(result.kind === 'unknown', 'narrowing guard');
  assert.equal(result.statusCode, 500, '500 path');
  assert.equal(result.message, 'bare error without statusCode', 'message from Error.message');
  console.log('PASS: bare Error without statusCode → unknown kind');
}

// ─── Test 6: Wire output is identical for duck-shaped throw (statusCode shape) ─
// Validates the contract from the spec: "identical wire output" for duck-shapes.
// Uses LEGACY_ERROR which IS a valid AppErrorCode.

{
  const thrown = { statusCode: 422, message: 'Bad input', errorCode: 'LEGACY_ERROR' };
  const result = normaliseRouteError(thrown);

  assert.ok(result.kind === 'legacy', 'routes to legacy');
  // Wire shape: { error: { code, message }, correlationId }
  const wireCode = result.error.code;
  const wireStatus = result.error.statusCode;
  const wireMessage = result.error.message;

  assert.equal(wireCode, 'LEGACY_ERROR', 'code field matches');
  assert.equal(wireStatus, 422, 'status field matches');
  assert.equal(wireMessage, 'Bad input', 'message field matches');
  console.log('PASS: duck-shape wire output shape matches contract');
}

console.log('\nAll asyncHandler normalisation pure tests passed.');
