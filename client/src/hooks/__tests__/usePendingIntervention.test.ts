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

import { expect, test } from 'vitest';
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
          data: errorCode
            ? { error: { code: errorCode, message: errorCode } }
            : { message: 'server error' },
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
  expect(state.isPending).toBe(false);

  const promise = actions.approve('item-1');
  // Synchronously after call: isPending must be true (set before await)
  expect(state.isPending, 'isPending=true immediately after approve()').toBe(true);

  await promise;

  expect(approvedCalled, 'onApproved was called').toBe(true);
  expect(state.conflict, 'conflict cleared').toBe(false);
  expect(state.error, 'error cleared').toBe(null);
  expect(state.isPending, 'isPending=false after resolution').toBe(false);
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

  expect(state.conflict, 'conflict=true on 409').toBe(true);
  expect(conflictCalled, 'onConflict called').toBe(true);
  expect(approvedCalled, 'onApproved NOT called').toBe(false);
  expect(state.isPending, 'isPending cleared in finally').toBe(false);
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

  expect(state.error, 'error message for 412').toBe('Major acknowledgement required');
  expect(state.isPending, 'isPending cleared').toBe(false);
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

  expect(state.error !== null, 'error is set on 500').toBeTruthy();
  expect(approvedCalled, 'onApproved NOT called').toBe(false);
  expect(state.isPending, 'isPending cleared').toBe(false);
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

  expect(callCount, 'api.post called only once').toBe(1);
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

  await expect(async () => actions.reject('item-6', '')).rejects.toThrow('Comment is required');

  expect(callCount, 'no HTTP call on empty comment').toBe(0);
  expect(state.isPending, 'isPending remains false').toBe(false);
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

  expect(rejectedCalled, 'onRejected was called').toBe(true);
  expect(state.conflict, 'conflict cleared').toBe(false);
  expect(state.error, 'error cleared').toBe(null);
  expect(state.isPending, 'isPending=false after rejection').toBe(false);
});
