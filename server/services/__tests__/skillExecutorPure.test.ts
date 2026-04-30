/**
 * skillExecutorPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/skillExecutorPure.test.ts
 *
 * Tests the pure onFailure dispatch logic extracted from skillExecutor.ts
 * in P0.2 Slice C of docs/improvements-roadmap-spec.md.
 */

import { expect, test } from 'vitest';
import {
  applyOnFailurePure,
  applyOnFailureForStructuredFailurePure,
} from '../skillExecutorPure.js';
import { FailureError } from '../../../shared/iee/failure.js';

function assertThrows(fn: () => unknown, label: string): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error(`${label}: expected throw, but did not throw`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('');
console.log('skillExecutorPure — onFailure dispatch (Error path)');
console.log('');

const slug = 'test_tool';
const baseErr = new Error('boom');

test("'skip' wraps an Error into a structured skip response", () => {
  const out = applyOnFailurePure(slug, 'skip', undefined, baseErr);
  expect(out, 'skip result').toEqual({ success: false, skipped: true, reason: 'boom' });
});

test("'skip' coerces non-Error throwables to string", () => {
  const out = applyOnFailurePure(slug, 'skip', undefined, 'plain string');
  expect(out, 'skip non-error').toEqual({ success: false, skipped: true, reason: 'plain string' });
});

test("'fail_run' throws a FailureError tagged with execution_error", () => {
  const e = assertThrows(() => applyOnFailurePure(slug, 'fail_run', undefined, baseErr), 'fail_run');
  if (!(e instanceof FailureError)) throw new Error(`expected FailureError, got ${e}`);
  if (e.failure.failureReason !== 'execution_error') {
    throw new Error(`expected execution_error, got ${e.failure.failureReason}`);
  }
});

test("'fallback' with a configured value returns it wrapped", () => {
  const out = applyOnFailurePure(slug, 'fallback', { items: [] }, baseErr);
  expect(out, 'fallback wrap').toEqual({ success: true, usedFallback: true, value: { items: [] } });
});

test("'fallback' with undefined fallbackValue re-throws (does NOT return undefined)", () => {
  const e = assertThrows(() => applyOnFailurePure(slug, 'fallback', undefined, baseErr), 'fallback undefined');
  if (e !== baseErr) throw new Error('expected the original error to be re-thrown');
});

test("'fallback' with a falsy-but-defined value (null, 0, '') returns it wrapped", () => {
  expect(applyOnFailurePure(slug, 'fallback', null, baseErr), 'fallback null').toEqual({ success: true, usedFallback: true, value: null });
  expect(applyOnFailurePure(slug, 'fallback', 0, baseErr), 'fallback 0').toEqual({ success: true, usedFallback: true, value: 0 });
});

test("'retry' re-throws the original error reference", () => {
  const e = assertThrows(() => applyOnFailurePure(slug, 'retry', undefined, baseErr), 'retry');
  if (e !== baseErr) throw new Error('expected the original error reference');
});

console.log('');
console.log('skillExecutorPure — onFailure dispatch (structured-failure path)');
console.log('');

const failResult = { success: false, error: 'quota exceeded' };

test("'skip' wraps a structured failure into a skip response", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'skip', undefined, failResult);
  expect(out, 'skip structured').toEqual({ success: false, skipped: true, reason: 'quota exceeded' });
});

test("'skip' falls back to a default reason when result.error is missing", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'skip', undefined, { success: false });
  expect(out, 'skip default reason').toEqual({ success: false, skipped: true, reason: 'skill returned success: false' });
});

test("'fail_run' throws FailureError carrying the structured error message", () => {
  const e = assertThrows(
    () => applyOnFailureForStructuredFailurePure(slug, 'fail_run', undefined, failResult),
    'fail_run structured',
  );
  if (!(e instanceof FailureError)) throw new Error(`expected FailureError, got ${e}`);
  if (!String(e.failure.failureDetail ?? '').includes('quota exceeded')) {
    throw new Error(`expected message to include 'quota exceeded', got ${JSON.stringify(e.failure)}`);
  }
});

test("'fallback' with configured value wraps it", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'fallback', 'cached', failResult);
  expect(out, 'fallback structured').toEqual({ success: true, usedFallback: true, value: 'cached' });
});

test("'fallback' with undefined value passes the structured failure through unchanged", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'fallback', undefined, failResult);
  expect(out, 'fallback passthrough').toEqual(failResult);
});

test("'retry' returns the structured failure unchanged", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'retry', undefined, failResult);
  expect(out, 'retry passthrough').toEqual(failResult);
});

console.log('');
