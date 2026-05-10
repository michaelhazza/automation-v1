/**
 * headlessBackend — headless config variant of the in-process agentic-loop
 * adapter.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (headless row — "headless is a config variant of api today; the
 *       two adapters share their dispatch implementation via an internal
 *       helper, but register as distinct ids"), § 11 (Adapter rows),
 *       § 14 Chunk 4.
 *
 * `headless` and `api` share the same physical dispatch path today. The
 * refactor keeps them distinct adapter ids — so `executionMode = 'headless'`
 * resolves correctly — while factoring the shared body into
 * `_apiHeadlessShared.ts`. The only per-adapter delta is the trace-metadata
 * `executionMode` value carried by the `mode` parameter.
 *
 * Cycle prevention — does NOT import from `agentExecutionService.ts`. All
 * loop-runtime imports go through the neutral sibling
 * `agentExecutionLoop.ts` (extracted in Chunk 4). Verified by grep.
 */

import { apiHeadlessDispatch } from './_apiHeadlessShared.js';

import {
  BackendOptionsMismatch,
  type ExecutionBackend,
} from './types.js';

export const headlessBackend: ExecutionBackend = {
  // === Identity ===
  id: 'headless',
  capabilities: ['in_process'],
  costModel: 'per_token',
  sandboxRequirement: 'none',
  // No delegated lifecycle slots — in-process dispatch finalises inline.

  async dispatch(input) {
    if (input.backendOptions.backendId !== 'headless') {
      throw new BackendOptionsMismatch('headless', input.backendOptions.backendId);
    }
    return apiHeadlessDispatch({ mode: 'headless', input });
  },
};
