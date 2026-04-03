/**
 * Test database helpers — provides a Drizzle instance connected to the test DB
 * and utilities for test isolation.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'path';
import * as schema from '../../server/db/schema/index.js';
import { sql } from 'drizzle-orm';

// Load test env
config({ path: resolve(process.cwd(), '.env.test'), override: true });

const connectionString = process.env.DATABASE_URL!;

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getTestDb() {
  if (!_db) {
    _client = postgres(connectionString, { max: 5, idle_timeout: 10 });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export type TestDB = ReturnType<typeof getTestDb>;

/**
 * Truncate all test data from tables (in dependency order).
 * Used between test files when transaction rollback isn't sufficient.
 */
export async function cleanupTestDb() {
  const db = getTestDb();
  // Truncate in reverse-dependency order to avoid FK violations
  await db.execute(sql`
    TRUNCATE TABLE
      anomaly_events,
      health_snapshots,
      canonical_revenue,
      canonical_conversations,
      canonical_opportunities,
      canonical_contacts,
      canonical_accounts,
      connector_configs,
      org_memory_entries,
      org_memories,
      subaccount_tags,
      review_items,
      actions,
      agent_run_snapshots,
      agent_runs,
      org_agent_configs,
      subaccount_agents,
      agents,
      scheduled_tasks,
      tasks,
      agent_triggers,
      integration_connections,
      permission_set_items,
      org_user_roles,
      permission_sets,
      subaccounts,
      users,
      organisations
    CASCADE
  `);
}

/**
 * Close the test DB connection. Call in afterAll() of integration test suites.
 */
export async function closeTestDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
