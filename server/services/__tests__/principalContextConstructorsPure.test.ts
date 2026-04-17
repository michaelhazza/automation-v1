/**
 * principalContextConstructorsPure.test.ts — Pure function tests for the
 * principal context builder functions.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/principalContextConstructorsPure.test.ts
 */

import {
  buildUserPrincipal,
  buildServicePrincipal,
  buildDelegatedPrincipal,
} from '../principal/principalContext.js';

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
  assertEqual(p.type, 'user', 'type');
});

test('carries organisationId', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org-abc', subaccountId: null, teamIds: [] });
  assertEqual(p.organisationId, 'org-abc', 'organisationId');
});

test('maps userId to id', () => {
  const p = buildUserPrincipal({ userId: 'u-42', organisationId: 'org1', subaccountId: null, teamIds: [] });
  assertEqual(p.id, 'u-42', 'id should equal userId');
});

test('carries subaccountId when non-null', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: 'sub-99', teamIds: [] });
  assertEqual(p.subaccountId, 'sub-99', 'subaccountId');
});

test('carries null subaccountId', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: null, teamIds: [] });
  assertEqual(p.subaccountId, null, 'subaccountId should be null');
});

test('carries teamIds', () => {
  const p = buildUserPrincipal({ userId: 'u1', organisationId: 'org1', subaccountId: null, teamIds: ['t1', 't2'] });
  assertEqual(p.teamIds, ['t1', 't2'], 'teamIds');
});

// ---------------------------------------------------------------------------
// buildServicePrincipal
// ---------------------------------------------------------------------------

console.log('');
console.log('buildServicePrincipal');

test('returns correct type field', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:test' });
  assertEqual(p.type, 'service', 'type');
});

test('carries organisationId', () => {
  const p = buildServicePrincipal({ organisationId: 'org-xyz', subaccountId: null, serviceId: 'svc:test' });
  assertEqual(p.organisationId, 'org-xyz', 'organisationId');
});

test('maps serviceId to id', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:polling' });
  assertEqual(p.id, 'svc:polling', 'id should equal serviceId');
});

test('carries serviceId', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:polling' });
  assertEqual(p.serviceId, 'svc:polling', 'serviceId');
});

test('defaults teamIds to empty array when not provided', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:test' });
  assertEqual(p.teamIds, [], 'teamIds should default to []');
});

test('carries explicit teamIds when provided', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: null, serviceId: 'svc:test', teamIds: ['t1'] });
  assertEqual(p.teamIds, ['t1'], 'teamIds');
});

test('carries subaccountId', () => {
  const p = buildServicePrincipal({ organisationId: 'org1', subaccountId: 'sub-1', serviceId: 'svc:test' });
  assertEqual(p.subaccountId, 'sub-1', 'subaccountId');
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
  assertEqual(p.type, 'delegated', 'type');
});

test('carries organisationId', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org-d1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  assertEqual(p.organisationId, 'org-d1', 'organisationId');
});

test('maps delegatingUserId to id', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'del-user-7',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  assertEqual(p.id, 'del-user-7', 'id should equal delegatingUserId');
});

test('carries grantId', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'grant-42', allowedTables: [], allowedActions: [],
  });
  assertEqual(p.grantId, 'grant-42', 'grantId');
});

test('carries allowedTables', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: ['canonical_accounts', 'canonical_contacts'], allowedActions: [],
  });
  assertEqual(p.allowedTables, ['canonical_accounts', 'canonical_contacts'], 'allowedTables');
});

test('carries allowedActions', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: ['read', 'write'],
  });
  assertEqual(p.allowedActions, ['read', 'write'], 'allowedActions');
});

test('defaults teamIds to empty array when not provided', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  assertEqual(p.teamIds, [], 'teamIds should default to []');
});

test('carries explicit teamIds when provided', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'u1',
    grantId: 'g1', allowedTables: [], allowedActions: [], teamIds: ['t1', 't2'],
  });
  assertEqual(p.teamIds, ['t1', 't2'], 'teamIds');
});

test('carries delegatingUserId field', () => {
  const p = buildDelegatedPrincipal({
    organisationId: 'org1', subaccountId: null, delegatingUserId: 'del-u-5',
    grantId: 'g1', allowedTables: [], allowedActions: [],
  });
  assertEqual(p.delegatingUserId, 'del-u-5', 'delegatingUserId');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
