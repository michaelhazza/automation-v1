/**
 * sandbox-isolation-classification-dry-run.ts
 *
 * One-shot build-time script. Spec B §18.4, plan C13.
 *
 * Re-classifies every DevTaskPayload variant the iee_dev adapter has
 * historically dispatched and asserts each classification matches the
 * manual expectation derived from the spec §7.2 table.
 *
 * Output: tasks/builds/sandbox-isolation/migration-dry-run.md
 *
 * Run once during the C13 chunk:
 *   npx tsx scripts/migrations/sandbox-isolation-classification-dry-run.ts
 *
 * Not runtime code; not a CI gate. The C14 CI gate
 * (verify-sandbox-classification.sh) is the durable enforcement.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pure import — no DB, no network. Direct path import to avoid needing
// a full build or tsconfig.json path alias resolution.
import { classifyExecutionClass } from '../../server/services/executionBackends/ieeDevBackendPure.js';
import type { ExecutionClass } from '../../server/services/executionBackends/ieeDevBackendPure.js';
import type { DevTaskPayload } from '../../shared/iee/jobPayload.js';

// ---------------------------------------------------------------------------
// Task variant catalogue
//
// All task types the iee_dev adapter has historically dispatched, sourced
// from the DevTaskPayload schema in shared/iee/jobPayload.ts and cross-
// referenced with agent configurations and workflow specs.
// ---------------------------------------------------------------------------

interface TaskVariant {
  name: string;
  task: DevTaskPayload;
  expectedClass: ExecutionClass;
  rationale: string;
}

const TASK_VARIANTS: TaskVariant[] = [
  {
    name: 'goal-only (minimal)',
    task: { type: 'dev', goal: 'Summarise the project codebase' },
    expectedClass: 'worker_trusted',
    rationale:
      'Dev Agent exploration task — trusted repo operation with no customer-derived code or LLM-emitted scripts.',
  },
  {
    name: 'repo checkout + branch',
    task: {
      type: 'dev',
      goal: 'Run tests on the feature branch',
      repoUrl: 'https://github.com/org/repo.git',
      branch: 'feature/new-feature',
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Controlled repo checkout — git operations against a known branch. No customer input in the execution path.',
  },
  {
    name: 'commands only',
    task: {
      type: 'dev',
      goal: 'Build and test the project',
      commands: ['npm install', 'npm run build', 'npm run test:unit'],
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Pre-authored build/test commands against the internal repo. Commands originate from the agent definition, not from customer-supplied input.',
  },
  {
    name: 'repo + branch + commands',
    task: {
      type: 'dev',
      goal: 'Checkout and validate the release branch',
      repoUrl: 'https://github.com/org/synthetos.git',
      branch: 'release/v2.0',
      commands: ['npm ci', 'npm run build:server', 'npm run build:client', 'npm run typecheck'],
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Full dev pipeline: checkout + build + typecheck. All commands are internal and predefined.',
  },
  {
    name: 'repo + checks (all quality gates)',
    task: {
      type: 'dev',
      goal: 'Implement feature and validate quality gates',
      repoUrl: 'https://github.com/org/synthetos.git',
      branch: 'main',
      checks: {
        lintCommand: 'npm run lint',
        typecheckCommand: 'npm run typecheck',
        testCommand: 'npx vitest run',
      },
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Dev Agent quality check configuration — lint, typecheck, test are all internal CI commands, not derived from customer input.',
  },
  {
    name: 'checks only (lint)',
    task: {
      type: 'dev',
      goal: 'Lint the repository',
      checks: { lintCommand: 'npm run lint' },
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Single-phase lint check against the internal repository.',
  },
  {
    name: 'checks only (typecheck)',
    task: {
      type: 'dev',
      goal: 'Typecheck the repository',
      checks: { typecheckCommand: 'npm run typecheck' },
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Single-phase typecheck against the internal repository.',
  },
  {
    name: 'checks only (test)',
    task: {
      type: 'dev',
      goal: 'Run all unit tests',
      checks: { testCommand: 'npx vitest run' },
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Single-phase test run against the internal repository.',
  },
  {
    name: 'fully specified (all optional fields)',
    task: {
      type: 'dev',
      goal: 'Full dev workflow: checkout, build, test, and validate',
      repoUrl: 'https://github.com/org/synthetos.git',
      branch: 'claude/new-feature',
      commands: ['npm ci', 'npm run build:server'],
      checks: {
        lintCommand: 'npm run lint',
        typecheckCommand: 'npm run typecheck',
        testCommand: 'npx vitest run server/services',
      },
    },
    expectedClass: 'worker_trusted',
    rationale:
      'Maximum-field dev task. No customer-derived input in any field; all commands are internal.',
  },
];

// ---------------------------------------------------------------------------
// Run classification and assert
// ---------------------------------------------------------------------------

interface AssertionResult {
  name: string;
  expectedClass: ExecutionClass;
  actualClass: ExecutionClass;
  rationale: string;
  passed: boolean;
}

const results: AssertionResult[] = [];
let failCount = 0;

for (const variant of TASK_VARIANTS) {
  const actualClass = classifyExecutionClass(variant.task);
  const passed = actualClass === variant.expectedClass;
  if (!passed) failCount++;
  results.push({
    name: variant.name,
    expectedClass: variant.expectedClass,
    actualClass,
    rationale: variant.rationale,
    passed,
  });
}

// ---------------------------------------------------------------------------
// Write markdown output
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

const passCount = results.filter((r) => r.passed).length;
const overallStatus = failCount === 0 ? 'PASS' : 'FAIL';

const rows = results
  .map((r) => {
    const status = r.passed ? 'PASS' : `FAIL (expected ${r.expectedClass}, got ${r.actualClass})`;
    return `| ${r.name} | ${r.actualClass} | ${status} | ${r.rationale} |`;
  })
  .join('\n');

const markdown = `# Sandbox Isolation — Classification Dry-Run

**Script:** \`scripts/migrations/sandbox-isolation-classification-dry-run.ts\`
**Spec:** Spec B §18.4, plan C13
**Run date:** ${now}
**Overall status:** ${overallStatus} (${passCount}/${results.length} passed)

## Classification table

| Task type | Class | Status | Rationale |
|---|---|---|---|
${rows}

## Summary

All V1 \`DevTaskPayload\` variants classify as \`worker_trusted\` — this is
correct per spec §7.2. The Dev Agent's current task universe consists entirely
of trusted repo/dev operations (Tier 5): git checkout, build commands, test
runs, and quality checks against internal repositories.

No current variant dispatches customer-derived code or LLM-emitted scripts
over customer data. Future task variants that carry such data will:
1. Introduce an explicit discriminator in the payload schema.
2. Update \`classifyExecutionClass()\` to return \`'sandbox'\` for those variants.
3. Be caught by the \`verify-sandbox-classification\` CI gate (C14).

## Spec §7.2 mapping

| Spec class | Examples | Runs where | V1 DevTaskPayload? |
|---|---|---|---|
| Customer-uploaded data parsing | CSV, Excel, PDF | Sandbox | No |
| LLM-emitted scripts over customer data | Python/JS transforms | Sandbox | No |
| Customer-derived transformation logic | Any customer/LLM source | Sandbox | No |
| Deterministic internal orchestration | Routing, metadata, harvest | Worker | No |
| Trusted repo / dev operations | Controlled repo commands | Worker (Tier 5) | **Yes — all current variants** |
`;

const outputPath = resolve(process.cwd(), 'tasks/builds/sandbox-isolation/migration-dry-run.md');
writeFileSync(outputPath, markdown, 'utf8');

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

console.log(`sandbox-isolation-classification-dry-run: ${overallStatus}`);
console.log(`  ${passCount}/${results.length} variants passed`);
console.log(`  Output written to: ${outputPath}`);

if (failCount > 0) {
  console.error('FAILURES:');
  for (const r of results.filter((r) => !r.passed)) {
    console.error(`  ${r.name}: expected ${r.expectedClass}, got ${r.actualClass}`);
  }
  process.exit(1);
}

process.exit(0);
