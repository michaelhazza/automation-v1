/**
 * usePendingIntervention — unit tests for the pure state-machine core.
 *
 * Tests the `createPendingInterventionActions` factory exported from
 * `usePendingInterventionPure.ts`. The factory is dependency-injected with a
 * mock `api` object so no HTTP ever fires.
 *
 * Runnable via:
 *   npx tsx client/src/hooks/__tests__/usePendingIntervention.test.ts
 *
 * Test matrix (per Task 2.4 spec):
 *   - Approve success → onApproved called, conflict=false, error=null,
 *     isPending cycles true → false.
 *   - Approve 409 ITEM_CONFLICT → conflict=true, onConflict called,
 *     onApproved NOT called.
 *   - Approve 412 MAJOR_ACK_REQUIRED → error='Major acknowledgement required'.
 *   - Approve 500 → error set, onApproved NOT called.
 *   - Double-click guard: second approve while first is pending → no-op.
 *   - Reject with empty comment → synchronous throw, no HTTP call.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createPendingInterventionActions } from '../usePendingInterventionPure.js';

// ---------------------------------------------------------------------------
// Mock API factory helpers
// ---------------------------------------------------------------------------

/** Resolves immediately with a 200 response (success). */
function mockApiSuccess() {
  return {
    post: async (_url: string, _body?: unknown) => ({ status: 200, data: {} }),
  };
}

/**
 * Rejects with an Axios-shaped error for the given HTTP status and optional
 * error code in the response body.
 */
function mockApiError(status: number, errorCode?: string) {
  return {
    post: async (_url: string, _body?: unknown) => {
      const err: Record<string, unknown> = {
        message: `Request failed with status code ${status}`,
        response: {
          status,
          data: errorCode ? { errorCode, message: errorCode } : { message: 'server error' },
        },
      };
      return Promise.reject(err);
    },
  };
}

/**
 * Returns an api mock that hangs forever (never resolves) — used for the
 * double-click guard test.
 */
function mockApiHanging() {
  return {
    post: (_url: string, _body?: unknown): Promise<{ status: number; data: unknown }> =>
      new Promise(() => { /* never resolves */ }),
  };
}

// ---------------------------------------------------------------------------
// State tracker — simulates the useState setters the factory needs
// ---------------------------------------------------------------------------

interface State {
  isPending: boolean;
  conflict: boolean;
  error: string | null;
}

function makeState(init: Partial<State> = {}): {
  state: State;
  setIsPending: (v: boolean) => void;
  setConflict: (v: boolean) => void;
  setError: (v: string | null) => void;
} {
  const state: State = { isPending: false, conflict: false, error: null, ...init };
  return {
    state,
    setIsPending: (v) => { state.isPending = v; },
    setConflict: (v) => { state.conflict = v; },
    setError: (v) => { state.error = v; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('approve success — onApproved called, conflict=false, error=null, isPending cycles true→false', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();
  let approvedCalled = false;

  const actions = createPendingInterventionActions({
    api: mockApiSuccess(),
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: { onApproved: () => { approvedCalled = true; } },
  });

  // Before call: isPending is false
  assert.equal(state.isPending, false);

  const promise = actions.approve('item-1');
  // Synchronously after call: isPending must be true (set before await)
  assert.equal(state.isPending, true, 'isPending=true immediately after approve()');

  await promise;

  assert.equal(approvedCalled, true, 'onApproved was called');
  assert.equal(state.conflict, false, 'conflict cleared');
  assert.equal(state.error, null, 'error cleared');
  assert.equal(state.isPending, false, 'isPending=false after resolution');
});

test('approve 409 ITEM_CONFLICT — conflict=true, onConflict called, onApproved NOT called', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();
  let approvedCalled = false;
  let conflictCalled = false;

  const actions = createPendingInterventionActions({
    api: mockApiError(409, 'ITEM_CONFLICT'),
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: {
      onApproved: () => { approvedCalled = true; },
      onConflict: () => { conflictCalled = true; },
    },
  });

  await actions.approve('item-2');

  assert.equal(state.conflict, true, 'conflict=true on 409');
  assert.equal(conflictCalled, true, 'onConflict called');
  assert.equal(approvedCalled, false, 'onApproved NOT called');
  assert.equal(state.isPending, false, 'isPending cleared in finally');
});

test('approve 412 MAJOR_ACK_REQUIRED — error set to "Major acknowledgement required"', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();

  const actions = createPendingInterventionActions({
    api: mockApiError(412, 'MAJOR_ACK_REQUIRED'),
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: {},
  });

  await actions.approve('item-3');

  assert.equal(state.error, 'Major acknowledgement required', 'error message for 412');
  assert.equal(state.isPending, false, 'isPending cleared');
});

test('approve 500 — error set to message, onApproved NOT called', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();
  let approvedCalled = false;

  const actions = createPendingInterventionActions({
    api: mockApiError(500),
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: { onApproved: () => { approvedCalled = true; } },
  });

  await actions.approve('item-4');

  assert.ok(state.error !== null, 'error is set on 500');
  assert.equal(approvedCalled, false, 'onApproved NOT called');
  assert.equal(state.isPending, false, 'isPending cleared');
});

test('double-click guard — second approve while first is pending is a no-op (no second HTTP call)', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();
  let callCount = 0;

  const api = {
    post: (_url: string, _body?: unknown): Promise<{ status: number; data: unknown }> => {
      callCount++;
      return new Promise((resolve) => {
        // Resolve after a tick so the first call is still "in flight" when the
        // second arrives synchronously.
        setTimeout(() => resolve({ status: 200, data: {} }), 0);
      });
    },
  };

  const actions = createPendingInterventionActions({
    api,
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: {},
  });

  // Kick off first call — sets isPending=true synchronously
  const first = actions.approve('item-5');
  // Second call while first is in flight — should be ignored
  const second = actions.approve('item-5');

  await Promise.all([first, second]);

  assert.equal(callCount, 1, 'api.post called only once');
});

test('reject with empty comment — synchronous throw, no HTTP call', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();
  let callCount = 0;

  const api = {
    post: async (_url: string, _body?: unknown) => {
      callCount++;
      return { status: 200, data: {} };
    },
  };

  const actions = createPendingInterventionActions({
    api,
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: {},
  });

  await assert.rejects(
    async () => actions.reject('item-6', ''),
    (err: unknown) => {
      assert.ok(err instanceof Error, 'thrown value is an Error');
      assert.equal((err as Error).message, 'Comment is required');
      return true;
    },
    'reject("") must throw synchronously',
  );

  assert.equal(callCount, 0, 'no HTTP call on empty comment');
  assert.equal(state.isPending, false, 'isPending remains false');
});

test('reject success — onRejected called, conflict=false, error=null', async () => {
  const { state, setIsPending, setConflict, setError } = makeState();
  let rejectedCalled = false;

  const actions = createPendingInterventionActions({
    api: mockApiSuccess(),
    getIsPending: () => state.isPending,
    setIsPending,
    setConflict,
    setError,
    options: { onRejected: () => { rejectedCalled = true; } },
  });

  await actions.reject('item-7', 'not appropriate');

  assert.equal(rejectedCalled, true, 'onRejected was called');
  assert.equal(state.conflict, false, 'conflict cleared');
  assert.equal(state.error, null, 'error cleared');
  assert.equal(state.isPending, false, 'isPending=false after rejection');
});
