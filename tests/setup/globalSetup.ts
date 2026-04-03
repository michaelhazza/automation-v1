/**
 * Vitest global setup — runs once before all server test suites.
 * Creates test database if needed and applies migrations.
 */
import postgres from 'postgres';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env.test') });

export async function setup() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set in .env.test');

  const lastSlash = dbUrl.lastIndexOf('/');
  const testDbName = dbUrl.slice(lastSlash + 1);
  const maintenanceUrl = dbUrl.slice(0, lastSlash + 1) + 'postgres';

  // Create test database if it doesn't exist
  const maint = postgres(maintenanceUrl, { max: 1 });
  try {
    const existing = await maint`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
    if (existing.length === 0) {
      await maint.unsafe(`CREATE DATABASE "${testDbName}"`);
      console.log(`[Test Setup] Created database: ${testDbName}`);
    }
  } finally {
    await maint.end();
  }

  // Enable required extensions
  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Run migrations
    const migrationsDir = resolve(process.cwd(), 'migrations');
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();

    await sql.unsafe(`CREATE TABLE IF NOT EXISTS __test_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
    const applied = await sql`SELECT name FROM __test_migrations`;
    const appliedSet = new Set(applied.map(r => r.name));

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const content = await readFile(resolve(migrationsDir, file), 'utf-8');
      try {
        await sql.unsafe(content);
        await sql`INSERT INTO __test_migrations (name) VALUES (${file})`;
        count++;
      } catch (e: any) {
        console.error(`[Test Setup] Migration ${file} failed:`, e.message?.slice(0, 150));
        throw e;
      }
    }
    if (count > 0) console.log(`[Test Setup] Applied ${count} migrations`);
  } finally {
    await sql.end();
  }
}

export async function teardown() {
  console.log('[Test Teardown] Test database preserved for next run');
}
