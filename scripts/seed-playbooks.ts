/**
 * Seed system playbook templates from server/playbooks/*.playbook.ts files.
 *
 * Spec: tasks/playbooks-spec.md §10.3.
 *
 * Discovers every `*.playbook.ts` file in server/playbooks/, imports the
 * default export, validates it via playbookTemplateService.validateDefinition,
 * and upserts into the database. Idempotent — re-running the seeder is a
 * no-op for templates whose `version` field hasn't changed.
 *
 * Run as part of the deploy pipeline immediately after migrations:
 *   npm run migrate && npm run playbooks:seed
 *
 * On any validation failure the seeder exits non-zero and prints the
 * failing playbook + the validation error list. Deploy CI gates the
 * deploy on this script's exit code.
 */

import 'dotenv/config';
import { glob } from 'glob';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { playbookTemplateService } from '../server/services/playbookTemplateService.js';
import type { PlaybookDefinition } from '../server/lib/playbook/types.js';

const PLAYBOOKS_GLOB = 'server/playbooks/*.playbook.ts';

interface SeedSummary {
  created: string[];
  updated: string[];
  skipped: string[];
  failed: { file: string; error: unknown }[];
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  const files = await glob(PLAYBOOKS_GLOB, { cwd, absolute: true });
  files.sort();

  if (files.length === 0) {
    console.log(`[playbooks:seed] no playbook files found at ${PLAYBOOKS_GLOB} — nothing to do`);
    return;
  }

  console.log(`[playbooks:seed] discovered ${files.length} playbook file(s):`);
  for (const f of files) {
    console.log(`  - ${f.replace(cwd + '/', '')}`);
  }

  const summary: SeedSummary = { created: [], updated: [], skipped: [], failed: [] };

  for (const file of files) {
    const relPath = file.replace(cwd + '/', '');
    process.stdout.write(`[playbooks:seed] ${relPath} ... `);
    try {
      const mod = await import(pathToFileURL(file).href);
      const def: PlaybookDefinition | undefined = mod.default;
      if (!def) {
        throw new Error(`file has no default export`);
      }
      const outcome = await playbookTemplateService.upsertSystemTemplate(def);
      summary[outcome].push(def.slug);
      console.log(outcome);
    } catch (err) {
      summary.failed.push({ file: relPath, error: err });
      console.log('FAILED');
      const e = err as { message?: string; details?: unknown };
      console.error(`  error: ${e.message ?? String(err)}`);
      if (e.details) console.error('  details:', JSON.stringify(e.details, null, 2));
    }
  }

  console.log('');
  console.log(`[playbooks:seed] summary:`);
  console.log(`  created: ${summary.created.length} (${summary.created.join(', ') || '-'})`);
  console.log(`  updated: ${summary.updated.length} (${summary.updated.join(', ') || '-'})`);
  console.log(`  skipped: ${summary.skipped.length} (${summary.skipped.join(', ') || '-'})`);
  console.log(`  failed:  ${summary.failed.length}`);

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[playbooks:seed] fatal error:', err);
  process.exit(1);
});
