/**
 * seed-integration-fixtures.ts
 *
 * Seeds canonical UUID fixtures (organisation, subaccount, user, agents) that
 * the *.integration.test.ts files reference by hardcoded UUID. Invoked from
 * CI between `npm run migrate` and `npx vitest run` in the integration_tests
 * job. Idempotent — safe to re-run (uses ON CONFLICT DO NOTHING).
 *
 * Local usage:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/automation_os_test \
 *     npx tsx scripts/seed-integration-fixtures.ts
 *
 * Why a raw-pg seeder rather than drizzle: the drizzle schema modules pull in
 * server/lib/env.ts which validates a long list of env vars. We want this
 * script to be runnable with only DATABASE_URL set.
 */

import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed-integration-fixtures] DATABASE_URL is required.');
  process.exit(1);
}

// Canonical UUIDs — extracted from the *.integration.test.ts files. Tests
// reference these directly; do not change without coordinating with every
// test file that depends on them.
const ORG_ID         = '00000000-0000-0000-0000-000000000001';
const USER_ID        = '00000000-0000-0000-0000-000000000002';
const AGENT_ID       = '00000000-0000-0000-0000-000000000002'; // agent UUID overlaps with user UUID intentionally — different tables

const pool = new Pool({ connectionString: DATABASE_URL });

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── organisation ──
    await client.query(
      `INSERT INTO organisations (id, name, slug, plan, status)
       VALUES ($1::uuid, $2, $3, $4, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [ORG_ID, 'Integration Test Org', 'integration-test-org', 'starter'],
    );

    // ── subaccount ──
    // The (organisation_id, slug) unique index is partial (deletedAt IS NULL),
    // so target the unique constraint via ON CONFLICT (id) DO NOTHING. The
    // subaccount uses a generated UUID — tests that need a specific subaccount
    // create their own; the seeded one is for tests that just need any
    // (org, subaccount, agent) triple to exist (e.g. workspaceMemoryService).
    await client.query(
      `INSERT INTO subaccounts (id, organisation_id, name, slug, status)
       SELECT gen_random_uuid(), $1::uuid, 'Integration Test Subaccount', 'integration-test-subaccount', 'active'
       WHERE NOT EXISTS (
         SELECT 1 FROM subaccounts
         WHERE organisation_id = $1::uuid
           AND slug = 'integration-test-subaccount'
           AND deleted_at IS NULL
       )`,
      [ORG_ID],
    );

    // ── user ──
    await client.query(
      `INSERT INTO users (id, organisation_id, email, password_hash, first_name, last_name, role, status)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'Integration', 'Test', 'system_admin', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [USER_ID, ORG_ID, 'integration-test@example.com', 'placeholder-not-used'],
    );

    // ── agent — used by triageDurability STUB_CTX (agentId=0..002) ──
    await client.query(
      `INSERT INTO agents (id, organisation_id, name, slug, status)
       VALUES ($1::uuid, $2::uuid, 'Integration Test Agent', 'integration-test-agent', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [AGENT_ID, ORG_ID],
    );

    await client.query('COMMIT');

    const orgCount    = await client.query(`SELECT COUNT(*)::int AS c FROM organisations WHERE id = $1::uuid`, [ORG_ID]);
    const userCount   = await client.query(`SELECT COUNT(*)::int AS c FROM users         WHERE id = $1::uuid`, [USER_ID]);
    const agentCount  = await client.query(`SELECT COUNT(*)::int AS c FROM agents        WHERE id = $1::uuid`, [AGENT_ID]);
    const subaccountCount = await client.query(
      `SELECT COUNT(*)::int AS c FROM subaccounts WHERE organisation_id = $1::uuid AND slug = 'integration-test-subaccount' AND deleted_at IS NULL`,
      [ORG_ID],
    );

    console.log('[seed-integration-fixtures] seeded:');
    console.log(`  organisations[${ORG_ID}]: ${orgCount.rows[0].c}`);
    console.log(`  subaccounts[org=${ORG_ID}, slug=integration-test-subaccount]: ${subaccountCount.rows[0].c}`);
    console.log(`  users[${USER_ID}]: ${userCount.rows[0].c}`);
    console.log(`  agents[${AGENT_ID}]: ${agentCount.rows[0].c}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed-integration-fixtures] failed:', err);
    await pool.end();
    process.exit(1);
  });
