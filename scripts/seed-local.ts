/**
 * Local development seed script.
 *
 * Runs the system seed (system org + admin + agents), then creates
 * dev-specific organisations and test users.
 *
 * Usage:
 *   npx tsx scripts/seed-local.ts
 *
 * Requires .env to be configured with a valid DATABASE_URL.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { organisations } from '../server/db/schema/organisations.js';
import { users } from '../server/db/schema/users.js';
import { seedSystem } from './seed-system.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  // 1. Run system seed (system org + admin + system agents)
  await seedSystem();

  // 2. Create dev-specific org and user
  await seedDevOrg();

  await pool.end();
  console.log('\nDone. You can now log in with:');
  console.log('  System Admin  admin@automation.os           / Admin123!');
  console.log('  Org Admin     michael@breakoutsolutions.com / Zu5QzB5vG8!2');
}

async function seedDevOrg() {
  console.log('\n  Seeding dev organisation...');

  const [org] = await db
    .insert(organisations)
    .values({
      name: 'Breakout Solutions',
      slug: 'breakout-solutions',
      plan: 'professional',
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  const orgId = org
    ? org.id
    : (await db.select().from(organisations).where(eq(organisations.slug, 'breakout-solutions')))[0]?.id;

  if (!orgId) throw new Error('Could not create or find breakout-solutions organisation');
  if (!org) console.log('  [skip] breakout-solutions organisation already exists');
  else console.log('  [ok]   Created organisation: breakout-solutions', orgId);

  const passwordHash = await bcrypt.hash('Zu5QzB5vG8!2', 12);
  const [user] = await db
    .insert(users)
    .values({
      organisationId: orgId,
      email: 'michael@breakoutsolutions.com',
      passwordHash,
      firstName: 'Michael',
      lastName: 'Admin',
      role: 'org_admin',
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  if (!user) console.log('  [skip] michael@breakoutsolutions.com already exists');
  else console.log('  [ok]   Created org admin:', user.email);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
