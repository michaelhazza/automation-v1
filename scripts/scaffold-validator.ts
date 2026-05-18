/**
 * scaffold-validator.ts
 *
 * CLI for npm run scorecard:new-validator <slug>
 *
 * Generates three files:
 *   server/lib/scorecardValidators/<slug>.ts
 *   server/lib/scorecardValidators/<slug>.test.ts
 *   server/lib/scorecardValidators/<slug>.md
 *
 * And appends an import + validator reference to registry.ts at the sentinel
 * comment markers.
 *
 * Usage: tsx scripts/scaffold-validator.ts <slug>
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALIDATORS_DIR = path.join(__dirname, '..', 'server', 'lib', 'scorecardValidators');
const REGISTRY_PATH = path.join(VALIDATORS_DIR, 'registry.ts');

function validatorTemplate(slug: string): string {
  return `import type { Validator, ValidatorContext, ValidatorResult } from './types.js';

export const validator: Validator = {
  slug: '${slug}',
  version: '1.0.0',
  kind: 'deterministic',
  parameterSchema: [],
  async evaluate(ctx: ValidatorContext): Promise<ValidatorResult> {
    // TODO: implement ${slug} logic
    void ctx;
    return {
      passed: true,
      score: 1.0,
      reasoning: '${slug}: not yet implemented.',
    };
  },
};
`;
}

function testTemplate(slug: string): string {
  return `import { describe, test, expect } from 'vitest';
import { validator } from '../${slug}.js';
import type { ValidatorContext } from '../types.js';

function makeCtx(runOutput: string): ValidatorContext {
  return {
    runOutput,
    runMetadata: {
      skillSlug: 'test-skill',
      agentId: 'agent-1',
      subaccountId: 'sub-1',
      runId: 'run-1',
      invokedSkillSlugs: [],
    },
    parameters: {},
  };
}

describe('${slug} validator', () => {
  test('passing case', async () => {
    const result = await validator.evaluate(makeCtx('TODO: passing input'));
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  test('failing case', async () => {
    const result = await validator.evaluate(makeCtx('TODO: failing input'));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  test('edge case', async () => {
    const result = await validator.evaluate(makeCtx('TODO: edge case input'));
    // TODO: assert expected behaviour for the known edge / gaming case
    expect(result).toBeDefined();
  });
});
`;
}

function docTemplate(slug: string): string {
  return `# ${slug.replace(/_/g, ' ')}

TODO: brief description of what this validator checks.

## What it checks

TODO

## What it does not check

TODO

## Known false positives

TODO

## Known false negatives

TODO

## Gaming attempts this validator defeats

TODO

## Scoring formula

Binary: 1.0 for pass, 0.0 for fail.

## Evidence redaction policy

TODO: describe what is stored in evidence_json and confirm no raw tenant data is included.
`;
}

function appendToRegistry(slug: string): void {
  const source = readFileSync(REGISTRY_PATH, 'utf-8');

  const importSentinel = '// CHUNK_4_IMPORTS_SENTINEL';
  const validatorSentinel = '// CHUNK_4_VALIDATORS_SENTINEL';

  if (!source.includes(importSentinel) || !source.includes(validatorSentinel)) {
    console.error(`[scaffold-validator] registry.ts is missing sentinel markers. Cannot append automatically.`);
    process.exit(1);
  }

  const withImport = source.replace(
    importSentinel,
    `import { validator as ${toCamelCase(slug)} } from './${slug}.js';\n${importSentinel}`,
  );

  const withValidator = withImport.replace(
    validatorSentinel,
    `${toCamelCase(slug)},\n  ${validatorSentinel}`,
  );

  writeFileSync(REGISTRY_PATH, withValidator, 'utf-8');
}

function toCamelCase(slug: string): string {
  return slug.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function main(): void {
  const slug = process.argv[2];

  if (!slug) {
    console.error('Usage: npm run scorecard:new-validator <slug>');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
    console.error(`[scaffold-validator] Invalid slug "${slug}". Use lowercase letters, digits, and underscores only.`);
    process.exit(1);
  }

  const validatorPath = path.join(VALIDATORS_DIR, `${slug}.ts`);
  const testPath = path.join(VALIDATORS_DIR, '__tests__', `${slug}.test.ts`);
  const docPath = path.join(VALIDATORS_DIR, `${slug}.md`);

  if (existsSync(validatorPath)) {
    console.error(`[scaffold-validator] ${validatorPath} already exists.`);
    process.exit(1);
  }

  writeFileSync(validatorPath, validatorTemplate(slug), 'utf-8');
  writeFileSync(testPath, testTemplate(slug), 'utf-8');
  writeFileSync(docPath, docTemplate(slug), 'utf-8');
  appendToRegistry(slug);

  console.log(`[scaffold-validator] Created:`);
  console.log(`  ${validatorPath}`);
  console.log(`  ${testPath}`);
  console.log(`  ${docPath}`);
  console.log(`  registry.ts updated`);
}

main();
