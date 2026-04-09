/**
 * scopeAssertion unit tests — runnable via:
 *   npx tsx server/lib/__tests__/scopeAssertion.test.ts
 *
 * Tests the pure assertion helper introduced in P1.1 Layer 2 of
 * docs/improvements-roadmap-spec.md.
 */

import { assertScope, assertScopeSingle } from '../scopeAssertion.js';
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

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

function assertThrowsFailure(
  fn: () => unknown,
  expectedReason: string,
  label: string,
): FailureError {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  if (!(thrown instanceof FailureError)) {
    throw new Error(`${label}: expected FailureError, got ${thrown}`);
  }
  if (thrown.failure.failureReason !== expectedReason) {
    throw new Error(
      `${label}: expected reason=${expectedReason}, got ${thrown.failure.failureReason}`,
    );
  }
  return thrown;
}

console.log('');
console.log('scopeAssertion — P1.1 Layer 2 retrieval boundary guard');
console.log('');

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const SUB_X = '11111111-1111-1111-1111-1111111111aa';
const SUB_Y = '11111111-1111-1111-1111-1111111111bb';

// ── Happy paths ────────────────────────────────────────────────────
test('empty array passes', () => {
  const out = assertScope([], { organisationId: ORG_A }, 'test.empty');
  assert(Array.isArray(out) && out.length === 0, 'returned empty array');
});

test('all items match org-only expectation', () => {
  const items = [
    { organisationId: ORG_A, name: 'one' },
    { organisationId: ORG_A, name: 'two' },
  ];
  const out = assertScope(items, { organisationId: ORG_A }, 'test.orgOnly');
  assert(out === items, 'returns the same array reference');
  assert(out.length === 2, 'length preserved');
});

test('returns the same array reference (no copy)', () => {
  const items = [{ organisationId: ORG_A }];
  const out = assertScope(items, { organisationId: ORG_A }, 'test.refEq');
  assert(out === items, 'same reference');
});

test('subaccount expectation (string) matches items', () => {
  const items = [
    { organisationId: ORG_A, subaccountId: SUB_X, name: 'one' },
    { organisationId: ORG_A, subaccountId: SUB_X, name: 'two' },
  ];
  const out = assertScope(
    items,
    { organisationId: ORG_A, subaccountId: SUB_X },
    'test.subaccountMatch',
  );
  assert(out.length === 2, 'length preserved');
});

test('subaccount expectation null matches null items (org-level)', () => {
  const items = [
    { organisationId: ORG_A, subaccountId: null, name: 'org-level one' },
    { organisationId: ORG_A, subaccountId: null, name: 'org-level two' },
  ];
  const out = assertScope(
    items,
    { organisationId: ORG_A, subaccountId: null },
    'test.orgLevel',
  );
  assert(out.length === 2, 'length preserved');
});

test('subaccount expectation undefined ignores item subaccount', () => {
  const items = [
    { organisationId: ORG_A, subaccountId: SUB_X },
    { organisationId: ORG_A, subaccountId: SUB_Y },
    { organisationId: ORG_A, subaccountId: null },
  ];
  const out = assertScope(items, { organisationId: ORG_A }, 'test.subaccountIgnored');
  assert(out.length === 3, 'all items kept');
});

// ── Org mismatch ────────────────────────────────────────────────────
test('organisation mismatch throws scope_violation', () => {
  const items = [
    { organisationId: ORG_A, name: 'legit' },
    { organisationId: ORG_B, name: 'leaked' },
  ];
  const err = assertThrowsFailure(
    () => assertScope(items, { organisationId: ORG_A }, 'test.orgLeak'),
    'scope_violation',
    'org mismatch',
  );
  assert(err.failure.failureDetail.includes('test.orgLeak'), 'source appears in detail');
  assert(
    err.failure.failureDetail.includes('organisationId mismatch'),
    'detail mentions orgId mismatch',
  );
  assert(
    err.failure.metadata?.actual === ORG_B,
    'metadata carries the leaked orgId',
  );
  assert(
    err.failure.metadata?.expected === ORG_A,
    'metadata carries the expected orgId',
  );
});

// ── Subaccount mismatch ─────────────────────────────────────────────
test('subaccount mismatch throws scope_violation (string vs different string)', () => {
  const items = [
    { organisationId: ORG_A, subaccountId: SUB_X, name: 'legit' },
    { organisationId: ORG_A, subaccountId: SUB_Y, name: 'leaked' },
  ];
  const err = assertThrowsFailure(
    () => assertScope(items, { organisationId: ORG_A, subaccountId: SUB_X }, 'test.subLeak'),
    'scope_violation',
    'subaccount mismatch',
  );
  assert(
    err.failure.failureDetail.includes('subaccountId mismatch'),
    'detail mentions subaccount mismatch',
  );
});

test('subaccount expected null but item has a subaccount throws', () => {
  const items = [{ organisationId: ORG_A, subaccountId: SUB_X }];
  assertThrowsFailure(
    () => assertScope(items, { organisationId: ORG_A, subaccountId: null }, 'test.orgLevelLeak'),
    'scope_violation',
    'null vs string',
  );
});

test('subaccount expected string but item is null throws', () => {
  const items = [{ organisationId: ORG_A, subaccountId: null }];
  assertThrowsFailure(
    () => assertScope(items, { organisationId: ORG_A, subaccountId: SUB_X }, 'test.stringVsNull'),
    'scope_violation',
    'string vs null',
  );
});

// ── Defensive failure modes ────────────────────────────────────────
test('missing organisationId in expectation throws missing_org_context', () => {
  assertThrowsFailure(
    () => assertScope([], { organisationId: '' }, 'test.missingExpected'),
    'missing_org_context',
    'empty expected org',
  );
});

test('non-array input throws internal_error', () => {
  assertThrowsFailure(
    () => assertScope(
      'not-an-array' as unknown as { organisationId: string }[],
      { organisationId: ORG_A },
      'test.nonArray',
    ),
    'internal_error',
    'non-array',
  );
});

test('non-object item throws internal_error', () => {
  assertThrowsFailure(
    () => assertScope(
      ['not-an-object' as unknown as { organisationId: string }],
      { organisationId: ORG_A },
      'test.nonObjectItem',
    ),
    'internal_error',
    'non-object item',
  );
});

// ── assertScopeSingle ───────────────────────────────────────────────
test('assertScopeSingle returns null for null input', () => {
  const out = assertScopeSingle(null, { organisationId: ORG_A }, 'test.singleNull');
  assert(out === null, 'null passthrough');
});

test('assertScopeSingle returns null for undefined input', () => {
  const out = assertScopeSingle(undefined, { organisationId: ORG_A }, 'test.singleUndef');
  assert(out === null, 'undefined passthrough');
});

test('assertScopeSingle returns matching item', () => {
  const item = { organisationId: ORG_A, name: 'ok' };
  const out = assertScopeSingle(item, { organisationId: ORG_A }, 'test.singleMatch');
  assert(out === item, 'returns the input item');
});

test('assertScopeSingle throws on mismatch', () => {
  const item = { organisationId: ORG_B, name: 'leak' };
  assertThrowsFailure(
    () => assertScopeSingle(item, { organisationId: ORG_A }, 'test.singleLeak'),
    'scope_violation',
    'single leak',
  );
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
console.log('');
if (failed > 0) process.exit(1);
