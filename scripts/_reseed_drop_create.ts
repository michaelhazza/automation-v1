import 'dotenv/config';
import { assertDevTargetOrThrow } from './lib/prod-db-guard.js';
import { Pool } from 'pg';

async function main(): Promise<void> {
  assertDevTargetOrThrow(process.env.DATABASE_URL, process.env.NODE_ENV);

  const url = new URL(process.env.DATABASE_URL!);
  const targetDb = url.pathname.replace(/^\//, '');
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  console.log(`[reseed] target DB: ${targetDb}`);
  const admin = new Pool({ connectionString: adminUrl.toString() });

  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [targetDb]
  );
  console.log('[reseed] terminated any active connections');

  await admin.query(`DROP DATABASE IF EXISTS "${targetDb}"`);
  console.log(`[reseed] dropped database ${targetDb}`);

  await admin.query(`CREATE DATABASE "${targetDb}"`);
  console.log(`[reseed] created database ${targetDb}`);

  await admin.end();
}

await main();
