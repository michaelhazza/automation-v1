/**
 * ieeDevBackend — delegated dev-task adapter.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (IEE rows), § 11 (IEE adapter rows), § 13.1.1, § 14 Chunk 3.
 *
 * The dev variant of the IEE adapter pair. Shares storage (`iee_runs`),
 * event queue (`iee-run-completed`), and dispatch / lifecycle plumbing with
 * `ieeBrowserBackend`; the only per-adapter delta is the `iee_runs.type`
 * discriminator (`'dev'` here vs `'browser'` in the sibling). Common code
 * lives in `_ieeShared.ts`.
 *
 * `sandboxRequirement: 'code_execution'` is declared but not enforced — the
 * Sandbox executor primitive is a future spec (Spec B). Declaring it now
 * keeps the registry validation honest without blocking V1 registration.
 */

import {
  ieeRunCompletedPayloadSchema,
  IEE_COMPLETED_QUEUE,
  IEE_TERMINAL_STATE_TABLE,
  ieeDispatch,
  ieeLoadTerminalState,
  ieeFinalise,
  ieeReconcile,
  ieeCancel,
} from './_ieeShared.js';

import type { ExecutionBackend } from './types.js';

export const ieeDevBackend: ExecutionBackend = {
  // Identity
  id: 'iee_dev',
  capabilities: ['delegated', 'code_execution', 'cancellation'],
  costModel: 'per_token',
  sandboxRequirement: 'code_execution',

  // Delegated-lifecycle slots
  completedEventQueue: IEE_COMPLETED_QUEUE,
  terminalStateTable: IEE_TERMINAL_STATE_TABLE,
  completedEventPayload: ieeRunCompletedPayloadSchema,

  async dispatch(input) {
    return ieeDispatch({ type: 'dev', adapterId: 'iee_dev', input });
  },

  async loadTerminalState(tx, backendTaskId) {
    return ieeLoadTerminalState(tx, backendTaskId);
  },

  async finalise(input) {
    return ieeFinalise(input);
  },

  async reconcile() {
    const { finaliseAgentRunFromBackend } = await import('../agentRunFinalizationService.js');
    return ieeReconcile({
      type: 'dev',
      adapterId: 'iee_dev',
      finaliseAgentRunFromBackend,
    });
  },

  async cancel(input) {
    return ieeCancel(input);
  },
};
