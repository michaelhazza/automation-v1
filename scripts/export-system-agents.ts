/**
 * Export system agents from the database to CSV.
 *
 * Usage:
 *   npx tsx scripts/export-system-agents.ts [output/path.csv]
 *
 * Defaults to: scripts/data/system-agents.csv
 */

import 'dotenv/config';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { isNull } from 'drizzle-orm';
import { systemAgents } from '../server/db/schema/index.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ---------------------------------------------------------------------------
// RFC 4180 CSV serialiser
// ---------------------------------------------------------------------------

const HEADERS = [
  'slug', 'name', 'description', 'icon', 'masterPrompt',
  'modelProvider', 'modelId', 'temperature', 'maxTokens',
  'defaultSystemSkillSlugs', 'defaultOrgSkillSlugs',
  'defaultTokenBudget', 'defaultMaxToolCalls', 'executionMode',
  'isPublished', 'status', 'defaultScheduleCron',
];

function escapeField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  // Always quote fields that contain commas, newlines, or double-quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeField).join(',');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

async function exportAgents(outputPath: string) {
  console.log(`\nExporting system agents to: ${outputPath}\n`);

  const rows = await db
    .select()
    .from(systemAgents)
    .where(isNull(systemAgents.deletedAt))
    .orderBy(systemAgents.slug);

  console.log(`Found ${rows.length} agent(s).\n`);

  const lines: string[] = [toCsvRow(HEADERS)];

  for (const agent of rows) {
    lines.push(toCsvRow([
      agent.slug,
      agent.name,
      agent.description,
      agent.icon,
      agent.masterPrompt,
      agent.modelProvider,
      agent.modelId,
      agent.temperature,
      agent.maxTokens,
      JSON.stringify(agent.defaultSystemSkillSlugs ?? []),
      JSON.stringify(agent.defaultOrgSkillSlugs ?? []),
      agent.defaultTokenBudget,
      agent.defaultMaxToolCalls,
      agent.executionMode,
      agent.isPublished,
      agent.status,
      agent.defaultScheduleCron,
    ]));
    console.log(`  [exported] ${agent.slug}`);
  }

  await writeFile(outputPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\nWritten to: ${outputPath}`);
}

const outputPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve('scripts/data/system-agents.csv');

exportAgents(outputPath)
  .catch((err) => {
    console.error('Export failed:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => pool.end());
