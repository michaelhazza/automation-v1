/**
 * executeWithRetry + FailureError regression test — runnable via:
 *   npx tsx server/services/middleware/__tests__/errorHandling.failureError.test.ts
 *
 * Covers the P0.2 Slice C contract: when a skill's onFailure directive is
 * 'fail_run', the pure helper throws a FailureError. This error MUST
 * propagate through executeWithRetry unchanged — not be classified and
 * returned as an { error } result — so runAgenticLoop can mark the run as
 * failed rather than feeding the error back to the LLM as a tool result.
 *
 * Without this guarantee, fail_run is silently downgraded to a retryable
 * tool error and the run continues.
 */

import { expect, test } from 'vitest';
import { executeWithRetry } from '../errorHandling.js';
import { FailureError, failure, isFailureError } from '../../../../shared/iee/failure.js';

async function main() {
  console.log('executeWithRetry — FailureError propagation');

  await test('fail_run-sourced FailureError is re-thrown, not classified', async () => {
    const fe = new FailureError(failure('execution_error', 'test: fail_run directive', {
      toolSlug: 'test',
      source: 'onFailure:fail_run',
    }));
    let caught: unknown;
    try {
      await executeWithRetry(async () => { throw fe; }, { delayMs: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught !== undefined, 'executeWithRetry should have thrown').toBeTruthy();
    expect(isFailureError(caught), 'caught error should still be a FailureError').toBeTruthy();
    expect(caught === fe, 'should be the exact same FailureError instance').toBeTruthy();
  });

  await test('ordinary (non-fail_run) FailureError is classified, not re-thrown', async () => {
    // Skills throw FailureError for normal tool-level problems (missing
    // config, bad input, etc.). Those must NOT abort the whole run — they
    // should go through classifyError and return as { error } for the LLM.
    const fe = new FailureError(failure('auth_failure', 'slack_not_configured', { toolSlug: 'send_to_slack' }));
    const result = await executeWithRetry(async () => { throw fe; }, { delayMs: 0 });
    expect('error' in result, 'ordinary FailureError should be classified, not thrown').toBeTruthy();
  });

  await test('FailureError propagates on first attempt without retry delay', async () => {
    const fe = new FailureError(failure('execution_error', 'first-attempt fail_run', { source: 'onFailure:fail_run' }));
    let attempts = 0;
    let caught: unknown;
    const start = Date.now();
    try {
      await executeWithRetry(async () => { attempts++; throw fe; }, { delayMs: 5000 });
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - start;
    expect(isFailureError(caught), 'should propagate as FailureError').toBeTruthy();
    expect(attempts === 1, `should not retry — got ${attempts} attempts`).toBeTruthy();
    expect(elapsed < 1000, `should not wait for retry delay — took ${elapsed}ms`).toBeTruthy();
  });

  await test('non-FailureError still goes through classify + retry path', async () => {
    let attempts = 0;
    const result = await executeWithRetry(
      async () => { attempts++; throw new Error('boom'); },
      { delayMs: 0 },
    );
    expect('error' in result, 'plain Error should be classified, not thrown').toBeTruthy();
    expect(attempts >= 1, 'handler should have been called').toBeTruthy();
  });
}

main().catch((err) => {
  console.error(err);
});
