/**
 * Local development seed script.
 * Creates the system organisation and system admin user.
 *
 * Usage:
 *   npx tsx scripts/seed-local.ts
 *
 * Requires .env to be configured with a valid DATABASE_URL.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { organisations } from '../server/db/schema/organisations.js';
import { users } from '../server/db/schema/users.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  console.log('Seeding local database...\n');

  // 1. Create system organisation
  const [org] = await db
    .insert(organisations)
    .values({
      name: 'System',
      slug: 'system',
      plan: 'agency',
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  if (!org) {
    // Already exists — fetch it
    const existing = await db.select().from(organisations);
    const systemOrg = existing.find((o) => o.slug === 'system');
    if (!systemOrg) throw new Error('Could not create or find system organisation');
    console.log('  [skip] System organisation already exists:', systemOrg.id);

    await seedAdmin(systemOrg.id);
  } else {
    console.log('  [ok]   Created system organisation:', org.id);
    await seedAdmin(org.id);
  }

  await pool.end();
  console.log('\nDone. You can now log in with:');
  console.log('  Email:    admin@automation.os');
  console.log('  Password: Admin123!');
}

async function seedAdmin(organisationId: string) {
  const passwordHash = await bcrypt.hash('Admin123!', 12);

  const [user] = await db
    .insert(users)
    .values({
      organisationId,
      email: 'admin@automation.os',
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: 'system_admin',
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    console.log('  [skip] System admin user already exists');
  } else {
    console.log('  [ok]   Created system admin:', user.email);
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
