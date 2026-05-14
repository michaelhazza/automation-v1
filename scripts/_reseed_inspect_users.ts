import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  "SELECT id, organisation_id, email, role, status, deleted_at, created_at FROM users ORDER BY created_at"
);
console.log(JSON.stringify(rows, null, 2));
console.log(`\n[${rows.length} user rows]`);
await pool.end();
