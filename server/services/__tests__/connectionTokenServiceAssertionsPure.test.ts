/**
 * Pure tests for D.3 — connection-token cross-tenant assertion logic.
 */

import { expect, test } from 'vitest';
import { decideTokenRefreshAssertion } from '../connectionTokenAssertionsPure.js';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

test('undefined principalOrgId → missing_principal', () => {
  expect(decideTokenRefreshAssertion({ principalOrgId: undefined, connectionOrgId: ORG_A })).toBe('missing_principal');
});

test('null principalOrgId → allow (system context)', () => {
  expect(decideTokenRefreshAssertion({ principalOrgId: null, connectionOrgId: ORG_A })).toBe('allow');
});

test('matching org IDs → allow', () => {
  expect(decideTokenRefreshAssertion({ principalOrgId: ORG_A, connectionOrgId: ORG_A })).toBe('allow');
});

test('mismatched org IDs → cross_tenant', () => {
  expect(decideTokenRefreshAssertion({ principalOrgId: ORG_B, connectionOrgId: ORG_A })).toBe('cross_tenant');
});

test('null principal outside system context → missing_principal', () => {
  expect(decideTokenRefreshAssertion({ principalOrgId: null, connectionOrgId: ORG_A, isSystemContext: false })).toBe('missing_principal');
});
