import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

console.log('=== Reseed verification ===\n');

const dir = resolve('backups');
const files = readdirSync(dir).filter((f) => f.startsWith('users-')).sort();
const backup = JSON.parse(readFileSync(resolve(dir, files[files.length - 1]), 'utf8'));

const live = await pool.query(
  'SELECT email, password_hash, first_name, last_name, role, status FROM users ORDER BY email'
);

console.log('-- Password hash match --');
for (const b of backup) {
  const l = live.rows.find((r: Record<string, unknown>) => r.email === b.email);
  const match = l && l.password_hash === b.password_hash;
  console.log(`  ${b.email}: ${match ? 'OK (hash preserved)' : 'MISMATCH'}`);
}

console.log('\n-- Counts --');
const tables = [
  'organisations',
  'users',
  'subaccounts',
  'system_agents',
  'system_skills',
  'agents',
  'subaccount_agents',
  'system_workflow_templates',
];
const summary: Record<string, number> = {};
for (const t of tables) {
  const r = await pool.query(`SELECT COUNT(*)::int AS c FROM ${t}`);
  summary[t] = r.rows[0].c;
}
console.table(summary);

console.log('\n-- System agents (top-level slugs) --');
const ag = await pool.query(
  "SELECT slug, name FROM system_agents ORDER BY slug"
);
for (const r of ag.rows) {
  console.log(`  ${r.slug.padEnd(38)} ${r.name}`);
}

console.log('\n-- Users in live DB --');
for (const u of live.rows) {
  console.log(`  ${u.email.padEnd(34)} role=${u.role} status=${u.status}`);
}

await pool.end();
