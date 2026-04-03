/**
 * Applies all SQL migration files to the test database.
 * Handles multi-statement migrations by executing each file as a single batch
 * via postgres.unsafe() which supports multi-statement SQL.
 */
import postgres from 'postgres';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';

const dbUrl = process.argv[2] || 'postgresql://postgres:Tyeahzilly!32@localhost:5432/automation_os_test';
const migrationsDir = resolve(process.cwd(), 'migrations');

console.log('[Migrate] Connecting...');
const sql = postgres(dbUrl, { max: 1 });

try {
  // Get migration files in order
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`[Migrate] Found ${files.length} migration files`);

  // Create tracking table
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS __test_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz DEFAULT now()
    )
  `);

  // Check which are already applied
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
      console.error(`[Migrate] FAILED on ${file}:`, e.message?.slice(0, 200));
      throw e;
    }
  }

  console.log(`[Migrate] Applied ${count} new migrations (${files.length - count} already applied)`);
} finally {
  await sql.end();
  process.exit(0);
}
