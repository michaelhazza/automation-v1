/**
 * auditSubaccountRootsPure.test.ts
 *
 * Pure-function tests for auditSubaccountRoots.
 * Run via: npx tsx scripts/__tests__/auditSubaccountRootsPure.test.ts
 */

import { auditSubaccountRoots } from '../auditSubaccountRootsPure.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('all counts ≤ 1 → no violations, summary says OK', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-2', orgId: 'org-1', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-3', orgId: 'org-2', count: 0, agentSlugs: [] },
  ];
  const { violations, summary } = auditSubaccountRoots(rows);
  assert(violations.length === 0, `expected 0 violations, got ${violations.length}`);
  assert(summary.startsWith('OK'), `expected summary to start with 'OK', got: ${summary}`);
});

test('empty input → no violations, summary says OK', () => {
  const { violations, summary } = auditSubaccountRoots([]);
  assert(violations.length === 0, `expected 0 violations, got ${violations.length}`);
  assert(summary.startsWith('OK'), `expected summary to start with 'OK', got: ${summary}`);
});

test('one violation found', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-2', orgId: 'org-1', count: 2, agentSlugs: ['orchestrator', 'portfolio-health-agent'] },
  ];
  const { violations, summary } = auditSubaccountRoots(rows);
  assert(violations.length === 1, `expected 1 violation, got ${violations.length}`);
  assert(violations[0].subaccountId === 'sa-2', `expected violating subaccountId 'sa-2', got '${violations[0].subaccountId}'`);
  assert(summary.includes('VIOLATION'), `expected summary to include 'VIOLATION', got: ${summary}`);
  assert(summary.includes('sa-2'), `expected summary to mention 'sa-2', got: ${summary}`);
});

test('multi-org mixed — only violating entries returned', () => {
  const rows = [
    { subaccountId: 'sa-a', orgId: 'org-1', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-b', orgId: 'org-1', count: 3, agentSlugs: ['orchestrator', 'agent-x', 'agent-y'] },
    { subaccountId: 'sa-c', orgId: 'org-2', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-d', orgId: 'org-2', count: 2, agentSlugs: ['orchestrator', 'ops-agent'] },
  ];
  const { violations, summary } = auditSubaccountRoots(rows);
  assert(violations.length === 2, `expected 2 violations, got ${violations.length}`);
  const ids = violations.map((v) => v.subaccountId).sort();
  assert(ids[0] === 'sa-b', `expected 'sa-b', got '${ids[0]}'`);
  assert(ids[1] === 'sa-d', `expected 'sa-d', got '${ids[1]}'`);
  assert(summary.includes('2 subaccount'), `expected summary to mention '2 subaccount', got: ${summary}`);
});

test('count=0 row excluded even when other violations exist', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 0, agentSlugs: [] },
    { subaccountId: 'sa-2', orgId: 'org-1', count: 2, agentSlugs: ['alpha', 'beta'] },
  ];
  const { violations } = auditSubaccountRoots(rows);
  assert(violations.length === 1, `expected 1 violation, got ${violations.length}`);
  assert(violations[0].subaccountId === 'sa-2', `expected 'sa-2', got '${violations[0].subaccountId}'`);
});

test('violation row contains expected agent slugs', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 2, agentSlugs: ['alpha', 'beta'] },
  ];
  const { violations } = auditSubaccountRoots(rows);
  assert(violations.length === 1, 'expected 1 violation');
  assert(
    violations[0].agentSlugs.includes('alpha') && violations[0].agentSlugs.includes('beta'),
    'expected agentSlugs to contain alpha and beta'
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log(`auditSubaccountRootsPure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
