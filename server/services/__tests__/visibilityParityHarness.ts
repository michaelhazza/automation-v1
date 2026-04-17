/**
 * visibilityParityHarness.ts — Comprehensive fixture-based parity harness for
 * the visibility predicate. Validates the TypeScript isVisibleTo function
 * against a 64+ row fixture matrix covering all dimension combinations.
 *
 * This is the reference fixture set that a SQL-level parity test would also
 * use to verify RLS policies produce identical results.
 *
 * Dimensions:
 *   - Principal types: user, service, delegated
 *   - Visibility scopes: private, shared_team, shared_subaccount, shared_org
 *   - Ownership: owner-match, owner-mismatch, null owner
 *   - Org match: same-org, different-org
 *   - Subaccount: NULL, matching, non-matching
 *   - Team overlap: teams overlap, teams disjoint, empty teams
 *   - Delegated: visible private rows, denied non-private rows
 *
 * Runnable via:
 *   npx tsx server/services/__tests__/visibilityParityHarness.ts
 */

import { isVisibleTo, type VisibilityRow } from '../principal/visibilityPredicatePure.js';
import type { PrincipalContext } from '../principal/types.js';

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-000000000002';
const SUB_1 = '00000000-0000-0000-0000-000000000010';
const SUB_2 = '00000000-0000-0000-0000-000000000020';
const USER_1 = '00000000-0000-0000-0000-000000000100';
const USER_2 = '00000000-0000-0000-0000-000000000200';
const SVC_1 = '00000000-0000-0000-0000-000000000300';
const TEAM_A = '00000000-0000-0000-0000-000000001000';
const TEAM_B = '00000000-0000-0000-0000-000000002000';
const GRANT_1 = '00000000-0000-0000-0000-000000003000';

// ---------------------------------------------------------------------------
// Principal builders
// ---------------------------------------------------------------------------

function userPrincipal(overrides: Partial<{ id: string; organisationId: string; subaccountId: string | null; teamIds: string[] }> = {}): PrincipalContext {
  return {
    type: 'user',
    id: overrides.id ?? USER_1,
    organisationId: overrides.organisationId ?? ORG_A,
    subaccountId: overrides.subaccountId !== undefined ? overrides.subaccountId : SUB_1,
    teamIds: overrides.teamIds ?? [TEAM_A],
  };
}

function servicePrincipal(overrides: Partial<{ id: string; organisationId: string; subaccountId: string | null; serviceId: string; teamIds: string[] }> = {}): PrincipalContext {
  return {
    type: 'service',
    id: overrides.id ?? SVC_1,
    organisationId: overrides.organisationId ?? ORG_A,
    subaccountId: overrides.subaccountId !== undefined ? overrides.subaccountId : SUB_1,
    serviceId: overrides.serviceId ?? 'svc:test',
    teamIds: overrides.teamIds ?? [],
  };
}

function delegatedPrincipal(overrides: Partial<{ id: string; organisationId: string; subaccountId: string | null; delegatingUserId: string; grantId: string; allowedTables: string[]; allowedActions: string[]; teamIds: string[] }> = {}): PrincipalContext {
  return {
    type: 'delegated',
    id: overrides.id ?? USER_1,
    organisationId: overrides.organisationId ?? ORG_A,
    subaccountId: overrides.subaccountId !== undefined ? overrides.subaccountId : SUB_1,
    delegatingUserId: overrides.delegatingUserId ?? USER_1,
    grantId: overrides.grantId ?? GRANT_1,
    allowedTables: overrides.allowedTables ?? ['canonical_accounts'],
    allowedActions: overrides.allowedActions ?? ['read'],
    teamIds: overrides.teamIds ?? [],
  };
}

// ---------------------------------------------------------------------------
// Fixture type and matrix
// ---------------------------------------------------------------------------

interface Fixture {
  label: string;
  row: VisibilityRow;
  principal: PrincipalContext;
  expected: boolean;
}

const FIXTURES: Fixture[] = [
  // ==========================================================================
  // CROSS-ORG: always denied (8 fixtures — one per principal type x scope)
  // ==========================================================================
  { label: 'cross-org: user + private',           row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private',          sharedTeamIds: [] },        principal: userPrincipal({ organisationId: ORG_B }),      expected: false },
  { label: 'cross-org: user + shared_team',       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team',      sharedTeamIds: [TEAM_A] },  principal: userPrincipal({ organisationId: ORG_B }),      expected: false },
  { label: 'cross-org: user + shared_subaccount', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] },       principal: userPrincipal({ organisationId: ORG_B }),      expected: false },
  { label: 'cross-org: user + shared_org',        row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_org',       sharedTeamIds: [] },        principal: userPrincipal({ organisationId: ORG_B }),      expected: false },
  { label: 'cross-org: service + shared_org',     row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null,   visibilityScope: 'shared_org',       sharedTeamIds: [] },        principal: servicePrincipal({ organisationId: ORG_B }),   expected: false },
  { label: 'cross-org: service + shared_subaccount', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null, visibilityScope: 'shared_subaccount', sharedTeamIds: [] },      principal: servicePrincipal({ organisationId: ORG_B }),   expected: false },
  { label: 'cross-org: delegated + private',      row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private',          sharedTeamIds: [] },        principal: delegatedPrincipal({ organisationId: ORG_B }), expected: false },
  { label: 'cross-org: delegated + shared_org',   row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_org',       sharedTeamIds: [] },        principal: delegatedPrincipal({ organisationId: ORG_B }), expected: false },

  // ==========================================================================
  // USER PRINCIPAL — private scope (6 fixtures)
  // ==========================================================================
  { label: 'user: private, owner match',                row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] },       principal: userPrincipal({ id: USER_1 }),                          expected: true },
  { label: 'user: private, owner mismatch',             row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_2, visibilityScope: 'private', sharedTeamIds: [] },       principal: userPrincipal({ id: USER_1 }),                          expected: false },
  { label: 'user: private, null owner',                 row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null,   visibilityScope: 'private', sharedTeamIds: [] },       principal: userPrincipal({ id: USER_1 }),                          expected: false },
  { label: 'user: private, owner match, sub null',      row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] },       principal: userPrincipal({ id: USER_1, subaccountId: null }),      expected: true },
  { label: 'user: private, owner match, sub mismatch',  row: { organisationId: ORG_A, subaccountId: SUB_2, ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] },       principal: userPrincipal({ id: USER_1, subaccountId: SUB_1 }),    expected: true },
  { label: 'user: private, owner match, user sub null', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] },       principal: userPrincipal({ id: USER_1, subaccountId: null }),     expected: true },

  // ==========================================================================
  // USER PRINCIPAL — shared_team scope (8 fixtures)
  // ==========================================================================
  { label: 'user: shared_team, teams overlap single',          row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A] },         principal: userPrincipal({ teamIds: [TEAM_A] }),             expected: true },
  { label: 'user: shared_team, teams overlap partial',         row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A, TEAM_B] }, principal: userPrincipal({ teamIds: [TEAM_B] }),             expected: true },
  { label: 'user: shared_team, teams disjoint',                row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_B] },         principal: userPrincipal({ teamIds: [TEAM_A] }),             expected: false },
  { label: 'user: shared_team, user empty teamIds',            row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A] },         principal: userPrincipal({ teamIds: [] }),                    expected: false },
  { label: 'user: shared_team, row empty sharedTeamIds',       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [] },                principal: userPrincipal({ teamIds: [TEAM_A] }),             expected: false },
  { label: 'user: shared_team, both empty teams',              row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [] },                principal: userPrincipal({ teamIds: [] }),                    expected: false },
  { label: 'user: shared_team, multiple overlap',              row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A, TEAM_B] }, principal: userPrincipal({ teamIds: [TEAM_A, TEAM_B] }),     expected: true },
  { label: 'user: shared_team, null sub still works',          row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A] },         principal: userPrincipal({ teamIds: [TEAM_A], subaccountId: null }), expected: true },

  // ==========================================================================
  // USER PRINCIPAL — shared_subaccount scope (6 fixtures)
  // ==========================================================================
  { label: 'user: shared_subaccount, sub match',               row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'user: shared_subaccount, sub mismatch',            row: { organisationId: ORG_A, subaccountId: SUB_2, ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: SUB_1 }),     expected: false },
  { label: 'user: shared_subaccount, row sub null (org-level)', row: { organisationId: ORG_A, subaccountId: null, ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'user: shared_subaccount, both sub null',           row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: null }),      expected: true },
  { label: 'user: shared_subaccount, user sub null row sub set', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: null }),   expected: false },
  { label: 'user: shared_subaccount, different owner still visible', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_2, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ id: USER_1, subaccountId: SUB_1 }), expected: true },

  // ==========================================================================
  // USER PRINCIPAL — shared_org scope (4 fixtures)
  // ==========================================================================
  { label: 'user: shared_org, same sub',          row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'user: shared_org, different sub',     row: { organisationId: ORG_A, subaccountId: SUB_2, ownerUserId: USER_1, visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'user: shared_org, null sub',          row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: null,   visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: userPrincipal({ subaccountId: null }),      expected: true },
  { label: 'user: shared_org, different owner',   row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_2, visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: userPrincipal({ id: USER_1 }),              expected: true },

  // ==========================================================================
  // SERVICE PRINCIPAL — private scope (2 fixtures)
  // ==========================================================================
  { label: 'service: private, always denied',             row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] },        principal: servicePrincipal(),                              expected: false },
  { label: 'service: private, null owner still denied',   row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null,   visibilityScope: 'private', sharedTeamIds: [] },        principal: servicePrincipal(),                              expected: false },

  // ==========================================================================
  // SERVICE PRINCIPAL — shared_team scope (2 fixtures)
  // ==========================================================================
  { label: 'service: shared_team, always denied even with teamIds', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A] }, principal: servicePrincipal({ teamIds: [TEAM_A] }), expected: false },
  { label: 'service: shared_team, denied with empty teams',        row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A] }, principal: servicePrincipal({ teamIds: [] }),        expected: false },

  // ==========================================================================
  // SERVICE PRINCIPAL — shared_subaccount scope (5 fixtures)
  // ==========================================================================
  { label: 'service: shared_subaccount, sub match',              row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'service: shared_subaccount, sub mismatch',           row: { organisationId: ORG_A, subaccountId: SUB_2, ownerUserId: null, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: SUB_1 }),     expected: false },
  { label: 'service: shared_subaccount, row sub null (org-level)', row: { organisationId: ORG_A, subaccountId: null, ownerUserId: null, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: SUB_1 }),    expected: true },
  { label: 'service: shared_subaccount, both sub null',          row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: null, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: null }),      expected: true },
  { label: 'service: shared_subaccount, svc sub null row sub set', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: null }),   expected: false },

  // ==========================================================================
  // SERVICE PRINCIPAL — shared_org scope (3 fixtures)
  // ==========================================================================
  { label: 'service: shared_org, same sub',       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null, visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'service: shared_org, different sub',  row: { organisationId: ORG_A, subaccountId: SUB_2, ownerUserId: null, visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: SUB_1 }),     expected: true },
  { label: 'service: shared_org, null sub',       row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: null, visibilityScope: 'shared_org', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: null }),      expected: true },

  // ==========================================================================
  // DELEGATED PRINCIPAL — private scope (5 fixtures)
  // ==========================================================================
  { label: 'delegated: private, owner match (delegatingUserId)',        row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] }, principal: delegatedPrincipal({ id: USER_1, delegatingUserId: USER_1 }),  expected: true },
  { label: 'delegated: private, owner mismatch',                       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_2, visibilityScope: 'private', sharedTeamIds: [] }, principal: delegatedPrincipal({ id: USER_1, delegatingUserId: USER_1 }),  expected: false },
  { label: 'delegated: private, null owner',                           row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: null,   visibilityScope: 'private', sharedTeamIds: [] }, principal: delegatedPrincipal({ id: USER_1, delegatingUserId: USER_1 }),  expected: false },
  { label: 'delegated: private, owner match, sub mismatch (ignores sub)', row: { organisationId: ORG_A, subaccountId: SUB_2, ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] }, principal: delegatedPrincipal({ id: USER_1, delegatingUserId: USER_1, subaccountId: SUB_1 }), expected: true },
  { label: 'delegated: private, owner match, null sub on row',         row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: USER_1, visibilityScope: 'private', sharedTeamIds: [] }, principal: delegatedPrincipal({ id: USER_1, delegatingUserId: USER_1 }),  expected: true },

  // ==========================================================================
  // DELEGATED PRINCIPAL — non-private scopes: always denied (7 fixtures)
  // ==========================================================================
  { label: 'delegated: shared_team, denied even with team overlap',       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team',      sharedTeamIds: [TEAM_A] }, principal: delegatedPrincipal({ teamIds: [TEAM_A] }),                    expected: false },
  { label: 'delegated: shared_team, denied with empty teams',            row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team',      sharedTeamIds: [] },       principal: delegatedPrincipal({ teamIds: [] }),                          expected: false },
  { label: 'delegated: shared_subaccount, denied even with sub match',   row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] },      principal: delegatedPrincipal({ subaccountId: SUB_1 }),                 expected: false },
  { label: 'delegated: shared_subaccount, denied with null sub',         row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: USER_1, visibilityScope: 'shared_subaccount', sharedTeamIds: [] },      principal: delegatedPrincipal({ subaccountId: null }),                  expected: false },
  { label: 'delegated: shared_org, denied',                              row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_org',       sharedTeamIds: [] },       principal: delegatedPrincipal(),                                        expected: false },
  { label: 'delegated: shared_org, denied even with matching sub',       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_org',       sharedTeamIds: [] },       principal: delegatedPrincipal({ subaccountId: SUB_1 }),                 expected: false },
  { label: 'delegated: shared_org, denied null sub',                     row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: null,   visibilityScope: 'shared_org',       sharedTeamIds: [] },       principal: delegatedPrincipal({ subaccountId: null }),                  expected: false },

  // ==========================================================================
  // EDGE CASES (8 fixtures)
  // ==========================================================================
  { label: 'edge: user with many teams, single overlap allows shared_team', row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_A] }, principal: userPrincipal({ teamIds: ['t1', 't2', 't3', TEAM_A, 't4'] }), expected: true },
  { label: 'edge: user with many teams, no overlap denies shared_team',     row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'shared_team', sharedTeamIds: [TEAM_B] }, principal: userPrincipal({ teamIds: ['t1', 't2', 't3', TEAM_A, 't4'] }), expected: false },
  { label: 'edge: service private denied even if service has teamIds',      row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: SVC_1,  visibilityScope: 'private',     sharedTeamIds: [] },       principal: servicePrincipal({ id: SVC_1, teamIds: [TEAM_A] }),            expected: false },
  { label: 'edge: user private, owner match, row has teams (irrelevant)',   row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private',     sharedTeamIds: [TEAM_A, TEAM_B] }, principal: userPrincipal({ id: USER_1, teamIds: [] }),              expected: true },
  { label: 'edge: user shared_subaccount ignores ownership',               row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_2, visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: userPrincipal({ id: USER_1, subaccountId: SUB_1 }),        expected: true },
  { label: 'edge: user shared_org ignores teams',                          row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_2, visibilityScope: 'shared_org',   sharedTeamIds: [TEAM_B] }, principal: userPrincipal({ id: USER_1, teamIds: [] }),                  expected: true },
  { label: 'edge: service shared_subaccount, row null sub + svc null sub', row: { organisationId: ORG_A, subaccountId: null,  ownerUserId: null,   visibilityScope: 'shared_subaccount', sharedTeamIds: [] }, principal: servicePrincipal({ subaccountId: null }),                    expected: true },
  { label: 'edge: delegated cross-org denied even with owner match',       row: { organisationId: ORG_A, subaccountId: SUB_1, ownerUserId: USER_1, visibilityScope: 'private',     sharedTeamIds: [] },       principal: delegatedPrincipal({ organisationId: ORG_B, id: USER_1, delegatingUserId: USER_1 }), expected: false },
];

// ---------------------------------------------------------------------------
// Run all fixtures
// ---------------------------------------------------------------------------

console.log(`Running ${FIXTURES.length} parity fixtures\n`);

for (const fixture of FIXTURES) {
  test(fixture.label, () => {
    const actual = isVisibleTo(fixture.row, fixture.principal);
    assert(
      actual === fixture.expected,
      `expected ${fixture.expected}, got ${actual}`,
    );
  });
}

// Sanity check: we said 64+
console.log('');
console.log(`Fixture count: ${FIXTURES.length}`);
if (FIXTURES.length < 64) {
  console.log(`  WARNING: only ${FIXTURES.length} fixtures, expected 64+`);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
