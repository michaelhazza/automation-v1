/**
 * visibilityPredicatePure.test.ts — Comprehensive pure-function tests for the
 * visibility predicate used by the canonical data platform.
 *
 * Covers: 3 principal types x 4 visibility scopes x ownership/org/subaccount/team variations.
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/visibilityPredicatePure.test.ts
 */

import { expect, test } from 'vitest';
import { isVisibleTo } from '../principal/visibilityPredicatePure.js';
import type { VisibilityRow } from '../principal/visibilityPredicatePure.js';
import type { PrincipalContext } from '../principal/types.js';
import { buildUserPrincipal, buildServicePrincipal, buildDelegatedPrincipal } from '../principal/principalContext.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const ORG_A = 'org-aaa';
const ORG_B = 'org-bbb';
const SUB_1 = 'sub-111';
const SUB_2 = 'sub-222';
const USER_1 = 'user-111';
const USER_2 = 'user-222';
const TEAM_X = 'team-xxx';
const TEAM_Y = 'team-yyy';

function row(overrides: Partial<VisibilityRow> = {}): VisibilityRow {
  return {
    organisationId: ORG_A,
    subaccountId: SUB_1,
    ownerUserId: USER_1,
    visibilityScope: 'shared_org',
    sharedTeamIds: [],
    ...overrides,
  };
}

const userPrincipal = (overrides: Partial<Parameters<typeof buildUserPrincipal>[0]> = {}): PrincipalContext =>
  buildUserPrincipal({
    userId: USER_1,
    organisationId: ORG_A,
    subaccountId: SUB_1,
    teamIds: [TEAM_X],
    ...overrides,
  });

const servicePrincipal = (overrides: Partial<Parameters<typeof buildServicePrincipal>[0]> = {}): PrincipalContext =>
  buildServicePrincipal({
    organisationId: ORG_A,
    subaccountId: SUB_1,
    serviceId: 'service:test',
    ...overrides,
  });

const delegatedPrincipal = (overrides: Partial<Parameters<typeof buildDelegatedPrincipal>[0]> = {}): PrincipalContext =>
  buildDelegatedPrincipal({
    organisationId: ORG_A,
    subaccountId: SUB_1,
    delegatingUserId: USER_1,
    grantId: 'grant-001',
    allowedTables: ['canonical_accounts'],
    allowedActions: ['read'],
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Cross-org denial — always denied regardless of scope or principal type
// ---------------------------------------------------------------------------

console.log('cross-org denial');

test('user principal denied when org mismatch', () => {
  expect(!isVisibleTo(row(), userPrincipal({ organisationId: ORG_B })), 'should deny').toBeTruthy();
});

test('service principal denied when org mismatch', () => {
  expect(!isVisibleTo(row(), servicePrincipal({ organisationId: ORG_B })), 'should deny').toBeTruthy();
});

test('delegated principal denied when org mismatch', () => {
  expect(!isVisibleTo(row(), delegatedPrincipal({ organisationId: ORG_B })), 'should deny').toBeTruthy();
});

test('cross-org denied even for shared_org scope', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_org' }), userPrincipal({ organisationId: ORG_B })), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Service principal visibility
// ---------------------------------------------------------------------------

console.log('');
console.log('service principal');

test('service sees shared_org', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org' }), servicePrincipal()), 'should allow').toBeTruthy();
});

test('service does not see private', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private' }), servicePrincipal()), 'should deny').toBeTruthy();
});

test('service does not see shared_team', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), servicePrincipal()), 'should deny').toBeTruthy();
});

test('service sees shared_subaccount when subaccount matches', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_1 }), servicePrincipal({ subaccountId: SUB_1 })), 'should allow').toBeTruthy();
});

test('service denied shared_subaccount when subaccount mismatch', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_2 }), servicePrincipal({ subaccountId: SUB_1 })), 'should deny').toBeTruthy();
});

test('service sees shared_subaccount when row subaccountId is null (org-level)', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), servicePrincipal()), 'should allow').toBeTruthy();
});

// ---------------------------------------------------------------------------
// User principal — private scope
// ---------------------------------------------------------------------------

console.log('');
console.log('user principal — private');

test('user sees private row when owner matches', () => {
  expect(isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_1 }), userPrincipal({ userId: USER_1 })), 'should allow').toBeTruthy();
});

test('user denied private row when owner mismatch', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_2 }), userPrincipal({ userId: USER_1 })), 'should deny').toBeTruthy();
});

test('user denied private row when ownerUserId is null', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private', ownerUserId: null }), userPrincipal({ userId: USER_1 })), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// User principal — shared_team scope
// ---------------------------------------------------------------------------

console.log('');
console.log('user principal — shared_team');

test('user sees shared_team when teams overlap', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), userPrincipal({ teamIds: [TEAM_X] })), 'should allow').toBeTruthy();
});

test('user sees shared_team when at least one team overlaps', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X, TEAM_Y] }), userPrincipal({ teamIds: [TEAM_Y] })), 'should allow').toBeTruthy();
});

test('user denied shared_team when no teams overlap', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_Y] }), userPrincipal({ teamIds: [TEAM_X] })), 'should deny').toBeTruthy();
});

test('user denied shared_team when user has empty teamIds', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), userPrincipal({ teamIds: [] })), 'should deny').toBeTruthy();
});

test('user denied shared_team when row has empty sharedTeamIds', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [] }), userPrincipal({ teamIds: [TEAM_X] })), 'should deny').toBeTruthy();
});

test('user denied shared_team when both teamIds and sharedTeamIds empty', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [] }), userPrincipal({ teamIds: [] })), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// User principal — shared_subaccount scope
// ---------------------------------------------------------------------------

console.log('');
console.log('user principal — shared_subaccount');

test('user sees shared_subaccount when subaccount matches', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_1 }), userPrincipal({ subaccountId: SUB_1 })), 'should allow').toBeTruthy();
});

test('user denied shared_subaccount when subaccount mismatch', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_2 }), userPrincipal({ subaccountId: SUB_1 })), 'should deny').toBeTruthy();
});

test('user sees shared_subaccount when row subaccountId is null (org-level)', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), userPrincipal()), 'should allow').toBeTruthy();
});

test('user sees shared_subaccount when both subaccountIds are null', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), userPrincipal({ subaccountId: null })), 'should allow').toBeTruthy();
});

// ---------------------------------------------------------------------------
// User principal — shared_org scope
// ---------------------------------------------------------------------------

console.log('');
console.log('user principal — shared_org');

test('user sees shared_org', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org' }), userPrincipal()), 'should allow').toBeTruthy();
});

test('user sees shared_org even with different subaccount', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org', subaccountId: SUB_2 }), userPrincipal({ subaccountId: SUB_1 })), 'should allow').toBeTruthy();
});

test('user sees shared_org when ownerUserId differs', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org', ownerUserId: USER_2 }), userPrincipal({ userId: USER_1 })), 'should allow').toBeTruthy();
});

test('user sees shared_org when ownerUserId is null', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org', ownerUserId: null }), userPrincipal()), 'should allow').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Delegated principal
// ---------------------------------------------------------------------------

console.log('');
console.log('delegated principal');

test('delegated sees private when owner matches', () => {
  expect(isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_1 }), delegatedPrincipal({ delegatingUserId: USER_1 })), 'should allow').toBeTruthy();
});

test('delegated denied private when owner mismatch', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_2 }), delegatedPrincipal({ delegatingUserId: USER_1 })), 'should deny').toBeTruthy();
});

test('delegated denied private when ownerUserId is null', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private', ownerUserId: null }), delegatedPrincipal()), 'should deny').toBeTruthy();
});

test('delegated denied shared_team even if teams overlap', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), delegatedPrincipal({ teamIds: [TEAM_X] })), 'should deny').toBeTruthy();
});

test('delegated denied shared_subaccount even if subaccount matches', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_1 }), delegatedPrincipal({ subaccountId: SUB_1 })), 'should deny').toBeTruthy();
});

test('delegated denied shared_org', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_org' }), delegatedPrincipal()), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Subaccount NULL handling (org-level rows)
// ---------------------------------------------------------------------------

console.log('');
console.log('subaccount NULL handling');

test('user with null subaccountId sees shared_subaccount row with null subaccountId', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), userPrincipal({ subaccountId: null })), 'should allow').toBeTruthy();
});

test('user with subaccount sees org-level shared_subaccount (null) row', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), userPrincipal({ subaccountId: SUB_1 })), 'should allow').toBeTruthy();
});

test('service with null subaccount sees org-level shared_subaccount (null) row', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), servicePrincipal({ subaccountId: null })), 'should allow').toBeTruthy();
});

test('service with subaccount denied row from different subaccount', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_2 }), servicePrincipal({ subaccountId: SUB_1 })), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

console.log('');
console.log('edge cases');

test('user with many teams and partial overlap sees shared_team row', () => {
  const manyTeams = ['a', 'b', 'c', 'd', TEAM_X, 'e'];
  expect(isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), userPrincipal({ teamIds: manyTeams })), 'should allow').toBeTruthy();
});

test('user with many teams and no overlap denied shared_team row', () => {
  const manyTeams = ['a', 'b', 'c', 'd', 'e'];
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), userPrincipal({ teamIds: manyTeams })), 'should deny').toBeTruthy();
});

test('service principal with teamIds still denied shared_team', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), servicePrincipal({ teamIds: [TEAM_X] })), 'should deny').toBeTruthy();
});

test('delegated principal cross-org denied even for private with owner match', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_1 }), delegatedPrincipal({ organisationId: ORG_B, delegatingUserId: USER_1 })), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Additional coverage: user principal with null subaccountId
// ---------------------------------------------------------------------------

console.log('');
console.log('user principal — null subaccountId');

test('user with null subaccount denied shared_subaccount row with specific subaccount', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_1 }), userPrincipal({ subaccountId: null })), 'should deny').toBeTruthy();
});

test('user with null subaccount sees shared_org row', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org', subaccountId: SUB_1 }), userPrincipal({ subaccountId: null })), 'should allow').toBeTruthy();
});

test('user with null subaccount sees private row when owner matches', () => {
  expect(isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_1, subaccountId: null }), userPrincipal({ subaccountId: null, userId: USER_1 })), 'should allow').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Additional coverage: service principal with null subaccountId
// ---------------------------------------------------------------------------

console.log('');
console.log('service principal — null subaccountId');

test('service with null subaccount denied shared_subaccount row with specific subaccount', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: SUB_1 }), servicePrincipal({ subaccountId: null })), 'should deny').toBeTruthy();
});

test('service with null subaccount sees shared_org', () => {
  expect(isVisibleTo(row({ visibilityScope: 'shared_org' }), servicePrincipal({ subaccountId: null })), 'should allow').toBeTruthy();
});

test('service with null subaccount denied private', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'private' }), servicePrincipal({ subaccountId: null })), 'should deny').toBeTruthy();
});

test('service with null subaccount denied shared_team', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_team', sharedTeamIds: [TEAM_X] }), servicePrincipal({ subaccountId: null })), 'should deny').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Additional coverage: delegated principal edge cases
// ---------------------------------------------------------------------------

console.log('');
console.log('delegated principal — additional');

test('delegated sees private with owner match even when subaccount differs', () => {
  expect(isVisibleTo(row({ visibilityScope: 'private', ownerUserId: USER_1, subaccountId: SUB_2 }), delegatedPrincipal({ delegatingUserId: USER_1, subaccountId: SUB_1 })), 'should allow — private ignores subaccount').toBeTruthy();
});

test('delegated denied shared_org even with matching subaccount', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_org', subaccountId: SUB_1 }), delegatedPrincipal({ subaccountId: SUB_1 })), 'should deny').toBeTruthy();
});

test('delegated denied shared_subaccount even with null subaccount on row', () => {
  expect(!isVisibleTo(row({ visibilityScope: 'shared_subaccount', subaccountId: null }), delegatedPrincipal()), 'should deny').toBeTruthy();
});

console.log('');
