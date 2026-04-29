// guard-ignore-file: pure-helper-convention reason="Integration test — dynamic imports required so npm run test:unit can skip without DATABASE_URL"
/**
 * CRM Query Planner — RLS isolation integration test (spec §20.2).
 *
 * Verifies that the planner's `withPrincipalContext` wrapping correctly
 * propagates principal session variables (§16.4) so every canonical read
 * inside the pipeline sees the caller's own subaccount and nothing else.
 *
 * The test uses a stub canonical handler that inspects the session
 * `app.current_subaccount_id` / `app.current_principal_id` values via
 * `current_setting(...)` and fails if they are not the caller's own
 * identifiers. A subaccount-A caller that leaks into subaccount-B's
 * execution context would fail this assertion immediately.
 *
 * Run style: tsx-based standalone test, matches the repo convention in
 * `rls.context-propagation.test.ts`. Skips cleanly when DATABASE_URL is
 * unset so `npm run test:unit` stays green on machines without Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx server/services/crmQueryPlanner/__tests__/integration.test.ts
 */

// Force ES module treatment for top-level await.
import { expect, test } from 'vitest';

export {};

if (!process.env.DATABASE_URL || process.env.NODE_ENV !== 'integration') {
  console.log('\nCRM Query Planner RLS isolation integration test\n');
  console.log('  SKIP  requires DATABASE_URL and NODE_ENV=integration');
  console.log('\n  Skipped (not a failure).\n');
  process.exit(0);
}

// Dynamic imports only after we confirm DATABASE_URL exists so the skip path
// above does not transitively load drizzle / postgres-js (which would error
// on missing env vars during module evaluation).
const { db } = await import('../../../db/index.js');
const { withOrgTx } = await import('../../../instrumentation.js');
const { sql } = await import('drizzle-orm');
const { runQuery } = await import('../crmQueryPlannerService.js');

const ORG_ID   = '00000000-0000-0000-0000-00000000c0a0';
const SUB_A_ID = '00000000-0000-0000-0000-00000000c0a1';
const SUB_B_ID = '00000000-0000-0000-0000-00000000c0a2';
const USER_A_ID = '00000000-0000-0000-0000-00000000c0b1';
const USER_B_ID = '00000000-0000-0000-0000-00000000c0b2';

// ---------------------------------------------------------------------------
// Fixtures — a throwaway org with two subaccounts.
// ---------------------------------------------------------------------------

async function setupFixtures(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    await tx.execute(sql`
      INSERT INTO organisations (id, name, slug)
      VALUES (${ORG_ID}::uuid, 'CRM Planner RLS Org', 'crm-planner-rls-org')
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO subaccounts (id, organisation_id, name)
      VALUES
        (${SUB_A_ID}::uuid, ${ORG_ID}::uuid, 'Subaccount A'),
        (${SUB_B_ID}::uuid, ${ORG_ID}::uuid, 'Subaccount B')
      ON CONFLICT (id) DO NOTHING
    `);
  });
}

async function cleanupFixtures(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // Cascading FKs remove the subaccounts.
    await tx.execute(sql`DELETE FROM organisations WHERE id = ${ORG_ID}::uuid`);
  });
}

// ---------------------------------------------------------------------------
// Stub canonical registry — the handler asserts the session principal
// variables match the expected caller; if RLS wrapping is broken the read
// would see a different subaccount and the assertion fires.
// ---------------------------------------------------------------------------

function makeIntrospectingRegistry(expected: {
  subaccountId: string;
  principalId: string;
  tx: unknown;
}): any {
  return Object.freeze({
    'contacts.inactive_over_days': {
      key:                  'contacts.inactive_over_days',
      primaryEntity:        'contacts',
      aliases:              ['stale contacts'],
      requiredCapabilities: ['canonical.contacts.read'],
      description:          'Stub — introspects session principal vars.',
      allowedFields: {
        updatedAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'], projectable: true, sortable: true },
      },
      handler: async () => {
        // The planner wraps the pipeline in withPrincipalContext, which calls
        // `set_config('app.current_subaccount_id', …, true)` on the active
        // org-scoped transaction. Probe session variables via that same tx
        // (not the top-level `db` handle) because `set_config(.., true)` is
        // transaction-local — a separate pooled connection would see NULLs.
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
          rows:            [],
          rowCount:        0,
          truncated:       false,
          actualCostCents: 0,
          source:          'canonical' as const,
        };
      },
      parseArgs: (_intent: any) => ({ limit: 100 }),
    },
  });
}

function makeContext(subaccountId: string, principalId: string) {
  return {
    orgId:                ORG_ID,
    organisationId:       ORG_ID,
    subaccountId,
    principalType:        'user' as const,
    principalId,
    teamIds:              [],
    callerCapabilities:   new Set<string>(['crm.query']),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

await setupFixtures();
try {
  await test('subaccount-A caller sees subaccount-A session vars inside canonical dispatch', async () => {
    await db.transaction(async (tx) => {
      // Recreate the auth middleware's set_config for app.organisation_id
      // so the RLS fail-closed guard isn't tripped inside the pipeline's
      // principal-context nesting.
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${ORG_ID}, true)`);
      // Bind the real tx into the ALS so getOrgTxContext() returns it and
      // withPrincipalContext can set session variables on the same connection
      // the handler-side probe will read back from.
      await withOrgTx(
        {
          tx,
          organisationId: ORG_ID,
          subaccountId:   SUB_A_ID,
          userId:         USER_A_ID,
          source:         'integration.test.ts:subA',
        },
        async () => {
          const deps = { registry: makeIntrospectingRegistry({ subaccountId: SUB_A_ID, principalId: USER_A_ID, tx }) };
          const result = await runQuery(
            { rawIntent: 'stale contacts', subaccountId: SUB_A_ID },
            makeContext(SUB_A_ID, USER_A_ID),
            deps,
          );
          expect(result.stageResolved === 1, 'Stage 1 canonical match expected').toBeTruthy();
        },
      );
    });
  });

  await test('subaccount-B caller sees subaccount-B session vars (cross-tenant isolation)', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organisation_id', ${ORG_ID}, true)`);
      await withOrgTx(
        {
          tx,
          organisationId: ORG_ID,
          subaccountId:   SUB_B_ID,
          userId:         USER_B_ID,
          source:         'integration.test.ts:subB',
        },
        async () => {
          const deps = { registry: makeIntrospectingRegistry({ subaccountId: SUB_B_ID, principalId: USER_B_ID, tx }) };
          const result = await runQuery(
            { rawIntent: 'stale contacts', subaccountId: SUB_B_ID },
            makeContext(SUB_B_ID, USER_B_ID),
            deps,
          );
          expect(result.stageResolved === 1, 'Stage 1 canonical match expected').toBeTruthy();
        },
      );
    });
  });
} finally {
  await cleanupFixtures();
}
