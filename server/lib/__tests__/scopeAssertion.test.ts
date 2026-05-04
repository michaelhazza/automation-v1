/**
 * scopeAssertion unit tests — runnable via:
 *   npx tsx server/lib/__tests__/scopeAssertion.test.ts
 *
 * Tests the pure assertion helper introduced in P1.1 Layer 2 of
 * docs/improvements-roadmap-spec.md.
 */

import { expect, test } from 'vitest';
import { assertScope, assertScopeSingle } from '../scopeAssertion.js';
import { FailureError } from '../../../shared/iee/failure.js';

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
  expect(Array.isArray(out) && out.length === 0, 'returned empty array').toBeTruthy();
});

test('all items match org-only expectation', () => {
  const items = [
    { organisationId: ORG_A, name: 'one' },
    { organisationId: ORG_A, name: 'two' },
  ];
  const out = assertScope(items, { organisationId: ORG_A }, 'test.orgOnly');
  expect(out === items, 'returns the same array reference').toBeTruthy();
  expect(out.length === 2, 'length preserved').toBeTruthy();
});

test('returns the same array reference (no copy)', () => {
  const items = [{ organisationId: ORG_A }];
  const out = assertScope(items, { organisationId: ORG_A }, 'test.refEq');
  expect(out === items, 'same reference').toBeTruthy();
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
  expect(out.length === 2, 'length preserved').toBeTruthy();
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
  expect(out.length === 2, 'length preserved').toBeTruthy();
});

test('subaccount expectation undefined ignores item subaccount', () => {
  const items = [
    { organisationId: ORG_A, subaccountId: SUB_X },
    { organisationId: ORG_A, subaccountId: SUB_Y },
    { organisationId: ORG_A, subaccountId: null },
  ];
  const out = assertScope(items, { organisationId: ORG_A }, 'test.subaccountIgnored');
  expect(out.length === 3, 'all items kept').toBeTruthy();
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
  expect(err.failure.failureDetail.includes('test.orgLeak'), 'source appears in detail').toBeTruthy();
  expect(err.failure.failureDetail.includes('organisationId mismatch'), 'detail mentions orgId mismatch').toBeTruthy();
  expect(err.failure.metadata?.actual === ORG_B, 'metadata carries the leaked orgId').toBeTruthy();
  expect(err.failure.metadata?.expected === ORG_A, 'metadata carries the expected orgId').toBeTruthy();
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
  expect(err.failure.failureDetail.includes('subaccountId mismatch'), 'detail mentions subaccount mismatch').toBeTruthy();
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
  expect(out === null, 'null passthrough').toBeTruthy();
});

test('assertScopeSingle returns null for undefined input', () => {
  const out = assertScopeSingle(undefined, { organisationId: ORG_A }, 'test.singleUndef');
  expect(out === null, 'undefined passthrough').toBeTruthy();
});

test('assertScopeSingle returns matching item', () => {
  const item = { organisationId: ORG_A, name: 'ok' };
  const out = assertScopeSingle(item, { organisationId: ORG_A }, 'test.singleMatch');
  expect(out === item, 'returns the input item').toBeTruthy();
});

test('assertScopeSingle throws on mismatch', () => {
  const item = { organisationId: ORG_B, name: 'leak' };
  assertThrowsFailure(
    () => assertScopeSingle(item, { organisationId: ORG_A }, 'test.singleLeak'),
    'scope_violation',
    'single leak',
  );
});

console.log('');console.log('');