/**
 * scripts/verify-workspace-actor-coverage.ts — Phase A CI gate
 *
 * Asserts that every active subaccount-linked agent and every subaccount-
 * assigned user has a non-NULL workspace_actor_id. Exits 0 (OK) or 1 (FAIL).
 *
 * Spec reference: §5 (configuration / scripts), §15 (Phase A gate).
 *
 * DATABASE_URL must connect as a superuser / role with BYPASSRLS, matching
 * the same requirement as seed.ts and the migration runner. Standard CI
 * DATABASE_URL (postgres owner) satisfies this.
 *
 * Usage:
 *   npx tsx scripts/verify-workspace-actor-coverage.ts
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('verify-workspace-actor-coverage: DATABASE_URL is not set — aborting.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  try {
    const orphanAgents = await db.execute(sql`
      SELECT id, name
      FROM   agents
      WHERE  workspace_actor_id IS NULL
        AND  deleted_at         IS NULL
        AND  id IN (SELECT agent_id FROM subaccount_agents WHERE is_active = true)
    `);

    const orphanUsers = await db.execute(sql`
      SELECT id, email
      FROM   users
      WHERE  workspace_actor_id IS NULL
        AND  deleted_at         IS NULL
        AND  id IN (SELECT user_id FROM subaccount_user_assignments)
    `);

    const orphans = [
      ...(orphanAgents as unknown as { rows: unknown[] }).rows,
      ...(orphanUsers as unknown as { rows: unknown[] }).rows,
    ];

    if (orphans.length > 0) {
      console.error(
        'verify-workspace-actor-coverage: FAIL —',
        orphans.length,
        'row(s) missing workspace_actor_id',
      );
      console.error(orphans.slice(0, 10));
      process.exit(1);
    }

    console.log('verify-workspace-actor-coverage: OK');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('verify-workspace-actor-coverage: unexpected error —', err);
  process.exit(1);
});
