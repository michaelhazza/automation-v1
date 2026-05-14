/**
 * auditSubaccountRootsPure.test.ts
 *
 * Pure-function tests for auditSubaccountRoots.
 * Run via: npx tsx scripts/__tests__/auditSubaccountRootsPure.test.ts
 */

import { expect, test } from 'vitest';
import { auditSubaccountRoots } from '../auditSubaccountRootsPure.js';

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
  expect(violations.length === 0, `expected 0 violations, got ${violations.length}`).toBeTruthy();
  expect(summary.startsWith('OK'), `expected summary to start with 'OK', got: ${summary}`).toBeTruthy();
});

test('empty input → no violations, summary says OK', () => {
  const { violations, summary } = auditSubaccountRoots([]);
  expect(violations.length === 0, `expected 0 violations, got ${violations.length}`).toBeTruthy();
  expect(summary.startsWith('OK'), `expected summary to start with 'OK', got: ${summary}`).toBeTruthy();
});

test('one violation found', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-2', orgId: 'org-1', count: 2, agentSlugs: ['orchestrator', 'portfolio-health-agent'] },
  ];
  const { violations, summary } = auditSubaccountRoots(rows);
  expect(violations.length === 1, `expected 1 violation, got ${violations.length}`).toBeTruthy();
  expect(violations[0].subaccountId === 'sa-2', `expected violating subaccountId 'sa-2', got '${violations[0].subaccountId}'`).toBeTruthy();
  expect(summary.includes('VIOLATION'), `expected summary to include 'VIOLATION', got: ${summary}`).toBeTruthy();
  expect(summary.includes('sa-2'), `expected summary to mention 'sa-2', got: ${summary}`).toBeTruthy();
});

test('multi-org mixed — only violating entries returned', () => {
  const rows = [
    { subaccountId: 'sa-a', orgId: 'org-1', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-b', orgId: 'org-1', count: 3, agentSlugs: ['orchestrator', 'agent-x', 'agent-y'] },
    { subaccountId: 'sa-c', orgId: 'org-2', count: 1, agentSlugs: ['orchestrator'] },
    { subaccountId: 'sa-d', orgId: 'org-2', count: 2, agentSlugs: ['orchestrator', 'ops-agent'] },
  ];
  const { violations, summary } = auditSubaccountRoots(rows);
  expect(violations.length === 2, `expected 2 violations, got ${violations.length}`).toBeTruthy();
  const ids = violations.map((v) => v.subaccountId).sort();
  expect(ids[0] === 'sa-b', `expected 'sa-b', got '${ids[0]}'`).toBeTruthy();
  expect(ids[1] === 'sa-d', `expected 'sa-d', got '${ids[1]}'`).toBeTruthy();
  expect(summary.includes('2 subaccount'), `expected summary to mention '2 subaccount', got: ${summary}`).toBeTruthy();
});

test('count=0 row excluded even when other violations exist', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 0, agentSlugs: [] },
    { subaccountId: 'sa-2', orgId: 'org-1', count: 2, agentSlugs: ['alpha', 'beta'] },
  ];
  const { violations } = auditSubaccountRoots(rows);
  expect(violations.length === 1, `expected 1 violation, got ${violations.length}`).toBeTruthy();
  expect(violations[0].subaccountId === 'sa-2', `expected 'sa-2', got '${violations[0].subaccountId}'`).toBeTruthy();
});

test('violation row contains expected agent slugs', () => {
  const rows = [
    { subaccountId: 'sa-1', orgId: 'org-1', count: 2, agentSlugs: ['alpha', 'beta'] },
  ];
  const { violations } = auditSubaccountRoots(rows);
  expect(violations.length === 1, 'expected 1 violation').toBeTruthy();
  expect(violations[0].agentSlugs.includes('alpha') && violations[0].agentSlugs.includes('beta'), 'expected agentSlugs to contain alpha and beta').toBeTruthy();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');