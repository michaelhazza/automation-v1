// guard-ignore-file: pure-helper-convention reason="env preamble must run before module-level env parse fires; dynamic import used after env setup"
/**
 * ieeDevBackend fail-closed guard — unit test
 * (iee-worker-retirement spec §4 Chunk 2).
 *
 * Verifies that ieeDevBackend.dispatch() refuses without the explicit
 * IEE_DEV_TASK_CONSUMER=enabled env gate, returning a typed
 * `iee_dev_backend_retired` FailureError. This is the safety mechanism that
 * prevents a forgotten code path from silently enqueueing to a dead queue
 * after the worker process is removed.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';

export {};

import 'dotenv/config';
process.env.DATABASE_URL ??= 'postgres://test-placeholder/unused';
process.env.JWT_SECRET ??= 'test-placeholder-jwt-secret-unused';
process.env.EMAIL_FROM ??= 'test-placeholder@example.com';

const { ieeDevBackend } = await import('../ieeDevBackend.js');
const { isFailureError } = await import('../../../../shared/iee/failure.js');

const ORIGINAL_ENV = process.env.IEE_DEV_TASK_CONSUMER;

beforeEach(() => {
  delete process.env.IEE_DEV_TASK_CONSUMER;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.IEE_DEV_TASK_CONSUMER;
  } else {
    process.env.IEE_DEV_TASK_CONSUMER = ORIGINAL_ENV;
  }
});

function makeDispatchInput() {
  return {
    runId: '00000000-0000-0000-0000-000000000aaa',
    organisationId: '00000000-0000-0000-0000-000000000bbb',
    subaccountId: null,
    agentId: '00000000-0000-0000-0000-000000000ccc',
    promptAssembly: {
      systemPrompt: 'unused',
      memoryBlocks: [],
      capabilityCards: [],
    },
    tokenBudget: { inputCap: 0, outputCap: 0 },
    maxToolCalls: 0,
    timeoutMs: 0,
    backendOptions: {
      backendId: 'iee_dev',
      ieeTask: { type: 'dev', goal: 'test' },
    },
  } as unknown as Parameters<typeof ieeDevBackend.dispatch>[0];
}

test('dispatch() refuses when IEE_DEV_TASK_CONSUMER is unset', async () => {
  const input = makeDispatchInput();
  let caught: unknown;
  try {
    await ieeDevBackend.dispatch(input);
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeDefined();
  expect(isFailureError(caught)).toBe(true);
  if (isFailureError(caught)) {
    expect(caught.failure.failureReason).toBe('iee_dev_backend_retired');
    expect(caught.failure.failureDetail).toBe('no consumer in this deployment');
  }
});

test('dispatch() refuses when IEE_DEV_TASK_CONSUMER is any value other than "enabled"', async () => {
  process.env.IEE_DEV_TASK_CONSUMER = 'true';
  const input = makeDispatchInput();
  let caught: unknown;
  try {
    await ieeDevBackend.dispatch(input);
  } catch (err) {
    caught = err;
  }

  expect(isFailureError(caught)).toBe(true);
  if (isFailureError(caught)) {
    expect(caught.failure.failureReason).toBe('iee_dev_backend_retired');
  }
});

test('dispatch() passes the retirement guard when IEE_DEV_TASK_CONSUMER === "enabled" (downstream throw is fine; assertion is "not iee_dev_backend_retired")', async () => {
  process.env.IEE_DEV_TASK_CONSUMER = 'enabled';
  const input = makeDispatchInput();
  let caught: unknown;
  try {
    await ieeDevBackend.dispatch(input);
  } catch (err) {
    caught = err;
  }

  // The test fixture does NOT provide a real DB, registry, or sandbox, so
  // a downstream throw is expected. The only thing this test guards is
  // that the retirement guard at the top of dispatch() does NOT trigger
  // when the env gate is set. A typo like `=== 'enable'` would surface
  // the iee_dev_backend_retired failure here.
  if (isFailureError(caught)) {
    expect(caught.failure.failureReason).not.toBe('iee_dev_backend_retired');
  }
});
