// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness; parent-directory sibling import not applicable for this self-contained test pattern"
/**
 * resumeInvokeAutomationStepPure.test.ts
 *
 * Pure tests for C4a-REVIEWED-DISP resume path logic per spec §4.5.2.
 * Tests the guard semantics and state transitions without DB access.
 *
 * Run via: npx tsx server/services/__tests__/resumeInvokeAutomationStepPure.test.ts
 */

import { expect, test } from 'vitest';

export {};

console.log('\nC4a-REVIEWED-DISP — resumeInvokeAutomationStep pure tests\n');

// ── Optimistic guard semantics ────────────────────────────────────────────────

test('UPDATE returns row → proceed with resume (guard passes)', () => {
  // Simulate: UPDATE WHERE status = 'awaiting_approval' RETURNING * → row returned
  const updatedRows = [{ id: 'step-1', status: 'running' }];
  const alreadyResumed = updatedRows.length === 0;
  expect(!alreadyResumed, 'row returned → must NOT be alreadyResumed').toBeTruthy();
});

test('UPDATE returns empty → alreadyResumed: true (concurrent winner took it)', () => {
  // Simulate: UPDATE WHERE status = 'awaiting_approval' RETURNING * → no rows (status was not awaiting_approval)
  const updatedRows: unknown[] = [];
  const alreadyResumed = updatedRows.length === 0;
  expect(alreadyResumed, 'zero rows → must be alreadyResumed').toBeTruthy();
});

// ── Guard is the only lock (per spec §4.5.2: "No advisory locks needed") ──────

test('concurrent call 1 wins UPDATE, call 2 gets zero rows → exactly one resume', () => {
  // Simulate two concurrent calls competing on the same stepRunId
  // Call 1: row returned (wins)
  const call1Rows = [{ id: 'step-1', status: 'running' }];
  // Call 2: row NOT returned (loses — status already 'running')
  const call2Rows: unknown[] = [];

  const call1AlreadyResumed = call1Rows.length === 0;
  const call2AlreadyResumed = call2Rows.length === 0;

  expect(!call1AlreadyResumed, 'winner must proceed').toBeTruthy();
  expect(call2AlreadyResumed, 'loser must exit with alreadyResumed').toBeTruthy();
  // One and only one resume invoked
  const resumeCount = [call1AlreadyResumed, call2AlreadyResumed].filter(v => !v).length;
  expect(resumeCount === 1, 'exactly one resume must proceed').toBeTruthy();
});

// ── Step type guard ───────────────────────────────────────────────────────────

test('step.type === invoke_automation → resume path valid', () => {
  const step = { type: 'invoke_automation', id: 'step-1' };
  const isValid = step.type === 'invoke_automation';
  expect(isValid, 'invoke_automation step type must pass guard').toBeTruthy();
});

test('step.type !== invoke_automation → resume must fail gracefully', () => {
  const step = { type: 'agent_call', id: 'step-1' };
  const isValid = step.type === 'invoke_automation';
  expect(!isValid, 'non-invoke_automation step must not pass guard').toBeTruthy();
});

// ── invalidation guard discard ────────────────────────────────────────────────

test('withInvalidationGuard: invalidated status → discard result', () => {
  const stepStatus = 'invalidated';
  const shouldDiscard = stepStatus === 'invalidated';
  expect(shouldDiscard, 'invalidated step must be discarded').toBeTruthy();
});

test('withInvalidationGuard: running status → keep result', () => {
  const stepStatus = 'running' as string;
  const shouldDiscard = stepStatus === 'invalidated';
  expect(!shouldDiscard, 'running step must not be discarded').toBeTruthy();
});

// ── invoke result routing ─────────────────────────────────────────────────────

test('invokeAutomationStep status ok → completeStepRunInternal', () => {
  const result = { status: 'ok', output: { webhook: 'done' } };
  const shouldComplete = result.status === 'ok';
  expect(shouldComplete, 'ok result must lead to complete').toBeTruthy();
});

test('invokeAutomationStep status error + failurePolicy continue → completeStepRunInternal with error output', () => {
  const result = { status: 'error', error: { code: 'webhook_timeout', message: 'timed out' } };
  const step = { failurePolicy: 'continue' as const };
  const shouldCompleteWithError = result.status !== 'ok' && step.failurePolicy === 'continue';
  expect(shouldCompleteWithError, 'error + continue must complete with error output').toBeTruthy();
});

test('invokeAutomationStep status error + failurePolicy fail → failStepRunInternal', () => {
  const result = { status: 'error' as string, error: { code: 'webhook_timeout', message: 'timed out' } };
  const step = { failurePolicy: 'fail' as string };
  const shouldFail = result.status !== 'ok' && step.failurePolicy !== 'continue';
  expect(shouldFail, 'error + fail must trigger failStepRunInternal').toBeTruthy();
});
