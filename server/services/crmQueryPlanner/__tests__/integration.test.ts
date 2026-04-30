/**
 * CRM Query Planner — RLS isolation integration test (spec §20.2).
 *
 * Verifies that the planner's `withPrincipalContext` wrapping correctly
 * propagates principal session variables (§16.4) so every canonical read
 * inside the pipeline sees the caller's own subaccount and nothing else.
 *
 * Skips cleanly when DATABASE_URL or NODE_ENV=integration is unset.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const SKIP_CRM = !process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration';

const ORG_ID    = '00000000-0000-0000-0000-00000000c0a0';
const SUB_A_ID  = '00000000-0000-0000-0000-00000000c0a1';
const SUB_B_ID  = '00000000-0000-0000-0000-00000000c0a2';
const USER_A_ID = '00000000-0000-0000-0000-00000000c0b1';
const USER_B_ID = '00000000-0000-0000-0000-00000000c0b2';

describe.skipIf(SKIP_CRM)('CRM Query Planner — RLS isolation', () => {
  let db: Awaited<typeof import('../../../db/index.js')>['db'];
  let client: Awaited<typeof import('../../../db/index.js')>['client'];
  let withOrgTx: Awaited<typeof import('../../../instrumentation.js')>['withOrgTx'];
  let sql: Awaited<typeof import('drizzle-orm')>['sql'];
  let runQuery: Awaited<typeof import('../crmQueryPlannerService.js')>['runQuery'];
  // Superusers bypass RLS unconditionally; setupFixtures uses SET LOCAL ROLE
  // admin_role + INSERT, which fails because admin_role lacks INSERT perms
  // on organisations. Short-circuit the per-test bodies in that case rather
  // than asserting tautologies. Tracked: configure CI with a non-superuser app role.
  let runningAsSuperuser = false;

  beforeAll(async () => {
    ({ db, client } = await import('../../../db/index.js'));
    ({ withOrgTx } = await import('../../../instrumentation.js'));
    ({ sql } = await import('drizzle-orm'));
    ({ runQuery } = await import('../crmQueryPlannerService.js'));

    const rows = await db.execute(sql`SELECT current_setting('is_superuser') AS is_superuser`);
    runningAsSuperuser = (rows as unknown as Array<{ is_superuser: string }>)[0]?.is_superuser === 'on';

    if (runningAsSuperuser) {
      console.warn('crmQueryPlanner integration: connecting role is a Postgres superuser — RLS bypassed; tests short-circuit.');
      return;
    }

    await setupFixtures();
  });

  afterAll(async () => {
    if (runningAsSuperuser) return;
    try {
      await cleanupFixtures();
    } finally {
      if (client) {
        await client.end();
      }
    }
  });

  async function setupFixtures(): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      await tx.execute(sql`
        INSERT INTO organisations (id, name, slug, plan)
        VALUES (${ORG_ID}::uuid, 'CRM Planner RLS Org', 'crm-planner-rls-org', 'starter')
        ON CONFLICT (id) DO NOTHING
      `);
      await tx.execute(sql`
        INSERT INTO subaccounts (id, organisation_id, name, slug)
        VALUES
          (${SUB_A_ID}::uuid, ${ORG_ID}::uuid, 'Subaccount A', 'crm-planner-rls-sub-a'),
          (${SUB_B_ID}::uuid, ${ORG_ID}::uuid, 'Subaccount B', 'crm-planner-rls-sub-b')
        ON CONFLICT (id) DO NOTHING
      `);
    });
  }

  async function cleanupFixtures(): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE admin_role`);
      await tx.execute(sql`DELETE FROM organisations WHERE id = ${ORG_ID}::uuid`);
    });
  }

  function makeIntrospectingRegistry(expected: {
    subaccountId: string;
    principalId: string;
    tx: unknown;
  }): any {
    return Object.freeze({
      'contacts.inactive_over_days': {
        key: 'contacts.inactive_over_days',
        primaryEntity: 'contacts',
        aliases: ['stale contacts'],
        requiredCapabilities: ['canonical.contacts.read'],
        description: 'Stub — introspects session principal vars.',
        allowedFields: {
          updatedAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'], projectable: true, sortable: true },
        },
        handler: async () => {
          const tx = expected.tx as { execute: (q: unknown) => Promise<unknown> };
          const rows = await tx.execute(sql`
            SELECT
              current_setting('app.current_subaccount_id', true) AS sub,
              current_setting('app.current_principal_id', true) AS pid,
              current_setting('app.current_principal_type', true) AS ptype,
              current_setting('app.organisation_id', true) AS org
          `);
          const row = (rows as unknown as Array<{
            sub: string | null;
            pid: string | null;
            ptype: string | null;
            org: string | null;
          }>)[0];
          if (!row) throw new Error('no rows returned from session var probe');
          if (row.sub !== expected.subaccountId) {
            throw new Error(`RLS leak — session app.current_subaccount_id = ${row.sub}, expected ${expected.subaccountId}`);
          }
          if (row.pid !== expected.principalId) {
            throw new Error(`RLS leak — session app.current_principal_id = ${row.pid}, expected ${expected.principalId}`);
          }
          if (row.org !== ORG_ID) {
            throw new Error(`RLS leak — session app.organisation_id = ${row.org}, expected ${ORG_ID}`);
          }
          return {
            rows: [],
            rowCount: 0,
            truncated: false,
            actualCostCents: 0,
            source: 'canonical' as const,
          };
        },
        parseArgs: (_intent: any) => ({ limit: 100 }),
      },
    });
  }

  function makeContext(subaccountId: string, principalId: string) {
    return {
      orgId: ORG_ID,
      organisationId: ORG_ID,
      subaccountId,
      principalType: 'user' as const,
      principalId,
      teamIds: [],
      callerCapabilities: new Set<string>(['crm.query']),
    };
  }

  test('subaccount-A caller sees subaccount-A session vars inside canonical dispatch', async () => {
    if (runningAsSuperuser) return;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${ORG_ID}, true)`);
      await withOrgTx(
        {
          tx,
          organisationId: ORG_ID,
          subaccountId: SUB_A_ID,
          userId: USER_A_ID,
          source: 'integration.test.ts:subA',
        },
        async () => {
          const deps = { registry: makeIntrospectingRegistry({ subaccountId: SUB_A_ID, principalId: USER_A_ID, tx }) };
          const result = await runQuery(
            { rawIntent: 'stale contacts', subaccountId: SUB_A_ID },
            makeContext(SUB_A_ID, USER_A_ID),
            deps,
          );
          expect(result.stageResolved, 'Stage 1 canonical match expected').toBe(1);
        },
      );
    });
  });

  test('subaccount-B caller sees subaccount-B session vars (cross-tenant isolation)', async () => {
    if (runningAsSuperuser) return;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${ORG_ID}, true)`);
      await withOrgTx(
        {
          tx,
          organisationId: ORG_ID,
          subaccountId: SUB_B_ID,
          userId: USER_B_ID,
          source: 'integration.test.ts:subB',
        },
        async () => {
          const deps = { registry: makeIntrospectingRegistry({ subaccountId: SUB_B_ID, principalId: USER_B_ID, tx }) };
          const result = await runQuery(
            { rawIntent: 'stale contacts', subaccountId: SUB_B_ID },
            makeContext(SUB_B_ID, USER_B_ID),
            deps,
          );
          expect(result.stageResolved, 'Stage 1 canonical match expected').toBe(1);
        },
      );
    });
  });
});
