import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const dir = resolve('backups');
const files = readdirSync(dir).filter((f) => f.startsWith('users-')).sort();
const backup = JSON.parse(readFileSync(resolve(dir, files[files.length - 1]), 'utf8'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log('--- connection ---');
const meta = await pool.query("SELECT current_database() AS db, version() AS version, now() AS now");
console.log(`  db: ${meta.rows[0].db} | ${meta.rows[0].version.split(',')[0]}`);
console.log(`  now: ${meta.rows[0].now.toISOString()}`);

const ext = await pool.query("SELECT extname FROM pg_extension ORDER BY extname");
console.log(`  extensions: ${ext.rows.map((r: Record<string, unknown>) => r.extname).join(', ')}`);

const tbl = await pool.query("SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname='public'");
console.log(`  public tables: ${tbl.rows[0].c}`);

const mig = await pool.query('SELECT COUNT(*)::int AS c, MAX(filename) AS latest FROM schema_migrations');
console.log(`  migrations applied: ${mig.rows[0].c} | latest: ${mig.rows[0].latest}`);

console.log('\n--- users (login integrity) ---');
const u = await pool.query('SELECT email, password_hash, role, status FROM users ORDER BY email');
let allHashesPreserved = true;
for (const row of u.rows) {
  const b = backup.find((x: Record<string, unknown>) => x.email === row.email);
  let status: string;
  if (!b) {
    status = 'seeded (not in backup)';
  } else if (b.password_hash === row.password_hash) {
    status = 'OK hash preserved';
  } else {
    status = 'HASH MISMATCH';
    allHashesPreserved = false;
  }
  console.log(`  ${row.email.padEnd(34)} role=${(row.role + '').padEnd(13)} status=${(row.status + '').padEnd(8)} | ${status}`);
}

console.log('\n--- seed counts ---');
const counts = await pool.query(`
  SELECT
    (SELECT COUNT(*) FROM organisations)::int AS orgs,
    (SELECT COUNT(*) FROM subaccounts)::int AS subaccounts,
    (SELECT COUNT(*) FROM system_agents WHERE deleted_at IS NULL)::int AS system_agents_active,
    (SELECT COUNT(*) FROM system_skills)::int AS system_skills,
    (SELECT COUNT(*) FROM agents)::int AS org_agents,
    (SELECT COUNT(*) FROM subaccount_agents)::int AS subaccount_agents,
    (SELECT COUNT(*) FROM system_workflow_templates)::int AS workflow_templates
`);
console.table(counts.rows[0]);

console.log('--- representative read sanity check ---');
const sample = await pool.query(
  "SELECT slug, name FROM system_agents WHERE deleted_at IS NULL ORDER BY slug LIMIT 3"
);
for (const r of sample.rows) console.log(`  ${r.slug} -> ${r.name}`);

const ok =
  allHashesPreserved &&
  counts.rows[0].system_agents_active >= 22 &&
  u.rows.length >= 2 &&
  meta.rows[0].db === 'automation_os';

console.log(ok ? '\nALL GREEN' : '\nFAIL — check output');
await pool.end();
