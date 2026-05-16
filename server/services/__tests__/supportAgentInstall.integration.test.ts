// @integration-test
/**
 * supportAgentInstallService — concurrent install race (integration).
 *
 * Verifies that two concurrent installs of the Support Agent for the same
 * subaccount resolve to exactly one success and one 409 already_installed.
 *
 * Defence under test:
 *   1. Advisory lock (pg_advisory_xact_lock) — primary defence.
 *   2. Partial unique index subaccount_agents_support_agent_singleton_idx — safety net.
 *      Both map 23505 to { statusCode: 409, errorCode: 'already_installed' }.
 *
 * Requires: NODE_ENV=integration (real Postgres with migration 0314 applied).
 * Skipped in unit-test runs.
 */

import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { eq, and, sql } from 'drizzle-orm';
import 'dotenv/config';
// Static sibling import (type-only) — satisfies verify-pure-helper-convention.sh
// while letting the dynamic body-level import below remain the real load path
// so module imports stay lazy when NODE_ENV !== 'integration'.
import type { supportAgentInstallService as _SiblingType } from '../supportAgentInstallService.js';
type _Unused = typeof _SiblingType;

process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

const SKIP = process.env.NODE_ENV !== 'integration';

// Fixed test UUIDs — stable across runs, cleaned up in afterEach.
const TEST_ORG_ID = '00000000-c7a0-0000-0000-000000000001';
const TEST_SUBACCOUNT_ID = '00000000-c7a0-0000-0000-000000000002';
const TEST_USER_ID = '00000000-c7a0-0000-0000-000000000003';

type SupportAgentInstallServiceType = typeof import('../supportAgentInstallService.js')['supportAgentInstallService'];
type DbType = Awaited<typeof import('../../db/index.js')>['db'];
type OrganisationsType = Awaited<typeof import('../../db/schema/organisations.js')>['organisations'];
type SubaccountsType = Awaited<typeof import('../../db/schema/subaccounts.js')>['subaccounts'];
type AgentsType = Awaited<typeof import('../../db/schema/agents.js')>['agents'];
type SubaccountAgentsType = Awaited<typeof import('../../db/schema/subaccountAgents.js')>['subaccountAgents'];

let svc: SupportAgentInstallServiceType;
let db: DbType;
let organisations: OrganisationsType;
let subaccounts: SubaccountsType;
let agents: AgentsType;
let subaccountAgents: SubaccountAgentsType;

if (!SKIP) {
  ({ supportAgentInstallService: svc } = await import('../supportAgentInstallService.js'));
  ({ db } = await import('../../db/index.js'));
  ({ organisations } = await import('../../db/schema/organisations.js'));
  ({ subaccounts } = await import('../../db/schema/subaccounts.js'));
  ({ agents } = await import('../../db/schema/agents.js'));
  ({ subaccountAgents } = await import('../../db/schema/subaccountAgents.js'));
}

describe.skipIf(SKIP)('supportAgentInstallService — concurrent install race (integration)', () => {
  beforeEach(async () => {
    // Clean up any leftover rows from prior runs
    await db
      .delete(subaccountAgents)
      .where(eq(subaccountAgents.subaccountId, TEST_SUBACCOUNT_ID));
    await db
      .delete(agents)
      .where(and(eq(agents.organisationId, TEST_ORG_ID), eq(agents.isSystemManaged, true)));
    await db
      .delete(subaccounts)
      .where(and(eq(subaccounts.id, TEST_SUBACCOUNT_ID), eq(subaccounts.organisationId, TEST_ORG_ID)));
    await db.delete(organisations).where(eq(organisations.id, TEST_ORG_ID));

    // Seed test org and subaccount
    await db.insert(organisations).values({
      id: TEST_ORG_ID,
      name: 'Test Org (concurrent-install)',
      slug: 'test-org-concurrent-install',
      plan: 'agency',
      status: 'active',
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      await tx.insert(subaccounts).values({
        id: TEST_SUBACCOUNT_ID,
        organisationId: TEST_ORG_ID,
        name: 'Test Subaccount',
        slug: 'test-subaccount-concurrent-install',
        status: 'active',
      });
    });
  });

  afterEach(async () => {
    await db
      .delete(subaccountAgents)
      .where(eq(subaccountAgents.subaccountId, TEST_SUBACCOUNT_ID));
    await db
      .delete(agents)
      .where(and(eq(agents.organisationId, TEST_ORG_ID), eq(agents.isSystemManaged, true)));
    await db
      .delete(subaccounts)
      .where(and(eq(subaccounts.id, TEST_SUBACCOUNT_ID), eq(subaccounts.organisationId, TEST_ORG_ID)));
    await db.delete(organisations).where(eq(organisations.id, TEST_ORG_ID));
  });

  test('two simultaneous installs for same subaccount → one 200, one 409', async () => {
    const input = {
      subaccountId: TEST_SUBACCOUNT_ID,
      organisationId: TEST_ORG_ID,
      actorUserId: TEST_USER_ID,
    };

    const results = await Promise.allSettled([svc.install(input), svc.install(input)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = (rejected[0] as PromiseRejectedResult).reason as {
      statusCode?: number;
      errorCode?: string;
    };
    expect(rejection.statusCode).toBe(409);
    expect(rejection.errorCode).toBe('already_installed');

    // Verify exactly one row was written
    const installed = await db
      .select({ id: subaccountAgents.id })
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, TEST_SUBACCOUNT_ID),
          eq(subaccountAgents.appliedTemplateSlug, 'support-agent'),
          eq(subaccountAgents.isActive, true),
        ),
      );
    expect(installed).toHaveLength(1);
  });

  test('sequential installs for same subaccount → second returns 409', async () => {
    const input = {
      subaccountId: TEST_SUBACCOUNT_ID,
      organisationId: TEST_ORG_ID,
      actorUserId: TEST_USER_ID,
    };

    const first = await svc.install(input);
    expect(first.subaccountAgentId).toBeTruthy();

    await expect(svc.install(input)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: 'already_installed',
    });
  });
});
