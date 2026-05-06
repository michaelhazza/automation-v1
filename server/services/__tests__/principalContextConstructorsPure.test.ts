/**
 * principalContextConstructorsPure.test.ts — Pure function tests for the
 * principal context builder functions.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/principalContextConstructorsPure.test.ts
 */

import { expect, test } from 'vitest';
import {
  buildUserPrincipal,
  buildServicePrincipal,
  buildDelegatedPrincipal,
} from '../principal/principalContext.js';

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// buildUserPrincipal
// ---------------------------------------------------------------------------

console.log('buildUserPrincipal');

test('returns correct type field', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: 'sub1', teamIds: ['t1'] });
  expect(p.type, 'type').toBe('user');
});

test('carries organisationId', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org-abc', subaccountId: null, teamIds: [] });
  expect(p.organisationId, 'organisationId').toBe('org-abc');
});

test('maps userId to id', () => {
  const p = buildUserPrincipal({ userId: 'u-42', organisationId: 'org1', subaccountId: null, teamIds: [] });
  expect(p.id, 'id should equal userId').toBe('u-42');
});

test('carries subaccountId when non-null', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: 'sub-99', teamIds: [] });
  expect(p.subaccountId, 'subaccountId').toBe('sub-99');
});

test('carries null subaccountId', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: null, teamIds: [] });
  expect(p.subaccountId, 'subaccountId should be null').toBe(null);
});

test('carries teamIds', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: null, teamIds: ['t1', 't2'] });
  expect(p.teamIds, 'teamIds').toEqual(['t1', 't2']);
});

// ---------------------------------------------------------------------------
// buildServicePrincipal
// ---------------------------------------------------------------------------

console.log('');
console.log('buildServicePrincipal');

test('returns correct type field', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:test' });
  expect(p.type, 'type').toBe('service');
});

test('carries organisationId', () => {
  const p = buildServicePrincipal({ organisationId: 'org-xyz', subaccountId: null, serviceId: 'svc:test' });
  expect(p.organisationId, 'organisationId').toBe('org-xyz');
});

test('maps serviceId to id', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:polling' });
  expect(p.id, 'id should equal serviceId').toBe('svc:polling');
});

test('carries serviceId', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:polling' });
  expect(p.serviceId, 'serviceId').toBe('svc:polling');
});

test('defaults teamIds to empty array when not provided', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:test' });
  expect(p.teamIds, 'teamIds should default to []').toEqual([]);
});

test('carries explicit teamIds when provided', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:test', teamIds: ['t1'] });
  expect(p.teamIds, 'teamIds').toEqual(['t1']);
});

test('carries subaccountId', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: 'sub-1', serviceId: 'svc:test' });
  expect(p.subaccountId, 'subaccountId').toBe('sub-1');
});

// ---------------------------------------------------------------------------
// buildDelegatedPrincipal
// ---------------------------------------------------------------------------

console.log('');
console.log('buildDelegatedPrincipal');

test('returns correct type field', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: ['canonical_accounts'], allowedActions: ['read'],
  });
  expect(p.type, 'type').toBe('delegated');
});

test('carries organisationId', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org-d1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  expect(p.organisationId, 'organisationId').toBe('org-d1');
});

test('maps delegatingUserId to id', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'del-user-7',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  expect(p.id, 'id should equal delegatingUserId').toBe('del-user-7');
});

test('carries grantId', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'grant-42', allowedTables: [], allowedActions: [],
  });
  expect(p.grantId, 'grantId').toBe('grant-42');
});

test('carries allowedTables', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: ['canonical_accounts', 'canonical_contacts'], allowedActions: [],
  });
  expect(p.allowedTables, 'allowedTables').toEqual(['canonical_accounts', 'canonical_contacts']);
});

test('carries allowedActions', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: ['read', 'write'],
  });
  expect(p.allowedActions, 'allowedActions').toEqual(['read', 'write']);
});

test('defaults teamIds to empty array when not provided', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  expect(p.teamIds, 'teamIds should default to []').toEqual([]);
});

test('carries explicit teamIds when provided', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: [], teamIds: ['t1', 't2'],
  });
  expect(p.teamIds, 'teamIds').toEqual(['t1', 't2']);
});

test('carries delegatingUserId field', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'del-u-5',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  expect(p.delegatingUserId, 'delegatingUserId').toBe('del-u-5');
});

console.log('');
