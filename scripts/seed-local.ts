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
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { organisations } from '../server/db/schema/organisations.js';
import { users } from '../server/db/schema/users.js';
import { systemAgents } from '../server/db/schema/index.js';

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

  await seedSystemAgents();

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

// ---------------------------------------------------------------------------
// Minimal RFC 4180 CSV parser (duplicated from import-system-agents.ts to
// keep seed-local.ts self-contained — no shared util imports at seed time)
// ---------------------------------------------------------------------------

function parseCsv(raw: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; }
      else if (ch === '"') { inQuotes = false; i++; }
      else { field += ch; i++; }
    } else {
      if (ch === '"') { inQuotes = true; i++; }
      else if (ch === ',') { row.push(field); field = ''; i++; }
      else if (ch === '\r' && next === '\n') { row.push(field); field = ''; rows.push(row); row = []; i += 2; }
      else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; }
      else { field += ch; i++; }
    }
  }
  if (field || row.length > 0) { row.push(field); if (row.some(f => f !== '')) rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(cols => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h.trim()] = (cols[idx] ?? '').trim(); });
    return obj;
  });
}

async function seedSystemAgents() {
  console.log('\n  Seeding system agents...');
  const csvPath = resolve('scripts/data/system-agents.csv');
  let raw: string;
  try {
    raw = await readFile(csvPath, 'utf8');
  } catch {
    console.log('  [skip] scripts/data/system-agents.csv not found');
    return;
  }

  const rows = parseCsv(raw);
  for (const row of rows) {
    const slug = row.slug?.trim();
    if (!slug) continue;
    const values = {
      slug,
      name: row.name,
      description: row.description || null,
      icon: row.icon || null,
      masterPrompt: row.masterPrompt,
      modelProvider: row.modelProvider || 'anthropic',
      modelId: row.modelId || 'claude-sonnet-4-6',
      temperature: parseFloat(row.temperature) || 0.7,
      maxTokens: parseInt(row.maxTokens, 10) || 4096,
      defaultSystemSkillSlugs: (() => { try { return JSON.parse(row.defaultSystemSkillSlugs); } catch { return []; } })(),
      defaultOrgSkillSlugs: (() => { try { return JSON.parse(row.defaultOrgSkillSlugs); } catch { return []; } })(),
      defaultTokenBudget: parseInt(row.defaultTokenBudget, 10) || 30000,
      defaultMaxToolCalls: parseInt(row.defaultMaxToolCalls, 10) || 20,
      executionMode: (row.executionMode as 'api' | 'headless') || 'api',
      isPublished: row.isPublished?.toLowerCase() === 'true',
      status: (row.status as 'draft' | 'active' | 'inactive') || 'draft',
      defaultScheduleCron: row.defaultScheduleCron || null,
      updatedAt: new Date(),
    };
    const [existing] = await db.select({ id: systemAgents.id }).from(systemAgents).where(eq(systemAgents.slug, slug));
    if (existing) {
      await db.update(systemAgents).set(values).where(eq(systemAgents.slug, slug));
      console.log(`  [updated] system agent: ${slug}`);
    } else {
      const [created] = await db.insert(systemAgents).values({ ...values, createdAt: new Date() }).returning({ id: systemAgents.id });
      console.log(`  [created] system agent: ${slug} (${created.id})`);
    }
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
