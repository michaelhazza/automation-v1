/**
 * errorCodePure.test.ts
 *
 * Run via:
 *   npx tsx shared/__tests__/errorCodePure.test.ts
 */

import { getErrorCode } from '../errorCode.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
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

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Branch A — flat string code
test('flat string code', () => {
  assertEqual(getErrorCode('approval_already_decided'), 'approval_already_decided', 'flat string');
});

test('empty string returns null', () => {
  assertEqual(getErrorCode(''), null, 'empty');
});

// `{ code: ... }` envelope (nested-style return)
test('object with .code', () => {
  assertEqual(getErrorCode({ code: 'permission_denied' }), 'permission_denied', '.code');
});

test('object with non-string .code returns null', () => {
  assertEqual(getErrorCode({ code: 42 }), null, '.code numeric');
});

// `{ error: 'code_string' }` (HTTP body style)
test('object with .error string', () => {
  assertEqual(getErrorCode({ error: 'artefact_not_found' }), 'artefact_not_found', '.error string');
});

test('object with .error nested', () => {
  assertEqual(
    getErrorCode({ error: { code: 'rate_limited', message: 'too many', context: {} } }),
    'rate_limited',
    '.error.code',
  );
});

test('mixed: status + error shape', () => {
  assertEqual(
    getErrorCode({ status: 'failed', error: 'artefact_stale' }),
    'artefact_stale',
    'status + error',
  );
});

// Edge cases
test('null returns null', () => {
  assertEqual(getErrorCode(null), null, 'null');
});

test('undefined returns null', () => {
  assertEqual(getErrorCode(undefined), null, 'undefined');
});

test('number returns null', () => {
  assertEqual(getErrorCode(404), null, 'number');
});

test('object without code/error returns null', () => {
  assertEqual(getErrorCode({ foo: 'bar' }), null, 'unrelated obj');
});

test('object with empty .code returns null', () => {
  assertEqual(getErrorCode({ code: '' }), null, 'empty .code');
});

test('Error-like object with .code is recognised', () => {
  const err: { name: string; message: string; code: string } = {
    name: 'CustomError',
    message: 'something broke',
    code: 'custom_failure',
  };
  assertEqual(getErrorCode(err), 'custom_failure', 'Error-like .code');
});

test('thrown Error without .code returns defaultCode', () => {
  const err = new Error('connection refused');
  assertEqual(getErrorCode(err), null, 'no default → null');
  assertEqual(getErrorCode(err, 'unknown_error'), 'unknown_error', 'with default');
});

test('null with defaultCode returns the default', () => {
  assertEqual(getErrorCode(null, 'unknown_error'), 'unknown_error', 'null + default');
});

test('Error.message is NOT treated as the code', () => {
  // Critical: free-text messages are not stable codes. The helper must
  // refuse to elevate a thrown Error's message to the code slot — that
  // would let consumers branch on user-visible English strings.
  const err = new Error('approval_already_decided');
  assertEqual(getErrorCode(err), null, 'message-as-code is rejected');
});

test('defaultCode is returned for unrelated objects', () => {
  assertEqual(getErrorCode({ foo: 'bar' }, 'unknown_error'), 'unknown_error', 'unrelated obj + default');
});

console.log('');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) process.exit(1);
