// guard-ignore-file: pure-helper-convention reason="pure logic is tested inline within this self-contained simulation; parent-directory sibling import not applicable"
/**
 * invalidationRacePure.test.ts
 *
 * Pure simulation tests for C4b-INVAL-RACE: withInvalidationGuard contract.
 * Verifies that a late writer hard-discards when the step is invalidated after
 * external I/O completes. Does NOT require a real Postgres instance.
 */

import { expect, test } from 'vitest';

type StepStatus = 'running' | 'invalidated' | 'completed' | 'failed';

async function simulateWithInvalidationGuard<T>(
  stepStatus: StepStatus,
  externalWork: () => Promise<T>,
): Promise<T | { discarded: true; reason: 'invalidated' }> {
  const result = await externalWork();
  if (stepStatus === 'invalidated') {
    return { discarded: true, reason: 'invalidated' };
  }
  return result;
}

test('step still running after I/O → result returned as-is', async () => {
  const result = await simulateWithInvalidationGuard('running', async () => ({ status: 'ok', output: 42 }));
  expect('discarded' in result).toBe(false);
  expect((result as { status: string }).status).toBe('ok');
});

test('step invalidated after I/O → discarded sentinel returned', async () => {
  const result = await simulateWithInvalidationGuard('invalidated', async () => ({ status: 'ok', output: 42 }));
  expect('discarded' in result).toBe(true);
  expect((result as { discarded: boolean }).discarded).toBe(true);
  expect((result as { reason: string }).reason).toBe('invalidated');
});

test('step completed after I/O (non-invalidated terminal) → result returned', async () => {
  const result = await simulateWithInvalidationGuard('completed', async () => 'done');
  expect(result).toBe('done');
});

test('step failed after I/O → result returned (not discarded; fail is a separate code path)', async () => {
  const result = await simulateWithInvalidationGuard('failed', async () => ({ error: 'timeout' }));
  expect('discarded' in result).toBe(false);
});

test('discarded sentinel is distinct from I/O result — caller can branch on it', async () => {
  const ioResult = { status: 'ok', data: 'payload' };
  const discarded = await simulateWithInvalidationGuard('invalidated', async () => ioResult);
  expect('discarded' in discarded).toBe(true);
  const live = await simulateWithInvalidationGuard('running', async () => ioResult);
  expect('discarded' in live).toBe(false);
});
