/**
 * Unified company import script.
 *
 * Reads a Paperclip-compatible company folder (COMPANY.md + agents/{slug}/AGENTS.md + ...)
 * and imports it into one of two targets:
 *
 *   --target system-agents   → upserts into system_agents table (platform-level agent defs)
 *   --target team-template   → creates a system_hierarchy_template (importable by orgs)
 *
 * Usage:
 *   npx tsx scripts/import-company.ts companies/automation-os/ --target system-agents
 *   npx tsx scripts/import-company.ts companies/automation-os/ --target team-template
 *
 * Both targets use the same source format. Safe to re-run (upserts on slug).
 */

import 'dotenv/config';
import { resolve } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { systemAgents } from '../server/db/schema/index.js';
import {
  parseCompanyFolder,
  toSystemAgentRows,
  toPaperclipManifest,
} from './lib/companyParser.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const companyPath = args.find(a => !a.startsWith('--'));
const targetFlag = args.find(a => a.startsWith('--target='))?.split('=')[1]
  ?? args[args.indexOf('--target') + 1];

if (!companyPath) {
  console.error('Usage: npx tsx scripts/import-company.ts <company-folder> --target <system-agents|team-template>');
  process.exit(1);
}

if (!targetFlag || !['system-agents', 'team-template'].includes(targetFlag)) {
  console.error('Error: --target must be "system-agents" or "team-template"');
  console.error('  --target system-agents   Import agents into system_agents table');
  console.error('  --target team-template   Import as a system hierarchy template');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ---------------------------------------------------------------------------
// Target: system-agents
// Upserts each agent into the system_agents table.
// ---------------------------------------------------------------------------

async function importToSystemAgents(companyDir: string) {
  console.log('\n  Parsing company folder...');
  const parsed = await parseCompanyFolder(resolve(companyDir));

  console.log(`  Company: ${parsed.manifest.name} (v${parsed.manifest.version})`);
  console.log(`  Agents:  ${parsed.agents.length}`);
  console.log(`  Teams:   ${parsed.teams.length}`);
  console.log(`  Skills:  ${parsed.skills.length}`);

  const rows = toSystemAgentRows(parsed);

  console.log('\n  Importing into system_agents...\n');

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
      await db
        .update(systemAgents)
        .set(values)
        .where(eq(systemAgents.slug, row.slug));
      console.log(`  [updated] ${row.slug} (${existing.id})`);
    } else {
      const [created] = await db
        .insert(systemAgents)
        .values({ ...values, createdAt: new Date() })
        .returning({ id: systemAgents.id });
      console.log(`  [created] ${row.slug} (${created.id})`);
    }
  }

  console.log(`\n  Done. ${rows.length} system agent(s) imported.`);
}

// ---------------------------------------------------------------------------
// Target: team-template
// Creates a system hierarchy template via the existing importPaperclip pipeline.
// We dynamically import the service to avoid loading the full app at script time.
// ---------------------------------------------------------------------------

async function importToTeamTemplate(companyDir: string) {
  console.log('\n  Parsing company folder...');
  const parsed = await parseCompanyFolder(resolve(companyDir));

  console.log(`  Company: ${parsed.manifest.name} (v${parsed.manifest.version})`);
  console.log(`  Agents:  ${parsed.agents.length}`);
  console.log(`  Teams:   ${parsed.teams.length}`);
  console.log(`  Skills:  ${parsed.skills.length}`);

  const manifest = toPaperclipManifest(parsed);

  console.log('\n  Converting to Paperclip manifest and importing as system template...\n');

  // Import the system template service dynamically to avoid full app bootstrap
  // This uses the same importPaperclip method the API routes use
  const { systemTemplateService } = await import('../server/services/systemTemplateService.js');

  const result = await systemTemplateService.importPaperclip({
    name: parsed.manifest.name,
    manifest,
  });

  console.log(`  Template created: ${result.template.name} (${result.template.id})`);
  console.log(`  Slots: ${result.slotsCreated}`);
  console.log(`  Matched system agents: ${result.matchedSystemAgent}`);
  console.log(`  Blueprints: ${result.blueprintCount}`);
  if (result.blueprintsRequiringPrompt > 0) {
    console.log(`  ⚠ Blueprints needing prompts: ${result.blueprintsRequiringPrompt}`);
  }
  if (result.slugsRenamed.length > 0) {
    console.log(`  Slugs renamed: ${result.slugsRenamed.map((r: { original: string; final: string }) => `${r.original} → ${r.final}`).join(', ')}`);
  }

  console.log('\n  Done. Template ready for org import.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nImport company: ${companyPath}`);
  console.log(`Target: ${targetFlag}\n`);

  if (targetFlag === 'system-agents') {
    await importToSystemAgents(companyPath!);
  } else {
    await importToTeamTemplate(companyPath!);
  }
}

main()
  .catch((err) => {
    console.error('\nImport failed:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => pool.end());
