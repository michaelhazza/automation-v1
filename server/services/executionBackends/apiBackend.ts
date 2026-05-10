/**
 * apiBackend — in-process agentic-loop adapter.
 *
 * Spec: tasks/builds/execution-backend-adapter-contract/spec.md § 7
 *       (api row), § 11 (Adapter rows), § 14 Chunk 4.
 *
 * Default execution path. Wraps the shared in-process body
 * (`_apiHeadlessShared.ts`) parameterised with `mode: 'api'` so trace
 * metadata records the correct executionMode value. Reaching this adapter
 * means the dispatch site resolved `executionMode = 'api'`.
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

export const apiBackend: ExecutionBackend = {
  // === Identity ===
  id: 'api',
  capabilities: ['in_process'],
  costModel: 'per_token',
  sandboxRequirement: 'none',
  // No delegated lifecycle slots — in-process dispatch finalises inline
  // via the existing post-completion block in `agentExecutionService.ts`.

  async dispatch(input) {
    if (input.backendOptions.backendId !== 'api') {
      throw new BackendOptionsMismatch('api', input.backendOptions.backendId);
    }
    return apiHeadlessDispatch({ mode: 'api', input });
  },
};
