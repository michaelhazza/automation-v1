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

import { and, eq, isNull, or } from 'drizzle-orm';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { assertScope, assertScopeSingle } from '../lib/scopeAssertion.js';
import { agents, agentTestFixtures, skills } from '../db/schema/index.js';
import { logger } from '../lib/logger.js';

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

/**
 * List active (non-deleted) fixtures for a given target.
 *
 * **Orphan filter:** fixtures are polymorphic (`scope` + `targetId`) with no
 * FK to `agents` or `skills`, so a soft-deleted target can leave fixture rows
 * with `deletedAt IS NULL`. We verify the target still exists and is itself
 * non-deleted before returning the caller's list. If the target is gone, the
 * list comes back empty and a warning is logged for the background cleanup
 * job to pick up later.
 */
export async function listFixtures(
  orgId: string,
  scope: 'agent' | 'skill',
  targetId: string,
  /** When provided, restrict to fixtures for this subaccount only. */
  subaccountId?: string
) {
  const db = getOrgScopedDb('agentTestFixturesService.listFixtures');

  // Confirm the polymorphic target still exists and has not been soft-deleted.
  const targetTable = scope === 'agent' ? agents : skills;
  const [target] = await db
    .select({ id: targetTable.id })
    .from(targetTable)
    .where(
      and(
        eq(targetTable.id, targetId),
        eq(targetTable.organisationId, orgId),
        isNull(targetTable.deletedAt),
      ),
    )
    .limit(1);
  if (!target) {
    logger.warn('agentTestFixtures.orphan_target', {
      orgId,
      scope,
      targetId,
      note: 'Target row missing or soft-deleted; fixtures are orphans and will be hidden on read.',
    });
    return [];
  }

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

/**
 * Maintenance helper: soft-delete fixtures whose polymorphic target has been
 * hard- or soft-deleted. Intended to be called by a periodic cleanup job;
 * safe to run at any time because it only touches rows whose target is
 * already gone.
 */
export async function cleanupOrphanedFixtures(orgId: string): Promise<number> {
  const db = getOrgScopedDb('agentTestFixturesService.cleanupOrphanedFixtures');
  const liveFixtures = await db
    .select({
      id: agentTestFixtures.id,
      scope: agentTestFixtures.scope,
      targetId: agentTestFixtures.targetId,
    })
    .from(agentTestFixtures)
    .where(
      and(
        eq(agentTestFixtures.organisationId, orgId),
        isNull(agentTestFixtures.deletedAt),
      ),
    );
  if (liveFixtures.length === 0) return 0;

  const agentIds = new Set<string>();
  const skillIds = new Set<string>();
  for (const f of liveFixtures) {
    if (f.scope === 'agent') agentIds.add(f.targetId);
    else if (f.scope === 'skill') skillIds.add(f.targetId);
  }

  const validAgents = agentIds.size === 0
    ? new Set<string>()
    : new Set(
        (await db
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.organisationId, orgId), isNull(agents.deletedAt)))
        ).map((r) => r.id),
      );
  const validSkills = skillIds.size === 0
    ? new Set<string>()
    : new Set(
        (await db
          .select({ id: skills.id })
          .from(skills)
          .where(and(eq(skills.organisationId, orgId), isNull(skills.deletedAt)))
        ).map((r) => r.id),
      );

  const orphanIds = liveFixtures
    .filter((f) =>
      (f.scope === 'agent' && !validAgents.has(f.targetId)) ||
      (f.scope === 'skill' && !validSkills.has(f.targetId)),
    )
    .map((f) => f.id);
  if (orphanIds.length === 0) return 0;

  await db
    .update(agentTestFixtures)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(agentTestFixtures.organisationId, orgId),
        or(...orphanIds.map((id) => eq(agentTestFixtures.id, id))),
      ),
    );
  logger.info('agentTestFixtures.cleanup_orphaned', {
    orgId,
    cleaned: orphanIds.length,
  });
  return orphanIds.length;
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
 * Called from agentService / skillService when the target is soft-deleted
 * (spec §9 orphan cleanup). Runs as a separate statement — not in the same
 * DB transaction as the parent delete. Partial failure leaves orphaned rows
 * with deletedAt=null, which are harmless (filtered on read) but untidy.
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
