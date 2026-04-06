/**
 * Import system agents from CSV into the database.
 * Upserts on slug — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/import-system-agents.ts [path/to/system-agents.csv]
 *
 * Defaults to: scripts/data/system-agents.csv
 */

import 'dotenv/config';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { systemAgents } from '../server/db/schema/index.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ---------------------------------------------------------------------------
// Minimal RFC 4180 CSV parser (handles quoted fields with embedded newlines)
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
      if (ch === '"' && next === '"') {
        // Escaped double-quote
        field += '"';
        i += 2;
      } else if (ch === '"') {
        // End of quoted field
        inQuotes = false;
        i++;
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r' && next === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i += 2;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  if (field || row.length > 0) {
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
  }

  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map(cols => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = (cols[idx] ?? '').trim();
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Row → DB value coercions
// ---------------------------------------------------------------------------

function parseJsonArray(val: string): string[] {
  if (!val) return [];
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseBool(val: string): boolean {
  return val.toLowerCase() === 'true' || val === '1';
}

function parseFloat_(val: string, fallback: number): number {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function parseInt_(val: string, fallback: number): number {
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------

async function importAgents(csvPath: string) {
  console.log(`\nImporting system agents from: ${csvPath}\n`);

  const raw = await readFile(csvPath, 'utf8');
  const rows = parseCsv(raw);

  if (rows.length === 0) {
    console.log('No rows found in CSV. Exiting.');
    return;
  }

  console.log(`Found ${rows.length} agent row(s).\n`);

  for (const row of rows) {
    const slug = row.slug?.trim();
    if (!slug) {
      console.warn('  [skip] Row missing slug — skipping');
      continue;
    }

    const values = {
      slug,
      name: row.name,
      description: row.description || null,
      icon: row.icon || null,
      agentRole: row.agentRole || null,
      agentTitle: row.agentTitle || null,
      masterPrompt: row.masterPrompt,
      modelProvider: row.modelProvider || 'anthropic',
      modelId: row.modelId || 'claude-sonnet-4-6',
      temperature: parseFloat_(row.temperature, 0.7),
      maxTokens: parseInt_(row.maxTokens, 4096),
      defaultSystemSkillSlugs: parseJsonArray(row.defaultSystemSkillSlugs),
      defaultOrgSkillSlugs: parseJsonArray(row.defaultOrgSkillSlugs),
      defaultTokenBudget: parseInt_(row.defaultTokenBudget, 30000),
      defaultMaxToolCalls: parseInt_(row.defaultMaxToolCalls, 20),
      executionMode: (row.executionMode as 'api' | 'headless') || 'api',
      executionScope: (row.executionScope as 'subaccount' | 'org') || 'subaccount',
      heartbeatEnabled: row.heartbeatEnabled ? parseBool(row.heartbeatEnabled) : false,
      heartbeatIntervalHours: row.heartbeatIntervalHours ? parseInt_(row.heartbeatIntervalHours, 0) || null : null,
      heartbeatOffsetHours: parseInt_(row.heartbeatOffsetHours ?? '0', 0),
      heartbeatOffsetMinutes: parseInt_(row.heartbeatOffsetMinutes ?? '0', 0),
      isPublished: parseBool(row.isPublished),
      status: (row.status as 'draft' | 'active' | 'inactive') || 'draft',
      defaultScheduleCron: row.defaultScheduleCron || null,
      updatedAt: new Date(),
    };

    // Check if exists
    const [existing] = await db
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(eq(systemAgents.slug, slug));

    if (existing) {
      await db
        .update(systemAgents)
        .set(values)
        .where(eq(systemAgents.slug, slug));
      console.log(`  [updated] ${slug} (${existing.id})`);
    } else {
      const [created] = await db
        .insert(systemAgents)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: systemAgents.id });
      console.log(`  [created] ${slug} (${created.id})`);
    }
  }

  console.log('\nDone.');
}

const csvPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve('scripts/data/system-agents.csv');

importAgents(csvPath)
  .catch((err) => {
    console.error('Import failed:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => pool.end());
