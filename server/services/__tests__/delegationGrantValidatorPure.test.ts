/**
 * delegationGrantValidatorPure.test.ts — Pure function tests for the
 * delegation grant validator.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/delegationGrantValidatorPure.test.ts
 */

import { expect, test } from 'vitest';
import { validateGrant } from '../principal/delegationGrantValidatorPure.js';
import type { DelegationGrant } from '../principal/delegationGrantValidatorPure.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const NOW = new Date('2026-04-17T12:00:00Z');
const FUTURE = new Date('2026-05-01T00:00:00Z');
const PAST = new Date('2026-04-10T00:00:00Z');

function grant(overrides: Partial<DelegationGrant> = {}): DelegationGrant {
  return {
    id: 'grant-001',
    grantorUserId: 'user-111',
    granteeKind: 'user',
    granteeId: 'user-222',
    allowedCanonicalTables: ['canonical_accounts'],
    allowedActions: ['read'],
    expiresAt: FUTURE,
    revokedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

console.log('validateGrant — happy path');

test('valid grant permits', () => {
  const result = validateGrant(grant(), 'read', 'canonical_accounts', NOW);
  expect(result.permitted === true, 'should be permitted').toBeTruthy();
});

test('valid grant with multiple allowed tables permits correct table', () => {
  const g = grant({ allowedCanonicalTables: ['canonical_accounts', 'canonical_contacts'] });
  const result = validateGrant(g, 'read', 'canonical_contacts', NOW);
  expect(result.permitted === true, 'should be permitted').toBeTruthy();
});

test('valid grant with multiple allowed actions permits correct action', () => {
  const g = grant({ allowedActions: ['read', 'write'] });
  const result = validateGrant(g, 'write', 'canonical_accounts', NOW);
  expect(result.permitted === true, 'should be permitted').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Revoked grants
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — revoked');

test('revoked grant denies', () => {
  const result = validateGrant(grant({ revokedAt: PAST }), 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny').toBeTruthy();
  expect((result as { reason: string }).reason === 'Grant has been revoked', 'should have correct reason').toBeTruthy();
});

test('revoked grant denies even if otherwise valid', () => {
  const result = validateGrant(grant({ revokedAt: PAST, expiresAt: FUTURE }), 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Expired grants
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — expired');

test('expired grant denies', () => {
  const result = validateGrant(grant({ expiresAt: PAST }), 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny').toBeTruthy();
  expect((result as { reason: string }).reason === 'Grant has expired', 'should have correct reason').toBeTruthy();
});

test('grant expiring at exactly now denies', () => {
  const result = validateGrant(grant({ expiresAt: NOW }), 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny at exact boundary').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Table restrictions
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — table restrictions');

test('table not in allowed list denies', () => {
  const result = validateGrant(grant({ allowedCanonicalTables: ['canonical_accounts'] }), 'read', 'canonical_contacts', NOW);
  expect(result.permitted === false, 'should deny').toBeTruthy();
  expect((result as { reason: string }).reason.includes('canonical_contacts'), 'should mention the table').toBeTruthy();
});

test('wildcard * for tables permits any table', () => {
  const result = validateGrant(grant({ allowedCanonicalTables: ['*'] }), 'read', 'canonical_contacts', NOW);
  expect(result.permitted === true, 'should permit with wildcard').toBeTruthy();
});

test('wildcard * mixed with named tables permits unlisted table', () => {
  const result = validateGrant(grant({ allowedCanonicalTables: ['canonical_accounts', '*'] }), 'read', 'canonical_revenue', NOW);
  expect(result.permitted === true, 'should permit with wildcard in list').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Action restrictions
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — action restrictions');

test('action not in allowed list denies', () => {
  const result = validateGrant(grant({ allowedActions: ['read'] }), 'write', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny').toBeTruthy();
  expect((result as { reason: string }).reason.includes('write'), 'should mention the action').toBeTruthy();
});

test('wildcard * for actions permits any action', () => {
  const result = validateGrant(grant({ allowedActions: ['*'] }), 'delete', 'canonical_accounts', NOW);
  expect(result.permitted === true, 'should permit with wildcard').toBeTruthy();
});

test('wildcard * mixed with named actions permits unlisted action', () => {
  const result = validateGrant(grant({ allowedActions: ['read', '*'] }), 'admin', 'canonical_accounts', NOW);
  expect(result.permitted === true, 'should permit with wildcard in list').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Both wildcards
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — both wildcards');

test('both wildcards permit any table and any action', () => {
  const g = grant({ allowedCanonicalTables: ['*'], allowedActions: ['*'] });
  const result = validateGrant(g, 'delete', 'canonical_revenue', NOW);
  expect(result.permitted === true, 'should permit everything with double wildcard').toBeTruthy();
});

test('both wildcards still denied if revoked', () => {
  const g = grant({ allowedCanonicalTables: ['*'], allowedActions: ['*'], revokedAt: PAST });
  const result = validateGrant(g, 'delete', 'canonical_revenue', NOW);
  expect(result.permitted === false, 'revoked overrides wildcards').toBeTruthy();
});

test('both wildcards still denied if expired', () => {
  const g = grant({ allowedCanonicalTables: ['*'], allowedActions: ['*'], expiresAt: PAST });
  const result = validateGrant(g, 'delete', 'canonical_revenue', NOW);
  expect(result.permitted === false, 'expired overrides wildcards').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Priority ordering: revoked checked before expired
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — priority ordering');

test('revoked checked before expired (both apply)', () => {
  const result = validateGrant(grant({ revokedAt: PAST, expiresAt: PAST }), 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny').toBeTruthy();
  expect((result as { reason: string }).reason === 'Grant has been revoked', 'revoked should take priority').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Edge cases: empty lists
// ---------------------------------------------------------------------------

console.log('');
console.log('validateGrant — edge cases');

test('empty allowedCanonicalTables denies', () => {
  const g = grant({ allowedCanonicalTables: [] });
  const result = validateGrant(g, 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny with empty table list').toBeTruthy();
});

test('empty allowedActions denies', () => {
  const g = grant({ allowedActions: [] });
  const result = validateGrant(g, 'read', 'canonical_accounts', NOW);
  expect(result.permitted === false, 'should deny with empty action list').toBeTruthy();
});

test('grant one millisecond before expiry permits', () => {
  const almostExpired = new Date(FUTURE.getTime() - 1);
  const result = validateGrant(grant({ expiresAt: FUTURE }), 'read', 'canonical_accounts', almostExpired);
  expect(result.permitted === true, 'should permit just before expiry').toBeTruthy();
});

console.log('');
