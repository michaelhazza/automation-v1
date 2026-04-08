/**
 * System seed script — baseline platform data for production and Docker.
 *
 * Creates:
 *   - System organisation + system admin user
 *   - System agents from company folder (companies/automation-os/)
 *   - Agent hierarchy
 *
 * Does NOT create dev-specific orgs, test users, or sample data.
 *
 * Usage:
 *   npx tsx scripts/seed-system.ts
 *
 * Requires .env to be configured with a valid DATABASE_URL.
 * System admin credentials are read from environment variables:
 *   SYSTEM_ADMIN_EMAIL    (default: admin@automation.os)
 *   SYSTEM_ADMIN_PASSWORD (required in production, defaults to Admin123! in dev)
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
import { parseCompanyFolder, toSystemAgentRows, type ParsedCompany } from './lib/companyParser.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export async function seedSystem() {
  console.log('Seeding system baseline...\n');

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

  let systemOrgId: string;
  if (!org) {
    const existing = await db.select().from(organisations);
    const systemOrg = existing.find((o) => o.slug === 'system');
    if (!systemOrg) throw new Error('Could not create or find system organisation');
    systemOrgId = systemOrg.id;
    console.log('  [skip] System organisation already exists:', systemOrgId);
  } else {
    systemOrgId = org.id;
    console.log('  [ok]   Created system organisation:', systemOrgId);
  }

  // 2. Create system admin user
  const adminEmail = process.env.SYSTEM_ADMIN_EMAIL || 'admin@automation.os';
  const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD || 'Admin123!';

  if (!process.env.SYSTEM_ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
    console.warn('  [warn] SYSTEM_ADMIN_PASSWORD not set — using default. Set this in production!');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const [user] = await db
    .insert(users)
    .values({
      organisationId: systemOrgId,
      email: adminEmail,
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: 'system_admin',
      status: 'active',
    })
    .onConflictDoNothing()
    .returning();

  if (!user) console.log('  [skip] System admin user already exists');
  else console.log('  [ok]   Created system admin:', user.email);

  // 3. Seed system agents
  await seedSystemAgents();
}

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
    const values = { ...row, updatedAt: new Date() };

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

  await seedAgentHierarchy(parsed);
}

async function seedAgentHierarchy(parsed: ParsedCompany) {
  console.log('\n  Setting agent hierarchy...');

  const allAgents = await db.select({ id: systemAgents.id, slug: systemAgents.slug }).from(systemAgents);
  const slugToId = new Map(allAgents.map(a => [a.slug, a.id]));

  for (const agent of parsed.agents) {
    if (!agent.reportsTo || agent.reportsTo === 'null') continue;

    const parentId = slugToId.get(agent.reportsTo);
    if (!parentId) {
      console.log(`  [warn] reportsTo slug not found: ${agent.reportsTo} (for ${agent.slug})`);
      continue;
    }

    await db.update(systemAgents)
      .set({ parentSystemAgentId: parentId })
      .where(eq(systemAgents.slug, agent.slug));

    console.log(`  [hierarchy] ${agent.slug} → ${agent.reportsTo}`);
  }
}

// Run directly if this is the entry point
const isDirectRun = process.argv[1]?.endsWith('seed-system.ts') || process.argv[1]?.endsWith('seed-system.js');
if (isDirectRun) {
  seedSystem()
    .then(() => {
      console.log('\nSystem seed complete.');
      console.log(`  System admin: ${process.env.SYSTEM_ADMIN_EMAIL || 'admin@automation.os'}`);
    })
    .catch((err) => {
      console.error('System seed failed:', err.message);
      process.exit(1);
    })
    .finally(() => pool.end());
}
