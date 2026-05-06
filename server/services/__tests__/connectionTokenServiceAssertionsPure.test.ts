/**
 * Pure tests for D.3 — connection-token cross-tenant assertion logic.
 * No IO; pure decision function only.
 */

import { strict as assert } from 'assert';
import { test } from 'vitest';

type AssertionResult = 'allow' | 'missing_principal' | 'cross_tenant';

function decideTokenRefreshAssertion({
  principalOrgId,
  connectionOrgId,
  isSystemContext = true,
}: {
  principalOrgId: string | null | undefined;
  connectionOrgId: string;
  isSystemContext?: boolean;
}): AssertionResult {
  if (principalOrgId === undefined) return 'missing_principal';
  if (principalOrgId === null && !isSystemContext) return 'missing_principal';
  if (principalOrgId === null) return 'allow';
  if (principalOrgId === connectionOrgId) return 'allow';
  return 'cross_tenant';
}

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

test('undefined principalOrgId → missing_principal', () => {
  assert.equal(decideTokenRefreshAssertion({ principalOrgId: undefined, connectionOrgId: ORG_A }), 'missing_principal');
});

test('null principalOrgId → allow (system context)', () => {
  assert.equal(decideTokenRefreshAssertion({ principalOrgId: null, connectionOrgId: ORG_A }), 'allow');
});

test('matching org IDs → allow', () => {
  assert.equal(decideTokenRefreshAssertion({ principalOrgId: ORG_A, connectionOrgId: ORG_A }), 'allow');
});

test('mismatched org IDs → cross_tenant', () => {
  assert.equal(decideTokenRefreshAssertion({ principalOrgId: ORG_B, connectionOrgId: ORG_A }), 'cross_tenant');
});

test('null principal outside system context → missing_principal', () => {
  assert.equal(decideTokenRefreshAssertion({ principalOrgId: null, connectionOrgId: ORG_A, isSystemContext: false }), 'missing_principal');
});
