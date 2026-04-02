/**
 * Local development seed script.
 * Creates the system organisation, system admin user, and seeds system agents
 * from the company folder format.
 *
 * Usage:
 *   npx tsx scripts/seed-local.ts
 *
 * Requires .env to be configured with a valid DATABASE_URL.
 */

import 'dotenv/config';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { organisations } from '../server/db/schema/organisations.js';
import { users } from '../server/db/schema/users.js';
import { systemAgents } from '../server/db/schema/index.js';
import { parseCompanyFolder, toSystemAgentRows } from './lib/companyParser.js';

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

  await seedOrgAdmin();
  await seedSystemAgents();

  await pool.end();
  console.log('\nDone. You can now log in with:');
  console.log('  System Admin  admin@automation.os          / Admin123!');
  console.log('  Org Admin     michael@breakoutsolutions.com / Zu5QzB5vG8!2');
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

// ---------------------------------------------------------------------------
// Seed org admin (breakout solutions org + michael user)
// ---------------------------------------------------------------------------

async function seedOrgAdmin() {
  // Create org
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

  // Create org admin user
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

// ---------------------------------------------------------------------------
// Seed system agents from company folder format
// Reads companies/automation-os/ (or fallback to CSV for backwards compat)
// ---------------------------------------------------------------------------

async function seedSystemAgents() {
  console.log('\n  Seeding system agents from company folder...');

  const companyDir = resolve('companies/automation-os');
  let parsed;
  try {
    parsed = await parseCompanyFolder(companyDir);
  } catch (err) {
    console.log(`  [skip] Company folder not found or invalid: ${(err as Error).message}`);
    return;
  }

  console.log(`  Company: ${parsed.manifest.name} (v${parsed.manifest.version})`);
  console.log(`  Agents:  ${parsed.agents.length}`);

  const rows = toSystemAgentRows(parsed);

  for (const row of rows) {
    const values = {
      ...row,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(eq(systemAgents.slug, row.slug));

    if (existing) {
      await db.update(systemAgents).set(values).where(eq(systemAgents.slug, row.slug));
      console.log(`  [updated] system agent: ${row.slug}`);
    } else {
      const [created] = await db
        .insert(systemAgents)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: systemAgents.id });
      console.log(`  [created] system agent: ${row.slug} (${created.id})`);
    }
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
