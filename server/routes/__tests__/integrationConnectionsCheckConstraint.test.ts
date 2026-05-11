// guard-ignore-file: pure-helper-convention reason="DB-level integration test — verifies the 0320 CHECK constraint fires at the Postgres layer; no pure helper extraction possible."
/**
 * integrationConnectionsCheckConstraint.test.ts
 *
 * Verifies that migration 0320 installs a Postgres CHECK constraint on
 * integration_connections.connection_status that rejects out-of-enum values
 * at the DB layer, independent of the route's Zod validation.
 *
 * This test bypasses the PATCH route entirely and uses a raw Drizzle insert
 * to prove the constraint fires even if Zod is circumvented.
 *
 * Section:
 *   Integration only (requires DATABASE_URL with migration 0320 applied).
 *
 * Runnable via:
 *   npx vitest run server/routes/__tests__/integrationConnectionsCheckConstraint.test.ts
 *
 * NOTE: Migration 0320 preflight test (seed a 'foo' row, run migration, assert RAISE)
 * is CI/manual only. To verify it manually:
 *   1. Insert a row: INSERT INTO integration_connections (..., connection_status) VALUES (..., 'foo');
 *      (requires temporarily disabling the constraint with ALTER TABLE ... DROP CONSTRAINT ...)
 *   2. Run: psql $DATABASE_URL < migrations/0320_connections_status_check.sql
 *   3. Confirm the exception message: "0320 preflight failed: 1 rows have invalid connection_status..."
 * The preflight guard cannot be automated in Vitest without a pg superuser DDL harness.
 */
export {};

import { describe, test, expect } from 'vitest';

const SKIP_DB = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('placeholder') ||
  process.env.NODE_ENV !== 'integration';

describe('integration_connections CHECK constraint (DB-level)', () => {
  test.skipIf(SKIP_DB)(
    'after migration 0320, direct DB insert with connection_status="foo" raises Postgres error 23514',
    async () => {
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const postgres = (await import('postgres')).default;
      const { eq } = await import('drizzle-orm');
      const { integrationConnections, organisations, subaccounts } = await import('../../db/schema/index.js');

      const client = postgres(process.env.DATABASE_URL!);
      const db = drizzle(client);

      // Find an anchor (org + subaccount) to satisfy FK constraints
      const [anchor] = await db
        .select({ orgId: organisations.id, subId: subaccounts.id })
        .from(organisations)
        .innerJoin(subaccounts, eq(subaccounts.organisationId, organisations.id))
        .limit(1);

      if (!anchor) {
        // No seed data — skip gracefully rather than failing
        await client.end();
        return;
      }

      // PTH-CGT-CI Round 2: wrap the bad insert in a transaction with the
      // org GUC set first. integration_connections is FORCE-RLS; without the
      // GUC, the insert silently returns no rows and the CHECK constraint
      // never fires. Setting `app.organisation_id` first lets the insert
      // reach the constraint, which then throws 23514 as expected.
      const { sql } = await import('drizzle-orm');
      let insertedId: string | undefined;
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('app.organisation_id', ${anchor.orgId}, true)`);
          // Bypass Zod by casting — this tests the DB constraint directly.
          // Drizzle's $type<> is TypeScript-only; the cast makes TS happy while
          // sending the invalid string to Postgres.
          const [row] = await tx.insert(integrationConnections).values({
            organisationId: anchor.orgId,
            subaccountId: anchor.subId,
            providerType: 'custom',
            authType: 'api_key',
            connectionStatus: 'foo' as 'active', // intentional invalid value — tests DB CHECK
            label: `test-c7-constraint-${Date.now()}`,
            ownershipScope: 'subaccount',
            classification: 'shared_mailbox',
            visibilityScope: 'shared_subaccount',
          }).returning();

          // If we reach here, the constraint is missing — record the id for cleanup
          insertedId = row?.id;
          expect.fail('Expected Postgres CHECK constraint violation (error code 23514) but insert succeeded. Confirm migration 0320 has been applied.');
        });
      } catch (err: unknown) {
        // Postgres error 23514 = check_violation
        // drizzle may wrap the original pg error; check both common shapes
        const pgErr = err as { code?: string; cause?: { code?: string }; message?: string };
        const code = pgErr.code ?? pgErr.cause?.code;
        expect(code).toBe('23514');
      } finally {
        // Clean up if the insert unexpectedly succeeded (shouldn't be possible
        // because the transaction rolls back on the expect.fail, but defensive
        // cleanup is cheap).
        if (insertedId) {
          await db.delete(integrationConnections).where(eq(integrationConnections.id, insertedId));
        }
        await client.end();
      }
    },
  );
});
