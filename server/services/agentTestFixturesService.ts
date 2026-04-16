// ---------------------------------------------------------------------------
// agentTestFixturesService — CRUD for test-input fixtures (Feature 2)
// ---------------------------------------------------------------------------
//
// Fixtures are saved prompt/input payloads used by the inline Run-Now test
// panel. They are scoped to org or subaccount and associated with a specific
// agent or skill (polymorphic target_id).
//
// Access matrix (spec §9):
//   - Org admins: read/write all fixtures within their organisation_id
//   - Subaccount users: read/write fixtures where subaccount_id matches
//     their own subaccount only (cannot see org-level or other subaccounts)
//   - client_user: no access (enforced upstream via permission check)
//
// assertScope() provides Layer 2 defence against tenant leakage.
// ---------------------------------------------------------------------------

import { and, eq, isNull } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { assertScope, assertScopeSingle } from '../lib/scopeAssertion.js';
import { agentTestFixtures } from '../db/schema/index.js';

export interface CreateFixtureOpts {
  orgId: string;
  subaccountId: string | null;
  scope: 'agent' | 'skill';
  targetId: string;
  label: string;
  inputJson: Record<string, unknown>;
  createdBy: string;
}

export interface UpdateFixtureOpts {
  label?: string;
  inputJson?: Record<string, unknown>;
}

/** List active (non-deleted) fixtures for a given target. */
export async function listFixtures(
  orgId: string,
  scope: 'agent' | 'skill',
  targetId: string,
  /** When provided, restrict to fixtures for this subaccount only. */
  subaccountId?: string
) {
  const db = getOrgScopedDb('agentTestFixturesService.listFixtures');
  const conditions = [
    eq(agentTestFixtures.organisationId, orgId),
    eq(agentTestFixtures.scope, scope),
    eq(agentTestFixtures.targetId, targetId),
    isNull(agentTestFixtures.deletedAt),
  ];
  if (subaccountId) {
    conditions.push(eq(agentTestFixtures.subaccountId, subaccountId));
  }
  const rows = await db
    .select()
    .from(agentTestFixtures)
    .where(and(...conditions));
  return assertScope(rows, { organisationId: orgId }, 'agentTestFixturesService.listFixtures');
}

/** Fetch a single fixture by id. Throws 404 shape if not found or deleted. */
export async function getFixture(orgId: string, fixtureId: string) {
  const db = getOrgScopedDb('agentTestFixturesService.getFixture');
  const rows = await db
    .select()
    .from(agentTestFixtures)
    .where(
      and(
        eq(agentTestFixtures.id, fixtureId),
        eq(agentTestFixtures.organisationId, orgId),
        isNull(agentTestFixtures.deletedAt)
      )
    );
  if (rows.length === 0) throw { statusCode: 404, message: 'Fixture not found' };
  return assertScopeSingle(rows[0], { organisationId: orgId }, 'agentTestFixturesService.getFixture');
}

/** Create a new fixture. */
export async function createFixture(opts: CreateFixtureOpts) {
  const db = getOrgScopedDb('agentTestFixturesService.createFixture');
  const [row] = await db
    .insert(agentTestFixtures)
    .values({
      organisationId: opts.orgId,
      subaccountId: opts.subaccountId,
      scope: opts.scope,
      targetId: opts.targetId,
      label: opts.label,
      inputJson: opts.inputJson,
      createdBy: opts.createdBy,
    })
    .returning();
  return assertScopeSingle(row, { organisationId: opts.orgId }, 'agentTestFixturesService.createFixture');
}

/** Update label or inputJson on an existing fixture. */
export async function updateFixture(
  orgId: string,
  fixtureId: string,
  opts: UpdateFixtureOpts
) {
  // Verify existence + scope first.
  await getFixture(orgId, fixtureId);
  const db = getOrgScopedDb('agentTestFixturesService.updateFixture');
  const updates: Partial<typeof agentTestFixtures.$inferInsert> = {};
  if (opts.label !== undefined) updates.label = opts.label;
  if (opts.inputJson !== undefined) updates.inputJson = opts.inputJson;
  const [row] = await db
    .update(agentTestFixtures)
    .set(updates)
    .where(
      and(
        eq(agentTestFixtures.id, fixtureId),
        eq(agentTestFixtures.organisationId, orgId)
      )
    )
    .returning();
  return assertScopeSingle(row, { organisationId: orgId }, 'agentTestFixturesService.updateFixture');
}

/** Soft-delete a single fixture. */
export async function deleteFixture(orgId: string, fixtureId: string) {
  await getFixture(orgId, fixtureId);
  const db = getOrgScopedDb('agentTestFixturesService.deleteFixture');
  await db
    .update(agentTestFixtures)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(agentTestFixtures.id, fixtureId),
        eq(agentTestFixtures.organisationId, orgId)
      )
    );
}

/**
 * Soft-delete all fixtures for a given target (agent or skill).
 * Called from agentService / skillService when the target is soft-deleted,
 * within the same transaction as the parent delete (spec §9 orphan cleanup).
 */
export async function softDeleteByTarget(
  orgId: string,
  scope: 'agent' | 'skill',
  targetId: string
) {
  const db = getOrgScopedDb('agentTestFixturesService.softDeleteByTarget');
  await db
    .update(agentTestFixtures)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(agentTestFixtures.organisationId, orgId),
        eq(agentTestFixtures.scope, scope),
        eq(agentTestFixtures.targetId, targetId),
        isNull(agentTestFixtures.deletedAt)
      )
    );
}
