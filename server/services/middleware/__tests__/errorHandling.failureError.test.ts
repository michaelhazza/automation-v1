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

import { executeWithRetry } from '../errorHandling.js';
import { FailureError, failure, isFailureError } from '../../../../shared/iee/failure.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

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
    assert(caught !== undefined, 'executeWithRetry should have thrown');
    assert(isFailureError(caught), 'caught error should still be a FailureError');
    assert(caught === fe, 'should be the exact same FailureError instance');
  });

  await test('ordinary (non-fail_run) FailureError is classified, not re-thrown', async () => {
    // Skills throw FailureError for normal tool-level problems (missing
    // config, bad input, etc.). Those must NOT abort the whole run — they
    // should go through classifyError and return as { error } for the LLM.
    const fe = new FailureError(failure('auth_failure', 'slack_not_configured', { toolSlug: 'send_to_slack' }));
    const result = await executeWithRetry(async () => { throw fe; }, { delayMs: 0 });
    assert('error' in result, 'ordinary FailureError should be classified, not thrown');
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
    assert(isFailureError(caught), 'should propagate as FailureError');
    assert(attempts === 1, `should not retry — got ${attempts} attempts`);
    assert(elapsed < 1000, `should not wait for retry delay — took ${elapsed}ms`);
  });

  await test('non-FailureError still goes through classify + retry path', async () => {
    let attempts = 0;
    const result = await executeWithRetry(
      async () => { attempts++; throw new Error('boom'); },
      { delayMs: 0 },
    );
    assert('error' in result, 'plain Error should be classified, not thrown');
    assert(attempts >= 1, 'handler should have been called');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
