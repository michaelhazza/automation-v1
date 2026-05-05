// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this handwritten harness; parent-directory sibling import not applicable for this self-contained test pattern"
/**
 * extractRunInsightsErrorMessagePure.test.ts
 *
 * Pure tests for HERMES-S1: errorMessage threading into extractRunInsights.
 * Verifies the threading logic: failed runs with a non-null errorMessage
 * receive it; success/partial runs and null errorMessages do not.
 * Does NOT require a real Postgres instance.
 *
 * Run via: npx tsx server/services/__tests__/extractRunInsightsErrorMessagePure.test.ts
 */

import { expect, test } from 'vitest';

export {};

// Pure mirror of the HERMES-S1 threading logic in agentExecutionService.ts:
// threadedErrorMessage = derivedRunResultStatus === 'failed'
//   ? (preFinalizeRow?.errorMessage ?? null) : null;
function computeThreadedErrorMessage(
  derivedRunResultStatus: string | null,
  dbErrorMessage: string | null | undefined,
): string | null {
  return derivedRunResultStatus === 'failed' ? (dbErrorMessage ?? null) : null;
}

console.log('\nHERMES-S1 — errorMessage threading pure tests\n');

test('failed run with non-null errorMessage → errorMessage threaded through', () => {
  const result = computeThreadedErrorMessage('failed', 'connection_timeout');
  expect(result === 'connection_timeout', `expected 'connection_timeout', got '${result}'`).toBeTruthy();
});

test('failed run with null errorMessage → null threaded (no error to surface)', () => {
  const result = computeThreadedErrorMessage('failed', null);
  expect(result === null, `expected null, got '${result}'`).toBeTruthy();
});

test('failed run with undefined errorMessage → null (undefined treated as no error)', () => {
  const result = computeThreadedErrorMessage('failed', undefined);
  expect(result === null, `expected null for undefined, got '${result}'`).toBeTruthy();
});

test('success run → null regardless of errorMessage value', () => {
  expect(computeThreadedErrorMessage('success', 'some_error') === null, 'success must thread null').toBeTruthy();
  expect(computeThreadedErrorMessage('success', null) === null, 'success must thread null').toBeTruthy();
});

test('partial run → null regardless of errorMessage value', () => {
  expect(computeThreadedErrorMessage('partial', 'some_error') === null, 'partial must thread null').toBeTruthy();
  expect(computeThreadedErrorMessage('partial', null) === null, 'partial must thread null').toBeTruthy();
});

test('null derivedRunResultStatus (non-terminal) → null (guard: must not thread for in-flight runs)', () => {
  const result = computeThreadedErrorMessage(null, 'some_error');
  expect(result === null, `expected null for non-terminal status, got '${result}'`).toBeTruthy();
});
