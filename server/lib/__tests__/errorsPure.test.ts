/**
 * Pure-function tests for AppError constructor.
 */

import { expect, test } from 'vitest';
import { AppError } from '../errors.js';

test('code, statusCode, message, name set correctly', () => {
  const err = new AppError({
    code: 'RUN_NOT_FOUND',
    statusCode: 404,
    message: 'Run not found',
  });
  expect(err.code).toBe('RUN_NOT_FOUND');
  expect(err.statusCode).toBe(404);
  expect(err.message).toBe('Run not found');
  expect(err.name).toBe('AppError');
  expect(err instanceof Error).toBe(true);
  expect(err instanceof AppError).toBe(true);
});

test('context set and frozen when provided', () => {
  const err = new AppError({
    code: 'OPTIMISTIC_LOCK_FAILED',
    statusCode: 409,
    message: 'Lock conflict',
    context: { resourceId: 'abc-123', attempt: 3 },
  });
  expect(err.context).toBeDefined();
  expect(err.context!['resourceId']).toBe('abc-123');
  expect(err.context!['attempt']).toBe(3);
  expect(Object.isFrozen(err.context)).toBe(true);
});

test('context is undefined when not provided', () => {
  const err = new AppError({
    code: 'LEGACY_ERROR',
    statusCode: 500,
    message: 'Something went wrong',
  });
  expect(err.context).toBeUndefined();
});

test('context is a frozen copy, not a reference', () => {
  const ctx: Record<string, unknown> = { foo: 'bar' };
  const err = new AppError({
    code: 'CROSS_TENANT_TOKEN_REFRESH',
    statusCode: 403,
    message: 'Cross-tenant blocked',
    context: ctx,
  });
  ctx['foo'] = 'mutated';
  ctx['extra'] = 'injected';
  expect(err.context!['foo']).toBe('bar');
  expect(err.context!['extra']).toBeUndefined();
});

test('stack trace is present', () => {
  const err = new AppError({
    code: 'MISSING_PRINCIPAL_CONTEXT',
    statusCode: 500,
    message: 'Principal context not set',
  });
  expect(typeof err.stack).toBe('string');
  expect(err.stack!.length).toBeGreaterThan(0);
});

test('AppErrorCode union includes CROSS_TENANT_TOKEN_REFRESH (compile check)', () => {
  const _: import('../../../shared/errorCodes.js').AppErrorCode = 'CROSS_TENANT_TOKEN_REFRESH';
  void _;
  expect(true).toBe(true);
});
