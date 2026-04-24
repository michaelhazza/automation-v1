/**
 * Validate every workflow file in server/workflows/ without touching the DB.
 *
 * Spec: tasks/playbooks-spec.md §4.5 (validator runs at every meaningful
 * boundary, including pre-commit / CI). This script is the standalone
 * validator entrypoint — useful as an optional pre-commit hook and as a
 * CI gate that runs before the seeder.
 *
 * Usage:
 *   npm run playbooks:validate
 *
 * Exits 0 if all files validate, 1 otherwise.
 */

import { glob } from 'glob';
import { pathToFileURL } from 'url';
import { validateDefinition } from '../server/lib/workflow/validator.js';
import type { WorkflowDefinition } from '../server/lib/workflow/types.js';

const PLAYBOOKS_GLOB = 'server/workflows/*.workflow.ts';

async function main(): Promise<void> {
  const cwd = process.cwd();
  const files = await glob(PLAYBOOKS_GLOB, { cwd, absolute: true });
  files.sort();

  if (files.length === 0) {
    console.log(`[workflows:validate] no workflow files found at ${PLAYBOOKS_GLOB}`);
    return;
  }

  let failures = 0;
  for (const file of files) {
    const relPath = file.replace(cwd + '/', '');
    process.stdout.write(`[workflows:validate] ${relPath} ... `);
    try {
      const mod = await import(pathToFileURL(file).href);
      const def: WorkflowDefinition | undefined = mod.default;
      if (!def) throw new Error('file has no default export');
      const result = validateDefinition(def);
      if (result.ok) {
        console.log('ok');
      } else {
        failures++;
        console.log('FAILED');
        for (const err of result.errors) {
          console.error(`  - [${err.rule}] ${err.message}`);
        }
      }
    } catch (err) {
      failures++;
      console.log('ERROR');
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures > 0) {
    console.log(`\n[workflows:validate] ${failures} file(s) failed validation`);
    process.exit(1);
  } else {
    console.log(`\n[workflows:validate] all ${files.length} file(s) passed`);
  }
}

main().catch((err) => {
  console.error('[workflows:validate] fatal error:', err);
  process.exit(1);
});
