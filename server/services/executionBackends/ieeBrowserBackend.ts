/**
 * ieeBrowserBackend — delegated browser-task adapter.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (IEE rows), § 11 (IEE adapter rows), § 13.1.1, § 14 Chunk 3.
 *
 * The browser variant of the IEE adapter pair. Shares storage (`iee_runs`),
 * event queue (`iee-run-completed`), and dispatch / lifecycle plumbing with
 * `ieeDevBackend`; the only per-adapter delta is the `iee_runs.type`
 * discriminator (`'browser'` here vs `'dev'` in the sibling). Common code
 * lives in `_ieeShared.ts`.
 *
 * Cycle prevention — does NOT import from `agentExecutionService.ts`. The
 * dispatch path's `enqueueIEETask` and the cancel path's `cancelIeeRun` are
 * late-imported inside `_ieeShared.ts` to keep the adapter module side-effect
 * free at load time.
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

export const ieeBrowserBackend: ExecutionBackend = {
  // Identity
  id: 'iee_browser',
  capabilities: ['delegated', 'browser_automation', 'cancellation'],
  costModel: 'per_token',
  sandboxRequirement: 'browser',

  // Delegated-lifecycle slots
  completedEventQueue: IEE_COMPLETED_QUEUE,
  terminalStateTable: IEE_TERMINAL_STATE_TABLE,
  completedEventPayload: ieeRunCompletedPayloadSchema,

  async dispatch(input) {
    return ieeDispatch({ type: 'browser', adapterId: 'iee_browser', input });
  },

  async loadTerminalState(tx, backendTaskId) {
    return ieeLoadTerminalState(tx, backendTaskId);
  },

  async finalise(input) {
    return ieeFinalise(input);
  },

  async reconcile() {
    // Late-import the orchestrator entrypoint to avoid a static cycle:
    //   ieeBrowserBackend.ts -> agentRunFinalizationService.ts ->
    //     executionBackends/registry.ts -> ieeBrowserBackend.ts (Chunk 5).
    // Today the orchestrator does not import the adapter; the late
    // import keeps the door closed for future Chunk-5 wiring.
    const { finaliseAgentRunFromBackend } = await import('../agentRunFinalizationService.js');
    return ieeReconcile({
      type: 'browser',
      adapterId: 'iee_browser',
      finaliseAgentRunFromBackend,
    });
  },

  async cancel(input) {
    return ieeCancel(input);
  },
};
