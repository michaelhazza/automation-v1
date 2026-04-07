/**
 * Forward-only SQL migration runner.
 *
 * Replaces drizzle-kit migrate. Reads migrations/*.sql in lexical order,
 * tracks applied files in a `schema_migrations` table, and applies any
 * pending files in their own transaction. Idempotent: re-running is a no-op
 * once everything is up to date.
 *
 * Why a custom runner: drizzle-kit migrate only applies migrations that are
 * registered in `migrations/meta/_journal.json`. The team has been hand-
 * writing SQL files (numbered 0041+) without registering them in the journal,
 * so drizzle-kit silently skipped them and every new branch hit schema drift.
 * This runner treats the SQL files themselves as the source of truth.
 *
 * Usage:
 *   npm run migrate
 *
 * Requires DATABASE_URL in env (or .env via dotenv/config).
 */

import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool, type PoolClient } from 'pg';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');
const ADVISORY_LOCK_KEY = 4242_0001; // arbitrary, stable

interface MigrationFile {
  filename: string;
  fullPath: string;
}

function listMigrationFiles(): MigrationFile[] {
  const entries = readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /^\d{4}_.*\.sql$/.test(e.name))
    .map((e) => ({ filename: e.name, fullPath: resolve(MIGRATIONS_DIR, e.name) }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedFilenames(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations'
  );
  return new Set(rows.map((r) => r.filename));
}

async function applyMigration(client: PoolClient, file: MigrationFile): Promise<void> {
  const sql = readFileSync(file.fullPath, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [file.filename]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  let releasedLock = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const files = listMigrationFiles();
    const applied = await getAppliedFilenames(client);
    const pending = files.filter((f) => !applied.has(f.filename));

    if (pending.length === 0) {
      console.log(`[migrate] up to date (${files.length} migrations applied)`);
      return;
    }

    console.log(`[migrate] applying ${pending.length} migration(s):`);
    for (const file of pending) {
      process.stdout.write(`  - ${file.filename} ... `);
      try {
        await applyMigration(client, file);
        console.log('ok');
      } catch (err) {
        console.log('FAILED');
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`[migrate] done`);
  } finally {
    try {
      if (!releasedLock) {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
        releasedLock = true;
      }
    } catch {
      // best-effort
    }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
