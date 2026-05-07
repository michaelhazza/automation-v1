/**
 * Pure-function tests for asyncHandler legacy-error normalisation.
 *
 * Tests the normaliseRouteError pure helper that asyncHandler delegates to.
 * Avoids pulling in env/db/logger side effects.
 */

import { expect, test } from 'vitest';
import { AppError } from '../errors.js';
import { normaliseRouteError } from '../asyncHandlerNormalisationPure.js';

test('AppError thrown directly → kind:appError', () => {
  const thrown = new AppError({
    code: 'RUN_NOT_FOUND',
    statusCode: 404,
    message: 'Run was not found',
  });
  const result = normaliseRouteError(thrown);
  expect(result.kind).toBe('appError');
  if (result.kind !== 'appError') throw new Error('narrowing guard');
  expect(result.error.code).toBe('RUN_NOT_FOUND');
  expect(result.error.statusCode).toBe(404);
  expect(result.error.message).toBe('Run was not found');
  expect(result.error instanceof AppError).toBe(true);
});

test('duck-typed error normalised to legacy AppError', () => {
  const thrown = {
    statusCode: 422,
    message: 'Validation failed',
    errorCode: 'VALIDATION_ERROR',
  };
  const result = normaliseRouteError(thrown);
  expect(result.kind).toBe('legacy');
  if (result.kind !== 'legacy') throw new Error('narrowing guard');
  expect(result.error.statusCode).toBe(422);
  expect(result.error.message).toBe('Validation failed');
  expect(result.error.code as string).toBe('VALIDATION_ERROR');
  expect(result.error.context).toEqual(Object.freeze({ legacy: true }));
});

test('duck-typed error without errorCode → LEGACY_ERROR', () => {
  const thrown = {
    statusCode: 409,
    message: 'Conflict occurred',
  };
  const result = normaliseRouteError(thrown);
  expect(result.kind).toBe('legacy');
  if (result.kind !== 'legacy') throw new Error('narrowing guard');
  expect(result.error.code).toBe('LEGACY_ERROR');
  expect(result.error.statusCode).toBe(409);
});

test('string thrown → unknown kind, 500, LEGACY_ERROR', () => {
  const thrown = 'some unexpected string error';
  const result = normaliseRouteError(thrown);
  expect(result.kind).toBe('unknown');
  if (result.kind !== 'unknown') throw new Error('narrowing guard');
  expect(result.statusCode).toBe(500);
  expect(result.code).toBe('LEGACY_ERROR');
  expect(result.message).toBe('some unexpected string error');
});

test('bare Error without statusCode → unknown kind', () => {
  const thrown = new Error('bare error without statusCode');
  const result = normaliseRouteError(thrown);
  expect(result.kind).toBe('unknown');
  if (result.kind !== 'unknown') throw new Error('narrowing guard');
  expect(result.statusCode).toBe(500);
  expect(result.message).toBe('bare error without statusCode');
});

test('duck-shape wire output shape matches contract', () => {
  const thrown = { statusCode: 422, message: 'Bad input', errorCode: 'LEGACY_ERROR' };
  const result = normaliseRouteError(thrown);
  expect(result.kind).toBe('legacy');
  if (result.kind !== 'legacy') throw new Error('narrowing guard');
  expect(result.error.code).toBe('LEGACY_ERROR');
  expect(result.error.statusCode).toBe(422);
  expect(result.error.message).toBe('Bad input');
});
