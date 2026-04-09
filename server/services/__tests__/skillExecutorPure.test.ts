/**
 * skillExecutorPure unit tests — runnable via:
 *   npx tsx server/services/__tests__/skillExecutorPure.test.ts
 *
 * Tests the pure onFailure dispatch logic extracted from skillExecutor.ts
 * in P0.2 Slice C of docs/improvements-roadmap-spec.md.
 */

import {
  applyOnFailurePure,
  applyOnFailureForStructuredFailurePure,
} from '../skillExecutorPure.js';
import { FailureError } from '../../../shared/iee/failure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, label: string): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error(`${label}: expected throw, but did not throw`);
}

console.log('');
console.log('skillExecutorPure — onFailure dispatch (Error path)');
console.log('');

const slug = 'test_tool';
const baseErr = new Error('boom');

test("'skip' wraps an Error into a structured skip response", () => {
  const out = applyOnFailurePure(slug, 'skip', undefined, baseErr);
  assertEqual(out, { success: false, skipped: true, reason: 'boom' }, 'skip result');
});

test("'skip' coerces non-Error throwables to string", () => {
  const out = applyOnFailurePure(slug, 'skip', undefined, 'plain string');
  assertEqual(out, { success: false, skipped: true, reason: 'plain string' }, 'skip non-error');
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
  assertEqual(out, { success: true, usedFallback: true, value: { items: [] } }, 'fallback wrap');
});

test("'fallback' with undefined fallbackValue re-throws (does NOT return undefined)", () => {
  const e = assertThrows(() => applyOnFailurePure(slug, 'fallback', undefined, baseErr), 'fallback undefined');
  if (e !== baseErr) throw new Error('expected the original error to be re-thrown');
});

test("'fallback' with a falsy-but-defined value (null, 0, '') returns it wrapped", () => {
  assertEqual(
    applyOnFailurePure(slug, 'fallback', null, baseErr),
    { success: true, usedFallback: true, value: null },
    'fallback null',
  );
  assertEqual(
    applyOnFailurePure(slug, 'fallback', 0, baseErr),
    { success: true, usedFallback: true, value: 0 },
    'fallback 0',
  );
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
  assertEqual(out, { success: false, skipped: true, reason: 'quota exceeded' }, 'skip structured');
});

test("'skip' falls back to a default reason when result.error is missing", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'skip', undefined, { success: false });
  assertEqual(
    out,
    { success: false, skipped: true, reason: 'skill returned success: false' },
    'skip default reason',
  );
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
  assertEqual(out, { success: true, usedFallback: true, value: 'cached' }, 'fallback structured');
});

test("'fallback' with undefined value passes the structured failure through unchanged", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'fallback', undefined, failResult);
  assertEqual(out, failResult, 'fallback passthrough');
});

test("'retry' returns the structured failure unchanged", () => {
  const out = applyOnFailureForStructuredFailurePure(slug, 'retry', undefined, failResult);
  assertEqual(out, failResult, 'retry passthrough');
});

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
