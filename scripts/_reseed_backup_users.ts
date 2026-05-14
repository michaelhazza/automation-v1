import 'dotenv/config';
import { Pool } from 'pg';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT * FROM users");

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve('backups', `users-${ts}.json`);
writeFileSync(out, JSON.stringify(rows, null, 2));
console.log(`[backup] wrote ${rows.length} rows -> ${out}`);
await pool.end();
