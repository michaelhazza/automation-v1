import 'dotenv/config';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const dir = resolve('backups');
const files = readdirSync(dir)
  .filter((f) => f.startsWith('users-') && f.endsWith('.json'))
  .sort();
if (files.length === 0) {
  console.error('[restore] no backup files found in backups/');
  process.exit(1);
}
const latest = files[files.length - 1];
const backupPath = resolve(dir, latest);
console.log(`[restore] using backup: ${latest}`);

const rows = JSON.parse(readFileSync(backupPath, 'utf8'));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let updated = 0;
let skipped = 0;
for (const row of rows) {
  const r = await pool.query(
    `UPDATE users
        SET password_hash = $1,
            first_name    = $2,
            last_name     = $3,
            slack_user_id = $4,
            updated_at    = now()
      WHERE email = $5
      RETURNING id, email`,
    [row.password_hash, row.first_name, row.last_name, row.slack_user_id, row.email]
  );
  if (r.rowCount && r.rowCount > 0) {
    console.log(`[restore] updated ${row.email} (id=${r.rows[0].id})`);
    updated += r.rowCount;
  } else {
    console.log(`[restore] no match for ${row.email} — skipping`);
    skipped++;
  }
}
console.log(`\n[restore] done: ${updated} updated, ${skipped} skipped`);
await pool.end();
