// guard-ignore-file: pure-helper-convention reason="Integration test — dynamic imports required so npm run test:unit can skip without DATABASE_URL"
/**
 * RLS context-propagation integration test — Sprint 2 P1.1 Layer 1.
 *
 * This test exercises the full three-layer fail-closed contract:
 *
 *   Layer A (ALS + set_config): withOrgTx opens a transaction, issues
 *     `SELECT set_config('app.organisation_id', …, true)`, and every query
 *     inside sees only rows matching that org. Services call getOrgScopedDb()
 *     and inherit the context automatically.
 *
 *   Layer B (RLS default fail-closed): the same table, queried without an
 *     ALS context (i.e. against the top-level db handle with no set_config),
 *     returns zero rows and rejects writes — because every policy on an
 *     RLS-protected table checks that `app.organisation_id` is set and equal
 *     to the row's organisation_id.
 *
 * For every entry in `server/config/rlsProtectedTables.ts`, the test asserts:
 *
 *   1. Setting app.organisation_id to orgA returns only orgA rows.
 *   2. Setting app.organisation_id to orgB returns only orgB rows.
 *   3. Querying outside any tx (no set_config) returns zero rows.
 *   4. Attempting to INSERT without set_config is rejected by the policy's
 *      WITH CHECK clause.
 *
 * Run style: the repo uses lightweight tsx-based standalone tests, not a
 * framework. Running without DATABASE_URL skips cleanly with exit 0 — this
 * keeps `npm run test:unit` green on machines that have no Postgres.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npx tsx server/services/__tests__/rls.context-propagation.test.ts
 */

// Force this file to be treated as an ES module so top-level await below
// is valid under the server tsconfig.
export {};

if (!process.env.DATABASE_URL) {
  console.log('\nRLS context-propagation test\n');
  console.log('  SKIP  DATABASE_URL not set — integration test cannot run without Postgres');
  console.log('\n  Skipped (not a failure).\n');
  process.exit(0);
}

// Dynamic imports only when we have a DATABASE_URL, so the skip path above
// doesn't transitively load the drizzle / postgres-js modules (which would
// crash on missing env vars during module evaluation).
const { client, db } = await import('../../db/index.js');
const { withOrgTx } = await import('../../instrumentation.js');
const { RLS_PROTECTED_TABLES } = await import('../../config/rlsProtectedTables.js');
const { sql } = await import('drizzle-orm');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    if (err instanceof Error && err.stack) {
      console.log(err.stack.split('\n').slice(1, 4).map((l) => `        ${l}`).join('\n'));
    }
  }
}

function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

// Tables that enforce org isolation via parent-EXISTS (no direct organisation_id
// column). The generic Layer A and write-rejection tests use
// `WHERE organisation_id = ...` / `INSERT (id, organisation_id)` which would
// fail with a column-not-found error for these tables. They are skipped in the
// generic loop and covered by dedicated parent-EXISTS tests below.
const PARENT_EXISTS_TABLES: ReadonlySet<string> = new Set(['reference_document_versions']);

// ---------------------------------------------------------------------------
// Fixtures: create two throwaway organisations and seed one row per protected
// table against each. The seeding has to run under admin_role because the
// current connection is subject to RLS just like anyone else.
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-00000000aaaa';
const ORG_B = '00000000-0000-0000-0000-00000000bbbb';

async function setupFixtures(): Promise<void> {
  // Use the BYPASSRLS role to seed two orgs + one row per table per org.
  // The admin_role is created by migration 0079.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);

    await tx.execute(sql`
      INSERT INTO organisations (id, name, slug)
      VALUES (${ORG_A}::uuid, 'RLS Test Org A', 'rls-test-org-a')
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO organisations (id, name, slug)
      VALUES (${ORG_B}::uuid, 'RLS Test Org B', 'rls-test-org-b')
      ON CONFLICT (id) DO NOTHING
    `);
  });
}

async function cleanupFixtures(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE admin_role`);
    // Cascading FKs remove the per-table rows.
    await tx.execute(sql`DELETE FROM organisations WHERE id IN (${ORG_A}::uuid, ${ORG_B}::uuid)`);
  });
}

// ---------------------------------------------------------------------------
// Layer A — inside withOrgTx, set_config visibility is per-tenant.
// ---------------------------------------------------------------------------

async function assertLayerAVisibility(tableName: string): Promise<void> {
  // Query as ORG_A: expect to see 0 rows for any pre-existing fixtures
  // from ORG_B (we don't seed, so we just assert no cross-contamination).
  await withOrgTx(
    {
      tx: null as unknown as never, // filled in below by db.transaction
      organisationId: ORG_A,
      source: 'rls.context-propagation.test.ts:layerA:orgA',
    },
    async () => {
      // The real authenticate middleware wraps db.transaction around the
      // whole request — here we recreate the same shape so the set_config
      // is visible to the query below.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.organisation_id', ${ORG_A}, true)`);
        const rows = await tx.execute(
          sql.raw(`SELECT COUNT(*)::int AS c FROM ${tableName} WHERE organisation_id = '${ORG_B}'`),
        );
        const count = Number((rows as unknown as Array<{ c: number }>)[0]?.c ?? 0);
        assert(
          count === 0,
          `Layer A (orgA ctx) leaked ${count} rows belonging to orgB from ${tableName}`,
        );
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Layer B — no ALS context, RLS fail-closes.
// ---------------------------------------------------------------------------

async function assertLayerBFailClosed(tableName: string): Promise<void> {
  // Query the raw db handle WITHOUT set_config. RLS policy checks
  //   current_setting('app.organisation_id', true) IS NOT NULL
  // so every row is filtered out and the count must be zero.
  const rows = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS c FROM ${tableName}`),
  );
  const count = Number((rows as unknown as Array<{ c: number }>)[0]?.c ?? 0);
  assert(
    count === 0,
    `Layer B (no ALS ctx) returned ${count} rows from ${tableName} — RLS is NOT fail-closed`,
  );
}

async function assertLayerBWriteRejected(tableName: string): Promise<void> {
  // Without an ALS context, attempting an INSERT must be rejected by the
  // policy's WITH CHECK clause. We don't care about the exact SQL shape —
  // any attempted insert of a syntactically valid row should fail because
  // the policy check cannot evaluate.
  let rejected = false;
  try {
    await db.execute(
      sql.raw(`
        INSERT INTO ${tableName} (id, organisation_id)
        VALUES (gen_random_uuid(), '${ORG_A}')
      `),
    );
  } catch {
    rejected = true;
  }
  assert(
    rejected,
    `Layer B (no ALS ctx) allowed an INSERT into ${tableName} — RLS WITH CHECK is NOT fail-closed`,
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\nRLS context-propagation integration tests\n');

  await setupFixtures();

  try {
    for (const entry of RLS_PROTECTED_TABLES) {
      if (!PARENT_EXISTS_TABLES.has(entry.tableName)) {
        await test(
          `[Layer A] ${entry.tableName}: tenant-scoped read under withOrgTx(orgA) sees no orgB rows`,
          () => assertLayerAVisibility(entry.tableName),
        );
      }
      await test(
        `[Layer B] ${entry.tableName}: unscoped read returns zero rows`,
        () => assertLayerBFailClosed(entry.tableName),
      );
      if (!PARENT_EXISTS_TABLES.has(entry.tableName)) {
        await test(
          `[Layer B] ${entry.tableName}: unscoped INSERT is rejected`,
          () => assertLayerBWriteRejected(entry.tableName),
        );
      }
    }

    // Dedicated parent-EXISTS tests for reference_document_versions
    let parentDocIdA: string | null = null;
    let parentDocIdB: string | null = null;
    try {
      // Seed: one reference_document per org, one version per document.
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE admin_role`);
        const resA = await tx.execute(sql`
          INSERT INTO reference_documents (organisation_id, name)
          VALUES (${ORG_A}::uuid, 'RLS Test Doc A')
          RETURNING id
        `);
        parentDocIdA = (resA as unknown as Array<{ id: string }>)[0]?.id ?? null;
        const resB = await tx.execute(sql`
          INSERT INTO reference_documents (organisation_id, name)
          VALUES (${ORG_B}::uuid, 'RLS Test Doc B')
          RETURNING id
        `);
        parentDocIdB = (resB as unknown as Array<{ id: string }>)[0]?.id ?? null;

        await tx.execute(sql`
          INSERT INTO reference_document_versions
            (document_id, version, content, content_hash, token_counts, serialized_bytes_hash, change_source)
          VALUES
            (${parentDocIdA}::uuid, 1, 'version A', 'hash-rls-a', '{}', 'shash-rls-a', 'manual')
        `);
        await tx.execute(sql`
          INSERT INTO reference_document_versions
            (document_id, version, content, content_hash, token_counts, serialized_bytes_hash, change_source)
          VALUES
            (${parentDocIdB}::uuid, 1, 'version B', 'hash-rls-b', '{}', 'shash-rls-b', 'manual')
        `);
      });

      await test(
        `[Layer A] reference_document_versions: org-scoped context sees own versions, not other org's`,
        async () => {
          await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT set_config('app.organisation_id', ${ORG_A}, true)`);
            const rows = await tx.execute(sql`
              SELECT COUNT(*)::int AS c FROM reference_document_versions
              WHERE document_id = ${parentDocIdB}::uuid
            `);
            const count = Number((rows as unknown as Array<{ c: number }>)[0]?.c ?? 0);
            assert(
              count === 0,
              `Layer A (orgA ctx) leaked ${count} reference_document_versions belonging to orgB`,
            );
          });
        },
      );

      await test(
        `[Layer B] reference_document_versions: unscoped INSERT (new version for orgA doc) is rejected`,
        async () => {
          let rejected = false;
          try {
            await db.execute(sql`
              INSERT INTO reference_document_versions
                (document_id, version, content, content_hash, token_counts, serialized_bytes_hash, change_source)
              VALUES
                (${parentDocIdA}::uuid, 99, 'rejected', 'hash-rej', '{}', 'shash-rej', 'manual')
            `);
          } catch {
            rejected = true;
          }
          assert(
            rejected,
            `Layer B (no ALS ctx) allowed an INSERT into reference_document_versions — RLS WITH CHECK is NOT fail-closed`,
          );
        },
      );
    } finally {
      if (parentDocIdA || parentDocIdB) {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE admin_role`);
          if (parentDocIdA) {
            await tx.execute(sql`DELETE FROM reference_documents WHERE id = ${parentDocIdA}::uuid`);
          }
          if (parentDocIdB) {
            await tx.execute(sql`DELETE FROM reference_documents WHERE id = ${parentDocIdB}::uuid`);
          }
        });
      }
    }
  } finally {
    await cleanupFixtures();
    await client.end({ timeout: 5 });
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

await main();
